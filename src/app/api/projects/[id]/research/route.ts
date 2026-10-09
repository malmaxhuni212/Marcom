import { NextResponse } from 'next/server';
import { z } from 'zod';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { pickTarget, runResearchAgent, type ResearchProgress } from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { resolveSearchProvider } from '@/marcom/search/registry';
import type { SearchProvider } from '@/marcom/search/provider';
import { deleteResearch, deleteProjectResearch, findDuplicate, listResearch, saveResearch, updateResearchReview, upsertProspectMemory } from '@/marcom/memory/research-store';
import { ReviewStatusSchema, type ProspectSeed, type ResearchEntry } from '@/marcom/schemas/research-record';
import { evidenceCoverage, reviewStatus, summarizeResearch } from '@/marcom/research/review';

export const runtime = 'nodejs';
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };

const clean = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

const ReviewDecisionSchema = z.strictObject({
  record_id: z.string().trim().min(1).max(200),
  status: ReviewStatusSchema,
  note: z.string().trim().max(1_000).nullable().optional(),
});

function searchableText(entry: ResearchEntry): string {
  return [
    entry.record.identity.name,
    entry.seed.name,
    entry.record.role,
    entry.record.organisation,
    entry.record.location,
    entry.record.country,
    entry.record.summary,
    entry.record.target_type,
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Paginated prospect review results for one campaign. */
export async function GET(req: Request, { params }: RouteCtx) {
  const { id: projectId } = await params;
  const project = new JsonFileMemoryStore().projects().find((candidate) => candidate.project_id === projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const search = new URL(req.url).searchParams;
  const query = search.get('q')?.trim().toLowerCase() ?? '';
  const status = search.get('status') ?? 'all';
  const entityType = search.get('type') ?? 'all';
  const target = search.get('target')?.trim().toLowerCase() ?? '';
  const location = search.get('location')?.trim().toLowerCase() ?? '';
  const confidence = search.get('confidence') ?? 'all';
  const coverage = search.get('coverage') ?? 'all';
  const batch = search.get('batch') ?? 'all';
  const sort = search.get('sort') ?? 'newest';
  const page = Math.max(1, Number.parseInt(search.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(50, Math.max(5, Number.parseInt(search.get('pageSize') ?? '20', 10) || 20));

  const allEntries = listResearch(projectId);
  const locations = [...new Set(allEntries.flatMap((entry) => [entry.record.location, entry.record.country]).filter((value): value is string => Boolean(value)))].sort();
  const targets = [...new Set(allEntries.map((entry) => entry.record.target_type).filter(Boolean))].sort();

  const batchMap = new Map<number, { id: string; number: number; count: number }>();
  for (const entry of allEntries) {
    const num = entry.batch_number ?? 1;
    const bId = entry.batch_id ?? `batch-${num}`;
    const cur = batchMap.get(num) ?? { id: bId, number: num, count: 0 };
    cur.count += 1;
    batchMap.set(num, cur);
  }
  const batches = [...batchMap.values()].sort((a, b) => b.number - a.number);

  const filtered = allEntries.filter((entry) => {
    if (query && !searchableText(entry).includes(query)) return false;
    if (status !== 'all' && reviewStatus(entry) !== status) return false;
    if (entityType !== 'all' && entry.record.identity.entity_kind !== entityType) return false;
    if (target && entry.record.target_type.toLowerCase() !== target) return false;
    if (location && ![entry.record.location, entry.record.country].filter(Boolean).join(' ').toLowerCase().includes(location)) return false;
    if (confidence !== 'all' && entry.record.research_confidence !== confidence) return false;
    const evidence = evidenceCoverage(entry);
    if (coverage === 'complete' && (evidence.unsupported > 0 || evidence.supported === 0)) return false;
    if (coverage === 'incomplete' && evidence.unsupported === 0 && evidence.supported > 0) return false;
    if (batch !== 'all' && (entry.batch_id !== batch && String(entry.batch_number) !== batch)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'fit_desc') return b.record.fit.score - a.record.fit.score;
    if (sort === 'name_asc') return (a.record.identity.name ?? a.seed.name).localeCompare(b.record.identity.name ?? b.seed.name);
    if (sort === 'evidence_desc') return evidenceCoverage(b).percent - evidenceCoverage(a).percent;
    return Date.parse(b.record.researched_at) - Date.parse(a.record.researched_at);
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;

  return NextResponse.json({
    project: { id: project.project_id, name: project.name },
    items: filtered.slice(start, start + pageSize),
    pagination: { page: safePage, page_size: pageSize, total, page_count: pageCount },
    summary: summarizeResearch(allEntries),
    facets: { locations, targets, batches },
  });
}

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

  let llmProvider: GroqProvider;
  let searchProvider: SearchProvider;
  try {
    llmProvider = new GroqProvider();
    searchProvider = resolveSearchProvider(undefined, llmProvider);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const onProgress = (p: ResearchProgress) => send({ type: 'progress', ...p });
      try {
        let actualSeed = seed;

        if (!actualSeed.name) {
          onProgress({ stage: 'resolving', message: 'Searching for a supported prospect candidate...' });
          const existing = listResearch(projectId);
          const target = pickTarget(project.structured_brief!, actualSeed, clean(body.target_id, 100));
          const discovery = await discoverProspectSeeds({
            brief: project.structured_brief!,
            target,
            desiredCount: 1,
            searchProvider,
            llmProvider,
            existingNames: existing.flatMap((entry) => [entry.seed.name, entry.record.identity.name ?? '']),
            existingUrls: existing.flatMap((entry) => [entry.seed.website ?? '', entry.record.websites?.[0]?.url ?? '']),
          });
          const discovered = discovery.seeds[0];
          if (!discovered) throw new Error('Search found no new supported prospect. Refine the brief or enter a name.');
          actualSeed = discovered;
          onProgress({ stage: 'resolving', message: `Discovered: ${actualSeed.name}` });
        }

        const entry = await runResearchAgent({
          projectId,
          brief: project.structured_brief!,
          targetId: clean(body.target_id, 100),
          seed: actualSeed,
          store,
          searchProvider,
          llmProvider,
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

/** Persist one human G3-style review decision in the local JSON pilot store. */
export async function PATCH(req: Request, { params }: RouteCtx) {
  const { id: projectId } = await params;
  const parsed = ReviewDecisionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'The review decision is invalid.' }, { status: 400 });
  }
  if (parsed.data.status === 'rejected' && !parsed.data.note?.trim()) {
    return NextResponse.json({ error: 'Add a reason before rejecting this prospect.' }, { status: 422 });
  }
  const updated = updateResearchReview(
    projectId,
    parsed.data.record_id,
    parsed.data.status,
    parsed.data.note ?? null,
  );
  return updated
    ? NextResponse.json({ success: true, entry: updated })
    : NextResponse.json({ error: 'Research record not found' }, { status: 404 });
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id: projectId } = await params;
  const url = new URL(req.url);
  const recordId = url.searchParams.get('recordId');
  const all = url.searchParams.get('all') === 'true';

  if (all) {
    deleteProjectResearch(projectId);
    return NextResponse.json({ success: true, message: 'All research deleted' });
  }

  if (!recordId) return NextResponse.json({ error: 'recordId or all=true is required' }, { status: 400 });
  
  const ok = deleteResearch(projectId, recordId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Record not found' }, { status: 404 });
}

