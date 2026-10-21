import { z } from 'zod';

export const GeneratePersonalizationRequestSchema = z.strictObject({
  recordId: z.string().trim().min(1).max(255).optional(),
  recordIds: z.array(z.string().trim().min(1).max(255)).min(1).max(50).optional(),
  batchId: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(['single', 'batch', 'all_personalized', 'all_shortlisted']).optional(),
  allShortlisted: z.boolean().optional(),
  forceRegenerate: z.boolean().optional(),
  force: z.boolean().optional(),
}).superRefine((value, context) => {
  if (!value.recordId && !value.recordIds && !value.batchId && !value.allShortlisted && !value.mode) {
    context.addIssue({ code: 'custom', message: 'Select at least one prospect to personalize.' });
  }
  if ((value.mode === 'single' || (!value.mode && !value.recordIds && !value.allShortlisted)) && !value.recordId) {
    context.addIssue({ code: 'custom', message: 'recordId is required for single-prospect personalization.' });
  }
  if (value.mode === 'batch' && !value.batchId) {
    context.addIssue({ code: 'custom', message: 'batchId is required for batch personalization.' });
  }
});

export type GeneratePersonalizationRequest = z.infer<typeof GeneratePersonalizationRequestSchema>;
