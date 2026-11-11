import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { isLoopbackHostname } from '@/auth/access-config';
import {
  exchangeNotionCode,
  searchNotionAccessiblePages,
  verifyNotionOAuthState,
} from '@/marcom/integrations/notion/client';
import {
  resolveNotionSessionScope,
  saveNotionConnection,
  setNotionConnectionCookieOnResponse,
} from '@/marcom/integrations/notion/store';

function resolveSafeReturnOrigin(
  candidateOrigin: string | undefined,
  requestUrl: URL,
): string {
  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  const isSharedOrProd =
    process.env.APP_ACCESS_MODE === 'shared' || process.env.NODE_ENV === 'production';

  if (isSharedOrProd && configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Fall through if APP_ORIGIN is malformed
    }
  }

  const fallbackOrigin = configuredOrigin || requestUrl.origin;
  if (!candidateOrigin) return fallbackOrigin;

  try {
    const candidateUrl = new URL(candidateOrigin);
    if (configuredOrigin && candidateUrl.origin === new URL(configuredOrigin).origin) {
      return candidateUrl.origin;
    }
    if (candidateUrl.origin === requestUrl.origin) {
      return candidateUrl.origin;
    }
    if (
      isLoopbackHostname(candidateUrl.hostname) &&
      isLoopbackHostname(requestUrl.hostname)
    ) {
      return candidateUrl.origin;
    }
  } catch {
    // Ignore malformed returnOrigin
  }
  return fallbackOrigin;
}

export async function GET(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const stateCheck = verifyNotionOAuthState(state);
  const baseOrigin = resolveSafeReturnOrigin(stateCheck.returnOrigin, url);

  if (error) {
    return NextResponse.redirect(
      new URL(`/integrations?notion_error=${encodeURIComponent(error)}`, baseOrigin),
    );
  }

  if (!code) {
    if (!access.ok) return access.response;
    return NextResponse.redirect(
      new URL('/integrations?notion_error=missing_code', baseOrigin),
    );
  }

  if (!stateCheck.valid) {
    return NextResponse.redirect(
      new URL(
        `/integrations?notion_error=${encodeURIComponent(
          stateCheck.error || 'Authorization session expired. Please try connecting Notion again.',
        )}`,
        baseOrigin,
      ),
    );
  }

  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    const proto =
      req.headers.get('x-forwarded-proto') ||
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    const redirectUri =
      process.env.NOTION_REDIRECT_URI || `${proto}://${host}/api/integrations/notion/callback`;

    const connection = await exchangeNotionCode(code, redirectUri);

    if (!connection.defaultParentPageId) {
      const accessible = await searchNotionAccessiblePages(connection.accessToken).catch(() => []);
      if (accessible.length > 0) {
        connection.defaultParentPageId = accessible[0]!.id;
        connection.defaultParentPageTitle = accessible[0]!.title;
      }
    }

    const scope = stateCheck.sessionScope || resolveNotionSessionScope(req);
    await saveNotionConnection(connection, scope);

    const response = NextResponse.redirect(new URL('/integrations?notion=connected', baseOrigin));
    setNotionConnectionCookieOnResponse(response, connection, scope);
    return response;
  } catch (err) {
    const msg = (err as Error).message || 'Failed to complete Notion connection.';
    return NextResponse.redirect(
      new URL(`/integrations?notion_error=${encodeURIComponent(msg)}`, baseOrigin),
    );
  }
}
