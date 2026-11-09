'use client';

import Link from 'next/link';

import { useEffect, useMemo, useRef, useState } from 'react';
import { authenticatedFetch } from '@/auth/client';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import {
  defaultLeadPersonalizationSettings,
  recommendLeadPersonalization,
  LEAD_APPROACH_LABELS,
  LEAD_CTA_LABELS,
  LEAD_DEPTH_LABELS,
  LEAD_EXPLANATION_LABELS,
  LEAD_LENGTH_LABELS,
  LEAD_TONE_LABELS,
  type LeadCallToAction,
  type LeadCommunicationApproach,
  type LeadExplanationLevel,
  type LeadMessageLength,
  type LeadPersonalizationDepth,
  type LeadPersonalizationSettings,
  type LeadTone,
  type PersonalizationEntry,
  type PersonalizationSettings,
} from '@/marcom/schemas/personalization';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import CampaignConfigurationForm from '@/components/campaign/CampaignConfigurationForm';
import CampaignSettingsModal from '@/components/personalization/CampaignSettingsModal';
import { PageFrame, ProjectGate } from '../AppShell';
import { useWorkspace } from '../WorkspaceContext';
import DraftsDrawer from '../DraftsDrawer';
import DraftFeedbackPanel from '../DraftFeedbackPanel';
import { downloadProspectMarkdown } from '../export-dossier';
import {
  FitList,
  KeyContactsList,
  MoreResearchDialog,
  SourcesList,
  VerificationCard,
  saveDecision,
  useClipboard,
} from '../prospect-parts';
import {
  CloseButton,
  Dialog,
  EmptyState,
  Icon,
  Initials,
  Pill,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  card,
  serif,
} from '../ui';
import {
  STATUS_META,
  CHANNEL_LABEL,
  contactSummary,
  contactsOf,
  entriesForTarget,
  formatProfileDisplay,
  hostOf,
  isShortSocialChannel,
  isSocialProfileChannel,
  locationOf,
  messageFor,
  plural,
  primaryChannel,
  prospectGoal,
  prospectName,
  reviewStatus,
  shortDate,
  subjectFor,
  targetFor,
  verificationOf,
  type DraftChannel,
} from '../format';

const EMPTY_SETTINGS: PersonalizationSettings = {
  sender_name: '',
  sender_role: '',
  organisation: '',
  campaign_facts: [],
  call_to_action_link: '',
  signature: '',
  extra_guidance: '',
  updated_at: null,
};

function researchBullets(entry: ResearchEntry): string[] {
  const rec = entry.record;
  return [
    ...rec.work_and_projects,
    ...rec.achievements,
    ...rec.background,
    ...rec.industry_activity,
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildClientFallbackDraft(
  projectId: string,
  researchEntry: ResearchEntry,
  brief: StructuredBrief | null | undefined,
  settings: PersonalizationSettings | null | undefined,
  existing?: PersonalizationEntry | null,
): PersonalizationEntry {
  const rec = researchEntry.record;
  const name = prospectName(researchEntry);
  const isOrg = rec.identity.entity_kind === 'organisation';
  const keyPerson = rec.key_contacts?.[0];
  const firstName = isOrg
    ? keyPerson?.name?.trim().split(/\s+/)[0] || `${name} team`
    : name.trim().split(/\s+/)[0] || name;

  const strip = (text: string) => text.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');
  const campaignName = brief?.project?.name || 'our upcoming initiative';
  const primaryObjective =
    brief?.project?.primary_objective ||
    brief?.outreach?.objectives?.[0] ||
    'explore a relevant collaboration';
  const valueProp =
    settings?.campaign_facts?.[0] ||
    brief?.outreach?.objectives?.[0] ||
    primaryObjective;

  const rawHook =
    rec.work_and_projects?.[0] ||
    rec.achievements?.[0] ||
    rec.reason_for_relevance ||
    rec.summary ||
    `your work${rec.organisation ? ` at ${rec.organisation}` : ''}`;
  const cleanHook = strip(rawHook).replace(/\.$/, '');

  const senderSignoff =
    settings?.signature?.trim() ||
    [
      settings?.sender_name?.trim() || 'The Campaign Team',
      [settings?.sender_role?.trim(), settings?.organisation?.trim() || brief?.project?.name].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join('\n');

  const ctaLine = settings?.call_to_action_link
    ? `Would it be useful if I shared the brief overview (${settings.call_to_action_link}) so you can see if it fits your calendar?`
    : `Would it be useful if I sent over a short one-page overview so you can see if the format and timing are a fit?`;

  const copy = existing?.copy ?? {
    subject_lines: [
      { text: strip(`${name} / ${campaignName}`).slice(0, 90), style: 'direct' as const },
      { text: strip(`Connecting around ${campaignName}`).slice(0, 90), style: 'value' as const },
      { text: strip(`Quick question for ${firstName}`).slice(0, 90), style: 'curiosity' as const },
    ],
    email_body: strip(
      `Hi ${firstName},\n\nI hope your week is going well. Following ${cleanHook}, I wanted to reach out regarding ${campaignName}.\n\n${valueProp.endsWith('.') ? valueProp : `${valueProp}.`} Given your focus${rec.organisation ? ` at ${rec.organisation}` : ''}, we thought this would be genuinely relevant to share with you.\n\n${ctaLine}\n\nBest regards,\n${senderSignoff}`,
    ),
    alternative_opening: null,
    linkedin_message: strip(
      `Hi ${firstName}, hope your week is going well. Following ${cleanHook.slice(0, 95)}, I wanted to share a quick note on ${campaignName}. Open to a 1-page overview?`,
    ).slice(0, 290),
    follow_up_body: strip(
      `Hi ${firstName},\n\nI wanted to follow up briefly on my note regarding ${campaignName} in case it is relevant to your work${rec.organisation ? ` at ${rec.organisation}` : ''}.\n\n${ctaLine}\n\nBest regards,\n${senderSignoff}`,
    ),
    hook_usage: strip(`Referenced verified research finding (${cleanHook.slice(0, 120)}) in the opening paragraph.`),
  };

  const now = new Date().toISOString();
  const resolvedLeadSettings =
    existing?.lead_settings ??
    settings?.lead_settings?.[rec.record_id] ??
    defaultLeadPersonalizationSettings(rec);
  return {
    personalization_version: '1.0',
    record_id: rec.record_id,
    project_id: projectId,
    prospect_name: name,
    target_type: rec.target_type,
    batch_id: existing?.batch_id ?? researchEntry.batch_id ?? null,
    batch_number: existing?.batch_number ?? researchEntry.batch_number ?? null,
    status: existing?.status === 'approved' ? 'approved' : 'draft',
    lead_settings: resolvedLeadSettings,
    previous_versions: existing?.previous_versions ?? [],
    strategy: existing?.strategy ?? null,
    copy,
    ai_copy: existing?.ai_copy ?? copy,
    edited_by_human: existing?.edited_by_human ?? false,
    qa: existing?.qa ?? null,
    auto_revisions: existing?.auto_revisions ?? 0,
    models: existing?.models ?? { strategist: 'openai/gpt-oss-20b', writer: 'openai/gpt-oss-20b' },
    timings_ms: existing?.timings_ms ?? { strategist: 0, writer: 0 },
    generated_at: existing?.generated_at ?? now,
    updated_at: existing?.updated_at ?? now,
    reviewed_at: existing?.reviewed_at ?? null,
    reviewer_note: existing?.reviewer_note ?? null,
    error: null,
  };
}

interface BestContactRecommendation {
  channelLabel: string;
  draftChannel: DraftChannel;
  badgeLabel: string;
  badgeBg: string;
  badgeFg: string;
  targetDisplay: string;
  targetCopy: string | null;
  targetHref: string | null;
  personLabel: string | null;
  why: string;
  backup: string | null;
}

interface LeadWatchout {
  category: string;
  text: string;
  tone: 'amber' | 'teal' | 'purple';
}

function analyzeLeadInsights(
  entry: ResearchEntry,
  draft: PersonalizationEntry | null,
): { bestContact: BestContactRecommendation; watchouts: LeadWatchout[] } {
  const name = prospectName(entry);
  const contacts = contactsOf(entry);
  const keyContacts = entry.record.key_contacts ?? [];
  const strategy = draft?.strategy ?? null;
  const audit = strategy?.contact_audit ?? null;

  const genericPrefixes = /^(info|contact|enquiries|inquiries|hello|office|admin|general|support|mail|help|reception)@/i;
  const deptPrefixes = /^(press|media|pr|rights|submissions|partnerships|events|marketing|editorial|awards| publicity)@/i;

  const directKeyPerson = keyContacts.find((k) => k.email || k.linkedin_url) ?? keyContacts[0] ?? null;

  let bestContact: BestContactRecommendation;

  if (contacts.email) {
    const isGeneric = genericPrefixes.test(contacts.email);
    const isDept = deptPrefixes.test(contacts.email);
    const personLabel =
      contacts.emailOwner ||
      (directKeyPerson ? `${directKeyPerson.name}${directKeyPerson.role ? ` · ${directKeyPerson.role}` : ''}` : null);

    const badge =
      !isGeneric && !isDept
        ? { label: 'Direct email', bg: '#10261B', fg: '#8EE6B6' }
        : isDept
          ? { label: 'Department inbox', bg: '#12313A', fg: '#9BE6EE' }
          : { label: 'General inbox', bg: '#3A2F17', fg: '#F2C36B' };

    const defaultWhy = !isGeneric && !isDept
      ? `Reaches ${personLabel || name} directly via a verified email address, allowing a complete, tailored pitch with clear context and next steps.`
      : isDept
        ? `Dedicated department address (${contacts.email}) that routes directly to the team handling ${entry.record.target_type || 'partnerships and submissions'} at ${name}.`
        : `Verified public inbox for ${name}. Because this is a shared address, name the relevant department or person (${personLabel || 'partnerships / submissions lead'}) in your opening line so it gets forwarded quickly.`;

    const backupRoute =
      audit?.backup_route ||
      (contacts.linkedin
        ? `LinkedIn (${hostOf(contacts.linkedin)}${contacts.linkedinOwner ? ` · ${contacts.linkedinOwner}` : ''}) if there is no email reply within 5 days`
        : contacts.contactForm
          ? `Website contact form (${hostOf(contacts.contactForm)})`
          : null);

    bestContact = {
      channelLabel: 'Email',
      draftChannel: 'email',
      badgeLabel: badge.label,
      badgeBg: badge.bg,
      badgeFg: badge.fg,
      targetDisplay: contacts.email,
      targetCopy: contacts.email,
      targetHref: `mailto:${contacts.email}`,
      personLabel,
      why: audit?.why_best_route || strategy?.channel_reason || defaultWhy,
      backup: backupRoute,
    };
  } else if (contacts.contactForm) {
    const personLabel = directKeyPerson
      ? `${directKeyPerson.name}${directKeyPerson.role ? ` · ${directKeyPerson.role}` : ''}`
      : null;
    bestContact = {
      channelLabel: 'Website contact form',
      draftChannel: 'website_form',
      badgeLabel: 'Official form',
      badgeBg: '#12313A',
      badgeFg: '#9BE6EE',
      targetDisplay: hostOf(contacts.contactForm) + '/contact',
      targetCopy: contacts.contactForm,
      targetHref: contacts.contactForm,
      personLabel,
      why:
        audit?.why_best_route ||
        strategy?.channel_reason ||
        `No direct public email is listed for ${name}, but their official website contact form routes external enquiries directly to the internal team.`,
      backup: contacts.linkedin ? `LinkedIn (${hostOf(contacts.linkedin)})` : null,
    };
  } else if (contacts.linkedin) {
    const personLabel =
      contacts.linkedinOwner ||
      (directKeyPerson ? `${directKeyPerson.name}${directKeyPerson.role ? ` · ${directKeyPerson.role}` : ''}` : null);
    bestContact = {
      channelLabel: 'LinkedIn',
      draftChannel: 'linkedin',
      badgeLabel: personLabel ? 'Decision-maker LinkedIn' : 'Verified LinkedIn',
      badgeBg: '#26224A',
      badgeFg: '#CFC8FF',
      targetDisplay: hostOf(contacts.linkedin),
      targetCopy: contacts.linkedin,
      targetHref: contacts.linkedin,
      personLabel,
      why:
        audit?.why_best_route ||
        strategy?.channel_reason ||
        `LinkedIn is the most direct verified channel for ${personLabel || name} since no public email address is published on their site.`,
      backup:
        contacts.extraSocials[0]
          ? `${contacts.extraSocials[0].label} (${contacts.extraSocials[0].display})`
          : contacts.website
            ? `Official website (${hostOf(contacts.website)})`
            : null,
    };
  } else if (contacts.extraSocials.length > 0) {
    const firstSocial = contacts.extraSocials[0]!;
    bestContact = {
      channelLabel: firstSocial.label,
      draftChannel: firstSocial.platform,
      badgeLabel: `Verified ${firstSocial.label}`,
      badgeBg: '#26224A',
      badgeFg: '#CFC8FF',
      targetDisplay: firstSocial.display,
      targetCopy: firstSocial.url,
      targetHref: firstSocial.url,
      personLabel: null,
      why:
        audit?.why_best_route ||
        strategy?.channel_reason ||
        `${firstSocial.label} is the most direct verified public profile found for ${name} since no public email address is published.`,
      backup:
        contacts.extraSocials[1]
          ? `${contacts.extraSocials[1].label} (${contacts.extraSocials[1].display})`
          : contacts.website
            ? `Official website (${hostOf(contacts.website)})`
            : null,
    };
  } else if (contacts.website) {
    bestContact = {
      channelLabel: 'Website enquiry',
      draftChannel: 'website_form',
      badgeLabel: 'Website only',
      badgeBg: '#3A2F17',
      badgeFg: '#F2C36B',
      targetDisplay: hostOf(contacts.website),
      targetCopy: contacts.website,
      targetHref: contacts.website,
      personLabel: directKeyPerson ? `${directKeyPerson.name}${directKeyPerson.role ? ` · ${directKeyPerson.role}` : ''}` : null,
      why:
        audit?.why_best_route ||
        `Only ${name}'s main website was verified so far. Use their site's contact page or run 'More research' to uncover a named decision-maker.`,
      backup: null,
    };
  } else {
    bestContact = {
      channelLabel: 'Needs contact enrichment',
      draftChannel: 'email',
      badgeLabel: 'No direct route yet',
      badgeBg: '#3A2F17',
      badgeFg: '#F2C36B',
      targetDisplay: 'No verified email or LinkedIn yet',
      targetCopy: null,
      targetHref: null,
      personLabel: null,
      why: 'No verified contact route was found in initial research. Click "More research" below to search specifically for a decision-maker or contact page.',
      backup: null,
    };
  }

  // Build lead-specific "Things to look out for"
  const watchouts: LeadWatchout[] = [];

  // 1. Contact & Gatekeeper watchout
  if (contacts.email && genericPrefixes.test(contacts.email)) {
    watchouts.push({
      category: 'Gatekeeper inbox',
      text: `${contacts.email} is a general inbox. Ask clearly in your first sentence to be directed to ${
        directKeyPerson ? `${directKeyPerson.name} (${directKeyPerson.role || 'relevant lead'})` : `the person overseeing ${entry.record.target_type || 'partnerships & submissions'}`
      }.`,
      tone: 'amber',
    });
  } else if (!contacts.email && contacts.linkedin) {
    watchouts.push({
      category: 'Channel constraint',
      text: 'No public email was found — keep your initial LinkedIn note under 300 characters and ask who best to send the full overview to.',
      tone: 'amber',
    });
  } else if (entry.record.identity.entity_kind === 'organisation' && directKeyPerson) {
    watchouts.push({
      category: 'Decision-maker routing',
      text: `For ${name}, reference ${directKeyPerson.name}${directKeyPerson.role ? ` (${directKeyPerson.role})` : ''} so your outreach reaches a specific person rather than getting lost in a general queue.`,
      tone: 'teal',
    });
  } else if (entry.record.identity.entity_kind === 'organisation' && !directKeyPerson) {
    watchouts.push({
      category: 'Organisation outreach',
      text: `This is an organisation record without a named individual contact yet — address the ${name} team warmly and ask who leads ${entry.record.target_type || 'their programmes'}.`,
      tone: 'amber',
    });
  }

  // 2. Strategist "What to avoid" & "Human checks"
  for (const item of (strategy?.avoid ?? []).slice(0, 2)) {
    if (item.trim()) {
      watchouts.push({
        category: 'Avoid in outreach',
        text: item.trim(),
        tone: 'amber',
      });
    }
  }
  for (const check of (strategy?.human_checks ?? []).slice(0, 2)) {
    if (check.trim()) {
      watchouts.push({
        category: 'Check before sending',
        text: check.trim(),
        tone: 'purple',
      });
    }
  }

  // 3. Contradictions or unconfirmed criteria from research
  for (const contradiction of entry.record.contradictions.slice(0, 1)) {
    watchouts.push({
      category: 'Research contradiction',
      text: contradiction,
      tone: 'amber',
    });
  }

  const unconfirmedCriteria = entry.record.qualification_assessment.filter(
    (q) => q.status === 'not_met' || q.status === 'partially_met' || q.status === 'unknown',
  );
  for (const crit of unconfirmedCriteria.slice(0, 2)) {
    watchouts.push({
      category: crit.status === 'partially_met' ? 'Partly confirmed' : 'Unconfirmed detail',
      text: `${crit.criterion}${crit.note ? ` — ${crit.note}` : ' (do not assume this in your message)'}`,
      tone: 'amber',
    });
  }

  // 4. Unknowns from research if watchouts list is still short
  if (watchouts.length < 3) {
    for (const unk of entry.record.unknowns.slice(0, 2)) {
      watchouts.push({
        category: 'Unverified info',
        text: `${unk.field}: ${unk.reason}`,
        tone: 'teal',
      });
    }
  }

  // 5. Tone & angle guidance
  if (strategy?.tone?.guidance) {
    watchouts.push({
      category: 'Tone & positioning',
      text: strategy.tone.guidance,
      tone: 'teal',
    });
  } else if (entry.record.reason_for_relevance) {
    watchouts.push({
      category: 'Best angle to lead with',
      text: entry.record.reason_for_relevance,
      tone: 'teal',
    });
  }

  return { bestContact, watchouts: watchouts.slice(0, 5) };
}

export type TabId = 'all' | 'needs_review' | 'shortlisted' | 'sent' | 'enrichment_requested' | 'rejected';
type SortOrder = 'newest' | 'verified' | 'name';

interface FilterState {
  entityKind: 'all' | 'person' | 'organisation';
  targetId: string | null;
  runDate: string | null;
  location: string | null;
  verifiedOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  entityKind: 'all',
  targetId: null,
  runDate: null,
  location: null,
  verifiedOnly: false,
};

function sentStorageKey(projectId: string) {
  return `marcom_sent_records_${projectId}`;
}

export default function ProspectsView({ initialTab }: { initialTab?: TabId } = {}) {
  return (
    <ProjectGate>
      <ProspectsBody initialTab={initialTab} />
    </ProjectGate>
  );
}

function ProspectsBody({ initialTab }: { initialTab?: TabId }) {
  const {
    bundle,
    activeProject,
    reload,
    updateDraft,
    updateResearchReview,
    setSettings,
    openResearch,
    startResearch,
    globalSearch,
    setGlobalSearch,
    isGuest,
    guestQuota,
  } = useWorkspace();

  const [tab, setTab] = useState<TabId>(initialTab ?? 'all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [researchConfigOpen, setResearchConfigOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configureQueueIds, setConfigureQueueIds] = useState<string[]>([]);
  const [configureFocusTick, setConfigureFocusTick] = useState(0);
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [sentIds, setSentIds] = useState<Record<string, boolean>>({});
  const [personalisingIds, setPersonalisingIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<{ recordId: string; channel?: DraftChannel } | null>(null);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [notionUrl, setNotionUrl] = useState<string | null>(null);
  const [notionProspectPageIds, setNotionProspectPageIds] = useState<Record<string, string>>({});
  const [notionNotice, setNotionNotice] = useState<{
    tone: 'info' | 'error';
    text: string;
  } | null>(null);

  const projectId = bundle?.projectId ?? '';

  useEffect(() => {
    if (!projectId) {
      setNotionUrl(null);
      setNotionProspectPageIds({});
      setNotionNotice(null);
      return;
    }
    let cancelled = false;
    setNotionUrl(null);
    setNotionProspectPageIds({});
    setNotionNotice(null);

    authenticatedFetch(`/api/projects/${projectId}/notion/sync`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data?.sync?.campaignPageUrl) {
          setNotionUrl(data.sync.campaignPageUrl);
        }
        if (data?.sync?.prospectPageIds && typeof data.sync.prospectPageIds === 'object') {
          setNotionProspectPageIds(data.sync.prospectPageIds);
        }
      })
      .catch(() => {
        // Ignore background sync status check errors
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleSyncToNotion = async () => {
    if (!projectId || syncingNotion) return;
    setSyncingNotion(true);
    setNotionNotice(null);
    try {
      const res = await authenticatedFetch(`/api/projects/${projectId}/notion/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: bundle?.project.structured_brief ?? null,
          prospects: bundle?.research ?? [],
          drafts: bundle?.drafts ?? [],
          settings: bundle?.settings ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const resolvedUrl: string | null = data.url || data.campaignPageUrl || null;
      if (resolvedUrl) {
        setNotionUrl(resolvedUrl);
      }
      if (data.prospectPageIds && typeof data.prospectPageIds === 'object') {
        setNotionProspectPageIds(data.prospectPageIds);
      }

      if (!res.ok) {
        const errorText: string =
          data.error || data.detail || data.title || 'Failed to sync campaign to Notion.';
        if (
          errorText.toLowerCase().includes('not connected') ||
          errorText.toLowerCase().includes('integrations')
        ) {
          setNotionNotice({
            tone: 'error',
            text: 'Notion is not connected. Connect your workspace in Settings > Integrations.',
          });
        } else {
          setNotionNotice({
            tone: 'error',
            text: errorText,
          });
        }
        return;
      }

      const count: number =
        typeof data.syncedCount === 'number'
          ? data.syncedCount
          : typeof data.prospectsSynced === 'number'
            ? data.prospectsSynced
            : bundle?.research.length ?? 0;

      if (data.failedCount > 0) {
        setNotionNotice({
          tone: 'error',
          text: `Synced ${count} ${count === 1 ? 'prospect' : 'prospects'} to Notion, with ${data.failedCount} ${data.failedCount === 1 ? 'warning' : 'warnings'}: ${data.errors?.[0] || 'Check Notion page permissions.'}`,
        });
      } else if (data.isResync) {
        setNotionNotice({
          tone: 'info',
          text: `Updated Notion Campaign Hub — ${count} ${count === 1 ? 'prospect' : 'prospects'} synced (${data.createdCount ?? 0} added, ${data.updatedCount ?? 0} updated).`,
        });
      } else {
        setNotionNotice({
          tone: 'info',
          text: `Synced Campaign Hub and ${count} ${count === 1 ? 'prospect' : 'prospects'} to Notion!`,
        });
      }
    } catch (err) {
      setNotionNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Network error during Notion sync.',
      });
    } finally {
      setSyncingNotion(false);
    }
  };

  // Load persisted sent records for this project
  useEffect(() => {
    if (!projectId) return;
    try {
      const raw = window.localStorage.getItem(sentStorageKey(projectId));
      if (raw) setSentIds(JSON.parse(raw));
      else setSentIds({});
    } catch {
      setSentIds({});
    }
  }, [projectId]);

  const toggleSent = (recordId: string, forceValue?: boolean) => {
    if (!projectId) return;
    const currentlySent = Boolean(sentIds[recordId]);
    const nextValue = forceValue !== undefined ? forceValue : !currentlySent;
    setSentIds((current) => {
      const next = { ...current, [recordId]: nextValue };
      if (!nextValue) delete next[recordId];
      try {
        window.localStorage.setItem(sentStorageKey(projectId), JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
    setActionNotice(
      nextValue
        ? 'Marked outreach as sent and moved lead to the Sent tab.'
        : 'Moved lead back to the Personalized tab.',
    );
  };

  const markLeadsSent = (recordIds: string[], nextValue = true) => {
    if (!projectId || recordIds.length === 0) return;
    setSentIds((current) => {
      const next = { ...current };
      for (const id of recordIds) {
        if (nextValue) {
          next[id] = true;
        } else {
          delete next[id];
        }
      }
      try {
        window.localStorage.setItem(sentStorageKey(projectId), JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
    setCheckedIds({});
    setActionNotice(
      nextValue
        ? `Marked ${plural(recordIds.length, 'lead')} as sent and moved ${recordIds.length === 1 ? 'it' : 'them'} to the Sent tab.`
        : `Moved ${plural(recordIds.length, 'lead')} back to the Personalized tab.`,
    );
  };

  // Sync URL query params (?tab=personalized, ?id=..., ?settings=1) on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'personalized' || tabParam === 'personalised' || tabParam === 'approved' || tabParam === 'shortlisted') setTab('shortlisted');
    else if (tabParam === 'review' || tabParam === 'needs_review') setTab('needs_review');
    else if (tabParam === 'sent') setTab('sent');
    else if (tabParam === 'more' || tabParam === 'enrichment_requested') setTab('enrichment_requested');
    else if (tabParam === 'rejected') setTab('rejected');
    const idParam = params.get('id') || params.get('prospect');
    if (idParam) setSelectedId(idParam);
    if (params.get('settings') === '1') setSettingsOpen(true);
  }, []);

  if (!bundle) return null;
  const { project, research, drafts, settings } = bundle;
  const brief = project.structured_brief;
  const title = brief?.project.name || project.name || activeProject?.name || 'Untitled project';

  if (research.length === 0) {
    return (
      <PageFrame>
        <div className="my-8 flex flex-col items-center justify-center gap-4 rounded-3xl border border-[#2A2F39] bg-[#171A20] p-12 text-center shadow-xl">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#2E6B75] bg-[#12313A] text-[#5ED3DF]">
            <Icon name="search" size={26} stroke={2} />
          </div>
          <h2 className="m-0 font-serif text-[28px] font-semibold text-[#F1F2F4]">
            Research Required First
          </h2>
          <p className="m-0 max-w-md text-sm leading-relaxed text-[#A7ADB8]">
            You haven&apos;t researched prospects for this campaign yet. Run the Research Agent to discover verified people and organisations matching your brief before viewing prospects.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => openResearch()}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#5ED3DF] px-5 text-sm font-semibold text-[#0E1014] transition hover:opacity-95"
            >
              <Icon name="search" size={16} stroke={2.4} />
              Run Research Agent
            </button>
            <Link
              href="/"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] px-4 text-sm font-semibold text-[#F1F2F4] transition hover:border-[#3A3F4A]"
            >
              Back to Today
            </Link>
          </div>
        </div>
      </PageFrame>
    );
  }

  const draftByRecordId = useMemo(() => {
    const map = new Map<string, PersonalizationEntry>();
    for (const item of drafts) map.set(item.record_id, item);
    for (const entry of research) {
      const id = entry.record.record_id;
      const existing = map.get(id);
      if (reviewStatus(entry) === 'shortlisted' && (!existing || !existing.copy)) {
        map.set(id, buildClientFallbackDraft(projectId, entry, brief, settings, existing));
      }
    }
    return map;
  }, [drafts, research, projectId, brief, settings]);

  const researchByRecordId = useMemo(() => {
    const map = new Map<string, ResearchEntry>();
    for (const item of research) map.set(item.record.record_id, item);
    return map;
  }, [research]);

  // Precompute per-row metadata once so switching status tabs and sorting is instantaneous
  const rowMetaById = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        status: ReviewStatus;
        verification: ReturnType<typeof verificationOf>;
        contactSummaryText: string;
        locationText: string;
        locationHaystack: string;
        shortResearchedDate: string;
        entityLabel: string;
        searchHaystack: string;
      }
    >();
    for (const entry of research) {
      const id = entry.record.record_id;
      const name = prospectName(entry);
      const status = reviewStatus(entry);
      const verification = verificationOf(entry);
      const contactSummaryText = contactSummary(entry);
      const locationText = locationOf(entry) || '—';
      const locationHaystack = `${entry.record.location ?? ''} ${entry.record.country ?? ''}`.toLowerCase();
      const shortResearchedDate = shortDate(entry.record.researched_at);
      const entityLabel =
        entry.record.identity.entity_kind === 'person'
          ? 'Person'
          : entry.record.identity.entity_kind === 'organisation'
            ? 'Organisation'
            : '—';
      const searchHaystack = `${name} ${entry.record.summary ?? ''} ${locationText} ${entry.record.target_type ?? ''} ${entry.record.organisation ?? ''}`.toLowerCase();
      map.set(id, {
        name,
        status,
        verification,
        contactSummaryText,
        locationText,
        locationHaystack,
        shortResearchedDate,
        entityLabel,
        searchHaystack,
      });
    }
    return map;
  }, [research]);

  // Distinct research dates and locations for the Filters dialog
  const runDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of research) {
      const label = rowMetaById.get(entry.record.record_id)?.shortResearchedDate ?? shortDate(entry.record.researched_at);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [research, rowMetaById]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const entry of research) {
      const loc = entry.record.country || entry.record.location;
      if (loc) set.add(loc);
    }
    return [...set];
  }, [research]);

  // Counts per status tab (Sent is a distinct stage after Personalized)
  const counts = useMemo(() => {
    const map: Record<TabId, number> = {
      all: research.length,
      needs_review: 0,
      shortlisted: 0,
      sent: 0,
      enrichment_requested: 0,
      rejected: 0,
    };
    for (const entry of research) {
      const id = entry.record.record_id;
      const status = rowMetaById.get(id)?.status ?? reviewStatus(entry);
      const isSent = Boolean(sentIds[id] || entry.relationship_status === 'contacted');
      if (isSent) {
        map.sent += 1;
      } else {
        map[status] = (map[status] ?? 0) + 1;
      }
    }
    return map;
  }, [research, sentIds, rowMetaById]);

  const approvedEntries = useMemo(
    () =>
      research.filter(
        (entry) =>
          (rowMetaById.get(entry.record.record_id)?.status ?? reviewStatus(entry)) === 'shortlisted' &&
          !sentIds[entry.record.record_id] &&
          entry.relationship_status !== 'contacted',
      ),
    [research, sentIds, rowMetaById],
  );

  const readyDraftEntries = useMemo(
    () =>
      approvedEntries.filter((entry) => {
        const draft = draftByRecordId.get(entry.record.record_id);
        return Boolean(draft?.copy);
      }),
    [approvedEntries, draftByRecordId],
  );

  const unpersonalisedApprovedIds = useMemo(
    () =>
      approvedEntries
        .filter((entry) => !draftByRecordId.get(entry.record.record_id)?.copy)
        .map((entry) => entry.record.record_id),
    [approvedEntries, draftByRecordId],
  );

  const effectiveQuery = (search || globalSearch).trim().toLowerCase();

  const matchesFilters = (entry: ResearchEntry, state: FilterState): boolean => {
    const meta = rowMetaById.get(entry.record.record_id);
    if (state.entityKind !== 'all' && entry.record.identity.entity_kind !== state.entityKind) return false;
    if (state.targetId) {
      const target = targetFor(brief, entry);
      if (target?.id !== state.targetId && entry.record.brief_target_id !== state.targetId) return false;
    }
    if (state.runDate && (meta?.shortResearchedDate ?? shortDate(entry.record.researched_at)) !== state.runDate) return false;
    if (state.location) {
      const loc = meta?.locationHaystack ?? `${entry.record.location ?? ''} ${entry.record.country ?? ''}`.toLowerCase();
      if (!loc.includes(state.location.toLowerCase())) return false;
    }
    if (state.verifiedOnly && (meta?.verification.state ?? verificationOf(entry).state) === 'unverified') return false;
    return true;
  };

  const visible = useMemo(() => {
    const filtered = research.filter((entry) => {
      const id = entry.record.record_id;
      const meta = rowMetaById.get(id);
      const status = meta?.status ?? reviewStatus(entry);
      const isSent = Boolean(sentIds[id] || entry.relationship_status === 'contacted');
      if (tab === 'sent') {
        if (!isSent) return false;
      } else if (tab !== 'all') {
        if (isSent || status !== tab) return false;
      }
      if (!matchesFilters(entry, filters)) return false;
      if (effectiveQuery) {
        const hay = meta?.searchHaystack ?? `${prospectName(entry)} ${entry.record.summary ?? ''}`.toLowerCase();
        if (!hay.includes(effectiveQuery)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const metaA = rowMetaById.get(a.record.record_id);
      const metaB = rowMetaById.get(b.record.record_id);
      if (sort === 'name') return (metaA?.name ?? prospectName(a)).localeCompare(metaB?.name ?? prospectName(b));
      if (sort === 'verified') {
        const rank = { verified: 0, partial: 1, unverified: 2 };
        const diff =
          rank[metaA?.verification.state ?? verificationOf(a).state] -
          rank[metaB?.verification.state ?? verificationOf(b).state];
        if (diff !== 0) return diff;
      }
      return (b.record.researched_at || '').localeCompare(a.record.researched_at || '');
    });
  }, [research, tab, filters, effectiveQuery, sort, brief, sentIds, rowMetaById]);

  const selectedEntry = useMemo(
    () => (selectedId ? research.find((entry) => entry.record.record_id === selectedId) ?? null : null),
    [research, selectedId],
  );
  const hasPanel = Boolean(selectedEntry);

  const selectedVisibleIds = useMemo(
    () => visible.filter((entry) => checkedIds[entry.record.record_id]).map((entry) => entry.record.record_id),
    [visible, checkedIds],
  );
  const allVisibleChecked = visible.length > 0 && selectedVisibleIds.length === visible.length;

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (filters.entityKind !== 'all') {
      chips.push({
        key: 'entityKind',
        label: `Type: ${filters.entityKind === 'person' ? 'People' : 'Organisations'}`,
        clear: () => setFilters((f) => ({ ...f, entityKind: 'all' })),
      });
    }
    if (filters.targetId) {
      const target = brief?.targets.find((item) => item.id === filters.targetId);
      chips.push({
        key: 'targetId',
        label: `Audience: ${target?.target_type ?? 'Selected'}`,
        clear: () => setFilters((f) => ({ ...f, targetId: null })),
      });
    }
    if (filters.runDate) {
      chips.push({
        key: 'runDate',
        label: `Run: ${filters.runDate}`,
        clear: () => setFilters((f) => ({ ...f, runDate: null })),
      });
    }
    if (filters.location) {
      chips.push({
        key: 'location',
        label: `Location: ${filters.location}`,
        clear: () => setFilters((f) => ({ ...f, location: null })),
      });
    }
    if (filters.verifiedOnly) {
      chips.push({
        key: 'verifiedOnly',
        label: 'Verified evidence only',
        clear: () => setFilters((f) => ({ ...f, verifiedOnly: false })),
      });
    }
    if (globalSearch.trim()) {
      chips.push({
        key: 'globalSearch',
        label: `Search: "${globalSearch.trim()}"`,
        clear: () => setGlobalSearch(''),
      });
    }
    return chips;
  }, [filters, brief, globalSearch, setGlobalSearch]);

  const personalising = personalisingIds.length > 0;

  const openPersonalizationConfig = (recordIds: string[]) => {
    if (!recordIds.length) return;
    setConfigureQueueIds(recordIds);
    setSelectedId(recordIds[0]!);
    setConfigureFocusTick((t) => t + 1);
  };

  const approveAndPersonalise = async (
    recordIds: string[],
    openDrawerAfter = false,
    customLeadSettings?: LeadPersonalizationSettings,
  ) => {
    if (!recordIds.length || personalising) return;
    if (isGuest && guestQuota) {
      if (guestQuota.personalization.isExhausted) {
        setActionError(
          guestQuota.personalization.limitMessage ||
            'Guest personalisation limit reached (2 leads/day, 5 leads/month).',
        );
        return;
      }
      if (recordIds.length > guestQuota.personalization.effectiveRemaining) {
        setActionError(
          `You have ${guestQuota.personalization.effectiveRemaining} guest personalisation credit${guestQuota.personalization.effectiveRemaining === 1 ? '' : 's'} remaining (${guestQuota.personalization.dailyRemaining}/${guestQuota.personalization.dailyLimit} today · ${guestQuota.personalization.monthlyRemaining}/${guestQuota.personalization.monthlyLimit} this month). Select up to ${guestQuota.personalization.effectiveRemaining} lead${guestQuota.personalization.effectiveRemaining === 1 ? '' : 's'}.`,
        );
        return;
      }
    }
    setPersonalisingIds(recordIds);
    setActionError(null);
    setActionNotice(null);
    try {
      const singleId = recordIds[0]!;
      const singleEntry = researchByRecordId.get(singleId);
      const resolvedSingleLeadSettings =
        customLeadSettings ??
        settings?.lead_settings?.[singleId] ??
        draftByRecordId.get(singleId)?.lead_settings ??
        (singleEntry ? defaultLeadPersonalizationSettings(singleEntry.record) : undefined);

      const batchLeadSettingsByRecordId: Record<string, LeadPersonalizationSettings> = {
        ...(settings?.lead_settings ?? {}),
      };
      for (const id of recordIds) {
        const entry = researchByRecordId.get(id);
        const existingCfg =
          (id === singleId ? customLeadSettings : undefined) ??
          batchLeadSettingsByRecordId[id] ??
          draftByRecordId.get(id)?.lead_settings ??
          (entry ? defaultLeadPersonalizationSettings(entry.record) : undefined);
        if (existingCfg) {
          batchLeadSettingsByRecordId[id] = existingCfg;
        }
      }

      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          recordIds.length === 1
            ? {
                recordId: singleId,
                force: true,
                ...(resolvedSingleLeadSettings ? { leadSettings: resolvedSingleLeadSettings } : {}),
              }
            : {
                recordIds,
                force: true,
                leadSettingsByRecordId: batchLeadSettingsByRecordId,
              },
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.detail || (response.status === 504 ? 'Personalisation timed out on the server. Please try again.' : 'Personalisation could not be completed.'));
      if (data.settings) {
        setSettings(data.settings as PersonalizationSettings);
      }
      if (data.notionSync?.campaignPageUrl) {
        setNotionUrl(data.notionSync.campaignPageUrl);
      }
      if (data.notionSync?.prospectPageIds && typeof data.notionSync.prospectPageIds === 'object') {
        setNotionProspectPageIds((prev) => ({
          ...prev,
          ...data.notionSync.prospectPageIds,
        }));
      }

      const returnedItems: PersonalizationEntry[] = Array.isArray(data.items)
        ? data.items
        : data.entry
          ? [data.entry]
          : [];
      for (const id of recordIds) {
        const entry = researchByRecordId.get(id);
        updateResearchReview(id, 'shortlisted', entry?.review?.note ?? null);
      }
      for (const item of returnedItems) {
        updateDraft(item);
      }

      const remainingQueue = configureQueueIds.filter((qId) => !recordIds.includes(qId));
      setConfigureQueueIds(remainingQueue);
      void reload();

      const syncedNote = data.notionSync?.synced ? ' Synced to Notion.' : '';
      if (remainingQueue.length > 0) {
        const nextLeadId = remainingQueue[0]!;
        setSelectedId(nextLeadId);
        setConfigureFocusTick((t) => t + 1);
        setActionNotice(
          `Personalized ${plural(returnedItems.length || recordIds.length, 'lead')}.${syncedNote} Now configuring personalization settings for the next lead (${remainingQueue.length} remaining).`,
        );
      } else {
        setCheckedIds({});
        setTab('shortlisted');
        const firstReady = returnedItems.find((item) => item.copy) ?? returnedItems[0];
        if (openDrawerAfter && firstReady) {
          setSelectedId(firstReady.record_id);
          if (data.notionSync?.synced) {
            setActionNotice('Personalized outreach generated across all 5 channels and synced to Notion.');
          }
        } else if (returnedItems.length > 0) {
          setActionNotice(
            `Personalized ${plural(returnedItems.length, 'lead')} across all 5 channels and moved ${returnedItems.length === 1 ? 'it' : 'them'} to the Personalized tab.${syncedNote}`,
          );
          if (firstReady) {
            setSelectedId(firstReady.record_id);
          }
        }
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPersonalisingIds([]);
    }
  };

  const tabDefs: Array<{ id: TabId; label: string; dot?: boolean }> = [
    { id: 'all', label: `All · ${counts.all}` },
    { id: 'needs_review', label: `To review · ${counts.needs_review}` },
    { id: 'shortlisted', label: `Personalized · ${counts.shortlisted}`, dot: true },
    { id: 'sent', label: `Sent · ${counts.sent}` },
    { id: 'enrichment_requested', label: `More research · ${counts.enrichment_requested}` },
    { id: 'rejected', label: `Rejected · ${counts.rejected}` },
  ];

  const isApprovedTab = tab === 'shortlisted';
  const showDualBanners = tab === 'all' && (counts.needs_review > 0 || counts.shortlisted > 0);

  const handleQuickReview = () => {
    const firstInVisible = visible.find((entry) => reviewStatus(entry) === 'needs_review');
    if (firstInVisible) {
      setSelectedId(firstInVisible.record.record_id);
      return;
    }
    const firstInAll = research.find((entry) => reviewStatus(entry) === 'needs_review');
    if (firstInAll) {
      setTab('needs_review');
      setSelectedId(firstInAll.record.record_id);
    }
  };

  const handleViewDraftsBanner = () => {
    setTab('shortlisted');
    const firstWithDraft =
      visible.find((entry) => reviewStatus(entry) === 'shortlisted' && draftByRecordId.get(entry.record.record_id)?.copy) ??
      readyDraftEntries[0] ??
      approvedEntries[0];
    if (firstWithDraft) {
      setSelectedId(firstWithDraft.record.record_id);
      return;
    }
  };

  const handleRunResearchForLead = async (entry: ResearchEntry, instructions?: string) => {
    const leadName = prospectName(entry);
    const target = targetFor(brief, entry);
    setActionNotice(`Starting research for ${leadName}…`);
    try {
      await startResearch({
        targetId: entry.record.brief_target_id || target?.id || 'target-1',
        targetLabel: entry.record.target_type || 'Prospect',
        count: 1,
        name: leadName,
        force: true,
        notes: instructions || entry.review?.note || undefined,
        organisation: entry.record.organisation || undefined,
        role: entry.record.role || undefined,
        website: entry.record.websites?.[0]?.url || entry.seed.website || undefined,
      });
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const cycleTypeFilter = () => {
    setFilters((curr) => ({
      ...curr,
      entityKind: curr.entityKind === 'all' ? 'person' : curr.entityKind === 'person' ? 'organisation' : 'all',
    }));
  };

  const cycleLocationFilter = () => {
    if (locations.length === 0) {
      setFiltersOpen(true);
      return;
    }
    setFilters((curr) => {
      if (!curr.location) return { ...curr, location: locations[0]! };
      const idx = locations.indexOf(curr.location);
      if (idx >= 0 && idx < locations.length - 1) return { ...curr, location: locations[idx + 1]! };
      return { ...curr, location: null };
    });
  };

  const toggleEvidenceFilter = () => {
    setFilters((curr) => ({ ...curr, verifiedOnly: !curr.verifiedOnly }));
  };

  const cycleStatusTab = () => {
    const order: TabId[] = ['all', 'needs_review', 'shortlisted', 'sent', 'enrichment_requested', 'rejected'];
    const idx = order.indexOf(tab);
    setTab(order[(idx + 1) % order.length]!);
  };

  const activeDrawerDraft = drawerState ? draftByRecordId.get(drawerState.recordId) ?? null : null;
  const activeDrawerResearch = drawerState ? researchByRecordId.get(drawerState.recordId) ?? null : null;

  return (
    <div className="relative flex min-w-0 flex-1">
      <div className="min-w-0 flex-1">
        <PageFrame className="max-w-[1400px] gap-5">
          <header className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className={`${serif} m-0 text-[32px]`}>Prospects</h1>
                {isGuest && guestQuota && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      guestQuota.personalization.isExhausted
                        ? 'border-[#5A2D29] bg-[#2A1715] text-[#F7B1AA]'
                        : 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE]'
                    }`}
                    title="Guest personalisation credits (2 daily / 5 monthly)"
                  >
                    Personalisation credits: {guestQuota.personalization.dailyRemaining}/
                    {guestQuota.personalization.dailyLimit} today ·{' '}
                    {guestQuota.personalization.monthlyRemaining}/
                    {guestQuota.personalization.monthlyLimit} month
                  </span>
                )}
              </div>
              <p className="m-0 text-sm text-[#A7ADB8]">{title}</p>
            </div>
            {tab === 'shortlisted' || tab === 'sent' ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className={`${btnSecondary} h-11 px-4 text-[13px]`}
              >
                <Icon name="settings" size={15} /> Sender details
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setResearchConfigOpen(true)}
                className={`${btnSecondary} h-11 px-4 text-[13px]`}
              >
                <Icon name="settings" size={15} /> Research configuration
              </button>
            )}
            {notionUrl && (
              <a
                href={notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${btnSecondary} h-11 px-4 text-[13px] inline-flex items-center gap-2`}
                title="Open Campaign Hub and Prospects in Notion"
              >
                <Icon name="external" size={15} /> Open in Notion
              </a>
            )}
            <button
              type="button"
              onClick={handleSyncToNotion}
              disabled={syncingNotion}
              className={`${btnSecondary} h-11 px-4 text-[13px] inline-flex items-center gap-2`}
              title={
                notionUrl
                  ? 'Push latest prospects, reviews, and outreach drafts to Notion'
                  : 'Sync Campaign Brief, Prospect Database, and Outreach Drafts to Notion'
              }
            >
              {syncingNotion ? (
                <Spinner size={15} />
              ) : (
                <Icon name={notionUrl ? 'refresh' : 'plug'} size={15} />
              )}
              {syncingNotion
                ? 'Syncing to Notion…'
                : notionUrl
                  ? 'Re-sync Notion'
                  : 'Sync to Notion'}
            </button>
            <button type="button" onClick={() => openResearch()} className={`${btnPrimary} h-11 px-[18px]`}>
              <Icon name="plus" size={16} stroke={2.2} /> Find more prospects
            </button>
          </header>

          {/* Status tabs */}
          <div role="tablist" aria-label="Status" className="flex flex-wrap gap-2">
            {tabDefs.map((item) => {
              const on = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(item.id)}
                  className={`inline-flex h-[38px] items-center gap-[7px] rounded-full border px-4 text-[13px] transition-colors ${
                    on
                      ? 'border-[#F1F2F4] bg-[#F1F2F4] font-semibold text-[#0E1014]'
                      : 'border-[#2A2F39] bg-[#171A20] font-medium text-[#F1F2F4] hover:border-[#3A3F4A]'
                  }`}
                >
                  {item.dot && <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[#5BD69A]" />}
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Search + Filters + Sort */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-11 flex-[1_1_260px] items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] px-3.5 text-[#8A909C] focus-within:border-[#2E6B75]">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or bio"
                aria-label="Search prospects"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#F1F2F4] outline-none placeholder:text-[#8A909C]"
              />
            </label>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] px-4 text-sm font-semibold text-[#F1F2F4] hover:border-[#3A3F4A]"
            >
              <Icon name="filter" size={16} />
              Filters
              {activeFilterChips.length > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#5ED3DF] px-1 text-[11px] font-bold text-[#0E1014]">
                  {activeFilterChips.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                setSort((current) => (current === 'newest' ? 'verified' : current === 'verified' ? 'name' : 'newest'))
              }
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] pl-4 pr-3.5 text-sm font-medium text-[#F1F2F4] hover:border-[#3A3F4A]"
            >
              {sort === 'newest' ? 'Newest first' : sort === 'verified' ? 'Verified first' : 'Name A–Z'}
              <Icon name="chevronDown" size={16} className="text-[#A7ADB8]" />
            </button>
          </div>

          {/* Active filter chips */}
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {activeFilterChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-[#12313A] pl-2.5 pr-1.5 text-[#9BE6EE]"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`Remove ${chip.label} filter`}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded text-[#9BE6EE] hover:bg-[#1E4A52]"
                  >
                    <Icon name="close" size={12} stroke={2.6} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setSearch('');
                  setGlobalSearch('');
                }}
                className="h-[30px] px-2 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Side-by-side summary action banners */}
          {showDualBanners && (
            <div className="grid gap-3 md:grid-cols-2">
              {/* Amber Review Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#4A3B17] bg-[#1F1A10] py-3 pl-4 pr-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#F2C36B]" />
                  <span className="truncate text-sm text-[#E5D3A8]">
                    <span className="font-semibold text-[#F2C36B]">{counts.needs_review} to review</span> · Select leads to personalize, reject or research
                  </span>
                </div>
                <button
                  type="button"
                  disabled={counts.needs_review === 0}
                  onClick={handleQuickReview}
                  className="h-9 shrink-0 rounded-[10px] bg-[#F2C36B] px-3.5 text-[13px] font-semibold text-[#0E1014] transition hover:opacity-95 disabled:opacity-40"
                >
                  Quick review
                </button>
              </div>

              {/* Green Personalized & Drafts Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#1F4A33] bg-[#10261B] py-3 pl-4 pr-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#5BD69A]" />
                  <span className="truncate text-sm text-[#B7D9C6]">
                    <span className="font-semibold text-[#8EE6B6]">
                      {counts.shortlisted} personalized · drafts ready
                    </span>
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={counts.shortlisted === 0 || personalising}
                    onClick={handleViewDraftsBanner}
                    className="h-9 shrink-0 rounded-[10px] border border-[#2F6B4B] bg-transparent px-3.5 text-[13px] font-semibold text-[#8EE6B6] transition hover:bg-[#153324] disabled:opacity-40"
                  >
                    View personalized
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Banner for More Research Tab */}
          {tab === 'enrichment_requested' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#2E6B75] bg-[#12313A] py-3 pl-4 pr-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Icon name="search" size={17} className="text-[#5ED3DF]" />
                <span className="text-sm text-[#B5D9DE]">
                  <strong className="text-[#F1F2F4]">{counts.enrichment_requested} {counts.enrichment_requested === 1 ? 'lead' : 'leads'} flagged for more research.</strong> Click any lead to see instructions or run live research.
                </span>
              </div>
            </div>
          )}

          {/* Banner for Rejected Tab */}
          {tab === 'rejected' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#5A3A38] bg-[#1C1517] py-3 pl-4 pr-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Icon name="x" size={17} className="text-[#F28B82]" />
                <span className="text-sm text-[#E5B5B2]">
                  <strong className="text-[#F1F2F4]">{counts.rejected} {counts.rejected === 1 ? 'lead' : 'leads'} rejected.</strong> These leads are kept on record with your notes and excluded from outreach.
                </span>
              </div>
            </div>
          )}

          {/* Direct batch action bar whenever rows are checked */}
          {selectedVisibleIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-2xl border border-[#2E6B75] bg-[#112229] px-4 py-3">
              <div className="flex flex-[1_1_280px] flex-col gap-0.5">
                <span className="text-sm font-semibold text-[#F1F2F4]">
                  {plural(selectedVisibleIds.length, 'lead')} selected
                </span>
                <span className="text-xs text-[#9BC4CA]">
                  {tab === 'shortlisted'
                    ? `Mark selected leads as sent once you've sent their outreach to move ${selectedVisibleIds.length === 1 ? 'it' : 'them'} into the Sent tab.`
                    : tab === 'sent'
                      ? `Move selected leads back to the Personalized tab if outreach has not been sent yet.`
                      : `Personalize writes 5-channel outreach drafts and moves ${selectedVisibleIds.length === 1 ? 'it' : 'them'} to Personalized, or mark already-personalized leads as Sent.`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCheckedIds({})}
                  className="h-9 rounded-xl border border-[#2E6B75] bg-transparent px-3 text-xs font-semibold text-[#B5D9DE] hover:bg-[#163039]"
                >
                  Clear
                </button>
                {tab === 'sent' ? (
                  <button
                    type="button"
                    onClick={() => markLeadsSent(selectedVisibleIds, false)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#2E6B75] bg-[#12313A] px-4 text-[13px] font-semibold text-[#9BE6EE] transition hover:bg-[#183D48]"
                  >
                    <Icon name="arrowLeft" size={14} />
                    Move {selectedVisibleIds.length} back to Personalized
                  </button>
                ) : tab === 'shortlisted' ? (
                  <button
                    type="button"
                    onClick={() => markLeadsSent(selectedVisibleIds, true)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5ED3DF] px-4 text-[13px] font-semibold text-[#0E1014] transition hover:opacity-95"
                  >
                    <Icon name="check" size={15} stroke={2.6} />
                    Mark {selectedVisibleIds.length} as sent
                  </button>
                ) : (
                  <>
                    {selectedVisibleIds.some((id) => {
                      const entry = researchByRecordId.get(id);
                      return entry && reviewStatus(entry) === 'shortlisted' && !sentIds[id];
                    }) && (
                      <button
                        type="button"
                        onClick={() => markLeadsSent(selectedVisibleIds, true)}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#2E6B75] bg-[#12313A] px-3.5 text-xs font-semibold text-[#9BE6EE] transition hover:bg-[#183D48]"
                      >
                        <Icon name="check" size={14} stroke={2.5} />
                        Mark {selectedVisibleIds.length} as sent
                      </button>
                    )}
                    {(() => {
                      const unpersonalizedSelectedIds = selectedVisibleIds.filter((id) => {
                        const entry = researchByRecordId.get(id);
                        return entry && reviewStatus(entry) !== 'shortlisted' && !sentIds[id];
                      });
                      if (unpersonalizedSelectedIds.length === 0) return null;
                      return (
                        <button
                          type="button"
                          disabled={personalising}
                          onClick={() =>
                            void approveAndPersonalise(
                              unpersonalizedSelectedIds,
                              unpersonalizedSelectedIds.length === 1,
                            )
                          }
                          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5BD69A] px-4 text-[13px] font-semibold text-[#0E1014] transition hover:opacity-95 disabled:opacity-50"
                        >
                          {personalising ? <Spinner size={14} /> : <Icon name="sparkle" size={15} />}
                          {personalising ? 'Personalizing…' : `Personalize ${unpersonalizedSelectedIds.length}`}
                        </button>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          )}

          {actionNotice && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1F4A33] bg-[#10261B] px-4 py-3 text-sm text-[#B7D9C6]">
              <span>{actionNotice}</span>
              <div className="flex items-center gap-3">
                {actionNotice.includes('Sent tab') && tab !== 'sent' && (
                  <button
                    type="button"
                    onClick={() => {
                      setTab('sent');
                      setActionNotice(null);
                    }}
                    className="rounded-lg border border-[#2F6B4B] bg-[#153324] px-2.5 py-1 text-xs font-semibold text-[#8EE6B6] hover:bg-[#1B402D]"
                  >
                    View Sent tab →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActionNotice(null)}
                  className="text-xs font-semibold text-[#8EE6B6] hover:underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {notionNotice && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                notionNotice.tone === 'error'
                  ? 'border-[#5A2D29] bg-[#2A1715] text-[#F7B1AA]'
                  : 'border-[#2E6B75] bg-[#122A32] text-[#B5D9DE]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon
                  name={notionNotice.tone === 'error' ? 'warning' : 'plug'}
                  size={16}
                  className={notionNotice.tone === 'error' ? 'text-[#F28B82]' : 'text-[#5ED3DF]'}
                />
                <span>{notionNotice.text}</span>
              </div>
              <div className="flex items-center gap-3">
                {notionUrl && (
                  <a
                    href={notionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#3E8B98] bg-[#1A3D48] px-2.5 py-1 text-xs font-semibold text-[#5ED3DF] hover:bg-[#23505F]"
                  >
                    <span>Open in Notion</span>
                    <Icon name="external" size={12} />
                  </a>
                )}
                {notionNotice.text.includes('Integrations') && (
                  <a
                    href="/integrations"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#3E8B98] bg-[#1A3D48] px-2.5 py-1 text-xs font-semibold text-[#5ED3DF] hover:bg-[#23505F]"
                  >
                    <span>Go to Integrations</span>
                    <Icon name="arrowRight" size={12} />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setNotionNotice(null)}
                  className="text-xs font-semibold opacity-80 hover:underline hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <p role="alert" className="m-0 rounded-xl border border-[#5A2D29] bg-[#2A1715] px-4 py-3 text-sm text-[#F7B1AA]">
              {actionError}
            </p>
          )}

          {/* Prospects table */}
          {visible.length === 0 ? (
            <EmptyState
              title={research.length === 0 ? 'No prospects found yet' : 'No prospects match these filters'}
              body={
                research.length === 0
                  ? 'Run the Research agent to find prospects that match your campaign brief.'
                  : 'Try clearing a filter or switching to the All tab.'
              }
              action={
                research.length === 0 ? (
                  <button type="button" onClick={() => openResearch()} className={btnPrimary}>
                    <Icon name="search" size={16} /> Run research
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTab('all');
                      setFilters(DEFAULT_FILTERS);
                      setSearch('');
                      setGlobalSearch('');
                    }}
                    className={btnSecondary}
                  >
                    Reset filters
                  </button>
                )
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-[18px] border border-[#2A2F39] bg-[#171A20]">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#A7ADB8]">
                      <th scope="col" className="w-10 border-b border-[#2A2F39] py-2 pl-3 pr-0">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={allVisibleChecked}
                          aria-label="Select all visible prospects"
                          onClick={() =>
                            setCheckedIds(
                              allVisibleChecked
                                ? {}
                                : Object.fromEntries(
                                    visible.map((entry) => [entry.record.record_id, true]),
                                  ),
                            )
                          }
                          className={`flex h-[20px] w-[20px] items-center justify-center rounded-[6px] border-[1.5px] p-0 text-[#0E1014] transition ${
                            allVisibleChecked ? 'border-[#5BD69A] bg-[#5BD69A]' : 'border-[#4A505C] bg-transparent hover:border-[#6C7382]'
                          }`}
                        >
                          {allVisibleChecked && <Icon name="check" size={12} stroke={3.2} />}
                        </button>
                      </th>
                      <th scope="col" className="border-b border-[#2A2F39] px-3 py-3 font-semibold">
                        Prospect
                      </th>
                      {!hasPanel && (
                        <th scope="col" className="whitespace-nowrap border-b border-[#2A2F39] px-2.5 py-3 font-semibold">
                          <button
                            type="button"
                            onClick={cycleTypeFilter}
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${
                              filters.entityKind !== 'all'
                                ? 'bg-[#12313A] text-[#9BE6EE]'
                                : 'text-[#A7ADB8] hover:text-[#F1F2F4]'
                            }`}
                          >
                            Type <Icon name="chevronDown" size={12} />
                          </button>
                        </th>
                      )}
                      <th scope="col" className="whitespace-nowrap border-b border-[#2A2F39] px-2.5 py-3 font-semibold">
                        <button
                          type="button"
                          onClick={cycleLocationFilter}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${
                            filters.location
                              ? 'bg-[#12313A] text-[#9BE6EE]'
                              : 'text-[#A7ADB8] hover:text-[#F1F2F4]'
                          }`}
                        >
                          Location <Icon name="chevronDown" size={12} />
                        </button>
                      </th>
                      <th scope="col" className="whitespace-nowrap border-b border-[#2A2F39] px-2.5 py-3 font-semibold">
                        <button
                          type="button"
                          onClick={toggleEvidenceFilter}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${
                            filters.verifiedOnly
                              ? 'bg-[#12313A] text-[#9BE6EE]'
                              : 'text-[#A7ADB8] hover:text-[#F1F2F4]'
                          }`}
                        >
                          Evidence <Icon name="chevronDown" size={12} />
                        </button>
                      </th>
                      {!hasPanel && (
                        <th scope="col" className="whitespace-nowrap border-b border-[#2A2F39] px-3.5 py-3 font-semibold">
                          Contact found
                        </th>
                      )}
                      <th scope="col" className="whitespace-nowrap border-b border-[#2A2F39] px-3.5 py-3 font-semibold">
                        <button
                          type="button"
                          onClick={cycleStatusTab}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${
                            tab !== 'all'
                              ? 'bg-[#12313A] text-[#9BE6EE]'
                              : 'text-[#A7ADB8] hover:text-[#F1F2F4]'
                          }`}
                        >
                          Status <Icon name="chevronDown" size={12} />
                        </button>
                      </th>
                      <th scope="col" className="w-[1%] whitespace-nowrap border-b border-[#2A2F39] py-3 pl-7 pr-4 text-right font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => {
                      const id = entry.record.record_id;
                      const meta = rowMetaById.get(id);
                      const name = meta?.name ?? prospectName(entry);
                      const status = meta?.status ?? reviewStatus(entry);
                      const isSent = Boolean(sentIds[id] || entry.relationship_status === 'contacted');
                      const statusMeta = isSent
                        ? { label: 'Sent', bg: '#12313A', fg: '#9BE6EE' }
                        : STATUS_META[status];
                      const verification = meta?.verification ?? verificationOf(entry);
                      const isSelected = selectedEntry?.record.record_id === id;
                      const checked = Boolean(checkedIds[id]);
                      const draft = draftByRecordId.get(id);
                      const isRowPersonalising = personalisingIds.includes(id);
                      const entityLabel = meta?.entityLabel ?? '—';
                      const locationLabel = meta?.locationText ?? (locationOf(entry) || '—');
                      const contactLabel = meta?.contactSummaryText ?? contactSummary(entry);
                      const researchedDateLabel = meta?.shortResearchedDate ?? shortDate(entry.record.researched_at);

                      return (
                        <tr
                          key={id}
                          onClick={() => setSelectedId(id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#1F232B]' : 'hover:bg-[#1B1F27]'
                          }`}
                        >
                          <td
                            onClick={(event) => event.stopPropagation()}
                            className="w-10 border-b border-[#22262E] pl-3 pr-0"
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              aria-label={`Select ${name}`}
                              onClick={() => setCheckedIds((curr) => ({ ...curr, [id]: !checked }))}
                              className={`flex h-[20px] w-[20px] items-center justify-center rounded-[6px] border-[1.5px] p-0 text-[#0E1014] transition ${
                                checked ? 'border-[#5BD69A] bg-[#5BD69A]' : 'border-[#4A505C] bg-transparent hover:border-[#6C7382]'
                              }`}
                            >
                              {checked && <Icon name="check" size={12} stroke={3.2} />}
                            </button>
                          </td>
                          <td
                            style={{ boxShadow: isSelected ? 'inset 3px 0 0 #5ED3DF' : 'none' }}
                            className="border-b border-[#22262E] px-3 py-3"
                          >
                            <div className="flex max-w-[240px] items-center gap-2.5 text-[#F1F2F4]">
                              <Initials name={name} size={34} />
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate font-semibold" title={name}>{name}</span>
                                <span className="truncate text-xs text-[#8A909C]">
                                  {researchedDateLabel ? `Found ${researchedDateLabel}` : entry.record.target_type}
                                </span>
                              </span>
                            </div>
                          </td>
                          {!hasPanel && (
                            <td className="whitespace-nowrap border-b border-[#22262E] px-2.5 py-3 text-[#C9CDD4]">
                              {entityLabel}
                            </td>
                          )}
                          <td className="border-b border-[#22262E] px-2.5 py-3 text-[#C9CDD4]">
                            <div className="max-w-[165px] truncate" title={locationLabel}>
                              {locationLabel}
                            </div>
                          </td>
                          <td
                            style={{ color: verification.color }}
                            className="whitespace-nowrap border-b border-[#22262E] px-2.5 py-3 font-medium"
                          >
                            {verification.label}
                          </td>
                          {!hasPanel && (
                            <td className="whitespace-nowrap border-b border-[#22262E] px-3.5 py-3 text-[#C9CDD4]">
                              <div className="max-w-[165px] truncate" title={contactLabel}>
                                {contactLabel}
                              </div>
                            </td>
                          )}
                          <td className="whitespace-nowrap border-b border-[#22262E] px-3.5 py-3">
                            <div className="flex items-center gap-1.5">
                              <Pill bg={statusMeta.bg} fg={statusMeta.fg}>
                                {statusMeta.label}
                              </Pill>
                              {draft?.status === 'approved' && (
                                <Pill bg="#26224A" fg="#CFC8FF">
                                  Draft approved
                                </Pill>
                              )}
                            </div>
                          </td>
                          <td
                            onClick={(event) => event.stopPropagation()}
                            className="w-[1%] whitespace-nowrap border-b border-[#22262E] py-3 pl-7 pr-4 text-right"
                          >
                            <div className="inline-flex items-center justify-end gap-2">
                              {status === 'shortlisted' || isSent || tab === 'shortlisted' || tab === 'sent' ? (
                                <>
                                  <button
                                    type="button"
                                    aria-label={isSent ? `Unmark ${name} as sent` : `Mark ${name} as sent`}
                                    title={isSent ? 'Move back to Personalized tab' : 'Mark outreach as sent and move to Sent tab'}
                                    onClick={() => toggleSent(id)}
                                    className={`inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[10px] border px-2.5 text-xs font-semibold transition ${
                                      isSent
                                        ? 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE] hover:bg-[#183D48]'
                                        : 'border-[#2E6B75] bg-[#112229] text-[#5ED3DF] hover:bg-[#163039]'
                                    }`}
                                  >
                                    <Icon name="check" size={13} stroke={2.6} />
                                    {isSent ? 'Sent ✓' : 'Mark sent'}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Open outreach drafts for ${name}`}
                                    title="View personalized outreach message"
                                    onClick={() => setSelectedId(id)}
                                    className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border-0 bg-[#26224A] text-[#CFC8FF] transition hover:bg-[#322D5E]"
                                  >
                                    <Icon name="message" size={16} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    aria-label={`Personalize ${name}`}
                                    title="Personalize lead and move to Personalized tab"
                                    disabled={isRowPersonalising}
                                    onClick={() => void approveAndPersonalise([id], true)}
                                    className="inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#2F6B4B] bg-[#10261B] px-2.5 text-xs font-semibold text-[#8EE6B6] transition hover:bg-[#153324] disabled:opacity-50"
                                  >
                                    {isRowPersonalising ? <Spinner size={13} /> : <Icon name="sparkle" size={13} />}
                                    {isRowPersonalising ? 'Writing…' : 'Personalize'}
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Review ${name}`}
                                    title="Configure personalization settings & inspect research details"
                                    onClick={() => openPersonalizationConfig([id])}
                                    className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border-0 bg-[#3A2F17] text-[#F2C36B] transition hover:bg-[#4A3B1C]"
                                  >
                                    <Icon name="review" size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between text-[13px] text-[#8A909C]">
                <span>
                  Showing {visible.length} of {research.length}
                </span>
              </div>
            </>
          )}
        </PageFrame>
      </div>

      {/* Right-hand prospect detail panel */}
      {selectedEntry && (
        <ProspectDetailPanel
          key={selectedEntry.record.record_id}
          entry={selectedEntry}
          index={visible.findIndex((item) => item.record.record_id === selectedEntry.record.record_id)}
          total={visible.length}
          projectId={projectId}
          projectTitle={title}
          brief={brief}
          settings={settings}
          draft={draftByRecordId.get(selectedEntry.record.record_id) ?? null}
          isSent={Boolean(sentIds[selectedEntry.record.record_id] || selectedEntry.relationship_status === 'contacted')}
          onToggleSent={() => toggleSent(selectedEntry.record.record_id)}
          personalising={personalisingIds.includes(selectedEntry.record.record_id)}
          focusPersonalizeTick={configureFocusTick}
          configureQueueIds={configureQueueIds}
          onSelectQueueLead={(nextId) => {
            setSelectedId(nextId);
            setConfigureFocusTick((t) => t + 1);
          }}
          onPersonaliseBatch={(ids, currentLeadCfg) =>
            void approveAndPersonalise(ids, true, currentLeadCfg)
          }
          onClose={() => {
            setSelectedId(null);
            setConfigureQueueIds([]);
          }}
          onNavigate={(delta) => {
            const idx = visible.findIndex((item) => item.record.record_id === selectedEntry.record.record_id);
            const next = visible[idx + delta];
            if (next) setSelectedId(next.record.record_id);
          }}
          onDecisionOptimistic={(nextStatus, nextNote) => {
            updateResearchReview(selectedEntry.record.record_id, nextStatus, nextNote);
          }}
          onReloadBundle={reload}
          onRunResearch={(instructions) => void handleRunResearchForLead(selectedEntry, instructions)}
          onDecisionNotice={(msg) => setActionNotice(msg)}
          onDraftUpdated={(updated) => {
            updateDraft(updated);
            void reload();
          }}
          onSettingsUpdated={(updatedSettings) => {
            setSettings(updatedSettings);
          }}
          onPersonalise={(leadCfg) =>
            void approveAndPersonalise([selectedEntry.record.record_id], true, leadCfg)
          }
          onOpenDrafts={(channel) => {
            setDrawerState({ recordId: selectedEntry.record.record_id, channel });
          }}
          onSyncNotion={handleSyncToNotion}
          syncingNotion={syncingNotion}
          notionUrl={notionUrl}
          notionProspectUrl={
            notionProspectPageIds[selectedEntry.record.record_id]
              ? `https://www.notion.so/${notionProspectPageIds[selectedEntry.record.record_id]!.replace(/-/g, '')}`
              : null
          }
        />
      )}

      {/* Filters modal */}
      {filtersOpen && (
        <FiltersDialog
          initial={filters}
          targets={brief?.targets ?? []}
          runDates={runDates}
          locations={locations}
          countPreview={(candidate) => research.filter((entry) => matchesFilters(entry, candidate)).length}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setFiltersOpen(false);
          }}
        />
      )}

      {/* Drafted messages drawer (Screenshot 1 reference) */}
      {drawerState && activeDrawerDraft && (
        <DraftsDrawer
          draft={activeDrawerDraft}
          researchEntry={activeDrawerResearch}
          isSent={Boolean(
            sentIds[drawerState.recordId] ||
              activeDrawerResearch?.relationship_status === 'contacted',
          )}
          onToggleSent={() => toggleSent(drawerState.recordId)}
          initialChannel={drawerState.channel}
          onBackToDetails={() => {
            setSelectedId(drawerState.recordId);
            setDrawerState(null);
          }}
          onClose={() => setDrawerState(null)}
        />
      )}

      {/* Sender & outreach settings modal (for Personalized & Sent tabs) */}
      <CampaignSettingsModal
        projectId={projectId}
        initialSettings={settings ?? EMPTY_SETTINGS}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(updated) => {
          setSettings(updated);
          void reload();
        }}
      />

      {/* Research configuration / Goal, audiences & objectives modal (for All, To review, More research, Rejected) */}
      {researchConfigOpen && (
        <ResearchConfigModal
          projectId={projectId}
          projectTitle={title}
          projectSummary={project.summary}
          revision={project.configuration_revision ?? 1}
          brief={brief}
          research={research}
          onClose={() => setResearchConfigOpen(false)}
          onSaved={async () => {
            await reload();
          }}
          onRunAudienceResearch={(targetId) => {
            setResearchConfigOpen(false);
            openResearch(targetId);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right-hand Prospect Detail Panel (Unified Research + Outreach)      */
/* ------------------------------------------------------------------ */

function ProspectDetailPanel({
  entry,
  index,
  total,
  projectId,
  projectTitle,
  brief,
  settings,
  draft,
  isSent,
  onToggleSent,
  personalising,
  focusPersonalizeTick = 0,
  configureQueueIds = [],
  onSelectQueueLead,
  onPersonaliseBatch,
  onClose,
  onNavigate,
  onDecisionOptimistic,
  onReloadBundle,
  onRunResearch,
  onDecisionNotice,
  onDraftUpdated,
  onSettingsUpdated,
  onPersonalise,
  onOpenDrafts,
  onSyncNotion,
  syncingNotion,
  notionUrl,
  notionProspectUrl,
}: {
  entry: ResearchEntry;
  index: number;
  total: number;
  projectId: string;
  projectTitle?: string;
  brief: NonNullable<ReturnType<typeof useWorkspace>['bundle']>['project']['structured_brief'];
  settings: PersonalizationSettings | null;
  draft: PersonalizationEntry | null;
  isSent: boolean;
  onToggleSent: () => void;
  personalising: boolean;
  focusPersonalizeTick?: number;
  configureQueueIds?: string[];
  onSelectQueueLead?: (recordId: string) => void;
  onPersonaliseBatch?: (recordIds: string[], currentLeadCfg?: LeadPersonalizationSettings) => void;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
  onDecisionOptimistic: (status: ReviewStatus, note: string | null) => void;
  onReloadBundle?: () => Promise<void>;
  onRunResearch?: (instructions: string) => void;
  onDecisionNotice?: (msg: string) => void;
  onDraftUpdated: (entry: PersonalizationEntry) => void;
  onSettingsUpdated: (settings: PersonalizationSettings) => void;
  onPersonalise: (leadCfg?: LeadPersonalizationSettings) => void;
  onOpenDrafts: (channel?: DraftChannel) => void;
  onSyncNotion?: () => void;
  syncingNotion?: boolean;
  notionUrl?: string | null;
  notionProspectUrl?: string | null;
}) {
  const [note, setNote] = useState(entry.review?.note ?? '');
  const [noteSaved, setNoteSaved] = useState(Boolean(entry.review?.note));
  const [saving, setSaving] = useState(false);
  const [approvingDraft, setApprovingDraft] = useState(false);
  const [savingDraftEdit, setSavingDraftEdit] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreResearchOpen, setMoreResearchOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const { copied, copy } = useClipboard();
  const settingsSectionRef = useRef<HTMLElement | null>(null);

  const handleDownloadDossier = () => {
    downloadProspectMarkdown({
      entry,
      draft,
      projectName: projectTitle || brief?.project?.name || undefined,
    });
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2500);
  };

  const name = prospectName(entry);
  const status = reviewStatus(entry);
  const statusMeta = isSent ? { label: 'Sent', bg: '#12313A', fg: '#9BE6EE' } : STATUS_META[status];
  const verification = verificationOf(entry);
  const contacts = contactsOf(entry);
  const bullets = researchBullets(entry);
  const isApproved = status === 'shortlisted';
  const hasDraft = Boolean(draft?.copy);
  const defaultDraftChannel = draft ? primaryChannel(draft, entry) : 'email';

  const recommendation = useMemo(
    () => recommendLeadPersonalization(entry.record),
    [entry.record],
  );
  const defaultLeadCfg = recommendation.settings;

  const savedLeadSettings = useMemo<LeadPersonalizationSettings>(
    () =>
      draft?.lead_settings ??
      settings?.lead_settings?.[entry.record.record_id] ??
      defaultLeadCfg,
    [draft?.lead_settings, settings?.lead_settings, entry.record.record_id, defaultLeadCfg],
  );

  const [leadSettings, setLeadSettings] = useState<LeadPersonalizationSettings>(savedLeadSettings);
  const [settingsExpanded, setSettingsExpanded] = useState<boolean>(!hasDraft || focusPersonalizeTick > 0);
  const [isConfiguringMode, setIsConfiguringMode] = useState<boolean>(!hasDraft || focusPersonalizeTick > 0);
  const [savingLeadSettings, setSavingLeadSettings] = useState(false);
  const [leadSettingsSaved, setLeadSettingsSaved] = useState(
    Boolean(draft?.lead_settings || settings?.lead_settings?.[entry.record.record_id]),
  );
  const [viewingVersionIdx, setViewingVersionIdx] = useState<number | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);

  const isUsingRecommended =
    leadSettings.tone === defaultLeadCfg.tone &&
    leadSettings.message_length === defaultLeadCfg.message_length &&
    leadSettings.personalization_depth === defaultLeadCfg.personalization_depth &&
    leadSettings.communication_approach === defaultLeadCfg.communication_approach &&
    leadSettings.explanation_level === defaultLeadCfg.explanation_level &&
    leadSettings.call_to_action === defaultLeadCfg.call_to_action &&
    !leadSettings.additional_instructions.trim();

  const queueIndex = configureQueueIds.indexOf(entry.record.record_id);
  const inConfigureQueue = queueIndex >= 0 && configureQueueIds.length > 0;
  const showConfigAtTop = isConfiguringMode || !hasDraft || inConfigureQueue;

  useEffect(() => {
    setLeadSettings(savedLeadSettings);
    setLeadSettingsSaved(
      Boolean(draft?.lead_settings || settings?.lead_settings?.[entry.record.record_id]),
    );
    setViewingVersionIdx(null);
  }, [entry.record.record_id, savedLeadSettings, draft?.lead_settings, settings?.lead_settings]);

  useEffect(() => {
    if (focusPersonalizeTick > 0) {
      setIsConfiguringMode(true);
      setSettingsExpanded(true);
      const timer = window.setTimeout(() => {
        settingsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
      return () => window.clearTimeout(timer);
    }
  }, [focusPersonalizeTick, entry.record.record_id]);

  const updateLeadSetting = <K extends keyof LeadPersonalizationSettings>(
    key: K,
    value: LeadPersonalizationSettings[K],
  ) => {
    setLeadSettings((curr) => ({ ...curr, [key]: value }));
    setLeadSettingsSaved(false);
  };

  const saveLeadSettings = async (nextSettings: LeadPersonalizationSettings = leadSettings) => {
    if (savingLeadSettings) return;
    setSavingLeadSettings(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: entry.record.record_id,
          leadSettings: nextSettings,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save personalization settings.');
      if (data.settings) {
        onSettingsUpdated(data.settings as PersonalizationSettings);
      }
      const updatedEntry = (data.item ?? data.entry) as PersonalizationEntry | undefined;
      if (updatedEntry) {
        onDraftUpdated(updatedEntry);
      }
      setLeadSettingsSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingLeadSettings(false);
    }
  };

  const restorePreviousVersion = async (versionIdx: number) => {
    const version = draft?.previous_versions?.[versionIdx];
    if (!draft || !version || restoringVersion) return;
    setRestoringVersion(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: entry.record.record_id,
          copy: version.copy,
          ...(version.lead_settings ? { leadSettings: version.lead_settings } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not restore draft version.');
      if (data.settings) {
        onSettingsUpdated(data.settings as PersonalizationSettings);
      }
      const updatedEntry = (data.item ?? data.entry) as PersonalizationEntry | undefined;
      if (updatedEntry) {
        onDraftUpdated(updatedEntry);
      }
      if (version.lead_settings) {
        setLeadSettings(version.lead_settings);
      }
      setViewingVersionIdx(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoringVersion(false);
    }
  };

  const [activeChannel, setActiveChannel] = useState<DraftChannel>(defaultDraftChannel);
  const [subjectIdx, setSubjectIdx] = useState(0);
  const [draftEdits, setDraftEdits] = useState({
    email: draft?.copy?.email_body ?? '',
    linkedin: draft?.copy?.linkedin_message ?? '',
    follow_up: draft?.copy?.follow_up_body ?? '',
  });

  useEffect(() => {
    setDraftEdits({
      email: draft?.copy?.email_body ?? '',
      linkedin: draft?.copy?.linkedin_message ?? '',
      follow_up: draft?.copy?.follow_up_body ?? '',
    });
  }, [draft?.updated_at, draft?.record_id]);

  const { bestContact, watchouts } = useMemo(
    () => analyzeLeadInsights(entry, draft),
    [entry, draft],
  );

  const editBucket = isShortSocialChannel(activeChannel)
    ? 'linkedin'
    : activeChannel === 'follow_up'
      ? 'follow_up'
      : 'email';

  const activeProfileUrl =
    activeChannel === 'linkedin'
      ? contacts.linkedin
      : contacts.extraSocials.find((s) => s.platform === activeChannel)?.url ?? null;

  const activeVersion =
    viewingVersionIdx !== null && draft?.previous_versions?.[viewingVersionIdx]
      ? draft.previous_versions[viewingVersionIdx]!
      : null;

  const displayedDraft: PersonalizationEntry | null = useMemo(() => {
    if (!draft) return null;
    if (!activeVersion) return draft;
    return {
      ...draft,
      copy: activeVersion.copy,
      lead_settings: activeVersion.lead_settings ?? draft.lead_settings,
    };
  }, [draft, activeVersion]);

  const activeMessageText = displayedDraft
    ? editingDraft
      ? draftEdits[editBucket]
      : messageFor(displayedDraft, activeChannel)
    : '';
  const activeSubjectText = displayedDraft ? subjectFor(displayedDraft, subjectIdx) : '';

  const saveInlineDraftEdit = async () => {
    if (!draft?.copy || savingDraftEdit) return;
    setSavingDraftEdit(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: entry.record.record_id,
          copy: {
            ...draft.copy,
            email_body: draftEdits.email,
            linkedin_message: draftEdits.linkedin,
            follow_up_body: draftEdits.follow_up,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      const updated = (data.item ?? data.entry) as PersonalizationEntry | undefined;
      if (!response.ok || !updated) throw new Error(data.error || 'Could not save draft changes.');
      onDraftUpdated(updated);
      setEditingDraft(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingDraftEdit(false);
    }
  };

  const entityLabel =
    entry.record.identity.entity_kind === 'person'
      ? 'Person'
      : entry.record.identity.entity_kind === 'organisation'
        ? 'Organisation'
        : null;
  const metaParts = [
    entityLabel,
    entry.record.role,
    entry.record.organisation && entry.record.organisation !== name ? entry.record.organisation : null,
    locationOf(entry) || (entry.record.researched_at ? `Found ${shortDate(entry.record.researched_at)}` : null),
  ].filter(Boolean);

  const commitDecision = async (nextStatus: ReviewStatus, customNote?: string) => {
    const finalNote = (customNote !== undefined ? customNote : note).trim();
    const noteToSave = finalNote || (nextStatus === 'rejected' ? 'Rejected by user' : null);
    setSaving(true);
    setError(null);
    // Optimistically update in place so the user never loses their position
    onDecisionOptimistic(nextStatus, noteToSave);
    try {
      await saveDecision(projectId, entry.record.record_id, nextStatus, noteToSave);
      setNoteSaved(true);
      setMoreResearchOpen(false);
      if (onReloadBundle) {
        await onReloadBundle();
      }
      if (nextStatus === 'rejected') {
        onDecisionNotice?.(`Moved ${name} to the Rejected tab.`);
      } else if (nextStatus === 'enrichment_requested') {
        onDecisionNotice?.(`Moved ${name} to the More research tab.`);
      } else if (nextStatus === 'shortlisted' && !hasDraft) {
        onPersonalise(leadSettings);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const approveDraftInPlace = async () => {
    if (!draft?.copy || approvingDraft) return;
    setApprovingDraft(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: entry.record.record_id,
          status: 'approved',
          reviewStatus: 'approved',
          copy: draft.copy,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const updated = (data.item ?? data.entry) as PersonalizationEntry | undefined;
      if (!response.ok || !updated) throw new Error(data.error || 'Could not approve draft.');
      onDraftUpdated(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingDraft(false);
    }
  };

  const contactItems: Array<{
    key: string;
    value: string | null;
    rawValue: string | null;
    href: string | null;
    missingLabel: string;
    sub: string;
    channel: DraftChannel;
  }> = [
    {
      key: 'email',
      value: contacts.email,
      rawValue: contacts.email,
      href: contacts.email ? `mailto:${contacts.email}` : null,
      missingLabel: 'Email not found',
      sub: contacts.email ? (contacts.emailOwner ? `Email · ${contacts.emailOwner}` : 'Email') : 'Not found by research',
      channel: 'email',
    },
    {
      key: 'linkedin',
      value: contacts.linkedin ? formatProfileDisplay(contacts.linkedin) : null,
      rawValue: contacts.linkedin,
      href: contacts.linkedin,
      missingLabel: 'LinkedIn not found',
      sub: contacts.linkedin ? (contacts.linkedinOwner ? `LinkedIn · ${contacts.linkedinOwner}` : 'LinkedIn') : 'Not found by research',
      channel: 'linkedin',
    },
    ...contacts.extraSocials.map((social, idx) => ({
      key: `social-${social.platform}-${idx}`,
      value: social.display,
      rawValue: social.url,
      href: social.url,
      missingLabel: `${social.label} not found`,
      sub: social.label,
      channel: social.platform as DraftChannel,
    })),
    {
      key: 'website',
      value: contacts.contactForm || contacts.website ? hostOf((contacts.contactForm || contacts.website)!) : null,
      rawValue: contacts.contactForm || contacts.website,
      href: contacts.contactForm || contacts.website,
      missingLabel: 'Website not found',
      sub: contacts.contactForm
        ? 'Website · contact form found'
        : contacts.website
          ? 'Website'
          : 'Not found by research',
      channel: contacts.contactForm || contacts.website ? 'website_form' : 'follow_up',
    },
  ];

  const uniqueExtraSocialTabs = contacts.extraSocials.filter(
    (social, idx, arr) => arr.findIndex((item) => item.platform === social.platform) === idx,
  );
  const channelTabs: Array<{ id: DraftChannel; dot: string }> = [
    { id: 'email', dot: contacts.email ? '#5BD69A' : '#F2C36B' },
    { id: 'linkedin', dot: contacts.linkedin ? '#5BD69A' : '#F2C36B' },
    ...uniqueExtraSocialTabs.map((social) => ({
      id: social.platform as DraftChannel,
      dot: '#5BD69A',
    })),
    { id: 'whatsapp', dot: contacts.phone ? '#5BD69A' : '#F2C36B' },
    { id: 'website_form', dot: contacts.contactForm || contacts.website ? '#5BD69A' : '#F2C36B' },
    { id: 'follow_up', dot: contacts.email ? '#8A909C' : '#F2C36B' },
  ];

  const watchoutToneStyles: Record<LeadWatchout['tone'], { badgeBg: string; badgeFg: string; border: string }> = {
    amber: { badgeBg: '#3A2F17', badgeFg: '#F2C36B', border: 'border-[#4A3B17]' },
    teal: { badgeBg: '#12313A', badgeFg: '#9BE6EE', border: 'border-[#2E6B75]' },
    purple: { badgeBg: '#26224A', badgeFg: '#CFC8FF', border: 'border-[#3B3577]' },
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const personalizationSettingsSection = (
    <section
      ref={settingsSectionRef}
      aria-label="Personalization Settings"
      className="flex flex-col gap-3 rounded-2xl border border-[#3B3577] bg-[#161524] p-4 shadow-[0_8px_28px_rgba(20,16,44,0.45)]"
    >
      {/* Batch Configuration Queue Bar when configuring multiple selected leads */}
      {configureQueueIds.length > 1 && queueIndex >= 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#2F6B4B] bg-[#10261B] px-3 py-2 text-xs text-[#B7D9C6]">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 items-center rounded-md bg-[#1A3F2C] px-2 text-[11px] font-bold text-[#8EE6B6]">
              Lead {queueIndex + 1} of {configureQueueIds.length}
            </span>
            <span className="font-medium text-[#D8F3E5]">
              Choose personalization settings for each lead
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={queueIndex <= 0}
              onClick={() => {
                const prevId = configureQueueIds[queueIndex - 1];
                if (prevId && onSelectQueueLead) onSelectQueueLead(prevId);
              }}
              className="rounded-lg border border-[#2F6B4B] bg-[#153324] px-2 py-1 text-[11px] font-semibold text-[#8EE6B6] hover:bg-[#1B402D] disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={queueIndex >= configureQueueIds.length - 1}
              onClick={() => {
                const nextId = configureQueueIds[queueIndex + 1];
                if (nextId && onSelectQueueLead) onSelectQueueLead(nextId);
              }}
              className="rounded-lg border border-[#2F6B4B] bg-[#153324] px-2 py-1 text-[11px] font-semibold text-[#8EE6B6] hover:bg-[#1B402D] disabled:opacity-40"
            >
              Next →
            </button>
            {onPersonaliseBatch && (
              <button
                type="button"
                disabled={personalising}
                onClick={() => onPersonaliseBatch(configureQueueIds, leadSettings)}
                className="rounded-lg bg-[#5BD69A] px-2.5 py-1 text-[11px] font-bold text-[#0E1014] hover:opacity-95 disabled:opacity-50"
              >
                Personalize all {configureQueueIds.length} now
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="sparkle" size={15} className="text-[#B1A6FF]" />
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-[14px] font-semibold text-[#F1F2F4]">
                Personalization Settings
              </h3>
              <span className="rounded-md bg-[#26224A] px-2 py-0.5 text-[11px] font-semibold text-[#CFC8FF]">
                This prospect only
              </span>
              {isUsingRecommended ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#2E6B75] bg-[#12313A] px-2 py-0.5 text-[11px] font-semibold text-[#9BE6EE]">
                  ✦ Recommended from research
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-[#4A3B17] bg-[#261E0E] px-2 py-0.5 text-[11px] font-semibold text-[#F2C36B]">
                  Customised for {name}
                </span>
              )}
              {leadSettingsSaved && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#5BD69A]">
                  <Icon name="check" size={11} stroke={3} /> Saved
                </span>
              )}
            </div>
            <span className="text-xs text-[#A7ADB8]">
              Review or adjust how the AI approaches {name} before generating outreach drafts
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={settingsExpanded}
          onClick={() => setSettingsExpanded((curr) => !curr)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#3B3577] bg-[#1D1B30] px-2.5 text-xs font-semibold text-[#CFC8FF] hover:bg-[#26224A]"
        >
          {settingsExpanded ? 'Hide settings' : 'Configure'}
          <Icon
            name="chevronDown"
            size={13}
            className={`transition-transform ${settingsExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Research-based recommendation rationale & highlights */}
      <div className="flex flex-col gap-2 rounded-xl border border-[#2B2752] bg-[#12111E] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#9BE6EE]">
            ✦ Why these settings are recommended for {name}
          </span>
          {!isUsingRecommended && (
            <button
              type="button"
              onClick={() => {
                setLeadSettings(defaultLeadCfg);
                setLeadSettingsSaved(false);
              }}
              className="rounded-md border border-[#2E6B75] bg-[#12313A] px-2 py-0.5 text-[11px] font-semibold text-[#9BE6EE] hover:bg-[#183D48]"
            >
              Use recommended settings
            </button>
          )}
        </div>
        <p className="m-0 text-xs leading-relaxed text-[#D5D8DE]">
          {recommendation.rationale}
        </p>
        {recommendation.highlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {recommendation.highlights.map((item, idx) => (
              <span
                key={idx}
                className="rounded-md border border-[#26224A] bg-[#1A182B] px-2 py-0.5 text-[11px] text-[#CFC8FF]"
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Compact summary pills (always visible so user sees active configuration at a glance) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-[#3B3577] bg-[#1D1B30] px-2.5 py-0.5 text-[11px] font-medium text-[#E0DCFF]">
          Tone: <strong>{LEAD_TONE_LABELS[leadSettings.tone]}</strong>
        </span>
        <span className="rounded-full border border-[#3B3577] bg-[#1D1B30] px-2.5 py-0.5 text-[11px] font-medium text-[#E0DCFF]">
          Length: <strong>{LEAD_LENGTH_LABELS[leadSettings.message_length]}</strong>
        </span>
        <span className="rounded-full border border-[#3B3577] bg-[#1D1B30] px-2.5 py-0.5 text-[11px] font-medium text-[#E0DCFF]">
          Depth: <strong>{LEAD_DEPTH_LABELS[leadSettings.personalization_depth].label}</strong>
        </span>
        <span className="rounded-full border border-[#3B3577] bg-[#1D1B30] px-2.5 py-0.5 text-[11px] font-medium text-[#E0DCFF]">
          Approach: <strong>{LEAD_APPROACH_LABELS[leadSettings.communication_approach].label}</strong>
        </span>
        <span className="rounded-full border border-[#3B3577] bg-[#1D1B30] px-2.5 py-0.5 text-[11px] font-medium text-[#E0DCFF]">
          Explanation: <strong>{LEAD_EXPLANATION_LABELS[leadSettings.explanation_level].label}</strong>
        </span>
        <span className="rounded-full border border-[#3B3577] bg-[#1D1B30] px-2.5 py-0.5 text-[11px] font-medium text-[#E0DCFF]">
          CTA: <strong>{LEAD_CTA_LABELS[leadSettings.call_to_action].label}</strong>
        </span>
      </div>

      {settingsExpanded && (
        <div className="flex flex-col gap-3.5 border-t border-[#2B2752] pt-3">
          {/* 1. Tone */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#D5D8DE]">Tone</span>
              <span className="text-[11px] text-[#9B97B8]">
                Recommended: {LEAD_TONE_LABELS[defaultLeadCfg.tone]}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(LEAD_TONE_LABELS) as LeadTone[]).map((toneKey) => {
                const active = leadSettings.tone === toneKey;
                return (
                  <button
                    key={toneKey}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateLeadSetting('tone', toneKey)}
                    className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition ${
                      active
                        ? 'border-[#B1A6FF] bg-[#26224A] text-[#F1F2F4]'
                        : 'border-[#2A2F39] bg-[#12151A] text-[#A7ADB8] hover:border-[#3B3577] hover:text-[#F1F2F4]'
                    }`}
                  >
                    {LEAD_TONE_LABELS[toneKey]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Message Length & 3. Personalization Depth */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#D5D8DE]">Message Length</span>
                <span className="text-[11px] text-[#9B97B8]">
                  {LEAD_LENGTH_LABELS[leadSettings.message_length]}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(LEAD_LENGTH_LABELS) as LeadMessageLength[]).map((lenKey) => {
                  const active = leadSettings.message_length === lenKey;
                  return (
                    <button
                      key={lenKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateLeadSetting('message_length', lenKey)}
                      className={`h-8 rounded-lg border px-2 text-xs font-semibold transition ${
                        active
                          ? 'border-[#B1A6FF] bg-[#26224A] text-[#F1F2F4]'
                          : 'border-[#2A2F39] bg-[#12151A] text-[#A7ADB8] hover:border-[#3B3577] hover:text-[#F1F2F4]'
                      }`}
                    >
                      {LEAD_LENGTH_LABELS[lenKey]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#D5D8DE]">Personalization Depth</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(LEAD_DEPTH_LABELS) as LeadPersonalizationDepth[]).map((depthKey) => {
                  const active = leadSettings.personalization_depth === depthKey;
                  return (
                    <button
                      key={depthKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateLeadSetting('personalization_depth', depthKey)}
                      className={`h-8 rounded-lg border px-2 text-xs font-semibold transition ${
                        active
                          ? 'border-[#B1A6FF] bg-[#26224A] text-[#F1F2F4]'
                          : 'border-[#2A2F39] bg-[#12151A] text-[#A7ADB8] hover:border-[#3B3577] hover:text-[#F1F2F4]'
                      }`}
                    >
                      {LEAD_DEPTH_LABELS[depthKey].label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] leading-snug text-[#9B97B8]">
                {LEAD_DEPTH_LABELS[leadSettings.personalization_depth].description}
              </span>
            </div>
          </div>

          {/* 4. Approach */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#D5D8DE]">Approach</span>
              <span className="text-[11px] text-[#9B97B8]">
                {LEAD_APPROACH_LABELS[leadSettings.communication_approach].description}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(LEAD_APPROACH_LABELS) as LeadCommunicationApproach[]).map((appKey) => {
                const active = leadSettings.communication_approach === appKey;
                return (
                  <button
                    key={appKey}
                    type="button"
                    aria-pressed={active}
                    onClick={() => updateLeadSetting('communication_approach', appKey)}
                    className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition ${
                      active
                        ? 'border-[#B1A6FF] bg-[#26224A] text-[#F1F2F4]'
                        : 'border-[#2A2F39] bg-[#12151A] text-[#A7ADB8] hover:border-[#3B3577] hover:text-[#F1F2F4]'
                    }`}
                  >
                    {LEAD_APPROACH_LABELS[appKey].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. Explanation & 6. Call to Action */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#D5D8DE]">Explanation</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(LEAD_EXPLANATION_LABELS) as LeadExplanationLevel[]).map((expKey) => {
                  const active = leadSettings.explanation_level === expKey;
                  return (
                    <button
                      key={expKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateLeadSetting('explanation_level', expKey)}
                      className={`h-8 rounded-lg border px-2 text-xs font-semibold transition ${
                        active
                          ? 'border-[#B1A6FF] bg-[#26224A] text-[#F1F2F4]'
                          : 'border-[#2A2F39] bg-[#12151A] text-[#A7ADB8] hover:border-[#3B3577] hover:text-[#F1F2F4]'
                      }`}
                    >
                      {LEAD_EXPLANATION_LABELS[expKey].label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] leading-snug text-[#9B97B8]">
                {LEAD_EXPLANATION_LABELS[leadSettings.explanation_level].description}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#D5D8DE]">Call to Action</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(LEAD_CTA_LABELS) as LeadCallToAction[]).map((ctaKey) => {
                  const active = leadSettings.call_to_action === ctaKey;
                  return (
                    <button
                      key={ctaKey}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateLeadSetting('call_to_action', ctaKey)}
                      className={`h-8 rounded-lg border px-2 text-xs font-semibold transition ${
                        active
                          ? 'border-[#B1A6FF] bg-[#26224A] text-[#F1F2F4]'
                          : 'border-[#2A2F39] bg-[#12151A] text-[#A7ADB8] hover:border-[#3B3577] hover:text-[#F1F2F4]'
                      }`}
                    >
                      {LEAD_CTA_LABELS[ctaKey].label}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] leading-snug text-[#9B97B8]">
                {LEAD_CTA_LABELS[leadSettings.call_to_action].description}
              </span>
            </div>
          </div>

          {/* 7. Additional Instructions */}
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-xs font-semibold text-[#D5D8DE]">
              <span>Additional Instructions</span>
              <span className="font-normal text-[#9B97B8]">Optional · specific to {name}</span>
            </span>
            <textarea
              value={leadSettings.additional_instructions}
              onChange={(e) => updateLeadSetting('additional_instructions', e.target.value)}
              rows={2}
              placeholder="Make the message warmer, avoid sounding too promotional, focus on the recipient's potential benefit and keep it under 100 words."
              className="w-full resize-y rounded-xl border border-[#2A2F39] bg-[#12151A] px-3 py-2 text-xs leading-relaxed text-[#F1F2F4] outline-none placeholder:text-[#666C78] focus:border-[#B1A6FF]"
            />
          </label>

          {/* Settings Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={savingLeadSettings}
                onClick={() => void saveLeadSettings(leadSettings)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#3B3577] bg-[#1D1B30] px-3 text-xs font-semibold text-[#CFC8FF] hover:bg-[#26224A] disabled:opacity-50"
              >
                {savingLeadSettings ? <Spinner size={12} /> : <Icon name="check" size={12} />}
                {savingLeadSettings ? 'Saving…' : 'Save settings'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeadSettings(defaultLeadCfg);
                  setLeadSettingsSaved(false);
                }}
                className="h-8 rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-[#9B97B8] hover:text-[#F1F2F4]"
              >
                Use recommended
              </button>
            </div>

            <button
              type="button"
              disabled={personalising}
              onClick={() => onPersonalise(leadSettings)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5BD69A] px-4 text-xs font-bold text-[#0E1014] transition hover:opacity-95 disabled:opacity-50"
            >
              {personalising ? <Spinner size={13} /> : <Icon name="sparkle" size={13} />}
              {personalising
                ? 'Personalizing…'
                : hasDraft
                  ? 'Regenerate with settings'
                  : configureQueueIds.length > 1 && queueIndex >= 0
                    ? `Confirm & Personalize (${queueIndex + 1}/${configureQueueIds.length}) →`
                    : 'Confirm & Personalize Drafts'}
            </button>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="fixed inset-0 z-[55] flex justify-end">
      {/* Backdrop: click outside to close */}
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="fixed inset-0 h-full w-full cursor-default bg-[rgba(4,5,7,0.55)] backdrop-blur-[2px] transition-opacity"
      />

      {/* Slide-over panel */}
      <aside
        aria-label={name}
        className="relative z-10 flex h-full w-[620px] max-w-[calc(100vw-24px)] flex-col border-l border-[#2A2F39] bg-[#12151A] shadow-[-24px_0_60px_rgba(0,0,0,0.65)]"
      >
      {/* Top navigation bar */}
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <span className="text-xs font-semibold tracking-[0.14em] text-[#5ED3DF]">
          PROSPECT {index >= 0 ? index + 1 : 1} OF {Math.max(total, 1)}
        </span>
        <div className="flex items-center gap-1.5">
          {notionProspectUrl || notionUrl ? (
            <a
              href={notionProspectUrl || notionUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Lead Dossier & Outreach in Notion"
              title={
                notionProspectUrl
                  ? 'Open this prospect’s personalized outreach drafts and dossier directly in Notion'
                  : 'Open Campaign Hub and Prospects in Notion'
              }
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#2E6B75] bg-[#12313A] px-3 text-xs font-semibold text-[#9BE6EE] hover:bg-[#183D48]"
            >
              <Icon name="external" size={13} stroke={2.2} />
              <span>{notionProspectUrl ? 'View in Notion' : 'Notion'}</span>
            </a>
          ) : onSyncNotion ? (
            <button
              type="button"
              onClick={onSyncNotion}
              disabled={syncingNotion}
              aria-label="Sync Campaign & Dossiers to Notion"
              title="Sync Campaign Brief, Prospect Database, and Outreach Drafts to Notion"
              className="flex h-9 items-center gap-1.5 rounded-full border border-[#2A2F39] bg-[#171A20] px-3 text-xs font-semibold text-[#F1F2F4] hover:border-[#3A3F4A] hover:bg-[#20242B] disabled:opacity-50"
            >
              {syncingNotion ? <Spinner size={13} /> : <Icon name="plug" size={13} />}
              <span>{syncingNotion ? 'Syncing…' : 'Sync Notion'}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleDownloadDossier}
            aria-label="Download dossier as Markdown"
            title="Download full intelligence dossier (.md)"
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
              downloaded
                ? 'border-[#2F6B4B] bg-[#10261B] text-[#8EE6B6]'
                : 'border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] hover:border-[#3B3577] hover:bg-[#1D1B30] hover:text-[#CFC8FF]'
            }`}
          >
            <Icon name={downloaded ? 'check' : 'download'} size={14} stroke={2.4} />
            <span>{downloaded ? 'Downloaded' : 'Download .md'}</span>
          </button>
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => onNavigate(-1)}
            aria-label="Previous prospect"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] disabled:opacity-40"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            disabled={index < 0 || index >= total - 1}
            onClick={() => onNavigate(1)}
            aria-label="Next prospect"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] disabled:opacity-40"
          >
            <Icon name="chevronRight" size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4]"
          >
            <Icon name="close" size={14} stroke={2.2} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-2">
        {/* Header info */}
        <div className="flex flex-col gap-2">
          <h2 className={`${serif} m-0 text-[30px] leading-[1.12]`}>{name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#A7ADB8]">
            <span>{metaParts.join(' · ') || 'Found by research'}</span>
            <Pill bg={statusMeta.bg} fg={statusMeta.fg}>
              {statusMeta.label}
            </Pill>
            {isApproved && (
              <button
                type="button"
                onClick={onToggleSent}
                className={`rounded-full border px-3 py-0.5 text-xs font-semibold transition ${
                  isSent
                    ? 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE]'
                    : 'border-[#2A2F39] bg-[#171A20] text-[#A7ADB8] hover:text-[#F1F2F4]'
                }`}
              >
                {isSent ? '✓ Marked sent' : 'Mark as sent'}
              </button>
            )}
          </div>
        </div>

        {/* Prominent banner if more research is requested */}
        {status === 'enrichment_requested' && (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-[#2E6B75] bg-[#12313A] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#9BE6EE]">
                <Icon name="search" size={17} className="text-[#5ED3DF]" />
                More research requested
              </span>
              {onRunResearch && (
                <button
                  type="button"
                  onClick={() => onRunResearch(entry.review?.note || 'Find verified contact and fit')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5ED3DF] px-3 text-xs font-bold text-[#0E1014] hover:bg-[#82E0EB]"
                >
                  <Icon name="sparkle" size={13} stroke={2.2} /> Run research now
                </button>
              )}
            </div>
            {entry.review?.note && (
              <p className="m-0 text-xs text-[#D5D8DE] leading-relaxed">
                <strong className="text-[#9BE6EE]">What to check:</strong> {entry.review.note}
              </p>
            )}
            <div className="text-[11px] text-[#A7ADB8]">
              This lead is saved in the <strong>More research</strong> tab and kept out of active outreach drafts until verified.
            </div>
          </div>
        )}

        {/* Prominent banner if rejected */}
        {status === 'rejected' && (
          <div className="flex flex-col gap-2 rounded-2xl border border-[#5A3A38] bg-[#1C1517] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#F7B1AA]">
                <Icon name="x" size={17} className="text-[#F28B82]" />
                Lead Rejected
              </span>
              <button
                type="button"
                onClick={() => void commitDecision('needs_review', '')}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#5A3A38] bg-[#2A1D20] px-2.5 text-xs font-semibold text-[#F7B1AA] hover:bg-[#38272B]"
              >
                Restore to Review
              </button>
            </div>
            {entry.review?.note && entry.review.note !== 'Rejected by user' && (
              <p className="m-0 text-xs text-[#D5D8DE]">
                <strong className="text-[#F7B1AA]">Reason:</strong> {entry.review.note}
              </p>
            )}
          </div>
        )}

        <VerificationCard entry={entry} brief={brief} />

        {/* When configuring personalization (or before draft exists), place Personalization Settings right at the top */}
        {showConfigAtTop && personalizationSettingsSection}

        {/* 1. BEST WAY TO CONTACT & WHY */}
        <section className="flex flex-col gap-3 rounded-2xl border border-[#2E6B75] bg-[#112229] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5ED3DF]">
                BEST WAY TO CONTACT
              </span>
              <Pill bg={bestContact.badgeBg} fg={bestContact.badgeFg}>
                {bestContact.badgeLabel}
              </Pill>
            </div>
            {bestContact.targetCopy && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void copy(bestContact.targetCopy!, 'best-contact')}
                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#2E6B75] bg-[#12313A] px-2.5 text-xs font-semibold text-[#9BE6EE] hover:bg-[#193E49]"
                >
                  <Icon name={copied === 'best-contact' ? 'check' : 'copy'} size={12} />
                  {copied === 'best-contact' ? 'Copied' : 'Copy'}
                </button>
                {bestContact.targetHref && !bestContact.targetHref.startsWith('mailto:') && (
                  <a
                    href={bestContact.targetHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#2E6B75] bg-[#12313A] px-2.5 text-xs font-semibold text-[#9BE6EE] no-underline hover:bg-[#193E49]"
                  >
                    Open <Icon name="external" size={11} />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-base font-semibold text-[#F1F2F4]">
                {bestContact.channelLabel}:
              </span>
              {bestContact.targetHref ? (
                <a
                  href={bestContact.targetHref}
                  target={bestContact.targetHref.startsWith('mailto:') ? undefined : '_blank'}
                  rel="noreferrer"
                  className="break-all text-[15px] font-semibold text-[#5ED3DF] no-underline hover:underline"
                >
                  {bestContact.targetDisplay}
                </a>
              ) : (
                <span className="text-[15px] font-medium text-[#C9CDD4]">{bestContact.targetDisplay}</span>
              )}
            </div>
            {bestContact.personLabel && (
              <div className="text-xs font-medium text-[#9BE6EE]">
                Recommended contact: {bestContact.personLabel}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#1E3F4A] bg-[#0D1A20] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#D5E6EC]">
            <strong className="font-semibold text-[#5ED3DF]">Why this works best: </strong>
            {bestContact.why}
          </div>

          {bestContact.backup && (
            <div className="text-xs text-[#9BC4CA]">
              <strong className="font-semibold text-[#B5D9DE]">Backup route:</strong> {bestContact.backup}
            </div>
          )}
        </section>

        {/* 2. THINGS TO LOOK OUT FOR (Watchouts & Preparation Notes) */}
        {watchouts.length > 0 && (
          <section className="flex flex-col gap-2.5 rounded-2xl border border-[#4A3B17] bg-[#1A160E] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon name="warning" size={16} className="text-[#F2C36B]" />
                <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.1em] text-[#F2C36B]">
                  Things to look out for · {watchouts.length}
                </h3>
              </div>
              <span className="text-xs text-[#C7B68E]">Lead-specific watchouts</span>
            </div>

            <div className="flex flex-col gap-2">
              {watchouts.map((item, idx) => {
                const style = watchoutToneStyles[item.tone];
                return (
                  <div
                    key={idx}
                    className={`flex flex-col gap-1 rounded-xl border ${style.border} bg-[#121419] px-3.5 py-2.5`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        style={{ background: style.badgeBg, color: style.badgeFg }}
                        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                      >
                        {item.category}
                      </span>
                    </div>
                    <p className="m-0 text-[13px] leading-relaxed text-[#E5E7EB]">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 2.5. PER-LEAD PERSONALIZATION SETTINGS (when already personalized and not in top config mode) */}
        {!showConfigAtTop && personalizationSettingsSection}

        {/* 3. CLEAN, FULL-READABLE OUTREACH MESSAGE VIEWER */}
        <section className="flex flex-col gap-3.5 rounded-2xl border border-[#2A2F39] bg-[#171A20] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#B1A6FF]">
                {hasDraft ? `${channelTabs.length} DRAFTS WRITTEN` : 'PERSONALIZATION AGENT'}
              </span>
              <h3 className="m-0 text-base font-semibold text-[#F1F2F4]">
                {hasDraft ? 'Outreach message' : 'Generate outreach drafts'}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {hasDraft && (
                <Pill
                  bg={draft?.status === 'approved' ? '#10261B' : '#26224A'}
                  fg={draft?.status === 'approved' ? '#8EE6B6' : '#CFC8FF'}
                >
                  {draft?.status === 'approved' ? 'Approved' : 'Ready to review'}
                </Pill>
              )}
              {hasDraft && draft?.status !== 'approved' && viewingVersionIdx === null && (
                <button
                  type="button"
                  disabled={approvingDraft}
                  onClick={() => void approveDraftInPlace()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#2F6B4B] bg-[#10261B] px-2.5 text-xs font-semibold text-[#8EE6B6] hover:bg-[#153324] disabled:opacity-50"
                >
                  <Icon name="check" size={12} stroke={2.6} />
                  {approvingDraft ? 'Approving…' : 'Approve draft'}
                </button>
              )}
              {hasDraft && (
                <button
                  type="button"
                  onClick={() => onOpenDrafts(activeChannel)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#2A2F39] bg-[#12151A] px-2.5 text-xs font-semibold text-[#C9CDD4] hover:border-[#3A3F4A] hover:text-[#F1F2F4]"
                  title="Open in expanded slide-over"
                >
                  Expand <Icon name="external" size={11} />
                </button>
              )}
            </div>
          </div>

          {hasDraft && displayedDraft?.copy ? (
            <>
              {/* Applied settings indicator + Previous versions bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#232732] bg-[#12151A] px-3 py-2 text-[11px] text-[#A7ADB8]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-[#B1A6FF]">Applied settings:</span>
                  <span>
                    {LEAD_TONE_LABELS[(displayedDraft.lead_settings ?? leadSettings).tone]} ·{' '}
                    {LEAD_LENGTH_LABELS[(displayedDraft.lead_settings ?? leadSettings).message_length]} ·{' '}
                    {LEAD_DEPTH_LABELS[(displayedDraft.lead_settings ?? leadSettings).personalization_depth].label} depth ·{' '}
                    {LEAD_APPROACH_LABELS[(displayedDraft.lead_settings ?? leadSettings).communication_approach].label} ·{' '}
                    {LEAD_CTA_LABELS[(displayedDraft.lead_settings ?? leadSettings).call_to_action].label} CTA
                  </span>
                </div>
                {(draft?.previous_versions?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[#8A909C]">Versions:</span>
                    <button
                      type="button"
                      onClick={() => setViewingVersionIdx(null)}
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        viewingVersionIdx === null
                          ? 'bg-[#26224A] text-[#CFC8FF]'
                          : 'text-[#8A909C] hover:text-[#F1F2F4]'
                      }`}
                    >
                      Latest
                    </button>
                    {draft!.previous_versions!.map((ver, idx) => (
                      <button
                        key={`${ver.version}-${ver.generated_at}`}
                        type="button"
                        onClick={() => {
                          setViewingVersionIdx(idx);
                          setEditingDraft(false);
                        }}
                        title={`Saved ${shortDate(ver.generated_at)}`}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          viewingVersionIdx === idx
                            ? 'bg-[#26224A] text-[#CFC8FF]'
                            : 'text-[#8A909C] hover:text-[#F1F2F4]'
                        }`}
                      >
                        Prev {idx + 1}
                      </button>
                    ))}
                    {viewingVersionIdx !== null && (
                      <button
                        type="button"
                        disabled={restoringVersion}
                        onClick={() => void restorePreviousVersion(viewingVersionIdx)}
                        className="ml-1 rounded-md border border-[#2E6B75] bg-[#12313A] px-2 py-0.5 text-[11px] font-semibold text-[#9BE6EE] hover:bg-[#183D48]"
                      >
                        {restoringVersion ? 'Restoring…' : 'Restore this version'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Channel switcher pills right inside the panel */}
              <div role="tablist" aria-label="Outreach channels" className="flex flex-wrap gap-1.5">
                {channelTabs.map((item) => {
                  const on = item.id === activeChannel;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => {
                        setActiveChannel(item.id);
                        setEditingDraft(false);
                      }}
                      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition ${
                        on
                          ? 'border-[#5ED3DF] bg-[#F1F2F4] text-[#0E1014]'
                          : 'border-[#2A2F39] bg-[#12151A] text-[#C9CDD4] hover:border-[#3A3F4A] hover:text-[#F1F2F4]'
                      }`}
                    >
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: item.dot }} />
                      {CHANNEL_LABEL[item.id]}
                    </button>
                  );
                })}
              </div>

              {/* Profile Link Card (for LinkedIn & Extra Social Tabs) */}
              {isSocialProfileChannel(activeChannel) && (
                <div className="flex items-center justify-between gap-2.5 rounded-xl border border-[#252A34] bg-[#111419] px-3.5 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A909C]">
                      {CHANNEL_LABEL[activeChannel]} profile
                    </span>
                    {activeProfileUrl ? (
                      <a
                        href={activeProfileUrl.startsWith('http') ? activeProfileUrl : `https://${activeProfileUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-sm font-medium text-[#5ED3DF] no-underline hover:underline"
                      >
                        {formatProfileDisplay(activeProfileUrl)}
                      </a>
                    ) : (
                      <span className="text-xs text-[#F2C36B]">
                        No {CHANNEL_LABEL[activeChannel]} profile link found · you can still copy the short message below
                      </span>
                    )}
                  </div>
                  {activeProfileUrl && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void copy(activeProfileUrl, `inline-profile-${activeChannel}`)}
                        className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border border-[#2A2F39] bg-[#171A20] px-2.5 text-xs font-semibold text-[#5ED3DF] hover:bg-[#1F232B]"
                      >
                        <Icon name={copied === `inline-profile-${activeChannel}` ? 'check' : 'copy'} size={12} />
                        {copied === `inline-profile-${activeChannel}` ? 'Copied' : 'Copy link'}
                      </button>
                      <a
                        href={activeProfileUrl.startsWith('http') ? activeProfileUrl : `https://${activeProfileUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border border-[#2E6B75] bg-[#12313A] px-2.5 text-xs font-semibold text-[#9BE6EE] no-underline hover:bg-[#193E49]"
                      >
                        Open <Icon name="external" size={11} />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Full Subject Line Card (for Email / Website form / Follow-up) */}
              {(activeChannel === 'email' || activeChannel === 'website_form' || activeChannel === 'follow_up') && (
                <div className="flex flex-col gap-2 rounded-xl border border-[#252A34] bg-[#111419] px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A909C]">
                        Subject line
                      </span>
                      <span className="break-words text-sm font-semibold leading-snug text-[#F1F2F4]">
                        {activeChannel === 'follow_up' ? `Re: ${activeSubjectText}` : activeSubjectText}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void copy(
                          activeChannel === 'follow_up' ? `Re: ${activeSubjectText}` : activeSubjectText,
                          'inline-subject',
                        )
                      }
                      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[#2A2F39] bg-[#171A20] px-2.5 text-xs font-semibold text-[#5ED3DF] hover:bg-[#1F232B]"
                    >
                      <Icon name={copied === 'inline-subject' ? 'check' : 'copy'} size={12} />
                      {copied === 'inline-subject' ? 'Copied' : 'Copy subject'}
                    </button>
                  </div>

                  {activeChannel === 'email' && (displayedDraft.copy.subject_lines?.length ?? 0) > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-[#8A909C]">Options:</span>
                      {displayedDraft.copy.subject_lines.map((line, i) => (
                        <button
                          key={line.text}
                          type="button"
                          onClick={() => setSubjectIdx(i)}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                            i === subjectIdx
                              ? 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE]'
                              : 'border-[#2A2F39] text-[#A7ADB8] hover:text-[#F1F2F4]'
                          }`}
                        >
                          {line.style}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Full Readable Message Container — NO truncation! */}
              <div className="flex flex-col rounded-xl border border-[#252A34] bg-[#0E1014]">
                <div className="flex items-center justify-between border-b border-[#1E222B] px-4 py-2.5">
                  <span className="text-xs font-semibold text-[#A7ADB8]">
                    {CHANNEL_LABEL[activeChannel]} message
                    {displayedDraft.strategy?.recipient_incentive ? ' · Incentive-led' : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    {viewingVersionIdx === null && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingDraft((v) => !v)}
                          className="text-xs font-semibold text-[#C9CDD4] hover:text-[#F1F2F4]"
                        >
                          {editingDraft ? 'Cancel edit' : 'Edit text'}
                        </button>
                        <span className="text-[#2A2F39]">·</span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void copy(activeMessageText, 'inline-body')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#5ED3DF] hover:underline"
                    >
                      <Icon name={copied === 'inline-body' ? 'check' : 'copy'} size={12} />
                      {copied === 'inline-body' ? 'Copied ✓' : 'Copy message'}
                    </button>
                  </div>
                </div>

                {editingDraft ? (
                  <div className="flex flex-col gap-2.5 p-3.5">
                    <textarea
                      value={draftEdits[editBucket]}
                      onChange={(e) =>
                        setDraftEdits((curr) => ({ ...curr, [editBucket]: e.target.value }))
                      }
                      rows={isShortSocialChannel(activeChannel) ? 5 : 10}
                      className="w-full resize-y rounded-lg border border-[#2E6B75] bg-[#12151A] p-3 text-[14px] leading-[1.65] text-[#F1F2F4] outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingDraft(false)}
                        className={`${btnSecondary} h-9 px-3 text-xs`}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={savingDraftEdit}
                        onClick={() => void saveInlineDraftEdit()}
                        className={`${btnPrimary} h-9 px-3.5 text-xs`}
                      >
                        {savingDraftEdit ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap px-4 py-3.5 text-[14px] leading-[1.7] text-[#ECEEF2]">
                    {activeMessageText}
                  </div>
                )}
              </div>

              {/* Clean, non-wrapping Action Bar */}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => void copy(activeMessageText, 'primary-copy-btn')}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#F1F2F4] px-4 text-[13px] font-semibold text-[#0E1014] transition hover:opacity-95"
                >
                  <Icon name={copied === 'primary-copy-btn' ? 'check' : 'copy'} size={15} />
                  {copied === 'primary-copy-btn' ? 'Copied to clipboard' : `Copy ${CHANNEL_LABEL[activeChannel].toLowerCase()}`}
                </button>
                <button
                  type="button"
                  onClick={onToggleSent}
                  className={`inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-[13px] font-semibold transition ${
                    isSent
                      ? 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE] hover:bg-[#183D48]'
                      : 'border-[#2F6B4B] bg-[#10261B] text-[#8EE6B6] hover:bg-[#153324]'
                  }`}
                >
                  <Icon name="check" size={14} stroke={2.6} />
                  {isSent ? 'Sent · Undo' : 'Mark as sent'}
                </button>
                <button
                  type="button"
                  disabled={personalising}
                  onClick={() => onPersonalise(leadSettings)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#2A2F39] bg-[#12151A] px-3.5 text-[13px] font-semibold text-[#C9CDD4] transition hover:border-[#3A3F4A] hover:text-[#F1F2F4] disabled:opacity-50"
                >
                  {personalising ? <Spinner size={13} /> : <Icon name="refresh" size={14} />}
                  Rewrite
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackOpen((v) => !v)}
                  className={`inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-[13px] font-semibold transition ${
                    feedbackOpen
                      ? 'border-[#3B3577] bg-[#221F3D] text-[#E2DDFF]'
                      : 'border-[#2A2F39] bg-[#12151A] text-[#C9CDD4] hover:border-[#3A3F4A] hover:text-[#F1F2F4]'
                  }`}
                  title="Give feedback to rewrite this draft and improve future drafts"
                >
                  <Icon name="message" size={14} />
                  Feedback
                </button>
              </div>

              {/* Inline Reviewer Feedback & Rewrite Panel */}
              <DraftFeedbackPanel
                projectId={projectId}
                record={entry.record}
                settings={settings}
                disabled={personalising}
                isOpen={feedbackOpen}
                onToggleOpen={() => setFeedbackOpen((v) => !v)}
                onDraftUpdated={(updatedDraft) => {
                  onDraftUpdated(updatedDraft);
                  setDraftEdits({
                    email: updatedDraft.copy?.email_body ?? '',
                    linkedin: updatedDraft.copy?.linkedin_message ?? '',
                    follow_up: updatedDraft.copy?.follow_up_body ?? '',
                  });
                }}
                onSettingsUpdated={onSettingsUpdated}
              />
            </>
          ) : (
            <>
              <p className="m-0 text-[13px] leading-relaxed text-[#A7ADB8]">
                {isApproved
                  ? 'Generate tailored Email, LinkedIn, WhatsApp, Website form and short Message drafts grounded in this prospect’s verified research.'
                  : 'Approve this prospect first, or generate personalised drafts immediately from their verified research.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={personalising}
                  onClick={() => onPersonalise(leadSettings)}
                  className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#26224A] px-4 text-[13px] font-semibold text-[#CFC8FF] hover:bg-[#322D5E] disabled:opacity-50"
                >
                  {personalising ? <Spinner size={14} /> : <Icon name="sparkle" size={15} />}
                  {personalising ? 'Writing 5 drafts…' : 'Generate outreach drafts'}
                </button>
              </div>
            </>
          )}
        </section>

        {/* About */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">About</h3>
          <p
            className={`m-0 text-sm leading-[1.55] ${
              entry.record.summary ? 'text-[#D5D8DE]' : 'text-[#8A909C]'
            }`}
          >
            {entry.record.summary || 'No profile summary yet. More research would fill this in.'}
          </p>
          {entry.record.reason_for_relevance && (
            <p className="m-0 rounded-xl border border-[#22262E] bg-[#171A20] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#B5D9DE]">
              <strong className="font-semibold text-[#5ED3DF]">Why relevant:</strong> {entry.record.reason_for_relevance}
            </p>
          )}
        </section>

        {/* Research Findings (Work, Achievements, Background) */}
        {bullets.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">
              Research findings · {bullets.length}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 rounded-[14px] border border-[#2A2F39] bg-[#171A20] p-3.5 text-[13px] leading-relaxed text-[#D5D8DE]">
              {bullets.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5ED3DF]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Sources */}
        <section id="detail-sources" className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">
            Sources · {entry.record.sources.length}
          </h3>
          <SourcesList entry={entry} />
        </section>

        {/* Fit with your criteria */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">Fit with your criteria</h3>
          <FitList entry={entry} />
        </section>

        {/* Contact */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">Contact</h3>
            {hasDraft && (
              <button
                type="button"
                onClick={() => onOpenDrafts(defaultDraftChannel)}
                className="h-8 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
              >
                All drafts · {channelTabs.length}
              </button>
            )}
          </div>
          <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#2A2F39] bg-[#171A20]">
            {contactItems.map((item) => (
              <div
                key={item.key}
                className="flex min-h-[52px] items-center gap-2 border-b border-[#22262E] pl-3.5 pr-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px py-2.5">
                  {item.value && item.href ? (
                    <a
                      href={item.href}
                      target={item.href.startsWith('mailto:') ? undefined : '_blank'}
                      rel="noreferrer"
                      className="truncate text-sm text-[#5ED3DF] no-underline hover:underline"
                    >
                      {item.value}
                    </a>
                  ) : (
                    <span
                      className={`truncate text-sm ${
                        item.value ? 'text-[#5ED3DF]' : 'text-[#A7ADB8]'
                      }`}
                    >
                      {item.value || item.missingLabel}
                    </span>
                  )}
                  <span
                    className={`text-xs ${
                      item.value ? 'text-[#8A909C]' : 'text-[#F2C36B]'
                    }`}
                  >
                    {item.sub}
                  </span>
                </span>
                {item.rawValue && (
                  <button
                    type="button"
                    onClick={() => void copy(item.rawValue!, item.key)}
                    aria-label={`Copy ${item.key}`}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-[#A7ADB8] hover:bg-[#1F232B] hover:text-[#F1F2F4]"
                  >
                    {copied === item.key ? '✓' : <Icon name="copy" size={14} />}
                  </button>
                )}
                {hasDraft && (
                  <button
                    type="button"
                    onClick={() => onOpenDrafts(item.channel)}
                    aria-label={`Open ${item.key} draft`}
                    className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border-0 bg-[#26224A] text-[#CFC8FF] hover:bg-[#322D5E]"
                  >
                    <Icon name="message" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <KeyContactsList entry={entry} />
          <div className="text-xs text-[#8A909C]">
            {hasDraft
              ? 'Click any message icon to view, edit and copy the draft for that channel.'
              : isApproved
                ? 'Personalise this prospect to write drafts from their verified facts.'
                : 'Drafts are written once you approve and personalise this prospect.'}
          </div>
        </section>

        {/* Your note */}
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[#A7ADB8]">
            <span>
              Your note <span className="font-normal text-[#8A909C]">· for your team, optional for review, rejection or research</span>
            </span>
            {noteSaved && (
              <span className="inline-flex items-center gap-1 font-medium text-[#5BD69A]">
                <Icon name="check" size={12} stroke={3} /> Saved
              </span>
            )}
          </span>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteSaved(false);
              if (error) setError(null);
            }}
            placeholder="Add an optional note explaining why you approved, rejected or asked for more research."
            className="h-[72px] resize-none rounded-xl border border-[#2A2F39] bg-[#171A20] px-3 py-2.5 text-sm text-[#F1F2F4] outline-none placeholder:text-[#5C616B] focus:border-[#2E6B75]"
          />
        </label>

        {error && (
          <p role="alert" className="m-0 text-[13px] text-[#F7B1AA]">
            {error}
          </p>
        )}
      </div>

      {/* Bottom decision bar */}
      <div className="grid grid-cols-[1fr_1.3fr_1.3fr] gap-2 border-t border-[#22262E] px-6 pb-5 pt-3.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => void commitDecision('rejected')}
          className={`${btnDanger} h-[46px] px-3`}
        >
          Reject
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setMoreResearchOpen(true)}
          className={`${
            verification.state === 'unverified' && !isApproved ? btnPrimary : btnSecondary
          } h-[46px] px-3`}
        >
          More research
        </button>
        {isApproved ? (
          <button
            type="button"
            onClick={onToggleSent}
            className={`inline-flex h-[46px] items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition ${
              isSent
                ? 'border border-[#2E6B75] bg-[#12313A] text-[#9BE6EE] hover:bg-[#183D48]'
                : 'bg-[#5BD69A] text-[#0E1014] hover:opacity-95'
            }`}
          >
            <Icon name="check" size={15} stroke={2.6} />
            {isSent ? 'Sent · Move back' : 'Mark as sent'}
          </button>
        ) : (
          <button
            type="button"
            disabled={saving || personalising}
            onClick={() => {
              if (note.trim() && !noteSaved) {
                void saveDecision(projectId, entry.record.record_id, 'shortlisted', note.trim());
                setNoteSaved(true);
              }
              onPersonalise(leadSettings);
            }}
            className={`${
              verification.state === 'unverified' ? btnSecondary : btnPrimary
            } h-[46px] px-3`}
          >
            {personalising ? 'Personalizing…' : 'Personalize'}
          </button>
        )}
      </div>

      {moreResearchOpen && (
        <MoreResearchDialog
          prospect={name}
          saving={saving}
          error={error}
          onCancel={() => setMoreResearchOpen(false)}
          onSubmit={(instructions) => void commitDecision('enrichment_requested', instructions)}
          onResearchNow={(instructions) => {
            void commitDecision('enrichment_requested', instructions);
            if (onRunResearch) {
              void onRunResearch(instructions);
            }
          }}
        />
      )}
    </aside>
  </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filters Dialog (DFilters)                                           */
/* ------------------------------------------------------------------ */

function FiltersDialog({
  initial,
  targets,
  runDates,
  locations,
  countPreview,
  onClose,
  onApply,
}: {
  initial: FilterState;
  targets: Array<{ id: string; target_type: string }>;
  runDates: Array<[string, number]>;
  locations: string[];
  countPreview: (state: FilterState) => number;
  onClose: () => void;
  onApply: (state: FilterState) => void;
}) {
  const [draft, setDraft] = useState<FilterState>(initial);
  const matchingCount = countPreview(draft);

  return (
    <Dialog label="Filter prospects" onClose={onClose} width={400}>
      <div className="flex items-center justify-between px-[18px] pb-2 pt-4">
        <h1 className="m-0 text-base font-semibold text-[#F1F2F4]">Filters</h1>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_FILTERS)}
          className="h-8 border-0 bg-transparent px-1.5 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col gap-[18px] px-[18px] pb-4 pt-2">
        {/* Type */}
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-[#A7ADB8]">Type</div>
          <div
            role="group"
            aria-label="Type"
            className="grid grid-cols-3 rounded-xl border border-[#2A2F39] bg-[#0E1014] p-[3px]"
          >
            {(
              [
                ['all', 'All'],
                ['person', 'People'],
                ['organisation', 'Organisations'],
              ] as const
            ).map(([id, label]) => {
              const on = draft.entityKind === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft((curr) => ({ ...curr, entityKind: id }))}
                  className={`h-[34px] rounded-[9px] border-0 text-[13px] ${
                    on ? 'bg-[#2A2F39] font-semibold text-[#F1F2F4]' : 'bg-transparent font-medium text-[#A7ADB8]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Target group */}
        {targets.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-[#A7ADB8]">Target group</div>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((target) => {
                const on = draft.targetId === target.id;
                return (
                  <button
                    key={target.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft((curr) => ({ ...curr, targetId: on ? null : target.id }))
                    }
                    className={`h-[34px] rounded-full border px-3 text-[13px] capitalize ${
                      on
                        ? 'border-[#2E6B75] bg-[#12313A] font-semibold text-[#9BE6EE]'
                        : 'border-[#2A2F39] bg-[#0E1014] font-medium text-[#F1F2F4]'
                    }`}
                  >
                    {target.target_type}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Research run */}
        {runDates.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-[#A7ADB8]">Research run</div>
            <div className="flex flex-wrap gap-1.5">
              {runDates.map(([date, count]) => {
                const on = draft.runDate === date;
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((curr) => ({ ...curr, runDate: on ? null : date }))}
                    className={`h-[34px] rounded-full border px-3 text-[13px] ${
                      on
                        ? 'border-[#2E6B75] bg-[#12313A] font-semibold text-[#9BE6EE]'
                        : 'border-[#2A2F39] bg-[#0E1014] font-medium text-[#F1F2F4]'
                    }`}
                  >
                    {date} · {count}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Location + Verified evidence only */}
        <div className="flex flex-col rounded-[14px] border border-[#2A2F39] bg-[#0E1014]">
          <label className="flex h-[46px] items-center justify-between border-b border-[#2A2F39] px-3.5 text-sm font-medium text-[#F1F2F4]">
            <span>Location</span>
            <select
              value={draft.location ?? ''}
              onChange={(event) =>
                setDraft((curr) => ({ ...curr, location: event.target.value || null }))
              }
              className="border-0 bg-transparent text-right text-sm font-medium text-[#9BE6EE] outline-none"
            >
              <option value="" className="bg-[#171A20] text-[#F1F2F4]">
                All locations
              </option>
              {locations.map((loc) => (
                <option key={loc} value={loc} className="bg-[#171A20] text-[#F1F2F4]">
                  {loc}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-[46px] cursor-pointer items-center justify-between px-3.5 text-sm text-[#F1F2F4]">
            <span>Verified evidence only</span>
            <input
              type="checkbox"
              checked={draft.verifiedOnly}
              onChange={(event) =>
                setDraft((curr) => ({ ...curr, verifiedOnly: event.target.checked }))
              }
              className="h-[18px] w-[18px] accent-[#5ED3DF]"
            />
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-[#2A2F39] px-[18px] pb-4 pt-3">
        <button type="button" onClick={onClose} className={`${btnSecondary} h-10 px-3.5`}>
          Cancel
        </button>
        <button type="button" onClick={() => onApply(draft)} className={`${btnPrimary} h-10 px-4`}>
          Show {plural(matchingCount, 'prospect')}
        </button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Research Configuration / Goal, Audiences & Objectives Modal         */
/* ------------------------------------------------------------------ */

type ConfigSectionTab = 'research' | 'overview' | 'fields';

function ResearchConfigModal({
  projectId,
  projectTitle,
  projectSummary,
  revision,
  brief,
  research,
  onClose,
  onSaved,
  onRunAudienceResearch,
}: {
  projectId: string;
  projectTitle: string;
  projectSummary: string;
  revision: number;
  brief: StructuredBrief | null;
  research: ResearchEntry[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onRunAudienceResearch: (targetId: string) => void;
}) {
  const [sectionTab, setSectionTab] = useState<ConfigSectionTab>('research');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveConfiguration = async (updatedBrief: StructuredBrief) => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured_brief: updatedBrief,
          expected_revision: revision,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Could not save the campaign configuration.');
      }
      await onSaved();
      setEditing(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!brief) {
    return (
      <Dialog label="Research configuration" onClose={onClose} width={640}>
        <div className="flex items-center justify-between border-b border-[#2A2F39] px-6 py-4">
          <h2 className={`${serif} m-0 text-xl text-[#F1F2F4]`}>Research configuration</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="p-6">
          <EmptyState
            title="No structured brief saved for this project"
            body="Create a new project from a brief to configure target audiences, research settings and prospect fields."
          />
        </div>
      </Dialog>
    );
  }

  const goalNumber = prospectGoal(brief);
  const objectives = [
    ...brief.project.secondary_objectives,
    ...brief.project.success_metrics,
  ].filter(Boolean);
  const searchSettings = brief.research.search_settings;

  return (
    <Dialog
      label="Research configuration · Goal, audiences & objectives"
      onClose={() => !saving && onClose()}
      width={980}
    >
      {/* Modal Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2A2F39] px-7 py-5">
        <div>
          <span className="text-xs font-semibold tracking-[0.12em] text-[#5ED3DF]">
            GOAL, AUDIENCES &amp; OBJECTIVES
          </span>
          <h2 className={`${serif} m-0 mt-1 text-2xl text-[#F1F2F4]`}>
            {editing ? `Edit ${projectTitle}` : `Research configuration · ${projectTitle}`}
          </h2>
        </div>
        <div className="flex items-center gap-2.5">
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setSaveError(null);
                setEditing(true);
              }}
              className={`${btnSecondary} h-10 px-4 text-[13px]`}
            >
              <Icon name="edit" size={15} /> Edit configuration
            </button>
          )}
          <CloseButton onClick={() => !saving && onClose()} />
        </div>
      </div>

      {editing ? (
        <div className="max-h-[78vh] overflow-y-auto px-7 py-6">
          <CampaignConfigurationForm
            initialBrief={brief}
            originalBrief={projectSummary}
            submitLabel={saving ? 'Saving configuration…' : 'Save configuration'}
            submitting={saving}
            serverError={saveError}
            onCancel={() => setEditing(false)}
            onSubmit={saveConfiguration}
          />
        </div>
      ) : (
        <div className="flex max-h-[78vh] flex-col gap-5 overflow-y-auto px-7 py-6">
          {/* Section tabs matching Goal, audiences & objectives (OverviewView) */}
          <div
            role="tablist"
            aria-label="Research configuration sections"
            className="flex gap-1 border-b border-[#22262E]"
          >
            {(
              [
                ['research', 'Research settings'],
                ['overview', 'Goal, audiences & objectives'],
                ['fields', `Prospect fields · ${brief.database.fields.length}`],
              ] as const
            ).map(([id, label]) => {
              const on = sectionTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSectionTab(id)}
                  className={`h-11 border-0 border-b-2 bg-transparent px-4 text-sm transition-colors ${
                    on
                      ? 'border-[#5ED3DF] font-semibold text-[#F1F2F4]'
                      : 'border-transparent font-medium text-[#A7ADB8] hover:text-[#F1F2F4]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* TAB 1: Research settings */}
          {sectionTab === 'research' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="m-0 text-base font-semibold text-[#F1F2F4]">
                    Research configuration
                  </h3>
                  <p className="m-0 text-sm text-[#A7ADB8]">
                    Controls how the Research agent searches for prospects and verifies evidence.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className={`${btnSecondary} h-9 px-3.5 text-xs`}
                >
                  <Icon name="edit" size={14} /> Edit research settings
                </button>
              </div>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                <div className={`${card} flex flex-col gap-3 p-5`}>
                  <span className="text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                    SEARCH KEYWORDS
                  </span>
                  {searchSettings?.keywords?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {searchSettings.keywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-lg border border-[#2E6B75] bg-[#12313A] px-2.5 py-1 text-xs text-[#9BE6EE]"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-[#8A909C]">
                      Derived automatically from target audiences
                    </span>
                  )}

                  <span className="mt-2 text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                    EXCLUDED KEYWORDS
                  </span>
                  {searchSettings?.excluded_keywords?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {searchSettings.excluded_keywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-lg border border-[#3A303A] bg-[#1C1517] px-2.5 py-1 text-xs text-[#F28B82]"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-[#8A909C]">None specified</span>
                  )}
                </div>

                <div className={`${card} flex flex-col gap-3 p-5`}>
                  <span className="text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                    PREFERRED SOURCE TYPES
                  </span>
                  {brief.research.preferred_source_types.length > 0 ? (
                    <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-sm text-[#C9CDD4]">
                      {brief.research.preferred_source_types.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-sm text-[#8A909C]">
                      Official websites, directories and public profiles
                    </span>
                  )}

                  <span className="mt-2 text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                    DEFAULT BATCH SIZE
                  </span>
                  <span className="text-sm font-semibold text-[#F1F2F4]">
                    {searchSettings?.default_result_limit ?? 10} prospects per run
                  </span>
                </div>

                <div className={`${card} flex flex-col gap-3 p-5`}>
                  <span className="text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                    EVIDENCE &amp; VERIFICATION RULES
                  </span>
                  <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-sm text-[#C9CDD4]">
                    {[
                      ...brief.research.evidence_requirements,
                      ...brief.research.verification_requirements,
                    ].map((req) => (
                      <li key={req}>{req}</li>
                    ))}
                  </ul>
                  <div className="mt-1 rounded-xl border border-[#22262E] bg-[#0E1014] px-3 py-2.5 text-xs text-[#A7ADB8]">
                    <strong className="text-[#F1F2F4]">Unknown handling:</strong>{' '}
                    {brief.research.unknown_handling}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Goal, audiences & objectives */}
          {sectionTab === 'overview' && (
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex min-w-0 flex-[3_1_440px] flex-col gap-5">
                {/* Primary Goal card */}
                <section className="flex flex-col gap-2 rounded-[20px] border border-[#2E6B75] bg-[#12313A] p-[22px]">
                  <h3 className="m-0 text-[11px] font-semibold tracking-[0.12em] text-[#9BE6EE]">
                    PRIMARY GOAL
                  </h3>
                  <p className="m-0 text-lg font-medium leading-[1.4] text-[#F1F2F4]">
                    {brief.project.primary_objective || 'No primary goal specified.'}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2.5 text-[13px] text-[#B5D9DE]">
                    <span
                      aria-hidden="true"
                      className="h-1 max-w-[280px] flex-1 overflow-hidden rounded-sm bg-[#1E4A52]"
                    >
                      <span
                        style={{
                          width: goalNumber
                            ? `${Math.min(100, Math.max(2, Math.round((research.length / goalNumber) * 100)))}%`
                            : research.length > 0
                              ? '25%'
                              : '2%',
                        }}
                        className="block h-1 min-w-[4px] bg-[#5ED3DF]"
                      />
                    </span>
                    <span>
                      {goalNumber
                        ? `${research.length.toLocaleString()} of ${goalNumber.toLocaleString()} found`
                        : `${plural(research.length, 'prospect')} found`}
                    </span>
                  </div>
                </section>

                {/* Objectives list */}
                {objectives.length > 0 && (
                  <section className="flex flex-col gap-2.5">
                    <h3 className="m-0 text-sm font-semibold text-[#A7ADB8]">Objectives</h3>
                    <ol className="m-0 flex list-none flex-col overflow-hidden rounded-[18px] border border-[#2A2F39] bg-[#171A20] p-0">
                      {objectives.map((item, idx) => (
                        <li
                          key={`${idx}-${item}`}
                          className="flex gap-3.5 border-b border-[#2A2F39] px-[18px] py-3.5 text-sm leading-relaxed text-[#F1F2F4] last:border-b-0"
                        >
                          <span className="font-semibold text-[#8A909C]">{idx + 1}</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {/* Constraints & Tone */}
                {(brief.constraints.length > 0 || brief.personalization.tone.length > 0) && (
                  <section className="flex flex-col gap-2.5">
                    <h3 className="m-0 text-sm font-semibold text-[#A7ADB8]">
                      Tone &amp; guardrails
                    </h3>
                    <div className={`${card} flex flex-col gap-3 p-[18px]`}>
                      {brief.personalization.tone.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold text-[#8A909C]">MESSAGE TONE</span>
                          <div className="flex flex-wrap gap-1.5">
                            {brief.personalization.tone.map((t) => (
                              <span
                                key={t}
                                className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {brief.constraints.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold text-[#8A909C]">CONSTRAINTS</span>
                          <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-sm text-[#C9CDD4]">
                            {brief.constraints.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </div>

              {/* Target audiences column */}
              <section
                aria-label="Target audiences"
                className="flex min-w-0 flex-[2_1_300px] flex-col gap-2.5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="m-0 text-sm font-semibold text-[#A7ADB8]">
                    Target audiences · {brief.targets.length}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="h-8 border-0 bg-transparent px-2 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
                  >
                    + Add / Edit
                  </button>
                </div>

                {brief.targets.map((target) => {
                  const foundCount = entriesForTarget(research, target).length;
                  const entityTag =
                    target.entity_kind === 'person'
                      ? 'People'
                      : target.entity_kind === 'organisation'
                        ? 'Organisation'
                        : 'People & Orgs';
                  const geoLabel =
                    target.geography.length > 0
                      ? target.geography.join(', ')
                      : target.geography_mode === 'unrestricted'
                        ? 'Any location'
                        : 'Geography unspecified';

                  return (
                    <article
                      key={target.id}
                      className="flex flex-col gap-2.5 rounded-[18px] border border-[#2A2F39] bg-[#171A20] p-[18px]"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <h4 className="m-0 text-base font-semibold capitalize leading-snug text-[#F1F2F4]">
                          {target.target_type}
                        </h4>
                        <span className="rounded-full bg-[#12313A] px-2.5 py-[3px] text-xs font-semibold capitalize text-[#9BE6EE]">
                          {target.priority === 'unspecified' ? 'Primary' : target.priority}
                        </span>
                      </div>
                      <p className="m-0 text-sm leading-relaxed text-[#A7ADB8]">
                        {target.description}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]">
                          {entityTag}
                        </span>
                        <span className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]">
                          {geoLabel}
                        </span>
                        <span className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]">
                          {plural(target.qualification_criteria.length, 'must-have check')}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between border-t border-[#22262E] pt-2.5 text-xs text-[#8A909C]">
                        <span>{plural(foundCount, 'prospect')} found</span>
                        <button
                          type="button"
                          onClick={() => onRunAudienceResearch(target.id)}
                          className="border-0 bg-transparent p-0 text-xs font-semibold text-[#5ED3DF] hover:underline"
                        >
                          Run research →
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            </div>
          )}

          {/* TAB 3: Prospect fields */}
          {sectionTab === 'fields' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="m-0 text-base font-semibold text-[#F1F2F4]">
                    Prospect fields · {brief.database.fields.length}
                  </h3>
                  <p className="m-0 text-sm text-[#A7ADB8]">
                    Information MARCOM collects and stores for each prospect in this campaign.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className={`${btnSecondary} h-9 px-3.5 text-xs`}
                >
                  <Icon name="edit" size={14} /> Edit prospect fields
                </button>
              </div>

              <div className="overflow-x-auto rounded-[18px] border border-[#2A2F39] bg-[#171A20]">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#A7ADB8]">
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Field
                      </th>
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Purpose
                      </th>
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Source
                      </th>
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Requirement
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {brief.database.fields.map((field) => (
                      <tr key={field.name} className="border-b border-[#22262E] last:border-b-0">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-[#F1F2F4]">
                          {field.name}
                        </td>
                        <td className="px-4 py-3 text-[#C9CDD4]">{field.purpose}</td>
                        <td className="px-4 py-3 capitalize text-[#A7ADB8]">
                          {field.expected_source}
                        </td>
                        <td className="px-4 py-3">
                          <Pill
                            bg={field.required ? '#12313A' : '#1F232B'}
                            fg={field.required ? '#9BE6EE' : '#A7ADB8'}
                          >
                            {field.required ? 'Required' : 'Optional'}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
