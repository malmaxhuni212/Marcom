import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import type {
  NotionProjectSyncRecord,
  NotionSyncOptions,
  NotionSyncResult,
} from './types';
import {
  appendNotionBlocks,
  createNotionDatabase,
  createNotionPage,
  getNotionDatabase,
  getNotionPage,
  listNotionBlockChildren,
  NotionApiError,
  notionFetch,
  queryNotionDatabaseRows,
  replaceNotionPageBlocks,
  searchNotionAccessiblePages,
  updateNotionBlock,
  updateNotionDatabase,
  updateNotionPage,
} from './client';
import {
  buildCampaignBriefBlocks,
  buildCampaignSummaryCallout,
  buildProspectPageBodyBlocks,
  buildProspectPageProperties,
  buildProspectsDatabaseProperties,
  buildProspectsDatabaseSchema,
  richText,
  type CampaignBriefSyncStats,
} from './builder';
import {
  getNotionConnection,
  getProjectNotionSync,
  saveProjectNotionSync,
} from './store';

export function notionPageUrlFromId(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

async function findRecoverableCampaignHub(
  accessToken: string,
  expectedHubTitle: string,
): Promise<{
  campaignPageId: string;
  campaignPageUrl: string;
  parentPageId: string;
  databaseId: string;
  databaseUrl: string;
  existingProperties: Record<string, any>;
} | null> {
  try {
    const searchData = await notionFetch('/search', accessToken, {
      method: 'POST',
      body: JSON.stringify({
        query: expectedHubTitle,
        filter: { value: 'page', property: 'object' },
        page_size: 20,
      }),
    });

    const pages: any[] = Array.isArray(searchData.results) ? searchData.results : [];
    for (const page of pages) {
      if (!page || page.archived || page.in_trash) continue;
      if (page.parent?.type === 'database_id') continue;

      const titleArr = page.properties?.title?.title || page.properties?.Name?.title;
      const titleText = Array.isArray(titleArr)
        ? titleArr.map((t: any) => t?.plain_text || '').join('').trim()
        : '';
      if (titleText !== expectedHubTitle) continue;

      const children = await listNotionBlockChildren(accessToken, page.id);
      const childDbBlock = children.find((b) => b.type === 'child_database');
      if (!childDbBlock) continue;

      const db = await getNotionDatabase(accessToken, childDbBlock.id);
      if (!db || db.archived || db.inTrash) continue;

      return {
        campaignPageId: page.id,
        campaignPageUrl: page.url,
        parentPageId: page.parent?.page_id || 'workspace',
        databaseId: db.id,
        databaseUrl: db.url,
        existingProperties: db.properties,
      };
    }
  } catch {
    // Non-fatal: if search recovery fails, fall back to creating a fresh Campaign Hub
  }
  return null;
}

async function ensureMissingDatabaseColumns(
  accessToken: string,
  databaseId: string,
  existingProperties: Record<string, any>,
): Promise<void> {
  const desired = buildProspectsDatabaseProperties();
  const missing: Record<string, any> = {};

  for (const [propName, propSchema] of Object.entries(desired)) {
    if (propName === 'Prospect') continue; // Never overwrite title column
    if (!(propName in existingProperties)) {
      missing[propName] = propSchema;
    }
  }

  if (Object.keys(missing).length > 0) {
    await updateNotionDatabase(accessToken, databaseId, { properties: missing });
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx]!, idx);
    }
  });
  await Promise.all(runners);
}

export async function syncProjectToNotion(
  options: NotionSyncOptions,
  accessToken: string,
): Promise<NotionSyncResult> {
  const { projectId, brief, prospects, drafts = {} } = options;
  const campaignName = (brief.project.name || 'Campaign').trim();
  const hubTitle = `${campaignName} — Intelligence & Outreach Hub`;
  const nowIso = new Date().toISOString();

  const shortlistedCount = prospects.filter(
    (p) => p.review?.status === 'shortlisted' || p.relationship_status === 'contacted',
  ).length;
  const draftsReadyCount = prospects.filter((p) => {
    const recId = p.record.record_id;
    const pName = (p.record.identity.name || p.seed.name || '').toLowerCase();
    const d =
      drafts[recId] ||
      Object.values(drafts).find((item) => item.prospect_name.toLowerCase() === pName);
    return Boolean(d?.copy);
  }).length;

  const syncStats: CampaignBriefSyncStats = {
    totalProspects: prospects.length,
    shortlistedCount,
    draftsReadyCount,
    syncedAtIso: nowIso,
  };

  // 1. Check whether this project already has an active synced Campaign Hub & Database
  const storedSync =
    options.existingSync !== undefined
      ? options.existingSync
      : await getProjectNotionSync(projectId);

  let isResync = false;
  let parentPageId = options.parentPageId || storedSync?.parentPageId || '';
  let campaignPageId = '';
  let campaignPageUrl = '';
  let databaseId = '';
  let databaseUrl = '';
  const prospectPageIds: Record<string, string> = {
    ...(storedSync?.prospectPageIds || {}),
  };

  if (
    options.skipHubUpdate &&
    storedSync?.campaignPageId &&
    storedSync?.databaseId
  ) {
    isResync = true;
    parentPageId = storedSync.parentPageId || parentPageId;
    campaignPageId = storedSync.campaignPageId;
    campaignPageUrl = storedSync.campaignPageUrl || notionPageUrlFromId(storedSync.campaignPageId);
    databaseId = storedSync.databaseId;
    databaseUrl = storedSync.databaseUrl || notionPageUrlFromId(storedSync.databaseId);
  } else if (
    storedSync &&
    (!options.notionWorkspaceId ||
      !storedSync.notionWorkspaceId ||
      storedSync.notionWorkspaceId === options.notionWorkspaceId)
  ) {
    const [existingPage, existingDb] = await Promise.all([
      getNotionPage(accessToken, storedSync.campaignPageId),
      getNotionDatabase(accessToken, storedSync.databaseId),
    ]);

    if (
      existingPage &&
      !existingPage.archived &&
      !existingPage.inTrash &&
      existingDb &&
      !existingDb.archived &&
      !existingDb.inTrash
    ) {
      isResync = true;
      campaignPageId = existingPage.id;
      campaignPageUrl = existingPage.url;
      databaseId = existingDb.id;
      databaseUrl = existingDb.url;
      await ensureMissingDatabaseColumns(accessToken, databaseId, existingDb.properties);
    }
  }

  // 1b. If no stored sync state matched, check if an identical Campaign Hub already exists in Notion
  // (e.g., from an earlier sync before sync-state persistence was active)
  if (!isResync && !options.parentPageId) {
    const recovered = await findRecoverableCampaignHub(accessToken, hubTitle);
    if (recovered) {
      isResync = true;
      parentPageId = recovered.parentPageId;
      campaignPageId = recovered.campaignPageId;
      campaignPageUrl = recovered.campaignPageUrl;
      databaseId = recovered.databaseId;
      databaseUrl = recovered.databaseUrl;
      await ensureMissingDatabaseColumns(
        accessToken,
        databaseId,
        recovered.existingProperties,
      );
    }
  }

  // 2. Create or update the Campaign Hub Page & Prospects Database
  if (isResync) {
    if (!options.skipHubUpdate) {
      await updateNotionPage(accessToken, campaignPageId, {
        properties: {
          title: {
            title: [richText(hubTitle)],
          },
        },
      }).catch(() => null);

      // Update top summary callout block in-place so the child_database position is preserved
      try {
        const topBlocks = await listNotionBlockChildren(accessToken, campaignPageId);
        if (topBlocks[0]?.type === 'callout') {
          const updatedCallout = buildCampaignSummaryCallout(brief, syncStats);
          await updateNotionBlock(accessToken, topBlocks[0].id, {
            callout: updatedCallout.callout,
          });
        }
      } catch {
        // Non-fatal if callout block was manually edited or removed in Notion
      }
    }
  } else {
    if (!parentPageId) {
      const accessible = await searchNotionAccessiblePages(accessToken);
      if (!accessible.length) {
        throw new Error(
          'No accessible Notion pages found. Please share at least one page with the Marcom integration in Notion (Settings > Connections, or reconnect and select a page).',
        );
      }
      parentPageId = accessible[0]!.id;
    }

    const briefBlocks = buildCampaignBriefBlocks(brief, syncStats);

    let campaignPage: { id: string; url: string };
    try {
      campaignPage = await createNotionPage(accessToken, {
        parent: { page_id: parentPageId },
        icon: { type: 'emoji', emoji: '🚀' },
        properties: {
          title: {
            title: [richText(hubTitle)],
          },
        },
        children: briefBlocks.slice(0, 80),
      });
    } catch (createErr) {
      const accessible = await searchNotionAccessiblePages(accessToken).catch(() => []);
      const fallbackParentId = accessible.find((p) => p.id !== parentPageId)?.id || accessible[0]?.id;
      if (!fallbackParentId || fallbackParentId === parentPageId) {
        throw createErr;
      }
      parentPageId = fallbackParentId;
      campaignPage = await createNotionPage(accessToken, {
        parent: { page_id: parentPageId },
        icon: { type: 'emoji', emoji: '🚀' },
        properties: {
          title: {
            title: [richText(hubTitle)],
          },
        },
        children: briefBlocks.slice(0, 80),
      });
    }

    if (briefBlocks.length > 80) {
      await appendNotionBlocks(accessToken, campaignPage.id, briefBlocks.slice(80));
    }

    const dbSchema = buildProspectsDatabaseSchema(campaignPage.id);
    const database = await createNotionDatabase(accessToken, dbSchema);

    campaignPageId = campaignPage.id;
    campaignPageUrl = campaignPage.url;
    databaseId = database.id;
    databaseUrl = database.url;

    // Persist Hub & Database IDs immediately so subsequent batches or retries reuse them
    await saveProjectNotionSync({
      projectId,
      notionWorkspaceId: options.notionWorkspaceId || storedSync?.notionWorkspaceId || '',
      parentPageId,
      campaignPageId,
      campaignPageUrl,
      databaseId,
      databaseUrl,
      prospectPageIds,
      syncedCount: 0,
      lastSyncedAt: nowIso,
    }).catch(() => undefined);
  }

  // 3. If re-syncing, index existing rows in the database to prevent duplicates
  const existingRowByRecordId = new Map<string, string>();
  const existingRowByName = new Map<string, string>();

  if (isResync && options.skipHubUpdate) {
    for (const [recId, pageId] of Object.entries(prospectPageIds)) {
      if (pageId) existingRowByRecordId.set(recId, pageId);
    }
  } else if (isResync) {
    try {
      const existingRows = await queryNotionDatabaseRows(accessToken, databaseId);
      const activeIds = new Set(existingRows.map((r) => r.id));

      for (const [recId, pageId] of Object.entries(prospectPageIds)) {
        if (activeIds.has(pageId)) {
          existingRowByRecordId.set(recId, pageId);
        } else {
          delete prospectPageIds[recId];
        }
      }

      for (const row of existingRows) {
        if (row.recordId && !existingRowByRecordId.has(row.recordId)) {
          existingRowByRecordId.set(row.recordId, row.id);
        }
        if (row.prospectName) {
          existingRowByName.set(row.prospectName.toLowerCase(), row.id);
        }
      }
    } catch {
      // Fall back to stored prospectPageIds if query fails
    }
  }

  // 4. Upsert Prospects as Database Rows/Pages with controlled concurrency (2)
  let syncedCount = 0;
  let createdCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  await runWithConcurrency(prospects, 3, async (entry) => {
    const recId = entry.record.record_id;
    const prospectName = (entry.record.identity.name || entry.seed.name || 'Unnamed Prospect').trim();

    try {
      const matchingDraft =
        drafts[recId] ||
        Object.values(drafts).find(
          (d) => d.prospect_name.trim().toLowerCase() === prospectName.toLowerCase(),
        );

      const properties = buildProspectPageProperties(entry, matchingDraft);
      const bodyBlocks = buildProspectPageBodyBlocks(entry, matchingDraft);
      const rowEmoji = entry.record.identity.entity_kind === 'organisation' ? '🏢' : '👤';

      const targetPageId =
        existingRowByRecordId.get(recId) ||
        existingRowByName.get(prospectName.toLowerCase()) ||
        null;

      if (targetPageId) {
        try {
          await updateNotionPage(accessToken, targetPageId, {
            icon: { type: 'emoji', emoji: rowEmoji },
            properties,
          });
          await replaceNotionPageBlocks(accessToken, targetPageId, bodyBlocks);
          prospectPageIds[recId] = targetPageId;
          updatedCount += 1;
          syncedCount += 1;
          return;
        } catch (updateErr) {
          // If the row was trashed/deleted in Notion, fall through and recreate it cleanly
          if (!(updateErr instanceof NotionApiError && (updateErr.status === 404 || updateErr.status === 400))) {
            throw updateErr;
          }
        }
      }

      const createdPage = await createNotionPage(accessToken, {
        parent: { database_id: databaseId },
        icon: { type: 'emoji', emoji: rowEmoji },
        properties,
        children: bodyBlocks.slice(0, 80),
      });

      if (bodyBlocks.length > 80) {
        await appendNotionBlocks(accessToken, createdPage.id, bodyBlocks.slice(80));
      }

      prospectPageIds[recId] = createdPage.id;
      createdCount += 1;
      syncedCount += 1;
    } catch (err) {
      const msg = (err as Error).message || 'Unknown Notion error';
      errors.push(`Failed to sync "${prospectName}": ${msg}`);
    }
  });

  const lastSyncedAt = new Date().toISOString();
  const syncRecord: NotionProjectSyncRecord = {
    projectId,
    notionWorkspaceId: options.notionWorkspaceId || storedSync?.notionWorkspaceId || '',
    parentPageId,
    campaignPageId,
    campaignPageUrl,
    databaseId,
    databaseUrl,
    prospectPageIds,
    syncedCount,
    lastSyncedAt,
  };
  await saveProjectNotionSync(syncRecord);

  const success = prospects.length === 0 ? true : syncedCount > 0;

  return {
    success,
    url: campaignPageUrl,
    campaignPageId,
    campaignPageUrl,
    databaseId,
    databaseUrl,
    syncedCount,
    prospectsSynced: syncedCount,
    createdCount,
    updatedCount,
    failedCount: errors.length,
    isResync,
    lastSyncedAt,
    prospectPageIds,
    errors: errors.length ? errors : undefined,
  };
}

export interface TargetedNotionSyncOptions {
  projectId: string;
  brief?: StructuredBrief | null;
  targetEntries: ResearchEntry[];
  draftsByRecordId?: Record<string, PersonalizationEntry>;
  allProspects?: ResearchEntry[];
}

export interface TargetedNotionSyncResult {
  synced: boolean;
  campaignPageUrl?: string;
  prospectPageIds?: Record<string, string>;
  prospectPageUrls?: Record<string, string>;
  updatedRecords?: number;
}

/**
 * Automatically updates only the modified prospect row(s) & dossier blocks in Notion
 * IF AND ONLY IF this campaign has already been explicitly synced to the active Notion workspace.
 * Never creates hubs for unsynced campaigns, and safely catches errors so primary workflows never fail.
 */
export async function syncConnectedProjectRecordsToNotion(
  options: TargetedNotionSyncOptions,
): Promise<TargetedNotionSyncResult> {
  try {
    if (!options.targetEntries.length) {
      return { synced: false };
    }

    const [connection, storedSync] = await Promise.all([
      getNotionConnection(),
      getProjectNotionSync(options.projectId),
    ]);

    if (!connection?.accessToken || !storedSync?.databaseId) {
      return { synced: false };
    }

    if (
      storedSync.notionWorkspaceId &&
      connection.workspaceId &&
      storedSync.notionWorkspaceId !== connection.workspaceId
    ) {
      return { synced: false };
    }

    const existingDb = await getNotionDatabase(connection.accessToken, storedSync.databaseId);
    if (!existingDb || existingDb.archived || existingDb.inTrash) {
      return { synced: false };
    }

    await ensureMissingDatabaseColumns(
      connection.accessToken,
      existingDb.id,
      existingDb.properties,
    );

    const drafts = options.draftsByRecordId || {};
    const prospectPageIds: Record<string, string> = {
      ...(storedSync.prospectPageIds || {}),
    };

    // Only query database rows if any target record ID is missing from our stored mapping
    const hasMissingMapping = options.targetEntries.some(
      (e) => !prospectPageIds[e.record.record_id],
    );
    const fallbackByName = new Map<string, string>();
    if (hasMissingMapping) {
      const existingRows = await queryNotionDatabaseRows(
        connection.accessToken,
        existingDb.id,
      ).catch(() => []);
      for (const row of existingRows) {
        if (row.recordId && !prospectPageIds[row.recordId]) {
          prospectPageIds[row.recordId] = row.id;
        }
        if (row.prospectName) {
          fallbackByName.set(row.prospectName.toLowerCase(), row.id);
        }
      }
    }

    let updatedRecords = 0;
    const prospectPageUrls: Record<string, string> = {};

    await runWithConcurrency(options.targetEntries, 2, async (entry) => {
      const recId = entry.record.record_id;
      const prospectName = (
        entry.record.identity.name ||
        entry.seed.name ||
        'Unnamed Prospect'
      ).trim();

      const matchingDraft =
        drafts[recId] ||
        Object.values(drafts).find(
          (d) => d.prospect_name.trim().toLowerCase() === prospectName.toLowerCase(),
        );

      const properties = buildProspectPageProperties(entry, matchingDraft);
      const bodyBlocks = buildProspectPageBodyBlocks(entry, matchingDraft);
      const rowEmoji = entry.record.identity.entity_kind === 'organisation' ? '🏢' : '👤';

      const targetPageId =
        prospectPageIds[recId] || fallbackByName.get(prospectName.toLowerCase()) || null;

      if (targetPageId) {
        try {
          await updateNotionPage(connection.accessToken, targetPageId, {
            icon: { type: 'emoji', emoji: rowEmoji },
            properties,
          });
          await replaceNotionPageBlocks(connection.accessToken, targetPageId, bodyBlocks);
          prospectPageIds[recId] = targetPageId;
          prospectPageUrls[recId] = notionPageUrlFromId(targetPageId);
          updatedRecords += 1;
          return;
        } catch (updateErr) {
          if (
            !(
              updateErr instanceof NotionApiError &&
              (updateErr.status === 404 || updateErr.status === 400)
            )
          ) {
            throw updateErr;
          }
        }
      }

      const createdPage = await createNotionPage(connection.accessToken, {
        parent: { database_id: existingDb.id },
        icon: { type: 'emoji', emoji: rowEmoji },
        properties,
        children: bodyBlocks.slice(0, 80),
      });

      if (bodyBlocks.length > 80) {
        await appendNotionBlocks(connection.accessToken, createdPage.id, bodyBlocks.slice(80));
      }

      prospectPageIds[recId] = createdPage.id;
      prospectPageUrls[recId] = createdPage.url || notionPageUrlFromId(createdPage.id);
      updatedRecords += 1;
    });

    const nowIso = new Date().toISOString();

    // Refresh Campaign Hub top callout pipeline stats if full prospect list & brief are available
    if (options.brief && options.allProspects && storedSync.campaignPageId) {
      try {
        const topBlocks = await listNotionBlockChildren(
          connection.accessToken,
          storedSync.campaignPageId,
        );
        if (topBlocks[0]?.type === 'callout') {
          const shortlistedCount = options.allProspects.filter(
            (p) =>
              p.review?.status === 'shortlisted' ||
              p.relationship_status === 'contacted' ||
              Boolean(drafts[p.record.record_id]?.copy),
          ).length;
          const draftsReadyCount = options.allProspects.filter((p) =>
            Boolean(drafts[p.record.record_id]?.copy),
          ).length;
          const updatedCallout = buildCampaignSummaryCallout(options.brief, {
            totalProspects: options.allProspects.length,
            shortlistedCount,
            draftsReadyCount,
            syncedAtIso: nowIso,
          });
          await updateNotionBlock(connection.accessToken, topBlocks[0].id, {
            callout: updatedCallout.callout,
          });
        }
      } catch {
        // Non-fatal
      }
    }

    await saveProjectNotionSync({
      ...storedSync,
      prospectPageIds,
      syncedCount: Object.keys(prospectPageIds).length,
      lastSyncedAt: nowIso,
    });

    return {
      synced: updatedRecords > 0,
      campaignPageUrl: storedSync.campaignPageUrl,
      prospectPageIds,
      prospectPageUrls,
      updatedRecords,
    };
  } catch (err) {
    console.warn('Background Notion record sync warning:', err);
    return { synced: false };
  }
}
