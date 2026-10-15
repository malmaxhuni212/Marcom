import { z } from 'zod';

const AuthEnvironmentSchema = z.object({
  AUTH_SECRET: z.string().min(32).max(1024),
  APP_ORIGIN: z.string().url(),
});

export interface AuthConfiguration {
  authSecret: string;
  appOrigin: string;
  secureCookies: boolean;
}

export function getAuthConfiguration(
  environment: Record<string, string | undefined> = process.env,
): AuthConfiguration {
  const parsed = AuthEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('The authentication environment configuration is missing or invalid.');
  }

  const originUrl = new URL(parsed.data.APP_ORIGIN);
  if (originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search) {
    throw new Error('APP_ORIGIN must contain only the application scheme, host and optional port.');
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTP or HTTPS.');
  }

  return {
    authSecret: parsed.data.AUTH_SECRET,
    appOrigin: originUrl.origin,
    secureCookies: originUrl.protocol === 'https:',
  };
}

