import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const BOOTSTRAP_TOKEN_HEADER = 'x-marcom-bootstrap-token';

const BootstrapEnvironmentSchema = z.object({
  APP_ACCESS_MODE: z.literal('shared'),
  AUTH_BOOTSTRAP_SECRET: z.string().min(32).max(1024),
});

export interface AuthBootstrapConfiguration {
  secret: string;
}

export function getAuthBootstrapConfiguration(
  environment: Record<string, string | undefined> = process.env,
): AuthBootstrapConfiguration | null {
  const parsed = BootstrapEnvironmentSchema.safeParse(environment);
  return parsed.success ? { secret: parsed.data.AUTH_BOOTSTRAP_SECRET } : null;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyBootstrapSecret(expected: string, submitted: string | null): boolean {
  if (!submitted) return false;
  return timingSafeEqual(digest(expected), digest(submitted));
}
