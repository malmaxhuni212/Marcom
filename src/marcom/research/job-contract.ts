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

export const ResearchJobProgressSchema = z.object({
  requested: z.number().int().min(0).default(0),
  discovered: z.number().int().min(0).default(0),
  completed: z.number().int().min(0).default(0),
  duplicatesSkipped: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  message: z.string().max(500).default('Research is queued.'),
  searchProvider: z.string().max(80).default('unresolved'),
});

export type ResearchJobProgress = z.infer<typeof ResearchJobProgressSchema>;

export function readResearchJobProgress(value: unknown): ResearchJobProgress {
  const parsed = ResearchJobProgressSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return ResearchJobProgressSchema.parse({});
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
