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
  stripResearchJobCursor,
  toPublicResearchJobStatus,
  type ResearchJobProgress,
} from '@/marcom/research/job-contract';
import {
  canRetryResearchJob,
  RESEARCH_JOB_LEASE_MS,
  researchRetryDelayMs,
  STALE_QUEUED_JOB_RECOVERY_MS,
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

export async function reconcileStaleResearchJob(
  actor: ActorContext,
  campaignId: string,
  jobId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<{ needsDispatch: boolean }> {
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
      .for('update', { skipLocked: true })
      .limit(1);
    if (!row || TERMINAL_STATUSES.has(row.job.status)) {
      return { needsDispatch: false };
    }

    const now = new Date();
    if (row.job.cancelRequestedAt) {
      await markCancelled(transaction, row.job, row.runId, now);
      return { needsDispatch: false };
    }

    const expiredRunning = row.job.status === 'running'
      && (!row.job.leaseExpiresAt || row.job.leaseExpiresAt <= now);
    const readyRetry = (row.job.status === 'retry_scheduled' || row.job.status === 'waiting_rate_limit')
      && row.job.runAfter <= now;
    const staleQueued = row.job.status === 'queued'
      && row.job.runAfter <= now
      && (now.getTime() - row.job.updatedAt.getTime() >= STALE_QUEUED_JOB_RECOVERY_MS);

    if (!expiredRunning && !readyRetry && !staleQueued) {
      return { needsDispatch: false };
    }

    if ((expiredRunning || readyRetry) && row.job.attemptCount >= row.job.maxAttempts) {
      await markFailedWithoutLease(transaction, row.job, row.runId, now);
      return { needsDispatch: false };
    }

    if (expiredRunning) {
      const currentProgress = readResearchJobProgress(row.job.progress);
      await transaction.update(jobs).set({
        status: 'retry_scheduled',
        runAfter: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        progress: {
          ...currentProgress,
          message: `Resuming interrupted batch (${currentProgress.completed} of ${currentProgress.requested} saved)…`,
        },
        updatedAt: now,
      }).where(eq(jobs.id, jobId));
    } else {
      await transaction.update(jobs).set({
        runAfter: now,
        updatedAt: now,
      }).where(eq(jobs.id, jobId));
    }

    return { needsDispatch: true };
  });
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

    const isFailureRecovery = expiredRunningJob || row.job.status === 'retry_scheduled';
    const shouldIncrementAttempt = isFailureRecovery || row.job.attemptCount === 0;
    if (shouldIncrementAttempt && row.job.attemptCount >= row.job.maxAttempts) {
      await markFailedWithoutLease(transaction, row.job, row.runId, now);
      return null;
    }

    const attemptCount = shouldIncrementAttempt ? row.job.attemptCount + 1 : row.job.attemptCount;
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
  const current = readResearchJobProgress(job.progress);
  const progress = stripResearchJobCursor({
    ...current,
    message: current.completed > 0
      ? `Research stopped. Saved ${current.completed} of ${current.requested} prospects.`
      : 'Research was cancelled.',
  });
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
  const current = readResearchJobProgress(job.progress);
  const hasSavedProspects = current.completed > 0;
  const status = hasSavedProspects ? 'completed_with_errors' : 'failed';
  const message = hasSavedProspects
    ? `Saved ${current.completed} of ${current.requested} prospects before reaching the retry limit.`
    : 'Research stopped after reaching its retry limit.';
  const progress = stripResearchJobCursor({
    ...current,
    message,
  });
  await transaction.update(researchRuns).set({
    failedCount: progress.failed,
    completedAt: now,
  }).where(eq(researchRuns.id, researchRunId));
  await transaction.update(jobs).set({
    status,
    completedAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCategory: 'RESEARCH_RETRY_LIMIT_REACHED',
    errorDetail: message,
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

export async function yieldResearchJobChunk(
  claimed: ClaimedResearchJob,
  progressPatch: Partial<ResearchJobProgress>,
  database: MarcomDatabase = getDatabase(),
): Promise<'continue' | 'cancelled'> {
  return database.transaction(async (transaction) => {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, claimed.jobId), eq(jobs.jobType, RESEARCH_JOB_TYPE)))
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

    const progress = readResearchJobProgress({
      ...readResearchJobProgress(job.progress),
      ...progressPatch,
    });
    await transaction.update(jobs).set({
      status: 'queued',
      attemptCount: 1,
      runAfter: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      progress,
      updatedAt: now,
    }).where(eq(jobs.id, claimed.jobId));
    return 'continue';
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
    const progress = stripResearchJobCursor({
      ...readResearchJobProgress(job.progress),
      failed: failedCount,
      message,
    });
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
): Promise<'retry_scheduled' | 'completed_with_errors' | 'failed' | 'cancelled'> {
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

    const hasSavedProspects = progress.completed > 0;
    const finalStatus = hasSavedProspects ? 'completed_with_errors' : 'failed';
    const finalMessage = hasSavedProspects
      ? `Saved ${progress.completed} of ${progress.requested} prospects before stopping: ${failure.message}`
      : failure.message;
    await transaction.update(researchRuns).set({ failedCount, completedAt: now }).where(eq(researchRuns.id, claimed.researchRunId));
    await transaction.update(jobs).set({
      status: finalStatus,
      completedAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCategory: failure.code,
      errorDetail: failure.message,
      progress: stripResearchJobCursor({ ...progress, failed: failedCount, message: finalMessage }),
      updatedAt: now,
    }).where(eq(jobs.id, claimed.jobId));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: claimed.actor.workspaceId,
      campaignId: claimed.campaignId,
      actorType: 'system',
      action: hasSavedProspects ? 'research.completed' : 'research.failed',
      subjectType: 'research_run',
      subjectId: claimed.researchRunId,
      safeDiff: { errorCode: failure.code, failedCount, status: finalStatus },
      jobId: claimed.jobId,
    });
    return finalStatus;
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
    const priorStatus = row.job.status;
    await markCancelled(transaction, { ...row.job, cancelRequestedAt: now }, row.runId, now);
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'research.cancellation_requested',
      subjectType: 'research_run',
      subjectId: row.runId,
      safeDiff: { status: priorStatus },
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
      progress: stripResearchJobCursor({ ...readResearchJobProgress(row.job.progress), failed: 1, message }),
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
