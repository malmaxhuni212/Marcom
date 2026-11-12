import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { isDatabaseConfigured } from '@/db/env';
import type { ActorContext } from '@/db/local-actor';
import {
  getCampaign,
  updateCampaignConfiguration,
} from '@/db/repositories/campaign-repository';
import {
  listResearch as listDbResearch,
  updateResearchEntryFromSync as updateDbResearchEntryFromSync,
  updateResearchReview as updateDbResearchReview,
} from '@/db/repositories/research-repository';
import {
  listResearch as listFileResearch,
  updateResearchEntryById as updateFileResearchEntryById,
  updateResearchReview as updateFileResearchReview,
} from '@/marcom/memory/research-store';
import { updateProject as updateFileProject } from '@/marcom/memory/project-store';
import {
  getPersonalizationSettings as getDbPersonalizationSettings,
  listPersonalizations as listDbPersonalizations,
  savePersonalization as saveDbPersonalization,
} from '@/db/repositories/personalization-repository';
import {
  getPersonalizationSettings as getFilePersonalizationSettings,
  listPersonalizations as listFilePersonalizations,
  savePersonalization as saveFilePersonalization,
} from '@/marcom/memory/personalization-store';
import { readCampaignMemory } from '@/marcom/memory/server-store';
import { buildAdaptivePersonalizationEntry } from '@/marcom/agents/personalization/agent';
import {
  getProjectNotionConnection,
  getProjectNotionSync,
  sanitizeProjectSyncRecordForClient,
} from '@/marcom/integrations/notion/store';
import type {
  NotionProjectSyncRecord,
  NotionReconciledChanges,
} from '@/marcom/integrations/notion/types';
import {
  pullNotionChangesForProject,
  syncProjectToNotion,
} from '@/marcom/integrations/notion/sync';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type {
  PersonalizationEntry,
  PersonalizationSettings,
} from '@/marcom/schemas/personalization';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadHybridResearch(
  actor: ActorContext,
  projectId: string,
  allowFileFallback: boolean,
): Promise<ResearchEntry[]> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      const dbEntries = await listDbResearch(actor, projectId);
      if (dbEntries && dbEntries.length > 0) {
        return dbEntries;
      }
    } catch (err) {
      if (!allowFileFallback) throw err;
      console.warn(`DB listResearch failed for ${projectId}, falling back to file store:`, err);
    }
  }
  if (!allowFileFallback && isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    return [];
  }
  return listFileResearch(projectId);
}

async function loadHybridPersonalizations(
  actor: ActorContext,
  projectId: string,
  allowFileFallback: boolean,
): Promise<PersonalizationEntry[]> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      const dbEntries = await listDbPersonalizations(actor, projectId);
      if (dbEntries && dbEntries.length > 0) {
        return dbEntries;
      }
    } catch (err) {
      if (!allowFileFallback) throw err;
      console.warn(`DB listPersonalizations failed for ${projectId}, falling back to file store:`, err);
    }
  }
  if (!allowFileFallback && isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    return [];
  }
  return listFilePersonalizations(projectId);
}

async function loadHybridPersonalizationSettings(
  actor: ActorContext,
  projectId: string,
): Promise<PersonalizationSettings> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      return await getDbPersonalizationSettings(actor, projectId);
    } catch {
      // Fall back to file personalization settings
    }
  }
  return getFilePersonalizationSettings(projectId);
}

function populateAdaptiveDrafts(
  projectId: string,
  research: ResearchEntry[],
  brief: StructuredBrief,
  settings: PersonalizationSettings,
  draftsMap: Record<string, PersonalizationEntry>,
) {
  for (const entry of research) {
    const recId = entry.record.record_id;
    const isPersonalizedLead =
      entry.review?.status === 'shortlisted' || entry.relationship_status === 'contacted';
    const existing = draftsMap[recId];
    if (isPersonalizedLead && (!existing || !existing.copy)) {
      const adaptive = buildAdaptivePersonalizationEntry({
        projectId,
        researchEntry: entry,
        brief,
        settings,
        leadSettings: settings.lead_settings?.[recId] ?? existing?.lead_settings,
        existing,
      });
      const stableTimestamp =
        entry.review?.reviewed_at ||
        entry.record.researched_at ||
        '2020-01-01T00:00:00.000Z';
      draftsMap[recId] = {
        ...adaptive,
        generated_at: stableTimestamp,
        updated_at: stableTimestamp,
      };
    }
  }
}

async function persistReconciledNotionChanges(
  actor: ActorContext,
  projectId: string,
  reconciled: NotionReconciledChanges,
): Promise<void> {
  const isDb = isDatabaseConfigured() && UUID_REGEX.test(projectId);

  if (reconciled.updatedBrief) {
    const nextBrief = reconciled.updatedBrief;
    try {
      updateFileProject(projectId, (current) => ({
        ...current,
        name: nextBrief.project.name || current.name,
        summary: nextBrief.project.description || current.summary,
        structured_brief: nextBrief,
        target_definitions: nextBrief.targets.map((t) => ({
          target_type: t.target_type,
          definition: t.description,
          aliases: [],
        })),
        configuration_revision: (current.configuration_revision ?? 1) + 1,
        configuration_updated_at: new Date().toISOString(),
      }));
    } catch {
      // Ignore file fallback write failure on read-only fs
    }

    if (isDb) {
      try {
        const currentCampaign = await getCampaign(actor, projectId);
        if (currentCampaign) {
          await updateCampaignConfiguration(actor, projectId, {
            structuredBrief: nextBrief,
            expectedRevision: currentCampaign.configuration_revision ?? 1,
            requestId: randomUUID(),
          });
        }
      } catch (err) {
        console.warn('Failed to persist Notion-reconciled campaign brief to DB:', err);
      }
    }
  }

  for (const updatedEntry of reconciled.updatedResearchEntries || []) {
    try {
      updateFileResearchEntryById(projectId, updatedEntry);
    } catch {
      // Ignore file fallback write failure on read-only fs
    }
    if (isDb) {
      await updateDbResearchEntryFromSync(actor, projectId, updatedEntry).catch((err) => {
        console.warn('Failed to persist Notion-reconciled research entry to DB:', err);
      });
    }
  }

  for (const updatedDraft of reconciled.updatedDrafts) {
    try {
      saveFilePersonalization(projectId, updatedDraft);
    } catch {
      // Ignore file fallback write failure on read-only fs
    }
    if (isDb) {
      await saveDbPersonalization(actor, projectId, updatedDraft).catch((err) => {
        console.warn('Failed to persist Notion-reconciled draft to DB:', err);
      });
    }
  }

  for (const updatedRev of reconciled.updatedReviews) {
    try {
      updateFileResearchReview(
        projectId,
        updatedRev.recordId,
        updatedRev.status,
        updatedRev.note,
        updatedRev.relationshipStatus,
      );
    } catch {
      // Ignore file fallback write failure on read-only fs
    }
    if (isDb) {
      await updateDbResearchReview(
        actor,
        projectId,
        updatedRev.recordId,
        updatedRev.status,
        updatedRev.note,
        updatedRev.relationshipStatus,
      ).catch((err) => {
        console.warn('Failed to persist Notion-reconciled review status to DB:', err);
      });
    }
  }
}

export async function GET(req: Request, context: RouteContext) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  const { id } = await context.params;

  try {
    const connection = await getProjectNotionConnection(id, req);
    if (!connection?.accessToken) {
      return NextResponse.json({
        success: true,
        connected: false,
        workspaceName: null,
        workspaceId: null,
        sync: null,
        pulledCount: 0,
      });
    }

    const syncRecord = await getProjectNotionSync(id);
    const matchesWorkspace =
      syncRecord &&
      (!connection.workspaceId ||
        !syncRecord.notionWorkspaceId ||
        syncRecord.notionWorkspaceId === connection.workspaceId);

    let pulledCount = 0;
    let reconciledChanges: NotionReconciledChanges | undefined;

    if (matchesWorkspace && syncRecord?.databaseId) {
      try {
        const [project, research, personalizations, settings] = await Promise.all([
          readCampaignMemory(access.actor, id, true).catch(() => null),
          loadHybridResearch(access.actor, id, true).catch(() => [] as ResearchEntry[]),
          loadHybridPersonalizations(access.actor, id, true).catch(
            () => [] as PersonalizationEntry[],
          ),
          loadHybridPersonalizationSettings(access.actor, id),
        ]);

        const draftsMap: Record<string, PersonalizationEntry> = {};
        for (const p of personalizations) {
          if (p?.record_id) draftsMap[p.record_id] = p;
        }
        if (project?.structured_brief) {
          populateAdaptiveDrafts(
            id,
            research,
            project.structured_brief,
            settings,
            draftsMap,
          );
        }

        const reconciled = await pullNotionChangesForProject(
          {
            projectId: id,
            brief: project?.structured_brief ?? null,
            configurationUpdatedAt: project?.configuration_updated_at ?? null,
            prospects: research,
            drafts: draftsMap,
            existingSync: syncRecord,
          },
          connection.accessToken,
        );

        if (reconciled.pulledCount > 0) {
          await persistReconciledNotionChanges(access.actor, id, reconciled);
          pulledCount = reconciled.pulledCount;
          reconciledChanges = reconciled;
        }
      } catch (pullErr) {
        console.warn(`Background Notion pull on GET failed for project ${id}:`, pullErr);
      }
    }

    return NextResponse.json({
      success: true,
      connected: true,
      workspaceName: connection.workspaceName ?? null,
      workspaceId: connection.workspaceId ?? null,
      sync: matchesWorkspace ? sanitizeProjectSyncRecordForClient(syncRecord) : null,
      pulledCount,
      ...(reconciledChanges ? { reconciledChanges } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message || 'Failed to read Notion sync state.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext) {
  const access = await authorizeApiRequest(req, { allowGuest: true });
  if (!access.ok) return access.response;

  const { id } = await context.params;

  try {
    const connection = await getProjectNotionConnection(id, req);
    if (!connection?.accessToken) {
      return NextResponse.json(
        {
          error:
            'Notion is not connected. Please connect your Notion workspace in Settings > Integrations.',
        },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      parentPageId?: string;
      brief?: StructuredBrief | null;
      configurationUpdatedAt?: string | null;
      prospects?: ResearchEntry[];
      drafts?: PersonalizationEntry[];
      settings?: PersonalizationSettings | null;
      batchMode?: boolean;
      skipHubUpdate?: boolean;
      existingSync?: NotionProjectSyncRecord | null;
      activeRecordIds?: string[];
      statsOverride?: {
        totalProspects: number;
        shortlistedCount: number;
        draftsReadyCount: number;
      };
    };

    const isClientBatch = Boolean(body.batchMode && body.brief && Array.isArray(body.prospects));
    const project = isClientBatch
      ? null
      : await readCampaignMemory(access.actor, id, true).catch(() => null);
    const brief = body.brief ?? project?.structured_brief ?? null;
    if (!brief) {
      return NextResponse.json(
        { error: 'Campaign does not have a structured brief configured.' },
        { status: 400 },
      );
    }

    let research: ResearchEntry[];
    let settings: PersonalizationSettings;
    const draftsMap: Record<string, PersonalizationEntry> = {};

    if (isClientBatch) {
      research = body.prospects || [];
      settings =
        body.settings ?? (await loadHybridPersonalizationSettings(access.actor, id));
      if (Array.isArray(body.drafts)) {
        for (const p of body.drafts) {
          if (p?.record_id) draftsMap[p.record_id] = p;
        }
      }
    } else {
      const [serverResearch, serverPersonalizations, serverSettings] = await Promise.all([
        loadHybridResearch(access.actor, id, true).catch(() => [] as ResearchEntry[]),
        loadHybridPersonalizations(access.actor, id, true).catch(() => [] as PersonalizationEntry[]),
        loadHybridPersonalizationSettings(access.actor, id),
      ]);

      research =
        body.batchMode && Array.isArray(body.prospects)
          ? body.prospects
          : serverResearch.length > 0
            ? serverResearch
            : Array.isArray(body.prospects)
              ? body.prospects
              : [];
      settings = body.settings ?? serverSettings;

      for (const p of serverPersonalizations) {
        if (p?.record_id) draftsMap[p.record_id] = p;
      }
      if (Array.isArray(body.drafts)) {
        for (const p of body.drafts) {
          if (p?.record_id) draftsMap[p.record_id] = p;
        }
      }
    }

    populateAdaptiveDrafts(id, research, brief, settings, draftsMap);

    const result = await syncProjectToNotion(
      {
        projectId: id,
        brief,
        configurationUpdatedAt:
          body.configurationUpdatedAt ?? project?.configuration_updated_at ?? null,
        prospects: research,
        drafts: draftsMap,
        parentPageId: body.parentPageId || connection.defaultParentPageId || undefined,
        notionWorkspaceId: connection.workspaceId,
        ...(body.existingSync !== undefined ? { existingSync: body.existingSync } : {}),
        ...(body.skipHubUpdate ? { skipHubUpdate: true } : {}),
        ...(body.activeRecordIds ? { activeRecordIds: body.activeRecordIds } : {}),
        ...(body.statsOverride ? { statsOverride: body.statsOverride } : {}),
      },
      connection.accessToken,
    );

    if (result.reconciledChanges && result.reconciledChanges.pulledCount > 0) {
      await persistReconciledNotionChanges(access.actor, id, result.reconciledChanges);
    }

    if (!result.success) {
      return NextResponse.json(
        {
          error:
            result.errors?.[0] ||
            'Notion created the campaign hub, but prospect rows failed validation.',
          ...result,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message || 'Failed to sync campaign to Notion.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
