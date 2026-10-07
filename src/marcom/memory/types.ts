/**
 * MARCOM memory model.
 *
 * Six memory types, each stored separately and retrieved selectively:
 *   1. Lunim memory          — permanent organisational context (docs/lunim-context.md)
 *   2. Project memory        — project information, structured brief, target definitions, decisions
 *   3. Prospect memory       — people/organisations already known to MARCOM
 *   4. Relationship memory   — communication history and status per prospect
 *   5. Human decision memory — approvals/rejections/rules with reasons (override AI assumptions)
 *   6. Learning memory       — validated examples and recurring lessons
 */
import type { StructuredBrief } from '../schemas/structured-brief';

export type TaskKind = 'brief_analysis' | 'research' | 'personalization';

export interface LunimSection {
  id: string;
  title: string;
  body: string;
  /** Which tasks this section is relevant to. Prevents dumping all Lunim context into every call. */
  used_for: TaskKind[];
  status: 'confirmed' | 'inferred' | 'pending_confirmation';
}

export interface TargetDefinition {
  target_type: string;
  definition: string;
  aliases: string[];
}

export interface ProjectMemory {
  project_id: string;
  name: string;
  aliases: string[];
  summary: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  structured_brief: StructuredBrief | null;
  target_definitions: TargetDefinition[];
  notes: string[];
}

export interface ProspectMemory {
  prospect_id: string;
  name: string;
  aliases: string[];
  entity_kind: 'person' | 'organisation';
  target_types: string[];
  role: string | null;
  organisation: string | null;
  country: string | null;
  website: string | null;
  linkedin: string | null;
  project_ids: string[];
  last_researched_at: string | null;
  summary: string;
}

export type RelationshipStatus = 'never_contacted' | 'contacted' | 'replied' | 'engaged' | 'declined' | 'do_not_contact';

export interface RelationshipMemory {
  prospect_id: string;
  project_id: string | null;
  status: RelationshipStatus;
  events: { date: string; channel: string; summary: string }[];
}

export interface HumanDecision {
  decision_id: string;
  project_id: string | null; // null = applies to all projects
  subject_type: 'prospect' | 'brief' | 'draft' | 'criterion' | 'rule';
  subject_id: string | null;
  decision: 'approved' | 'rejected' | 'edited' | 'rule';
  reason: string;
  target_types: string[]; // empty = any target type
  decided_by: string;
  created_at: string;
}

export interface Learning {
  learning_id: string;
  project_id: string | null; // null = global lesson
  target_types: string[]; // empty = any target type
  lesson: string;
  validated: boolean;
  tags: string[];
}

export interface RetrievalTraceItem {
  memory: keyof Omit<MemoryContext, 'retrieval_trace' | 'query'>;
  id: string;
  included: boolean;
  reason: string;
}

export interface MemoryContext {
  query: RetrievalQuery;
  lunim_context: LunimSection[];
  project_context: ProjectMemory | null;
  target_context: TargetDefinition[];
  prospect_context: ProspectMemory[];
  relationship_context: RelationshipMemory[];
  human_decisions: HumanDecision[];
  relevant_learnings: Learning[];
  /** Why each item was included or excluded — makes retrieval auditable. */
  retrieval_trace: RetrievalTraceItem[];
}

export interface RetrievalQuery {
  task: TaskKind;
  project_id: string;
  target_type?: string;
  geography?: string[];
  /** Specific prospect names to look up (e.g. duplicate detection). */
  prospect_names?: string[];
  max_prospects?: number;
}
