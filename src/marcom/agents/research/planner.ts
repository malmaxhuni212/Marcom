/**
 * Research planning — derives the research strategy from the StructuredBrief + memory.
 * Nothing here is domain-specific: queries, sources and checks all come from the brief.
 */
import type { StructuredBrief, Target } from '../../schemas/structured-brief';
import type { MemoryContext } from '../../memory/types';

export interface ResearchPlan {
  project_id: string;
  target: Target;
  queries: string[];
  preferred_source_types: string[];
  required_fields: string[];
  qualification_criteria: string[];
  criteria_needing_definition: string[];
  exclusion_criteria: string[];
  evidence_requirements: string[];
  verification_requirements: string[];
  human_rules: string[];
  learnings: string[];
  known_prospect_ids: string[];
  do_not_contact_ids: string[];
  blocking_unknowns: string[];
}

const STOP = new Set(['the', 'and', 'with', 'who', 'that', 'have', 'has', 'for', 'least', 'one', 'their', 'from', 'any', 'only', 'must', 'should', 'are', 'is', 'of', 'in', 'a', 'an', 'to', 'at', 'on', 'by', 'or', 'whose', 'be']);

function keyTerms(text: string, max = 4): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, max);
}

export function planResearch(brief: StructuredBrief, targetId: string, projectId: string, memory?: MemoryContext): ResearchPlan {
  const target = brief.targets.find((t) => t.id === targetId);
  if (!target) throw new Error(`Target "${targetId}" not found in structured brief.`);

  const qualification = target.qualification_criteria.filter((c) => !c.needs_operational_definition).map((c) => c.text);
  const vague = target.qualification_criteria.filter((c) => c.needs_operational_definition).map((c) => c.text);
  const geos = target.geography.length ? target.geography : [''];

  // Query = target type + geography + distinctive criterion terms. Source hints come from the brief only.
  const queries = new Set<string>();
  for (const g of geos) {
    queries.add(`${target.target_type} ${g}`.trim());
    for (const c of qualification.slice(0, 3)) queries.add(`${target.target_type} ${g} ${keyTerms(c).join(' ')}`.trim());
  }

  const relationships = memory?.relationship_context ?? [];
  return {
    project_id: projectId,
    target,
    queries: [...queries],
    preferred_source_types: brief.research.preferred_source_types,
    required_fields: brief.research.required_fields,
    qualification_criteria: qualification,
    criteria_needing_definition: vague,
    exclusion_criteria: target.exclusion_criteria.map((c) => c.text),
    evidence_requirements: brief.research.evidence_requirements,
    verification_requirements: brief.research.verification_requirements,
    human_rules: (memory?.human_decisions ?? []).filter((d) => d.decision === 'rule').map((d) => d.reason),
    learnings: (memory?.relevant_learnings ?? []).map((l) => l.lesson),
    known_prospect_ids: (memory?.prospect_context ?? []).map((p) => p.prospect_id),
    do_not_contact_ids: relationships.filter((r) => r.status === 'do_not_contact').map((r) => r.prospect_id),
    blocking_unknowns: brief.unknowns_requiring_confirmation.filter((u) => u.blocking).map((u) => u.topic),
  };
}
