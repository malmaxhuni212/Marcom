import { createHash, createHmac, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '../client';
import type { ActorContext } from '../local-actor';
import {
  auditEvents,
  campaignProspects,
  campaigns,
  contactPoints,
  evidenceItems,
  jobItems,
  jobs,
  prospectIdentifiers,
  prospects,
  providerOperations,
  researchResults,
  researchRuns,
  searchPlanVersions,
} from '../schema';
import { canonicalUrl, normalizeName } from '@/marcom/agents/research/qa';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { ResearchJobPayloadSchema } from '@/marcom/research/job-contract';
import { RESEARCH_JOB_MAX_ATTEMPTS } from '@/marcom/research/job-policy';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DatabaseTransaction = Parameters<Parameters<MarcomDatabase['transaction']>[0]>[0];

export interface ResearchBatchInfo {
  batch_id: string;
  batch_number: number;
}

export interface EnqueuedResearchRun {
  jobId: string;
  researchRunId: string;
  created: boolean;
}

export class ResearchJobIdempotencyConflictError extends Error {}

function entrySnapshot(entry: ResearchEntry): Record<string, unknown> {
  return { schemaVersion: 1, entry };
}

function readEntry(metadata: Record<string, unknown>): ResearchEntry | null {
  const candidate = metadata.entry;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as ResearchEntry;
}

function normalizeIdentifier(value: string): string {
  try {
    return canonicalUrl(value);
  } catch {
    return value.trim().toLowerCase();
  }
}

function domainFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function contactHash(actor: ActorContext, channel: string, value: string): string {
  const pepper = process.env.CONTACT_HASH_PEPPER?.trim() || actor.workspaceId;
  return createHmac('sha256', pepper).update(`${channel}:${value}`, 'utf8').digest('hex');
}

function safeFieldKey(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 80);
  return normalized || 'research_fact';
}

function confidence(value: string): 'high' | 'medium' | 'low' {
  if (value === 'verified') return 'high';
  if (value === 'likely') return 'medium';
  return 'low';
}

function researchStatusForReview(status: ReviewStatus | undefined) {
  if (status === 'shortlisted') return 'shortlisted' as const;
  if (status === 'rejected') return 'rejected' as const;
  if (status === 'enrichment_requested') return 'enrichment_requested' as const;
  return 'review_required' as const;
}

function reviewForResearchStatus(status: string): ReviewStatus {
  if (status === 'shortlisted') return 'shortlisted';
  if (status === 'rejected') return 'rejected';
  if (status === 'enrichment_requested') return 'enrichment_requested';
  return 'needs_review';
}

async function requireCampaign(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase | DatabaseTransaction,
) {
  const [campaign] = await database
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.workspaceId, actor.workspaceId), eq(campaigns.id, campaignId)))
    .limit(1);
  if (!campaign || campaign.status === 'archived' || !campaign.activeConfigVersionId) {
    throw new Error('Campaign is unavailable or has no approved configuration.');
  }
  return campaign;
}

async function approveSearchPlanForRun(
  actor: ActorContext,
  campaignId: string,
  targetId: string,
  requestedCount: number,
  database: MarcomDatabase | DatabaseTransaction,
) {
  const campaign = await requireCampaign(actor, campaignId, database);
  const configVersionId = campaign.activeConfigVersionId;
  if (!configVersionId) throw new Error('Campaign has no approved configuration.');
  const [existing] = await database
    .select({ id: searchPlanVersions.id, version: searchPlanVersions.version })
    .from(searchPlanVersions)
    .where(and(eq(searchPlanVersions.campaignId, campaignId), eq(searchPlanVersions.status, 'approved')))
    .orderBy(desc(searchPlanVersions.version))
    .limit(1);
  const [latest] = await database
    .select({ version: searchPlanVersions.version })
    .from(searchPlanVersions)
    .where(eq(searchPlanVersions.campaignId, campaignId))
    .orderBy(desc(searchPlanVersions.version))
    .limit(1);
  const now = new Date();
  if (existing) {
    await database
      .update(searchPlanVersions)
      .set({ status: 'superseded', updatedAt: now })
      .where(eq(searchPlanVersions.id, existing.id));
  }
  const [created] = await database
    .insert(searchPlanVersions)
    .values({
      id: randomUUID(),
      campaignId,
      configVersionId,
      version: (latest?.version ?? 0) + 1,
      status: 'approved',
      batchSize: requestedCount,
      enrichmentDepth: 'detailed',
      queryFamilies: { schemaVersion: 1, targetId, source: 'human_started_research' },
      limitations: { schemaVersion: 1, maximumResults: 50 },
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await database.insert(auditEvents).values({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    campaignId,
    actorType: 'membership',
    actorMembershipId: actor.membershipId,
    action: 'search_plan.approved_for_research_run',
    subjectType: 'search_plan_version',
    subjectId: created.id,
    safeDiff: { version: created.version },
  });
  return created;
}

export async function listResearch(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<ResearchEntry[]> {
  if (!UUID_REGEX.test(campaignId)) return [];
  const rows = await database
    .selectDistinctOn([campaignProspects.id], {
      metadata: researchResults.metadata,
      researchStatus: campaignProspects.researchStatus,
      engagementStatus: campaignProspects.engagementStatus,
      reviewNotes: campaignProspects.reviewNotes,
      reviewedAt: campaignProspects.updatedAt,
    })
    .from(researchResults)
    .innerJoin(researchRuns, eq(researchRuns.id, researchResults.researchRunId))
    .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
    .innerJoin(campaignProspects, eq(campaignProspects.id, researchResults.campaignProspectId))
    .where(and(eq(researchRuns.campaignId, campaignId), eq(jobs.workspaceId, actor.workspaceId)))
    .orderBy(campaignProspects.id, desc(researchResults.createdAt));

  return rows.flatMap((row) => {
    const entry = readEntry(row.metadata);
    if (!entry) return [];
    const resolvedRelationshipStatus =
      row.engagementStatus === 'sent'
        ? 'contacted'
        : entry.relationship_status ?? null;
    return [{
      ...entry,
      relationship_status: resolvedRelationshipStatus,
      review: {
        project_id: campaignId,
        record_id: entry.record.record_id,
        status: reviewForResearchStatus(row.researchStatus),
        note: row.reviewNotes,
        reviewed_at: row.reviewedAt.toISOString(),
        reviewed_by: row.researchStatus === 'review_required' ? 'system' : 'user',
      },
    }];
  }).sort((left, right) => Date.parse(right.record.researched_at) - Date.parse(left.record.researched_at));
}

export function findDuplicate(
  entries: ResearchEntry[],
  seed: { name: string; website?: string; linkedin?: string },
): ResearchEntry | null {
  const name = normalizeName(seed.name);
  const urls = [seed.website, seed.linkedin].filter(Boolean).map((value) => normalizeIdentifier(value!));
  return entries.find((entry) => {
    if (normalizeName(entry.seed.name) === name || normalizeName(entry.record.identity.name ?? '') === name) return true;
    const existingUrls = [
      ...(entry.record.websites?.map((website) => website.url) ?? []),
      ...(entry.record.social_profiles?.map((profile) => profile.profile_url) ?? []),
      entry.seed.website,
      entry.seed.linkedin,
    ].filter(Boolean).map((value) => normalizeIdentifier(value!));
    return urls.some((value) => existingUrls.includes(value));
  }) ?? null;
}

export async function getNextBatchInfo(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<ResearchBatchInfo> {
  const entries = await listResearch(actor, campaignId, database);
  const maxBatch = entries.reduce((maximum, entry) => Math.max(maximum, entry.batch_number ?? 0), 0);
  const batchNumber = maxBatch + 1;
  return { batch_id: `batch-${batchNumber}`, batch_number: batchNumber };
}

export async function startResearchRun(
  actor: ActorContext,
  campaignId: string,
  batch: ResearchBatchInfo,
  requestedCount: number,
  targetId = 'default',
  database: MarcomDatabase = getDatabase(),
): Promise<string> {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 50) {
    throw new Error('Research requested count must be between 1 and 50.');
  }
  return database.transaction(async (transaction) => {
    const idempotencyKey = `${campaignId}:${batch.batch_id}`;
    const [existingJob] = await transaction
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, actor.workspaceId),
          eq(jobs.jobType, 'research.run.v1'),
          eq(jobs.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingJob) {
      const [existingRun] = await transaction
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(eq(researchRuns.jobId, existingJob.id))
        .limit(1);
      if (existingRun) return existingRun.id;
    }
    const plan = await approveSearchPlanForRun(actor, campaignId, targetId, requestedCount, transaction);
    const now = new Date();
    const jobId = randomUUID();
    const runId = randomUUID();
    await transaction.insert(jobs).values({
      id: jobId,
      workspaceId: actor.workspaceId,
      campaignId,
      jobType: 'research.run.v1',
      status: 'running',
      payload: { schemaVersion: 1, batchId: batch.batch_id, batchNumber: batch.batch_number, searchPlanVersionId: plan.id },
      progress: { requested: requestedCount, completed: 0, failed: 0 },
      idempotencyKey,
      attemptCount: 1,
      maxAttempts: 3,
      runAfter: now,
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
    });
    await transaction.insert(researchRuns).values({
      id: runId,
      jobId,
      campaignId,
      searchPlanVersionId: plan.id,
      requestedCount,
      createdAt: now,
    });
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'research.started',
      subjectType: 'research_run',
      subjectId: runId,
      safeDiff: { requestedCount, batchId: batch.batch_id },
      jobId,
    });
    return runId;
  });
}

export async function enqueueResearchRun(
  actor: ActorContext,
  campaignId: string,
  batch: ResearchBatchInfo,
  requestedCount: number,
  targetId: string,
  idempotencyKey: string,
  searchProvider: string,
  database: MarcomDatabase = getDatabase(),
): Promise<EnqueuedResearchRun> {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 50) {
    throw new Error('Research requested count must be between 1 and 50.');
  }
  const normalizedKey = idempotencyKey.trim();
  if (!normalizedKey || normalizedKey.length > 200) {
    throw new Error('Idempotency-Key must contain between 1 and 200 characters.');
  }

  return database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ job: jobs, runId: researchRuns.id })
      .from(jobs)
      .innerJoin(researchRuns, eq(researchRuns.jobId, jobs.id))
      .where(and(
        eq(jobs.workspaceId, actor.workspaceId),
        eq(jobs.jobType, 'research.run.v1'),
        eq(jobs.idempotencyKey, normalizedKey),
      ))
      .limit(1);
    if (existing) {
      const payload = ResearchJobPayloadSchema.safeParse(existing.job.payload);
      if (
        existing.job.campaignId !== campaignId
        || !payload.success
        || payload.data.targetId !== targetId
        || payload.data.requestedCount !== requestedCount
      ) {
        throw new ResearchJobIdempotencyConflictError(
          'The Idempotency-Key has already been used for a different research request.',
        );
      }
      return { jobId: existing.job.id, researchRunId: existing.runId, created: false };
    }

    const plan = await approveSearchPlanForRun(actor, campaignId, targetId, requestedCount, transaction);
    const now = new Date();
    const jobId = randomUUID();
    const researchRunId = randomUUID();
    const payload = ResearchJobPayloadSchema.parse({
      schemaVersion: 1,
      batchId: batch.batch_id,
      batchNumber: batch.batch_number,
      searchPlanVersionId: plan.id,
      targetId,
      requestedCount,
    });
    await transaction.insert(jobs).values({
      id: jobId,
      workspaceId: actor.workspaceId,
      campaignId,
      jobType: 'research.run.v1',
      status: 'queued',
      payload,
      progress: {
        requested: requestedCount,
        discovered: 0,
        completed: 0,
        duplicatesSkipped: 0,
        failed: 0,
        message: 'Research is queued.',
        searchProvider,
      },
      idempotencyKey: normalizedKey,
      attemptCount: 0,
      maxAttempts: RESEARCH_JOB_MAX_ATTEMPTS,
      runAfter: now,
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(researchRuns).values({
      id: researchRunId,
      jobId,
      campaignId,
      searchPlanVersionId: plan.id,
      requestedCount,
      createdAt: now,
    });
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'research.queued',
      subjectType: 'research_run',
      subjectId: researchRunId,
      safeDiff: { requestedCount, batchId: batch.batch_id, searchProvider },
      jobId,
    });
    return { jobId, researchRunId, created: true };
  });
}

async function prospectForEntry(
  actor: ActorContext,
  entry: ResearchEntry,
  transaction: DatabaseTransaction,
) {
  const record = entry.record;
  const identityWebsiteUrls = record.websites
    .filter((website) => record.identity.entity_kind === 'organisation' || website.type !== 'company')
    .map((website) => website.url);
  const candidateUrls = [
    ...identityWebsiteUrls,
    ...record.social_profiles.map((profile) => profile.profile_url),
  ];
  const normalizedUrls = [...new Set(candidateUrls.map(normalizeIdentifier))];
  if (normalizedUrls.length) {
    const [identifier] = await transaction
      .select({ prospect: prospects })
      .from(prospectIdentifiers)
      .innerJoin(prospects, eq(prospects.id, prospectIdentifiers.prospectId))
      .where(and(eq(prospectIdentifiers.workspaceId, actor.workspaceId), inArray(prospectIdentifiers.normalizedValue, normalizedUrls)))
      .limit(1);
    if (identifier) return identifier.prospect;
  }

  const primaryUrl = record.websites[0]?.url ?? record.social_profiles[0]?.profile_url ?? record.sources[0]?.url ?? null;
  const [created] = await transaction
    .insert(prospects)
    .values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      entityType: record.identity.entity_kind,
      canonicalName: (record.identity.name ?? entry.seed.name).trim().slice(0, 240),
      canonicalDomain: domainFromUrl(primaryUrl),
      primaryUrl,
      locationText: record.location ?? record.country,
      status: 'active',
      normalizationVersion: 1,
    })
    .returning();

  const identifierRows = candidateUrls.map((url, index) => ({
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    prospectId: created.id,
    identifierType: 'profile_url' as const,
    providerName: null,
    displayValue: url,
    normalizedValue: normalizeIdentifier(url),
    isPrimary: index === 0,
  }));
  if (identifierRows.length) {
    await transaction.insert(prospectIdentifiers).values(identifierRows).onConflictDoNothing();
  }
  return created;
}

export async function saveResearch(
  actor: ActorContext,
  campaignId: string,
  researchRunId: string,
  entry: ResearchEntry,
  database: MarcomDatabase = getDatabase(),
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const campaign = await requireCampaign(actor, campaignId, transaction);
    const [run] = await transaction
      .select({ run: researchRuns, job: jobs })
      .from(researchRuns)
      .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
      .where(and(eq(researchRuns.id, researchRunId), eq(researchRuns.campaignId, campaignId), eq(jobs.workspaceId, actor.workspaceId)))
      .limit(1);
    if (!run) throw new Error('Research run not found.');
    const [lockedJob] = await transaction
      .select({ status: jobs.status, cancelRequestedAt: jobs.cancelRequestedAt })
      .from(jobs)
      .where(eq(jobs.id, run.job.id))
      .for('update')
      .limit(1);
    if (!lockedJob || lockedJob.status === 'cancelled' || lockedJob.cancelRequestedAt) {
      return false;
    }

    const prospect = await prospectForEntry(actor, entry, transaction);
    const now = new Date();
    const researchedAt = new Date(entry.record.researched_at);
    const reviewedAt = entry.review?.reviewed_at ? new Date(entry.review.reviewed_at) : researchedAt;
    const status = researchStatusForReview(entry.review?.status);
    const [campaignProspect] = await transaction
      .insert(campaignProspects)
      .values({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        campaignId,
        prospectId: prospect.id,
        configVersionId: campaign.activeConfigVersionId!,
        sourceMethod: 'provider',
        researchStatus: status,
        engagementStatus: 'not_started',
        fitSummary: entry.record.reason_for_relevance ?? entry.record.summary,
        customFields: {
          schemaVersion: 1,
          targetType: entry.record.target_type,
          role: entry.record.role,
          organisation: entry.record.organisation,
          country: entry.record.country,
          qualificationAssessment: entry.record.qualification_assessment,
          fit: entry.record.fit,
          unknowns: entry.record.unknowns,
        },
        reviewNotes: entry.review?.note ?? null,
        rejectionReason: status === 'rejected' ? entry.review?.note ?? 'Rejected during review' : null,
        shortlistedAt: status === 'shortlisted' ? now : null,
        reviewedByMembershipId: status === 'review_required' ? null : actor.membershipId,
        createdAt: researchedAt,
        updatedAt: reviewedAt,
      })
      .onConflictDoUpdate({
        target: [campaignProspects.campaignId, campaignProspects.prospectId],
        set: {
          configVersionId: campaign.activeConfigVersionId!,
          researchStatus: status,
          fitSummary: entry.record.reason_for_relevance ?? entry.record.summary,
          customFields: {
            schemaVersion: 1,
            targetType: entry.record.target_type,
            role: entry.record.role,
            organisation: entry.record.organisation,
            country: entry.record.country,
            qualificationAssessment: entry.record.qualification_assessment,
            fit: entry.record.fit,
            unknowns: entry.record.unknowns,
          },
          updatedAt: now,
        },
      })
      .returning();

    const primaryUrl = entry.record.websites[0]?.url
      ?? entry.record.social_profiles[0]?.profile_url
      ?? entry.record.sources[0]?.url
      ?? `urn:marcom:legacy:no-source:${encodeURIComponent(entry.record.record_id)}`;
    const resultId = randomUUID();
    const [result] = await transaction
      .insert(researchResults)
      .values({
        id: resultId,
        researchRunId,
        queryKey: entry.record.brief_target_id.slice(0, 120),
        providerName: entry.search_provider,
        providerResultId: entry.record.record_id.slice(0, 255),
        rank: 1,
        url: primaryUrl,
        canonicalUrl: normalizeIdentifier(primaryUrl),
        title: entry.record.identity.name ?? entry.seed.name,
        snippet: entry.record.summary.slice(0, 1_000),
        metadata: entrySnapshot({ ...entry, record: { ...entry.record, project_id: campaignId } }),
        status: 'accepted',
        prospectId: prospect.id,
        campaignProspectId: campaignProspect.id,
        createdAt: researchedAt,
        updatedAt: reviewedAt,
      })
      .onConflictDoUpdate({
        target: [researchResults.researchRunId, researchResults.providerName, researchResults.providerResultId],
        set: {
          metadata: entrySnapshot({ ...entry, record: { ...entry.record, project_id: campaignId } }),
          status: 'accepted',
          prospectId: prospect.id,
          campaignProspectId: campaignProspect.id,
          updatedAt: now,
        },
      })
      .returning();

    const itemId = randomUUID();
    await transaction.insert(jobItems).values({
      id: itemId,
      jobId: run.job.id,
      itemKey: entry.record.record_id.slice(0, 240),
      status: 'completed',
      input: { seed: entry.seed },
      result: { researchResultId: result.id, campaignProspectId: campaignProspect.id },
      attemptCount: 1,
      startedAt: researchedAt,
      completedAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    const searchOperationId = randomUUID();
    await transaction.insert(providerOperations).values({
      id: searchOperationId,
      workspaceId: actor.workspaceId,
      campaignId,
      jobId: run.job.id,
      jobItemId: itemId,
      campaignProspectId: campaignProspect.id,
      providerKind: 'search',
      providerName: entry.search_provider,
      operation: 'prospect.search',
      status: 'succeeded',
      externalRequestId: entry.search_request_ids[0] ?? null,
      schemaVersion: 1,
      inputHash: createHash('sha256').update(JSON.stringify(entry.searches), 'utf8').digest('hex'),
      outputHash: createHash('sha256').update(JSON.stringify(entry.record.sources), 'utf8').digest('hex'),
      usage: { requests: entry.search_usage.requests },
      estimatedCost: entry.search_usage.estimated_cost_usd > 0 ? entry.search_usage.estimated_cost_usd.toFixed(6) : null,
      currency: entry.search_usage.estimated_cost_usd > 0 ? 'USD' : null,
      latencyMs: entry.search_usage.latency_ms,
      startedAt: new Date(Math.max(0, now.getTime() - entry.search_usage.latency_ms)),
      completedAt: now,
      createdAt: now,
    });

    const aiOperationId = randomUUID();
    await transaction.insert(providerOperations).values({
      id: aiOperationId,
      workspaceId: actor.workspaceId,
      campaignId,
      jobId: run.job.id,
      jobItemId: itemId,
      campaignProspectId: campaignProspect.id,
      providerKind: 'ai',
      providerName: entry.ai_provider ?? 'legacy_ai',
      modelName: entry.model,
      operation: 'prospect.extract_evidence',
      status: 'succeeded',
      promptVersion: entry.record.research_agent_version,
      schemaVersion: 1,
      inputHash: createHash('sha256').update(JSON.stringify(entry.record.sources), 'utf8').digest('hex'),
      outputHash: createHash('sha256').update(JSON.stringify(entry.record), 'utf8').digest('hex'),
      usage: {},
      startedAt: researchedAt,
      completedAt: now,
      createdAt: now,
    });

    const sourceById = new Map(entry.record.sources.map((source) => [source.id, source]));
    const evidenceRows = entry.record.evidence.flatMap((evidence) => evidence.source_ids.flatMap((sourceId) => {
      const source = sourceById.get(sourceId);
      if (!source) return [];
      const value = { claim: evidence.claim };
      return [{
        id: randomUUID(),
        campaignProspectId: campaignProspect.id,
        fieldKey: safeFieldKey(evidence.field),
        valueJson: value,
        sourceUrl: source.url,
        canonicalSourceUrl: normalizeIdentifier(source.url),
        sourceTitle: source.title,
        snippet: evidence.quote?.slice(0, 1_000) ?? null,
        retrievedAt: source.retrieved_at ? new Date(source.retrieved_at) : new Date(entry.record.researched_at),
        confidence: confidence(evidence.confidence),
        verificationStatus: evidence.source_ids.length > 1 ? 'corroborated' as const : 'single_source' as const,
        researchResultId: result.id,
        providerOperationId: aiOperationId,
        evidenceHash: createHash('sha256').update(`${safeFieldKey(evidence.field)}\n${normalizeIdentifier(source.url)}\n${JSON.stringify(value)}`, 'utf8').digest('hex'),
        createdAt: now,
      }];
    }));
    if (evidenceRows.length) {
      await transaction.insert(evidenceItems).values(evidenceRows).onConflictDoNothing();
    }

    const contactRows: Array<typeof contactPoints.$inferInsert> = entry.record.public_contact.flatMap((contact) => {
      const source = sourceById.get(contact.source_ids[0]);
      const channel = contact.kind === 'agent_or_representative' ? 'other' : contact.kind;
      const normalizedValue = contact.value.trim().toLowerCase();
      return [{
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        prospectId: prospect.id,
        channel,
        value: contact.value,
        normalizedValue,
        valueHash: contactHash(actor, channel, normalizedValue),
        isPublic: true,
        sourceUrl: source?.url ?? null,
        retrievedAt: source?.retrieved_at ? new Date(source.retrieved_at) : new Date(entry.record.researched_at),
        verificationStatus: contact.confidence === 'verified' ? 'source_verified' as const : 'unverified' as const,
        createdAt: now,
        updatedAt: now,
      }];
    });
    // Named people inside an organisation keep their identity next to each route they can be reached by.
    for (const person of entry.record.key_contacts ?? []) {
      const source = sourceById.get(person.source_ids[0]);
      const routes: Array<{ channel: 'email' | 'phone' | 'linkedin'; value: string | null }> = [
        { channel: 'email', value: person.email },
        { channel: 'linkedin', value: person.linkedin_url },
        { channel: 'phone', value: person.phone },
      ];
      for (const route of routes) {
        if (!route.value) continue;
        const normalizedValue = route.channel === 'linkedin' ? normalizeIdentifier(route.value) : route.value.trim().toLowerCase();
        contactRows.push({
          id: randomUUID(),
          workspaceId: actor.workspaceId,
          prospectId: prospect.id,
          channel: route.channel,
          value: route.value,
          normalizedValue,
          valueHash: contactHash(actor, route.channel, normalizedValue),
          isPublic: true,
          sourceUrl: source?.url ?? null,
          retrievedAt: source?.retrieved_at ? new Date(source.retrieved_at) : new Date(entry.record.researched_at),
          verificationStatus: person.confidence === 'verified' ? 'source_verified' as const : 'unverified' as const,
          contactName: person.name.slice(0, 240),
          contactRole: [person.role, person.department].filter(Boolean).join(' · ').slice(0, 240) || null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    for (const profile of entry.record.social_profiles ?? []) {
      const source = sourceById.get(profile.source_ids[0]);
      const channel =
        profile.platform === 'linkedin' ||
        profile.platform === 'x' ||
        profile.platform === 'facebook' ||
        profile.platform === 'instagram'
          ? profile.platform
          : ('other' as const);
      const normalizedValue = normalizeIdentifier(profile.profile_url);
      contactRows.push({
        id: randomUUID(),
        workspaceId: actor.workspaceId,
        prospectId: prospect.id,
        channel,
        value: profile.profile_url,
        normalizedValue,
        valueHash: contactHash(actor, channel, normalizedValue),
        isPublic: true,
        sourceUrl: source?.url ?? profile.profile_url,
        retrievedAt: source?.retrieved_at ? new Date(source.retrieved_at) : new Date(entry.record.researched_at),
        verificationStatus: profile.confidence === 'verified' ? ('source_verified' as const) : ('unverified' as const),
        contactName: profile.display_name ? profile.display_name.slice(0, 240) : null,
        contactRole: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    const seenContactKeys = new Set<string>();
    const uniqueContactRows = contactRows.filter((row) => {
      const key = `${row.channel}:${row.valueHash}`;
      if (seenContactKeys.has(key)) return false;
      seenContactKeys.add(key);
      return true;
    });
    if (uniqueContactRows.length) {
      await transaction.insert(contactPoints).values(uniqueContactRows).onConflictDoNothing();
    }

    await transaction
      .update(researchRuns)
      .set({
        foundCount: sql`${researchRuns.foundCount} + 1`,
        uniqueCount: sql`${researchRuns.uniqueCount} + 1`,
        enrichedCount: sql`${researchRuns.enrichedCount} + 1`,
        reviewRequiredCount: status === 'review_required' ? sql`${researchRuns.reviewRequiredCount} + 1` : researchRuns.reviewRequiredCount,
      })
      .where(eq(researchRuns.id, researchRunId));
    await transaction
      .update(jobs)
      .set({ progress: sql`jsonb_set(${jobs.progress}, '{completed}', to_jsonb(coalesce((${jobs.progress}->>'completed')::int, 0) + 1))`, updatedAt: now })
      .where(eq(jobs.id, run.job.id));
    return true;
  });
}

export async function completeResearchRun(
  actor: ActorContext,
  researchRunId: string,
  failedCount: number,
  database: MarcomDatabase = getDatabase(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ run: researchRuns, job: jobs })
      .from(researchRuns)
      .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
      .where(and(eq(researchRuns.id, researchRunId), eq(jobs.workspaceId, actor.workspaceId)))
      .limit(1);
    if (!row) throw new Error('Research run not found.');
    if (row.job.status === 'cancelled') return;
    const now = new Date();
    const status = failedCount > 0 ? 'completed_with_errors' : 'completed';
    await transaction.update(researchRuns).set({ failedCount, completedAt: now }).where(eq(researchRuns.id, researchRunId));
    await transaction.update(jobs).set({ status, completedAt: now, updatedAt: now, progress: sql`jsonb_set(${jobs.progress}, '{failed}', to_jsonb(${failedCount}::int))` }).where(eq(jobs.id, row.job.id));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId: row.run.campaignId,
      actorType: 'system',
      action: 'research.completed',
      subjectType: 'research_run',
      subjectId: researchRunId,
      safeDiff: { status, failedCount },
      jobId: row.job.id,
    });
  });
}

export async function cancelResearchRun(
  actor: ActorContext,
  researchRunId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ run: researchRuns, job: jobs })
      .from(researchRuns)
      .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
      .where(and(eq(researchRuns.id, researchRunId), eq(jobs.workspaceId, actor.workspaceId)))
      .limit(1);
    if (!row || row.job.status === 'cancelled') return;
    const now = new Date();
    await transaction.update(researchRuns).set({ completedAt: now }).where(eq(researchRuns.id, researchRunId));
    await transaction.update(jobs).set({ status: 'cancelled', cancelRequestedAt: now, completedAt: now, updatedAt: now }).where(eq(jobs.id, row.job.id));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId: row.run.campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'research.cancelled',
      subjectType: 'research_run',
      subjectId: researchRunId,
      safeDiff: { status: 'cancelled' },
      jobId: row.job.id,
    });
  });
}

export async function updateResearchReview(
  actor: ActorContext,
  campaignId: string,
  recordId: string,
  status: ReviewStatus,
  note: string | null,
  relationshipStatus?: string | null,
  database: MarcomDatabase = getDatabase(),
): Promise<ResearchEntry | null> {
  if (!UUID_REGEX.test(campaignId)) return null;
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ result: researchResults, campaignProspect: campaignProspects })
      .from(researchResults)
      .innerJoin(researchRuns, eq(researchRuns.id, researchResults.researchRunId))
      .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
      .innerJoin(campaignProspects, eq(campaignProspects.id, researchResults.campaignProspectId))
      .where(and(eq(researchRuns.campaignId, campaignId), eq(jobs.workspaceId, actor.workspaceId), eq(researchResults.providerResultId, recordId)))
      .limit(1);
    if (!row) return null;
    const entry = readEntry(row.result.metadata);
    if (!entry) return null;
    const now = new Date();
    const review = {
      project_id: campaignId,
      record_id: recordId,
      status,
      note: note?.trim() || null,
      reviewed_at: now.toISOString(),
      reviewed_by: 'user',
    };
    const nextRelationshipStatus =
      relationshipStatus !== undefined
        ? relationshipStatus === 'contacted' || relationshipStatus === 'sent'
          ? 'contacted'
          : null
        : status !== 'shortlisted'
          ? null
          : entry.relationship_status ?? null;
    const updatedEntry: ResearchEntry = {
      ...entry,
      relationship_status: nextRelationshipStatus,
      review,
    };
    await transaction.update(campaignProspects).set({
      researchStatus: researchStatusForReview(status),
      engagementStatus:
        nextRelationshipStatus === 'contacted'
          ? 'sent'
          : row.campaignProspect.engagementStatus === 'sent'
            ? 'not_started'
            : row.campaignProspect.engagementStatus,
      reviewNotes: review.note,
      rejectionReason: status === 'rejected' ? review.note : null,
      shortlistedAt: status === 'shortlisted' ? now : null,
      reviewedByMembershipId: actor.membershipId,
      updatedAt: now,
    }).where(eq(campaignProspects.id, row.campaignProspect.id));
    await transaction.update(researchResults).set({ metadata: entrySnapshot(updatedEntry), updatedAt: now }).where(eq(researchResults.id, row.result.id));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'prospect.reviewed',
      subjectType: 'campaign_prospect',
      subjectId: row.campaignProspect.id,
      reason: review.note,
      safeDiff: {
        previousStatus: row.campaignProspect.researchStatus,
        status,
        relationshipStatus: nextRelationshipStatus,
      },
    });
    return updatedEntry;
  });
}

export async function updateResearchEntryFromSync(
  actor: ActorContext,
  campaignId: string,
  updatedEntry: ResearchEntry,
  database: MarcomDatabase = getDatabase(),
): Promise<ResearchEntry | null> {
  if (!UUID_REGEX.test(campaignId)) return null;
  const recordId = updatedEntry.record.record_id;
  return database.transaction(async (transaction) => {
    const [row] = await transaction
      .select({ result: researchResults, campaignProspect: campaignProspects })
      .from(researchResults)
      .innerJoin(researchRuns, eq(researchRuns.id, researchResults.researchRunId))
      .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
      .innerJoin(campaignProspects, eq(campaignProspects.id, researchResults.campaignProspectId))
      .where(
        and(
          eq(researchRuns.campaignId, campaignId),
          eq(jobs.workspaceId, actor.workspaceId),
          eq(researchResults.providerResultId, recordId),
        ),
      )
      .limit(1);
    if (!row) return null;

    const now = new Date();
    const canonicalName = (
      updatedEntry.record.identity.name ??
      updatedEntry.seed.name ??
      'Unnamed Prospect'
    )
      .trim()
      .slice(0, 240);

    await transaction
      .update(prospects)
      .set({
        canonicalName,
        locationText: updatedEntry.record.location ?? updatedEntry.record.country,
        updatedAt: now,
      })
      .where(eq(prospects.id, row.campaignProspect.prospectId));

    await transaction
      .update(campaignProspects)
      .set({
        engagementStatus:
          updatedEntry.relationship_status === 'contacted'
            ? 'sent'
            : row.campaignProspect.engagementStatus === 'sent'
              ? 'not_started'
              : row.campaignProspect.engagementStatus,
        fitSummary:
          updatedEntry.record.reason_for_relevance ?? updatedEntry.record.summary,
        customFields: {
          schemaVersion: 1,
          targetType: updatedEntry.record.target_type,
          role: updatedEntry.record.role,
          organisation: updatedEntry.record.organisation,
          country: updatedEntry.record.country,
          qualificationAssessment: updatedEntry.record.qualification_assessment,
          fit: updatedEntry.record.fit,
          unknowns: updatedEntry.record.unknowns,
        },
        updatedAt: now,
      })
      .where(eq(campaignProspects.id, row.campaignProspect.id));

    await transaction
      .update(researchResults)
      .set({
        title: canonicalName,
        snippet: (updatedEntry.record.summary || '').slice(0, 1_000),
        metadata: entrySnapshot({
          ...updatedEntry,
          record: { ...updatedEntry.record, project_id: campaignId },
        }),
        updatedAt: now,
      })
      .where(eq(researchResults.id, row.result.id));

    return updatedEntry;
  });
}

async function deleteResults(
  actor: ActorContext,
  campaignId: string,
  predicate: ReturnType<typeof eq> | undefined,
  database: MarcomDatabase,
): Promise<number> {
  return database.transaction(async (transaction) => {
    const conditions = [eq(researchRuns.campaignId, campaignId), eq(jobs.workspaceId, actor.workspaceId)];
    if (predicate) conditions.push(predicate);
    const rows = await transaction
      .select({ id: researchResults.id, campaignProspectId: researchResults.campaignProspectId })
      .from(researchResults)
      .innerJoin(researchRuns, eq(researchRuns.id, researchResults.researchRunId))
      .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
      .where(and(...conditions));
    if (!rows.length) return 0;
    await transaction.delete(researchResults).where(inArray(researchResults.id, rows.map((row) => row.id)));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'research.results.removed',
      subjectType: 'campaign',
      subjectId: campaignId,
      safeDiff: { count: rows.length },
    });
    return rows.length;
  });
}

export async function deleteResearch(actor: ActorContext, campaignId: string, recordId: string, database: MarcomDatabase = getDatabase()) {
  return (await deleteResults(actor, campaignId, eq(researchResults.providerResultId, recordId), database)) > 0;
}

export async function deleteMultipleResearch(actor: ActorContext, campaignId: string, recordIds: string[], database: MarcomDatabase = getDatabase()) {
  if (!recordIds.length) return false;
  return (await deleteResults(actor, campaignId, inArray(researchResults.providerResultId, recordIds), database)) > 0;
}

export async function deleteBatchResearch(actor: ActorContext, campaignId: string, batchId: string, database: MarcomDatabase = getDatabase()) {
  const entries = await listResearch(actor, campaignId, database);
  const recordIds = entries.filter((entry) => entry.batch_id === batchId || String(entry.batch_number) === batchId.replace(/^batch-?/, '')).map((entry) => entry.record.record_id);
  return deleteMultipleResearch(actor, campaignId, recordIds, database);
}

export async function deleteProjectResearch(actor: ActorContext, campaignId: string, database: MarcomDatabase = getDatabase()) {
  await deleteResults(actor, campaignId, undefined, database);
}
