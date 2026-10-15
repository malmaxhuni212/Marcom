import { z } from 'zod';

export const RESEARCH_RECORD_VERSION = '1.1' as const;

const nonEmpty = z.string().trim().min(1);

export const ClaimConfidenceSchema = z.enum(['verified', 'likely', 'uncertain']);

export const SourceSchema = z.strictObject({
  id: nonEmpty,
  url: nonEmpty,
  title: z.string().nullable(),
  source_type: z.string(),
  retrieved_at: z.string().nullable(),
});

export const EvidenceSchema = z.strictObject({
  claim: nonEmpty,
  field: nonEmpty,
  source_ids: z.array(nonEmpty).min(1),
  quote: z.string().nullable(),
  confidence: ClaimConfidenceSchema,
});

export const WebsiteSchema = z.strictObject({
  url: nonEmpty,
  type: z.enum(['personal', 'company', 'author', 'portfolio', 'project', 'official_profile', 'other']),
  title: z.string().nullable(),
});

export const SocialProfileSchema = z.strictObject({
  platform: z.enum(['linkedin', 'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'threads', 'bluesky', 'goodreads', 'substack', 'medium', 'other']),
  profile_url: nonEmpty,
  username: z.string().nullable(),
  display_name: z.string().nullable(),
  verified_status: z.boolean(),
  confidence: ClaimConfidenceSchema,
  source_ids: z.array(nonEmpty).min(1),
});

export const PublicContactSchema = z.strictObject({
  kind: z.enum(['email', 'contact_form', 'phone', 'agent_or_representative', 'other']),
  value: nonEmpty,
  is_professional: z.boolean(),
  source_ids: z.array(nonEmpty).min(1),
  confidence: ClaimConfidenceSchema,
});

export const FitAssessmentSchema = z.strictObject({
  score: z.number().int().min(0).max(100),
  band: z.enum(['irrelevant', 'weak', 'possible', 'strong', 'highly_relevant']),
  rationale: z.string(),
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
  brief_target_id: nonEmpty,

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

  websites: z.array(WebsiteSchema),
  social_profiles: z.array(SocialProfileSchema),
  public_contact: z.array(PublicContactSchema),

  background: z.array(nonEmpty),
  work_and_projects: z.array(nonEmpty),
  achievements: z.array(nonEmpty),
  industry_activity: z.array(nonEmpty),

  qualification_assessment: z.array(QualificationAssessmentSchema),
  reason_for_relevance: z.string().nullable(),
  fit: FitAssessmentSchema,
  summary: z.string(),

  evidence: z.array(EvidenceSchema),
  sources: z.array(SourceSchema),
  unknowns: z.array(UnknownFieldSchema),
  contradictions: z.array(nonEmpty),
  research_confidence: z.enum(['high', 'medium', 'low']),

  matched_prospect_id: z.string().nullable(),
  researched_at: nonEmpty,
  research_agent_version: nonEmpty,
});

export type Source = z.infer<typeof SourceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Website = z.infer<typeof WebsiteSchema>;
export type SocialProfile = z.infer<typeof SocialProfileSchema>;
export type PublicContact = z.infer<typeof PublicContactSchema>;
export type ClaimConfidence = z.infer<typeof ClaimConfidenceSchema>;
export type FitAssessment = z.infer<typeof FitAssessmentSchema>;
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

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

export const ReviewStatusSchema = z.enum(['needs_review', 'shortlisted', 'rejected', 'enrichment_requested']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export interface ProspectReview {
  project_id: string;
  record_id: string;
  status: ReviewStatus;
  note: string | null;
  reviewed_at: string;
  reviewed_by: string;
}

export interface ResearchEntry {
  record: ResearchRecord;
  seed: ProspectSeed;
  qa: ResearchQA;
  relationship_status: string | null;
  model: string;
  ai_provider?: string;
  searches: string[];
  search_provider: string;
  search_request_ids: string[];
  search_usage: {
    requests: number;
    estimated_cost_usd: number;
    latency_ms: number;
  };
  search_warnings: string[];
  review?: ProspectReview;
  batch_id?: string;
  batch_number?: number;
}
