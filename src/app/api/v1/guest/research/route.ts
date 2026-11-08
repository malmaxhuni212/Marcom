import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { getGuestCookieAttributes, resolveGuestIdentity, setGuestCookie } from '@/auth/guest';
import {
  GUEST_LIMITS,
  refundGuestQuota,
  reserveGuestQuota,
} from '@/db/repositories/guest-quota-repository';
import { findDuplicate } from '@/db/repositories/research-repository';
import {
  pickTarget,
  runResearchAgent,
  type ResearchProgress,
} from '@/marcom/agents/research/agent';
import { discoverProspectSeeds } from '@/marcom/agents/research/discovery';
import { GroqProvider } from '@/marcom/llm/groq-provider';
import { InMemoryStore } from '@/marcom/memory/store';
import type { ProjectMemory } from '@/marcom/memory/types';
import type { ProspectSeed, ResearchEntry } from '@/marcom/schemas/research-record';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import type { SearchProvider } from '@/marcom/search/provider';
import { resolveSearchProvider } from '@/marcom/search/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const clean = (v: unknown, max = 500) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(req: Request): Promise<Response> {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  const guest = access.guest ?? resolveGuestIdentity(req);
  const withGuestCookie = (res: NextResponse) => {
    setGuestCookie(res, guest.token);
    return res;
  };

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return withGuestCookie(
      NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 }),
    );
  }

  const parsedBrief = StructuredBriefSchema.safeParse(body.structured_brief);
  if (!parsedBrief.success) {
    return withGuestCookie(
      NextResponse.json(
        { error: 'A valid structured project brief is required to run guest research.' },
        { status: 400 },
      ),
    );
  }

  const structuredBrief = parsedBrief.data;
  const projectId = clean(body.project_id, 120) ?? 'guest-project';
  const targetId = clean(body.target_id, 100);
  const batchNumber =
    typeof body.batch_number === 'number' && body.batch_number >= 1
      ? Math.floor(body.batch_number)
      : 1;
  const batchId =
    clean(body.batch_id, 120) ?? `guest-batch-${batchNumber}-${randomUUID().slice(0, 6)}`;

  const seed: ProspectSeed = {
    name: clean(body.name, 200) ?? '',
    entity_kind:
      body.entity_kind === 'person' || body.entity_kind === 'organisation'
        ? body.entity_kind
        : 'unknown',
    organisation: clean(body.organisation, 200),
    role: clean(body.role, 200),
    website: clean(body.website, 300),
    linkedin: clean(body.linkedin, 300),
    country: clean(body.country, 100),
    notes: clean(body.notes, 500),
  };

  const rawCount = Number(body.count ?? 1);
  if (!Number.isFinite(rawCount) || rawCount < 1) {
    return withGuestCookie(
      NextResponse.json({ error: 'Requested lead count must be at least 1.' }, { status: 400 }),
    );
  }

  const requestedCount = seed.name ? 1 : Math.floor(rawCount);
  if (requestedCount > GUEST_LIMITS.research.daily) {
    return withGuestCookie(
      NextResponse.json(
        {
          error: `Guest mode allows up to ${GUEST_LIMITS.research.daily} researched leads per day (${GUEST_LIMITS.research.monthly} per month). Please select ${GUEST_LIMITS.research.daily} or fewer leads.`,
          code: 'GUEST_QUOTA_EXCEEDED',
        },
        { status: 429 },
      ),
    );
  }

  const reservation = await reserveGuestQuota(
    guest.guestIdHash,
    'research',
    requestedCount,
  );
  if (!reservation.allowed) {
    return withGuestCookie(
      NextResponse.json(
        {
          error: reservation.reason,
          code: 'GUEST_QUOTA_EXCEEDED',
          limitScope: reservation.limitScope,
          quota: reservation.snapshot,
        },
        { status: 429 },
      ),
    );
  }

  let llmProvider: GroqProvider;
  let searchProvider: SearchProvider;
  try {
    llmProvider = new GroqProvider();
    searchProvider = resolveSearchProvider(undefined, llmProvider);
  } catch (error) {
    const refundedQuota = await refundGuestQuota(
      guest.guestIdHash,
      'research',
      requestedCount,
    );
    return withGuestCookie(
      NextResponse.json(
        {
          error: (error as Error).message,
          quota: refundedQuota,
        },
        { status: 500 },
      ),
    );
  }

  const existingEntries = Array.isArray(body.existing_entries)
    ? (body.existing_entries as ResearchEntry[])
    : [];

  if (seed.name && !body.force) {
    const duplicate = findDuplicate(existingEntries, seed);
    if (duplicate) {
      const refundedQuota = await refundGuestQuota(guest.guestIdHash, 'research', 1);
      return withGuestCookie(
        NextResponse.json(
          {
            error: `"${duplicate.record.identity.name ?? duplicate.seed.name}" has already been researched in this project.`,
            code: 'duplicate',
            record_id: duplicate.record.record_id,
            quota: refundedQuota,
          },
          { status: 409 },
        ),
      );
    }
  }

  const isolatedProjectMemory: ProjectMemory = {
    project_id: projectId,
    name: structuredBrief.project.name || 'Guest Project',
    aliases: [],
    summary: structuredBrief.project.description,
    status: 'READY_FOR_RESEARCH',
    structured_brief: structuredBrief,
    target_definitions: structuredBrief.targets.map((t) => ({
      target_type: t.target_type,
      definition: t.description,
      aliases: [],
    })),
    notes: [],
  };

  const isolatedStore = new InMemoryStore({
    lunim: [],
    projects: [isolatedProjectMemory],
    prospects: [],
    relationships: [],
    decisions: [],
    learnings: [],
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let producedCount = 0;
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        send({ type: 'quota', quota: reservation.snapshot });

        if (seed.name || requestedCount === 1) {
          const onProgress = (p: ResearchProgress) => send({ type: 'progress', ...p });
          let actualSeed = seed;

          if (!actualSeed.name) {
            onProgress({
              stage: 'resolving',
              message: 'Searching for a supported prospect candidate...',
            });
            const target = pickTarget(structuredBrief, actualSeed, targetId);
            const discovery = await discoverProspectSeeds({
              brief: structuredBrief,
              target,
              desiredCount: 1,
              searchProvider,
              llmProvider,
              existingNames: existingEntries.flatMap((entry) => [
                entry.seed?.name ?? '',
                entry.record?.identity?.name ?? '',
              ]),
              existingUrls: existingEntries.flatMap((entry) => [
                entry.seed?.website ?? '',
                entry.record?.websites?.[0]?.url ?? '',
              ]),
            });
            const discovered = discovery.seeds[0];
            if (!discovered) {
              throw new Error(
                'Search found no new supported prospect. Refine the brief or enter a name.',
              );
            }
            actualSeed = discovered;
            onProgress({ stage: 'resolving', message: `Discovered: ${actualSeed.name}` });
          }

          const entry = await runResearchAgent({
            projectId,
            brief: structuredBrief,
            targetId,
            seed: actualSeed,
            store: isolatedStore,
            searchProvider,
            llmProvider,
            onProgress,
          });
          entry.batch_id = batchId;
          entry.batch_number = batchNumber;
          producedCount = 1;

          onProgress({ stage: 'complete', message: 'Research complete' });
          send({ type: 'result', entry, quota: reservation.snapshot });
          controller.close();
          return;
        }

        // Batch discovery for 2..5 leads in guest mode
        const target = pickTarget(structuredBrief, seed, targetId);
        const currentEntries: ResearchEntry[] = [...existingEntries];
        const results: ResearchEntry[] = [];
        let consecutiveEmpty = 0;
        let iteration = 0;

        while (results.length < requestedCount) {
          const remaining = requestedCount - results.length;
          send({
            type: 'progress',
            stage: 'resolving',
            message: `Searching for ${remaining} matching ${target.target_type} candidate(s)...`,
          });

          const discovery = await discoverProspectSeeds({
            brief: structuredBrief,
            target,
            desiredCount: remaining,
            searchProvider,
            llmProvider,
            existingNames: currentEntries.flatMap((e) => [
              e.seed?.name ?? '',
              e.record?.identity?.name ?? '',
            ]),
            existingUrls: currentEntries.flatMap((e) => [
              e.seed?.website ?? '',
              e.record?.websites?.[0]?.url ?? '',
            ]),
            iteration,
          });
          iteration += 1;

          if (!discovery.seeds.length) {
            consecutiveEmpty += 1;
            if (consecutiveEmpty >= 2) break;
            continue;
          }
          consecutiveEmpty = 0;

          for (const candidateSeed of discovery.seeds) {
            if (results.length >= requestedCount) break;
            if (findDuplicate(currentEntries, candidateSeed)) continue;

            send({
              type: 'progress',
              stage: 'researching',
              message: `Researching candidate ${results.length + 1} of ${requestedCount}: ${candidateSeed.name}...`,
            });

            try {
              const entry = await runResearchAgent({
                projectId,
                brief: structuredBrief,
                targetId: target.id,
                seed: candidateSeed,
                store: isolatedStore,
                searchProvider,
                llmProvider,
                onProgress: (p) =>
                  send({
                    type: 'progress',
                    stage: p.stage,
                    message: `[${results.length + 1}/${requestedCount} ${candidateSeed.name}] ${p.message}`,
                  }),
              });
              entry.batch_id = batchId;
              entry.batch_number = batchNumber;
              currentEntries.push(entry);
              results.push(entry);
              producedCount = results.length;

              send({
                type: 'result',
                entry,
                completed: results.length,
                total: requestedCount,
              });
            } catch (candidateError) {
              console.warn('Guest candidate research failed:', candidateError);
            }
          }
        }

        const unused = Math.max(0, requestedCount - producedCount);
        const finalQuota =
          unused > 0
            ? await refundGuestQuota(guest.guestIdHash, 'research', unused)
            : reservation.snapshot;

        if (results.length === 0) {
          send({
            type: 'error',
            error:
              'Search found no new supported prospects for this target. Your guest research credits were refunded.',
            quota: finalQuota,
          });
        } else {
          send({
            type: 'batch_complete',
            count: results.length,
            results,
            quota: finalQuota,
            message: `Research complete. Saved ${results.length} of ${requestedCount} prospects.`,
          });
        }
        controller.close();
      } catch (error) {
        const unused = Math.max(0, requestedCount - producedCount);
        const finalQuota =
          unused > 0
            ? await refundGuestQuota(guest.guestIdHash, 'research', unused)
            : reservation.snapshot;
        send({
          type: 'error',
          error: (error as Error).message || 'Guest research failed.',
          quota: finalQuota,
        });
        controller.close();
      }
    },
  });

  const cookieAttr = getGuestCookieAttributes();
  const cookieHeaderValue = `${cookieAttr.name}=${encodeURIComponent(guest.token)}; Path=${cookieAttr.path}; Max-Age=${cookieAttr.maxAge}; HttpOnly; SameSite=Lax${cookieAttr.secure ? '; Secure' : ''}`;

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Set-Cookie': cookieHeaderValue,
    },
  });
}
