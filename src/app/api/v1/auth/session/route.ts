import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticatePasswordCredential } from '@/auth/authenticate';
import { getAuthConfiguration } from '@/auth/config';
import { CreateSessionRequestSchema, type SessionResponse } from '@/auth/contracts';
import {
  clearAuthCookies,
  getAuthCookieConfiguration,
  getRequestCookie,
  setAuthCookies,
} from '@/auth/cookies';
import {
  getRequestSource,
  problemResponse,
  validateRequestOrigin,
} from '@/auth/http';
import {
  createSession,
  revokeSession,
  validateSession,
  verifySessionCsrfToken,
} from '@/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_LOGIN_BODY_BYTES = 2048;

function internalFailure(request: Request, operation: string, error: unknown): NextResponse {
  const submittedRequestId = request.headers.get('x-request-id');
  const requestId =
    submittedRequestId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      submittedRequestId,
    )
      ? submittedRequestId
      : randomUUID();
  console.error(
    JSON.stringify({
      event: 'auth.session_request_failed',
      operation,
      requestId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }),
  );
  return problemResponse({
    type: 'https://marcom.internal/problems/internal-error',
    title: 'Internal server error',
    status: 500,
    detail: 'The authentication request could not be completed.',
  }, { 'X-Request-Id': requestId });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const configuration = getAuthConfiguration();
    if (!validateRequestOrigin(request, configuration.appOrigin)) {
      return problemResponse({
        type: 'https://marcom.internal/problems/csrf-rejected',
        title: 'Request rejected',
        status: 403,
        detail: 'The request origin could not be verified.',
      });
    }

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_LOGIN_BODY_BYTES) {
      return problemResponse({
        type: 'https://marcom.internal/problems/request-too-large',
        title: 'Request too large',
        status: 413,
        detail: 'The login request exceeds the allowed size.',
      });
    }

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return problemResponse({
        type: 'https://marcom.internal/problems/unsupported-media-type',
        title: 'Unsupported media type',
        status: 415,
        detail: 'The login request must use application/json.',
      });
    }

    let body: unknown;
    try {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_LOGIN_BODY_BYTES) {
        return problemResponse({
          type: 'https://marcom.internal/problems/request-too-large',
          title: 'Request too large',
          status: 413,
          detail: 'The login request exceeds the allowed size.',
        });
      }
      body = JSON.parse(rawBody);
    } catch {
      return problemResponse({
        type: 'https://marcom.internal/problems/invalid-request',
        title: 'Invalid request',
        status: 400,
        detail: 'The request body must be valid JSON.',
      });
    }

    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse({
        type: 'https://marcom.internal/problems/invalid-request',
        title: 'Invalid request',
        status: 400,
        detail: 'The username or password format is invalid.',
      });
    }

    const authentication = await authenticatePasswordCredential({
      ...parsed.data,
      source: getRequestSource(request),
      authSecret: configuration.authSecret,
    });

    if (authentication.status === 'throttled') {
      return problemResponse(
        {
          type: 'https://marcom.internal/problems/login-unavailable',
          title: 'Login temporarily unavailable',
          status: 429,
          detail: 'The credentials could not be verified. Try again later.',
        },
        { 'Retry-After': String(authentication.retryAfterSeconds) },
      );
    }
    if (authentication.status === 'invalid') {
      return problemResponse({
        type: 'https://marcom.internal/problems/invalid-credentials',
        title: 'Login failed',
        status: 401,
        detail: 'The username or password is incorrect.',
      });
    }

    const session = await createSession({
      actor: authentication.actor,
      displayName: authentication.displayName,
      credentialVersion: authentication.credentialVersion,
      authSecret: configuration.authSecret,
    });
    const responseBody: SessionResponse = {
      authenticated: true,
      displayName: session.displayName,
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
    const response = NextResponse.json(responseBody, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
    setAuthCookies(
      response,
      session,
      getAuthCookieConfiguration(configuration.secureCookies),
    );
    return response;
  } catch (error) {
    return internalFailure(request, 'create', error);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const configuration = getAuthConfiguration();
    const cookieNames = getAuthCookieConfiguration(configuration.secureCookies);
    const token = getRequestCookie(request, cookieNames.sessionName);
    const session = token
      ? await validateSession(token, configuration.authSecret)
      : null;

    if (!session) {
      return problemResponse({
        type: 'https://marcom.internal/problems/authentication-required',
        title: 'Authentication required',
        status: 401,
        detail: 'A valid session is required.',
      });
    }

    const responseBody: SessionResponse = {
      authenticated: true,
      displayName: session.displayName,
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    };
    return NextResponse.json(responseBody, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return internalFailure(request, 'read', error);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const configuration = getAuthConfiguration();
    const cookieNames = getAuthCookieConfiguration(configuration.secureCookies);
    if (!validateRequestOrigin(request, configuration.appOrigin)) {
      return problemResponse({
        type: 'https://marcom.internal/problems/csrf-rejected',
        title: 'Request rejected',
        status: 403,
        detail: 'The request origin could not be verified.',
      });
    }

    const token = getRequestCookie(request, cookieNames.sessionName);
    const csrfCookie = getRequestCookie(request, cookieNames.csrfName);
    const csrfHeader = request.headers.get('x-csrf-token');
    const session = token
      ? await validateSession(token, configuration.authSecret)
      : null;

    if (!token || !session) {
      return problemResponse({
        type: 'https://marcom.internal/problems/authentication-required',
        title: 'Authentication required',
        status: 401,
        detail: 'A valid session is required.',
      });
    }
    if (
      !csrfCookie ||
      !csrfHeader ||
      !verifySessionCsrfToken(configuration.authSecret, csrfCookie, session.csrfTokenHash) ||
      !verifySessionCsrfToken(configuration.authSecret, csrfHeader, session.csrfTokenHash)
    ) {
      return problemResponse({
        type: 'https://marcom.internal/problems/csrf-rejected',
        title: 'Request rejected',
        status: 403,
        detail: 'The request verification token is missing or invalid.',
      });
    }

    await revokeSession(token, configuration.authSecret, 'User logout');
    const response = new NextResponse(null, { status: 204 });
    clearAuthCookies(response, cookieNames);
    return response;
  } catch (error) {
    return internalFailure(request, 'delete', error);
  }
}

