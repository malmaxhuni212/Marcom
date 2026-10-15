/**
 * Memory retrieval — returns ONLY the context relevant to a specific task.
 *
 * Example: { task: 'research', project_id: 'soulbound', target_type: 'film producers', geography: ['UK'] }
 * returns Soulbound project context, the producer target definition, known producers, their
 * relationship history, Soulbound/global decisions about producers, and validated producer learnings.
 * It does NOT return Maya Book Awards or literary memory.
 */
import type { MemoryStore } from './store';
import type {
  HumanDecision,
  Learning,
  MemoryContext,
  ProspectMemory,
  RetrievalQuery,
  RetrievalTraceItem,
  TargetDefinition,
} from './types';

const singular = (w: string) => w.replace(/(ies)$/i, 'y').replace(/(?<!s)s$/i, '');
const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).map(singular);

/** True if every token of `alias` appears in `text` (order-insensitive, singularised). */
function aliasMatches(alias: string, text: string): boolean {
  const t = new Set(tokens(text));
  const a = tokens(alias);
  return a.length > 0 && a.every((x) => t.has(x));
}

export function targetTypeMatches(candidateTypes: string[], wanted: string | undefined): boolean {
  if (!wanted) return true;
  return candidateTypes.some((c) => aliasMatches(c, wanted) || aliasMatches(wanted, c));
}

function definitionMatches(def: TargetDefinition, wanted: string): boolean {
  return [def.target_type, ...def.aliases].some((a) => aliasMatches(a, wanted) || aliasMatches(wanted, a));
}

function geographyMatches(country: string | null, geography?: string[]): boolean {
  if (!geography?.length || !country) return true;
  const UK = ['uk', 'united kingdom', 'england', 'scotland', 'wales', 'northern ireland', 'north of england', 'london'];
  const c = country.toLowerCase();
  return geography.some((g) => {
    const gl = g.toLowerCase();
    return gl === c || c.includes(gl) || gl.includes(c) || (UK.includes(gl) && UK.includes(c));
  });
}

/** Resolve a free-text request like "Find UK film producers for Soulbound" into a RetrievalQuery. */
export function resolveQuery(text: string, store: MemoryStore, task: RetrievalQuery['task'] = 'research'): RetrievalQuery | null {
  const lower = text.toLowerCase();
  const project = store.projects().find((p) => [p.name, ...p.aliases].some((n) => lower.includes(n.toLowerCase())));
  if (!project) return null;
  const def = project.target_definitions.find((d) => [d.target_type, ...d.aliases].some((a) => aliasMatches(a, text)));
  const geo = ['UK', 'United Kingdom', 'Europe', 'US', 'Berlin', 'London', 'Ireland'].filter((g) => new RegExp(`\\b${g}\\b`, 'i').test(text));
  return { task, project_id: project.project_id, target_type: def?.target_type, geography: geo.length ? geo : undefined };
}

export function retrieveMemoryContext(query: RetrievalQuery, store: MemoryStore): MemoryContext {
  const trace: RetrievalTraceItem[] = [];
  const note = (memory: RetrievalTraceItem['memory'], id: string, included: boolean, reason: string) =>
    trace.push({ memory, id, included, reason });

  // 1. Lunim — only sections tagged for this task
  const lunim = store.lunim().filter((s) => {
    const ok = s.used_for.includes(query.task);
    note('lunim_context', s.id, ok, ok ? `tagged for ${query.task}` : `not used for ${query.task}`);
    return ok;
  });

  // 2. Project — only the active project
  const project = store.projects().find((p) => p.project_id === query.project_id) ?? null;
  for (const p of store.projects()) {
    note('project_context', p.project_id, p.project_id === query.project_id, p.project_id === query.project_id ? 'active project' : 'different project');
  }

  // 3. Target definitions — only those matching the requested target type
  const targets = (project?.target_definitions ?? []).filter((d) => {
    const ok = !query.target_type || definitionMatches(d, query.target_type);
    note('target_context', `${query.project_id}:${d.target_type}`, ok, ok ? 'matches requested target type' : 'different target type');
    return ok;
  });
  const wantedTypes = targets.length ? targets.flatMap((d) => [d.target_type, ...d.aliases]) : query.target_type ? [query.target_type] : [];

  // 4. Prospects — known in this project, or same target type + geography from other projects; or named lookups
  const named = new Set((query.prospect_names ?? []).map((n) => n.toLowerCase()));
  const prospects: ProspectMemory[] = [];
  for (const p of store.prospects()) {
    const isNamed = [p.name, ...p.aliases].some((n) => named.has(n.toLowerCase()));
    const typeOk = wantedTypes.length === 0 || p.target_types.some((t) => wantedTypes.some((w) => aliasMatches(t, w) || aliasMatches(w, t)));
    const geoOk = geographyMatches(p.country, query.geography);
    const inProject = p.project_ids.includes(query.project_id);
    const ok = isNamed || (typeOk && geoOk && (inProject || wantedTypes.length > 0));
    note(
      'prospect_context',
      p.prospect_id,
      ok,
      isNamed ? 'explicitly named' : !typeOk ? 'target type does not match' : !geoOk ? 'outside requested geography' : inProject ? 'same project and target type' : 'same target type from another project',
    );
    if (ok) prospects.push(p);
  }
  const limited = prospects.slice(0, query.max_prospects ?? 25);
  const prospectIds = new Set(limited.map((p) => p.prospect_id));

  // 5. Relationships — only for retrieved prospects (status like do_not_contact applies across projects)
  const relationships = store.relationships().filter((r) => {
    const ok = prospectIds.has(r.prospect_id);
    note('relationship_context', `${r.prospect_id}:${r.project_id ?? 'global'}`, ok, ok ? 'prospect in context' : 'prospect not in context');
    return ok;
  });

  // 6. Human decisions — this project or global, matching target type, or about retrieved prospects
  const decisions: HumanDecision[] = store.decisions().filter((d) => {
    const aboutProspect = d.subject_type === 'prospect' && d.subject_id !== null && prospectIds.has(d.subject_id);
    const scopeOk = d.project_id === null || d.project_id === query.project_id;
    const typeOk = d.target_types.length === 0 || targetTypeMatches(d.target_types, wantedTypes.join(' ') || query.target_type);
    const ok = aboutProspect || (scopeOk && typeOk);
    note('human_decisions', d.decision_id, ok, aboutProspect ? 'about a prospect in context' : !scopeOk ? 'different project' : !typeOk ? 'different target type' : 'project/global decision for this target');
    return ok;
  });

  // 7. Learnings — validated only, global or this project, matching target type
  const learnings: Learning[] = store.learnings().filter((l) => {
    const scopeOk = l.project_id === null || l.project_id === query.project_id;
    const typeOk = l.target_types.length === 0 || targetTypeMatches(l.target_types, wantedTypes.join(' ') || query.target_type);
    const ok = l.validated && scopeOk && typeOk;
    note('relevant_learnings', l.learning_id, ok, !l.validated ? 'not validated' : !scopeOk ? 'different project' : !typeOk ? 'different target type' : 'relevant validated lesson');
    return ok;
  });

  return {
    query,
    lunim_context: lunim,
    project_context: project,
    target_context: targets,
    prospect_context: limited,
    relationship_context: relationships,
    human_decisions: decisions,
    relevant_learnings: learnings,
    retrieval_trace: trace,
  };
}
