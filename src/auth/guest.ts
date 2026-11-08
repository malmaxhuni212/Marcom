import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { getAccessConfiguration } from './access-config';
import { getRequestCookie } from './cookies';
import { getRequestSource } from './http';

export const GUEST_TOKEN_HEADER = 'x-guest-token';
const GUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // 400 days
const LOCAL_DEV_FALLBACK_SECRET = 'marcom-local-dev-guest-identity-secret-32b';

export interface GuestCookieConfiguration {
  cookieName: string;
  secure: boolean;
}

export interface GuestIdentity {
  guestId: string;
  guestIdHash: string;
  token: string;
  isNew: boolean;
  source: 'cookie' | 'header' | 'generated' | 'request_fingerprint';
}

export function getGuestCookieConfiguration(secure?: boolean): GuestCookieConfiguration {
  const isSecure = secure ?? resolveGuestSigningSecret().secureCookies;
  return {
    cookieName: isSecure ? '__Host-marcom_guest' : 'marcom_guest',
    secure: isSecure,
  };
}

export function getGuestCookieAttributes(
  secure?: boolean,
): { name: string; path: string; maxAge: number; secure: boolean } {
  const { cookieName, secure: isSecure } = getGuestCookieConfiguration(secure);
  return {
    name: cookieName,
    path: '/',
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
    secure: isSecure,
  };
}

export function resolveGuestSigningSecret(
  environment: Record<string, string | undefined> = process.env,
): { secret: string; secureCookies: boolean; appOrigin: string | null } {
  const configuredSecret = environment.AUTH_SECRET?.trim();
  const configuredOrigin = environment.APP_ORIGIN?.trim() || null;
  let secureCookies = false;
  if (configuredOrigin) {
    try {
      secureCookies = new URL(configuredOrigin).protocol === 'https:';
    } catch {
      secureCookies = false;
    }
  }

  if (configuredSecret && configuredSecret.length >= 32) {
    return { secret: configuredSecret, secureCookies, appOrigin: configuredOrigin };
  }

  const access = getAccessConfiguration(environment);
  if (access.mode === 'local') {
    return {
      secret: LOCAL_DEV_FALLBACK_SECRET,
      secureCookies: false,
      appOrigin: configuredOrigin ?? 'http://127.0.0.1:3000',
    };
  }

  return {
    secret: LOCAL_DEV_FALLBACK_SECRET,
    secureCookies,
    appOrigin: configuredOrigin,
  };
}

export function hashGuestIdentifier(secret: string, guestId: string): string {
  return createHmac('sha256', secret)
    .update(`marcom-guest-id-hash-v1:${guestId}`)
    .digest('hex');
}

function signGuestId(secret: string, guestId: string): string {
  return createHmac('sha256', secret)
    .update(`marcom-guest-token-v1:${guestId}`)
    .digest('base64url');
}

export function createGuestToken(
  secret: string = resolveGuestSigningSecret().secret,
  explicitGuestId?: string,
): { guestId: string; guestIdHash: string; token: string } {
  const guestId = explicitGuestId?.trim() || randomUUID();
  const signature = signGuestId(secret, guestId);
  return {
    guestId,
    guestIdHash: hashGuestIdentifier(secret, guestId),
    token: `${guestId}.${signature}`,
  };
}

export function verifyGuestToken(
  token: string | undefined | null,
  secret: string = resolveGuestSigningSecret().secret,
): { guestId: string; guestIdHash: string; token: string } | null {
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return null;

  const guestId = trimmed.slice(0, dotIndex);
  const providedSignature = trimmed.slice(dotIndex + 1);
  if (guestId.length < 8 || guestId.length > 240) return null;

  const expectedSignature = signGuestId(secret, guestId);
  const providedBuf = Buffer.from(providedSignature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  return {
    guestId,
    guestIdHash: hashGuestIdentifier(secret, guestId),
    token: trimmed,
  };
}

export function resolveGuestIdentity(
  request: Request,
  secret?: string,
  secureCookies?: boolean,
): GuestIdentity {
  const resolved = resolveGuestSigningSecret();
  const signingSecret = secret ?? resolved.secret;
  const isSecure = secureCookies ?? resolved.secureCookies;
  const cookieConfig = getGuestCookieConfiguration(isSecure);
  const cookieToken =
    getRequestCookie(request, cookieConfig.cookieName) ??
    getRequestCookie(request, 'marcom_guest') ??
    getRequestCookie(request, '__Host-marcom_guest');

  const verifiedCookie = verifyGuestToken(cookieToken, signingSecret);
  if (verifiedCookie) {
    return {
      ...verifiedCookie,
      isNew: false,
      source: 'cookie',
    };
  }

  const headerToken = request.headers.get(GUEST_TOKEN_HEADER);
  const verifiedHeader = verifyGuestToken(headerToken, signingSecret);
  if (verifiedHeader) {
    return {
      ...verifiedHeader,
      isNew: false,
      source: 'header',
    };
  }

  // For unsafe/mutation requests (e.g. direct API calls that omit or tamper with cookies),
  // bind to a deterministic request fingerprint so repeating cookie-less POST requests
  // cannot reset or bypass backend guest usage limits.
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const ip = getRequestSource(request);
    const ua = (request.headers.get('user-agent') ?? 'unknown-ua').trim().slice(0, 120);
    const fingerprintId = `fp-${createHmac('sha256', signingSecret).update(`${ip}|${ua}`).digest('hex').slice(0, 32)}`;
    const created = createGuestToken(signingSecret, fingerprintId);
    return {
      ...created,
      isNew: true,
      source: 'request_fingerprint',
    };
  }

  const created = createGuestToken(signingSecret);
  return {
    ...created,
    isNew: true,
    source: 'generated',
  };
}

export function setGuestCookie(
  response: NextResponse | Response,
  token: string,
  secure?: boolean,
): void {
  const { cookieName, secure: isSecure } = getGuestCookieConfiguration(secure);
  if ('cookies' in response && typeof response.cookies?.set === 'function') {
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
      priority: 'medium',
    });
  }
  response.headers.set('X-Guest-Token', token);
}
