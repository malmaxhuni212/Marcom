import type { NextResponse } from 'next/server';
import type { CreatedSession } from './session';

export interface AuthCookieConfiguration {
  sessionName: string;
  csrfName: string;
  secure: boolean;
}

export function getAuthCookieConfiguration(secure: boolean): AuthCookieConfiguration {
  return {
    sessionName: secure ? '__Host-marcom_session' : 'marcom_session',
    csrfName: secure ? '__Host-marcom_csrf' : 'marcom_csrf',
    secure,
  };
}

export function getRequestCookie(request: Request, name: string): string | undefined {
  const entry = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  if (!entry) return undefined;

  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

export function setAuthCookies(
  response: NextResponse,
  session: CreatedSession,
  configuration: AuthCookieConfiguration,
): void {
  const common = {
    secure: configuration.secure,
    sameSite: 'lax' as const,
    path: '/',
    expires: session.absoluteExpiresAt,
    priority: 'high' as const,
  };

  response.cookies.set(configuration.sessionName, session.token, {
    ...common,
    httpOnly: true,
  });
  response.cookies.set(configuration.csrfName, session.csrfToken, {
    ...common,
    httpOnly: false,
  });
}

export function clearAuthCookies(
  response: NextResponse,
  configuration: AuthCookieConfiguration,
): void {
  const expired = new Date(0);
  const common = {
    secure: configuration.secure,
    sameSite: 'lax' as const,
    path: '/',
    expires: expired,
    maxAge: 0,
  };

  response.cookies.set(configuration.sessionName, '', { ...common, httpOnly: true });
  response.cookies.set(configuration.csrfName, '', { ...common, httpOnly: false });
}

