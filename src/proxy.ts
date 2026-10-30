import { NextRequest, NextResponse } from 'next/server';
import { getAccessConfiguration, isLoopbackHostname } from '@/auth/access-config';
import { getAuthConfiguration } from '@/auth/config';
import { getAuthCookieConfiguration } from '@/auth/cookies';

const PATH_HEADER = 'x-marcom-pathname';
const PUBLIC_PATHS = new Set([
  '/login',
  '/bootstrap',
  '/api/v1/auth/session',
  '/api/internal/v1/auth/bootstrap',
]);

function unavailable(): NextResponse {
  return NextResponse.json(
    {
      type: 'https://marcom.internal/problems/access-gate-unavailable',
      title: 'Service unavailable',
      status: 503,
      detail: 'The access gate is not configured.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json' } },
  );
}

export function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATH_HEADER, pathname);

  try {
    const access = getAccessConfiguration();
    if (access.mode === 'local') {
      if (!isLoopbackHostname(request.nextUrl.hostname)) return unavailable();
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (PUBLIC_PATHS.has(pathname)) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    const auth = getAuthConfiguration();
    const cookieNames = getAuthCookieConfiguration(auth.secureCookies);
    if (!request.cookies.get(cookieNames.sessionName)?.value) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          {
            type: 'https://marcom.internal/problems/authentication-required',
            title: 'Authentication required',
            status: 401,
            detail: 'A valid session is required.',
          },
          { status: 401, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/problem+json' } },
        );
      }
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return unavailable();
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
