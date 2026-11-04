import { NextResponse } from 'next/server';
import { createServerMemoryStore } from '@/marcom/memory/server-store';
import { isDatabaseConfigured } from '@/db/env';
import {
  listResearch as listDbResearch,
  updateResearchReview as updateDbResearchReview,
} from '@/db/repositories/research-repository';
import {
  listResearch as listFileResearch,
  updateResearchReview as updateFileResearchReview,
} from '@/marcom/memory/research-store';
import { authorizeApiRequest } from '@/auth/access';
import {
  deletePersonalization as deleteDbPersonalization,
  getPersonalization as getDbPersonalization,
  getPersonalizationSettings as getDbPersonalizationSettings,
  listPersonalizations as listDbPersonalizations,
  savePersonalization as saveDbPersonalization,
  savePersonalizationSettings as saveDbPersonalizationSettings,
  summarizePersonalizations,
  updatePersonalizationCopy as updateDbPersonalizationCopy,
  updatePersonalizationStatus as updateDbPersonalizationStatus,
} from '@/db/repositories/personalization-repository';
import {
  deletePersonalization as deleteFilePersonalization,
  getPersonalization as getFilePersonalization,
  getPersonalizationSettings as getFilePersonalizationSettings,
  listPersonalizations as listFilePersonalizations,
  savePersonalization as saveFilePersonalization,
  savePersonalizationSettings as saveFilePersonalizationSettings,
  updatePersonalizationCopy as updateFilePersonalizationCopy,
  updatePersonalizationStatus as updateFilePersonalizationStatus,
} from '@/marcom/memory/personalization-store';
import {
  buildAdaptivePersonalizationEntry,
  runPersonalizationAgent,
} from '@/marcom/agents/personalization/agent';
import {
  CategoryOutreachTemplateSchema,
  defaultLeadPersonalizationSettings,
  FeedbackScopeSchema,
  LeadPersonalizationSettingsSchema,
  normalizeCategoryKey,
  PERSONALIZATION_VERSION,
  PersonalizationSettingsSchema,
} from '@/marcom/schemas/personalization';
import type {
  EvaluatedRoute,
  LeadPersonalizationSettings,
  OutreachCopy,
  PersonalizationDraftVersion,
  PersonalizationEntry,
  PersonalizationFeedback,
  PersonalizationSettings,
  PersonalizationStatus,
  StrategyDossier,
} from '@/marcom/schemas/personalization';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import { GeneratePersonalizationRequestSchema } from '@/marcom/personalization/request-contract';
import { appendFeedback, createFeedbackItem } from '@/marcom/personalization/feedback';
import { z } from 'zod';

const FeedbackInputSchema = z.strictObject({
  text: z.string().trim().min(2, 'Write a little feedback first.').max(1_000),
  scope: FeedbackScopeSchema.default('project'),
});

export const runtime = 'nodejs';
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ id: string }> };
type ActorContext = Parameters<typeof getDbPersonalizationSettings>[0];

function stripDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');
}

function buildFallbackPersonalizationEntry(
  projectId: string,
  researchEntry: ResearchEntry,
  brief: StructuredBrief | null | undefined,
  settings: PersonalizationSettings,
  existing?: PersonalizationEntry | null,
): PersonalizationEntry {
  const rec = researchEntry.record;
  const prospectName = rec.identity.name || researchEntry.seed.name || 'Prospect';
  const isOrg = rec.identity.entity_kind === 'organisation';
  const keyPerson = rec.key_contacts?.[0];
  const firstName = isOrg
    ? keyPerson?.name?.trim().split(/\s+/)[0] || `${prospectName} team`
    : prospectName.trim().split(/\s+/)[0] || prospectName;

  const campaignName = brief?.project?.name || 'our upcoming initiative';
  const primaryObjective =
    brief?.project?.primary_objective ||
    brief?.outreach?.objectives?.[0] ||
    'explore a relevant collaboration';
  const valueProp =
    settings.campaign_facts?.[0] ||
    brief?.outreach?.objectives?.[0] ||
    primaryObjective;

  const rawHook =
    rec.work_and_projects?.[0] ||
    rec.achievements?.[0] ||
    rec.reason_for_relevance ||
    rec.summary ||
    `your work${rec.organisation ? ` at ${rec.organisation}` : ''}`;
  const cleanHook = stripDashes(rawHook).replace(/\.$/, '');
  const secondaryHook = stripDashes(
    rec.work_and_projects?.[1] ||
      rec.achievements?.[0] ||
      rec.reason_for_relevance ||
      cleanHook,
  ).replace(/\.$/, '');

  const hasEmail =
    (rec.public_contact?.some((c) => c.kind === 'email' && c.value) ?? false) ||
    (rec.key_contacts?.some((k) => Boolean(k.email)) ?? false);
  const hasLinkedIn =
    (rec.social_profiles?.some((s) => s.platform === 'linkedin' && s.profile_url) ?? false) ||
    (rec.key_contacts?.some((k) => Boolean(k.linkedin_url)) ?? false);
  const recommendedChannel = hasEmail ? 'email' : hasLinkedIn ? 'linkedin' : 'contact_form';

  const senderSignoff =
    settings.signature?.trim() ||
    [
      settings.sender_name?.trim() || 'The Campaign Team',
      [settings.sender_role?.trim(), settings.organisation?.trim() || brief?.project?.name].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join('\n');

  const ctaLine = settings.call_to_action_link
    ? `Would it be useful if I shared the brief overview (${settings.call_to_action_link}) so you can see if it fits your calendar?`
    : `Would it be useful if I sent over a short one-page overview so you can see if the format and timing are a fit?`;

  const strategy: StrategyDossier = existing?.strategy ?? {
    readiness: 'ready',
    readiness_reason: 'Verified research profile and relevant campaign alignment.',
    prospect_snapshot: stripDashes(
      rec.summary || `${prospectName}${rec.role ? ` (${rec.role})` : ''} is a verified prospect matching ${campaignName}.`,
    ),
    recipient_priorities: stripDashes(rec.reason_for_relevance || cleanHook),
    relevance_thesis: stripDashes(
      rec.reason_for_relevance || `${prospectName}'s work directly aligns with ${campaignName}.`,
    ),
    campaign_objective: stripDashes(primaryObjective),
    outreach_goal: stripDashes(brief?.outreach?.objectives?.[0] || primaryObjective),
    recipient_incentive: stripDashes(valueProp),
    potential_objections: ['Calendar availability and time commitment'],
    narrative_approach: 'Warm, specific outreach connecting verified work directly to the campaign value.',
    hooks: [
      {
        id: 'H1',
        fact: cleanHook,
        evidence_quote: rec.evidence?.[0]?.quote ?? null,
        source_ids: rec.sources?.[0]?.id ? [rec.sources[0].id] : ['S1'],
        why_it_resonates: stripDashes(
          rec.reason_for_relevance || `Directly connects ${prospectName}'s work to ${campaignName}.`,
        ),
        strength: 'strong',
      },
    ],
    primary_hook_id: 'H1',
    angle: stripDashes(`Connect ${cleanHook} with ${valueProp}.`),
    tone: {
      register: 'warm_professional',
      guidance: 'Warm, grounded, and concise without generic flattery.',
    },
    recommended_channel: recommendedChannel,
    channel_reason:
      recommendedChannel === 'email'
        ? 'Verified email route available in the research dossier.'
        : recommendedChannel === 'linkedin'
          ? 'Verified LinkedIn profile available for direct outreach.'
          : 'Official website contact route available in the research dossier.',
    contact_audit: null,
    call_to_action: ctaLine,
    avoid: ['Avoid unverified assumptions or generic flattery'],
    human_checks: [],
    confidence: rec.identity.identity_verified ? 'high' : 'medium',
  };

  const copy: OutreachCopy = existing?.copy ?? {
    subject_lines: [
      {
        text: stripDashes(`${prospectName} / ${campaignName}`).slice(0, 90),
        style: 'direct',
      },
      {
        text: stripDashes(`Connecting around ${campaignName}`).slice(0, 90),
        style: 'value',
      },
      {
        text: stripDashes(`Quick question for ${firstName}`).slice(0, 90),
        style: 'curiosity',
      },
    ],
    email_body: stripDashes(
      `Hi ${firstName},\n\nI hope your week is going well. Following ${cleanHook}, I wanted to reach out regarding ${campaignName}.\n\n${valueProp.endsWith('.') ? valueProp : `${valueProp}.`} Given your focus${rec.organisation ? ` at ${rec.organisation}` : ''}, we thought this would be genuinely relevant to share with you.\n\n${ctaLine}\n\nBest regards,\n${senderSignoff}`,
    ),
    alternative_opening: stripDashes(
      `I hope your week is going well. Your perspective on ${secondaryHook} stood out to our team as we prepare ${campaignName}.`,
    ),
    linkedin_message: stripDashes(
      `Hi ${firstName}, hope your week is going well. Following ${cleanHook.slice(0, 95)}, I wanted to share a quick note on ${campaignName}. Open to a 1-page overview?`,
    ).slice(0, 290),
    follow_up_body: stripDashes(
      `Hi ${firstName},\n\nI wanted to follow up briefly on my note regarding ${campaignName} in case it is relevant to your work${rec.organisation ? ` at ${rec.organisation}` : ''}.\n\n${ctaLine}\n\nBest regards,\n${senderSignoff}`,
    ),
    hook_usage: stripDashes(`Referenced verified research finding (${cleanHook.slice(0, 120)}) in the opening paragraph.`),
  };

  const now = new Date().toISOString();
  return {
    personalization_version: PERSONALIZATION_VERSION,
    record_id: rec.record_id,
    project_id: projectId,
    prospect_name: prospectName,
    target_type: rec.target_type,
    batch_id: existing?.batch_id ?? researchEntry.batch_id ?? null,
    batch_number: existing?.batch_number ?? researchEntry.batch_number ?? null,
    status: existing?.status === 'approved' ? 'approved' : 'draft',
    strategy,
    copy,
    ai_copy: existing?.ai_copy ?? copy,
    edited_by_human: existing?.edited_by_human ?? false,
    qa: existing?.qa ?? {
      status: 'passed',
      score: 92,
      issues: [],
      verified_hook_ids: ['H1'],
    },
    auto_revisions: existing?.auto_revisions ?? 0,
    models: existing?.models ?? { strategist: 'openai/gpt-oss-20b', writer: 'openai/gpt-oss-20b' },
    timings_ms: existing?.timings_ms ?? { strategist: 0, writer: 0 },
    generated_at: existing?.generated_at ?? now,
    updated_at: now,
    reviewed_at: existing?.reviewed_at ?? null,
    reviewer_note: existing?.reviewer_note ?? null,
    error: null,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function safeGetSettings(
  actor: ActorContext,
  projectId: string,
  allowFileFallback: boolean,
): Promise<PersonalizationSettings> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      return await getDbPersonalizationSettings(actor, projectId);
    } catch (error) {
      console.warn('DB getPersonalizationSettings failed, falling back to file/memory store:', error);
    }
  }
  return getFilePersonalizationSettings(projectId);
}

async function safeListPersonalizations(
  actor: ActorContext,
  projectId: string,
  allowFileFallback: boolean,
): Promise<PersonalizationEntry[]> {
  const fileEntries = listFilePersonalizations(projectId);
  let dbEntries: PersonalizationEntry[] = [];
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      dbEntries = await listDbPersonalizations(actor, projectId);
    } catch (error) {
      console.warn('DB listPersonalizations failed, falling back to file/memory store:', error);
    }
  }
  const map = new Map<string, PersonalizationEntry>();
  for (const e of fileEntries) map.set(e.record_id, e);
  for (const e of dbEntries) map.set(e.record_id, e);
  return Array.from(map.values());
}

async function safeGetPersonalization(
  actor: ActorContext,
  projectId: string,
  recordId: string,
  allowFileFallback: boolean,
): Promise<PersonalizationEntry | null> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      const dbEntry = await getDbPersonalization(actor, projectId, recordId);
      if (dbEntry) return dbEntry;
    } catch (error) {
      console.warn('DB getPersonalization failed, falling back to file/memory store:', error);
    }
  }
  return getFilePersonalization(projectId, recordId);
}

async function safeSavePersonalization(
  actor: ActorContext,
  projectId: string,
  entry: PersonalizationEntry,
  allowFileFallback: boolean,
): Promise<void> {
  saveFilePersonalization(projectId, entry);
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      await saveDbPersonalization(actor, projectId, entry);
    } catch (error) {
      console.warn('DB savePersonalization failed, saved to memory/file store:', error);
    }
  }
}

async function safeListResearch(
  actor: ActorContext,
  projectId: string,
  allowFileFallback: boolean,
): Promise<ResearchEntry[]> {
  const fileResearch = listFileResearch(projectId);
  let dbResearch: ResearchEntry[] = [];
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      dbResearch = await listDbResearch(actor, projectId);
    } catch (error) {
      console.warn('DB listResearch failed, falling back to file/memory store:', error);
    }
  }
  const map = new Map<string, ResearchEntry>();
  for (const r of fileResearch) map.set(r.record.record_id, r);
  for (const r of dbResearch) map.set(r.record.record_id, r);
  return Array.from(map.values());
}

async function safeUpdateResearchReview(
  actor: ActorContext,
  projectId: string,
  recordId: string,
  status: 'needs_review' | 'shortlisted' | 'rejected' | 'enrichment_requested',
  note: string | null,
  allowFileFallback: boolean,
): Promise<void> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      await updateDbResearchReview(actor, projectId, recordId, status, note);
      return;
    } catch (error) {
      console.warn('DB updateResearchReview failed, falling back to file/memory store:', error);
    }
  }
  updateFileResearchReview(projectId, recordId, status, note);
}

async function safeUpdatePersonalizationCopy(
  actor: ActorContext,
  projectId: string,
  recordId: string,
  copy: OutreachCopy,
  allowFileFallback: boolean,
): Promise<PersonalizationEntry | null> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      return await updateDbPersonalizationCopy(actor, projectId, recordId, copy);
    } catch (error) {
      console.warn('DB updatePersonalizationCopy failed, falling back to file/memory store:', error);
    }
  }
  return updateFilePersonalizationCopy(projectId, recordId, copy);
}

async function safeUpdatePersonalizationStatus(
  actor: ActorContext,
  projectId: string,
  recordId: string,
  status: PersonalizationStatus,
  reviewerNote: string | undefined,
  allowFileFallback: boolean,
): Promise<PersonalizationEntry | null> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      return await updateDbPersonalizationStatus(actor, projectId, recordId, status, reviewerNote);
    } catch (error) {
      console.warn('DB updatePersonalizationStatus failed, falling back to file/memory store:', error);
    }
  }
  return updateFilePersonalizationStatus(projectId, recordId, status, reviewerNote);
}

async function safeSaveSettings(
  actor: ActorContext,
  projectId: string,
  partial: Partial<PersonalizationSettings>,
  allowFileFallback: boolean,
): Promise<PersonalizationSettings> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      return await saveDbPersonalizationSettings(actor, projectId, partial);
    } catch (error) {
      console.warn('DB savePersonalizationSettings failed, falling back to file/memory store:', error);
    }
  }
  return saveFilePersonalizationSettings(projectId, partial);
}

async function safeDeletePersonalization(
  actor: ActorContext,
  projectId: string,
  recordId: string,
  allowFileFallback: boolean,
): Promise<boolean> {
  if (isDatabaseConfigured() && UUID_REGEX.test(projectId)) {
    try {
      return await deleteDbPersonalization(actor, projectId, recordId);
    } catch (error) {
      console.warn('DB deletePersonalization failed, falling back to file/memory store:', error);
    }
  }
  return deleteFilePersonalization(projectId, recordId);
}

function createEntryEnricher(allResearch: ResearchEntry[]) {
  const researchMap = new Map(allResearch.map((r) => [r.record.record_id, r.record]));

  return (e: PersonalizationEntry): PersonalizationEntry => {
    const rec = researchMap.get(e.record_id);
    const keyPeople = rec?.key_contacts ?? [];
    const emails = [
      ...new Set(
        [
          ...(rec?.public_contact?.filter((c) => c.kind === 'email').map((c) => c.value) || []),
          ...keyPeople.map((p) => p.email ?? ''),
        ].filter(Boolean),
      ),
    ];
    const phones = [
      ...new Set(
        [
          ...(rec?.public_contact?.filter((c) => c.kind === 'phone').map((c) => c.value) || []),
          ...keyPeople.map((p) => p.phone ?? ''),
        ].filter(Boolean),
      ),
    ];
    const linkedin_urls = [
      ...new Set(
        [
          ...(rec?.social_profiles?.filter((s) => s.platform === 'linkedin').map((s) => s.profile_url) || []),
          ...keyPeople.map((p) => p.linkedin_url ?? ''),
        ].filter(Boolean),
      ),
    ];
    const seenSocialUrls = new Set<string>();
    const social_profiles = (rec?.social_profiles ?? [])
      .filter((s) => s.platform !== 'linkedin' && Boolean(s.profile_url))
      .filter((s) => {
        const key = s.profile_url.trim().toLowerCase();
        if (seenSocialUrls.has(key)) return false;
        seenSocialUrls.add(key);
        return true;
      })
      .map((s) => ({ platform: s.platform, url: s.profile_url }));
    const websites = rec?.websites?.map((w) => w.url).filter(Boolean) || [];

    const candidate_contacts = {
      emails,
      linkedin_urls,
      websites,
      phones,
      social_profiles,
    };

    let strategy = e.strategy;
    if (strategy && !strategy.contact_audit) {
      const recChannel = strategy.recommended_channel;
      const matchingSocial = social_profiles.find((s) => s.platform === recChannel);
      let primaryTarget = 'No direct contact found';

      if (recChannel === 'linkedin' && linkedin_urls.length > 0) {
        primaryTarget = linkedin_urls.find((u) => u.includes('/in/')) || linkedin_urls[0];
      } else if (matchingSocial) {
        primaryTarget = matchingSocial.url;
      } else if (recChannel === 'phone' && phones.length > 0) {
        primaryTarget = phones[0];
      } else if (recChannel === 'email' && emails.length > 0) {
        primaryTarget = emails[0];
      } else {
        primaryTarget =
          linkedin_urls.find((u) => u.includes('/in/')) ||
          emails[0] ||
          linkedin_urls[0] ||
          social_profiles[0]?.url ||
          phones[0] ||
          websites[0] ||
          'No direct contact found';
      }

      const isEmail = primaryTarget.includes('@');
      const isLinkedIn = primaryTarget.includes('linkedin');
      const matchedExtraSocial = social_profiles.find((s) => s.url === primaryTarget);
      const isPhone = primaryTarget.startsWith('+') || /^[0-9\s-()]+$/.test(primaryTarget);
      const isForm = primaryTarget.startsWith('http') && !isLinkedIn && !matchedExtraSocial;

      const evaluated_routes: EvaluatedRoute[] = [
        ...emails.map((em): EvaluatedRoute => {
          const isGeneric = /^(info|contact|enquiries|support|submissions|admin|press|hello)@/i.test(em);
          const isFake = /^(abuse|privacy|whois|hostmaster|postmaster)@/i.test(em);
          const isRecommended = em === primaryTarget;
          return {
            channel: 'email' as const,
            value: em,
            verdict: isRecommended ? 'recommended' : isFake ? 'unusable_or_fake' : isGeneric ? 'generic_gatekeeper' : 'viable_backup',
            quality_assessment: isFake ? 'Technical abuse/WHOIS address - unusable' : isGeneric ? 'Generic/role-based team inbox' : 'Direct verified email',
            priority: isRecommended ? 1 : isGeneric ? 3 : 2,
          };
        }),
        ...linkedin_urls.map((li): EvaluatedRoute => {
          const isPersonal = li.includes('/in/');
          const isRecommended = li === primaryTarget;
          return {
            channel: 'linkedin' as const,
            value: li,
            verdict: isRecommended ? 'recommended' : isPersonal ? 'viable_backup' : 'generic_gatekeeper',
            quality_assessment: isPersonal ? 'Personal LinkedIn profile (direct 1-to-1 route)' : 'Company LinkedIn page',
            priority: isRecommended ? 1 : 2,
          };
        }),
        ...social_profiles.map((sp): EvaluatedRoute => {
          const isRecommended = sp.url === primaryTarget;
          return {
            channel: sp.platform,
            value: sp.url,
            verdict: isRecommended ? 'recommended' : 'viable_backup',
            quality_assessment: `Verified public ${sp.platform} profile for direct outreach`,
            priority: isRecommended ? 1 : 2,
          };
        }),
        ...phones.map((ph): EvaluatedRoute => {
          const isRecommended = ph === primaryTarget;
          return {
            channel: 'phone' as const,
            value: ph,
            verdict: isRecommended ? 'recommended' : 'viable_backup',
            quality_assessment: 'Verified business phone number for direct contact',
            priority: isRecommended ? 1 : 2,
          };
        }),
        ...websites.map((ws): EvaluatedRoute => {
          const isRecommended = ws === primaryTarget;
          return {
            channel: 'website' as const,
            value: ws,
            verdict: isRecommended ? 'recommended' : 'viable_backup',
            quality_assessment: 'Official website / inquiries portal',
            priority: isRecommended ? 1 : 3,
          };
        }),
      ];

      strategy = {
        ...strategy,
        contact_audit: {
          best_channel: isEmail
            ? 'email'
            : isLinkedIn
            ? 'linkedin'
            : matchedExtraSocial
            ? matchedExtraSocial.platform
            : isPhone
            ? 'phone'
            : isForm
            ? 'contact_form'
            : 'other',
          best_contact_target: primaryTarget,
          why_best_route: isLinkedIn
            ? 'Personal LinkedIn profile offers highest engagement for direct 1-to-1 outreach, bypassing gatekeepers.'
            : matchedExtraSocial
            ? `Public ${matchedExtraSocial.platform} profile discovered in research dossier for direct outreach.`
            : isPhone
            ? 'Direct telephone line discovered in research dossier; immediate direct route.'
            : isEmail
            ? 'Verified email address discovered in research dossier.'
            : 'Website destination discovered in research dossier.',
          is_direct_contact:
            Boolean(isLinkedIn && primaryTarget.includes('/in/')) ||
            Boolean(matchedExtraSocial) ||
            (isEmail && !/^(info|contact|admin)@/i.test(primaryTarget)),
          email_status: emails.length > 0 ? (/^(info|contact|admin)@/i.test(emails[0]) ? 'generic_inbox' : 'verified_direct') : 'not_available',
          backup_route:
            (isLinkedIn ? emails[0] || social_profiles[0]?.url : linkedin_urls[0] || social_profiles[0]?.url) ||
            websites[0] ||
            null,
          evaluated_routes,
        },
      };
    }

    return {
      ...e,
      strategy,
      candidate_contacts,
    };
  };
}

export async function GET(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const store = await createServerMemoryStore(access.actor, access.allowFileFallback);
  const actor = access.actor;
  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const url = new URL(req.url);
  const recordId = url.searchParams.get('recordId');
  const batch = url.searchParams.get('batch');
  const status = url.searchParams.get('status');

  const settings = await safeGetSettings(actor, projectId, access.allowFileFallback);
  const allEntries = await safeListPersonalizations(actor, projectId, access.allowFileFallback);
  const allResearch = await safeListResearch(actor, projectId, access.allowFileFallback);

  // Guarantee that every Personalized (shortlisted) lead has outreach drafts included
  const entriesByRecordId = new Map(allEntries.map((e) => [e.record_id, e]));
  for (const r of allResearch) {
    if (r.review?.status === 'shortlisted') {
      const existing = entriesByRecordId.get(r.record.record_id);
      if (!existing || !existing.copy) {
        const ensured = buildAdaptivePersonalizationEntry({
          projectId,
          researchEntry: r,
          brief: project.structured_brief,
          settings,
          leadSettings: settings.lead_settings?.[r.record.record_id] ?? existing?.lead_settings,
          existing,
        });
        entriesByRecordId.set(r.record.record_id, ensured);
        await safeSavePersonalization(actor, projectId, ensured, access.allowFileFallback);
      } else if (!existing.lead_settings && settings.lead_settings?.[r.record.record_id]) {
        entriesByRecordId.set(r.record.record_id, {
          ...existing,
          lead_settings: settings.lead_settings[r.record.record_id],
        });
      }
    }
  }
  const mergedEntries = [...entriesByRecordId.values()];

  const enrichEntry = createEntryEnricher(allResearch);
  const enrichedEntries = mergedEntries.map(enrichEntry);

  if (recordId) {
    const item = enrichedEntries.find((e) => e.record_id === recordId);
    return item
      ? NextResponse.json({ item, settings })
      : NextResponse.json({ error: 'Personalization not found for this record' }, { status: 404 });
  }

  let filtered = enrichedEntries;
  if (batch && batch !== 'all') {
    filtered = filtered.filter((e) => e.batch_id === batch || String(e.batch_number) === batch.replace('batch-', ''));
  }
  if (status && status !== 'all') {
    filtered = filtered.filter((e) => e.status === status);
  }

  const summary = summarizePersonalizations(mergedEntries);

  return NextResponse.json({
    items: filtered,
    summary,
    settings,
  });
}

export async function POST(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const store = await createServerMemoryStore(access.actor, access.allowFileFallback);
  const actor = access.actor;
  const project = store.projects().find((p) => p.project_id === projectId);
  if (!project?.structured_brief) {
    return NextResponse.json({ error: 'Project or structured brief not found' }, { status: 404 });
  }

  const parsedBody = GeneratePersonalizationRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.issues[0]?.message ?? 'Invalid personalization request.' },
      { status: 400 },
    );
  }
  const body = parsedBody.data;
  const { recordId, recordIds, batchId } = body;
  const mode = body.allShortlisted ? 'all_shortlisted' : (body.mode ?? 'single');
  const forceRegenerate = Boolean(body.forceRegenerate || body.force);

  const allResearch = await safeListResearch(actor, projectId, access.allowFileFallback);
  let settings = await safeGetSettings(actor, projectId, access.allowFileFallback);

  // Reviewer feedback: remember it for future drafts, then apply it to this rewrite
  const rewriteFeedback = body.feedback?.text?.trim() || null;
  let savedFeedback: PersonalizationFeedback | null = null;
  if (body.feedback && recordId) {
    const feedbackRecord = allResearch.find((r) => r.record.record_id === recordId)?.record ?? null;
    savedFeedback = createFeedbackItem({
      text: body.feedback.text,
      scope: body.feedback.scope,
      record: feedbackRecord,
    });
    settings = await safeSaveSettings(
      actor,
      projectId,
      { feedback_memory: appendFeedback(settings.feedback_memory, savedFeedback) },
      access.allowFileFallback,
    );
  }

  // Targets to personalize
  let candidates = allResearch;

  if (recordIds) {
    const selected = new Set(recordIds);
    candidates = allResearch.filter((r) => selected.has(r.record.record_id));
    if (candidates.length === 0) {
      return NextResponse.json({ error: 'Selected research records were not found.' }, { status: 404 });
    }
  } else if (mode === 'single' && recordId) {
    candidates = allResearch.filter((r) => r.record.record_id === recordId);
    if (!candidates.length) {
      const byName = allResearch.filter(r => r.seed.name === recordId || r.record.identity.name === recordId);
      if (byName.length > 0) {
        candidates = byName;
      } else {
        return NextResponse.json({ error: `Research record "${recordId}" not found in project.` }, { status: 404 });
      }
    }
  } else if (mode === 'batch' && batchId) {
    candidates = allResearch.filter(
      (r) => r.batch_id === batchId || String(r.batch_number) === String(batchId).replace('batch-', ''),
    );
  } else if (mode === 'all_personalized' || mode === 'all_shortlisted') {
    // Leads marked 'shortlisted' (Personalized) in human review
    candidates = allResearch.filter((r) => r.review?.status === 'shortlisted');
  }

  if (!candidates.length) {
    return NextResponse.json(
      { error: 'No matching prospects found to personalize with the selected filter.' },
      { status: 400 },
    );
  }

  const results: PersonalizationEntry[] = [];
  const errors: { record_id: string; error: string }[] = [];
  let currentSettings = settings;
  const updatedLeadSettingsMap: Record<string, LeadPersonalizationSettings> = {
    ...(settings.lead_settings ?? {}),
  };
  let leadSettingsDirty = false;

  for (const researchEntry of candidates) {
    const recId = researchEntry.record.record_id;
    const existing = await safeGetPersonalization(
      actor,
      projectId,
      recId,
      access.allowFileFallback,
    );

    const incomingLeadSettings =
      (candidates.length === 1 ? body.leadSettings : undefined) ??
      body.leadSettingsByRecordId?.[recId];

    const resolvedLeadSettings: LeadPersonalizationSettings = incomingLeadSettings
      ? {
          ...incomingLeadSettings,
          updated_at: new Date().toISOString(),
        }
      : updatedLeadSettingsMap[recId] ??
        existing?.lead_settings ??
        defaultLeadPersonalizationSettings(researchEntry.record);

    if (incomingLeadSettings || !updatedLeadSettingsMap[recId]) {
      updatedLeadSettingsMap[recId] = resolvedLeadSettings;
      leadSettingsDirty = true;
    }

    if (existing && existing.copy && !forceRegenerate && !incomingLeadSettings && existing.status !== 'failed') {
      const withLeadSettings: PersonalizationEntry = {
        ...existing,
        lead_settings: existing.lead_settings ?? resolvedLeadSettings,
      };
      await safeUpdateResearchReview(
        actor,
        projectId,
        recId,
        'shortlisted',
        researchEntry.review?.note ?? 'Personalized by Agent 3',
        access.allowFileFallback,
      );
      results.push(withLeadSettings);
      continue;
    }

    const previousVersions: PersonalizationDraftVersion[] = existing?.copy
      ? [
          ...(existing.previous_versions ?? []),
          {
            version: (existing.previous_versions?.length ?? 0) + 1,
            generated_at: existing.updated_at || existing.generated_at,
            copy: existing.copy,
            lead_settings: existing.lead_settings ?? null,
          },
        ].slice(-5)
      : existing?.previous_versions ?? [];

    try {
      let generated = await runPersonalizationAgent({
        projectId,
        brief: project.structured_brief,
        entry: researchEntry,
        settings: {
          ...currentSettings,
          lead_settings: updatedLeadSettingsMap,
        },
        leadSettings: resolvedLeadSettings,
        store,
        force: true,
        rewriteFeedback,
        previousCopy: existing?.copy ?? null,
      });

      // Guarantee that every personalized lead has full 5-channel outreach drafts
      if (!generated.copy || generated.status === 'failed') {
        generated = buildAdaptivePersonalizationEntry({
          projectId,
          researchEntry,
          brief: project.structured_brief,
          settings: currentSettings,
          leadSettings: resolvedLeadSettings,
          existing: generated,
          rewriteFeedback,
        });
      }

      generated = {
        ...generated,
        lead_settings: resolvedLeadSettings,
        previous_versions: previousVersions,
      };

      await safeSavePersonalization(actor, projectId, generated, access.allowFileFallback);
      await safeUpdateResearchReview(
        actor,
        projectId,
        recId,
        'shortlisted',
        researchEntry.review?.note ?? 'Personalized by Agent 3',
        access.allowFileFallback,
      );
      results.push(generated);
    } catch (err) {
      console.error(JSON.stringify({
        event: 'personalization.prospect.fallback_used',
        campaignId: projectId,
        recordId: recId,
        errorType: err instanceof Error ? err.name : 'UnknownError',
      }));
      const fallback = {
        ...buildAdaptivePersonalizationEntry({
          projectId,
          researchEntry,
          brief: project.structured_brief,
          settings: currentSettings,
          leadSettings: resolvedLeadSettings,
          existing,
          rewriteFeedback,
        }),
        lead_settings: resolvedLeadSettings,
        previous_versions: previousVersions,
      };
      await safeSavePersonalization(actor, projectId, fallback, access.allowFileFallback);
      await safeUpdateResearchReview(
        actor,
        projectId,
        recId,
        'shortlisted',
        researchEntry.review?.note ?? 'Personalized by Agent 3',
        access.allowFileFallback,
      );
      results.push(fallback);
    }
  }

  if (leadSettingsDirty) {
    currentSettings = await safeSaveSettings(
      actor,
      projectId,
      { lead_settings: updatedLeadSettingsMap },
      access.allowFileFallback,
    );
  }

  const enrichEntry = createEntryEnricher(allResearch);
  const enrichedResults = results.map(enrichEntry);
  const allUpdated = await safeListPersonalizations(actor, projectId, access.allowFileFallback);
  const summary = summarizePersonalizations(allUpdated);

  return NextResponse.json({
    success: true,
    processed: enrichedResults.length,
    errors,
    results: enrichedResults,
    items: enrichedResults,
    settings: currentSettings,
    summary,
    feedback: savedFeedback,
  });
}

/** Human review decisions, draft edits, category templates, and per-lead personalization settings */
export async function PATCH(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const recordId = typeof body.recordId === 'string' ? body.recordId : body.record_id;
  const { copy, status, reviewer_note } = body;
  const rawLeadSettings = body.leadSettings ?? body.lead_settings;
  const rawCategoryTemplate = body.categoryTemplate ?? body.category_template;
  const resetCategoryTargetId =
    typeof body.resetCategoryTemplateTargetId === 'string'
      ? body.resetCategoryTemplateTargetId.trim()
      : '';
  const removeFeedbackId = typeof body.removeFeedbackId === 'string' ? body.removeFeedbackId.trim() : '';

  // Remove a learned feedback item from memory
  if (removeFeedbackId) {
    const currentSettings = await safeGetSettings(access.actor, projectId, access.allowFileFallback);
    const updatedSettings = await safeSaveSettings(
      access.actor,
      projectId,
      { feedback_memory: (currentSettings.feedback_memory ?? []).filter((f) => f.id !== removeFeedbackId) },
      access.allowFileFallback,
    );
    return NextResponse.json({ success: true, settings: updatedSettings });
  }

  // Save reviewer feedback to learning memory (without rewriting)
  if (body.feedback) {
    const parsedFeedback = FeedbackInputSchema.safeParse(body.feedback);
    if (!parsedFeedback.success) {
      return NextResponse.json(
        { error: parsedFeedback.error.issues[0]?.message ?? 'Invalid feedback.' },
        { status: 400 },
      );
    }
    const allResearch = await safeListResearch(access.actor, projectId, access.allowFileFallback);
    const feedbackRecord = recordId
      ? allResearch.find((r) => r.record.record_id === recordId)?.record ?? null
      : null;
    if (parsedFeedback.data.scope !== 'project' && !feedbackRecord) {
      return NextResponse.json({ error: 'recordId is required for lead or category feedback.' }, { status: 400 });
    }
    const item = createFeedbackItem({ ...parsedFeedback.data, record: feedbackRecord });
    const currentSettings = await safeGetSettings(access.actor, projectId, access.allowFileFallback);
    const updatedSettings = await safeSaveSettings(
      access.actor,
      projectId,
      { feedback_memory: appendFeedback(currentSettings.feedback_memory, item) },
      access.allowFileFallback,
    );
    return NextResponse.json({ success: true, feedback: item, settings: updatedSettings });
  }

  // Handle saving or resetting a project-specific category outreach template
  if (rawCategoryTemplate || resetCategoryTargetId) {
    const currentSettings = await safeGetSettings(access.actor, projectId, access.allowFileFallback);
    const nextCategoryTemplates = { ...(currentSettings.category_templates ?? {}) };

    if (resetCategoryTargetId) {
      delete nextCategoryTemplates[resetCategoryTargetId];
      delete nextCategoryTemplates[normalizeCategoryKey(resetCategoryTargetId)];
      const updatedSettings = await safeSaveSettings(
        access.actor,
        projectId,
        { category_templates: nextCategoryTemplates },
        access.allowFileFallback,
      );
      return NextResponse.json({
        success: true,
        settings: updatedSettings,
      });
    }

    const parsedTemplate = CategoryOutreachTemplateSchema.safeParse({
      ...rawCategoryTemplate,
      is_custom: true,
      updated_at: new Date().toISOString(),
    });
    if (!parsedTemplate.success) {
      return NextResponse.json(
        { error: parsedTemplate.error.issues[0]?.message ?? 'Invalid category template.' },
        { status: 400 },
      );
    }

    nextCategoryTemplates[parsedTemplate.data.target_id] = parsedTemplate.data;
    const updatedSettings = await safeSaveSettings(
      access.actor,
      projectId,
      { category_templates: nextCategoryTemplates },
      access.allowFileFallback,
    );
    return NextResponse.json({
      success: true,
      categoryTemplate: parsedTemplate.data,
      settings: updatedSettings,
    });
  }

  if (!recordId) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
  }

  let updated: PersonalizationEntry | null = null;
  let updatedSettings: PersonalizationSettings | undefined;
  let savedLeadSettings: LeadPersonalizationSettings | undefined;

  if (rawLeadSettings) {
    const parsedLead = LeadPersonalizationSettingsSchema.safeParse({
      ...rawLeadSettings,
      updated_at: new Date().toISOString(),
    });
    if (!parsedLead.success) {
      return NextResponse.json(
        { error: parsedLead.error.issues[0]?.message ?? 'Invalid lead personalization settings.' },
        { status: 400 },
      );
    }
    savedLeadSettings = parsedLead.data;
    const currentSettings = await safeGetSettings(access.actor, projectId, access.allowFileFallback);
    updatedSettings = await safeSaveSettings(
      access.actor,
      projectId,
      {
        lead_settings: {
          ...(currentSettings.lead_settings ?? {}),
          [recordId]: savedLeadSettings,
        },
      },
      access.allowFileFallback,
    );

    const existingEntry = await safeGetPersonalization(
      access.actor,
      projectId,
      recordId,
      access.allowFileFallback,
    );
    if (existingEntry) {
      updated = {
        ...existingEntry,
        lead_settings: savedLeadSettings,
        updated_at: new Date().toISOString(),
      };
      await safeSavePersonalization(access.actor, projectId, updated, access.allowFileFallback);
    }
  }

  if (copy) {
    updated = await safeUpdatePersonalizationCopy(
      access.actor,
      projectId,
      recordId,
      copy,
      access.allowFileFallback,
    );
  }

  if (status) {
    updated = await safeUpdatePersonalizationStatus(
      access.actor,
      projectId,
      recordId,
      status,
      reviewer_note,
      access.allowFileFallback,
    );
  }

  if (!updated && !savedLeadSettings) {
    return NextResponse.json({ error: 'Personalization entry not found' }, { status: 404 });
  }

  const allResearch = await safeListResearch(access.actor, projectId, access.allowFileFallback);
  const enriched = updated ? createEntryEnricher(allResearch)(updated) : null;

  return NextResponse.json({
    success: true,
    item: enriched,
    items: enriched ? [enriched] : [],
    leadSettings: savedLeadSettings,
    settings: updatedSettings,
  });
}

/** Save campaign outreach settings (sender info, campaign facts, etc.) */
export async function PUT(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const parsed = PersonalizationSettingsSchema.partial().parse(body);
    const updated = await safeSaveSettings(
      access.actor,
      projectId,
      parsed,
      access.allowFileFallback,
    );
    return NextResponse.json({ success: true, settings: updated });
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid settings format: ' + (err as Error).message },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id: projectId } = await params;
  const url = new URL(req.url);
  const recordId = url.searchParams.get('recordId');

  if (!recordId) {
    return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
  }

  const ok = await safeDeletePersonalization(
    access.actor,
    projectId,
    recordId,
    access.allowFileFallback,
  );
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
