import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import {
  enqueueResearchRun,
  findDuplicate,
  getNextBatchInfo,
  ResearchJobIdempotencyConflictError,
} from '@/db/repositories/research-repository';
import {
  getResearchJobStatus,
  markResearchJobDispatchFailed,
  requestResearchJobCancellation,
} from '@/db/repositories/research-job-repository';
import { runQueuedResearchJob } from '@/marcom/research/job-runner';
import { safeResearchLog } from '@/marcom/research/safe-error';
import { signResearchJob } from '@/marcom/research/worker-auth';
import { readSearchConfiguration, resolveSearchProvider } from '@/marcom/search/registry';
import { isDatabaseConfigured } from '@/db/env';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import {
  getNextBatchInfo as getFileNextBatch,
  listResearch as listFileResearch,
  saveResearch as saveFileResearch,
} from '@/marcom/memory/research-store';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { runResearchAgent } from '@/marcom/agents/research/agent';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

interface LocalBatchTask {
  total: number;
  discovered: number;
  completed: number;
  duplicatesSkipped: number;
  failed: number;
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  message: string;
  searchProvider: string;
  researchRunId: string;
  cancelled?: boolean;
}

const localTasks = ((globalThis as unknown as { __marcomLocalBatchTasks?: Map<string, LocalBatchTask> })
  .__marcomLocalBatchTasks ??= new Map<string, LocalBatchTask>());

async function dispatchResearchJob(request: Request, jobId: string): Promise<void> {
  if (process.env.NETLIFY === 'true') {
    const endpoint = new URL('/.netlify/functions/research-worker-background', request.url);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Marcom-Job-Signature': signResearchJob(jobId),
      },
      body: JSON.stringify({ jobId }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Research worker dispatch failed with status ${response.status}.`);
    }
    return;
  }

  after(async () => {
    try {
      await runQueuedResearchJob(jobId);
    } catch (error) {
      safeResearchLog('research.local_worker.crashed', error);
    }
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  const access = await authorizeApiRequest(request);
  if (!access.ok) return access.response;
  const { id: campaignId } = await params;
  const body = await request.json().catch(() => ({}));
  const count = Number(body.count);
  const targetId = typeof body.target_id === 'string' ? body.target_id.trim() : '';
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';

  let searchConfig;
  try {
    searchConfig = readSearchConfiguration();
  } catch (error) {
    safeResearchLog('research.configuration.invalid', error);
    return NextResponse.json(
      { error: 'Research providers are not configured correctly.' },
      { status: 500 },
    );
  }

  const maximumResults = Math.min(50, searchConfig.SEARCH_MAX_RESULTS);
  if (!Number.isInteger(count) || count < 1 || count > maximumResults) {
    return NextResponse.json(
      { error: `count must be an integer between 1 and ${maximumResults}.` },
      { status: 400 },
    );
  }
  if (!targetId) {
    return NextResponse.json({ error: 'target_id is required.' }, { status: 400 });
  }
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    const taskId = randomUUID();
    const batchInfo = getFileNextBatch(campaignId);
    const task: LocalBatchTask = {
      total: count,
      discovered: 0,
      completed: 0,
      duplicatesSkipped: 0,
      failed: 0,
      status: 'queued',
      message: `Starting research for up to ${count} prospects...`,
      searchProvider: searchConfig.SEARCH_PROVIDER,
      researchRunId: taskId,
    };
    localTasks.set(taskId, task);

    after(async () => {
      try {
        task.status = 'running';
        const store = new JsonFileMemoryStore();
        const project = store.projects().find((p) => p.project_id === campaignId);
        if (!project?.structured_brief) {
          task.status = 'failed';
          task.message = 'Project brief not found.';
          return;
        }
        const target =
          project.structured_brief.targets.find((t) => t.id === targetId) ??
          project.structured_brief.targets[0];
        if (!target) {
          task.status = 'failed';
          task.message = 'Research target not found.';
          return;
        }

        const llmProvider = new GroqProvider();
        const searchProvider = resolveSearchProvider(searchConfig, llmProvider);

        let consecutiveEmpty = 0;
        while (task.completed < count && !task.cancelled) {
          const remaining = count - task.completed;
          task.message = `Searching for ${remaining} more prospect candidate(s)...`;
          const existing = listFileResearch(campaignId);
          const discovery = await discoverProspectSeeds({
            brief: project.structured_brief,
            target,
            desiredCount: remaining,
            searchProvider,
            llmProvider,
            existingNames: existing.flatMap((e) => [e.seed.name, e.record.identity.name ?? '']),
            existingUrls: existing.flatMap((e) => [e.seed.website ?? '', e.record.websites?.[0]?.url ?? '']),
          });

          task.discovered += discovery.seeds.length;
          task.duplicatesSkipped += discovery.duplicateCount;

          if (!discovery.seeds.length) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 2) {
              task.status = task.completed > 0 ? 'completed' : 'completed_with_errors';
              task.message = `Search exhausted. Saved ${task.completed} of ${count} prospects.`;
              return;
            }
            continue;
          }
          consecutiveEmpty = 0;

          for (const seed of discovery.seeds) {
            if (task.completed >= count || task.cancelled) break;
            task.message = `Researching candidate: ${seed.name}...`;
            const currentEntries = listFileResearch(campaignId);
            if (findDuplicate(currentEntries, seed)) {
              task.duplicatesSkipped++;
              continue;
            }

            try {
              const entry = await runResearchAgent({
                projectId: campaignId,
                brief: project.structured_brief,
                targetId: target.id,
                seed,
                store,
                searchProvider,
                llmProvider,
              });
              saveFileResearch(campaignId, {
                ...entry,
                batch_id: batchInfo.batch_id,
                batch_number: batchInfo.batch_number,
              });
              task.completed++;
              task.message = `Saved ${task.completed} of ${count} prospects.`;
            } catch (agentError) {
              task.failed++;
              console.error('Candidate research error:', agentError);
            }
          }
        }

        if (task.cancelled) {
          task.status = 'cancelled';
          task.message = 'Research was cancelled.';
        } else {
          task.status =
            task.failed > 0 && task.completed === 0
              ? 'failed'
              : task.failed > 0
              ? 'completed_with_errors'
              : 'completed';
          task.message = `Research complete. Saved ${task.completed} of ${count} prospects.`;
        }
      } catch (err) {
        console.error('Local batch research failure:', err);
        task.status = 'failed';
        task.message = err instanceof Error ? err.message : 'Research failed';
      }
    });

    return NextResponse.json(
      {
        success: true,
        taskId,
        job: {
          id: taskId,
          type: 'research.run.v1',
          status: 'queued',
          statusUrl: `/api/projects/${campaignId}/batch-research?taskId=${taskId}`,
        },
        message: `Queued bounded research for up to ${count} prospects.`,
      },
      { status: 202 },
    );
  }

  let queued;
  try {
    const batch = await getNextBatchInfo(access.actor, campaignId);
    queued = await enqueueResearchRun(
      access.actor,
      campaignId,
      batch,
      count,
      targetId,
      idempotencyKey,
      searchConfig.SEARCH_PROVIDER,
    );
  } catch (error) {
    if (error instanceof ResearchJobIdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    safeResearchLog('research.enqueue_or_dispatch.failed', error);
    return NextResponse.json(
      { error: 'Research could not be queued. Please try again.' },
      { status: 503 },
    );
  }

  try {
    await dispatchResearchJob(request, queued.jobId);
  } catch (error) {
    safeResearchLog('research.dispatch.failed', error);
    await markResearchJobDispatchFailed(access.actor, campaignId, queued.jobId).catch((persistenceError) => {
      safeResearchLog('research.dispatch_failure_persistence.failed', persistenceError);
    });
    return NextResponse.json(
      { error: 'The research worker could not be started. Please try again.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    success: true,
    taskId: queued.jobId,
    job: {
      id: queued.jobId,
      type: 'research.run.v1',
      status: 'queued',
      statusUrl: `/api/projects/${campaignId}/batch-research?taskId=${queued.jobId}`,
    },
    message: queued.created
      ? `Queued bounded research for up to ${count} prospects.`
      : 'The existing research request was returned safely.',
  }, { status: 202 });
}

export async function GET(request: Request, { params }: RouteContext) {
  const access = await authorizeApiRequest(request);
  if (!access.ok) return access.response;
  const { id: campaignId } = await params;
  const taskId = new URL(request.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    const task = localTasks.get(taskId);
    return task
      ? NextResponse.json(task)
      : NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  try {
    const task = await getResearchJobStatus(access.actor, campaignId, taskId);
    return task
      ? NextResponse.json(task)
      : NextResponse.json({ error: 'Task not found' }, { status: 404 });
  } catch (error) {
    safeResearchLog('research.status.failed', error);
    return NextResponse.json({ error: 'Research status is temporarily unavailable.' }, { status: 503 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const access = await authorizeApiRequest(request);
  if (!access.ok) return access.response;
  const { id: campaignId } = await params;
  const taskId = new URL(request.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    const task = localTasks.get(taskId);
    if (task) {
      task.cancelled = true;
      task.status = 'cancelled';
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  try {
    const found = await requestResearchJobCancellation(access.actor, campaignId, taskId);
    return found
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Task not found' }, { status: 404 });
  } catch (error) {
    safeResearchLog('research.cancel.failed', error);
    return NextResponse.json({ error: 'Cancellation could not be recorded.' }, { status: 503 });
  }
}
