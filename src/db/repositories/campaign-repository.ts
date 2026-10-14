import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '../client';
import type { ActorContext } from '../local-actor';
import { requestHash } from '../idempotency';
import {
  auditEvents,
  campaignBriefs,
  campaignConfigVersions,
  campaigns,
  idempotencyRecords,
} from '../schema';
import { StructuredBriefSchema, type StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ProjectMemory } from '@/marcom/memory/types';

type CampaignRow = typeof campaigns.$inferSelect;
type ConfigurationRow = typeof campaignConfigVersions.$inferSelect;

export interface CreateCampaignInput {
  structuredBrief: StructuredBrief;
  originalBrief: string;
  sourceType: 'PASTE' | 'UPLOAD' | 'URL';
  sourceName: string;
  idempotencyKey: string;
  requestId?: string;
}

export interface UpdateCampaignConfigurationInput {
  structuredBrief: StructuredBrief;
  expectedRevision: number;
  requestId?: string;
}

export class CampaignNotFoundError extends Error {}
export class CampaignVersionConflictError extends Error {}
export class CampaignIdempotencyConflictError extends Error {}
export class CampaignCommandInProgressError extends Error {}

function slugify(title: string, campaignId: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'campaign';
  return `${base.slice(0, 91)}-${campaignId.slice(0, 8)}`;
}

function databaseStatusToMemory(status: string): ProjectMemory['status'] {
  if (status === 'ready' || status === 'researching') return 'READY_FOR_RESEARCH';
  if (status === 'active' || status === 'paused' || status === 'completed' || status === 'draft') {
    return status;
  }
  return 'draft';
}

function configurationValues(brief: StructuredBrief, sourceName: string) {
  return {
    objective: brief.project.primary_objective,
    primaryCta: brief.outreach.objectives[0] ?? '',
    successEvent: {
      schemaVersion: 1,
      successMetrics: brief.project.success_metrics,
    },
    targetCriteria: {
      schemaVersion: 1,
      targets: brief.targets,
    },
    exclusions: {
      schemaVersion: 1,
      constraints: brief.constraints,
      excludedKeywords: brief.research.search_settings?.excluded_keywords ?? [],
      excludedDomains: brief.research.search_settings?.excluded_domains ?? [],
    },
    sourcePreferences: {
      schemaVersion: 1,
      research: brief.research,
    },
    approvedFacts: {
      schemaVersion: 1,
      structuredBrief: brief,
      sourceName,
    },
    messagingGuidance: {
      schemaVersion: 1,
      personalization: brief.personalization,
      outreach: brief.outreach,
    },
    followupPolicy: { schemaVersion: 1 },
  };
}

function readStructuredBrief(config: ConfigurationRow | null): StructuredBrief | null {
  if (!config) return null;
  const candidate = config.approvedFacts.structuredBrief;
  const parsed = StructuredBriefSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Campaign configuration ${config.id} does not contain a valid structured brief.`);
  }
  return parsed.data;
}

function toProjectMemory(campaign: CampaignRow, config: ConfigurationRow | null): ProjectMemory {
  const structuredBrief = readStructuredBrief(config);
  const sourceName = typeof config?.approvedFacts.sourceName === 'string'
    ? config.approvedFacts.sourceName
    : 'Stored campaign brief';

  return {
    project_id: campaign.id,
    name: campaign.title,
    aliases: [],
    summary: campaign.description ?? structuredBrief?.project.description ?? '',
    status: databaseStatusToMemory(campaign.status),
    structured_brief: structuredBrief,
    target_definitions: structuredBrief?.targets.map((target) => ({
      target_type: target.target_type,
      definition: target.description,
      aliases: [],
    })) ?? [],
    notes: [`Original Brief Source: ${sourceName}`],
    configuration_revision: config?.version ?? campaign.rowVersion,
    configuration_updated_at: (config?.updatedAt ?? campaign.updatedAt).toISOString(),
  };
}

export async function listCampaigns(
  actor: ActorContext,
  database: MarcomDatabase = getDatabase(),
): Promise<ProjectMemory[]> {
  const rows = await database
    .select({ campaign: campaigns, config: campaignConfigVersions })
    .from(campaigns)
    .leftJoin(campaignConfigVersions, eq(campaignConfigVersions.id, campaigns.activeConfigVersionId))
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), ne(campaigns.status, 'archived')))
    .orderBy(desc(campaigns.updatedAt));

  return rows.map(({ campaign, config }) => toProjectMemory(campaign, config));
}

export async function getCampaign(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<ProjectMemory | null> {
  const [row] = await database
    .select({ campaign: campaigns, config: campaignConfigVersions })
    .from(campaigns)
    .leftJoin(campaignConfigVersions, eq(campaignConfigVersions.id, campaigns.activeConfigVersionId))
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, campaignId)))
    .limit(1);

  return row ? toProjectMemory(row.campaign, row.config) : null;
}

export async function createCampaign(
  actor: ActorContext,
  input: CreateCampaignInput,
  database: MarcomDatabase = getDatabase(),
): Promise<ProjectMemory> {
  const brief = StructuredBriefSchema.parse(input.structuredBrief);
  const title = brief.project.name?.trim();
  if (!title) throw new Error('Campaign name is required.');

  const operation = 'campaign.create';
  const actorKey = `membership:${actor.membershipId}`;
  const hash = requestHash({
    structuredBrief: brief,
    originalBrief: input.originalBrief,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
  });

  return database.transaction(async (transaction) => {
    const idempotencyId = randomUUID();
    const [claimed] = await transaction
      .insert(idempotencyRecords)
      .values({
        id: idempotencyId,
        workspaceId: actor.workspaceId,
        actorKey,
        operation,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        status: 'processing',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyRecords.id });

    if (!claimed) {
      const [existing] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.workspaceId, actor.workspaceId),
            eq(idempotencyRecords.actorKey, actorKey),
            eq(idempotencyRecords.operation, operation),
            eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing || existing.requestHash !== hash) {
        throw new CampaignIdempotencyConflictError(
          'This idempotency key was already used with different campaign data.',
        );
      }
      if (existing.status === 'completed' && existing.resourceId) {
        const replay = await getCampaign(actor, existing.resourceId, transaction as MarcomDatabase);
        if (replay) return replay;
      }
      throw new CampaignCommandInProgressError('A matching campaign creation request is still processing.');
    }

    const campaignId = randomUUID();
    const briefId = randomUUID();
    const configurationId = randomUUID();
    const now = new Date();
    const configValues = configurationValues(brief, input.sourceName);

    const [campaign] = await transaction
      .insert(campaigns)
      .values({
        id: campaignId,
        workspaceId: actor.workspaceId,
        ownerMembershipId: actor.membershipId,
        title,
        slug: slugify(title, campaignId),
        description: brief.project.description,
        status: 'ready',
        rowVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await transaction.insert(campaignBriefs).values({
      id: briefId,
      campaignId,
      version: 1,
      inputMethod: 'paste',
      sourceText: input.originalBrief,
      contentHash: createHash('sha256').update(input.originalBrief, 'utf8').digest('hex'),
      parserName: input.sourceType === 'UPLOAD' ? 'local-file-extractor' : 'campaign-intake',
      parserVersion: '1',
      createdByMembershipId: actor.membershipId,
      createdAt: now,
    });

    const [configuration] = await transaction
      .insert(campaignConfigVersions)
      .values({
        id: configurationId,
        campaignId,
        briefId,
        version: 1,
        status: 'approved',
        ...configValues,
        createdByMembershipId: actor.membershipId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await transaction
      .update(campaigns)
      .set({ activeConfigVersionId: configurationId })
      .where(eq(campaigns.id, campaignId));

    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'campaign.created',
      subjectType: 'campaign',
      subjectId: campaignId,
      safeDiff: { title, configurationVersion: 1 },
      requestId: input.requestId,
    });

    await transaction
      .update(idempotencyRecords)
      .set({
        status: 'completed',
        responseStatus: 201,
        responseBody: { campaignId },
        resourceType: 'campaign',
        resourceId: campaignId,
        updatedAt: now,
      })
      .where(eq(idempotencyRecords.id, idempotencyId));

    return toProjectMemory({ ...campaign, activeConfigVersionId: configurationId }, configuration);
  });
}

export async function updateCampaignConfiguration(
  actor: ActorContext,
  campaignId: string,
  input: UpdateCampaignConfigurationInput,
  database: MarcomDatabase = getDatabase(),
): Promise<ProjectMemory> {
  const brief = StructuredBriefSchema.parse(input.structuredBrief);
  const title = brief.project.name?.trim();
  if (!title) throw new Error('Campaign name is required.');

  return database.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ campaign: campaigns, config: campaignConfigVersions })
      .from(campaigns)
      .leftJoin(campaignConfigVersions, eq(campaignConfigVersions.id, campaigns.activeConfigVersionId))
      .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, campaignId)))
      .limit(1);

    if (!current || current.campaign.status === 'archived') {
      throw new CampaignNotFoundError('Campaign not found.');
    }
    const currentRevision = current.config?.version ?? current.campaign.rowVersion;
    if (currentRevision !== input.expectedRevision) {
      throw new CampaignVersionConflictError(
        'This campaign was changed in another window. Refresh and review the latest version before saving.',
      );
    }

    const configurationId = randomUUID();
    const nextVersion = currentRevision + 1;
    const now = new Date();
    const sourceName = typeof current.config?.approvedFacts.sourceName === 'string'
      ? current.config.approvedFacts.sourceName
      : 'Stored campaign brief';

    if (current.config) {
      await transaction
        .update(campaignConfigVersions)
        .set({ status: 'superseded', updatedAt: now })
        .where(eq(campaignConfigVersions.id, current.config.id));
    }

    const [configuration] = await transaction
      .insert(campaignConfigVersions)
      .values({
        id: configurationId,
        campaignId,
        briefId: current.config?.briefId,
        version: nextVersion,
        status: 'approved',
        ...configurationValues(brief, sourceName),
        createdByMembershipId: actor.membershipId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [updatedCampaign] = await transaction
      .update(campaigns)
      .set({
        title,
        slug: slugify(title, campaignId),
        description: brief.project.description,
        status: 'ready',
        activeConfigVersionId: configurationId,
        rowVersion: nextVersion,
        updatedAt: now,
      })
      .where(
        and(
          eq(campaigns.workspaceId, actor.workspaceId),
          eq(campaigns.id, campaignId),
          eq(campaigns.rowVersion, input.expectedRevision),
        ),
      )
      .returning();

    if (!updatedCampaign) {
      throw new CampaignVersionConflictError(
        'This campaign was changed in another window. Refresh and review the latest version before saving.',
      );
    }

    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'campaign.configuration.updated',
      subjectType: 'campaign_config_version',
      subjectId: configurationId,
      safeDiff: { previousVersion: currentRevision, configurationVersion: nextVersion },
      requestId: input.requestId,
    });

    return toProjectMemory(updatedCampaign, configuration);
  });
}

export async function archiveCampaign(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const now = new Date();
    const [archived] = await transaction
      .update(campaigns)
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(campaigns.workspaceId, actor.workspaceId),
          eq(campaigns.id, campaignId),
          ne(campaigns.status, 'archived'),
        ),
      )
      .returning({ id: campaigns.id });

    if (!archived) return false;
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'campaign.archived',
      subjectType: 'campaign',
      subjectId: campaignId,
      safeDiff: { status: 'archived' },
    });
    return true;
  });
}
