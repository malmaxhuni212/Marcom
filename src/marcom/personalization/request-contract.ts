import { z } from 'zod';
import { FeedbackScopeSchema, LeadPersonalizationSettingsSchema } from '../schemas/personalization';

export const GeneratePersonalizationRequestSchema = z.strictObject({
  recordId: z.string().trim().min(1).max(255).optional(),
  recordIds: z.array(z.string().trim().min(1).max(255)).min(1).max(50).optional(),
  batchId: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(['single', 'batch', 'all_personalized', 'all_shortlisted']).optional(),
  allShortlisted: z.boolean().optional(),
  forceRegenerate: z.boolean().optional(),
  force: z.boolean().optional(),
  leadSettings: LeadPersonalizationSettingsSchema.optional(),
  leadSettingsByRecordId: z.record(z.string(), LeadPersonalizationSettingsSchema).optional(),
  /** Reviewer feedback on the current draft: saved to learning memory and applied in this rewrite. */
  feedback: z
    .strictObject({
      text: z.string().trim().min(2, 'Write a little feedback first.').max(1_000),
      scope: FeedbackScopeSchema.default('project'),
    })
    .optional(),
}).superRefine((value, context) => {
  if (value.feedback && !value.recordId) {
    context.addIssue({ code: 'custom', message: 'recordId is required when rewriting from feedback.' });
  }
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
