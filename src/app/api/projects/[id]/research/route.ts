import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerMemoryStore, readCampaignMemory } from '@/marcom/memory/server-store';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { pickTarget, runResearchAgent, type ResearchProgress } from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { resolveSearchProvider } from '@/marcom/search/registry';
import type { SearchProvider } from '@/marcom/search/provider';
import { authorizeApiRequest } from '@/auth/access';
import { completeResearchRun, deleteResearch, deleteMultipleResearch, deleteBatchResearch, deleteProjectResearch, findDuplicate, getNextBatchInfo, listResearch, saveResearch, startResearchRun, updateResearchReview } from '@/db/repositories/research-repository';
import { ReviewStatusSchema, type ProspectSeed, type ResearchEntry } from '@/marcom/schemas/research-record';
import { evidenceCoverage, reviewStatus, summarizeResearch } from '@/marcom/research/review';

import { isDatabaseConfigured } from '@/db/env';
import { listResearch as listFileResearch, updateResearchReview as updateFileReview, deleteResearch as deleteFileResearch, deleteMultipleResearch as deleteFileMultiple, deleteBatchResearch as deleteFileBatch, deleteProjectResearch as deleteFileProject, getNextBatchInfo as getFileNextBatch, saveResearch as saveFileResearch } from '@/marcom/memory/research-store';
import { getPersonalization as getDbPersonalization } from '@/db/repositories/personalization-repository';
import { getPersonalization as getFilePersonalization } from '@/marcom/memory/personalization-store';
import { syncConnectedProjectRecordsToNotion } from '@/marcom/integrations/notion/sync';

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
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const project = await readCampaignMemory(access.actor, projectId, access.allowFileFallback);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  let allEntries: ResearchEntry[] = [];
  if (isDatabaseConfigured()) {
    try {
      allEntries = await listResearch(access.actor, projectId);
    } catch (e) {
      if (!access.allowFileFallback) throw e;
      console.warn('Database error in research GET, falling back to file memory.');
      allEntries = listFileResearch(projectId);
    }
  } else if (access.allowFileFallback) {
    allEntries = listFileResearch(projectId);
  } else {
    throw new Error('The authoritative database is unavailable.');
  }

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
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
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

  const store = await createServerMemoryStore(access.actor, access.allowFileFallback);
  const isDb = isDatabaseConfigured();
  const actor = isDb ? access.actor : null;
  if (!isDb && !access.allowFileFallback) throw new Error('The authoritative database is unavailable.');

  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project?.structured_brief) {
    return NextResponse.json({ error: 'Project or structured brief not found' }, { status: 404 });
  }

  let llmProvider: GroqProvider;
  let searchProvider: SearchProvider;
  try {
    llmProvider = new GroqProvider();
    searchProvider = resolveSearchProvider(undefined, llmProvider);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  if (seed.name) {
    const existing = actor ? await listResearch(actor, projectId) : listFileResearch(projectId);
    const duplicate = findDuplicate(existing, seed);
    if (duplicate && !body.force) {
      return NextResponse.json(
        { error: `"${duplicate.record.identity.name ?? duplicate.seed.name}" has already been researched in this project.`, code: 'duplicate', record_id: duplicate.record.record_id },
        { status: 409 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const onProgress = (p: ResearchProgress) => send({ type: 'progress', ...p });
      let researchRunId: string | null = null;
      try {
        let actualSeed = seed;

        if (!actualSeed.name) {
          onProgress({ stage: 'resolving', message: 'Searching for a supported prospect candidate...' });
          const existing = actor ? await listResearch(actor, projectId) : listFileResearch(projectId);
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

        const batchInfo = actor ? await getNextBatchInfo(actor, projectId) : getFileNextBatch(projectId);
        if (actor) {
          researchRunId = await startResearchRun(actor, projectId, batchInfo, 1, clean(body.target_id, 100) ?? 'default');
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
        entry.batch_id = batchInfo.batch_id;
        entry.batch_number = batchInfo.batch_number;

        if (actor && researchRunId) {
          await saveResearch(actor, projectId, researchRunId, entry);
          await completeResearchRun(actor, researchRunId, 0);
        } else {
          saveFileResearch(projectId, entry);
        }

        await syncConnectedProjectRecordsToNotion({
          projectId,
          brief: project.structured_brief,
          targetEntries: [entry],
        });

        onProgress({ stage: 'complete', message: 'Research complete' });
        send({ type: 'result', entry });
      } catch (e) {
        if (actor && researchRunId) {
          await completeResearchRun(actor, researchRunId, 1).catch((completionError) => {
            console.error('Research failure state could not be persisted:', completionError);
          });
        }
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

/** Persist one human G3-style review decision. */
export async function PATCH(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const parsed = ReviewDecisionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'The review decision is invalid.' }, { status: 400 });
  }
  const finalNote = parsed.data.note?.trim() || (parsed.data.status === 'rejected' ? 'Rejected by user' : null);

  let updated = null;
  if (isDatabaseConfigured()) {
    try {
      updated = await updateResearchReview(
        access.actor,
        projectId,
        parsed.data.record_id,
        parsed.data.status,
        finalNote,
      );
    } catch (e) {
      if (!access.allowFileFallback) throw e;
      console.warn('Database error in research PATCH, falling back to file memory.');
      updated = updateFileReview(projectId, parsed.data.record_id, parsed.data.status, finalNote);
    }
  } else if (access.allowFileFallback) {
    updated = updateFileReview(projectId, parsed.data.record_id, parsed.data.status, finalNote);
  } else {
    throw new Error('The authoritative database is unavailable.');
  }

  if (updated) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
    const existingDraft =
      isDatabaseConfigured() && isUuid
        ? await getDbPersonalization(access.actor, projectId, parsed.data.record_id).catch(() =>
            getFilePersonalization(projectId, parsed.data.record_id),
          )
        : getFilePersonalization(projectId, parsed.data.record_id);

    await syncConnectedProjectRecordsToNotion({
      projectId,
      targetEntries: [updated],
      draftsByRecordId: existingDraft ? { [parsed.data.record_id]: existingDraft } : {},
    });
  }

  return updated
    ? NextResponse.json({ success: true, entry: updated })
    : NextResponse.json({ error: 'Research record not found' }, { status: 404 });
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const url = new URL(req.url);
  const recordId = url.searchParams.get('recordId');
  const batchId = url.searchParams.get('batchId') || url.searchParams.get('batch');
  const all = url.searchParams.get('all') === 'true';

  let bodyRecordIds: string[] | null = null;
  try {
    const body = await req.json();
    if (Array.isArray(body?.recordIds)) {
      bodyRecordIds = body.recordIds;
    }
  } catch {
    // Body is optional
  }

  if (isDatabaseConfigured()) {
    try {
      const actor = access.actor;
      if (all) {
        await deleteProjectResearch(actor, projectId);
        return NextResponse.json({ success: true, message: 'All research deleted' });
      }
      if (batchId) {
        const ok = await deleteBatchResearch(actor, projectId, batchId);
        return ok 
          ? NextResponse.json({ success: true, message: `Batch ${batchId} deleted` })
          : NextResponse.json({ error: `Batch ${batchId} not found` }, { status: 404 });
      }
      if (bodyRecordIds && bodyRecordIds.length > 0) {
        const ok = await deleteMultipleResearch(actor, projectId, bodyRecordIds);
        return ok 
          ? NextResponse.json({ success: true, count: bodyRecordIds.length })
          : NextResponse.json({ error: 'No matching records found' }, { status: 404 });
      }
      if (!recordId) return NextResponse.json({ error: 'recordId, batchId, recordIds, or all=true is required' }, { status: 400 });
      const ok = await deleteResearch(actor, projectId, recordId);
      return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Record not found' }, { status: 404 });
    } catch (e) {
      if (!access.allowFileFallback) throw e;
      console.warn('Database error in research DELETE, falling back to file memory.');
    }
  }

  // File fallback
  if (!access.allowFileFallback) throw new Error('The authoritative database is unavailable.');
  if (all) {
    deleteFileProject(projectId);
    return NextResponse.json({ success: true, message: 'All research deleted' });
  }
  if (batchId) {
    const ok = deleteFileBatch(projectId, batchId);
    return ok 
      ? NextResponse.json({ success: true, message: `Batch ${batchId} deleted` })
      : NextResponse.json({ error: `Batch ${batchId} not found` }, { status: 404 });
  }
  if (bodyRecordIds && bodyRecordIds.length > 0) {
    const ok = deleteFileMultiple(projectId, bodyRecordIds);
    return ok 
      ? NextResponse.json({ success: true, count: bodyRecordIds.length })
      : NextResponse.json({ error: 'No matching records found' }, { status: 404 });
  }
  if (!recordId) return NextResponse.json({ error: 'recordId, batchId, recordIds, or all=true is required' }, { status: 400 });
  const ok = deleteFileResearch(projectId, recordId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Record not found' }, { status: 404 });
}

/* end of route handlers */
/*
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
}*/

