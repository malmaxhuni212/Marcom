import { after, NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import {
  enqueueResearchRun,
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
import { readSearchConfiguration } from '@/marcom/search/registry';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

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
