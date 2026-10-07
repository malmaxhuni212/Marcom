/**
 * ResearchRecord contract — output of the Research Agent.
 *
 * The field set is stable across projects. Which fields MATTER is decided by the
 * active StructuredBrief (research.required_fields + database.fields), not by this schema.
 *
 * `agents/research/schema.json` is generated from this file via `npm run schemas`.
 */
import { z } from 'zod';

export const RESEARCH_RECORD_VERSION = '1.1' as const;

const nonEmpty = z.string().trim().min(1);

/**
 * Confidence of a single claim:
 *  verified  = stated by an official/primary source (or 2+ independent credible sources)
 *  likely    = credible source(s) agree but not official
 *  uncertain = weak / single third-party / possibly outdated source
 * ("unknown" is never a claim — it goes into `unknowns`.)
 */
export const ClaimConfidenceSchema = z.enum(['verified', 'likely', 'uncertain']);

export const SourceSchema = z.strictObject({
  id: nonEmpty.describe('Local id referenced by evidence items, e.g. "src-1".'),
  url: nonEmpty,
  title: z.string().nullable(),
  source_type: z.string().describe('e.g. "official website", "industry database", "press article".'),
  retrieved_at: z.string().nullable(),
});

export const EvidenceSchema = z.strictObject({
  claim: nonEmpty.describe('The claim being supported, e.g. "Produced the feature film X (2021)".'),
  field: nonEmpty.describe('ResearchRecord field this evidence supports, e.g. "relevant_projects".'),
  source_ids: z.array(nonEmpty).min(1),
  quote: z.string().nullable().describe('Short verbatim excerpt from the source, if available.'),
  confidence: ClaimConfidenceSchema,
});

export const PublicContactSchema = z.strictObject({
  kind: z.enum(['email', 'contact_form', 'phone', 'agent_or_representative', 'social_profile', 'other']),
  value: nonEmpty,
  is_professional: z.boolean(),
  source_ids: z.array(nonEmpty).min(1).describe('A contact route MUST be backed by a source where it appears verbatim.'),
  confidence: ClaimConfidenceSchema,
});

export const FitAssessmentSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  band: z.enum(['irrelevant', 'weak', 'possible', 'strong', 'highly_relevant']),
  rationale: z.string().describe('Evidence-based explanation of fit against the project brief.'),
});

export const UnknownFieldSchema = z.strictObject({
  field: nonEmpty,
  reason: nonEmpty,
});

export const QualificationAssessmentSchema = z.strictObject({
  criterion: nonEmpty,
  status: z.enum(['met', 'not_met', 'partially_met', 'unknown']),
  note: z.string().nullable(),
  source_ids: z.array(nonEmpty),
});

export const ResearchRecordSchema = z.strictObject({
  research_record_version: z.literal(RESEARCH_RECORD_VERSION),
  record_id: nonEmpty,
  project_id: nonEmpty,
  brief_target_id: nonEmpty.describe('Which StructuredBrief target group this record belongs to.'),

  identity: z.strictObject({
    name: z.string().nullable(),
    entity_kind: z.enum(['person', 'organisation']),
    identity_verified: z.boolean(),
  }),
  target_type: nonEmpty,
  role: z.string().nullable(),
  organisation: z.string().nullable(),
  country: z.string().nullable(),
  location: z.string().nullable(),

  website: z.string().nullable(),
  linkedin: z.string().nullable(),
  instagram: z.string().nullable(),
  other_public_profiles: z.array(nonEmpty),
  public_contact: z.array(PublicContactSchema),

  relevant_experience: z.array(nonEmpty),
  relevant_projects: z.array(nonEmpty),
  achievements: z.array(nonEmpty),
  industry_involvement: z.array(nonEmpty),

  qualification_assessment: z.array(QualificationAssessmentSchema),
  reason_for_relevance: z.string().nullable(),
  fit: FitAssessmentSchema,
  summary: z.string().describe('Neutral factual research summary. Never outreach copy.'),

  evidence: z.array(EvidenceSchema),
  sources: z.array(SourceSchema),
  unknowns: z.array(UnknownFieldSchema),
  contradictions: z.array(nonEmpty),
  research_confidence: z.enum(['high', 'medium', 'low']),

  /** Set by duplicate detection when the record matches an existing prospect in memory. */
  matched_prospect_id: z.string().nullable(),

  researched_at: nonEmpty,
  research_agent_version: nonEmpty,
});

export type Source = z.infer<typeof SourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type PublicContact = z.infer<typeof PublicContactSchema>;
export type ClaimConfidence = z.infer<typeof ClaimConfidenceSchema>;
export type FitAssessment = z.infer<typeof FitAssessmentSchema>;
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

/** What the user gives the Research Agent. Any field except `name` may be missing. */
export interface ProspectSeed {
  name: string;
  entity_kind?: 'person' | 'organisation' | 'unknown';
  organisation?: string;
  role?: string;
  website?: string;
  linkedin?: string;
  country?: string;
  notes?: string;
}

export interface ResearchQAIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface ResearchQA {
  status: 'passed' | 'needs_review' | 'failed';
  issues: ResearchQAIssue[];
}

/** One saved research run for a prospect inside a project (memory/research/<project_id>.json). */
export interface ResearchEntry {
  record: ResearchRecord;
  seed: ProspectSeed;
  qa: ResearchQA;
  /** Relationship status from memory, surfaced so humans see do_not_contact etc. */
  relationship_status: string | null;
  model: string;
  searches: string[];
}
