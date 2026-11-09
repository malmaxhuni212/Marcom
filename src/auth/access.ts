import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAccessConfiguration, isLoopbackHostname, type AccessMode } from './access-config';
import { getAuthConfiguration } from './config';
import { getAuthCookieConfiguration, getRequestCookie } from './cookies';
import { resolveGuestIdentity, type GuestIdentity } from './guest';
import { problemResponse, validateRequestOrigin } from './http';
import { validateSession, verifySessionCsrfToken, type ValidSession } from './session';
import { resolveLocalPilotActor, type ActorContext } from '@/db/local-actor';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const GUEST_ACTOR_CONTEXT: ActorContext = {
  workspaceId: '00000000-0000-0000-0000-000000000000',
  userId: '00000000-0000-0000-0000-000000000000',
  membershipId: '00000000-0000-0000-0000-000000000000',
};

export type AuthorizeApiOptions = {
  allowGuest?: boolean;
};

export type AuthorizedRequest = {
  ok: true;
  mode: AccessMode;
  actor: ActorContext;
  session: ValidSession | null;
  allowFileFallback: boolean;
  isGuest: boolean;
  guest: GuestIdentity | null;
};

export type RejectedRequest = { ok: false; response: NextResponse };

function authenticationRequired(): RejectedRequest {
  return {
    ok: false,
    response: problemResponse({
      type: 'https://marcom.internal/problems/authentication-required',
      title: 'Authentication required',
      status: 401,
      detail: 'A valid session is required.',
    }),
  };
}

function requestRejected(): RejectedRequest {
  return {
    ok: false,
    response: problemResponse({
      type: 'https://marcom.internal/problems/csrf-rejected',
      title: 'Request rejected',
      status: 403,
      detail: 'The request verification token is missing or invalid.',
    }),
  };
}

function internalFailure(error: unknown): RejectedRequest {
  const requestId = randomUUID();
  console.error(JSON.stringify({
    event: 'auth.product_access_failed',
    requestId,
    errorType: error instanceof Error ? error.name : 'UnknownError',
  }));
  return {
    ok: false,
    response: problemResponse({
      type: 'https://marcom.internal/problems/internal-error',
      title: 'Internal server error',
      status: 500,
      detail: 'The request could not be authorised.',
    }, { 'X-Request-Id': requestId }),
  };
}

export async function authorizeApiRequest(
  request: Request,
  options?: AuthorizeApiOptions,
): Promise<AuthorizedRequest | RejectedRequest> {
  try {
    const access = getAccessConfiguration();
    const clientModeHeader = request.headers.get('x-marcom-client-mode')?.toLowerCase();

    if (access.mode === 'local') {
      const hostname = new URL(request.url).hostname;
      if (!isLoopbackHostname(hostname)) return authenticationRequired();

      if (process.env.AUTH_SECRET) {
        try {
          const auth = getAuthConfiguration();
          const cookies = getAuthCookieConfiguration(auth.secureCookies);
          const token = getRequestCookie(request, cookies.sessionName);
          const session = token ? await validateSession(token, auth.authSecret) : null;
          if (session) {
            return {
              ok: true,
              mode: 'local',
              actor: session.actor,
              session,
              allowFileFallback: true,
              isGuest: false,
              guest: null,
            };
          }
        } catch {
          // Ignore optional session lookup failure in local mode
        }
      }

      if (options?.allowGuest) {
        const guest = resolveGuestIdentity(request);
        return {
          ok: true,
          mode: 'local',
          actor: GUEST_ACTOR_CONTEXT,
          session: null,
          allowFileFallback: true,
          isGuest: true,
          guest,
        };
      }

      if (clientModeHeader === 'guest') {
        return authenticationRequired();
      }

      return {
        ok: true,
        mode: 'local',
        actor: await resolveLocalPilotActor(),
        session: null,
        allowFileFallback: true,
        isGuest: false,
        guest: null,
      };
    }

    let session: ValidSession | null = null;
    let authConfig: ReturnType<typeof getAuthConfiguration> | null = null;
    try {
      authConfig = getAuthConfiguration();
      const cookies = getAuthCookieConfiguration(authConfig.secureCookies);
      const token = getRequestCookie(request, cookies.sessionName);
      session = token ? await validateSession(token, authConfig.authSecret) : null;

      if (session && UNSAFE_METHODS.has(request.method.toUpperCase())) {
        const csrfCookie = getRequestCookie(request, cookies.csrfName);
        const csrfHeader = request.headers.get('x-csrf-token');
        if (
          !validateRequestOrigin(request, authConfig.appOrigin) ||
          !csrfCookie ||
          !csrfHeader ||
          !verifySessionCsrfToken(authConfig.authSecret, csrfCookie, session.csrfTokenHash) ||
          !verifySessionCsrfToken(authConfig.authSecret, csrfHeader, session.csrfTokenHash)
        ) {
          if (!options?.allowGuest) {
            return requestRejected();
          }
          session = null;
        }
      }
    } catch (error) {
      if (!options?.allowGuest) {
        throw error;
      }
    }

    if (session) {
      return {
        ok: true,
        mode: 'shared',
        actor: session.actor,
        session,
        allowFileFallback: false,
        isGuest: false,
        guest: null,
      };
    }

    if (options?.allowGuest) {
      const guest = resolveGuestIdentity(request, authConfig?.authSecret);
      return {
        ok: true,
        mode: 'shared',
        actor: GUEST_ACTOR_CONTEXT,
        session: null,
        allowFileFallback: false,
        isGuest: true,
        guest,
      };
    }

    return authenticationRequired();
  } catch (error) {
    return internalFailure(error);
  }
}
