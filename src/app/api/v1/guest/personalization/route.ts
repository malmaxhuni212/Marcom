import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/auth/access';
import { resolveGuestIdentity, setGuestCookie } from '@/auth/guest';
import {
  GUEST_LIMITS,
  refundGuestQuota,
  reserveGuestQuota,
} from '@/db/repositories/guest-quota-repository';
import {
  buildAdaptivePersonalizationEntry,
  runPersonalizationAgent,
} from '@/marcom/agents/personalization/agent';
import { InMemoryStore } from '@/marcom/memory/store';
import type { ProjectMemory } from '@/marcom/memory/types';
import {
  defaultLeadPersonalizationSettings,
  PersonalizationSettingsSchema,
  type EvaluatedRoute,
  type LeadPersonalizationSettings,
  type PersonalizationDraftVersion,
  type PersonalizationEntry,
} from '@/marcom/schemas/personalization';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function enrichPersonalizationEntryWithContacts(
  entry: PersonalizationEntry,
  research: ResearchEntry,
): PersonalizationEntry {
  const rec = research.record;
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

  let strategy = entry.strategy;
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
          verdict: isRecommended
            ? 'recommended'
            : isFake
              ? 'unusable_or_fake'
              : isGeneric
                ? 'generic_gatekeeper'
                : 'viable_backup',
          quality_assessment: isFake
            ? 'Technical abuse/WHOIS address - unusable'
            : isGeneric
              ? 'Generic/role-based team inbox'
              : 'Direct verified email',
          priority: isRecommended ? 1 : isGeneric ? 3 : 2,
        };
      }),
      ...linkedin_urls.map((li): EvaluatedRoute => {
        const isPersonal = li.includes('/in/');
        const isRecommended = li === primaryTarget;
        return {
          channel: 'linkedin' as const,
          value: li,
          verdict: isRecommended
            ? 'recommended'
            : isPersonal
              ? 'viable_backup'
              : 'generic_gatekeeper',
          quality_assessment: isPersonal
            ? 'Personal LinkedIn profile (direct 1-to-1 route)'
            : 'Company LinkedIn page',
          priority: isRecommended ? 1 : 2,
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
          ? 'Personal LinkedIn profile offers highest engagement for direct 1-to-1 outreach.'
          : isEmail
            ? 'Verified email address discovered in research dossier.'
            : 'Website destination discovered in research dossier.',
        is_direct_contact:
          Boolean(isLinkedIn && primaryTarget.includes('/in/')) ||
          Boolean(matchedExtraSocial) ||
          (isEmail && !/^(info|contact|admin)@/i.test(primaryTarget)),
        email_status:
          emails.length > 0
            ? /^(info|contact|admin)@/i.test(emails[0])
              ? 'generic_inbox'
              : 'verified_direct'
            : 'not_available',
        backup_route:
          (isLinkedIn ? emails[0] || social_profiles[0]?.url : linkedin_urls[0] || social_profiles[0]?.url) ||
          websites[0] ||
          null,
        evaluated_routes,
      },
    };
  }

  return {
    ...entry,
    strategy,
    candidate_contacts,
  };
}

export async function POST(req: Request): Promise<NextResponse> {
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
        { error: 'A valid structured project brief is required for personalisation.' },
        { status: 400 },
      ),
    );
  }
  const structuredBrief = parsedBrief.data;

  const projectId =
    typeof body.project_id === 'string' && body.project_id.trim()
      ? body.project_id.trim()
      : 'guest-project';

  const candidates = Array.isArray(body.candidates)
    ? (body.candidates as ResearchEntry[]).filter(
        (item) => item && item.record && typeof item.record.record_id === 'string',
      )
    : [];

  if (candidates.length === 0) {
    return withGuestCookie(
      NextResponse.json(
        { error: 'Select at least one researched lead to personalise.' },
        { status: 400 },
      ),
    );
  }

  if (candidates.length > GUEST_LIMITS.personalization.daily) {
    return withGuestCookie(
      NextResponse.json(
        {
          error: `Guest mode allows up to ${GUEST_LIMITS.personalization.daily} personalised leads per day (${GUEST_LIMITS.personalization.monthly} per month). Please select ${GUEST_LIMITS.personalization.daily} or fewer leads.`,
          code: 'GUEST_QUOTA_EXCEEDED',
        },
        { status: 429 },
      ),
    );
  }

  const reservation = await reserveGuestQuota(
    guest.guestIdHash,
    'personalization',
    candidates.length,
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

  const parsedSettings = PersonalizationSettingsSchema.safeParse(body.settings ?? {});
  const currentSettings = parsedSettings.success
    ? parsedSettings.data
    : PersonalizationSettingsSchema.parse({});

  const existingDrafts = Array.isArray(body.existing_drafts)
    ? (body.existing_drafts as PersonalizationEntry[])
    : [];
  const existingMap = new Map(existingDrafts.map((d) => [d.record_id, d]));

  const incomingSingleLeadSettings =
    body.lead_settings && typeof body.lead_settings === 'object'
      ? (body.lead_settings as LeadPersonalizationSettings)
      : undefined;
  const incomingLeadSettingsByRecordId =
    body.lead_settings_by_record_id && typeof body.lead_settings_by_record_id === 'object'
      ? (body.lead_settings_by_record_id as Record<string, LeadPersonalizationSettings>)
      : {};
  const rewriteFeedback =
    typeof body.rewrite_feedback === 'string' && body.rewrite_feedback.trim()
      ? body.rewrite_feedback.trim()
      : null;

  const updatedLeadSettingsMap: Record<string, LeadPersonalizationSettings> = {
    ...(currentSettings.lead_settings ?? {}),
  };

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

  const results: PersonalizationEntry[] = [];
  const errors: { record_id: string; error: string }[] = [];

  for (const researchEntry of candidates) {
    const recId = researchEntry.record.record_id;
    const existing = existingMap.get(recId);

    const incomingLead =
      (candidates.length === 1 ? incomingSingleLeadSettings : undefined) ??
      incomingLeadSettingsByRecordId[recId];

    const resolvedLeadSettings: LeadPersonalizationSettings = incomingLead
      ? {
          ...incomingLead,
          updated_at: new Date().toISOString(),
        }
      : updatedLeadSettingsMap[recId] ??
        existing?.lead_settings ??
        defaultLeadPersonalizationSettings(researchEntry.record);

    updatedLeadSettingsMap[recId] = resolvedLeadSettings;

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
      const agentPromise = runPersonalizationAgent({
        projectId,
        brief: structuredBrief,
        entry: researchEntry,
        settings: {
          ...currentSettings,
          lead_settings: updatedLeadSettingsMap,
        },
        leadSettings: resolvedLeadSettings,
        store: isolatedStore,
        force: true,
        rewriteFeedback,
        previousCopy: existing?.copy ?? null,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                'Personalization generation exceeded time window; falling back gracefully.',
              ),
            ),
          20_000,
        );
        agentPromise.finally(() => clearTimeout(timer));
      });

      let generated = await Promise.race([agentPromise, timeoutPromise]);

      if (!generated.copy || generated.status === 'failed') {
        generated = buildAdaptivePersonalizationEntry({
          projectId,
          researchEntry,
          brief: structuredBrief,
          settings: {
            ...currentSettings,
            lead_settings: updatedLeadSettingsMap,
          },
          leadSettings: resolvedLeadSettings,
          existing: generated,
          rewriteFeedback,
        });
      }

      generated = enrichPersonalizationEntryWithContacts(
        {
          ...generated,
          lead_settings: resolvedLeadSettings,
          previous_versions: previousVersions,
        },
        researchEntry,
      );
      results.push(generated);
    } catch {
      const fallback = enrichPersonalizationEntryWithContacts(
        {
          ...buildAdaptivePersonalizationEntry({
            projectId,
            researchEntry,
            brief: structuredBrief,
            settings: {
              ...currentSettings,
              lead_settings: updatedLeadSettingsMap,
            },
            leadSettings: resolvedLeadSettings,
            existing,
            rewriteFeedback,
          }),
          lead_settings: resolvedLeadSettings,
          previous_versions: previousVersions,
        },
        researchEntry,
      );
      results.push(fallback);
    }
  }

  const unusedSlots = Math.max(0, candidates.length - results.length);
  const finalQuota =
    unusedSlots > 0
      ? await refundGuestQuota(guest.guestIdHash, 'personalization', unusedSlots)
      : reservation.snapshot;

  return withGuestCookie(
    NextResponse.json({
      success: true,
      processed: results.length,
      errors,
      results,
      items: results,
      settings: {
        ...currentSettings,
        lead_settings: updatedLeadSettingsMap,
      },
      quota: finalQuota,
    }),
  );
}
