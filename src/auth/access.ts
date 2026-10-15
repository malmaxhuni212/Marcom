import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAccessConfiguration, isLoopbackHostname, type AccessMode } from './access-config';
import { getAuthConfiguration } from './config';
import { getAuthCookieConfiguration, getRequestCookie } from './cookies';
import { problemResponse, validateRequestOrigin } from './http';
import { validateSession, verifySessionCsrfToken, type ValidSession } from './session';
import { resolveLocalPilotActor, type ActorContext } from '@/db/local-actor';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type AuthorizedRequest = {
  ok: true;
  mode: AccessMode;
  actor: ActorContext;
  session: ValidSession | null;
  allowFileFallback: boolean;
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

export async function authorizeApiRequest(request: Request): Promise<AuthorizedRequest | RejectedRequest> {
  try {
    const access = getAccessConfiguration();
    if (access.mode === 'local') {
      const hostname = new URL(request.url).hostname;
      if (!isLoopbackHostname(hostname)) return authenticationRequired();
      return {
        ok: true,
        mode: 'local',
        actor: await resolveLocalPilotActor(),
        session: null,
        allowFileFallback: true,
      };
    }

    const auth = getAuthConfiguration();
    const cookies = getAuthCookieConfiguration(auth.secureCookies);
    const token = getRequestCookie(request, cookies.sessionName);
    const session = token ? await validateSession(token, auth.authSecret) : null;
    if (!session) return authenticationRequired();

    if (UNSAFE_METHODS.has(request.method.toUpperCase())) {
      const csrfCookie = getRequestCookie(request, cookies.csrfName);
      const csrfHeader = request.headers.get('x-csrf-token');
      if (
        !validateRequestOrigin(request, auth.appOrigin) ||
        !csrfCookie ||
        !csrfHeader ||
        !verifySessionCsrfToken(auth.authSecret, csrfCookie, session.csrfTokenHash) ||
        !verifySessionCsrfToken(auth.authSecret, csrfHeader, session.csrfTokenHash)
      ) {
        return requestRejected();
      }
    }

    return {
      ok: true,
      mode: 'shared',
      actor: session.actor,
      session,
      allowFileFallback: false,
    };
  } catch (error) {
    return internalFailure(error);
  }
}
