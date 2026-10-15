import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  BOOTSTRAP_TOKEN_HEADER,
  getAuthBootstrapConfiguration,
  verifyBootstrapSecret,
} from '@/auth/bootstrap';
import {
  BootstrapCredentialRequestSchema,
  type BootstrapCredentialResponse,
} from '@/auth/contracts';
import { getAuthConfiguration } from '@/auth/config';
import {
  bootstrapSharedPilotCredential,
  PilotWorkspaceUnavailableError,
  SharedPilotAlreadyConfiguredError,
} from '@/auth/credentials';
import { problemResponse, validateRequestOrigin } from '@/auth/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BOOTSTRAP_BODY_BYTES = 4096;

function requestId(request: Request): string {
  const submitted = request.headers.get('x-request-id');
  return submitted &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      submitted,
    )
    ? submitted
    : randomUUID();
}

function unavailable(): NextResponse {
  return problemResponse({
    type: 'https://marcom.internal/problems/not-found',
    title: 'Not found',
    status: 404,
    detail: 'The requested resource is not available.',
  });
}

function invalidRequest(detail: string): NextResponse {
  return problemResponse({
    type: 'https://marcom.internal/problems/invalid-request',
    title: 'Invalid request',
    status: 400,
    detail,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const bootstrap = getAuthBootstrapConfiguration();
  if (
    !bootstrap ||
    !verifyBootstrapSecret(bootstrap.secret, request.headers.get(BOOTSTRAP_TOKEN_HEADER))
  ) {
    return unavailable();
  }

  const operationRequestId = requestId(request);

  try {
    const auth = getAuthConfiguration();
    if (!validateRequestOrigin(request, auth.appOrigin)) {
      return problemResponse({
        type: 'https://marcom.internal/problems/csrf-rejected',
        title: 'Request rejected',
        status: 403,
        detail: 'The request origin could not be verified.',
      });
    }

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > MAX_BOOTSTRAP_BODY_BYTES) {
      return problemResponse({
        type: 'https://marcom.internal/problems/request-too-large',
        title: 'Request too large',
        status: 413,
        detail: 'The bootstrap request exceeds the allowed size.',
      });
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return problemResponse({
        type: 'https://marcom.internal/problems/unsupported-media-type',
        title: 'Unsupported media type',
        status: 415,
        detail: 'The bootstrap request must use application/json.',
      });
    }

    let body: unknown;
    try {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BOOTSTRAP_BODY_BYTES) {
        return problemResponse({
          type: 'https://marcom.internal/problems/request-too-large',
          title: 'Request too large',
          status: 413,
          detail: 'The bootstrap request exceeds the allowed size.',
        });
      }
      body = JSON.parse(rawBody);
    } catch {
      return invalidRequest('The request body must be valid JSON.');
    }

    const parsed = BootstrapCredentialRequestSchema.safeParse(body);
    if (!parsed.success) {
      return invalidRequest('The bootstrap fields are missing or invalid.');
    }

    const result = await bootstrapSharedPilotCredential(parsed.data);
    const responseBody: BootstrapCredentialResponse = {
      configured: true,
      username: result.username,
      displayName: result.displayName,
      credentialVersion: result.credentialVersion,
    };

    console.info(
      JSON.stringify({
        event: 'auth.remote_bootstrap_completed',
        requestId: operationRequestId,
        userId: result.actor.userId,
      }),
    );
    return NextResponse.json(responseBody, {
      status: 201,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': operationRequestId },
    });
  } catch (error) {
    if (error instanceof SharedPilotAlreadyConfiguredError) {
      return problemResponse(
        {
          type: 'https://marcom.internal/problems/bootstrap-complete',
          title: 'Bootstrap already completed',
          status: 409,
          detail: 'Shared pilot access is already configured.',
        },
        { 'X-Request-Id': operationRequestId },
      );
    }
    if (error instanceof PilotWorkspaceUnavailableError) {
      return problemResponse(
        {
          type: 'https://marcom.internal/problems/bootstrap-foundation-unavailable',
          title: 'Bootstrap unavailable',
          status: 503,
          detail: 'The pilot workspace migration has not been applied.',
        },
        { 'X-Request-Id': operationRequestId },
      );
    }

    console.error(
      JSON.stringify({
        event: 'auth.remote_bootstrap_failed',
        requestId: operationRequestId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return problemResponse(
      {
        type: 'https://marcom.internal/problems/internal-error',
        title: 'Internal server error',
        status: 500,
        detail: 'The shared pilot credential could not be configured.',
      },
      { 'X-Request-Id': operationRequestId },
    );
  }
}
