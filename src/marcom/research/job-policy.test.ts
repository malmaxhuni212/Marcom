import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRetryResearchJob,
  researchRetryDelayMs,
} from './job-policy';
import {
  readResearchJobProgress,
  ResearchJobPayloadSchema,
  toPublicResearchJobStatus,
} from './job-contract';
import { signResearchJob, verifyResearchJobSignature } from './worker-auth';

test('research retry policy is bounded by the recorded maximum attempts', () => {
  assert.equal(canRetryResearchJob({ retryable: true, attemptCount: 1, maxAttempts: 3 }), true);
  assert.equal(canRetryResearchJob({ retryable: true, attemptCount: 3, maxAttempts: 3 }), false);
  assert.equal(canRetryResearchJob({ retryable: false, attemptCount: 1, maxAttempts: 3 }), false);
  assert.equal(researchRetryDelayMs(1), 30_000);
  assert.equal(researchRetryDelayMs(2), 60_000);
});

test('research job payload rejects unbounded or incomplete work', () => {
  assert.equal(ResearchJobPayloadSchema.safeParse({ schemaVersion: 1 }).success, false);
  assert.equal(ResearchJobPayloadSchema.safeParse({
    schemaVersion: 1,
    batchId: 'batch-1',
    batchNumber: 1,
    searchPlanVersionId: '10000000-0000-4000-8000-000000000010',
    targetId: 'publishers',
    requestedCount: 51,
  }).success, false);
});

test('public job status and progress hide persistence-specific failure naming', () => {
  assert.equal(toPublicResearchJobStatus('failed'), 'error');
  assert.deepEqual(readResearchJobProgress({ requested: 5, completed: 2 }), {
    requested: 5,
    discovered: 0,
    completed: 2,
    duplicatesSkipped: 0,
    failed: 0,
    message: 'Research is queued.',
    searchProvider: 'unresolved',
  });
});

test('background worker signatures are scoped to one job id', () => {
  const environment = { AUTH_SECRET: 'test-secret-with-sufficient-entropy-for-fixtures' };
  const jobId = '10000000-0000-4000-8000-000000000020';
  const signature = signResearchJob(jobId, environment);
  assert.equal(verifyResearchJobSignature(jobId, signature, environment), true);
  assert.equal(
    verifyResearchJobSignature('10000000-0000-4000-8000-000000000021', signature, environment),
    false,
  );
});
