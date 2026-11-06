/**
 * Personalization contract — output of the Personalization Agent (Agent 3).
 *
 * Two-model pipeline:
 *   Model 1 — Strategist  : reads the full research record + brief and produces a StrategyDossier
 *                           (who they are, why they matter, verified hooks, contact audit, angle, channel, CTA).
 *   Model 2 — Copywriter  : receives ONLY the strategy + campaign facts and writes the outreach copy.
 *
 * Zod schemas here are the single source of truth for both model contracts and the stored entry.
 */
import { z } from 'zod';

export const PERSONALIZATION_VERSION = '1.0' as const;

const nonEmpty = z.string().trim().min(1);

/* ------------------------------------------------------------------ */
/* Per-Lead Personalization Settings (individual prospect controls)    */
/* ------------------------------------------------------------------ */

export const LeadToneSchema = z.enum([
  'professional',
  'friendly',
  'conversational',
  'confident',
  'persuasive',
  'formal',
]);
export type LeadTone = z.infer<typeof LeadToneSchema>;

export const LeadMessageLengthSchema = z.enum([
  'very_short',
  'short',
  'balanced',
  'detailed',
]);
export type LeadMessageLength = z.infer<typeof LeadMessageLengthSchema>;

export const LeadPersonalizationDepthSchema = z.enum([
  'light',
  'moderate',
  'deep',
]);
export type LeadPersonalizationDepth = z.infer<typeof LeadPersonalizationDepthSchema>;

export const LeadCommunicationApproachSchema = z.enum([
  'relationship_first',
  'opportunity_first',
  'incentive_driven',
  'direct',
  'consultative',
]);
export type LeadCommunicationApproach = z.infer<typeof LeadCommunicationApproachSchema>;

export const LeadExplanationLevelSchema = z.enum([
  'minimal',
  'balanced',
  'detailed',
]);
export type LeadExplanationLevel = z.infer<typeof LeadExplanationLevelSchema>;

export const LeadCallToActionSchema = z.enum([
  'soft',
  'further_discussion',
  'specific_request',
  'direct',
]);
export type LeadCallToAction = z.infer<typeof LeadCallToActionSchema>;

export const LeadPersonalizationSettingsSchema = z.strictObject({
  tone: LeadToneSchema.default('professional'),
  message_length: LeadMessageLengthSchema.default('short'),
  personalization_depth: LeadPersonalizationDepthSchema.default('deep'),
  communication_approach: LeadCommunicationApproachSchema.default('incentive_driven'),
  explanation_level: LeadExplanationLevelSchema.default('balanced'),
  call_to_action: LeadCallToActionSchema.default('soft'),
  additional_instructions: z.string().trim().max(1_000).default(''),
  updated_at: z.string().nullable().optional().default(null),
});
export type LeadPersonalizationSettings = z.infer<typeof LeadPersonalizationSettingsSchema>;

export const LEAD_TONE_LABELS: Record<LeadTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  conversational: 'Conversational',
  confident: 'Confident',
  persuasive: 'Persuasive',
  formal: 'Formal',
};

export const LEAD_LENGTH_LABELS: Record<LeadMessageLength, string> = {
  very_short: 'Very Short',
  short: 'Short',
  balanced: 'Balanced',
  detailed: 'Detailed',
};

export const LEAD_DEPTH_LABELS: Record<LeadPersonalizationDepth, { label: string; description: string }> = {
  light: { label: 'Light', description: 'Mention one relevant detail' },
  moderate: { label: 'Moderate', description: 'Connect several relevant details to the opportunity' },
  deep: { label: 'Deep', description: 'Use strongest research for a highly individualised approach' },
};

export const LEAD_APPROACH_LABELS: Record<LeadCommunicationApproach, { label: string; description: string }> = {
  relationship_first: { label: 'Relationship-first', description: 'Establish a natural connection before introducing the opportunity' },
  opportunity_first: { label: 'Opportunity-first', description: 'Quickly introduce something valuable to the recipient' },
  incentive_driven: { label: 'Incentive-driven', description: 'Emphasise what the recipient could gain' },
  direct: { label: 'Direct', description: 'Get to the point with minimal introduction' },
  consultative: { label: 'Consultative', description: 'Present the opportunity as a relevant discussion' },
};

export const LEAD_EXPLANATION_LABELS: Record<LeadExplanationLevel, { label: string; description: string }> = {
  minimal: { label: 'Minimal', description: 'Explain only what is necessary' },
  balanced: { label: 'Balanced', description: 'Communicate the opportunity and its value clearly' },
  detailed: { label: 'Detailed', description: 'Provide additional context and explain thoroughly' },
};

export const LEAD_CTA_LABELS: Record<LeadCallToAction, { label: string; description: string }> = {
  soft: { label: 'Soft', description: 'Soft and low-pressure' },
  further_discussion: { label: 'Further Discussion', description: 'Invite further discussion' },
  specific_request: { label: 'Specific Request', description: 'Request a specific action' },
  direct: { label: 'Direct', description: 'Directly ask for participation' },
};

export interface LeadPersonalizationRecommendation {
  settings: LeadPersonalizationSettings;
  rationale: string;
  highlights: string[];
}

export function recommendLeadPersonalization(record?: {
  target_type?: string | null;
  role?: string | null;
  organisation?: string | null;
  summary?: string | null;
  reason_for_relevance?: string | null;
  work_and_projects?: string[] | null;
  achievements?: string[] | null;
  background?: string[] | null;
  industry_activity?: string[] | null;
  research_confidence?: string | null;
  public_contact?: Array<{ kind?: string; value?: string }> | null;
  key_contacts?: Array<{ name?: string; role?: string | null; email?: string | null }> | null;
  identity?: { name?: string | null; entity_kind?: string | null; identity_verified?: boolean } | null;
} | null): LeadPersonalizationRecommendation {
  if (!record) {
    return {
      settings: LeadPersonalizationSettingsSchema.parse({}),
      rationale: 'Balanced professional defaults selected.',
      highlights: ['Standard profile defaults'],
    };
  }

  const name = record.identity?.name || record.organisation || 'this prospect';
  const targetHaystack = `${record.target_type ?? ''} ${record.role ?? ''} ${record.organisation ?? ''} ${record.summary ?? ''}`.toLowerCase();
  const isOrg = record.identity?.entity_kind === 'organisation';
  const worksCount = (record.work_and_projects?.length ?? 0) + (record.achievements?.length ?? 0);
  const totalFacts =
    worksCount + (record.background?.length ?? 0) + (record.industry_activity?.length ?? 0);
  const topFact =
    record.work_and_projects?.[0] ||
    record.achievements?.[0] ||
    record.industry_activity?.[0] ||
    null;
  const shortenedFact = topFact
    ? topFact.length > 65
      ? `${topFact.slice(0, 62).trim()}…`
      : topFact
    : null;

  const isSparse = record.research_confidence === 'low' || totalFacts === 0;
  const isRich = worksCount >= 2 || totalFacts >= 3;

  // 1. Individual Author / Writer / Creative
  if (/\b(?:author|writer|novelist|poet|illustrator|creator|artist|journalist|essayist)\b/.test(targetHaystack)) {
    const depth: LeadPersonalizationDepth = isSparse ? 'light' : 'deep';
    return {
      settings: {
        tone: 'friendly',
        message_length: 'short',
        personalization_depth: depth,
        communication_approach: 'relationship_first',
        explanation_level: 'balanced',
        call_to_action: 'soft',
        additional_instructions: '',
        updated_at: null,
      },
      rationale: `${name} is an author, so a warm, friendly message that connects to their writing and ends with a low-pressure invite works best.`,
      highlights: [
        'Author → Friendly tone',
        isSparse ? 'Limited research → Light depth' : 'Strong research → Deep depth',
        'Low-pressure ask',
      ],
    };
  }

  // 2. Corporate Sponsor / Funder / Foundation
  if (/\b(?:sponsor|sponsorship|corporate|foundation|grant|funder|investor|philanthrop|b-corp)\b/.test(targetHaystack)) {
    const depth: LeadPersonalizationDepth = isSparse ? 'light' : 'moderate';
    return {
      settings: {
        tone: 'professional',
        message_length: 'balanced',
        personalization_depth: depth,
        communication_approach: 'incentive_driven',
        explanation_level: 'balanced',
        call_to_action: 'further_discussion',
        additional_instructions: '',
        updated_at: null,
      },
      rationale: `${name} is a potential sponsor, so a professional message that focuses on what they gain and invites a quick chat works best.`,
      highlights: [
        'Sponsor → Professional tone',
        'Focus on what they gain',
        'Invite a quick chat',
      ],
    };
  }

  // 3. Senior Executive / Managing Director / Founder
  if (/\b(?:ceo|chief|managing director|president|vp|vice president|founder|chair|director general)\b/.test(targetHaystack)) {
    const depth: LeadPersonalizationDepth = isSparse ? 'light' : 'moderate';
    return {
      settings: {
        tone: 'confident',
        message_length: 'very_short',
        personalization_depth: depth,
        communication_approach: 'opportunity_first',
        explanation_level: 'minimal',
        call_to_action: 'soft',
        additional_instructions: '',
        updated_at: null,
      },
      rationale: `Busy decision-makers read fast, so a very short, confident message for ${name} that gets straight to the point works best.`,
      highlights: [
        'Executive → Very short',
        'Lead with the opportunity',
        'Low-pressure ask',
      ],
    };
  }

  // 4. Literary / Publishing / Industry Organisation
  if (isOrg) {
    const depth: LeadPersonalizationDepth = isSparse ? 'light' : 'moderate';
    return {
      settings: {
        tone: 'professional',
        message_length: 'short',
        personalization_depth: depth,
        communication_approach: 'incentive_driven',
        explanation_level: 'balanced',
        call_to_action: 'specific_request',
        additional_instructions: '',
        updated_at: null,
      },
      rationale: `${name} is an organisation, so a short, professional message that explains the benefit for their authors and asks for the right contact works best.`,
      highlights: [
        'Organisation → Professional tone',
        'Focus on author/member benefit',
        'Ask for the right contact',
      ],
    };
  }

  // 5. General Individual Professional / Editor / Partner
  const depth: LeadPersonalizationDepth = isSparse ? 'light' : isRich ? 'deep' : 'moderate';
  return {
    settings: {
      tone: 'professional',
      message_length: 'short',
      personalization_depth: depth,
      communication_approach: 'incentive_driven',
      explanation_level: 'balanced',
      call_to_action: 'soft',
      additional_instructions: '',
      updated_at: null,
    },
    rationale: `A short, professional message for ${name} that highlights what they gain and keeps the ask low-pressure.`,
    highlights: [
      'Professional tone',
      isSparse ? 'Limited research → Light depth' : 'Strong research → Deep depth',
      'Low-pressure ask',
    ],
  };
}

export function defaultLeadPersonalizationSettings(record?: Parameters<typeof recommendLeadPersonalization>[0]): LeadPersonalizationSettings {
  return recommendLeadPersonalization(record).settings;
}

/* ------------------------------------------------------------------ */
/* Project-Specific Category Outreach Templates                        */
/* ------------------------------------------------------------------ */

export const TemplateUsageModeSchema = z
  .string()
  .trim()
  .transform((val) => {
    const s = val.toLowerCase().replace(/[\s_-]+/g, '');
    if (s.includes('ignore') || s.includes('skip') || s.includes('original') || s.includes('none')) return 'ignore' as const;
    if (s.includes('inspir')) return 'inspiration' as const;
    if (s.includes('adapt') || s.includes('modify') || s.includes('restruct')) return 'adapt' as const;
    return 'use' as const;
  });
export type TemplateUsageMode = z.infer<typeof TemplateUsageModeSchema>;

export const TEMPLATE_USAGE_MODE_LABELS: Record<TemplateUsageMode, { label: string; description: string }> = {
  use: {
    label: 'Use template',
    description: 'Follow the category template structure and messaging while adding meaningful personalisation.',
  },
  adapt: {
    label: 'Adapt template',
    description: 'Reuse relevant sections, phrases, or messaging while restructuring the message to suit the prospect.',
  },
  inspiration: {
    label: 'Use as inspiration',
    description: 'Take the core positioning and objectives from the template but write a substantially different message.',
  },
  ignore: {
    label: 'Ignore template',
    description: 'Write an entirely original message when the template would produce an irrelevant, unnatural, or less effective result.',
  },
};

export const CategoryOutreachTemplateSchema = z.strictObject({
  target_id: z.string().trim().min(1),
  target_type: z.string().trim().min(1),
  subject_line: z.string().trim().max(300).default(''),
  body: z.string().trim().min(1).max(6_000),
  is_custom: z.boolean().optional().default(false),
  updated_at: z.string().nullable().optional().default(null),
});
export type CategoryOutreachTemplate = z.infer<typeof CategoryOutreachTemplateSchema>;

/* ------------------------------------------------------------------ */
/* Reviewer feedback memory (learned preferences for future drafts)    */
/* ------------------------------------------------------------------ */

/** How widely a piece of reviewer feedback should apply to future drafts. */
export const FeedbackScopeSchema = z.enum(['project', 'category', 'lead']);
export type FeedbackScope = z.infer<typeof FeedbackScopeSchema>;

export const FEEDBACK_SCOPE_LABELS: Record<FeedbackScope, { label: string; description: string }> = {
  project: { label: 'All future messages', description: 'Applies to every lead in this project.' },
  category: { label: 'This lead category', description: 'Applies to every lead in the same category.' },
  lead: { label: 'Only this lead', description: 'Applies only when writing to this prospect.' },
};

export const PersonalizationFeedbackSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  text: z.string().trim().min(2).max(1_000),
  scope: FeedbackScopeSchema.default('project'),
  record_id: z.string().trim().max(255).nullable().default(null),
  prospect_name: z.string().trim().max(200).nullable().default(null),
  target_type: z.string().trim().max(200).nullable().default(null),
  target_id: z.string().trim().max(200).nullable().default(null),
  created_at: z.string(),
});
export type PersonalizationFeedback = z.infer<typeof PersonalizationFeedbackSchema>;

/* ------------------------------------------------------------------ */
/* Campaign settings (human-provided, the only campaign facts allowed) */
/* ------------------------------------------------------------------ */

export const PersonalizationSettingsSchema = z.strictObject({
  sender_name: z.string().trim().max(120).default(''),
  sender_role: z.string().trim().max(120).default(''),
  organisation: z.string().trim().max(160).default(''),
  /** Verified facts the copywriter may state (deadlines, prizes, eligibility, links). Nothing else may be claimed. */
  campaign_facts: z.array(z.string().trim().min(1).max(400)).max(15).default([]),
  call_to_action_link: z.string().trim().max(500).nullable().default(null),
  signature: z.string().trim().max(500).nullable().default(null),
  /** Free-form extra guidance from the team (e.g. "UK spelling", "never mention fees"). */
  extra_guidance: z.string().trim().max(1_000).default(''),
  /** Individual per-lead personalization configurations indexed by record_id. */
  lead_settings: z.record(z.string(), LeadPersonalizationSettingsSchema).optional(),
  /** Project-specific category outreach templates indexed by target_id or normalized target_type. */
  category_templates: z.record(z.string(), CategoryOutreachTemplateSchema).optional(),
  /** Reviewer feedback the agent learns from for all future drafts (newest last). */
  feedback_memory: z.array(PersonalizationFeedbackSchema).max(200).optional(),
  updated_at: z.string().nullable().default(null),
});
export type PersonalizationSettings = z.infer<typeof PersonalizationSettingsSchema>;

/* ------------------------------------------------------------------ */
/* Contact Route Audit (Evaluates deliverability, real vs fake, best)  */
/* ------------------------------------------------------------------ */

export const ContactRouteVerdictSchema = z
  .string()
  .trim()
  .transform((val) => {
    const s = val.toLowerCase().replace(/[\s_-]+/g, '');
    if (s.includes('recommend') || s.includes('best') || s.includes('primary')) return 'recommended' as const;
    if (s.includes('backup') || s.includes('viable') || s.includes('secondary')) return 'viable_backup' as const;
    if (s.includes('gatekeeper') || s.includes('generic') || s.includes('role')) return 'generic_gatekeeper' as const;
    if (s.includes('notworth') || s.includes('low') || s.includes('skip')) return 'not_worth_it' as const;
    if (s.includes('fake') || s.includes('unusable') || s.includes('scraping') || s.includes('invalid')) return 'unusable_or_fake' as const;
    return 'viable_backup' as const;
  });

export const EmailStatusSchema = z
  .string()
  .trim()
  .transform((val) => {
    const s = val.toLowerCase().replace(/[\s_-]+/g, '');
    if (s.includes('verified') || s.includes('direct') || s.includes('real')) return 'verified_direct' as const;
    if (s.includes('generic') || s.includes('inbox') || s.includes('role') || s.includes('gatekeeper')) return 'generic_inbox' as const;
    if (s.includes('risky') || s.includes('unverified') || s.includes('doubt')) return 'unverified_risky' as const;
    if (s.includes('fake') || s.includes('scraping') || s.includes('whois') || s.includes('abuse')) return 'fake_or_scraping_artifact' as const;
    return 'not_available' as const;
  });

export const EvaluatedRouteSchema = z.strictObject({
  channel: z.string().trim(),
  value: z.string().trim(),
  verdict: ContactRouteVerdictSchema,
  quality_assessment: z.string().trim().describe('Why this route is direct, role-based, active, or a scraping artifact'),
  priority: z.coerce.number().default(3),
});

export const ContactAuditSchema = z.strictObject({
  best_channel: z.string().trim(),
  best_contact_target: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || 'No direct contact found')
    .describe('The exact email address, LinkedIn profile URL, or form URL to use'),
  why_best_route: z.string().trim().describe('In-depth explanation of why this specific channel and target is the highest converting and safest place to contact them'),
  is_direct_contact: z.boolean().default(false).describe('True if this reaches the prospect directly; false if it goes through a generic inbox/agent/gatekeeper'),
  email_status: EmailStatusSchema,
  backup_route: z.string().nullable().default(null).describe('Secondary fallback route (e.g. LinkedIn or contact form if email fails)'),
  evaluated_routes: z.array(EvaluatedRouteSchema).default([]),
});

export type ContactAudit = z.infer<typeof ContactAuditSchema>;
export type EvaluatedRoute = z.infer<typeof EvaluatedRouteSchema>;

/* ------------------------------------------------------------------ */
/* Model 1 — Strategist output                                         */
/* ------------------------------------------------------------------ */

export const HookSchema = z.strictObject({
  id: nonEmpty.describe('Short id, e.g. "H1".'),
  fact: nonEmpty.describe('The specific, verified fact from the research (title, award, programme, role...).'),
  evidence_quote: z.string().nullable().describe('Verbatim quote from the research evidence supporting the fact, if any.'),
  source_ids: z.array(z.string()).describe('Research source ids (e.g. "S1") that back this fact.'),
  why_it_resonates: nonEmpty.describe('Why mentioning this will make the prospect feel genuinely seen, tied to the campaign.'),
  strength: z.enum(['strong', 'moderate', 'weak']),
});

export const ToneRegisterSchema = z
  .string()
  .trim()
  .transform((val) => {
    const s = val.toLowerCase().replace(/[\s_-]+/g, '');
    if (s.includes('peer')) return 'peer' as const;
    if (s.includes('warm') || s.includes('prof')) return 'warm_professional' as const;
    if (s.includes('formal') || s.includes('corp')) return 'formal' as const;
    if (s.includes('enthus')) return 'enthusiastic' as const;
    return 'warm_professional' as const;
  });

export const RecommendedChannelSchema = z
  .string()
  .trim()
  .transform((val) => {
    const raw = val.toLowerCase().trim();
    const s = raw.replace(/[\s_-]+/g, '');
    if (s.includes('linkedin')) return 'linkedin' as const;
    if (s.includes('phone') || s.includes('call') || s.includes('tel')) return 'phone' as const;
    if (s.includes('email') || s.includes('mail')) return 'email' as const;
    if (s.includes('form') || s.includes('website')) return 'contact_form' as const;
    if (s.includes('instagram') || s.includes('insta')) return 'instagram' as const;
    if (s.includes('facebook') || s === 'fb') return 'facebook' as const;
    if (s.includes('twitter') || s === 'x' || /\bx\b/.test(raw) || s.includes('xcom')) return 'x' as const;
    if (s.includes('tiktok')) return 'tiktok' as const;
    if (s.includes('youtube')) return 'youtube' as const;
    if (s.includes('threads')) return 'threads' as const;
    if (s.includes('bluesky') || s.includes('bsky')) return 'bluesky' as const;
    if (s.includes('substack')) return 'substack' as const;
    if (s.includes('medium')) return 'medium' as const;
    if (s.includes('goodreads')) return 'goodreads' as const;
    return 'other' as const;
  });

export const PersonalizationConfidenceSchema = z
  .string()
  .trim()
  .transform((val) => {
    const s = val.toLowerCase();
    if (s.includes('high')) return 'high' as const;
    if (s.includes('low')) return 'low' as const;
    return 'medium' as const;
  });
export type PersonalizationConfidence = z.infer<typeof PersonalizationConfidenceSchema>;

export const StrategyDossierSchema = z.strictObject({
  readiness: z.enum(['ready', 'needs_more_research', 'not_recommended']),
  readiness_reason: nonEmpty,
  prospect_snapshot: nonEmpty.describe('1–2 sentences: who this person/organisation is, in plain English.'),
  recipient_priorities: z
    .string()
    .trim()
    .default('')
    .describe('What this recipient cares about professionally based on verified evidence, distinct from unverified assumptions.'),
  relevance_thesis: nonEmpty.describe('Why THIS prospect matters to THIS campaign — the genuine intersection.'),
  campaign_objective: nonEmpty.describe('Which campaign objective this outreach serves.'),
  outreach_goal: nonEmpty.describe('The single concrete thing we want from them (submit, share, partner, sponsor...).'),
  recipient_incentive: z
    .string()
    .trim()
    .default('')
    .describe('The main truthful benefit or value exchange for this specific recipient — what they stand to gain and why it is worth considering.'),
  potential_objections: z
    .array(z.string().trim())
    .default([])
    .describe('Practical considerations, uncertainties, or objections that might prevent this recipient from responding.'),
  narrative_approach: z
    .string()
    .trim()
    .default('')
    .describe('The natural flow and opening style chosen specifically for this prospect, objective, and channel — never a universal template.'),
  hooks: z.array(HookSchema).max(4),
  primary_hook_id: z.string().nullable(),
  angle: nonEmpty.describe('One sentence: the verified connection used and why it matters to the recipient.'),
  tone: z.strictObject({
    register: ToneRegisterSchema,
    guidance: nonEmpty,
  }),
  recommended_channel: RecommendedChannelSchema,
  channel_reason: nonEmpty,
  /** Deep audit of all available contact routes, deliverability, and real vs fake checks */
  contact_audit: ContactAuditSchema.nullable().default(null),
  call_to_action: z.string().trim().default('Would you like me to share a short overview?'),
  avoid: z.array(z.string().trim()).default([]),
  human_checks: z.array(z.string().trim()).default([]),
  confidence: PersonalizationConfidenceSchema.default('medium').describe(
    'High, medium or low, reflecting the quality of the supporting research and the strength of the personalisation.',
  ),
  template_usage_mode: TemplateUsageModeSchema.default('adapt').optional().describe(
    'How the Personalization Agent decided to use the category outreach template for this prospect: use, adapt, inspiration, or ignore.',
  ),
  template_usage_reason: z
    .string()
    .trim()
    .default('')
    .optional()
    .describe('Why this template usage mode was chosen for this specific prospect.'),
});
export type Hook = z.infer<typeof HookSchema>;
export type StrategyDossier = z.infer<typeof StrategyDossierSchema>;

/* ------------------------------------------------------------------ */
/* Model 2 — Copywriter output                                         */
/* ------------------------------------------------------------------ */

export const SubjectLineSchema = z.strictObject({
  text: nonEmpty,
  style: z
  .string()
  .trim()
  .transform((val) => {
    const s = val.toLowerCase();
    if (s.includes('direct')) return 'direct' as const;
    if (s.includes('curio')) return 'curiosity' as const;
    if (s.includes('val')) return 'value' as const;
    return 'direct' as const;
  }),
});

export const OutreachCopySchema = z.strictObject({
  subject_lines: z.array(SubjectLineSchema).min(1).max(3),
  email_body: nonEmpty.describe('Full email body starting with the greeting and ending with the sign-off.'),
  alternative_opening: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .describe('One meaningfully different opening (1–2 sentences) based on another valid angle when enough evidence exists, or null when only one honest angle is supported.'),
  linkedin_message: nonEmpty.describe('Short direct message / connection note, max 300 characters.'),
  follow_up_body: nonEmpty.describe('Short polite follow-up email to send 4–6 days later if no reply.'),
  hook_usage: nonEmpty.describe('One sentence explaining which hook was used and where.'),
});
export type SubjectLine = z.infer<typeof SubjectLineSchema>;
export type OutreachCopy = z.infer<typeof OutreachCopySchema>;

/* ------------------------------------------------------------------ */
/* Deterministic QA                                                    */
/* ------------------------------------------------------------------ */

export interface PersonalizationQAIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  field: 'strategy' | 'subject' | 'email' | 'linkedin' | 'follow_up' | 'general';
  message: string;
}

export interface PersonalizationQA {
  status: 'passed' | 'needs_review' | 'failed';
  /** 0–100, deterministic quality score based on the checks. */
  score: number;
  issues: PersonalizationQAIssue[];
  /** Hook ids whose facts were found in the research record text. */
  verified_hook_ids: string[];
}

/* ------------------------------------------------------------------ */
/* Stored entry                                                        */
/* ------------------------------------------------------------------ */

export const PersonalizationStatusSchema = z.enum(['draft', 'approved', 'rejected', 'needs_more_research', 'failed']);
export type PersonalizationStatus = z.infer<typeof PersonalizationStatusSchema>;

export interface PersonalizationDraftVersion {
  version: number;
  generated_at: string;
  copy: OutreachCopy;
  lead_settings?: LeadPersonalizationSettings | null;
}

export interface PersonalizationEntry {
  personalization_version: typeof PERSONALIZATION_VERSION;
  record_id: string;
  project_id: string;
  prospect_name: string;
  target_type: string;
  batch_id: string | null;
  batch_number: number | null;

  status: PersonalizationStatus;
  strategy: StrategyDossier | null;
  /** Current copy (may include human edits). */
  copy: OutreachCopy | null;
  /** The copy exactly as the AI produced it, kept for learning from human edits. */
  ai_copy: OutreachCopy | null;
  edited_by_human: boolean;
  qa: PersonalizationQA | null;
  /** How many automatic self-correction passes the copywriter needed. */
  auto_revisions: number;

  /** Individual per-lead personalization settings applied to generate this draft. */
  lead_settings?: LeadPersonalizationSettings | null;
  /** Previous draft versions preserved when regenerating with updated settings. */
  previous_versions?: PersonalizationDraftVersion[];

  models: { strategist: string; writer: string };
  timings_ms: { strategist: number; writer: number };
  generated_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewer_note: string | null;
  error: string | null;
  candidate_contacts?: {
    emails: string[];
    linkedin_urls: string[];
    websites: string[];
    phones: string[];
    social_profiles?: { platform: string; url: string }[];
  };
}

/* ------------------------------------------------------------------ */
/* Category Outreach Template Helpers                                  */
/* ------------------------------------------------------------------ */

export interface CategoryTemplateBriefInput {
  project: {
    name: string | null;
    description: string;
    primary_objective: string;
    secondary_objectives?: string[];
    success_metrics?: string[];
  };
  targets: Array<{
    id: string;
    target_type: string;
    entity_kind: 'person' | 'organisation' | 'either' | 'unknown';
    description: string;
    geography?: string[];
    qualification_criteria?: Array<{ text: string }>;
    priority?: string;
  }>;
  personalization?: {
    allowed?: string[];
    preferred_details?: string[];
    tone?: string[];
    avoid?: string[];
  };
  outreach?: {
    objectives?: string[];
    channels?: string[];
    tone?: string[];
  };
}

export function normalizeCategoryKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Automatically creates a pre-built, fully editable outreach template for a lead category
 * based on the project's brief, objectives, target audience, and outreach goals.
 */
export function buildDefaultCategoryTemplate(
  brief: CategoryTemplateBriefInput | null | undefined,
  target: {
    id: string;
    target_type: string;
    entity_kind?: 'person' | 'organisation' | 'either' | 'unknown';
    description?: string;
    qualification_criteria?: Array<{ text: string }>;
  },
  settings?: Partial<PersonalizationSettings> | null,
): CategoryOutreachTemplate {
  const clean = (s: string) => s.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/,\s*,/g, ',').trim();

  const projectName = clean(brief?.project?.name || settings?.organisation || 'our project');
  const projectDesc = clean(
    brief?.project?.description ||
      brief?.project?.primary_objective ||
      'a curated initiative connecting standout work with relevant audiences and partners',
  ).replace(/\.$/, '');
  const primaryObjective = clean(
    brief?.project?.primary_objective ||
      brief?.outreach?.objectives?.[0] ||
      'connect relevant participants with this opportunity',
  ).replace(/\.$/, '');
  const secondaryObjectives = (brief?.project?.secondary_objectives ?? []).map((o) => clean(o).replace(/\.$/, ''));
  const targetName = clean(target.target_type);
  const targetDesc = clean(target.description || targetName).replace(/\.$/, '');

  const senderSignoff =
    settings?.signature?.trim() ||
    [
      settings?.sender_name?.trim() || 'The Campaign Team',
      [settings?.sender_role?.trim(), settings?.organisation?.trim() || projectName].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join('\n');

  const linkClause = settings?.call_to_action_link ? ` (${settings.call_to_action_link})` : '';
  const confirmedFact = settings?.campaign_facts?.[0] ? clean(settings.campaign_facts[0]).replace(/\.$/, '') : '';

  const haystack = `${target.target_type} ${target.description ?? ''}`.toLowerCase();
  const isMayaProject = /\bmaya\b/i.test(`${projectName} ${projectDesc}`);
  const isAuthorOrCreative = /\b(?:author|writer|novelist|poet|illustrator|creator|artist|literary creator)\b/.test(
    haystack,
  ) && !/\b(?:sponsor|investor|funder)\b/.test(haystack);
  const isSponsorOrInvestor = /\b(?:sponsor|sponsorship|investor|funder|foundation|grant|funding|supporter)\b/.test(
    haystack,
  );
  const isCommunityOrOrg =
    target.entity_kind === 'organisation' ||
    /\b(?:communit|organisation|organization|publisher|universit|education|society|association|group|magazine|network|institution)\b/.test(
      haystack,
    );

  if (isMayaProject) {
    const mayaDisplayTitle = /awards/i.test(projectName) ? projectName : 'Maya Poetry Book Awards';
    const mayaSenderName = settings?.sender_name?.trim() || '[Name]';
    const subjectLine = isSponsorOrInvestor
      ? `Partnership & Sponsorship: ${mayaDisplayTitle}`
      : isCommunityOrOrg
        ? `Collaboration with ${mayaDisplayTitle} for ${targetName}`
        : `${mayaDisplayTitle}: Connecting around your poetry & writing`;

    const body = [
      `Hi [Name],`,
      `I came across [specific detail about their work or organisation] and thought there could be an interesting connection with the ${mayaDisplayTitle}.`,
      `Maya is an international poetry book competition for indie writers, self-published poets and books from small, truly independent presses. With £7,000 in prizes, including a £3,000 top prize, it offers authors an opportunity for recognition and greater visibility.`,
      `We're reaching out to explore [specific collaboration or request] because [personalised benefit or reason it could be valuable to them].`,
      `Next year's competition opens on 4 January 2027. You can find out more at https://poetrybookawards.co.uk.`,
      `Would you be open to exploring this further? We'd be happy to share more details.`,
      `Best,\n\n${mayaSenderName}\n\n${mayaDisplayTitle}`,
    ].join('\n\n');

    return {
      target_id: target.id,
      target_type: target.target_type,
      subject_line: subjectLine,
      body,
      is_custom: false,
      updated_at: null,
    };
  }

  if (isAuthorOrCreative) {
    const communityGoal =
      secondaryObjectives.find((o) => /community|awareness|author|submission/i.test(o)) ||
      primaryObjective;
    const subjectLine = `${projectName}: Connecting around your writing`;
    const body = [
      `Hi [Name],`,
      `I came across [specific detail about their work or organisation] and thought there could be an interesting connection with ${projectName}.`,
      `We are currently running ${projectName}, ${projectDesc.charAt(0).toLowerCase() + projectDesc.slice(1)}. Our focus with ${targetName.toLowerCase()} is to ${primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)}, while helping participating authors gain wider reader discovery, industry recognition, and connection to ${communityGoal.charAt(0).toLowerCase() + communityGoal.slice(1)}.${confirmedFact ? ` ${confirmedFact}.` : ''}`,
      `We're reaching out to explore [specific collaboration or request] because [personalised benefit or reason it could be valuable to them].`,
      `Would it be useful if I sent over a short one-page overview with the submission details and timeline${linkClause} so you can see if it is of interest?`,
      `Warmly,\n${senderSignoff}`,
    ].join('\n\n');

    return {
      target_id: target.id,
      target_type: target.target_type,
      subject_line: subjectLine,
      body,
      is_custom: false,
      updated_at: null,
    };
  }

  if (isSponsorOrInvestor) {
    const sponsorObjective =
      secondaryObjectives.find((o) => /sponsor|partner|investor|supporter/i.test(o)) ||
      brief?.outreach?.objectives?.find((o) => /sponsor|partner/i.test(o)) ||
      primaryObjective;
    const subjectLine = `Strategic sponsorship & partnership opportunity: ${projectName}`;
    const body = [
      `Hi [Name],`,
      `I came across [specific detail about their work or organisation] and thought there could be an interesting connection with ${projectName}.`,
      `${projectName} is ${projectDesc.charAt(0).toLowerCase() + projectDesc.slice(1)}. As we ${sponsorObjective.charAt(0).toLowerCase() + sponsorObjective.slice(1)}, we are partnering with a select group of sponsors and strategic supporters who want direct visibility and meaningful alignment with our community.${confirmedFact ? ` ${confirmedFact}.` : ''}`,
      `We're reaching out to explore [specific collaboration or request] because [personalised benefit or reason it could be valuable to them].`,
      `Would you be open to a brief conversation, or would it be helpful if I sent over our concise sponsorship overview${linkClause} first?`,
      `Best regards,\n${senderSignoff}`,
    ].join('\n\n');

    return {
      target_id: target.id,
      target_type: target.target_type,
      subject_line: subjectLine,
      body,
      is_custom: false,
      updated_at: null,
    };
  }

  if (isCommunityOrOrg) {
    const partnerObjective =
      secondaryObjectives.find((o) => /partner|community|awareness|database|network/i.test(o)) ||
      primaryObjective;
    const subjectLine = `Collaboration opportunity with ${projectName} for ${targetName}`;
    const body = [
      `Hi [Name],`,
      `I came across [specific detail about their work or organisation] and thought there could be an interesting connection with ${projectName}.`,
      `We are organising ${projectName}, ${projectDesc.charAt(0).toLowerCase() + projectDesc.slice(1)}. A core part of this initiative is working alongside respected ${targetName.toLowerCase()} to ${partnerObjective.charAt(0).toLowerCase() + partnerObjective.slice(1)}.${confirmedFact ? ` ${confirmedFact}.` : ''}`,
      `We're reaching out to explore [specific collaboration or request] because [personalised benefit or reason it could be valuable to them].`,
      `Could you let me know if I may share a short partner overview${linkClause}, or point me to the best person on your team who handles community partnerships?`,
      `Best regards,\n${senderSignoff}`,
    ].join('\n\n');

    return {
      target_id: target.id,
      target_type: target.target_type,
      subject_line: subjectLine,
      body,
      is_custom: false,
      updated_at: null,
    };
  }

  // General fallback for any other lead category
  const subjectLine = `${projectName}: Opportunity for ${targetName}`;
  const body = [
    `Hi [Name],`,
    `I came across [specific detail about their work or organisation] and thought there could be an interesting connection with ${projectName}.`,
    `${projectName} is ${projectDesc.charAt(0).toLowerCase() + projectDesc.slice(1)}, with the primary goal to ${primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)}.${confirmedFact ? ` ${confirmedFact}.` : ''}`,
    `We're reaching out to explore [specific collaboration or request] because [personalised benefit or reason it could be valuable to them].`,
    `Would it be useful if I shared a short one-page overview${linkClause} so you can see if it fits your priorities?`,
    `Best regards,\n${senderSignoff}`,
  ].join('\n\n');

  return {
    target_id: target.id,
    target_type: target.target_type,
    subject_line: subjectLine,
    body,
    is_custom: false,
    updated_at: null,
  };
}

/**
 * Dynamically returns all lead categories from the project's configuration (`brief.targets`)
 * paired with their current template (saved custom template if edited, otherwise the pre-built default).
 */
export function getProjectCategoryTemplates(
  brief: CategoryTemplateBriefInput | null | undefined,
  settings?: Partial<PersonalizationSettings> | null,
): CategoryOutreachTemplate[] {
  if (!brief?.targets?.length) return [];
  const savedMap = settings?.category_templates ?? {};

  return brief.targets.map((target) => {
    const byId = savedMap[target.id];
    const byNormType = savedMap[normalizeCategoryKey(target.target_type)];
    const byRawType = savedMap[target.target_type];
    const saved = byId ?? byNormType ?? byRawType;

    if (saved && saved.body.trim().length > 0 && !/i came across/i.test(saved.body)) {
      return {
        ...saved,
        target_id: target.id,
        target_type: target.target_type,
        is_custom: true,
      };
    }

    return buildDefaultCategoryTemplate(brief, target, settings);
  });
}

/**
 * Identifies a prospect's lead category and retrieves the corresponding project-specific template.
 */
export function resolveCategoryTemplateForProspect(
  record: {
    brief_target_id?: string | null;
    target_type?: string | null;
    role?: string | null;
    organisation?: string | null;
    identity?: { entity_kind?: string | null } | null;
  },
  brief: CategoryTemplateBriefInput | null | undefined,
  settings?: Partial<PersonalizationSettings> | null,
): {
  template: CategoryOutreachTemplate;
  target: CategoryTemplateBriefInput['targets'][number] | null;
  isCustom: boolean;
} | null {
  const savedMap = settings?.category_templates ?? {};
  const targets = brief?.targets ?? [];
  const recTargetId = record.brief_target_id?.trim() || '';
  const recTargetType = record.target_type?.trim() || '';
  const normRecType = normalizeCategoryKey(recTargetType);

  // 1. Match target in brief.targets by id, exact/normalized target_type, or token overlap
  let matchedTarget =
    (recTargetId ? targets.find((t) => t.id === recTargetId) : undefined) ??
    (normRecType
      ? targets.find((t) => normalizeCategoryKey(t.target_type) === normRecType)
      : undefined);

  if (!matchedTarget && normRecType) {
    const recTokens = normRecType.split('-').filter((w) => w.length >= 3);
    matchedTarget = targets.find((t) => {
      const tNorm = normalizeCategoryKey(t.target_type);
      if (tNorm.includes(normRecType) || normRecType.includes(tNorm)) return true;
      return recTokens.some((tok) => {
        const stem = tok.replace(/s$/, '');
        return stem.length >= 4 && tNorm.includes(stem);
      });
    });
  }

  // 2. Check saved custom templates first (by matchedTarget.id, recTargetId, or normalized target_type)
  const candidateKeys = [
    matchedTarget?.id,
    recTargetId,
    matchedTarget ? normalizeCategoryKey(matchedTarget.target_type) : undefined,
    matchedTarget?.target_type,
    normRecType,
    recTargetType,
  ].filter((k): k is string => Boolean(k && k.trim()));

  for (const key of candidateKeys) {
    const saved = savedMap[key];
    if (saved && saved.body.trim().length > 0 && !/i came across/i.test(saved.body)) {
      return {
        template: {
          ...saved,
          target_id: matchedTarget?.id || saved.target_id,
          target_type: matchedTarget?.target_type || saved.target_type,
          is_custom: true,
        },
        target: matchedTarget ?? null,
        isCustom: true,
      };
    }
  }

  // Also check if any saved template's target_type matches the prospect's target_type via token stem
  if (normRecType) {
    const recTokens = normRecType.split('-').filter((w) => w.length >= 3);
    for (const saved of Object.values(savedMap)) {
      if (!saved?.body?.trim() || /i came across/i.test(saved.body)) continue;
      const savedNorm = normalizeCategoryKey(saved.target_type);
      const isMatch =
        savedNorm === normRecType ||
        savedNorm.includes(normRecType) ||
        normRecType.includes(savedNorm) ||
        recTokens.some((tok) => {
          const stem = tok.replace(/s$/, '');
          return stem.length >= 4 && savedNorm.includes(stem);
        });
      if (isMatch) {
        return {
          template: { ...saved, is_custom: true },
          target: matchedTarget ?? null,
          isCustom: true,
        };
      }
    }
  }

  // 3. If no custom saved template exists, build the default template for the matched target category
  if (matchedTarget && brief) {
    const defaultTpl = buildDefaultCategoryTemplate(brief, matchedTarget, settings);
    if (defaultTpl && !/i came across/i.test(defaultTpl.body)) {
      return {
        template: defaultTpl,
        target: matchedTarget,
        isCustom: false,
      };
    }
  }

  return null;
}

/**
 * Evaluates a prospect's research, background, interests, and project connection against
 * their category outreach template and decides whether to:
 * - 'use': Follow the template's structure and messaging while adding meaningful personalisation.
 * - 'adapt': Reuse relevant sections, phrases, or messaging while restructuring the message to suit the prospect.
 * - 'inspiration': Take the core positioning and objectives from the template but write a substantially different message.
 * - 'ignore': Write an entirely original message when the template would produce an irrelevant, unnatural, or less effective result.
 */
export function decideTemplateUsageMode(
  record: {
    target_type?: string | null;
    role?: string | null;
    organisation?: string | null;
    summary?: string | null;
    reason_for_relevance?: string | null;
    work_and_projects?: string[] | null;
    achievements?: string[] | null;
    background?: string[] | null;
    industry_activity?: string[] | null;
    contradictions?: string[] | null;
    research_confidence?: string | null;
    identity?: { name?: string | null; entity_kind?: string | null } | null;
  },
  brief: CategoryTemplateBriefInput | null | undefined,
  template: CategoryOutreachTemplate | null | undefined,
  leadSettings?: LeadPersonalizationSettings | null,
): { mode: TemplateUsageMode; reason: string } {
  if (!template || !template.body || template.body.trim().length < 20) {
    return {
      mode: 'ignore',
      reason: 'No category template available for this lead category; generating an original message from the project brief and prospect research.',
    };
  }

  const prospectName = record.identity?.name || record.organisation || 'this prospect';
  const extraInstr = (leadSettings?.additional_instructions ?? '').toLowerCase();
  const summaryAndRelevance = `${record.summary ?? ''} ${record.reason_for_relevance ?? ''} ${(record.contradictions ?? []).join(' ')}`.toLowerCase();
  const templateText = `${template.subject_line} ${template.body}`.toLowerCase();

  // 1. Check when the template should be IGNORED ('ignore'):
  // - Explicit user instruction to ignore template / write from scratch
  // - Prohibitive constraints indicating the standard category pitch is off-limits (e.g. paused submissions / no sponsorship)
  // - Severe mismatch between what the template pitches and the prospect's actual profile/remit
  if (
    /\b(?:ignore template|do not use template|original message|bespoke angle|custom pitch only)\b/i.test(extraInstr)
  ) {
    return {
      mode: 'ignore',
      reason: `Ignoring the ${template.target_type} template because per-lead instructions request a bespoke original message for ${prospectName}.`,
    };
  }

  const explicitlyFollowsTemplate = /\b(?:follow (?:the )?template|use (?:the )?template|match (?:the )?template|stick to (?:the )?template)\b/i.test(extraInstr);

  if (
    !explicitlyFollowsTemplate &&
    /\b(?:no longer accepts|paused submissions|paused sponsorship|closed to unsolicited|does not sponsor|retired from|conflict with standard)\b/i.test(
      summaryAndRelevance,
    )
  ) {
    return {
      mode: 'ignore',
      reason: `Ignoring the standard ${template.target_type} template because ${prospectName}'s research contains constraints indicating the standard category framing is unsuitable.`,
    };
  }

  // Check if the template pitches an unrelated category angle (e.g. template talks exclusively about book submissions to a corporate sponsor, or vice versa)
  const recordHaystack = `${record.target_type ?? ''} ${record.role ?? ''} ${record.summary ?? ''}`.toLowerCase();
  const templatePitchesSponsorshipOnly =
    /\b(?:sponsorship package|sponsor tier|financial sponsor|brand sponsorship)\b/i.test(templateText) &&
    !/\b(?:author|submission|book|community)\b/i.test(templateText);
  const prospectIsPureAuthor =
    /\b(?:poet|novelist|author|writer)\b/i.test(recordHaystack) &&
    !/\b(?:sponsor|funder|foundation|investor|director)\b/i.test(recordHaystack);
  if (templatePitchesSponsorshipOnly && prospectIsPureAuthor) {
    return {
      mode: 'ignore',
      reason: `Ignoring the template because its sponsorship-only framing does not fit ${prospectName}'s profile as an individual author/writer.`,
    };
  }

  // 2. Check when the template should be used as INSPIRATION ('inspiration'):
  // - Explicit request via additional instructions
  // - High-profile executive / CEO sponsor with very_short length preference where a multi-paragraph template structure is inappropriate for an executive
  const isSponsorTarget = /\b(?:sponsor|sponsorship|funder|foundation|investor|corporate)\b/i.test(recordHaystack);
  const isPartnerTarget = /\b(?:partner|partnership|director|commercial|enterprise)\b/i.test(recordHaystack);
  const isExecutiveSponsor =
    (isSponsorTarget || isPartnerTarget) &&
    (leadSettings?.message_length === 'very_short' ||
      /\b(?:ceo|founder|managing director|partner|president)\b/i.test(record.role || ''));
  if (
    /\b(?:inspiration only|use as inspiration|inspiration mode)\b/i.test(extraInstr) ||
    (isExecutiveSponsor && leadSettings?.message_length === 'very_short')
  ) {
    return {
      mode: 'inspiration',
      reason: `Using the ${template.target_type} template as inspiration: keeping its core positioning while drafting an alternative concise structure for ${prospectName}.`,
    };
  }

  // 3. Category templates define the intended messaging, structure, positioning, and purpose.
  // The agent follows the configured template as its default structure (90%+ of the time):
  // - ADAPT ('adapt'): Multi-work research (>= 2 works or >= 4 facts), very short length preferences, or rich contextual depth
  //   where the narrative weaved around multiple verified works while preserving key template facts and flow.
  // - USE ('use'): Follow the template's structure directly, fulfilling every placeholder with verified research.
  const worksCount = (record.work_and_projects?.length ?? 0) + (record.achievements?.length ?? 0);
  const totalFacts =
    worksCount + (record.background?.length ?? 0) + (record.industry_activity?.length ?? 0);

  if (worksCount >= 2 || totalFacts >= 4 || leadSettings?.message_length === 'very_short') {
    return {
      mode: 'adapt',
      reason: `Adapting the ${template.target_type} template for ${prospectName}: following its intended flow, key messaging, and facts while weaving in their verified work (${record.work_and_projects?.[0] || record.achievements?.[0] || 'key initiatives'}).`,
    };
  }

  return {
    mode: 'use',
    reason: `Following the ${template.target_type} template as the structural framework for ${prospectName}, fulfilling each placeholder with verified details (${record.work_and_projects?.[0] || record.organisation || record.role || 'their profile'}) and a tailored value exchange.`,
  };
}

/* ------------------------------------------------------------------ */
/* Contextual Directive Understanding ([...] and (...) Cues)           */
/* ------------------------------------------------------------------ */

export interface ContextualTemplateValues {
  recipientFirstName: string;
  senderName: string;
  verifiedWorkDetail: string;
  secondaryWorkDetail: string;
  specificCollaborationRequest: string;
  personalisedBenefitClause: string;
  categoryOutreachObjective?: string;
  tailoredSubjectLines?: {
    direct: string;
    curiosity: string;
    value: string;
  };
}

export interface ParsedTemplateDirective {
  rawToken: string;
  innerText: string;
  kind:
    | 'recipient_name'
    | 'sender_name'
    | 'verified_work_detail'
    | 'specific_collaboration_or_request'
    | 'personalised_benefit'
    | 'competition_name'
    | 'prize_details'
    | 'dates_or_deadline'
    | 'website_or_link'
    | 'custom_contextual_cue';
  resolvedValue: string;
  explanation: string;
  concreteGuidance: string;
}

function formatWorkFactAsNaturalNounPhrase(
  rawFact: string,
  organisation?: string | null,
  role?: string | null,
): string {
  let cleaned = rawFact
    // Remove trailing or inline source citations like (S1), (S2,S4,S5)
    .replace(/\s*\(S\d+(?:\s*,\s*S\d+)*\)\.?\s*/gi, ' ')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\*+/g, '')
    .replace(/\.$/, '')
    .trim();
  // If multi-sentence scraped paragraph, take the first sentence
  if (cleaned.includes('. ')) {
    cleaned = cleaned.split(/\.\s+/)[0]!.trim();
  }
  // If still very long (> 85 chars), trim to the first clean clause under 75 chars
  if (cleaned.length > 85) {
    const commaSplit = cleaned.split(/,\s*/);
    if (commaSplit[0] && commaSplit[0].length >= 25 && commaSplit[0].length <= 80) {
      cleaned = commaSplit[0].trim();
    } else {
      const trimmed = cleaned.slice(0, 75);
      const lastSp = trimmed.lastIndexOf(' ');
      cleaned = (lastSp > 20 ? trimmed.slice(0, lastSp) : trimmed).trim();
    }
  }

  if (
    !cleaned ||
    /^(?:no evidence|no legitimate|all required criteria|unverified|none|n\/a|unknown)\b/i.test(cleaned)
  ) {
    if (role && /\b(?:author|writer|novelist|poet)\b/i.test(role)) {
      return `your writing as a ${role.toLowerCase()}`;
    }
    if (organisation) {
      return `your work at ${organisation}`;
    }
    if (role) {
      return `your work as ${role}`;
    }
    return 'your writing and published work';
  }

  // If the string is a semicolon-separated list of titles (e.g. "Thrown for a Loop; The New Guy; Him; Brooklynaire")
  const semiParts = cleaned.split(/\s*;\s*/).filter(Boolean);
  if (semiParts.length >= 2) {
    const looksLikeTitleList =
      semiParts.length >= 3 &&
      semiParts.slice(0, 3).every((p) => p.split(/\s+/).length <= 7 && !/^(?:teaches|offers|runs|founded)/i.test(p));
    if (looksLikeTitleList) {
      cleaned = `books including ${semiParts.slice(0, 2).join(' and ')}`;
    } else {
      cleaned = semiParts[0]!;
    }
  }

  // If a colon introduces a long comma-separated list of titles (e.g. "Author of ten novels: Joyride, Divorce Towers, Take My Husband...")
  const colonMatch = cleaned.match(/^([^:]{3,50}):\s*(.+)$/);
  if (colonMatch) {
    const prefix = colonMatch[1]!.trim();
    const items = colonMatch[2]!
      .split(/\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length >= 3) {
      cleaned = `${prefix}, including ${items.slice(0, 2).join(' and ')}`;
    }
  }

  // If a comma-separated list is still very long (> 120 chars and 4+ commas), trim to first 2-3 items
  if (cleaned.length > 120) {
    const commaParts = cleaned.split(/\s*,\s*/).filter(Boolean);
    if (commaParts.length >= 4) {
      cleaned = `${commaParts.slice(0, 2).join(', ')} and ${commaParts[2]}`;
    }
  }

  // Convert leading past/present action verbs or role prefixes into natural possessive noun phrases
  const verbConversions: Array<[RegExp, string]> = [
    [/^author\s+of\s+/i, 'your work as author of '],
    [/^founder\s+and\s+host\s+of\s+/i, 'your work as founder and host of '],
    [/^founder\s+of\s+/i, 'your work as founder of '],
    [/^published\s+books\s*[,:]\s*/i, 'your published books, '],
    [/^published\s+(?:the\s+)?/i, 'your published work, '],
    [/^authored\s+(?:the\s+)?/i, 'your work on '],
    [/^wrote\s+(?:the\s+)?/i, 'your writing on '],
    [/^writes\s+for\s+/i, 'your writing for '],
    [/^co-edited\s+(?:the\s+)?/i, 'your editorial work on '],
    [/^edited\s+(?:the\s+)?/i, 'your editorial work on '],
    [/^organi[sz]es\s+(?:the\s+)?/i, 'your work organising the '],
    [/^runs\s+(?:the\s+)?/i, 'your work running the '],
    [/^hosts\s+(?:the\s+)?/i, 'your work hosting the '],
    [/^publishes\s+(?:the\s+)?/i, 'your publishing work with the '],
    [/^funded\s+(?:the\s+)?/i, 'your support for the '],
    [/^sponsored\s+(?:the\s+)?/i, 'your sponsorship of the '],
    [/^partnered\s+with\s+(?:the\s+)?/i, 'your partnership with the '],
    [/^launched\s+(?:the\s+)?/i, 'your launch of the '],
    [/^won\s+(?:the\s+)?/i, 'your recognition with the '],
    [/^shortlisted\s+for\s+(?:the\s+)?/i, 'your shortlisted work for the '],
    [/^selected\s+for\s+(?:the\s+)?/i, 'your selection for the '],
    [/^nominated\s+for\s+(?:the\s+)?/i, 'your nomination for the '],
    [/^judged\s+(?:competitions\s+such\s+as\s+)?/i, 'your judging of competitions including '],
    [/^judges\s+(?:competitions\s+such\s+as\s+)?/i, 'your judging of competitions including '],
    [/^imprints\s+include\s+/i, 'your publishing work across imprints including '],
    [/^facilitates\s+/i, 'your work facilitating '],
    [/^provides\s+/i, 'your work providing '],
  ];

  for (const [pattern, replacement] of verbConversions) {
    if (pattern.test(cleaned)) {
      const converted = cleaned.replace(pattern, replacement);
      return organisation && !converted.toLowerCase().includes(organisation.toLowerCase())
        ? `${converted} at ${organisation}`
        : converted;
    }
  }

  if (/^your\b/i.test(cleaned)) return cleaned;
  return `your work on ${cleaned}${
    organisation && !cleaned.toLowerCase().includes(organisation.toLowerCase())
      ? ` at ${organisation}`
      : ''
  }`;
}

/**
 * Synthesizes context-aware values for bracketed `[...]` or parenthetical `(...)` cues
 * based on the prospect's verified research, category, and the project brief/template.
 */
export function buildContextualTemplateValues(
  record: {
    target_type?: string | null;
    role?: string | null;
    organisation?: string | null;
    summary?: string | null;
    reason_for_relevance?: string | null;
    work_and_projects?: string[] | null;
    achievements?: string[] | null;
    industry_activity?: string[] | null;
    key_contacts?: Array<{ name?: string | null }> | null;
    identity?: { name?: string | null; entity_kind?: string | null } | null;
  },
  brief?: CategoryTemplateBriefInput | null,
  settings?: Partial<PersonalizationSettings> | null,
  template?: CategoryOutreachTemplate | null,
): ContextualTemplateValues {
  const strip = (s: string) => s.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\*+/g, '').trim();
  const prospectName = strip(record.identity?.name || record.organisation || 'there');
  const isOrg = record.identity?.entity_kind === 'organisation';
  const keyPersonFirst = record.key_contacts?.[0]?.name?.trim().split(/\s+/)[0];
  const recipientFirstName = isOrg
    ? keyPersonFirst || `${prospectName} team`
    : prospectName
        .replace(/^(?:dr|prof|mr|ms|mrs|miss)\.?\s+/i, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
        .split(/\s+/)[0] || prospectName;

  const senderName = strip(
    settings?.sender_name?.trim() ||
      settings?.signature?.trim().split(/\r?\n/)[0] ||
      'The Campaign Team',
  );

  const rawWork1 =
    record.work_and_projects?.[0] ||
    record.achievements?.[0] ||
    record.industry_activity?.[0] ||
    record.reason_for_relevance ||
    '';
  const rawWork2 =
    record.work_and_projects?.[1] ||
    record.achievements?.[0] ||
    record.industry_activity?.[0] ||
    '';

  const verifiedWorkDetail = formatWorkFactAsNaturalNounPhrase(
    rawWork1,
    record.organisation,
    record.role,
  );
  const secondaryWorkDetail =
    rawWork2 && rawWork2 !== rawWork1
      ? formatWorkFactAsNaturalNounPhrase(rawWork2, record.organisation, record.role)
      : '';

  const projectName = strip(brief?.project?.name || settings?.organisation || 'our project');
  const primaryObjective = strip(
    brief?.project?.primary_objective ||
      brief?.outreach?.objectives?.[0] ||
      'connect relevant participants with this opportunity',
  ).replace(/\.$/, '');
  const confirmedFact = settings?.campaign_facts?.[0]
    ? strip(settings.campaign_facts[0]).replace(/\.$/, '')
    : '';

  const templateText = `${template?.subject_line ?? ''} ${template?.body ?? ''}`.toLowerCase();
  const hasMayaPrizes =
    templateText.includes('£7,000') ||
    templateText.includes('£3,000') ||
    /\bmaya\b/i.test(projectName);

  const haystack = `${record.target_type ?? ''} ${template?.target_type ?? ''} ${record.role ?? ''} ${record.organisation ?? ''}`.toLowerCase();
  const isAuthor =
    /\b(?:author|writer|novelist|poet)\b/.test(haystack) &&
    !/\b(?:sponsor|investor|funder|foundation)\b/.test(haystack);
  const isSponsor = /\b(?:sponsor|sponsorship|investor|funder|foundation|grant|patron|supporter)\b/.test(
    haystack,
  );
  const isPublisher = /\b(?:publisher|press|bookseller|magazine|journal)\b/.test(haystack);
  const isUniversity = /\b(?:universit|education|faculty|department|student|college|mfa)\b/.test(
    haystack,
  );
  const isCreator = /\b(?:creator|influencer|booktok|bookstagram|podcast)\b/.test(haystack);
  const isCommunityOrOrg =
    isOrg || /\b(?:communit|organisation|organization|society|association|group|collective|trust|network)\b/.test(haystack);

  const orgOrName = strip(record.organisation || prospectName);

  let specificCollaborationRequest = '';
  let personalisedBenefitClause = '';
  let categoryOutreachObjective = '';

  if (isAuthor) {
    categoryOutreachObjective = 'inviting poetry collection submissions and celebrating indie poets';
    specificCollaborationRequest = `entering your collection in the upcoming ${projectName}`;
    personalisedBenefitClause = hasMayaPrizes
      ? `it gives independent poets a respected international platform to compete for the £7,000 prize fund (including a £3,000 top prize), build wider reader discovery and reviews around ${verifiedWorkDetail}, and celebrate indie writing without unfair entry barriers`
      : `it connects ${verifiedWorkDetail} with wider reader discovery, industry recognition, and ${confirmedFact || primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)}`;
  } else if (isSponsor) {
    categoryOutreachObjective = 'establishing an aligned sponsorship and patronage partnership';
    specificCollaborationRequest = `a sponsorship or patronage partnership with ${orgOrName} for ${projectName}`;
    personalisedBenefitClause = hasMayaPrizes
      ? `it gives ${orgOrName} prominent brand alignment and year-round visibility across an international community of indie poets, small presses, and literary readers that shares the values behind ${verifiedWorkDetail}, without requiring complicated administration`
      : `it provides ${orgOrName} with direct brand visibility and meaningful alignment alongside vetted participants in ${projectName}, building on ${verifiedWorkDetail}`;
  } else if (isPublisher) {
    categoryOutreachObjective = 'collaborating with an independent press to spotlight eligible titles';
    specificCollaborationRequest = `an independent publishing collaboration to showcase eligible titles and poets from ${orgOrName}`;
    personalisedBenefitClause = hasMayaPrizes
      ? `it gives poets and titles published through ${orgOrName} access to £7,000 in prizes, international reader discovery, and wider recognition for your list alongside ${verifiedWorkDetail}`
      : `it spotlights titles and talent from ${orgOrName} around ${verifiedWorkDetail} while ${confirmedFact || primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)}`;
  } else if (isUniversity) {
    categoryOutreachObjective = 'sharing the competition with creative writing students, poets, and alumni';
    specificCollaborationRequest = `sharing ${projectName} with the creative writing students, alumni, and poets at ${orgOrName}`;
    personalisedBenefitClause = hasMayaPrizes
      ? `it gives emerging poets and alumni connected to ${verifiedWorkDetail} at ${orgOrName} an accessible international platform with £7,000 in prizes and publication visibility`
      : `it gives writers and students connected to ${verifiedWorkDetail} at ${orgOrName} a practical pathway for recognition and community connection`;
  } else if (isCreator) {
    categoryOutreachObjective = 'collaborating with a literary creator or reviewer to spotlight indie poets';
    specificCollaborationRequest = `a creator collaboration spotlighting standout titles and stories from ${projectName} with your audience`;
    personalisedBenefitClause = `it gives your audience around ${verifiedWorkDetail} engaging literary stories, shortlisted title previews, and reciprocal visibility across ${projectName}`;
  } else if (isCommunityOrOrg) {
    categoryOutreachObjective = 'collaborating with a literary community or organisation to support member writers';
    specificCollaborationRequest = `a community partnership to share ${projectName} with your writers and members at ${orgOrName}`;
    personalisedBenefitClause = hasMayaPrizes
      ? `it gives the poets and writers connected to ${verifiedWorkDetail} a valuable opportunity to compete for £7,000 in prizes and gain wider visibility, while we also spotlight ${orgOrName} as a partner organisation`
      : `it offers members and participants connected to ${verifiedWorkDetail} a curated opportunity and wider visibility (${confirmedFact || primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)}), while spotlighting ${orgOrName}`;
  } else {
    categoryOutreachObjective = `collaborating around ${verifiedWorkDetail}`;
    specificCollaborationRequest = `how ${orgOrName} and ${projectName} could collaborate around ${verifiedWorkDetail}`;
    personalisedBenefitClause = `it connects ${verifiedWorkDetail} directly with ${confirmedFact || primaryObjective.charAt(0).toLowerCase() + primaryObjective.slice(1)} and offers clear visibility and value for ${orgOrName}`;
  }

  // Pre-calculate tailored subject line interpretations adapting the category reference subject line
  const cleanWorkShort = verifiedWorkDetail.replace(/^your (?:work (?:on|at|as)|writing|published work)\s+/i, '').slice(0, 26);
  const tailoredSubjectLines = {
    direct: strip(
      isSponsor
        ? `${projectName} & ${orgOrName}: Sponsorship partnership`
        : isCommunityOrOrg || isPublisher
          ? `${projectName} & ${orgOrName}: Collaboration for your writers`
          : `${projectName}: Submitting ${cleanWorkShort ? `'${cleanWorkShort}'` : 'your collection'}`
    ).slice(0, 58),
    curiosity: strip(
      isSponsor
        ? `Supporting indie poetry: Sponsorship with ${projectName}`
        : isCommunityOrOrg || isPublisher
          ? `Connecting around indie poetry with ${orgOrName}`
          : `Question for ${recipientFirstName} regarding your poetry & ${projectName}`
    ).slice(0, 58),
    value: strip(
      hasMayaPrizes
        ? (isSponsor
            ? `Sponsorship with ${projectName}: Supporting indie poets`
            : isCommunityOrOrg || isPublisher
              ? `£7,000 ${projectName}: Opportunity for ${orgOrName} poets`
              : `£7,000 ${projectName}: Opportunity for your collection`)
        : `${projectName}: Relevant opportunity for ${isOrg ? orgOrName : recipientFirstName}`
    ).slice(0, 58),
  };

  return {
    recipientFirstName,
    senderName,
    verifiedWorkDetail,
    secondaryWorkDetail,
    specificCollaborationRequest,
    personalisedBenefitClause,
    categoryOutreachObjective,
    tailoredSubjectLines,
  };
}

const INSTRUCTIONAL_PAREN_KEYWORDS =
  /\b(?:specific|personalised|personalized|custom|tailored|individual|insert|mention|reference|explain|describe|highlight|detail\s+about|reason\s+it|benefit|collaboration\s+or\s+request|their\s+work|their\s+organisation|their\s+organization|their\s+role|their\s+book|their\s+audience|prospect|recipient|lead|sender\s+name|first\s+name|placeholder|value\s+for\s+them|why\s+it\s+matters)\b/i;

function classifyDirectiveInnerText(
  innerText: string,
  offsetInText: number,
  fullTextLength: number,
  values: ContextualTemplateValues,
): {
  kind: ParsedTemplateDirective['kind'];
  resolvedValue: string;
  explanation: string;
} {
  const lower = innerText.toLowerCase().trim();

  // 1. Name cue ([Name], [First Name], [Sender Name], etc.)
  if (/^(?:your\s+name|sender(?:\s+name)?|my\s+name|sign[\s-]?off\s+name)$/i.test(lower)) {
    return {
      kind: 'sender_name',
      resolvedValue: values.senderName,
      explanation: `Sender's name (${values.senderName})`,
    };
  }
  if (/^(?:recipient(?:\s+name)?|first\s+name|prospect(?:\s+name)?|lead(?:\s+name)?)$/i.test(lower)) {
    return {
      kind: 'recipient_name',
      resolvedValue: values.recipientFirstName,
      explanation: `Recipient's name (${values.recipientFirstName})`,
    };
  }
  if (lower === 'name') {
    const isNearEnd = offsetInText > fullTextLength * 0.65 && offsetInText > 80;
    if (isNearEnd) {
      return {
        kind: 'sender_name',
        resolvedValue: values.senderName,
        explanation: `Sender's sign-off name (${values.senderName})`,
      };
    }
    return {
      kind: 'recipient_name',
      resolvedValue: values.recipientFirstName,
      explanation: `Recipient's greeting name (${values.recipientFirstName})`,
    };
  }

  // 2. Personalised benefit / value / reason cue
  if (
    /\b(?:benefit|valuable|value|incentive|gain|why\s+it|reason\s+it|worthwhile|what\s+they\s+get|for\s+them)\b/i.test(
      lower,
    )
  ) {
    return {
      kind: 'personalised_benefit',
      resolvedValue: values.personalisedBenefitClause,
      explanation: `Personalised benefit explaining why this opportunity is valuable to this specific prospect (${values.personalisedBenefitClause})`,
    };
  }

  // 3. Specific collaboration / request / ask / opportunity cue
  if (
    /\b(?:collaboration|request|ask|action|opportunity|partnership|proposal|invite|invitation|sponsorship|submission)\b/i.test(
      lower,
    ) &&
    !/\b(?:detail\s+about\s+their|their\s+work)\b/i.test(lower)
  ) {
    return {
      kind: 'specific_collaboration_or_request',
      resolvedValue: values.specificCollaborationRequest,
      explanation: `Specific collaboration or request tailored to this prospect's category and remit (${values.specificCollaborationRequest})`,
    };
  }

  // 4. Specific detail about their work / organisation / achievement / background
  if (
    /\b(?:detail|work|organisation|organization|project|book|title|achievement|award|programme|program|background|research|initiative|activity|role)\b/i.test(
      lower,
    )
  ) {
    return {
      kind: 'verified_work_detail',
      resolvedValue: values.verifiedWorkDetail,
      explanation: `Verified research detail about the prospect's work or organisation (${values.verifiedWorkDetail})`,
    };
  }

  // 5. Competition / Initiative name cues
  if (/\b(?:competition|project|initiative|award|awards)\s+name\b/i.test(lower)) {
    return {
      kind: 'competition_name',
      resolvedValue: 'Maya Poetry Book Awards',
      explanation: 'Official competition or initiative title',
    };
  }

  // 6. Prize details cues
  if (/\b(?:prizes?|prize\s+fund|top\s+prize|award\s+fund)\b/i.test(lower)) {
    return {
      kind: 'prize_details',
      resolvedValue: '£7,000 in prizes, including a £3,000 top prize',
      explanation: 'Confirmed competition prize fund information',
    };
  }

  // 7. Dates / Deadline cues
  if (/\b(?:dates?|deadline|when\s+it\s+opens|opening\s+date|timeline)\b/i.test(lower)) {
    return {
      kind: 'dates_or_deadline',
      resolvedValue: '4 January 2027',
      explanation: 'Confirmed competition opening date or submission timeline',
    };
  }

  // 8. Website / Link cues
  if (/\b(?:website|link|url|more\s+info\s+link)\b/i.test(lower)) {
    return {
      kind: 'website_or_link',
      resolvedValue: 'https://poetrybookawards.co.uk',
      explanation: 'Official project overview link',
    };
  }

  // 9. Fallback for any other custom bracketed/parenthetical instruction
  return {
    kind: 'custom_contextual_cue',
    resolvedValue: `${values.verifiedWorkDetail}, as ${values.personalisedBenefitClause}`,
    explanation: `Contextual guidance "${innerText}" resolved using the prospect's verified work and personalised benefit`,
  };
}

/**
 * Extracts all bracketed `[...]` and instructional parenthetical `(...)` cues from a template
 * and maps each one to its contextual meaning and resolved prospect-specific value.
 */
export function extractTemplateDirectives(
  templateText: string,
  values: ContextualTemplateValues,
): ParsedTemplateDirective[] {
  const directives: ParsedTemplateDirective[] = [];
  const regex = /\[([^\][\n]{2,140})\]|\(([^()\n]{3,140})\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(templateText)) !== null) {
    const rawToken = match[0];
    const bracketInner = match[1];
    const parenInner = match[2];

    if (parenInner !== undefined) {
      // Only treat (...) as a directive if it contains instructional/contextual guidance words
      const trimmedParen = parenInner.trim();
      const isNameParen = /^(?:name|first\s+name|sender\s+name|recipient\s+name)$/i.test(trimmedParen);
      if (!isNameParen && !INSTRUCTIONAL_PAREN_KEYWORDS.test(trimmedParen)) {
        continue;
      }
    }

    const innerText = (bracketInner ?? parenInner ?? '').trim();
    if (!innerText) continue;

    const classified = classifyDirectiveInnerText(
      innerText,
      match.index,
      templateText.length,
      values,
    );

    const concreteGuidance = `This placeholder defines what content must go here: ground it in the prospect's verified research (${values.verifiedWorkDetail}). Write this point naturally into the message. NEVER output the raw bracket token "${rawToken}".`;

    directives.push({
      rawToken,
      innerText,
      ...classified,
      concreteGuidance,
    });
  }

  return directives;
}

/**
 * Replaces all bracketed `[...]` and instructional parenthetical `(...)` cues in `text`
 * with context-aware, grammatically smooth phrases tailored to the prospect.
 */
export function resolveTemplateDirectivesInText(
  text: string,
  record: Parameters<typeof buildContextualTemplateValues>[0],
  brief?: CategoryTemplateBriefInput | null,
  settings?: Partial<PersonalizationSettings> | null,
  template?: CategoryOutreachTemplate | null,
): string {
  const values = buildContextualTemplateValues(record, brief, settings, template);
  const regex = /\[([^\][\n]{2,140})\]|\(([^()\n]{3,140})\)/g;

  return text.replace(regex, (fullMatch, bracketInner: string | undefined, parenInner: string | undefined, offset: number) => {
    if (parenInner !== undefined) {
      const trimmedParen = parenInner.trim();
      const isNameParen = /^(?:name|first\s+name|sender\s+name|recipient\s+name)$/i.test(trimmedParen);
      if (!isNameParen && !INSTRUCTIONAL_PAREN_KEYWORDS.test(trimmedParen)) {
        return fullMatch;
      }
    }

    const innerText = (bracketInner ?? parenInner ?? '').trim();
    if (!innerText) return fullMatch;

    const classified = classifyDirectiveInnerText(innerText, offset, text.length, values);
    let replacement = classified.resolvedValue;

    // Smooth surrounding grammar (e.g. avoid "because because ...", "your your ...", or "the your ...")
    const precedingSlice = text.slice(Math.max(0, offset - 18), offset).toLowerCase();
    if (/\bbecause\s+$/.test(precedingSlice) && /^because\s+/i.test(replacement)) {
      replacement = replacement.replace(/^because\s+/i, '');
    }
    if (/\byour\s+$/.test(precedingSlice) && /^your\s+/i.test(replacement)) {
      replacement = replacement.replace(/^your\s+/i, '');
    }
    if (/\b(?:the|a|an)\s+$/.test(precedingSlice) && /^your\s+/i.test(replacement)) {
      replacement = replacement.replace(/^your\s+/i, '');
    }

    return replacement;
  })
    .replace(/\b(your|because|the|a|an)\s+\1\b/gi, '$1')
    .replace(/[^\S\r\n]{2,}/g, ' ');
}
