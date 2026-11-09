import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { disconnectNotion } from '@/marcom/integrations/notion/store';

export async function POST(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  try {
    await disconnectNotion();
    return NextResponse.json({ success: true, disconnected: true });
  } catch (err) {
    const msg = (err as Error).message || 'Failed to disconnect Notion.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  try {
    await disconnectNotion();
    const url = new URL(req.url);
    const returnTo = url.searchParams.get('returnTo') || '/integrations';
    return NextResponse.redirect(new URL(`${returnTo}?notion=disconnected`, req.url));
  } catch (err) {
    const msg = (err as Error).message || 'Failed to disconnect Notion.';
    return NextResponse.redirect(
      new URL(`/integrations?notion_error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}
