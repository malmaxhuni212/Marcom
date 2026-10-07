import { NextResponse } from 'next/server';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { getSearchProvider } from '@/marcom/search/registry';
import { discoverProspects } from '@/marcom/agents/research/discovery';
import { runResearchAgent } from '@/marcom/agents/research/agent';
import { saveResearch, upsertProspectMemory } from '@/marcom/memory/research-store';

export const runtime = 'nodejs';

// Simple in-memory background queue
const backgroundTasks = new Map<string, { total: number; completed: number; status: 'running' | 'completed' | 'error' | 'cancelled' }>();

async function processBatch(projectId: string, targetId: string, count: number, taskId: string) {
  const store = new JsonFileMemoryStore();
  const provider = new GroqProvider();
  
  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project?.structured_brief) return;

  const target = project.structured_brief.targets.find((t: any) => t.id === targetId);
  const targetName = target ? target.target_type : 'relevant professionals';

  for (let i = 0; i < count; i++) {
    const currentTask = backgroundTasks.get(taskId);
    if (currentTask && currentTask.status === 'cancelled') {
      console.log(`Batch task ${taskId} was cancelled.`);
      break;
    }

    try {
      // 1. Auto-discover a name
      const candidates = await discoverProspects(project.structured_brief, targetId, projectId, store, getSearchProvider(), provider, count - i);
      
      if (!candidates || candidates.length === 0) {
        console.log('No candidates found by discovery.');
        break; // Stop loop if no candidates found
      }

      for (const parsed of candidates) {
        if (i >= count) break;
        if (parsed && parsed.name) {
          const seed = {
            name: parsed.name,
            entity_kind: target?.entity_kind === 'person' || target?.entity_kind === 'organisation' ? target.entity_kind : 'unknown' as any,
            organisation: parsed.organisation || undefined
          };

          // 2. Run research
          const entry = await runResearchAgent({
            projectId,
            brief: project.structured_brief,
            targetId,
            seed,
            store,
            searchProvider: getSearchProvider(),
            llmProvider: provider,
          });

          saveResearch(projectId, entry);
          upsertProspectMemory(entry);
        }
        
        const task = backgroundTasks.get(taskId);
        if (task && task.status !== 'cancelled') task.completed++;
        i++; // advance the counter since we just completed one
      }
      i--; // adjust because the outer loop will do i++


    } catch (e) {
      console.error(`Batch research iteration ${i} failed:`, e);
      // continue to next iteration
    }
  }

  const task = backgroundTasks.get(taskId);
  if (task && task.status === 'running') task.status = 'completed';
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const maxAppLimit = parseInt(process.env.SEARCH_MAX_RESULTS || '25', 10);
  let count = Number(body.count) || 1;
  if (count <= 0 || count > maxAppLimit) return NextResponse.json({ error: `Count must be between 1 and ${maxAppLimit}` }, { status: 400 });
  const targetId = body.target_id;

  const taskId = `${projectId}-${Date.now()}`;
  backgroundTasks.set(taskId, { total: count, completed: 0, status: 'running' });

  // Start background process without awaiting it
  processBatch(projectId, targetId, count, taskId).catch(e => {
    console.error('Batch process crashed:', e);
    const task = backgroundTasks.get(taskId);
    if (task) task.status = 'error';
  });

  return NextResponse.json({ success: true, taskId, message: `Started background research for ${count} leads.` });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId');
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

  const task = backgroundTasks.get(taskId);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  return NextResponse.json(task);
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId');
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

  const task = backgroundTasks.get(taskId);
  if (task) {
    task.status = 'cancelled';
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: 'Task not found' }, { status: 404 });
}
