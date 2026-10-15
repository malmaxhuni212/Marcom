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

export function validateRequestOrigin(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    return new URL(origin).origin === appOrigin;
  } catch {
    return false;
  }
}

export function getRequestSource(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

