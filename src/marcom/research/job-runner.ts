import { randomUUID } from 'node:crypto';
import { runResearchAgent } from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { createServerMemoryStore } from '@/marcom/memory/server-store';
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
  type ClaimedResearchJob,
} from '@/db/repositories/research-job-repository';
import { RESEARCH_JOB_HEARTBEAT_MS } from './job-policy';
import type { ResearchJobProgress } from './job-contract';
import {
  PermanentResearchError,
  safeResearchLog,
  toSafeResearchFailure,
} from './safe-error';

export type ResearchJobRunResult =
  | { status: 'not_claimed' }
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
  const deadline = Date.now() + 13 * 60_000;
  const maximumCandidateFailures = Math.max(3, claimed.payload.requestedCount * 2);

  const checkpoint = async (message: string): Promise<boolean> => {
    if (heartbeatFailure) throw heartbeatFailure;
    if (Date.now() >= deadline) {
      throw new Error('The bounded research execution window was reached.');
    }
    return cancelledAtCheckpoint(claimed, {
      requested: claimed.payload.requestedCount,
      discovered,
      completed,
      duplicatesSkipped,
      failed,
      message,
    });
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

    const llmProvider = new GroqProvider();
    const searchConfig = readSearchConfiguration();
    const searchProvider = resolveSearchProvider(searchConfig, llmProvider);
    claimed.progress.searchProvider = searchProvider.key;
    if (await checkpoint('Preparing the approved research plan...')) return { status: 'cancelled' };

    let consecutiveEmptyDiscoveries = 0;
    while (completed < claimed.payload.requestedCount) {
      if (failed >= maximumCandidateFailures) {
        const message = `Research stopped after ${failed} candidate failures. Saved ${completed} of ${claimed.payload.requestedCount} prospects.`;
        const status = await finishResearchJob(claimed, failed, message);
        return { status };
      }
      const remainingToFind = claimed.payload.requestedCount - completed;
      if (await checkpoint(`Searching for ${remainingToFind} more prospect candidates...`)) {
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
      });

      discovered += discovery.seeds.length;
      duplicatesSkipped += discovery.duplicateCount;
      if (!discovery.seeds.length) {
        consecutiveEmptyDiscoveries += 1;
        if (consecutiveEmptyDiscoveries >= 2) {
          const message = `Search exhausted. Saved ${completed} of ${claimed.payload.requestedCount} prospects.`;
          const status = await finishResearchJob(claimed, failed, message);
          return { status };
        }
        continue;
      }
      consecutiveEmptyDiscoveries = 0;

      for (const seed of discovery.seeds) {
        if (completed >= claimed.payload.requestedCount) break;
        if (await checkpoint(`Checking ${seed.name}...`)) return { status: 'cancelled' };

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
              void heartbeatResearchJob(claimed.jobId, claimed.leaseOwner, { message }).catch((error) => {
                heartbeatFailure = error;
              });
            },
          });
          entry.batch_id = claimed.payload.batchId;
          entry.batch_number = claimed.payload.batchNumber;
          await saveResearch(claimed.actor, claimed.campaignId, claimed.researchRunId, entry);
          completed += 1;
        } catch (error) {
          safeResearchLog('research.candidate.failed', error);
          await recordResearchCandidateFailure(claimed, seed, toSafeResearchFailure(error));
          failed += 1;
        }
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
    return status === 'cancelled'
      ? { status }
      : { status, errorCode: failure.code };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
