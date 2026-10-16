export const RESEARCH_JOB_MAX_ATTEMPTS = 3;
export const RESEARCH_JOB_LEASE_MS = 45_000;
export const RESEARCH_JOB_HEARTBEAT_MS = 15_000;

export function researchRetryDelayMs(attemptCount: number): number {
  const boundedAttempt = Math.max(1, Math.min(attemptCount, RESEARCH_JOB_MAX_ATTEMPTS));
  return 30_000 * 2 ** (boundedAttempt - 1);
}

export function canRetryResearchJob(input: {
  retryable: boolean;
  attemptCount: number;
  maxAttempts: number;
}): boolean {
  return input.retryable && input.attemptCount < input.maxAttempts;
}
