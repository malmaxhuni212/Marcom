/**
 * StructuredBrief contract — output of the Brief Analyzer, input to every downstream agent.
 *
 * This Zod schema is the SINGLE SOURCE OF TRUTH.
 * `agents/brief-analyzer/schema.json` is generated from it via `npm run schemas`.
 *
 * Strict objects are used everywhere so unknown keys are rejected rather than silently accepted.
 */
import { z } from 'zod';

export const STRUCTURED_BRIEF_VERSION = '1.0' as const;

const nonEmpty = z.string().trim().min(1);

/** A single criterion. Vague criteria are kept, but must be flagged instead of silently operationalised. */
export const CriterionSchema = z.strictObject({
  text: nonEmpty.describe('The criterion, phrased as close to the human brief as possible.'),
  origin: z
    .enum(['explicit', 'inferred'])
    .describe('explicit = stated in the brief; inferred = derived by the analyzer (must be conservative).'),
  needs_operational_definition: z
    .boolean()
    .describe('True when the criterion is vague (e.g. "influential") and a human must define how to measure it.'),
});

export const TargetSchema = z.strictObject({
  id: nonEmpty.describe('Stable identifier for the target group within this brief, e.g. "target-a".'),
  target_type: nonEmpty.describe('What kind of entity to find, in the brief\'s own words (e.g. "film producers").'),
  entity_kind: z.enum(['person', 'organisation', 'either', 'unknown']),
  description: z.string(),
  geography: z.array(nonEmpty).describe('Empty array = not specified (should then appear in unknowns).'),
  qualification_criteria: z.array(CriterionSchema),
  exclusion_criteria: z.array(CriterionSchema),
  priority: z.enum(['primary', 'secondary', 'tertiary', 'unspecified']),
});

export const DatabaseFieldSchema = z.strictObject({
  name: nonEmpty,
  required: z.boolean(),
  purpose: z.string(),
  expected_source: z.enum(['brief', 'research', 'personalization', 'human', 'system']),
});

export const UnknownSchema = z.strictObject({
  topic: nonEmpty,
  reason: nonEmpty,
  quote: z.string().nullable().describe('Verbatim fragment of the brief that triggered this unknown, if any.'),
  blocking: z.boolean().describe('True if research should not start until a human answers.'),
});

export const ApproximationSchema = z.strictObject({
  quote: nonEmpty.describe('Verbatim approximate statement from the brief, e.g. "around 150 submissions".'),
  interpretation: nonEmpty.describe('How downstream agents should treat it. Must preserve the uncertainty.'),
});

export const ConflictSchema = z.strictObject({
  description: nonEmpty,
  quotes: z.array(nonEmpty),
});

export const StructuredBriefSchema = z.strictObject({
  structured_brief_version: z.literal(STRUCTURED_BRIEF_VERSION),

  project: z.strictObject({
    name: z.string().nullable(),
    description: z.string(),
    primary_objective: z.string(),
    secondary_objectives: z.array(nonEmpty),
    success_metrics: z.array(nonEmpty),
  }),

  targets: z.array(TargetSchema).min(1, 'At least one target group is required (use target_type "unknown" if unclear).'),

  research: z.strictObject({
    required_fields: z.array(nonEmpty),
    preferred_source_types: z.array(nonEmpty),
    evidence_requirements: z.array(nonEmpty),
    verification_requirements: z.array(nonEmpty),
    unknown_handling: nonEmpty,
  }),

  personalization: z.strictObject({
    allowed: z.array(nonEmpty),
    preferred_details: z.array(nonEmpty),
    tone: z.array(nonEmpty),
    avoid: z.array(nonEmpty),
  }),

  outreach: z.strictObject({
    objectives: z.array(nonEmpty),
    channels: z.array(nonEmpty),
    tone: z.array(nonEmpty),
    approval_required: z.literal(true).describe('Human approval is mandatory in MARCOM. Never false.'),
  }),

  database: z.strictObject({
    fields: z.array(DatabaseFieldSchema).min(1),
  }),

  human_review: z.strictObject({
    requirements: z.array(nonEmpty),
    approval_points: z.array(nonEmpty).min(1),
  }),

  constraints: z.array(nonEmpty),
  conflicts: z.array(ConflictSchema),
  approximations: z.array(ApproximationSchema),
  unknowns_requiring_confirmation: z.array(UnknownSchema),
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type StructuredBrief = z.infer<typeof StructuredBriefSchema>;
