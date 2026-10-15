import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAccessConfiguration, isLoopbackHostname } from './access-config';
import { getAuthConfiguration } from './config';
import { getAuthCookieConfiguration } from './cookies';
import { validateSession } from './session';
import { resolveLocalPilotActor, type ActorContext } from '@/db/local-actor';

export interface PageAccess {
  actor: ActorContext;
  displayName: string;
}

export async function requirePageAccess(): Promise<PageAccess | null> {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-marcom-pathname') ?? '/';
  if (pathname === '/login' || pathname === '/bootstrap') return null;

  const access = getAccessConfiguration();
  if (access.mode === 'local') {
    const host = requestHeaders.get('host')?.split(':')[0] ?? '';
    if (!isLoopbackHostname(host)) throw new Error('Local access is restricted to the loopback interface.');
    return { actor: await resolveLocalPilotActor(), displayName: 'Local pilot' };
  }

  const auth = getAuthConfiguration();
  const names = getAuthCookieConfiguration(auth.secureCookies);
  const cookieStore = await cookies();
  const token = cookieStore.get(names.sessionName)?.value;
  const session = token ? await validateSession(token, auth.authSecret) : null;
  if (!session) {
    const returnTo = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/';
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return { actor: session.actor, displayName: session.displayName };
}
