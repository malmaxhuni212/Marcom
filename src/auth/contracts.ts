import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from './password';

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

export const BootstrapCredentialRequestSchema = z
  .object({
    username: z.string().min(1).max(USERNAME_MAX_LENGTH),
    displayName: z.string().trim().min(1).max(160).optional(),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export const BootstrapCredentialResponseSchema = z
  .object({
    configured: z.literal(true),
    username: z.string(),
    displayName: z.string(),
    credentialVersion: z.number().int().positive(),
  })
  .strict();

export type BootstrapCredentialRequest = z.infer<typeof BootstrapCredentialRequestSchema>;
export type BootstrapCredentialResponse = z.infer<typeof BootstrapCredentialResponseSchema>;

