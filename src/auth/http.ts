import { NextResponse } from 'next/server';

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
}

export function problemResponse(problem: ProblemDetail, headers?: HeadersInit): NextResponse {
  return NextResponse.json(problem, {
    status: problem.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/problem+json',
      ...headers,
    },
  });
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function validateRequestOrigin(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    if (originUrl.origin === appOrigin) return true;

    const requestUrl = new URL(request.url);
    if (originUrl.origin === requestUrl.origin) return true;

    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const forwardedProto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
      requestUrl.protocol.replace(':', '');
    if (forwardedHost && originUrl.origin === `${forwardedProto}://${forwardedHost}`) {
      return true;
    }

    const appUrl = new URL(appOrigin);
    if (
      isLoopbackHost(originUrl.hostname) &&
      isLoopbackHost(appUrl.hostname) &&
      originUrl.port === appUrl.port &&
      originUrl.protocol === appUrl.protocol
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function getRequestSource(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

