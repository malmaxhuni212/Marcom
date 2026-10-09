import { NextResponse } from 'next/server';
import { runResearchAgent } from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import {
  findDuplicate,
  listResearch,
  saveResearch,
  upsertProspectMemory,
} from '@/marcom/memory/research-store';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import type { SearchProvider } from '@/marcom/search/provider';
import { readSearchConfiguration, resolveSearchProvider } from '@/marcom/search/registry';

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
};

const backgroundTasks = new Map<string, BackgroundTask>();

async function processBatch(
  projectId: string,
  targetId: string,
  count: number,
  taskId: string,
  searchProvider: SearchProvider,
  llmProvider: GroqProvider,
) {
  const store = new JsonFileMemoryStore();
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

  task.message = 'Searching for prospect candidates...';
  const existing = listResearch(projectId);
  const discovery = await discoverProspectSeeds({
    brief: project.structured_brief,
    target,
    desiredCount: count,
    searchProvider,
    llmProvider,
    existingNames: existing.flatMap((entry) => [entry.seed.name, entry.record.identity.name ?? '']),
    existingUrls: existing.flatMap((entry) => [entry.seed.website ?? '', entry.record.websites?.[0]?.url ?? '']),
  });

  task.discovered = discovery.seeds.length;
  task.duplicatesSkipped += discovery.duplicateCount;
  task.message = `Found ${task.discovered} supported candidate${task.discovered === 1 ? '' : 's'}.`;

  if (!discovery.seeds.length) {
    task.status = 'error';
    task.message = 'Search returned no new supported prospect candidates.';
    return;
  }

  for (const seed of discovery.seeds) {
    if (task.status === 'cancelled') break;
    if (task.completed >= task.total) break;

    if (findDuplicate(listResearch(projectId), seed)) {
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
      saveResearch(projectId, entry);
      upsertProspectMemory(entry);
      task.completed += 1;
    } catch (error) {
      console.error('Batch research candidate failed:', error);
      task.failed += 1;
    }
  }

  if (task.status === 'running') {
    task.status = task.failed ? 'completed_with_errors' : 'completed';
    task.message = `Saved ${task.completed} of ${task.total} requested prospects.`;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  });

  processBatch(projectId, targetId, count, taskId, searchProvider, llmProvider).catch((error) => {
    console.error('Batch process crashed:', error);
    const task = backgroundTasks.get(taskId);
    if (task) {
      task.status = 'error';
      task.message = (error as Error).message;
    }
  });

  return NextResponse.json({
    success: true,
    taskId,
    message: `Started bounded research for up to ${count} prospects.`,
  });
}

export async function GET(req: Request) {
  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = backgroundTasks.get(taskId);
  return task
    ? NextResponse.json(task)
    : NextResponse.json({ error: 'Task not found' }, { status: 404 });
}

export async function DELETE(req: Request) {
  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = backgroundTasks.get(taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  task.status = 'cancelled';
  task.message = 'Cancellation requested.';
  return NextResponse.json({ success: true });
}

