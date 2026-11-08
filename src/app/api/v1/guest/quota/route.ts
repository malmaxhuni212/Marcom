import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { resolveGuestIdentity, setGuestCookie } from '@/auth/guest';
import { getGuestQuotaSnapshot } from '@/db/repositories/guest-quota-repository';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  const guest = access.guest ?? resolveGuestIdentity(req);
  const quota = await getGuestQuotaSnapshot(guest.guestIdHash);
  const isTeamAuthenticated = !access.isGuest && Boolean(access.session);

  const response = NextResponse.json(
    {
      authenticated: isTeamAuthenticated,
      mode: isTeamAuthenticated ? 'team' : 'guest',
      displayName: access.session?.displayName ?? 'Guest',
      guestToken: guest.token,
      quota,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );

  setGuestCookie(response, guest.token);
  return response;
}
