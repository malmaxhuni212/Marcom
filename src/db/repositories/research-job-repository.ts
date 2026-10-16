import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '../client';
import type { ActorContext } from '../local-actor';
import {
  auditEvents,
  jobItems,
  jobs,
  researchRuns,
  workspaceMemberships,
} from '../schema';
import {
  readResearchJobProgress,
  ResearchJobPayloadSchema,
  toPublicResearchJobStatus,
  type ResearchJobProgress,
} from '@/marcom/research/job-contract';
import {
  canRetryResearchJob,
  RESEARCH_JOB_LEASE_MS,
  researchRetryDelayMs,
} from '@/marcom/research/job-policy';
import type { SafeResearchFailure } from '@/marcom/research/safe-error';
import type { ProspectSeed } from '@/marcom/schemas/research-record';

const RESEARCH_JOB_TYPE = 'research.run.v1';
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);
const CLAIMABLE_STATUSES = new Set(['queued', 'retry_scheduled', 'waiting_rate_limit']);

export class ResearchJobLeaseLostError extends Error {}

export interface ClaimedResearchJob {
  jobId: string;
  researchRunId: string;
  campaignId: string;
  actor: ActorContext;
  leaseOwner: string;
  payload: ReturnType<typeof ResearchJobPayloadSchema.parse>;
  progress: ResearchJobProgress;
  attemptCount: number;
  maxAttempts: number;
}

export interface PublicResearchJob {
  total: number;
  discovered: number;
  completed: number;
  duplicatesSkipped: number;
  failed: number;
  status: ReturnType<typeof toPublicResearchJobStatus>;
  message: string;
  searchProvider: string;
  researchRunId: string;
  errorCode?: string;
  retryable?: boolean;
  attemptCount: number;
  maxAttempts: number;
}

export async function getResearchJobStatus(
  actor: ActorContext,
  campaignId: string,
  jobId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<PublicResearchJob | null> {
  const [row] = await database
    .select({ job: jobs, runId: researchRuns.id })
    .from(jobs)
    .innerJoin(researchRuns, eq(researchRuns.jobId, jobs.id))
    .where(and(
      eq(jobs.id, jobId),
      eq(jobs.workspaceId, actor.workspaceId),
      eq(jobs.campaignId, campaignId),
      eq(jobs.jobType, RESEARCH_JOB_TYPE),
    ))
    .limit(1);
  if (!row) return null;

  const progress = readResearchJobProgress(row.job.progress);
  const status = toPublicResearchJobStatus(row.job.status);
  return {
    total: progress.requested,
    discovered: progress.discovered,
    completed: progress.completed,
    duplicatesSkipped: progress.duplicatesSkipped,
    failed: progress.failed,
    status,
    message: progress.message,
    searchProvider: progress.searchProvider,
    researchRunId: row.runId,
    errorCode: row.job.errorCategory ?? undefined,
    retryable: status === 'retry_scheduled' || status === 'waiting_rate_limit',
    attemptCount: row.job.attemptCount,
    maxAttempts: row.job.maxAttempts,
  };
}

export async function claimResearchJob(
  jobId: string,
  leaseOwner: string,
  database: MarcomDatabase = getDatabase(),
): Promise<ClaimedResearchJob | null> {
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ job: jobs, runId: researchRuns.id, userId: workspaceMemberships.userId })
      .from(jobs)
      .innerJoin(researchRuns, eq(researchRuns.jobId, jobs.id))
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.id, jobs.createdByMembershipId),
          eq(workspaceMemberships.workspaceId, jobs.workspaceId),
        ),
      )
      .where(and(eq(jobs.id, jobId), eq(jobs.jobType, RESEARCH_JOB_TYPE)))
      .for('update', { skipLocked: true })
      .limit(1);
    if (!row) return null;

    const now = new Date();
    if (TERMINAL_STATUSES.has(row.job.status)) return null;
    if (row.job.cancelRequestedAt) {
      await markCancelled(transaction, row.job, row.runId, now);
      return null;
    }

    const expiredRunningJob = row.job.status === 'running'
      && (!row.job.leaseExpiresAt || row.job.leaseExpiresAt <= now);
    const readyQueuedJob = CLAIMABLE_STATUSES.has(row.job.status) && row.job.runAfter <= now;
    if (!expiredRunningJob && !readyQueuedJob) return null;

    if (row.job.attemptCount >= row.job.maxAttempts) {
      await markFailedWithoutLease(transaction, row.job, row.runId, now);
      return null;
    }

    const attemptCount = row.job.attemptCount + 1;
    await transaction
      .update(jobs)
      .set({
        status: 'running',
        attemptCount,
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + RESEARCH_JOB_LEASE_MS),
        heartbeatAt: now,
        startedAt: row.job.startedAt ?? now,
        errorCategory: null,
        errorDetail: null,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));

    return {
      jobId,
      researchRunId: row.runId,
      campaignId: row.job.campaignId!,
      actor: {
        workspaceId: row.job.workspaceId,
        userId: row.userId,
        membershipId: row.job.createdByMembershipId!,
      },
      leaseOwner,
      payload: ResearchJobPayloadSchema.parse(row.job.payload),
      progress: readResearchJobProgress(row.job.progress),
      attemptCount,
      maxAttempts: row.job.maxAttempts,
    };
  });
}

type JobTransaction = Parameters<Parameters<MarcomDatabase['transaction']>[0]>[0];
type JobRow = typeof jobs.$inferSelect;

async function markCancelled(
  transaction: JobTransaction,
  job: JobRow,
  researchRunId: string,
  now: Date,
): Promise<void> {
  const progress = {
    ...readResearchJobProgress(job.progress),
    message: 'Research was cancelled.',
  };
  await transaction.update(researchRuns).set({ completedAt: now }).where(eq(researchRuns.id, researchRunId));
  await transaction.update(jobs).set({
    status: 'cancelled',
    cancelRequestedAt: job.cancelRequestedAt ?? now,
    completedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    progress,
    updatedAt: now,
  }).where(eq(jobs.id, job.id));
}

async function markFailedWithoutLease(
  transaction: JobTransaction,
  job: JobRow,
  researchRunId: string,
  now: Date,
): Promise<void> {
  const progress = {
    ...readResearchJobProgress(job.progress),
    message: 'Research stopped after reaching its retry limit.',
  };
  await transaction.update(researchRuns).set({
    failedCount: progress.failed,
    completedAt: now,
  }).where(eq(researchRuns.id, researchRunId));
  await transaction.update(jobs).set({
    status: 'failed',
    completedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCategory: 'RESEARCH_RETRY_LIMIT_REACHED',
    errorDetail: 'Research stopped after reaching its retry limit.',
    progress,
    updatedAt: now,
  }).where(eq(jobs.id, job.id));
}

export async function heartbeatResearchJob(
  jobId: string,
  leaseOwner: string,
  progressPatch: Partial<ResearchJobProgress> = {},
  database: MarcomDatabase = getDatabase(),
): Promise<{ cancelRequested: boolean }> {
  return database.transaction(async (transaction) => {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.jobType, RESEARCH_JOB_TYPE)))
      .for('update')
      .limit(1);
    if (!job || job.status !== 'running' || job.leaseOwner !== leaseOwner) {
      throw new ResearchJobLeaseLostError('The research job lease is no longer owned by this worker.');
    }
    const now = new Date();
    await transaction.update(jobs).set({
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + RESEARCH_JOB_LEASE_MS),
      progress: { ...readResearchJobProgress(job.progress), ...progressPatch },
      updatedAt: now,
    }).where(eq(jobs.id, jobId));
    return { cancelRequested: Boolean(job.cancelRequestedAt) };
  });
}

export async function recordResearchCandidateFailure(
  claimed: ClaimedResearchJob,
  seed: ProspectSeed,
  failure: SafeResearchFailure,
  database: MarcomDatabase = getDatabase(),
): Promise<void> {
  const now = new Date();
  const itemKey = `candidate:${createHash('sha256')
    .update(`${seed.name}\n${seed.website ?? ''}\n${seed.linkedin ?? ''}`, 'utf8')
    .digest('hex')}`.slice(0, 240);
  await database.insert(jobItems).values({
    id: randomUUID(),
    jobId: claimed.jobId,
    itemKey,
    status: 'failed',
    input: {
      name: seed.name,
      website: seed.website ?? null,
      linkedin: seed.linkedin ?? null,
      entityKind: seed.entity_kind ?? 'unknown',
    },
    attemptCount: 1,
    errorCategory: failure.code,
    errorDetail: failure.message,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [jobItems.jobId, jobItems.itemKey],
    set: {
      status: 'failed',
      attemptCount: sql`${jobItems.attemptCount} + 1`,
      errorCategory: failure.code,
      errorDetail: failure.message,
      completedAt: now,
      updatedAt: now,
    },
  });
}

export async function finishResearchJob(
  claimed: ClaimedResearchJob,
  failedCount: number,
  message: string,
  database: MarcomDatabase = getDatabase(),
): Promise<'completed' | 'completed_with_errors' | 'cancelled'> {
  return database.transaction(async (transaction) => {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(eq(jobs.id, claimed.jobId))
      .for('update')
      .limit(1);
    if (!job || job.status !== 'running' || job.leaseOwner !== claimed.leaseOwner) {
      throw new ResearchJobLeaseLostError('The research job lease is no longer owned by this worker.');
    }
    const now = new Date();
    if (job.cancelRequestedAt) {
      await markCancelled(transaction, job, claimed.researchRunId, now);
      return 'cancelled';
    }

    const status = failedCount > 0 ? 'completed_with_errors' : 'completed';
    const progress = { ...readResearchJobProgress(job.progress), failed: failedCount, message };
    await transaction.update(researchRuns).set({ failedCount, completedAt: now }).where(eq(researchRuns.id, claimed.researchRunId));
    await transaction.update(jobs).set({
      status,
      progress,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      updatedAt: now,
    }).where(eq(jobs.id, claimed.jobId));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: claimed.actor.workspaceId,
      campaignId: claimed.campaignId,
      actorType: 'system',
      action: 'research.completed',
      subjectType: 'research_run',
      subjectId: claimed.researchRunId,
      safeDiff: { status, failedCount },
      jobId: claimed.jobId,
    });
    return status;
  });
}

export async function failOrRetryResearchJob(
  claimed: ClaimedResearchJob,
  failure: SafeResearchFailure,
  failedCount: number,
  database: MarcomDatabase = getDatabase(),
): Promise<'retry_scheduled' | 'failed' | 'cancelled'> {
  return database.transaction(async (transaction) => {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(eq(jobs.id, claimed.jobId))
      .for('update')
      .limit(1);
    if (!job || job.status !== 'running' || job.leaseOwner !== claimed.leaseOwner) {
      throw new ResearchJobLeaseLostError('The research job lease is no longer owned by this worker.');
    }
    const now = new Date();
    if (job.cancelRequestedAt) {
      await markCancelled(transaction, job, claimed.researchRunId, now);
      return 'cancelled';
    }

    const progress = readResearchJobProgress(job.progress);
    if (canRetryResearchJob({
      retryable: failure.retryable,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
    })) {
      await transaction.update(jobs).set({
        status: 'retry_scheduled',
        runAfter: new Date(now.getTime() + researchRetryDelayMs(job.attemptCount)),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCategory: failure.code,
        errorDetail: failure.message,
        progress: { ...progress, failed: failedCount, message: `${failure.message} Retrying automatically.` },
        updatedAt: now,
      }).where(eq(jobs.id, claimed.jobId));
      return 'retry_scheduled';
    }

    await transaction.update(researchRuns).set({ failedCount, completedAt: now }).where(eq(researchRuns.id, claimed.researchRunId));
    await transaction.update(jobs).set({
      status: 'failed',
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCategory: failure.code,
      errorDetail: failure.message,
      progress: { ...progress, failed: failedCount, message: failure.message },
      updatedAt: now,
    }).where(eq(jobs.id, claimed.jobId));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: claimed.actor.workspaceId,
      campaignId: claimed.campaignId,
      actorType: 'system',
      action: 'research.failed',
      subjectType: 'research_run',
      subjectId: claimed.researchRunId,
      safeDiff: { errorCode: failure.code, failedCount },
      jobId: claimed.jobId,
    });
    return 'failed';
  });
}

export async function requestResearchJobCancellation(
  actor: ActorContext,
  campaignId: string,
  jobId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ job: jobs, runId: researchRuns.id })
      .from(jobs)
      .innerJoin(researchRuns, eq(researchRuns.jobId, jobs.id))
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.workspaceId, actor.workspaceId),
        eq(jobs.campaignId, campaignId),
        eq(jobs.jobType, RESEARCH_JOB_TYPE),
      ))
      .for('update')
      .limit(1);
    if (!row) return false;
    if (TERMINAL_STATUSES.has(row.job.status)) return true;

    const now = new Date();
    if (row.job.status === 'running') {
      await transaction.update(jobs).set({
        cancelRequestedAt: now,
        progress: { ...readResearchJobProgress(row.job.progress), message: 'Cancellation requested.' },
        updatedAt: now,
      }).where(eq(jobs.id, jobId));
    } else {
      await markCancelled(transaction, { ...row.job, cancelRequestedAt: now }, row.runId, now);
    }
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'research.cancellation_requested',
      subjectType: 'research_run',
      subjectId: row.runId,
      safeDiff: { status: row.job.status },
      jobId,
    });
    return true;
  });
}

export async function markResearchJobDispatchFailed(
  actor: ActorContext,
  campaignId: string,
  jobId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ job: jobs, runId: researchRuns.id })
      .from(jobs)
      .innerJoin(researchRuns, eq(researchRuns.jobId, jobs.id))
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.workspaceId, actor.workspaceId),
        eq(jobs.campaignId, campaignId),
        eq(jobs.jobType, RESEARCH_JOB_TYPE),
      ))
      .for('update')
      .limit(1);
    if (!row || row.job.status !== 'queued') return;

    const now = new Date();
    const message = 'The research worker could not be started. Please try the request again.';
    await transaction.update(researchRuns).set({ failedCount: 1, completedAt: now }).where(eq(researchRuns.id, row.runId));
    await transaction.update(jobs).set({
      status: 'failed',
      completedAt: now,
      errorCategory: 'RESEARCH_WORKER_DISPATCH_FAILED',
      errorDetail: message,
      progress: { ...readResearchJobProgress(row.job.progress), failed: 1, message },
      updatedAt: now,
    }).where(eq(jobs.id, jobId));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'system',
      action: 'research.dispatch_failed',
      subjectType: 'research_run',
      subjectId: row.runId,
      safeDiff: { errorCode: 'RESEARCH_WORKER_DISPATCH_FAILED' },
      jobId,
    });
  });
}
