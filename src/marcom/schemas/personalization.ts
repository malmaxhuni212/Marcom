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
