import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import {
  getNotionConnection,
  getNotionConnectionStatus,
  setNotionConnectionCookieOnResponse,
  updateDefaultNotionParentPage,
} from '@/marcom/integrations/notion/store';
import {
  getNotionOAuthConfig,
  searchNotionAccessiblePages,
} from '@/marcom/integrations/notion/client';
import type { NotionAccessiblePage } from '@/marcom/integrations/notion/types';

export async function GET(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  try {
    const status = await getNotionConnectionStatus(req);
    const { isConfigured } = getNotionOAuthConfig();
    const url = new URL(req.url);
    const includePages = url.searchParams.get('includePages') === '1';

    let accessiblePages: NotionAccessiblePage[] | undefined;
    if (status.connected && includePages) {
      const conn = await getNotionConnection(req);
      if (conn?.accessToken) {
        accessiblePages = await searchNotionAccessiblePages(conn.accessToken).catch(() => []);
      }
    }

    return NextResponse.json({
      success: true,
      oauthConfigured: isConfigured,
      ...status,
      ...(accessiblePages ? { accessiblePages } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message || 'Failed to check Notion connection status.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      defaultParentPageId?: string | null;
      defaultParentPageTitle?: string | null;
    };

    const updated = await updateDefaultNotionParentPage(
      body.defaultParentPageId ?? null,
      body.defaultParentPageTitle ?? null,
      req,
    );

    if (!updated) {
      return NextResponse.json(
        { error: 'Notion is not connected.' },
        { status: 400 },
      );
    }

    const response = NextResponse.json({
      success: true,
      defaultParentPageId: updated.defaultParentPageId ?? null,
      defaultParentPageTitle: updated.defaultParentPageTitle ?? null,
    });
    setNotionConnectionCookieOnResponse(response, updated);
    return response;
  } catch (err) {
    const msg = (err as Error).message || 'Failed to update Notion parent page setting.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
