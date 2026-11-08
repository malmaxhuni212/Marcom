import { NextResponse, type NextRequest } from 'next/server';
import { getAccessConfiguration, isLoopbackHostname } from './auth/access-config';
import { getRequestCookie } from './auth/cookies';
import { problemResponse } from './auth/http';

const PUBLIC_PATHS = new Set([
  '/login',
  '/bootstrap',
  '/api/v1/auth/session',
  '/api/internal/v1/auth/bootstrap',
  '/api/integrations/notion/callback',
  '/api/v1/guest/quota',
  '/api/v1/guest/research',
  '/api/v1/guest/personalization',
  '/api/extract',
  '/api/analyze',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (!pathname.startsWith('/api/')) return true;
  return false;
}

function hasSessionCookie(request: NextRequest): boolean {
  return Boolean(
    getRequestCookie(request, '__Host-marcom_session') ??
    getRequestCookie(request, 'marcom_session'),
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const access = getAccessConfiguration();
  if (access.mode === 'local') {
    if (isLoopbackHostname(request.nextUrl.hostname)) return NextResponse.next();
  } else if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  return problemResponse({
    type: 'https://marcom.internal/problems/authentication-required',
    title: 'Authentication required',
    status: 401,
    detail: 'A valid session is required.',
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
