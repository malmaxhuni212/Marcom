import { cookies } from 'next/headers';
import { getAccessConfiguration } from './access-config';
import { getAuthConfiguration } from './config';
import { getAuthCookieConfiguration } from './cookies';
import { validateSession } from './session';

export type PageAccessContext = {
  mode: 'local' | 'shared' | 'guest';
  displayName: string;
};

export async function requirePageAccess(): Promise<PageAccessContext> {
  const access = getAccessConfiguration();
  const cookieStore = await cookies();

  if (access.mode === 'local' && !process.env.AUTH_SECRET) {
    return {
      mode: 'guest',
      displayName: 'Guest',
    };
  }

  try {
    const auth = getAuthConfiguration();
    const cookieNames = getAuthCookieConfiguration(auth.secureCookies);
    const token = cookieStore.get(cookieNames.sessionName)?.value;
    const session = token ? await validateSession(token, auth.authSecret) : null;
    if (session) {
      return {
        mode: 'shared',
        displayName: session.displayName,
      };
    }
  } catch {
    // Fall back to public guest access when team auth session is absent or not configured
  }

  return {
    mode: 'guest',
    displayName: 'Guest',
  };
}
