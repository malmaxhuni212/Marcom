export type AccessMode = 'local' | 'shared';

export interface AccessConfiguration {
  mode: AccessMode;
}

function isTruthyEnvironmentFlag(value: string | undefined): boolean {
  return Boolean(value && !['0', 'false', 'no'].includes(value.toLowerCase()));
}

export function getAccessConfiguration(
  environment: Record<string, string | undefined> = process.env,
): AccessConfiguration {
  const configuredMode = environment.APP_ACCESS_MODE;
  const hosted =
    isTruthyEnvironmentFlag(environment.NETLIFY) ||
    Boolean(environment.CONTEXT || environment.DEPLOY_URL || environment.URL);
  const production = environment.NODE_ENV === 'production';

  if (!configuredMode) {
    if (production || hosted) {
      throw new Error('APP_ACCESS_MODE must be set explicitly outside local development.');
    }
    return { mode: 'local' };
  }

  if (configuredMode !== 'local' && configuredMode !== 'shared') {
    throw new Error('APP_ACCESS_MODE must be either local or shared.');
  }
  if (configuredMode === 'local' && (production || hosted)) {
    throw new Error('Local access mode is not permitted in production or hosted environments.');
  }

  return { mode: configuredMode };
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}
