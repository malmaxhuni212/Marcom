import { randomUUID } from 'node:crypto';
import { runResearchAgent } from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { createServerMemoryStore } from '@/marcom/memory/server-store';
import type { ProspectSeed } from '@/marcom/schemas/research-record';
import { readSearchConfiguration, resolveSearchProvider } from '@/marcom/search/registry';
import {
  findDuplicate,
  listResearch,
  saveResearch,
} from '@/db/repositories/research-repository';
import {
  claimResearchJob,
  failOrRetryResearchJob,
  finishResearchJob,
  heartbeatResearchJob,
  recordResearchCandidateFailure,
  ResearchJobLeaseLostError,
  yieldResearchJobChunk,
  type ClaimedResearchJob,
} from '@/db/repositories/research-job-repository';
import {
  MICRO_BATCH_PROSPECT_LIMIT,
  MICRO_BATCH_TIME_BUDGET_MS,
  RESEARCH_JOB_HEARTBEAT_MS,
} from './job-policy';
import type { ResearchJobProgress } from './job-contract';
import {
  PermanentResearchError,
  safeResearchLog,
  toSafeResearchFailure,
} from './safe-error';

export type ResearchJobRunResult =
  | { status: 'not_claimed' }
  | { status: 'continue' }
  | { status: 'completed' | 'completed_with_errors' | 'cancelled' }
  | { status: 'retry_scheduled' | 'failed'; errorCode: string };

async function cancelledAtCheckpoint(
  claimed: ClaimedResearchJob,
  patch: Partial<ResearchJobProgress>,
): Promise<boolean> {
  const state = await heartbeatResearchJob(claimed.jobId, claimed.leaseOwner, patch);
  if (!state.cancelRequested) return false;
  await finishResearchJob(claimed, patch.failed ?? claimed.progress.failed, 'Research was cancelled.');
  return true;
}

export async function runQueuedResearchJob(jobId: string): Promise<ResearchJobRunResult> {
  const leaseOwner = `research-worker:${randomUUID()}`;
  const claimed = await claimResearchJob(jobId, leaseOwner);
  if (!claimed) return { status: 'not_claimed' };

  let heartbeatFailure: unknown = null;
  let heartbeatInFlight = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || heartbeatFailure) return;
    heartbeatInFlight = true;
    heartbeatResearchJob(claimed.jobId, claimed.leaseOwner)
      .catch((error) => {
        heartbeatFailure = error;
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, RESEARCH_JOB_HEARTBEAT_MS);

  let failed = claimed.progress.failed;
  let discovered = claimed.progress.discovered;
  let completed = claimed.progress.completed;
  let duplicatesSkipped = claimed.progress.duplicatesSkipped;
  let pendingSeeds: ProspectSeed[] = [...(claimed.progress.pendingSeeds ?? [])];
  let iteration = claimed.progress.iteration ?? 0;
  let consecutiveEmptyDiscoveries = claimed.progress.consecutiveEmpty ?? 0;
  let processedInThisSlice = 0;

  const sliceStartedAt = Date.now();
  const deadline = sliceStartedAt + 13 * 60_000;
  const maximumCandidateFailures = Math.max(3, claimed.payload.requestedCount * 2);

  const buildProgressState = (message: string): ResearchJobProgress => ({
    requested: claimed.payload.requestedCount,
    discovered,
    completed,
    duplicatesSkipped,
    failed,
    message,
    searchProvider: claimed.progress.searchProvider,
    pendingSeeds,
    iteration,
    consecutiveEmpty: consecutiveEmptyDiscoveries,
  });

  const checkpoint = async (message: string): Promise<boolean> => {
    if (heartbeatFailure) throw heartbeatFailure;
    if (Date.now() >= deadline) {
      throw new Error('The bounded research execution window was reached.');
    }
    return cancelledAtCheckpoint(claimed, buildProgressState(message));
  };

  try {
    const store = await createServerMemoryStore(claimed.actor, false);
    const project = store.projects().find((candidate) => candidate.project_id === claimed.campaignId);
    if (!project?.structured_brief) {
      throw new PermanentResearchError(
        'RESEARCH_CAMPAIGN_UNAVAILABLE',
        'The campaign or its approved brief is no longer available.',
      );
    }
    const target = project.structured_brief.targets.find(
      (candidate) => candidate.id === claimed.payload.targetId,
    );
    if (!target) {
      throw new PermanentResearchError(
        'RESEARCH_TARGET_UNAVAILABLE',
        'The selected target is no longer present in the approved campaign configuration.',
      );
    }

    const llmProvider = new GroqProvider({
      onWait: (seconds) => {
        void heartbeatResearchJob(
          claimed.jobId,
          claimed.leaseOwner,
          buildProgressState(
            `Waiting ${seconds}s for AI rate-limit window (${completed} of ${claimed.payload.requestedCount} saved)…`,
          ),
        ).catch((error) => {
          heartbeatFailure = error;
        });
      },
    });
    const searchConfig = readSearchConfiguration();
    const searchProvider = resolveSearchProvider(searchConfig, llmProvider);
    claimed.progress.searchProvider = searchProvider.key;

    if (
      await checkpoint(
        completed > 0
          ? `Resuming batch (${completed} of ${claimed.payload.requestedCount} saved)…`
          : 'Preparing the approved research plan…',
      )
    ) {
      return { status: 'cancelled' };
    }

    while (completed < claimed.payload.requestedCount) {
      if (failed >= maximumCandidateFailures) {
        const message = `Research stopped after ${failed} candidate failures. Saved ${completed} of ${claimed.payload.requestedCount} prospects.`;
        const status = await finishResearchJob(claimed, failed, message);
        return { status };
      }

      const sliceElapsedMs = Date.now() - sliceStartedAt;
      if (
        processedInThisSlice >= MICRO_BATCH_PROSPECT_LIMIT
        || (processedInThisSlice > 0 && sliceElapsedMs >= MICRO_BATCH_TIME_BUDGET_MS)
      ) {
        const yieldStatus = await yieldResearchJobChunk(
          claimed,
          buildProgressState(
            `Saved ${completed} of ${claimed.payload.requestedCount} prospects — continuing next batch…`,
          ),
        );
        return { status: yieldStatus };
      }

      if (pendingSeeds.length === 0) {
        const remainingToFind = claimed.payload.requestedCount - completed;
        if (
          await checkpoint(
            completed > 0
              ? `Saved ${completed} of ${claimed.payload.requestedCount} — searching for ${remainingToFind} more…`
              : `Searching for up to ${remainingToFind} prospect candidates…`,
          )
        ) {
          return { status: 'cancelled' };
        }
        const existing = await listResearch(claimed.actor, claimed.campaignId);
        const discovery = await discoverProspectSeeds({
          brief: project.structured_brief,
          target,
          desiredCount: remainingToFind,
          searchProvider,
          llmProvider,
          existingNames: existing.flatMap((entry) => [entry.seed.name, entry.record.identity.name ?? '']),
          existingUrls: existing.flatMap((entry) => [entry.seed.website ?? '', entry.record.websites?.[0]?.url ?? '']),
          iteration,
        });
        iteration += 1;

        discovered += discovery.seeds.length;
        duplicatesSkipped += discovery.duplicateCount;
        if (!discovery.seeds.length) {
          consecutiveEmptyDiscoveries += 1;
          if (consecutiveEmptyDiscoveries >= 3) {
            const message = `Search exhausted. Saved ${completed} of ${claimed.payload.requestedCount} prospects.`;
            const status = await finishResearchJob(claimed, failed, message);
            return { status };
          }
          if (Date.now() - sliceStartedAt >= MICRO_BATCH_TIME_BUDGET_MS) {
            const yieldStatus = await yieldResearchJobChunk(
              claimed,
              buildProgressState(
                `Expanding search pass ${iteration + 1} (${completed} of ${claimed.payload.requestedCount} saved)…`,
              ),
            );
            return { status: yieldStatus };
          }
          continue;
        }
        consecutiveEmptyDiscoveries = 0;
        pendingSeeds = [...discovery.seeds];

        if (
          await checkpoint(
            `Discovered ${pendingSeeds.length} candidates (${completed} of ${claimed.payload.requestedCount} saved)…`,
          )
        ) {
          return { status: 'cancelled' };
        }
      }

      const seed = pendingSeeds.shift()!;
      if (
        await checkpoint(
          completed > 0
            ? `[${completed}/${claimed.payload.requestedCount} saved] Checking ${seed.name}…`
            : `Checking ${seed.name}…`,
        )
      ) {
        return { status: 'cancelled' };
      }

      if (findDuplicate(await listResearch(claimed.actor, claimed.campaignId), seed)) {
        duplicatesSkipped += 1;
        continue;
      }

      try {
        const entry = await runResearchAgent({
          projectId: claimed.campaignId,
          brief: project.structured_brief,
          targetId: claimed.payload.targetId,
          seed,
          store,
          searchProvider,
          llmProvider,
          onProgress: ({ message }) => {
            const formatted = completed > 0
              ? `[${completed}/${claimed.payload.requestedCount} saved] ${message}`
              : message;
            void heartbeatResearchJob(
              claimed.jobId,
              claimed.leaseOwner,
              buildProgressState(formatted),
            ).catch((error) => {
              heartbeatFailure = error;
            });
          },
        });
        entry.batch_id = claimed.payload.batchId;
        entry.batch_number = claimed.payload.batchNumber;
        const saved = await saveResearch(claimed.actor, claimed.campaignId, claimed.researchRunId, entry);
        if (!saved) {
          return { status: 'cancelled' };
        }
        completed += 1;
        processedInThisSlice += 1;

        const resolvedName = entry.record.identity.name ?? seed.name;
        if (
          await checkpoint(
            `Saved ${completed} of ${claimed.payload.requestedCount} prospects (${resolvedName}).`,
          )
        ) {
          return { status: 'cancelled' };
        }
      } catch (error) {
        if (error instanceof ResearchJobLeaseLostError) {
          throw error;
        }
        safeResearchLog('research.candidate.failed', error);
        await recordResearchCandidateFailure(claimed, seed, toSafeResearchFailure(error));
        failed += 1;
        processedInThisSlice += 1;
      }
    }

    const message = `Saved ${completed} of ${claimed.payload.requestedCount} requested prospects.`;
    const status = await finishResearchJob(claimed, failed, message);
    return { status };
  } catch (error) {
    if (error instanceof ResearchJobLeaseLostError) {
      safeResearchLog('research.job.lease_lost', error);
      return { status: 'not_claimed' };
    }
    const failure = toSafeResearchFailure(error);
    safeResearchLog('research.job.failed', error);
    const status = await failOrRetryResearchJob(claimed, failure, failed + 1);
    return status === 'cancelled' || status === 'completed_with_errors'
      ? { status }
      : { status, errorCode: failure.code };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
