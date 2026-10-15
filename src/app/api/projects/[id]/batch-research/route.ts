import { NextResponse } from 'next/server';
import { runResearchAgent } from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import {
  cancelResearchRun,
  completeResearchRun,
  findDuplicate,
  getNextBatchInfo,
  listResearch,
  saveResearch,
  startResearchRun,
} from '@/db/repositories/research-repository';
import type { ActorContext } from '@/db/local-actor';
import { authorizeApiRequest } from '@/auth/access';
import { createServerMemoryStore } from '@/marcom/memory/server-store';
import type { SearchProvider } from '@/marcom/search/provider';
import { readSearchConfiguration, resolveSearchProvider } from '@/marcom/search/registry';
import { safeResearchLog, toSafeResearchFailure } from '@/marcom/research/safe-error';

export const runtime = 'nodejs';

type TaskStatus = 'running' | 'completed' | 'completed_with_errors' | 'error' | 'cancelled';

type BackgroundTask = {
  total: number;
  discovered: number;
  completed: number;
  duplicatesSkipped: number;
  failed: number;
  status: TaskStatus;
  message: string;
  searchProvider: string;
  workspaceId: string;
  researchRunId?: string;
  errorCode?: string;
  retryable?: boolean;
};

const backgroundTasks = new Map<string, BackgroundTask>();

async function processBatch(
  projectId: string,
  targetId: string,
  count: number,
  taskId: string,
  searchProvider: SearchProvider,
  llmProvider: GroqProvider,
  actor: ActorContext,
  allowFileFallback: boolean,
) {
  const store = await createServerMemoryStore(actor, allowFileFallback);
  const project = store.projects().find((candidate) => candidate.project_id === projectId);
  const task = backgroundTasks.get(taskId);

  if (!project?.structured_brief || !task) {
    if (task) {
      task.status = 'error';
      task.message = 'Project or structured brief not found.';
    }
    return;
  }

  const target = project.structured_brief.targets.find((candidate) => candidate.id === targetId);
  if (!target) {
    task.status = 'error';
    task.message = 'Selected target was not found in the structured brief.';
    return;
  }

  const batchInfo = await getNextBatchInfo(actor, projectId);
  const researchRunId = await startResearchRun(actor, projectId, batchInfo, count, targetId);
  task.researchRunId = researchRunId;
  let consecutiveEmptyDiscoveries = 0;

  while (task.status === 'running' && task.completed < task.total) {
    const remainingToFind = task.total - task.completed;
    task.message = `Searching for ${remainingToFind} more prospect candidates...`;
    const existing = await listResearch(actor, projectId);
    
    let discovery;
    try {
      discovery = await discoverProspectSeeds({
        brief: project.structured_brief,
        target,
        desiredCount: remainingToFind,
        searchProvider,
        llmProvider,
        existingNames: existing.flatMap((entry) => [entry.seed.name, entry.record.identity.name ?? '']),
        existingUrls: existing.flatMap((entry) => [entry.seed.website ?? '', entry.record.websites?.[0]?.url ?? '']),
      });
    } catch (e) {
      const failure = toSafeResearchFailure(e);
      safeResearchLog('research.discovery.failed', e);
      task.status = 'error';
      task.message = failure.message;
      task.errorCode = failure.code;
      task.retryable = failure.retryable;
      await completeResearchRun(actor, researchRunId, task.failed + 1);
      return;
    }

    if (!discovery.seeds.length) {
      consecutiveEmptyDiscoveries++;
      if (consecutiveEmptyDiscoveries >= 2) {
        task.status = task.failed ? 'completed_with_errors' : 'completed';
        task.message = `Search exhausted. Saved ${task.completed} of ${task.total} prospects.`;
        await completeResearchRun(actor, researchRunId, task.failed);
        return;
      }
      continue;
    }
    consecutiveEmptyDiscoveries = 0;
    
    task.discovered += discovery.seeds.length;
    task.duplicatesSkipped += discovery.duplicateCount;

    for (const seed of discovery.seeds) {
      if ((task.status as TaskStatus) === 'cancelled') break;
      if (task.completed >= task.total) break;

      if (findDuplicate(await listResearch(actor, projectId), seed)) {
        task.duplicatesSkipped += 1;
        continue;
      }

      task.message = `Researching ${seed.name}...`;
      try {
        const entry = await runResearchAgent({
          projectId,
          brief: project.structured_brief,
          targetId,
          seed,
          store,
          searchProvider,
          llmProvider,
        });
        entry.batch_id = batchInfo.batch_id;
        entry.batch_number = batchInfo.batch_number;
        await saveResearch(actor, projectId, researchRunId, entry);
        task.completed += 1;
      } catch (error) {
        safeResearchLog('research.candidate.failed', error);
        task.failed += 1;
      }
    }
  }

  if (task.status === 'running') {
    task.status = task.failed ? 'completed_with_errors' : 'completed';
    task.message = `Saved ${task.completed} of ${task.total} requested prospects.`;
  }
  await completeResearchRun(actor, researchRunId, task.failed);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const count = Number(body.count);
  const targetId = typeof body.target_id === 'string' ? body.target_id.trim() : '';

  let searchProvider: SearchProvider;
  let maximumResults: number;
  const llmProvider = new GroqProvider();
  try {
    const config = readSearchConfiguration();
    maximumResults = config.SEARCH_MAX_RESULTS;
    searchProvider = resolveSearchProvider(config, llmProvider);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  if (!Number.isInteger(count) || count < 1 || count > maximumResults) {
    return NextResponse.json(
      { error: `count must be an integer between 1 and ${maximumResults}.` },
      { status: 400 },
    );
  }
  if (!targetId) {
    return NextResponse.json({ error: 'target_id is required.' }, { status: 400 });
  }

  const taskId = `${projectId}-${Date.now()}`;
  backgroundTasks.set(taskId, {
    total: count,
    discovered: 0,
    completed: 0,
    duplicatesSkipped: 0,
    failed: 0,
    status: 'running',
    message: 'Planning research...',
    searchProvider: searchProvider.key,
    workspaceId: access.actor.workspaceId,
  });

  processBatch(
    projectId,
    targetId,
    count,
    taskId,
    searchProvider,
    llmProvider,
    access.actor,
    access.allowFileFallback,
  ).catch((error) => {
    const failure = toSafeResearchFailure(error);
    safeResearchLog('research.batch.crashed', error);
    const task = backgroundTasks.get(taskId);
    if (task) {
      task.status = 'error';
      task.message = failure.message;
      task.errorCode = failure.code;
      task.retryable = failure.retryable;
    }
  });

  return NextResponse.json({
    success: true,
    taskId,
    message: `Started bounded research for up to ${count} prospects.`,
  });
}

export async function GET(req: Request) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = backgroundTasks.get(taskId);
  if (task && task.workspaceId !== access.actor.workspaceId) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }
  return task
    ? NextResponse.json(task)
    : NextResponse.json({ error: 'Task not found' }, { status: 404 });
}

export async function DELETE(req: Request) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = backgroundTasks.get(taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }
  if (task.workspaceId !== access.actor.workspaceId) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  task.status = 'cancelled';
  task.message = 'Cancellation requested.';
  if (task.researchRunId) {
    await cancelResearchRun(access.actor, task.researchRunId);
  }
  return NextResponse.json({ success: true });
}

