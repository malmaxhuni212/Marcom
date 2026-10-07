/**
 * Research Agent — orchestration.
 *
 *   Structured Brief + Prospect Seed
 *     -> resolving   : pick target group, retrieve only relevant memory, duplicate/relationship check
 *     -> researching : ONE Groq GPT-OSS 20B call with browser_search (progressive searches inside the call)
 *     -> validating  : parse JSON -> (fallback LLM normaliser only if unparseable) -> deterministic QA
 *     -> ResearchEntry (caller saves it)
 *
 * One search call per prospect keeps us inside the free-tier 8K tokens/minute budget.
 * The agent never writes outreach; that belongs to the Personalization Agent.
 */
import type { StructuredBrief, Target } from '../../schemas/structured-brief';
import type { ProspectSeed, ResearchEntry } from '../../schemas/research-record';
import type { MemoryStore } from '../../memory/store';
import { retrieveMemoryContext } from '../../memory/retrieval';
import { planResearch } from './planner';
import { loadSystemPrompt } from '../prompt-loader';
import { extractJson } from '../../llm/provider';
import type { GroqProvider } from '../../llm/groq-provider';
import { normalizeAndQA, normalizeName } from './qa';

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
  provider: GroqProvider;
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

function buildUserPrompt(brief: StructuredBrief, plan: ReturnType<typeof planResearch>, seed: ProspectSeed, memoryNote: string | null): string {
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
    'Research this prospect now with browser_search, then output the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const NORMALIZER_SYSTEM = `Convert the research notes into ONE JSON object with exactly these keys:
{"name","entity_kind","identity_verified","role","organisation","country","location","website","linkedin","other_profiles","contacts":[{"kind","value","source","confidence"}],"background","projects_or_work","achievements","industry_involvement","criteria":[{"criterion","status","note","sources"}],"evidence":[{"claim","field","sources","confidence","quote"}],"sources":[{"id","url","title","type"}],"unknowns":[{"field","reason"}],"contradictions","fit_score","fit_rationale","summary","confidence"}
Use ONLY information present in the notes. Never add facts, URLs or contacts. Missing = null or []. Output JSON only.`;

export async function runResearchAgent(input: RunResearchInput): Promise<ResearchEntry> {
  const { projectId, brief, seed, store, provider } = input;
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
  const system = loadSystemPrompt('research');
  const user = buildUserPrompt(brief, plan, seed, memoryNote);
  const onWait = (s: number) => progress('researching', `Waiting ${s}s for the API rate limit…`);

  let search;
  try {
    search = await provider.browserSearch({ system, user, maxTokens: 3500 }, { onWait });
  } catch (e) {
    // Never fabricate to compensate for unavailable search.
    throw new Error(`Web search unavailable: ${(e as Error).message}`);
  }
  if (!search.seen.length) {
    progress('validating', 'Web search returned no sources');
  }

  // ---------- 3. Normalise + QA ----------
  progress('validating', 'Validating sources and evidence');
  let draft: unknown;
  try {
    draft = extractJson(search.content);
  } catch {
    if (!search.content.trim()) throw new Error('Research returned no content. Please try again.');
    progress('validating', 'Structuring research notes');
    const text = await provider.complete(
      { system: NORMALIZER_SYSTEM, user: search.content.slice(0, 9000), maxTokens: 2500 },
      { onWait: (s) => progress('validating', `Waiting ${s}s for the API rate limit…`) },
    );
    draft = extractJson(text);
  }

  const { record, qa } = normalizeAndQA(draft, {
    projectId,
    targetId: target.id,
    targetType: target.target_type,
    seed,
    seen: search.seen,
    pages: search.pages,
    toolText: search.toolText,
    matchedProspectId: known?.prospect_id ?? null,
    relationshipStatus: relationship?.status ?? null,
  });

  return {
    record,
    seed,
    qa,
    relationship_status: relationship?.status ?? null,
    model: provider.model,
    searches: search.queries,
  };
}
