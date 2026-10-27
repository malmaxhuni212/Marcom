/**
 * Research Agent — orchestration.
 *
 *   Structured Brief + Prospect Seed
 *     -> resolving   : pick target group, retrieve only relevant memory, duplicate/relationship check
 *     -> researching : provider-neutral web search, then LLM analysis of returned evidence
 *     -> validating  : parse JSON -> deterministic QA
 *     -> ResearchEntry (caller saves it)
 *
 * The agent never writes outreach; that belongs to the Personalization Agent.
 */
import type { StructuredBrief, Target } from '../../schemas/structured-brief';
import type { ProspectSeed, ResearchEntry } from '../../schemas/research-record';
import type { MemoryStore } from '../../memory/store';
import { retrieveMemoryContext } from '../../memory/retrieval';
import { planResearch } from './planner';
import { loadResearchEvidencePrompt } from '../prompt-loader';
import { extractJson } from '../../llm/provider';
import type { LLMProvider } from '../../llm/provider';
import type { SearchCandidate, SearchProvider, SearchResponse, SeenSource } from '../../search/provider';
import { canonicalUrl, normalizeAndQA, normalizeName } from './qa';

export type ResearchStage = 'resolving' | 'researching' | 'validating' | 'saving' | 'complete';

export interface ResearchProgress {
  stage: ResearchStage;
  message: string;
}

export interface RunResearchInput {
  projectId: string;
  brief: StructuredBrief;
  targetId?: string;
  seed: ProspectSeed;
  store: MemoryStore;
  searchProvider: SearchProvider;
  llmProvider: LLMProvider;
  onProgress?: (p: ResearchProgress) => void;
}

const clip = (s: string, n = 180) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const list = (items: string[], max = 6) => (items.length ? items.slice(0, max).map((i) => `- ${clip(i)}`).join('\n') : '- (none specified)');

/** Picks the brief target group that best matches the seed (explicit id > entity kind > primary > first). */
export function pickTarget(brief: StructuredBrief, seed: ProspectSeed, targetId?: string): Target {
  const byId = targetId ? brief.targets.find((t) => t.id === targetId) : undefined;
  if (byId) return byId;
  const kind = seed.entity_kind && seed.entity_kind !== 'unknown' ? seed.entity_kind : null;
  const ordered = [...brief.targets].sort((a, b) => (a.priority === 'primary' ? -1 : 0) - (b.priority === 'primary' ? -1 : 0));
  return (kind && ordered.find((t) => t.entity_kind === kind)) || ordered[0];
}

function buildUserPrompt(
  brief: StructuredBrief,
  plan: ReturnType<typeof planResearch>,
  seed: ProspectSeed,
  memoryNote: string | null,
  evidenceBundle: string,
  contactRoles: string[] | null,
): string {
  const t = plan.target;
  const researchFields = brief.database.fields.filter((f) => f.expected_source === 'research').map((f) => f.name);
  const fields = [...new Set([...plan.required_fields, ...researchFields])];
  const seedLines = Object.entries(seed)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${clip(String(v), 300)}`)
    .join('\n');

  return [
    `PROJECT: ${brief.project.name ?? 'Unnamed project'}`,
    `OBJECTIVE: ${clip(brief.project.primary_objective || brief.project.description, 300)}`,
    `TARGET GROUP: ${t.target_type} (${t.entity_kind})${t.geography.length ? ` — geography: ${t.geography.join(', ')}` : ''}`,
    t.description ? `TARGET DESCRIPTION: ${clip(t.description, 250)}` : '',
    `QUALIFICATION CRITERIA (assess each):\n${list([...plan.qualification_criteria, ...plan.criteria_needing_definition])}`,
    `EXCLUSIONS (flag if hit):\n${list(plan.exclusion_criteria)}`,
    `FIELDS TO FIND:\n${list(fields, 10)}`,
    plan.preferred_source_types.length ? `PREFERRED SOURCES: ${plan.preferred_source_types.slice(0, 6).join('; ')}` : '',
    plan.verification_requirements.length ? `VERIFICATION RULES:\n${list(plan.verification_requirements, 4)}` : '',
    plan.human_rules.length ? `HUMAN RULES (override everything):\n${list(plan.human_rules, 4)}` : '',
    contactRoles?.length
      ? `KEY CONTACTS: This prospect is an organisation. Generic inboxes are often missing, so also list up to 6 named people from the evidence who work at THIS organisation and would plausibly handle this campaign's request. Most relevant roles: ${contactRoles.join('; ')}. For each, copy their role, email, phone and personal LinkedIn URL exactly as shown in a supplied source (null when absent) and explain the relevance in one short sentence. Only include people the source clearly ties to this organisation.`
      : '',
    memoryNote ? `MEMORY: ${memoryNote}` : '',
    `PROSPECT SEED (may be incomplete — verify, do not trust blindly):\n${seedLines}`,
    `SUPPLIED SEARCH EVIDENCE:\n${evidenceBundle}`,
    'Analyse only the supplied evidence and output the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildSearchQuery(brief: StructuredBrief, plan: ReturnType<typeof planResearch>, seed: ProspectSeed): string {
  // Omit brief.project.name so it doesn't force matches to the project!
  // Append a targeted keyword to find official websites and contact pages.
  return [
    seed.name,
    seed.organisation,
    seed.website,
    plan.target.target_type,
    'official website OR contact OR email OR about'
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}

/** True when the prospect is an organisation, so named staff should be searched as contact routes. */
export function isOrganisationProspect(seed: ProspectSeed, target: Target): boolean {
  if (seed.entity_kind === 'organisation') return true;
  if (seed.entity_kind === 'person') return false;
  return target.entity_kind === 'organisation';
}

const DEFAULT_CONTACT_ROLES = [
  'partnerships manager',
  'outreach coordinator',
  'communications manager',
  'marketing manager',
  'programme manager',
  'director',
];

/** Role suggestions are derived once per campaign target and reused for every prospect in the run. */
const contactRoleCache = new Map<string, Promise<string[]>>();

export function contactRolesCacheKey(brief: StructuredBrief, target: Target): string {
  return [brief.project.name ?? '', brief.project.primary_objective, target.id, target.target_type].join('|');
}

async function suggestContactRoles(brief: StructuredBrief, target: Target, llmProvider: LLMProvider): Promise<string[]> {
  const key = contactRolesCacheKey(brief, target);
  const cached = contactRoleCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const raw = await llmProvider.complete({
        system:
          'You map a campaign to the job titles inside a target organisation that would handle or decide on the request. Return JSON only: {"roles":["..."]}. Use short generic job titles or departments, no names.',
        user: JSON.stringify({
          campaign: brief.project.name,
          objective: clip(brief.project.primary_objective || brief.project.description, 400),
          outreach_objectives: brief.outreach.objectives.slice(0, 4),
          target_organisation_type: target.target_type,
          target_description: clip(target.description ?? '', 250),
          instruction: 'List the 4-6 most relevant roles to contact at this kind of organisation for this request.',
        }),
        maxTokens: 300,
      });
      const parsed = extractJson(raw) as { roles?: unknown };
      const roles = (Array.isArray(parsed?.roles) ? parsed.roles : [])
        .map((role) => String(role ?? '').trim())
        .filter((role) => role.length > 1 && role.length <= 60)
        .slice(0, 6);
      return roles.length ? roles : DEFAULT_CONTACT_ROLES;
    } catch {
      contactRoleCache.delete(key);
      return DEFAULT_CONTACT_ROLES;
    }
  })();
  contactRoleCache.set(key, pending);
  return pending;
}

function domainOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Queries that surface named staff (team pages and LinkedIn profiles) for an organisation prospect. */
export function buildContactQueries(seed: ProspectSeed, roles: string[]): { team: string; people: string } {
  const organisation = seed.organisation?.trim() || seed.name;
  const topRoles = roles.slice(0, 4);
  return {
    team: [organisation, 'team staff contacts', topRoles.join(' '), 'email'].filter(Boolean).join(' ').slice(0, 400),
    people: `${topRoles.slice(0, 3).join(', ')} at ${organisation}`.slice(0, 400),
  };
}

interface EvidenceGroup {
  candidates: SearchCandidate[];
  maximumCharacters: number;
}

function buildEvidence(groups: EvidenceGroup[]): {
  bundle: string;
  seen: SeenSource[];
  pages: { url: string; text: string }[];
  toolText: string;
} {
  const used = new Set<string>();
  const seen: SeenSource[] = [];
  const pages: { url: string; text: string }[] = [];
  const sections: string[] = [];
  let sourceNumber = 0;

  for (const group of groups) {
    let usedCharacters = 0;
    for (const candidate of group.candidates) {
      if (usedCharacters >= group.maximumCharacters) break;
      const key = canonicalUrl(candidate.url);
      if (used.has(key)) continue;
      used.add(key);
      sourceNumber += 1;
      const text = [candidate.highlights.join('\n'), candidate.text].filter(Boolean).join('\n').slice(0, 2_200);
      const source = [
        `SOURCE ID: S${sourceNumber}`,
        `URL: ${candidate.url}`,
        `TITLE: ${candidate.title}`,
        `CONTENT: ${text || '(No page text returned. Use only the title and URL.)'}`,
      ].join('\n');
      const remaining = group.maximumCharacters - usedCharacters;
      const clipped = source.slice(0, remaining);
      sections.push(clipped);
      usedCharacters += clipped.length;
      seen.push({ url: candidate.url, title: candidate.title, via: text ? 'page' : 'search' });
      pages.push({ url: candidate.url, text: `${candidate.title}\n${text}` });
    }
  }

  return { bundle: sections.join('\n\n'), seen, pages, toolText: sections.join('\n\n') };
}

const NORMALIZER_SYSTEM = `Convert the research notes into ONE JSON object with exactly these keys:
{"name","entity_kind","identity_verified","role","organisation","country","location","websites":[{"url","type","title"}],"social_profiles":[{"platform","profile_url","username","display_name","verified_status","confidence","source_ids"}],"public_contact":[{"kind","value","is_professional","source_ids","confidence"}],"key_contacts":[{"name","role","department","email","linkedin_url","phone","relevance","source_ids","confidence"}],"background":["string"],"work_and_projects":["string"],"achievements":["string"],"industry_activity":["string"],"criteria":[{"criterion","status","note","sources"}],"evidence":[{"claim","field","sources","confidence","quote"}],"sources":[{"id","url","title","type"}],"unknowns":[{"field","reason"}],"contradictions","fit_score","fit_rationale","summary","confidence"}
Use ONLY information present in the notes. Never add facts, URLs or contacts. Missing = null or []. Output JSON only.`;

export async function runResearchAgent(input: RunResearchInput): Promise<ResearchEntry> {
  const { projectId, brief, seed, store, searchProvider, llmProvider } = input;
  const progress = (stage: ResearchStage, message: string) => input.onProgress?.({ stage, message });

  // ---------- 1. Resolve identity context ----------
  progress('resolving', `Resolving identity for ${seed.name}`);
  const target = pickTarget(brief, seed, input.targetId);
  const memory = retrieveMemoryContext(
    { task: 'research', project_id: projectId, target_type: target.target_type, prospect_names: [seed.name], max_prospects: 10 },
    store,
  );
  const plan = planResearch(brief, target.id, projectId, memory);
  const n = normalizeName(seed.name);
  const known = memory.prospect_context.find((p) => [p.name, ...p.aliases].some((a) => normalizeName(a) === n)) ?? null;
  const relationship = known ? memory.relationship_context.find((r) => r.prospect_id === known.prospect_id) ?? null : null;
  const memoryNote = known
    ? `Known prospect "${known.name}"${known.organisation ? ` (${known.organisation})` : ''}${relationship ? `, relationship status: ${relationship.status}` : ''}. Re-verify; do not copy memory as evidence.`
    : null;

  // ---------- 2. Web research ----------
  progress('researching', `Searching the web for ${seed.name}`);
  const query = buildSearchQuery(brief, plan, seed);
  let search;
  try {
    search = await searchProvider.search({
      query,
      resultLimit: Math.min(10, searchProvider.capabilities().maximumResults),
      includeDomains: [],
      excludeDomains: [],
      category: target.entity_kind === 'organisation' ? 'company' : undefined, // Remove 'people' category constraint so it finds personal websites instead of just LinkedIn
    });
  } catch (e) {
    // Never fabricate to compensate for unavailable search.
    throw new Error(`Web search unavailable: ${(e as Error).message}`);
  }
  if (!search.candidates.length) {
    progress('validating', 'Web search returned no sources');
  }

  // ---------- 2b. Key contacts inside organisations ----------
  // Organisations rarely publish a direct inbox, so also look for the named people who handle this kind of request.
  let contactRoles: string[] | null = null;
  const contactSearches: SearchResponse[] = [];
  const contactWarnings: string[] = [];
  if (isOrganisationProspect(seed, target)) {
    contactRoles = await suggestContactRoles(brief, target, llmProvider);
    progress('researching', `Looking for the right people to contact at ${seed.name}`);
    const queries = buildContactQueries(seed, contactRoles);
    const limit = Math.min(8, searchProvider.capabilities().maximumResults);
    const domain = domainOf(seed.website ?? search.candidates[0]?.url);
    const settled = await Promise.allSettled([
      searchProvider.search({
        query: queries.team,
        resultLimit: limit,
        includeDomains: domain && searchProvider.capabilities().supportsDomainFilters ? [domain] : [],
        excludeDomains: [],
      }),
      searchProvider.search({
        query: queries.people,
        resultLimit: limit,
        includeDomains: [],
        excludeDomains: [],
        category: searchProvider.capabilities().supportsCategory ? 'people' : undefined,
      }),
    ]);
    for (const result of settled) {
      if (result.status === 'fulfilled') contactSearches.push(result.value);
      else contactWarnings.push(`Key contact search failed: ${(result.reason as Error)?.message ?? 'unknown error'}`);
    }
  }

  const contactCandidates = contactSearches.flatMap((response) => response.candidates);
  const evidence = buildEvidence([
    { candidates: search.candidates, maximumCharacters: contactCandidates.length ? 7_000 : 8_000 },
    { candidates: contactCandidates, maximumCharacters: 5_000 },
  ]);
  const system = loadResearchEvidencePrompt();
  const user = buildUserPrompt(brief, plan, seed, memoryNote, evidence.bundle, contactRoles);

  // ---------- 3. Normalise + QA ----------
  progress('validating', 'Validating sources and evidence');
  let draft: unknown;
  let rawCompletion = '';
  try {
    rawCompletion = await llmProvider.complete({ system, user, maxTokens: 2_500 });
    draft = extractJson(rawCompletion);
  } catch (error) {
    if (!evidence.bundle.trim()) throw new Error('Research returned no evidence. Please try again.');
    if (!rawCompletion) throw error;
    progress('validating', 'Repairing the research structure');
    const text = await llmProvider.complete({
      system: NORMALIZER_SYSTEM,
      user: `INVALID OUTPUT:\n${rawCompletion.slice(0, 10_000)}\n\nSUPPLIED EVIDENCE:\n${evidence.bundle.slice(0, 12_000)}`,
      maxTokens: 2_500,
    });
    draft = extractJson(text);
  }

  const { record, qa } = normalizeAndQA(draft, {
    projectId,
    targetId: target.id,
    targetType: target.target_type,
    seed,
    seen: evidence.seen,
    pages: evidence.pages,
    toolText: evidence.toolText,
    matchedProspectId: known?.prospect_id ?? null,
    relationshipStatus: relationship?.status ?? null,
  });

  return {
    record,
    seed,
    qa,
    relationship_status: relationship?.status ?? null,
    model: llmProvider.model ?? llmProvider.name,
    ai_provider: llmProvider.name,
    searches: [search.query, ...contactSearches.map((response) => response.query)],
    search_provider: search.providerKey,
    search_request_ids: [search, ...contactSearches]
      .map((response) => response.providerRequestId)
      .filter((id): id is string => Boolean(id)),
    search_usage: {
      requests: [search, ...contactSearches].reduce((total, response) => total + response.usage.requests, 0),
      estimated_cost_usd: [search, ...contactSearches].reduce((total, response) => total + (response.usage.estimatedCostUsd ?? 0), 0),
      latency_ms: search.latencyMs + Math.max(0, ...contactSearches.map((response) => response.latencyMs)),
    },
    search_warnings: [...search.warnings, ...contactSearches.flatMap((response) => response.warnings), ...contactWarnings],
  };
}



