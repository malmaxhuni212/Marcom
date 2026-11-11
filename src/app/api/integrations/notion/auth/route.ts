import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import {
  buildNotionAuthUrl,
  createNotionOAuthState,
  getNotionOAuthConfig,
} from '@/marcom/integrations/notion/client';

export async function GET(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  try {
    const { isConfigured } = getNotionOAuthConfig();
    if (!isConfigured) {
      return NextResponse.json(
        {
          error:
            'Notion integration is not configured. NOTION_CLIENT_ID and NOTION_CLIENT_SECRET are required.',
        },
        { status: 400 },
      );
    }

    const requestUrl = new URL(req.url);
    const host =
      req.headers.get('x-forwarded-host') ||
      req.headers.get('host') ||
      requestUrl.host ||
      'localhost:3000';
    const proto =
      req.headers.get('x-forwarded-proto') ||
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
    const callerOrigin = `${proto}://${host}`;
    const redirectUri =
      process.env.NOTION_REDIRECT_URI || `${callerOrigin}/api/integrations/notion/callback`;

    const state = createNotionOAuthState({
      workspaceId: access.actor.workspaceId,
      returnOrigin: callerOrigin,
    });

    const authUrl = buildNotionAuthUrl(redirectUri, state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    const msg = (err as Error).message || 'Failed to start Notion authorization.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
