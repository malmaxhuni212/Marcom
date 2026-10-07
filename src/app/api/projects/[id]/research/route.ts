import { NextResponse } from 'next/server';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { getSearchProvider } from '@/marcom/search/registry';
import { discoverProspects } from '@/marcom/agents/research/discovery';
import { runResearchAgent, type ResearchProgress } from '@/marcom/agents/research/agent';
import { deleteResearch, findDuplicate, listResearch, saveResearch, upsertProspectMemory } from '@/marcom/memory/research-store';
import type { ProspectSeed } from '@/marcom/schemas/research-record';

export const runtime = 'nodejs';
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };

const clean = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * Runs the Research Agent for one prospect and streams progress as NDJSON:
 *   {"type":"progress","stage":"resolving|researching|validating|saving|complete","message":"..."}
 *   {"type":"result","entry":{...}}
 *   {"type":"error","error":"...","code":"duplicate|..."}
 */
export async function POST(req: Request, { params }: RouteCtx) {
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));

  const seed: ProspectSeed = {
    name: clean(body.name, 200) ?? '',
    entity_kind: ['person', 'organisation'].includes(body.entity_kind) ? body.entity_kind : 'unknown',
    organisation: clean(body.organisation, 200),
    role: clean(body.role, 200),
    website: clean(body.website, 300),
    linkedin: clean(body.linkedin, 300),
    country: clean(body.country, 100),
    notes: clean(body.notes, 500),
  };

  const store = new JsonFileMemoryStore();
  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project?.structured_brief) {
    return NextResponse.json({ error: 'Project or structured brief not found' }, { status: 404 });
  }

  if (seed.name) {
    const duplicate = findDuplicate(listResearch(projectId), seed);
    if (duplicate && !body.force) {
      return NextResponse.json(
        { error: `"${duplicate.record.identity.name ?? duplicate.seed.name}" has already been researched in this project.`, code: 'duplicate', record_id: duplicate.record.record_id },
        { status: 409 },
      );
    }
  }

  let provider: GroqProvider;
  try {
    provider = new GroqProvider();
  } catch {
    return NextResponse.json({ error: 'Failed to instantiate GroqProvider' }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const onProgress = (p: ResearchProgress) => send({ type: 'progress', ...p });
      try {
        let actualSeed = seed;

        if (!actualSeed.name) {
          onProgress({ stage: 'resolving', message: 'Discovering a new prospect from the web...' });
          
          const candidates = await discoverProspects(project.structured_brief!, clean(body.target_id, 100), projectId, store, getSearchProvider(), provider, 1);
          if (candidates.length > 0) {
             actualSeed.name = candidates[0].name;
             if (candidates[0].organisation) actualSeed.organisation = candidates[0].organisation;
             onProgress({ stage: 'resolving', message: `Discovered: ${actualSeed.name}` });
          } else {
             throw new Error("Could not discover a prospect automatically. Please enter a name.");
          }
        }

        const entry = await runResearchAgent({
          projectId,
          brief: project.structured_brief!,
          targetId: clean(body.target_id, 100),
          seed: actualSeed,
          store,
          searchProvider: getSearchProvider(),
          llmProvider: provider,
          onProgress,
        });
        onProgress({ stage: 'saving', message: 'Saving to project' });
        saveResearch(projectId, entry);
        upsertProspectMemory(entry);
        onProgress({ stage: 'complete', message: 'Research complete' });
        send({ type: 'result', entry });
      } catch (e) {
        console.error('Research agent failed:', e);
        send({ type: 'error', error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id: projectId } = await params;
  const recordId = new URL(req.url).searchParams.get('recordId');
  if (!recordId) return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
  const ok = deleteResearch(projectId, recordId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Record not found' }, { status: 404 });
}
