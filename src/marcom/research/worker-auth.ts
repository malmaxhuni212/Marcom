import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_VERSION = 'v1';

function workerSecret(environment: Record<string, string | undefined> = process.env): string {
  const secret = environment.AUTH_SECRET?.trim();
  if (!secret) throw new Error('AUTH_SECRET is required to dispatch research jobs.');
  return secret;
}

export function signResearchJob(
  jobId: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  return createHmac('sha256', workerSecret(environment))
    .update(`marcom:research-worker:${SIGNATURE_VERSION}:${jobId}`, 'utf8')
    .digest('base64url');
}

export function verifyResearchJobSignature(
  jobId: string,
  suppliedSignature: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (!suppliedSignature) return false;
  const expected = Buffer.from(signResearchJob(jobId, environment), 'utf8');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
