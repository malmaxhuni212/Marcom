'use client';

import type { GuestQuotaSnapshot } from '@/db/repositories/guest-quota-repository';
import {
  appendGuestResearchEntries,
  createGuestProject,
  deleteGuestPersonalizationEntry,
  deleteGuestProject,
  deleteGuestResearch,
  getGuestNextBatchInfo,
  getGuestPersonalizationPayload,
  getGuestProjectDetail,
  getGuestResearchPaginated,
  getStoredGuestCampaign,
  getStoredGuestToken,
  listGuestProjects,
  patchGuestPersonalization,
  putGuestPersonalizationSettings,
  readAllGuestCampaigns,
  saveGuestPersonalizationGeneration,
  setStoredGuestToken,
  updateGuestProjectConfiguration,
  updateGuestResearchReview,
} from '@/lib/guest-storage';
import { appendFeedback, createFeedbackItem } from '@/marcom/personalization/feedback';
import type { FeedbackScope, PersonalizationEntry } from '@/marcom/schemas/personalization';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type ClientMode = 'guest' | 'team';
type QuotaListener = (quota: GuestQuotaSnapshot) => void;

let currentClientMode: ClientMode = 'guest';
let latestGuestQuota: GuestQuotaSnapshot | null = null;
const quotaListeners = new Set<QuotaListener>();

export function getClientAccessMode(): ClientMode {
  return currentClientMode;
}

export function setClientAccessMode(mode: ClientMode): void {
  currentClientMode = mode;
}

export function isClientGuestMode(): boolean {
  return currentClientMode === 'guest';
}

export function getLatestGuestQuota(): GuestQuotaSnapshot | null {
  return latestGuestQuota;
}

export function emitGuestQuotaUpdate(quota: GuestQuotaSnapshot | null | undefined): void {
  if (!quota) return;
  latestGuestQuota = quota;
  for (const listener of quotaListeners) {
    try {
      listener(quota);
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeGuestQuota(listener: QuotaListener): () => void {
  quotaListeners.add(listener);
  if (latestGuestQuota) {
    listener(latestGuestQuota);
  }
  return () => {
    quotaListeners.delete(listener);
  };
}

export function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    if (trimmed.slice(0, separator) === name) {
      return decodeURIComponent(trimmed.slice(separator + 1));
    }
  }
  return null;
}

export function readCsrfToken(): string | null {
  return readBrowserCookie('__Host-marcom_csrf') ?? readBrowserCookie('marcom_csrf');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function parseJsonInitBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  if (typeof init.body === 'string') {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function handleGuestLocalApi(
  url: URL,
  method: string,
  init?: RequestInit,
): Promise<Response | null> {
  const pathname = url.pathname;

  if (pathname === '/api/notifications' && method === 'GET') {
    const campaigns = await readAllGuestCampaigns();
    const notifications = campaigns.slice(0, 8).map((c) => ({
      id: `guest-notif-${c.id}`,
      title: `Guest project: ${c.project.name}`,
      message: `${c.research.length} prospects researched · ${c.personalizations.length} personalised (saved on this device)`,
      timestamp: 'Local device',
      sortTime: new Date(c.updatedAt).getTime(),
      type: 'info' as const,
      icon: '📁',
      link: `/?project=${encodeURIComponent(c.id)}`,
      projectName: c.project.name,
    }));
    return jsonResponse(notifications);
  }

  if (pathname === '/api/activity' && method === 'GET') {
    const campaigns = await readAllGuestCampaigns();
    const activities = campaigns.map((c) => ({
      id: `guest-act-${c.id}`,
      agentName: 'Brief Analyzer',
      agentColor: 'blue' as const,
      action: 'structured local guest campaign brief',
      target: c.project.name,
      timestamp: 'Saved only on this device',
      sortTime: new Date(c.updatedAt).getTime(),
    }));
    return jsonResponse(activities);
  }

  if (pathname === '/api/projects') {
    if (method === 'GET') {
      const projects = await listGuestProjects();
      return jsonResponse(projects);
    }
    if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'Project ID is required' }, 400);
      await deleteGuestProject(id);
      return jsonResponse({ success: true, message: 'Project deleted successfully' });
    }
  }

  if (pathname === '/api/projects/create' && method === 'POST') {
    try {
      const body = await parseJsonInitBody(init);
      if (!body.structured_brief || typeof body.original_brief !== 'string') {
        return jsonResponse(
          { error: 'The campaign configuration is invalid.' },
          400,
        );
      }
      const project = await createGuestProject({
        structured_brief: body.structured_brief,
        original_brief: body.original_brief,
        source_type:
          typeof body.source_type === 'string' ? body.source_type : 'PASTE',
        source_name:
          typeof body.source_name === 'string' ? body.source_name : 'Guest Brief',
      });
      return jsonResponse({ success: true, project }, 201);
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? error.message
              : 'The campaign could not be created.',
        },
        400,
      );
    }
  }

  const projectRootMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectRootMatch) {
    const projectId = decodeURIComponent(projectRootMatch[1]);
    if (method === 'GET') {
      const detail = await getGuestProjectDetail(projectId);
      if (!detail) return jsonResponse({ error: 'Project not found' }, 404);
      return jsonResponse(detail);
    }
    if (method === 'PATCH') {
      try {
        const body = await parseJsonInitBody(init);
        const updated = await updateGuestProjectConfiguration(
          projectId,
          body.structured_brief,
        );
        if (!updated) return jsonResponse({ error: 'Project not found' }, 404);
        return jsonResponse({ success: true, project: updated });
      } catch (error) {
        return jsonResponse(
          {
            error:
              error instanceof Error
                ? error.message
                : 'The campaign configuration is invalid.',
          },
          400,
        );
      }
    }
    if (method === 'DELETE') {
      await deleteGuestProject(projectId);
      return jsonResponse({ success: true, message: 'Project deleted successfully' });
    }
  }

  const researchMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/(research|batch-research)$/,
  );
  if (researchMatch) {
    const projectId = decodeURIComponent(researchMatch[1]);
    const subRoute = researchMatch[2];

    if (subRoute === 'research' && method === 'GET') {
      const paginated = await getGuestResearchPaginated(projectId, url.searchParams);
      if (!paginated) return jsonResponse({ error: 'Project not found' }, 404);
      return jsonResponse(paginated);
    }

    if (subRoute === 'research' && method === 'PATCH') {
      const body = await parseJsonInitBody(init);
      const recordId =
        typeof body.record_id === 'string'
          ? body.record_id
          : typeof body.recordId === 'string'
            ? body.recordId
            : '';
      const status = body.status as ReviewStatus;
      const note =
        typeof body.note === 'string' && body.note.trim()
          ? body.note.trim()
          : status === 'rejected'
            ? 'Rejected by user'
            : null;
      if (!recordId || !status) {
        return jsonResponse({ error: 'The review decision is invalid.' }, 400);
      }
      const updated = await updateGuestResearchReview(
        projectId,
        recordId,
        status,
        note,
      );
      return updated
        ? jsonResponse({ success: true, entry: updated })
        : jsonResponse({ error: 'Research record not found' }, 404);
    }

    if (subRoute === 'research' && method === 'DELETE') {
      const recordId = url.searchParams.get('recordId');
      const batchId =
        url.searchParams.get('batchId') || url.searchParams.get('batch');
      const all = url.searchParams.get('all') === 'true';
      const body = await parseJsonInitBody(init);
      const recordIds = Array.isArray(body.recordIds)
        ? (body.recordIds as string[])
        : null;
      const ok = await deleteGuestResearch(projectId, {
        recordId,
        batchId,
        recordIds,
        all,
      });
      return ok
        ? jsonResponse({ success: true })
        : jsonResponse({ error: 'Record not found' }, 404);
    }

    if (method === 'POST') {
      const campaign = await getStoredGuestCampaign(projectId);
      if (!campaign || !campaign.project.structured_brief) {
        return jsonResponse(
          { error: 'Guest project or structured brief not found on this device.' },
          404,
        );
      }
      const body = await parseJsonInitBody(init);
      const batchInfo = await getGuestNextBatchInfo(projectId);
      const guestHeaders = new Headers();
      guestHeaders.set('Content-Type', 'application/json');
      const guestToken = getStoredGuestToken();
      if (guestToken) {
        guestHeaders.set('X-Guest-Token', guestToken);
      }

      const upstream = await fetch('/api/v1/guest/research', {
        method: 'POST',
        headers: guestHeaders,
        body: JSON.stringify({
          project_id: projectId,
          structured_brief: campaign.project.structured_brief,
          target_id: body.target_id,
          count: subRoute === 'batch-research' ? Number(body.count ?? 1) : Number(body.count ?? 1),
          name: body.name,
          entity_kind: body.entity_kind,
          force: body.force,
          notes: body.notes,
          organisation: body.organisation,
          role: body.role,
          website: body.website,
          linkedin: body.linkedin,
          country: body.country,
          batch_id: batchInfo.batch_id,
          batch_number: batchInfo.batch_number,
          existing_entries: campaign.research,
        }),
        signal: init?.signal,
      });

      if (!upstream.ok || !upstream.body) {
        try {
          const cloned = upstream.clone();
          const errPayload = (await cloned.json()) as { quota?: GuestQuotaSnapshot };
          if (errPayload?.quota) {
            emitGuestQuotaUpdate(errPayload.quota);
          }
        } catch {
          // Ignore non-JSON error
        }
        return upstream;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      const interceptedStream = new ReadableStream({
        async start(controller) {
          let buffer = '';
          const processLine = async (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
              const msg = JSON.parse(trimmed) as {
                type?: string;
                entry?: ResearchEntry;
                results?: ResearchEntry[];
                quota?: GuestQuotaSnapshot;
              };
              if (msg.quota) {
                emitGuestQuotaUpdate(msg.quota);
              }
              if (msg.type === 'result' && msg.entry) {
                await appendGuestResearchEntries(projectId, [msg.entry]);
              } else if (
                msg.type === 'batch_complete' &&
                Array.isArray(msg.results) &&
                msg.results.length > 0
              ) {
                await appendGuestResearchEntries(projectId, msg.results);
              }
            } catch {
              // Ignore malformed line
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                await processLine(line);
                controller.enqueue(encoder.encode(line + '\n'));
              }
            }
            if (buffer.trim()) {
              await processLine(buffer);
              controller.enqueue(encoder.encode(buffer + '\n'));
            }
            controller.close();
          } catch (streamErr) {
            controller.error(streamErr);
          }
        },
      });

      return new Response(interceptedStream, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }
  }

  const personalizationMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/personalization$/,
  );
  if (personalizationMatch) {
    const projectId = decodeURIComponent(personalizationMatch[1]);

    if (method === 'GET') {
      const result = await getGuestPersonalizationPayload(
        projectId,
        url.searchParams,
      );
      return jsonResponse(result.data, result.status);
    }

    if (method === 'POST') {
      const campaign = await getStoredGuestCampaign(projectId);
      if (!campaign || !campaign.project.structured_brief) {
        return jsonResponse(
          { error: 'Guest project or structured brief not found on this device.' },
          404,
        );
      }

      const body = await parseJsonInitBody(init);
      const recordId =
        typeof body.recordId === 'string'
          ? body.recordId
          : typeof body.record_id === 'string'
            ? body.record_id
            : undefined;
      const recordIds = Array.isArray(body.recordIds)
        ? (body.recordIds as string[])
        : undefined;
      const batchId =
        typeof body.batchId === 'string' ? body.batchId : undefined;
      const mode = body.allShortlisted
        ? 'all_shortlisted'
        : typeof body.mode === 'string'
          ? body.mode
          : 'single';

      const allResearch = campaign.research ?? [];
      let candidates = allResearch;

      if (recordIds && recordIds.length > 0) {
        const selected = new Set(recordIds);
        candidates = allResearch.filter((r) => selected.has(r.record.record_id));
        if (candidates.length === 0) {
          return jsonResponse(
            { error: 'Selected research records were not found.' },
            404,
          );
        }
      } else if (mode === 'single' && recordId) {
        candidates = allResearch.filter((r) => r.record.record_id === recordId);
        if (!candidates.length) {
          candidates = allResearch.filter(
            (r) =>
              r.seed.name === recordId || r.record.identity.name === recordId,
          );
        }
        if (!candidates.length) {
          return jsonResponse(
            { error: `Research record "${recordId}" not found in project.` },
            404,
          );
        }
      } else if (mode === 'batch' && batchId) {
        candidates = allResearch.filter(
          (r) =>
            r.batch_id === batchId ||
            String(r.batch_number) === String(batchId).replace('batch-', ''),
        );
      } else if (mode === 'all_personalized' || mode === 'all_shortlisted') {
        candidates = allResearch.filter(
          (r) => r.review?.status === 'shortlisted',
        );
      }

      if (!candidates.length) {
        return jsonResponse(
          {
            error:
              'No matching prospects found to personalize with the selected filter.',
          },
          400,
        );
      }

      let currentSettings = campaign.settings;
      let savedFeedback = null;
      const feedbackObj =
        body.feedback && typeof body.feedback === 'object'
          ? (body.feedback as { text?: string; scope?: FeedbackScope })
          : null;
      const rewriteFeedback = feedbackObj?.text?.trim() || null;

      if (feedbackObj && rewriteFeedback && recordId) {
        const feedbackRecord =
          allResearch.find((r) => r.record.record_id === recordId)?.record ??
          null;
        savedFeedback = createFeedbackItem({
          text: rewriteFeedback,
          scope: feedbackObj.scope ?? 'project',
          record: feedbackRecord,
        });
        currentSettings = {
          ...currentSettings,
          feedback_memory: appendFeedback(
            currentSettings.feedback_memory,
            savedFeedback,
          ),
        };
      }

      const guestHeaders = new Headers();
      guestHeaders.set('Content-Type', 'application/json');
      const guestToken = getStoredGuestToken();
      if (guestToken) {
        guestHeaders.set('X-Guest-Token', guestToken);
      }

      const upstream = await fetch('/api/v1/guest/personalization', {
        method: 'POST',
        headers: guestHeaders,
        body: JSON.stringify({
          project_id: projectId,
          structured_brief: campaign.project.structured_brief,
          candidates,
          settings: currentSettings,
          existing_drafts: campaign.personalizations ?? [],
          lead_settings: body.leadSettings,
          lead_settings_by_record_id: body.leadSettingsByRecordId,
          rewrite_feedback: rewriteFeedback,
        }),
        signal: init?.signal,
      });

      const data = (await upstream.json().catch(() => ({}))) as {
        items?: PersonalizationEntry[];
        results?: PersonalizationEntry[];
        settings?: typeof currentSettings;
        quota?: GuestQuotaSnapshot;
        [key: string]: unknown;
      };

      if (data.quota) {
        emitGuestQuotaUpdate(data.quota);
      }

      if (!upstream.ok) {
        return jsonResponse(data, upstream.status);
      }

      const generated = Array.isArray(data.items) ? data.items : [];
      const saved = await saveGuestPersonalizationGeneration(
        projectId,
        generated,
        data.settings ?? currentSettings,
      );

      return jsonResponse({
        success: true,
        processed: saved.items.length,
        errors: data.errors ?? [],
        results: saved.items,
        items: saved.items,
        settings: saved.settings,
        summary: saved.summary,
        feedback: savedFeedback,
        quota: data.quota,
      });
    }

    if (method === 'PATCH') {
      const body = await parseJsonInitBody(init);
      const result = await patchGuestPersonalization(projectId, body);
      return jsonResponse(result.data, result.status);
    }

    if (method === 'PUT') {
      const body = await parseJsonInitBody(init);
      const result = await putGuestPersonalizationSettings(projectId, body);
      return jsonResponse(result.data, result.status);
    }

    if (method === 'DELETE') {
      const recordId = url.searchParams.get('recordId');
      if (!recordId) {
        return jsonResponse({ error: 'recordId is required' }, 400);
      }
      const ok = await deleteGuestPersonalizationEntry(projectId, recordId);
      return ok
        ? jsonResponse({ success: true })
        : jsonResponse({ error: 'Not found' }, 404);
    }
  }

  return null;
}

export async function refreshGuestSessionAndQuota(): Promise<{
  authenticated: boolean;
  mode: ClientMode;
  displayName: string;
  quota: GuestQuotaSnapshot | null;
}> {
  const headers = new Headers();
  const storedToken = getStoredGuestToken();
  if (storedToken) {
    headers.set('X-Guest-Token', storedToken);
  }
  const response = await fetch('/api/v1/guest/quota', {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) {
    return {
      authenticated: false,
      mode: currentClientMode,
      displayName: 'Guest',
      quota: latestGuestQuota,
    };
  }
  const data = (await response.json()) as {
    authenticated?: boolean;
    mode?: ClientMode;
    displayName?: string;
    guestToken?: string;
    quota?: GuestQuotaSnapshot;
  };
  if (data.guestToken) {
    setStoredGuestToken(data.guestToken);
  }
  const mode: ClientMode = data.authenticated ? 'team' : 'guest';
  setClientAccessMode(mode);
  if (data.quota) {
    emitGuestQuotaUpdate(data.quota);
  }
  return {
    authenticated: Boolean(data.authenticated),
    mode,
    displayName: data.displayName ?? (data.authenticated ? 'Team Member' : 'Guest'),
    quota: data.quota ?? latestGuestQuota,
  };
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();

  if (typeof window !== 'undefined') {
    const resolvedUrl =
      typeof input === 'string'
        ? new URL(input, window.location.origin)
        : input instanceof URL
          ? input
          : new URL(input.url, window.location.origin);

    const isGuestProjectPath = resolvedUrl.pathname.startsWith('/api/projects/guest-');
    if (isClientGuestMode() || isGuestProjectPath) {
      const localResponse = await handleGuestLocalApi(resolvedUrl, method, init);
      if (localResponse) {
        return localResponse;
      }
    }
  }

  const headers = new Headers(init.headers);
  const storedGuestToken = getStoredGuestToken();
  if (storedGuestToken && !headers.has('X-Guest-Token')) {
    headers.set('X-Guest-Token', storedGuestToken);
  }
  headers.set('X-Marcom-Client-Mode', currentClientMode);

  if (UNSAFE_METHODS.has(method) && !headers.has('X-CSRF-Token')) {
    const csrfToken = readCsrfToken();
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  }

  return await fetch(input, { ...init, headers });
}
