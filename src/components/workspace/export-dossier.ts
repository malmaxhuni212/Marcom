import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import { verificationOf, contactsOf } from './format';

interface ExportDossierOptions {
  entry: ResearchEntry;
  draft?: PersonalizationEntry | null;
  projectName?: string;
}

function cleanText(val: string | null | undefined): string {
  return (val ?? '').trim();
}

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return isoString;
  }
}

export function formatFitBand(band: string | null | undefined): string {
  if (!band) return 'Unassessed';
  switch (band.toLowerCase()) {
    case 'highly_relevant':
      return 'Highly Relevant';
    case 'strong':
      return 'Strong Fit';
    case 'possible':
      return 'Possible Fit';
    case 'weak':
      return 'Weak Fit';
    case 'irrelevant':
      return 'Not Relevant';
    default:
      return band.charAt(0).toUpperCase() + band.slice(1).replace(/_/g, ' ');
  }
}

/**
 * Builds a comprehensive, professional Markdown dossier containing all
 * verified intelligence, contacts, criteria assessments, source citations,
 * and outreach drafts for a prospect.
 */
export function buildProspectMarkdownDossier({ entry, draft, projectName }: ExportDossierOptions): string {
  const r = entry.record;
  const name = cleanText(r.identity.name) || cleanText(entry.seed.name) || 'Unnamed Prospect';
  const verification = verificationOf(entry);
  const contacts = contactsOf(entry);

  const lines: string[] = [];

  // -------------------------------------------------------------
  // Header
  // -------------------------------------------------------------
  lines.push(`# Prospect Intelligence Dossier: ${name}`);
  const metaLineParts: string[] = [];
  if (projectName) metaLineParts.push(`**Project:** ${projectName}`);
  if (r.target_type) metaLineParts.push(`**Target Group:** ${r.target_type}`);
  if (r.researched_at) metaLineParts.push(`**Researched:** ${formatDate(r.researched_at)}`);
  if (metaLineParts.length) {
    lines.push(`*${metaLineParts.join(' | ')}*`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // -------------------------------------------------------------
  // 1. Executive Summary
  // -------------------------------------------------------------
  lines.push('## 1. Executive Summary');
  lines.push(`- **Entity Kind:** ${r.identity.entity_kind ?? 'Unknown'}`);
  if (r.role) lines.push(`- **Role / Title:** ${r.role}`);
  if (r.organisation) lines.push(`- **Organisation:** ${r.organisation}`);
  const location = [r.location, r.country].filter(Boolean).join(', ');
  if (location) lines.push(`- **Location:** ${location}`);
  lines.push(`- **Verification Status:** ${verification.label} (${r.research_confidence ?? 'medium'} confidence)`);
  if (r.fit) {
    if (r.fit.band) {
      lines.push(`- **Qualification Rating:** ${formatFitBand(r.fit.band)}`);
    }
    if (r.fit.rationale) {
      lines.push(`- **Fit Rationale:** ${r.fit.rationale}`);
    }
  }
  if (r.reason_for_relevance) {
    lines.push(`- **Reason for Relevance:** ${r.reason_for_relevance}`);
  }
  if (r.summary) {
    lines.push('');
    lines.push('### Overview');
    lines.push(r.summary);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // -------------------------------------------------------------
  // 2. Verified Contact Routes & Channels
  // -------------------------------------------------------------
  lines.push('## 2. Verified Contact Routes');

  const channelRows: Array<{ channel: string; value: string; status: string; source: string }> = [];

  // Public contacts
  for (const c of r.public_contact ?? []) {
    channelRows.push({
      channel: c.kind.toUpperCase(),
      value: c.value,
      status: c.confidence === 'verified' ? 'Verified' : 'Likely',
      source: c.source_ids?.join(', ') || '-',
    });
  }

  // Websites
  for (const w of r.websites ?? []) {
    channelRows.push({
      channel: w.type === 'company' ? 'Company Website' : 'Website',
      value: w.url,
      status: 'Official',
      source: '-',
    });
  }

  // Social profiles
  for (const s of r.social_profiles ?? []) {
    channelRows.push({
      channel: s.platform.toUpperCase(),
      value: s.profile_url,
      status: s.confidence === 'verified' ? 'Verified' : 'Likely',
      source: s.source_ids?.join(', ') || '-',
    });
  }

  if (channelRows.length > 0) {
    lines.push('| Channel | Value / URL | Status | Source IDs |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const row of channelRows) {
      lines.push(`| ${row.channel} | ${row.value} | ${row.status} | ${row.source} |`);
    }
  } else {
    lines.push('*No direct public contact routes discovered.*');
  }

  // Organisation Key Contacts (if present)
  if (r.key_contacts && r.key_contacts.length > 0) {
    lines.push('');
    lines.push('### Organisation Key Contacts & Routes');
    for (const kc of r.key_contacts) {
      const details = [kc.role, kc.department].filter(Boolean).join(' · ');
      lines.push(`- **${kc.name}**${details ? ` (${details})` : ''}`);
      if (kc.email) lines.push(`  - Email: \`${kc.email}\``);
      if (kc.linkedin_url) lines.push(`  - LinkedIn: ${kc.linkedin_url}`);
      if (kc.phone) lines.push(`  - Phone: \`${kc.phone}\``);
      if (kc.relevance) lines.push(`  - Route Relevance: ${kc.relevance}`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // -------------------------------------------------------------
  // 3. Background & Track Record
  // -------------------------------------------------------------
  lines.push('## 3. Professional Background & Track Record');

  const printListSection = (title: string, items: string[] | undefined) => {
    if (items && items.length > 0) {
      lines.push(`### ${title}`);
      for (const item of items) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
  };

  printListSection('Background', r.background);
  printListSection('Key Work & Projects', r.work_and_projects);
  printListSection('Notable Achievements', r.achievements);
  printListSection('Industry Activity', r.industry_activity);

  lines.push('---');
  lines.push('');

  // -------------------------------------------------------------
  // 4. Qualification Criteria & Assessment
  // -------------------------------------------------------------
  lines.push('## 4. Qualification Criteria Assessment');
  if (r.qualification_assessment && r.qualification_assessment.length > 0) {
    lines.push('| Criterion | Status | Finding / Assessment | Evidence Sources |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const q of r.qualification_assessment) {
      const statusBadge = q.status.toUpperCase();
      const sources = q.source_ids?.join(', ') || '-';
      lines.push(`| ${q.criterion} | **${statusBadge}** | ${q.note || '-'} | ${sources} |`);
    }
  } else {
    lines.push('*No specific qualification criteria recorded.*');
  }

  if (r.unknowns && r.unknowns.length > 0) {
    lines.push('');
    lines.push('### Identified Gaps & Unknowns');
    for (const u of r.unknowns) {
      lines.push(`- **${u.field}:** ${u.reason}`);
    }
  }

  if (r.contradictions && r.contradictions.length > 0) {
    lines.push('');
    lines.push('### Flagged Contradictions');
    for (const c of r.contradictions) {
      lines.push(`- ⚠️ ${c}`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // -------------------------------------------------------------
  // 5. Source Evidence & Citations Audit Trail
  // -------------------------------------------------------------
  lines.push('## 5. Source Citations & Evidence Trail');
  if (r.sources && r.sources.length > 0) {
    lines.push('| ID | Title | URL | Retrieved |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const s of r.sources) {
      lines.push(`| **${s.id}** | ${s.title || 'Untitled'} | ${s.url} | ${formatDate(s.retrieved_at)} |`);
    }
  }

  if (r.evidence && r.evidence.length > 0) {
    lines.push('');
    lines.push('### Verified Evidence Items');
    for (const ev of r.evidence) {
      lines.push(`- **${ev.field}** (${ev.confidence}): ${ev.claim}`);
      if (ev.quote) {
        lines.push(`  > *"${ev.quote}"*`);
      }
      lines.push(`  *Sources:* ${ev.source_ids.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // -------------------------------------------------------------
  // 6. Outreach Strategy & Message Drafts (if present)
  // -------------------------------------------------------------
  if (draft?.copy) {
    lines.push('## 6. Outreach Strategy & Personalized Drafts');
    if (draft.strategy) {
      if (draft.strategy.angle) lines.push(`- **Strategy Angle:** ${draft.strategy.angle}`);
      if (draft.strategy.channel_reason) lines.push(`- **Channel Reason:** ${draft.strategy.channel_reason}`);
      if (draft.strategy.avoid && draft.strategy.avoid.length > 0) {
        lines.push(`- **Things to Avoid:** ${draft.strategy.avoid.join('; ')}`);
      }
      if (draft.strategy.human_checks && draft.strategy.human_checks.length > 0) {
        lines.push(`- **Human Checks Before Sending:** ${draft.strategy.human_checks.join('; ')}`);
      }
    }

    if (draft.copy.subject_lines && draft.copy.subject_lines.length > 0) {
      lines.push('');
      lines.push('### Email Subject Line Options');
      draft.copy.subject_lines.forEach((subj, idx) => {
        lines.push(`${idx + 1}. [${subj.style}] ${subj.text}`);
      });
    }

    if (draft.copy.email_body) {
      lines.push('');
      lines.push('### Email Draft');
      lines.push('```text');
      lines.push(draft.copy.email_body);
      lines.push('```');
    }

    if (draft.copy.linkedin_message) {
      lines.push('');
      lines.push('### Short Social / LinkedIn Note');
      lines.push('```text');
      lines.push(draft.copy.linkedin_message);
      lines.push('```');
    }

    if (draft.copy.follow_up_body) {
      lines.push('');
      lines.push('### Follow-up Draft');
      lines.push('```text');
      lines.push(draft.copy.follow_up_body);
      lines.push('```');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // -------------------------------------------------------------
  // 7. Internal Review State
  // -------------------------------------------------------------
  if (entry.review) {
    lines.push('## 7. Internal Review & Notes');
    lines.push(`- **Status:** ${entry.review.status.toUpperCase()}`);
    if (entry.review.reviewed_by) lines.push(`- **Reviewed By:** ${entry.review.reviewed_by}`);
    if (entry.review.reviewed_at) lines.push(`- **Reviewed Date:** ${formatDate(entry.review.reviewed_at)}`);
    if (entry.review.note) {
      lines.push(`- **Reviewer Note:** ${entry.review.note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Triggers a 1-click browser download of the prospect markdown file.
 */
export function downloadProspectMarkdown(options: ExportDossierOptions): void {
  const content = buildProspectMarkdownDossier(options);
  const rawName = options.entry.record.identity.name || options.entry.seed.name || 'prospect';
  const safeFilename = `${rawName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase()}_dossier.md`;

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
