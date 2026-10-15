import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH } from './password';

export const CreateSessionRequestSchema = z
  .object({
    username: z.string().min(1).max(USERNAME_MAX_LENGTH),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export const SessionResponseSchema = z
  .object({
    authenticated: z.literal(true),
    displayName: z.string(),
    absoluteExpiresAt: z.string().datetime(),
  })
  .strict();

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

