import { z } from 'zod';

export const ResearchJobPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  batchId: z.string().trim().min(1).max(120),
  batchNumber: z.number().int().positive(),
  searchPlanVersionId: z.uuid(),
  targetId: z.string().trim().min(1).max(100),
  requestedCount: z.number().int().min(1).max(50),
});

export type ResearchJobPayload = z.infer<typeof ResearchJobPayloadSchema>;

export const ResearchSeedCursorSchema = z.object({
  name: z.string().trim().min(1).max(300),
  entity_kind: z.enum(['person', 'organisation', 'unknown']).optional(),
  organisation: z.string().max(300).optional(),
  role: z.string().max(300).optional(),
  website: z.string().max(1_000).optional(),
  linkedin: z.string().max(1_000).optional(),
  country: z.string().max(120).optional(),
  notes: z.string().max(2_000).optional(),
});

export const ResearchJobProgressSchema = z.object({
  requested: z.number().int().min(0).default(0),
  discovered: z.number().int().min(0).default(0),
  completed: z.number().int().min(0).default(0),
  duplicatesSkipped: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  message: z.string().max(500).default('Research is queued.'),
  searchProvider: z.string().max(80).default('unresolved'),
  pendingSeeds: z.array(ResearchSeedCursorSchema).max(100).optional(),
  iteration: z.number().int().min(0).optional(),
  consecutiveEmpty: z.number().int().min(0).optional(),
});

export type ResearchSeedCursor = z.infer<typeof ResearchSeedCursorSchema>;
export type ResearchJobProgress = z.infer<typeof ResearchJobProgressSchema>;

function normalizeSeedCursor(seed: ResearchSeedCursor): ResearchSeedCursor {
  const normalized: ResearchSeedCursor = { name: seed.name };
  if (seed.entity_kind !== undefined) normalized.entity_kind = seed.entity_kind;
  if (seed.organisation !== undefined) normalized.organisation = seed.organisation;
  if (seed.role !== undefined) normalized.role = seed.role;
  if (seed.website !== undefined) normalized.website = seed.website;
  if (seed.linkedin !== undefined) normalized.linkedin = seed.linkedin;
  if (seed.country !== undefined) normalized.country = seed.country;
  if (seed.notes !== undefined) normalized.notes = seed.notes;
  return normalized;
}

export function readResearchJobProgress(value: unknown): ResearchJobProgress {
  const parsed = ResearchJobProgressSchema.safeParse(value);
  const raw = parsed.success ? parsed.data : ResearchJobProgressSchema.parse({});
  const progress: ResearchJobProgress = {
    requested: raw.requested,
    discovered: raw.discovered,
    completed: raw.completed,
    duplicatesSkipped: raw.duplicatesSkipped,
    failed: raw.failed,
    message: raw.message,
    searchProvider: raw.searchProvider,
  };
  if (raw.pendingSeeds !== undefined) {
    progress.pendingSeeds = raw.pendingSeeds.map(normalizeSeedCursor);
  }
  if (raw.iteration !== undefined) progress.iteration = raw.iteration;
  if (raw.consecutiveEmpty !== undefined) progress.consecutiveEmpty = raw.consecutiveEmpty;
  return progress;
}

export function stripResearchJobCursor(progress: ResearchJobProgress): ResearchJobProgress {
  return {
    requested: progress.requested,
    discovered: progress.discovered,
    completed: progress.completed,
    duplicatesSkipped: progress.duplicatesSkipped,
    failed: progress.failed,
    message: progress.message,
    searchProvider: progress.searchProvider,
  };
}

export type PublicResearchJobStatus =
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'waiting_rate_limit'
  | 'completed'
  | 'completed_with_errors'
  | 'error'
  | 'cancelled';

export function toPublicResearchJobStatus(status: string): PublicResearchJobStatus {
  if (status === 'failed') return 'error';
  if (
    status === 'queued'
    || status === 'running'
    || status === 'retry_scheduled'
    || status === 'waiting_rate_limit'
    || status === 'completed'
    || status === 'completed_with_errors'
    || status === 'cancelled'
  ) {
    return status;
  }
  return 'error';
}
