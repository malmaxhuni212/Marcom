import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { isDatabaseConfigured } from '@/db/env';
import type { ActorContext } from '@/db/local-actor';
import { listResearch as listDbResearch } from '@/db/repositories/research-repository';
import { listResearch as listFileResearch } from '@/marcom/memory/research-store';
import {
  getPersonalizationSettings as getDbPersonalizationSettings,
  listPersonalizations as listDbPersonalizations,
} from '@/db/repositories/personalization-repository';
import {
  getPersonalizationSettings as getFilePersonalizationSettings,
  listPersonalizations as listFilePersonalizations,
} from '@/marcom/memory/personalization-store';
import { readCampaignMemory } from '@/marcom/memory/server-store';
import { buildAdaptivePersonalizationEntry } from '@/marcom/agents/personalization/agent';
import {
  getNotionConnection,
  getProjectNotionSync,
} from '@/marcom/integrations/notion/store';
import { syncProjectToNotion } from '@/marcom/integrations/notion/sync';
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

export async function GET(req: Request, context: RouteContext) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;

  const { id } = await context.params;

  try {
    const [connection, syncRecord] = await Promise.all([
      getNotionConnection(),
      getProjectNotionSync(id),
    ]);

    const matchesWorkspace =
      syncRecord &&
      (!connection?.workspaceId ||
        !syncRecord.notionWorkspaceId ||
        syncRecord.notionWorkspaceId === connection.workspaceId);

    return NextResponse.json({
      success: true,
      connected: Boolean(connection?.accessToken),
      workspaceName: connection?.workspaceName ?? null,
      sync: matchesWorkspace ? syncRecord : null,
    });
  } catch (err) {
    const msg = (err as Error).message || 'Failed to read Notion sync state.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;

  const { id } = await context.params;

  try {
    const connection = await getNotionConnection();
    if (!connection?.accessToken) {
      return NextResponse.json(
        {
          error:
            'Notion is not connected. Please connect your Notion workspace in Settings > Integrations.',
        },
        { status: 400 },
      );
    }

    const project = await readCampaignMemory(access.actor, id, access.allowFileFallback);
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const brief = project.structured_brief;
    if (!brief) {
      return NextResponse.json(
        { error: 'Campaign does not have a structured brief configured.' },
        { status: 400 },
      );
    }

    const [research, personalizations, settings] = await Promise.all([
      loadHybridResearch(access.actor, id, access.allowFileFallback),
      loadHybridPersonalizations(access.actor, id, access.allowFileFallback),
      loadHybridPersonalizationSettings(access.actor, id),
    ]);

    const draftsMap: Record<string, PersonalizationEntry> = {};
    for (const p of personalizations) {
      draftsMap[p.record_id] = p;
    }

    // Ensure shortlisted / contacted prospects always have adaptive outreach drafts ready for Notion
    for (const entry of research) {
      const recId = entry.record.record_id;
      const isPersonalizedLead =
        entry.review?.status === 'shortlisted' || entry.relationship_status === 'contacted';
      const existing = draftsMap[recId];
      if (isPersonalizedLead && (!existing || !existing.copy)) {
        draftsMap[recId] = buildAdaptivePersonalizationEntry({
          projectId: id,
          researchEntry: entry,
          brief,
          settings,
          leadSettings: settings.lead_settings?.[recId] ?? existing?.lead_settings,
          existing,
        });
      }
    }

    const body = (await req.json().catch(() => ({}))) as { parentPageId?: string };

    const result = await syncProjectToNotion(
      {
        projectId: id,
        brief,
        prospects: research,
        drafts: draftsMap,
        parentPageId: body.parentPageId || connection.defaultParentPageId || undefined,
        notionWorkspaceId: connection.workspaceId,
      },
      connection.accessToken,
    );

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
