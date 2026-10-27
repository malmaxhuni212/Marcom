import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, max, sql } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '../client';
import type { ActorContext } from '../local-actor';
import {
  auditEvents,
  campaignProspects,
  jobs,
  messageDrafts,
  personalizationProfiles,
  personalizationSettings,
  researchResults,
  researchRuns,
} from '../schema';
import {
  OutreachCopySchema,
  PersonalizationSettingsSchema,
  PersonalizationStatusSchema,
  type OutreachCopy,
  type PersonalizationEntry,
  type PersonalizationSettings,
  type PersonalizationStatus,
} from '@/marcom/schemas/personalization';

type DatabaseTransaction = Parameters<Parameters<MarcomDatabase['transaction']>[0]>[0];

function asJsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readEntry(value: unknown): PersonalizationEntry {
  if (!value || typeof value !== 'object') {
    throw new Error('Stored personalization profile is invalid.');
  }
  return value as PersonalizationEntry;
}

function messageStatus(status: PersonalizationStatus): 'draft' | 'approved' | 'rejected' {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'draft';
}

function copyHash(copy: OutreachCopy): string {
  return createHash('sha256').update(JSON.stringify(copy), 'utf8').digest('hex');
}

async function resolveCampaignProspectId(
  actor: ActorContext,
  campaignId: string,
  recordId: string,
  database: MarcomDatabase | DatabaseTransaction,
): Promise<string> {
  const [row] = await database
    .select({ id: campaignProspects.id })
    .from(researchResults)
    .innerJoin(researchRuns, eq(researchRuns.id, researchResults.researchRunId))
    .innerJoin(jobs, eq(jobs.id, researchRuns.jobId))
    .innerJoin(campaignProspects, eq(campaignProspects.id, researchResults.campaignProspectId))
    .where(and(
      eq(researchRuns.campaignId, campaignId),
      eq(jobs.workspaceId, actor.workspaceId),
      eq(researchResults.providerResultId, recordId),
    ))
    .orderBy(desc(researchResults.createdAt))
    .limit(1);
  if (!row) throw new Error('The selected research record is no longer available.');
  return row.id;
}

function composeEntry(
  payload: unknown,
  draft: typeof messageDrafts.$inferSelect | null,
): PersonalizationEntry {
  const stored = readEntry(payload);
  if (!draft) return stored;
  const rawCopyPayload = (draft.copyPayload && typeof draft.copyPayload === 'object')
    ? (draft.copyPayload as Record<string, unknown>)
    : {};
  const copy = OutreachCopySchema.parse({
    ...rawCopyPayload,
    alternative_opening: rawCopyPayload.alternative_opening ?? draft.alternativeOpening ?? null,
  });
  return {
    ...stored,
    copy,
    status: draft.status === 'approved' || draft.status === 'rejected'
      ? PersonalizationStatusSchema.parse(draft.status)
      : stored.status,
  };
}

export async function listPersonalizations(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationEntry[]> {
  const rows = await database
    .select({ profile: personalizationProfiles, draft: messageDrafts })
    .from(personalizationProfiles)
    .leftJoin(messageDrafts, eq(messageDrafts.id, personalizationProfiles.currentMessageDraftId))
    .where(and(
      eq(personalizationProfiles.workspaceId, actor.workspaceId),
      eq(personalizationProfiles.campaignId, campaignId),
    ))
    .orderBy(desc(personalizationProfiles.updatedAt));
  return rows.map((row) => composeEntry(row.profile.payload, row.draft));
}

export async function getPersonalization(
  actor: ActorContext,
  campaignId: string,
  recordId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationEntry | null> {
  const [row] = await database
    .select({ profile: personalizationProfiles, draft: messageDrafts })
    .from(personalizationProfiles)
    .leftJoin(messageDrafts, eq(messageDrafts.id, personalizationProfiles.currentMessageDraftId))
    .where(and(
      eq(personalizationProfiles.workspaceId, actor.workspaceId),
      eq(personalizationProfiles.campaignId, campaignId),
      eq(personalizationProfiles.recordId, recordId),
    ))
    .limit(1);
  return row ? composeEntry(row.profile.payload, row.draft) : null;
}

export async function savePersonalization(
  actor: ActorContext,
  campaignId: string,
  entry: PersonalizationEntry,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationEntry> {
  return database.transaction(async (transaction) => {
    const campaignProspectId = await resolveCampaignProspectId(
      actor,
      campaignId,
      entry.record_id,
      transaction,
    );
    const [existing] = await transaction
      .select()
      .from(personalizationProfiles)
      .where(and(
        eq(personalizationProfiles.workspaceId, actor.workspaceId),
        eq(personalizationProfiles.campaignId, campaignId),
        eq(personalizationProfiles.recordId, entry.record_id),
      ))
      .for('update')
      .limit(1);

    let currentMessageDraftId: string | null = existing?.currentMessageDraftId ?? null;
    if (entry.copy) {
      const copy = OutreachCopySchema.parse(entry.copy);
      const [latest] = await transaction
        .select({ version: max(messageDrafts.version) })
        .from(messageDrafts)
        .where(and(
          eq(messageDrafts.campaignProspectId, campaignProspectId),
          eq(messageDrafts.channel, 'multi_channel'),
        ));
      if (currentMessageDraftId) {
        await transaction
          .update(messageDrafts)
          .set({ status: 'superseded' })
          .where(eq(messageDrafts.id, currentMessageDraftId));
      }
      const [draft] = await transaction
        .insert(messageDrafts)
        .values({
          id: randomUUID(),
          campaignProspectId,
          version: Number(latest?.version ?? 0) + 1,
          channel: 'multi_channel',
          subject: copy.subject_lines[0]?.text ?? null,
          content: copy.email_body,
          alternativeOpening: copy.alternative_opening ?? null,
          copyPayload: asJsonObject(copy),
          status: messageStatus(entry.status),
          parentDraftId: currentMessageDraftId,
          warnings: asJsonObject({ qa: entry.qa?.issues ?? [] }),
          contentHash: copyHash(copy),
          createdByMembershipId: actor.membershipId,
        })
        .returning({ id: messageDrafts.id });
      currentMessageDraftId = draft.id;
    } else if (currentMessageDraftId) {
      await transaction
        .update(messageDrafts)
        .set({ status: 'superseded' })
        .where(eq(messageDrafts.id, currentMessageDraftId));
      currentMessageDraftId = null;
    }

    const now = new Date();
    const payload = asJsonObject(entry);
    const profileId = existing?.id ?? randomUUID();
    const personalizationAngle = entry.strategy?.angle ?? null;
    const recipientIncentive = entry.strategy?.recipient_incentive ?? null;
    const recommendedChannel = entry.strategy?.recommended_channel ?? null;
    const confidence = entry.strategy?.confidence ?? null;
    await transaction
      .insert(personalizationProfiles)
      .values({
        id: profileId,
        workspaceId: actor.workspaceId,
        campaignId,
        campaignProspectId,
        recordId: entry.record_id,
        currentMessageDraftId,
        status: entry.status,
        personalizationAngle,
        recipientIncentive,
        recommendedChannel,
        confidence,
        payload,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [personalizationProfiles.campaignId, personalizationProfiles.recordId],
        set: {
          currentMessageDraftId,
          status: entry.status,
          personalizationAngle,
          recipientIncentive,
          recommendedChannel,
          confidence,
          payload,
          updatedAt: now,
        },
      });
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: existing ? 'personalization.regenerated' : 'personalization.generated',
      subjectType: 'personalization_profile',
      subjectId: profileId,
      safeDiff: { recordId: entry.record_id, status: entry.status },
    });
    return entry;
  });
}

export async function updatePersonalizationCopy(
  actor: ActorContext,
  campaignId: string,
  recordId: string,
  copyUpdates: Partial<OutreachCopy>,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationEntry | null> {
  return database.transaction(async (transaction) => {
    const [profile] = await transaction
      .select()
      .from(personalizationProfiles)
      .where(and(
        eq(personalizationProfiles.workspaceId, actor.workspaceId),
        eq(personalizationProfiles.campaignId, campaignId),
        eq(personalizationProfiles.recordId, recordId),
      ))
      .for('update')
      .limit(1);
    if (!profile?.currentMessageDraftId) return null;
    const [currentDraft] = await transaction
      .select()
      .from(messageDrafts)
      .where(eq(messageDrafts.id, profile.currentMessageDraftId))
      .limit(1);
    if (!currentDraft) return null;

    const current = composeEntry(profile.payload, currentDraft);
    const copy = OutreachCopySchema.parse({ ...current.copy, ...copyUpdates });
    await transaction.update(messageDrafts).set({ status: 'superseded' }).where(eq(messageDrafts.id, currentDraft.id));
    const [draft] = await transaction
      .insert(messageDrafts)
      .values({
        id: randomUUID(),
        campaignProspectId: profile.campaignProspectId,
        version: currentDraft.version + 1,
        channel: 'multi_channel',
        subject: copy.subject_lines[0]?.text ?? null,
        content: copy.email_body,
        alternativeOpening: copy.alternative_opening ?? null,
        copyPayload: asJsonObject(copy),
        status: 'draft',
        parentDraftId: currentDraft.id,
        warnings: currentDraft.warnings,
        contentHash: copyHash(copy),
        createdByMembershipId: actor.membershipId,
      })
      .returning();
    const now = new Date();
    const updated: PersonalizationEntry = {
      ...current,
      copy,
      status: 'draft',
      edited_by_human: true,
      updated_at: now.toISOString(),
    };
    await transaction.update(personalizationProfiles).set({
      currentMessageDraftId: draft.id,
      status: 'draft',
      payload: asJsonObject(updated),
      updatedAt: now,
    }).where(eq(personalizationProfiles.id, profile.id));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'message_draft.revised',
      subjectType: 'message_draft',
      subjectId: draft.id,
      safeDiff: { recordId, version: draft.version },
    });
    return updated;
  });
}

export async function updatePersonalizationStatus(
  actor: ActorContext,
  campaignId: string,
  recordId: string,
  nextStatus: PersonalizationStatus,
  reviewerNote: string | null = null,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationEntry | null> {
  const status = PersonalizationStatusSchema.parse(nextStatus);
  return database.transaction(async (transaction) => {
    const [profile] = await transaction
      .select()
      .from(personalizationProfiles)
      .where(and(
        eq(personalizationProfiles.workspaceId, actor.workspaceId),
        eq(personalizationProfiles.campaignId, campaignId),
        eq(personalizationProfiles.recordId, recordId),
      ))
      .for('update')
      .limit(1);
    if (!profile) return null;
    const [currentDraft] = profile.currentMessageDraftId
      ? await transaction.select().from(messageDrafts).where(eq(messageDrafts.id, profile.currentMessageDraftId)).limit(1)
      : [];
    if ((status === 'approved' || status === 'rejected') && !currentDraft) return null;

    const now = new Date();
    const current = composeEntry(profile.payload, currentDraft ?? null);
    const updated: PersonalizationEntry = {
      ...current,
      status,
      reviewer_note: reviewerNote?.trim() || null,
      reviewed_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    if (currentDraft && (status === 'draft' || status === 'approved' || status === 'rejected')) {
      await transaction.update(messageDrafts).set({ status: messageStatus(status) }).where(eq(messageDrafts.id, currentDraft.id));
    }
    await transaction.update(personalizationProfiles).set({
      status,
      payload: asJsonObject(updated),
      updatedAt: now,
    }).where(eq(personalizationProfiles.id, profile.id));
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'message_draft.reviewed',
      subjectType: currentDraft ? 'message_draft' : 'personalization_profile',
      subjectId: currentDraft?.id ?? profile.id,
      safeDiff: { recordId, status },
    });
    return updated;
  });
}

export async function deletePersonalization(
  actor: ActorContext,
  campaignId: string,
  recordId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<boolean> {
  return database.transaction(async (transaction) => {
    const deleted = await transaction
      .delete(personalizationProfiles)
      .where(and(
        eq(personalizationProfiles.workspaceId, actor.workspaceId),
        eq(personalizationProfiles.campaignId, campaignId),
        eq(personalizationProfiles.recordId, recordId),
      ))
      .returning({ id: personalizationProfiles.id });
    if (!deleted[0]) return false;
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'personalization.removed',
      subjectType: 'personalization_profile',
      subjectId: deleted[0].id,
      safeDiff: { recordId },
    });
    return true;
  });
}

export async function getPersonalizationSettings(
  actor: ActorContext,
  campaignId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationSettings> {
  const [row] = await database
    .select({ settings: personalizationSettings.settings })
    .from(personalizationSettings)
    .where(and(
      eq(personalizationSettings.workspaceId, actor.workspaceId),
      eq(personalizationSettings.campaignId, campaignId),
    ))
    .limit(1);
  return PersonalizationSettingsSchema.parse(row?.settings ?? {});
}

export async function savePersonalizationSettings(
  actor: ActorContext,
  campaignId: string,
  settings: Partial<PersonalizationSettings>,
  database: MarcomDatabase = getDatabase(),
): Promise<PersonalizationSettings> {
  return database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(personalizationSettings)
      .where(and(
        eq(personalizationSettings.workspaceId, actor.workspaceId),
        eq(personalizationSettings.campaignId, campaignId),
      ))
      .for('update')
      .limit(1);
    const current = PersonalizationSettingsSchema.parse(existing?.settings ?? {});
    const now = new Date();
    const updated = PersonalizationSettingsSchema.parse({
      ...current,
      ...settings,
      updated_at: now.toISOString(),
    });
    const settingsId = existing?.id ?? randomUUID();
    await transaction.insert(personalizationSettings).values({
      id: settingsId,
      workspaceId: actor.workspaceId,
      campaignId,
      settings: asJsonObject(updated),
      updatedByMembershipId: actor.membershipId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: personalizationSettings.campaignId,
      set: {
        settings: asJsonObject(updated),
        rowVersion: sql`${personalizationSettings.rowVersion} + 1`,
        updatedByMembershipId: actor.membershipId,
        updatedAt: now,
      },
    });
    await transaction.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: actor.workspaceId,
      campaignId,
      actorType: 'membership',
      actorMembershipId: actor.membershipId,
      action: 'personalization.settings_updated',
      subjectType: 'personalization_settings',
      subjectId: settingsId,
      safeDiff: { rowVersion: (existing?.rowVersion ?? 0) + 1 },
    });
    return updated;
  });
}

export interface PersonalizationSummary {
  total: number;
  drafts: number;
  approved: number;
  rejected: number;
  needs_more_research: number;
  failed: number;
  average_qa_score: number;
}

export function summarizePersonalizations(entries: PersonalizationEntry[]): PersonalizationSummary {
  const summary: PersonalizationSummary = {
    total: entries.length,
    drafts: 0,
    approved: 0,
    rejected: 0,
    needs_more_research: 0,
    failed: 0,
    average_qa_score: 0,
  };
  let totalScore = 0;
  let scored = 0;
  for (const entry of entries) {
    if (entry.status === 'approved') summary.approved += 1;
    else if (entry.status === 'rejected') summary.rejected += 1;
    else if (entry.status === 'needs_more_research') summary.needs_more_research += 1;
    else if (entry.status === 'failed') summary.failed += 1;
    else summary.drafts += 1;
    if (entry.qa?.score !== undefined) {
      totalScore += entry.qa.score;
      scored += 1;
    }
  }
  summary.average_qa_score = scored ? Math.round(totalScore / scored) : 0;
  return summary;
}
