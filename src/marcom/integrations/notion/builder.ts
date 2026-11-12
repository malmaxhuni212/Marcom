import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import { formatFitBand } from '@/components/workspace/export-dossier';
import { contactsOf, verificationOf } from '@/components/workspace/format';

const MAX_RICH_TEXT_LEN = 1950;

const clip = (s: string, max = MAX_RICH_TEXT_LEN) =>
  s.length > max ? `${s.slice(0, max - 3)}...` : s;

/**
 * Splits arbitrarily long text into chunks <= maxLen along paragraph/line/word boundaries
 * so Notion's 2,000-character limit per rich_text segment never truncates copy or throws 400.
 */
export function splitTextChunks(text: string, maxLen = 1850): string[] {
  const cleaned = (text || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  let remaining = cleaned;
  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx < maxLen * 0.4) {
      splitIdx = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIdx < maxLen * 0.4) {
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

/**
 * Notion rejects select option names containing commas or exceeding 100 chars.
 */
export function sanitizeSelectOption(value: string, fallback = 'General'): string {
  const cleaned = (value || '')
    .replace(/,/g, ' ·')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 95 ? cleaned.slice(0, 95).trim() : cleaned;
}

/**
 * Normalizes and validates an HTTP(S) URL for Notion's `{ url }` property and `text.link`.
 */
export function normalizeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let candidate = raw.trim();
  if (!candidate) return null;

  if (!/^https?:\/\//i.test(candidate) && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Normalizes and validates an email address for Notion's `{ email }` property.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^mailto:/i, '').trim();
  if (!cleaned || cleaned.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Normalizes a phone number string for Notion's `{ phone_number }` property.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^tel:/i, '').trim();
  if (!cleaned || cleaned.length > 80) return null;
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* Notion Block & Rich Text Primitives                                */
/* ------------------------------------------------------------------ */

export function richText(
  content: string,
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean; url?: string | null },
) {
  const validUrl = annotations?.url ? normalizeHttpUrl(annotations.url) : null;
  return {
    type: 'text' as const,
    text: {
      content: clip(content || ''),
      ...(validUrl ? { link: { url: validUrl } } : {}),
    },
    annotations: {
      bold: annotations?.bold ?? false,
      italic: annotations?.italic ?? false,
      code: annotations?.code ?? false,
    },
  };
}

export function heading1(text: string) {
  return {
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [richText(text)],
    },
  };
}

export function heading2(text: string) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [richText(text)],
    },
  };
}

export function heading3(text: string) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: {
      rich_text: [richText(text)],
    },
  };
}

export function paragraph(text: string, annotations?: { bold?: boolean; italic?: boolean }) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: text ? [richText(text, annotations)] : [],
    },
  };
}

export function bulletItem(text: string, boldPrefix?: string, linkUrl?: string | null) {
  const elements = [];
  if (boldPrefix) {
    elements.push(richText(boldPrefix, { bold: true }));
  }
  elements.push(richText(text, { url: linkUrl }));
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: elements,
    },
  };
}

export function callout(text: string, emoji = '💡', color = 'default') {
  const chunks = splitTextChunks(text, 1850);
  return {
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji },
      color,
      rich_text: (chunks.length ? chunks : ['']).slice(0, 5).map((c) => richText(c)),
    },
  };
}

export function quote(text: string) {
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: [richText(text)],
    },
  };
}

export function multiChunkQuotes(text: string): any[] {
  const chunks = splitTextChunks(text, 1850);
  if (!chunks.length) return [];
  return chunks.map((chunk) => quote(chunk));
}

export function divider() {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

export function toggle(title: string, children: any[]) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [richText(title, { bold: true })],
      children: children.slice(0, 80),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Campaign Brief Blocks Builder                                      */
/* ------------------------------------------------------------------ */

export interface CampaignBriefSyncStats {
  totalProspects: number;
  shortlistedCount: number;
  draftsReadyCount: number;
  syncedAtIso?: string;
}

export function buildCampaignSummaryCallout(
  brief: StructuredBrief,
  stats?: CampaignBriefSyncStats,
) {
  const p = brief.project;
  const lines = [
    `Primary Objective: ${p.primary_objective || p.description || 'Campaign outreach and partner discovery'}`,
  ];

  if (stats) {
    const syncDate = stats.syncedAtIso
      ? new Date(stats.syncedAtIso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : null;
    lines.push(
      `Pipeline Snapshot: ${stats.totalProspects} researched prospects · ${stats.shortlistedCount} shortlisted · ${stats.draftsReadyCount} personalized outreach drafts ready${syncDate ? ` · Synced ${syncDate}` : ''}`,
    );
  }

  return callout(lines.join('\n'), '🎯', 'blue_background');
}

export function buildCampaignBriefBlocks(
  brief: StructuredBrief,
  stats?: CampaignBriefSyncStats,
): any[] {
  const blocks: any[] = [];
  const p = brief.project;

  blocks.push(buildCampaignSummaryCallout(brief, stats));

  if (p.description && p.description !== p.primary_objective) {
    blocks.push(paragraph(p.description));
  }

  if (p.secondary_objectives?.length) {
    const objChildren = p.secondary_objectives.map((o) => bulletItem(o));
    blocks.push(toggle('Secondary Objectives', objChildren));
  }

  if (p.success_metrics?.length) {
    const metricChildren = p.success_metrics.map((m) => bulletItem(m));
    blocks.push(toggle('Success Metrics', metricChildren));
  }

  const guardrailItems: any[] = [];
  if (brief.outreach?.channels?.length) {
    guardrailItems.push(bulletItem(brief.outreach.channels.join(', '), 'Outreach Channels: '));
  }
  if (brief.personalization?.tone?.length) {
    guardrailItems.push(bulletItem(brief.personalization.tone.join(', '), 'Tone & Voice: '));
  }
  for (const constraint of brief.constraints || []) {
    guardrailItems.push(bulletItem(constraint, 'Constraint: '));
  }
  if (guardrailItems.length > 0) {
    blocks.push(toggle('Outreach Channels, Tone & Guardrails', guardrailItems));
  }

  if (brief.targets?.length) {
    blocks.push(heading2('Target Audiences & Qualification'));

    for (const t of brief.targets) {
      const targetBlocks: any[] = [];
      if (t.description) {
        targetBlocks.push(paragraph(`Target Description: ${t.description}`));
      }
      if (t.geography?.length) {
        targetBlocks.push(bulletItem(t.geography.join(', '), 'Geographies: '));
      }
      if (t.qualification_criteria?.length) {
        targetBlocks.push(paragraph('Qualification Criteria:', { bold: true }));
        for (const qc of t.qualification_criteria) {
          targetBlocks.push(bulletItem(qc.text));
        }
      }
      if (t.exclusion_criteria?.length) {
        targetBlocks.push(paragraph('Exclusions (Hard Disqualifiers):', { bold: true }));
        for (const exc of t.exclusion_criteria) {
          targetBlocks.push(bulletItem(`⚠️ ${exc.text}`));
        }
      }

      blocks.push(
        toggle(
          `Target Group: ${t.target_type} (${t.entity_kind}) — Priority: ${(t.priority || 'primary').toUpperCase()}`,
          targetBlocks.length ? targetBlocks : [paragraph('Standard campaign qualification rules apply.')],
        ),
      );
    }
  }

  blocks.push(divider());
  blocks.push(heading2('👥 Prospects & Personalized Outreach'));
  blocks.push(
    paragraph(
      'Scroll right in the table to read Top Subject Line, Primary Email Draft, and LinkedIn / DM Draft inline — or hover any Prospect name and click OPEN to inspect the full multi-channel outreach suite and verified source dossier.',
      { italic: true },
    ),
  );
  return blocks;
}

/* ------------------------------------------------------------------ */
/* Prospects Database Schema Definition                               */
/* ------------------------------------------------------------------ */

export function buildProspectsDatabaseProperties(): Record<string, any> {
  return {
    Prospect: { title: {} },
    'Qualification Rating': {
      select: {
        options: [
          { name: 'Highly Relevant', color: 'green' },
          { name: 'Strong Fit', color: 'blue' },
          { name: 'Possible Fit', color: 'yellow' },
          { name: 'Weak Fit', color: 'orange' },
          { name: 'Not Relevant', color: 'gray' },
          { name: 'Unassessed', color: 'default' },
        ],
      },
    },
    'Fit Score': {
      number: { format: 'number' },
    },
    Verification: {
      select: {
        options: [
          { name: 'Verified', color: 'green' },
          { name: 'Sources found', color: 'blue' },
          { name: 'Partially verified', color: 'yellow' },
          { name: 'Limited evidence', color: 'orange' },
          { name: 'Needs verification', color: 'gray' },
        ],
      },
    },
    'Review Status': {
      select: {
        options: [
          { name: 'Needs Review', color: 'yellow' },
          { name: 'Personalized', color: 'green' },
          { name: 'Shortlisted', color: 'green' },
          { name: 'Sent / Contacted', color: 'blue' },
          { name: 'More Research Needed', color: 'orange' },
          { name: 'Rejected', color: 'red' },
          { name: 'Removed in Marcom', color: 'gray' },
        ],
      },
    },
    'Outreach Status': {
      select: {
        options: [
          { name: 'Approved', color: 'green' },
          { name: 'Draft Ready', color: 'purple' },
          { name: 'Needs Revision', color: 'orange' },
          { name: 'Rejected', color: 'red' },
          { name: 'Sent', color: 'blue' },
          { name: 'Pending Generation', color: 'default' },
        ],
      },
    },
    Entity: {
      select: {
        options: [
          { name: 'Person', color: 'blue' },
          { name: 'Organisation', color: 'orange' },
        ],
      },
    },
    'Target Segment': {
      select: {},
    },
    'Best Channel': {
      select: {
        options: [
          { name: 'Email', color: 'green' },
          { name: 'LinkedIn', color: 'blue' },
          { name: 'Contact Form', color: 'purple' },
          { name: 'Phone', color: 'yellow' },
          { name: 'Website', color: 'gray' },
          { name: 'Research Needed', color: 'default' },
        ],
      },
    },
    'Top Subject Line': { rich_text: {} },
    'Primary Email Draft': { rich_text: {} },
    'LinkedIn / DM Draft': { rich_text: {} },
    'Role / Title': { rich_text: {} },
    Organisation: { rich_text: {} },
    Location: { rich_text: {} },
    Email: { email: {} },
    Phone: { phone_number: {} },
    LinkedIn: { url: {} },
    Website: { url: {} },
    Sources: { number: { format: 'number' } },
    'Researched Date': { date: {} },
    'Record ID': { rich_text: {} },
  };
}

export function buildProspectsDatabaseSchema(parentPageId: string) {
  return {
    parent: {
      type: 'page_id',
      page_id: parentPageId,
    },
    icon: { type: 'emoji', emoji: '👥' },
    title: [richText('Prospects Review Database')],
    properties: buildProspectsDatabaseProperties(),
  };
}

/* ------------------------------------------------------------------ */
/* Prospect Database Row Properties Builder                           */
/* ------------------------------------------------------------------ */

function resolveBestChannelLabel(
  entry: ResearchEntry,
  draft?: PersonalizationEntry,
): string {
  const contacts = contactsOf(entry);
  const recChannel = (draft?.strategy as Record<string, any> | null | undefined)?.recommended_channel;
  if (recChannel === 'email') return 'Email';
  if (recChannel === 'linkedin') return 'LinkedIn';
  if (recChannel === 'contact_form') return 'Contact Form';
  if (recChannel === 'phone') return 'Phone';

  if (normalizeEmail(contacts.email)) return 'Email';
  if (normalizeHttpUrl(contacts.linkedin)) return 'LinkedIn';
  if (normalizeHttpUrl(contacts.contactForm)) return 'Contact Form';
  if (normalizePhone(contacts.phone)) return 'Phone';
  if (normalizeHttpUrl(contacts.website)) return 'Website';
  return 'Research Needed';
}

export function buildProspectPageProperties(
  entry: ResearchEntry,
  draft?: PersonalizationEntry,
): Record<string, any> {
  const r = entry.record;
  const name = (r.identity?.name || entry.seed?.name || 'Unnamed Prospect').trim();
  const contacts = contactsOf(entry);
  const verification = verificationOf(entry);
  const location = [r.location, r.country].filter(Boolean).join(', ');

  const ratingLabel = sanitizeSelectOption(formatFitBand(r.fit?.band), 'Unassessed');
  const verificationLabel = sanitizeSelectOption(verification.label, 'Sources found');

  let reviewStatus = 'Needs Review';
  if (entry.relationship_status === 'contacted') {
    reviewStatus = 'Sent / Contacted';
  } else if (entry.review?.status === 'rejected') {
    reviewStatus = 'Rejected';
  } else if (entry.review?.status === 'enrichment_requested') {
    reviewStatus = 'More Research Needed';
  } else if (entry.review?.status === 'shortlisted' || Boolean(draft?.copy)) {
    reviewStatus = 'Personalized';
  }

  let outreachStatus = 'Pending Generation';
  if (entry.relationship_status === 'contacted') {
    outreachStatus = 'Sent';
  } else if (draft?.copy) {
    if (draft.status === 'approved') {
      outreachStatus = 'Approved';
    } else if (draft.status === 'needs_more_research') {
      outreachStatus = 'Needs Revision';
    } else if (draft.status === 'rejected') {
      outreachStatus = 'Rejected';
    } else {
      outreachStatus = 'Draft Ready';
    }
  }

  const topSubject = draft?.copy?.subject_lines?.[0]?.text || '';
  const primaryEmailChunks = draft?.copy?.email_body
    ? splitTextChunks(draft.copy.email_body, 1850).slice(0, 5)
    : [];
  const linkedinChunks = draft?.copy?.linkedin_message
    ? splitTextChunks(draft.copy.linkedin_message, 1850).slice(0, 2)
    : [];

  // Also check named key_contacts if primary contact is absent on an organisation record
  const fallbackKeyEmail = r.key_contacts?.find((k) => normalizeEmail(k.email))?.email ?? null;
  const fallbackKeyLinkedIn =
    r.key_contacts?.find((k) => normalizeHttpUrl(k.linkedin_url))?.linkedin_url ?? null;

  const validEmail = normalizeEmail(contacts.email) || normalizeEmail(fallbackKeyEmail);
  const validPhone = normalizePhone(contacts.phone);
  const validLinkedin =
    normalizeHttpUrl(contacts.linkedin) || normalizeHttpUrl(fallbackKeyLinkedIn);
  const validWebsite =
    normalizeHttpUrl(contacts.website) || normalizeHttpUrl(contacts.contactForm);

  const entityName = r.identity?.entity_kind === 'organisation' ? 'Organisation' : 'Person';
  const bestChannel = resolveBestChannelLabel(entry, draft);

  const props: Record<string, any> = {
    Prospect: {
      title: [richText(name)],
    },
    'Qualification Rating': {
      select: { name: ratingLabel },
    },
    Verification: {
      select: { name: verificationLabel },
    },
    'Review Status': {
      select: { name: reviewStatus },
    },
    'Outreach Status': {
      select: { name: outreachStatus },
    },
    Entity: {
      select: { name: entityName },
    },
    'Best Channel': {
      select: { name: bestChannel },
    },
    Sources: {
      number: Array.isArray(r.sources) ? r.sources.length : 0,
    },
    'Record ID': {
      rich_text: [richText(r.record_id)],
    },
  };

  if (typeof r.fit?.score === 'number' && Number.isFinite(r.fit.score)) {
    props['Fit Score'] = { number: Math.round(r.fit.score) };
  }

  if (r.target_type?.trim()) {
    props['Target Segment'] = { select: { name: sanitizeSelectOption(r.target_type) } };
  }

  props['Role / Title'] = { rich_text: r.role ? [richText(r.role)] : [] };
  props['Organisation'] = { rich_text: r.organisation ? [richText(r.organisation)] : [] };
  props['Location'] = { rich_text: location ? [richText(location)] : [] };
  props['Top Subject Line'] = { rich_text: topSubject ? [richText(topSubject)] : [] };
  props['Primary Email Draft'] = {
    rich_text: primaryEmailChunks.map((chunk) => richText(chunk)),
  };
  props['LinkedIn / DM Draft'] = {
    rich_text: linkedinChunks.map((chunk) => richText(chunk)),
  };

  // Notion API 2022-06-28 strictly requires typed property objects ({ email }, { url }, { phone_number })
  if (validEmail) {
    props.Email = { email: validEmail };
  }
  if (validPhone) {
    props.Phone = { phone_number: validPhone };
  }
  if (validLinkedin) {
    props.LinkedIn = { url: validLinkedin };
  }
  if (validWebsite) {
    props.Website = { url: validWebsite };
  }

  if (r.researched_at) {
    const parsedDate = new Date(r.researched_at);
    if (!Number.isNaN(parsedDate.getTime())) {
      const isoDate = parsedDate.toISOString().split('T')[0]!;
      props['Researched Date'] = { date: { start: isoDate } };
    }
  }

  return props;
}

/* ------------------------------------------------------------------ */
/* Prospect Page Dossier Body Blocks Builder                          */
/* ------------------------------------------------------------------ */

export interface ProspectBodyBlockOptions {
  /** Optional revision or sync notice shown inside the Outreach Strategy callout */
  syncNote?: string | null;
  /** Optional top-of-page banner warning (e.g. when a prospect was removed in Marcom) */
  statusBanner?: string | null;
  /** Optional backup of a previous draft before Marcom regeneration */
  previousDraftBackup?: {
    subjectLine?: string | null;
    emailBody: string;
    linkedinMessage?: string | null;
    savedAtIso?: string;
  } | null;
}

export function buildProspectSummaryCallout(
  entry: ResearchEntry,
  statusBanner?: string | null,
) {
  const r = entry.record;
  const verification = verificationOf(entry);
  const fitScorePart =
    typeof r.fit?.score === 'number'
      ? `Fit Rating: ${formatFitBand(r.fit?.band)} (${Math.round(r.fit.score)}/100)`
      : `Fit Rating: ${formatFitBand(r.fit?.band)}`;

  const summaryCalloutText = [
    statusBanner || null,
    `Verification Status: ${verification.label} (${r.research_confidence ?? 'medium'} confidence) · ${fitScorePart}`,
    r.fit?.rationale ? `Fit Rationale: ${r.fit.rationale}` : null,
    r.reason_for_relevance ? `Why Relevant: ${r.reason_for_relevance}` : null,
    entry.review?.note ? `Reviewer Note: ${entry.review.note}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return callout(
    summaryCalloutText,
    statusBanner ? '⚠️' : '🛡️',
    statusBanner ? 'yellow_background' : 'gray_background',
  );
}

export function buildProspectPageBodyBlocks(
  entry: ResearchEntry,
  draft?: PersonalizationEntry,
  options?: ProspectBodyBlockOptions,
): any[] {
  const r = entry.record;
  const contacts = contactsOf(entry);
  const blocks: any[] = [];

  // 1. Executive Summary Callout
  blocks.push(buildProspectSummaryCallout(entry, options?.statusBanner));

  // 2. Personalized Outreach Strategy & Message Drafts — placed FIRST at top of page body for immediate review
  blocks.push(heading2('✉️ Personalized Outreach Strategy & Drafts'));

  if (draft?.copy) {
    const strat = (draft.strategy || {}) as Record<string, any>;
    const hooks = Array.isArray(strat.hooks) ? strat.hooks : [];
    const primaryHook =
      hooks.find((h: any) => h?.id === strat.primary_hook_id) ||
      hooks[0] ||
      strat.hook ||
      null;

    let revisionLine: string | null = options?.syncNote || null;
    if (!revisionLine && draft.updated_at && draft.generated_at) {
      const genMs = Date.parse(draft.generated_at);
      const updMs = Date.parse(draft.updated_at);
      if (
        (Number.isFinite(genMs) && Number.isFinite(updMs) && updMs - genMs > 5000) ||
        draft.edited_by_human ||
        (draft.auto_revisions ?? 0) > 0
      ) {
        const formattedTime = new Date(draft.updated_at)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 16);
        const editSource = draft.edited_by_human ? 'Human-edited' : 'Regenerated in Marcom';
        revisionLine = `🔄 ${editSource} (${formattedTime} UTC) — earlier inline comments on the draft below may refer to a previous version.`;
      }
    }

    const strategyParts = [
      revisionLine,
      strat.recommended_channel
        ? `📬 Recommended Channel: ${String(strat.recommended_channel).toUpperCase()}${strat.channel_reason ? ` — ${strat.channel_reason}` : ''}`
        : null,
      strat.angle ? `🎯 Outreach Angle: ${strat.angle}` : null,
      primaryHook?.fact ? `💡 Verified Hook: ${primaryHook.fact}` : null,
      strat.recipient_incentive ? `🎁 Recipient Incentive: ${strat.recipient_incentive}` : null,
      Array.isArray(strat.avoid) && strat.avoid.length
        ? `⚠️ Guardrails / Avoid: ${strat.avoid.join('; ')}`
        : null,
      Array.isArray(strat.human_checks) && strat.human_checks.length
        ? `🔍 Checks Before Sending: ${strat.human_checks.join('; ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    if (strategyParts) {
      blocks.push(callout(strategyParts, '🎯', 'blue_background'));
    }

    if (draft.copy.subject_lines?.length) {
      blocks.push(heading3('Subject Line Options'));
      for (const subj of draft.copy.subject_lines) {
        blocks.push(bulletItem(subj.text, `[${subj.style.toUpperCase()}] `));
      }
    }

    if (draft.copy.email_body) {
      blocks.push(heading3('Primary Email Draft'));
      blocks.push(...multiChunkQuotes(draft.copy.email_body));
    }

    if (draft.copy.linkedin_message) {
      blocks.push(heading3('LinkedIn / Direct Message'));
      blocks.push(...multiChunkQuotes(draft.copy.linkedin_message));
    }

    if (draft.copy.follow_up_body) {
      blocks.push(
        toggle(
          'Follow-Up Email (4–6 Days Later)',
          multiChunkQuotes(draft.copy.follow_up_body),
        ),
      );
    }

    if (draft.copy.alternative_opening) {
      blocks.push(
        toggle(
          'Alternative Opening Option',
          multiChunkQuotes(draft.copy.alternative_opening),
        ),
      );
    }

    if (
      options?.previousDraftBackup?.emailBody &&
      options.previousDraftBackup.emailBody.trim() !== (draft.copy.email_body || '').trim()
    ) {
      const backupChildren: any[] = [];
      if (options.previousDraftBackup.subjectLine) {
        backupChildren.push(
          paragraph(`Previous Subject: ${options.previousDraftBackup.subjectLine}`, {
            bold: true,
          }),
        );
      }
      backupChildren.push(...multiChunkQuotes(options.previousDraftBackup.emailBody));
      if (options.previousDraftBackup.linkedinMessage) {
        backupChildren.push(
          paragraph(`Previous LinkedIn / DM: ${options.previousDraftBackup.linkedinMessage}`),
        );
      }
      blocks.push(
        toggle(
          '🕘 Previous Draft Version (Preserved before regeneration)',
          backupChildren,
        ),
      );
    }
  } else {
    blocks.push(
      callout(
        'Personalized outreach drafts have not been generated for this prospect yet. Click "Personalize" on this lead in the Marcom workspace — it will automatically sync all 5 message channels here.',
        '⏳',
        'default',
      ),
    );
  }

  blocks.push(divider());

  if (r.summary) {
    blocks.push(heading3('Executive Overview'));
    for (const chunk of splitTextChunks(r.summary, 1850)) {
      blocks.push(paragraph(chunk));
    }
  }

  // 3. Verified Contact Routes & Key Decision-Makers
  blocks.push(heading3('Verified Contact Routes'));
  let hasAnyRoute = false;

  if (contacts.email) {
    blocks.push(bulletItem(contacts.email, 'Email: '));
    hasAnyRoute = true;
  }
  if (contacts.phone) {
    blocks.push(bulletItem(contacts.phone, 'Phone: '));
    hasAnyRoute = true;
  }
  if (contacts.linkedin) {
    blocks.push(bulletItem(contacts.linkedin, 'LinkedIn: ', contacts.linkedin));
    hasAnyRoute = true;
  }
  if (contacts.website) {
    blocks.push(bulletItem(contacts.website, 'Website: ', contacts.website));
    hasAnyRoute = true;
  }
  if (contacts.contactForm) {
    blocks.push(bulletItem(contacts.contactForm, 'Contact Form: ', contacts.contactForm));
    hasAnyRoute = true;
  }
  if (contacts.extraSocials?.length) {
    for (const sc of contacts.extraSocials) {
      blocks.push(bulletItem(sc.url, `${sc.label}: `, sc.url));
      hasAnyRoute = true;
    }
  }

  if (r.key_contacts?.length) {
    blocks.push(paragraph('Named Decision-Makers / Key Contacts:', { bold: true }));
    for (const kc of r.key_contacts) {
      const details = [
        kc.role || null,
        kc.email || null,
        kc.linkedin_url || null,
      ]
        .filter(Boolean)
        .join(' · ');
      blocks.push(
        bulletItem(
          details ? `${kc.name} — ${details}` : kc.name,
          '👤 ',
          kc.linkedin_url || null,
        ),
      );
      hasAnyRoute = true;
    }
  }

  if (!hasAnyRoute) {
    blocks.push(paragraph('No verified direct contact routes found in public sources yet.'));
  }

  blocks.push(divider());

  // 4. Background & Track Record
  if (
    r.background?.length ||
    r.work_and_projects?.length ||
    r.achievements?.length ||
    r.industry_activity?.length
  ) {
    blocks.push(heading3('Professional Background & Track Record'));
    for (const bg of r.background || []) blocks.push(bulletItem(bg));
    for (const wp of r.work_and_projects || []) blocks.push(bulletItem(wp, 'Key Work: '));
    for (const ac of r.achievements || []) blocks.push(bulletItem(ac, 'Achievement: '));
    for (const ia of r.industry_activity || []) blocks.push(bulletItem(ia, 'Industry Activity: '));
  }

  // 5. Qualification Criteria Assessment
  if (r.qualification_assessment?.length) {
    const criteriaItems = r.qualification_assessment.map((q) => {
      const mark = q.status === 'met' ? '✅' : q.status === 'not_met' ? '❌' : '⚠️';
      return bulletItem(
        `${mark} [${q.status.toUpperCase()}] ${q.criterion}${q.note ? ` — ${q.note}` : ''}`,
      );
    });
    blocks.push(toggle(`Qualification Criteria Assessment (${criteriaItems.length})`, criteriaItems));
  }

  // 6. Contradictions & Open Unknowns (if any)
  if (r.contradictions?.length || r.unknowns?.length) {
    const flagItems: any[] = [];
    for (const c of r.contradictions || []) {
      flagItems.push(bulletItem(c, '⚠️ Contradiction: '));
    }
    for (const u of r.unknowns || []) {
      const text =
        typeof u === 'string'
          ? u
          : `${u.field}: ${u.reason}`;
      flagItems.push(bulletItem(text, '❓ Unconfirmed: '));
    }
    blocks.push(toggle(`Flagged Unknowns & Contradictions (${flagItems.length})`, flagItems));
  }

  // 7. Source Evidence Trail
  if (r.evidence?.length) {
    const evItems = r.evidence.map((ev) => {
      const srcTag = ev.source_ids?.length ? ` (${ev.source_ids.join(', ')})` : '';
      const quoteText = ev.quote ? `\n"${ev.quote}"` : '';
      return bulletItem(`[${ev.confidence.toUpperCase()}]${srcTag} ${ev.claim}${quoteText}`);
    });
    blocks.push(toggle(`Verified Claims & Evidence Quotes (${r.evidence.length})`, evItems));
  }

  // 8. Clickable Source Citations
  if (r.sources?.length) {
    const sourceItems = r.sources.map((src) => {
      const label = `${src.title || src.url} (${src.source_type || 'web'})`;
      return bulletItem(label, `[${src.id}] `, src.url);
    });
    blocks.push(toggle(`Primary Source Links (${r.sources.length})`, sourceItems));
  }

  return blocks;
}
