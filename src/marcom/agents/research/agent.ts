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
import type { SearchCandidate, SearchProvider, SeenSource } from '../../search/provider';
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
    memoryNote ? `MEMORY: ${memoryNote}` : '',
    `PROSPECT SEED (may be incomplete — verify, do not trust blindly):\n${seedLines}`,
    `SUPPLIED SEARCH EVIDENCE:\n${evidenceBundle}`,
    'Analyse only the supplied evidence and output the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildSearchQuery(brief: StructuredBrief, plan: ReturnType<typeof planResearch>, seed: ProspectSeed): string {
  return [
    seed.name,
    seed.organisation,
    seed.website,
    plan.target.target_type,
    plan.target.geography.slice(0, 3).join(' '),
    brief.project.name,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}

function buildEvidence(candidates: SearchCandidate[]): {
  bundle: string;
  seen: SeenSource[];
  pages: { url: string; text: string }[];
  toolText: string;
} {
  const unique = new Map<string, SearchCandidate>();
  for (const candidate of candidates) {
    const key = canonicalUrl(candidate.url);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  let usedCharacters = 0;
  const maximumCharacters = 10_000;
  const seen: SeenSource[] = [];
  const pages: { url: string; text: string }[] = [];
  const sections: string[] = [];

  for (const [index, candidate] of [...unique.values()].entries()) {
    if (usedCharacters >= maximumCharacters) break;
    const text = [candidate.highlights.join('\n'), candidate.text].filter(Boolean).join('\n').slice(0, 6_000);
    const source = [
      `SOURCE ID: S${index + 1}`,
      `URL: ${candidate.url}`,
      `TITLE: ${candidate.title}`,
      `CONTENT: ${text || '(No page text returned. Use only the title and URL.)'}`,
    ].join('\n');
    const remaining = maximumCharacters - usedCharacters;
    const clipped = source.slice(0, remaining);
    sections.push(clipped);
    usedCharacters += clipped.length;
    seen.push({ url: candidate.url, title: candidate.title, via: text ? 'page' : 'search' });
    pages.push({ url: candidate.url, text });
  }

  return { bundle: sections.join('\n\n'), seen, pages, toolText: sections.join('\n\n') };
}

const NORMALIZER_SYSTEM = `Convert the research notes into ONE JSON object with exactly these keys:
{"name","entity_kind","identity_verified","role","organisation","country","location","website","linkedin","other_profiles","contacts":[{"kind","value","source","confidence"}],"background","projects_or_work","achievements","industry_involvement","criteria":[{"criterion","status","note","sources"}],"evidence":[{"claim","field","sources","confidence","quote"}],"sources":[{"id","url","title","type"}],"unknowns":[{"field","reason"}],"contradictions","fit_score","fit_rationale","summary","confidence"}
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
      category: target.entity_kind === 'person' ? 'people' : target.entity_kind === 'organisation' ? 'company' : undefined,
    });
  } catch (e) {
    // Never fabricate to compensate for unavailable search.
    throw new Error(`Web search unavailable: ${(e as Error).message}`);
  }
  if (!search.candidates.length) {
    progress('validating', 'Web search returned no sources');
  }

  const evidence = buildEvidence(search.candidates);
  const system = loadResearchEvidencePrompt();
  const user = buildUserPrompt(brief, plan, seed, memoryNote, evidence.bundle);

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
    searches: [search.query],
    search_provider: search.providerKey,
    search_request_ids: search.providerRequestId ? [search.providerRequestId] : [],
    search_usage: {
      requests: search.usage.requests,
      estimated_cost_usd: search.usage.estimatedCostUsd,
      latency_ms: search.latencyMs,
    },
    search_warnings: search.warnings,
  };
}
