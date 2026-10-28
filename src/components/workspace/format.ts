/**
 * Presentation helpers for the MARCOM workspace UI.
 * Pure functions only: they read research / personalization records and never invent data.
 */
import type { KeyContact, ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import type { StructuredBrief, Target } from '@/marcom/schemas/structured-brief';
import { reviewStatus } from '@/marcom/research/review';

export const prospectName = (entry: ResearchEntry): string =>
  entry.record.identity.name?.trim() || entry.seed.name?.trim() || 'Unnamed prospect';

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  return letters || '?';
}

export function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function longDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  return shortDate(iso);
}

export function hostOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const plural = (count: number, word: string, pluralWord = `${word}s`) =>
  `${count} ${count === 1 ? word : pluralWord}`;

/* ------------------------------------------------------------------ */
/* Review status                                                       */
/* ------------------------------------------------------------------ */

export const STATUS_META: Record<ReviewStatus, { label: string; bg: string; fg: string }> = {
  needs_review: { label: 'To review', bg: '#3A2F17', fg: '#F2C36B' },
  shortlisted: { label: 'Personalized', bg: '#10261B', fg: '#8EE6B6' },
  enrichment_requested: { label: 'More research', bg: '#12313A', fg: '#9BE6EE' },
  rejected: { label: 'Rejected', bg: '#2A1715', fg: '#F7B1AA' },
};

export { reviewStatus };

/* ------------------------------------------------------------------ */
/* Contacts & verification                                             */
/* ------------------------------------------------------------------ */

export interface ProspectContacts {
  email: string | null;
  emailOwner: string | null;
  phone: string | null;
  contactForm: string | null;
  linkedin: string | null;
  linkedinOwner: string | null;
  website: string | null;
  keyContacts: KeyContact[];
}

function formatPersonLabel(person: KeyContact): string {
  const role = [person.role, person.department].filter(Boolean).join(', ');
  return role ? `${person.name} (${role})` : person.name;
}

export function contactsOf(entry: ResearchEntry): ProspectContacts {
  const record = entry.record;
  const keyContacts = record.key_contacts ?? [];
  const contact = (kind: string) => record.public_contact?.find((item) => item.kind === kind)?.value ?? null;

  const directEmail = contact('email');
  const personWithEmail = !directEmail ? keyContacts.find((person) => Boolean(person.email)) : undefined;

  const orgLinkedin = record.social_profiles?.find((profile) => profile.platform === 'linkedin')?.profile_url ?? null;
  const personWithLinkedin = !orgLinkedin ? keyContacts.find((person) => Boolean(person.linkedin_url)) : undefined;

  const directPhone = contact('phone');
  const personWithPhone = !directPhone ? keyContacts.find((person) => Boolean(person.phone)) : undefined;

  return {
    email: directEmail ?? personWithEmail?.email ?? null,
    emailOwner: personWithEmail ? formatPersonLabel(personWithEmail) : null,
    phone: directPhone ?? personWithPhone?.phone ?? null,
    contactForm: contact('contact_form'),
    linkedin: orgLinkedin ?? personWithLinkedin?.linkedin_url ?? null,
    linkedinOwner: personWithLinkedin ? formatPersonLabel(personWithLinkedin) : null,
    website: record.websites?.[0]?.url ?? null,
    keyContacts,
  };
}

export function contactSummary(entry: ResearchEntry): string {
  const c = contactsOf(entry);
  const found = [
    c.email && 'Email',
    c.linkedin && 'LinkedIn',
    (c.website || c.contactForm) && 'Website',
    c.phone && 'Phone',
  ].filter(Boolean);
  return found.length ? found.join(' · ') : 'None found';
}

export interface Verification {
  state: 'verified' | 'partial' | 'unverified';
  sourceCount: number;
  label: string;
  color: string;
}

export function verificationOf(entry: ResearchEntry): Verification {
  const sourceCount = entry.record.sources?.length ?? 0;
  const evidenceCount = entry.record.evidence?.length ?? 0;
  if (entry.record.identity.identity_verified && evidenceCount > 0 && sourceCount > 0) {
    return { state: 'verified', sourceCount, label: `Verified · ${plural(sourceCount, 'source')}`, color: '#5BD69A' };
  }
  if (evidenceCount > 0 && sourceCount > 0) {
    return { state: 'partial', sourceCount, label: `Partly verified · ${plural(sourceCount, 'source')}`, color: '#9BE6EE' };
  }
  return { state: 'unverified', sourceCount, label: 'Not verified', color: '#F2C36B' };
}

export function locationOf(entry: ResearchEntry): string | null {
  return entry.record.location || entry.record.country || null;
}

export function targetFor(brief: StructuredBrief | null | undefined, entry: ResearchEntry): Target | undefined {
  if (!brief) return undefined;
  return (
    brief.targets.find((target) => target.id === entry.record.brief_target_id) ??
    brief.targets.find((target) => target.target_type.toLowerCase() === entry.record.target_type.toLowerCase())
  );
}

export function entriesForTarget(entries: ResearchEntry[], target: Target): ResearchEntry[] {
  return entries.filter(
    (entry) =>
      entry.record.brief_target_id === target.id ||
      entry.record.target_type.toLowerCase() === target.target_type.toLowerCase(),
  );
}

/** Which fields each source supported, derived from the evidence list. */
export function sourceUsage(entry: ResearchEntry, sourceId: string): string[] {
  return [
    ...new Set(
      entry.record.evidence
        .filter((item) => item.source_ids.includes(sourceId))
        .map((item) => item.field.replace(/_/g, ' ')),
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Goal parsing                                                        */
/* ------------------------------------------------------------------ */

/** Pulls an explicit numeric prospect goal (e.g. "about 2,000 qualified prospects") from the brief, if stated. */
export function prospectGoal(brief: StructuredBrief | null | undefined): number | null {
  if (!brief) return null;
  const text = [brief.project.primary_objective, ...brief.project.success_metrics, ...brief.project.secondary_objectives].join(' \n ');
  const match = text.match(
    /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:\+\s*)?(?:[a-z-]+\s+){0,3}?(prospects|leads|contacts|partners|partnerships|people|organisations|organizations|companies|sponsors|creators|authors|investors|candidates|venues|customers)/i,
  );
  if (!match) return null;
  const value = Number.parseInt(match[1]!.replace(/,/g, ''), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/* ------------------------------------------------------------------ */
/* Personalization helpers                                             */
/* ------------------------------------------------------------------ */

export type DraftChannel = 'email' | 'linkedin' | 'whatsapp' | 'website_form' | 'follow_up';

export interface DraftTargets {
  email: string | null;
  linkedin: string | null;
  website: string | null;
  phone: string | null;
}

export function draftTargets(entry: PersonalizationEntry, researchEntry?: ResearchEntry | null): DraftTargets {
  const audit = entry.strategy?.contact_audit;
  const candidates = entry.candidate_contacts;
  const best = audit?.best_contact_target ?? '';
  const fallbackContacts = researchEntry ? contactsOf(researchEntry) : null;
  return {
    email:
      (best.includes('@') ? best : null) ??
      candidates?.emails?.[0] ??
      (audit?.backup_route?.includes('@') ? audit.backup_route : null) ??
      fallbackContacts?.email ??
      null,
    linkedin:
      (best.includes('linkedin.com') ? best : null) ??
      candidates?.linkedin_urls?.[0] ??
      fallbackContacts?.linkedin ??
      null,
    website:
      candidates?.websites?.[0] ??
      (best.startsWith('http') && !best.includes('linkedin.com') ? best : null) ??
      fallbackContacts?.contactForm ??
      fallbackContacts?.website ??
      null,
    phone: candidates?.phones?.[0] ?? fallbackContacts?.phone ?? null,
  };
}

/** The primary channel MARCOM recommends for this draft, limited to channels we actually wrote copy for. */
export function primaryChannel(entry: PersonalizationEntry, researchEntry?: ResearchEntry | null): DraftChannel {
  const targets = draftTargets(entry, researchEntry);
  const recommended = (entry.strategy?.contact_audit?.best_channel || entry.strategy?.recommended_channel || '').toLowerCase();
  if (recommended.includes('linkedin') && targets.linkedin) return 'linkedin';
  if ((recommended.includes('form') || recommended.includes('website')) && targets.website) return 'website_form';
  if (recommended.includes('phone') && targets.phone) return 'whatsapp';
  if (targets.email) return 'email';
  if (targets.linkedin) return 'linkedin';
  if (targets.website) return 'website_form';
  return 'email';
}

export const CHANNEL_LABEL: Record<DraftChannel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  website_form: 'Website form',
  follow_up: 'Message',
};

export function hasContactFor(entry: PersonalizationEntry, researchEntry?: ResearchEntry | null): boolean {
  const targets = draftTargets(entry, researchEntry);
  return Boolean(targets.email || targets.linkedin || targets.website || targets.phone);
}

function sanitizeDisplayCopy(raw: string): string {
  return raw
    .replace(/\*+([^*\n]+)\*+/g, '$1')
    .replace(/\u2011/g, '-')
    .replace(/\s*\u2014\s*([^\u2014\n.!?;]+?)\s*\u2014\s*/g, ', $1, ')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*,/g, '.')
    .replace(/\b(?:including|such as) (?:titles|books|works|projects) like\b/gi, 'especially');
}

/** The full text placed on the clipboard for a channel. */
export function messageFor(entry: PersonalizationEntry, channel: DraftChannel): string {
  const copy = entry.copy;
  if (!copy) return '';
  const raw =
    channel === 'linkedin' || channel === 'whatsapp'
      ? copy.linkedin_message
      : channel === 'follow_up'
        ? copy.follow_up_body
        : copy.email_body;
  return sanitizeDisplayCopy(raw);
}

export function subjectFor(entry: PersonalizationEntry, subjectIndex = 0): string {
  const raw = entry.copy?.subject_lines?.[subjectIndex]?.text ?? entry.copy?.subject_lines?.[0]?.text ?? '';
  return sanitizeDisplayCopy(raw);
}

export function draftNeedsAttention(entry: PersonalizationEntry): string | null {
  if (entry.status === 'failed') return entry.error || 'The draft could not be written. Try again.';
  if (entry.status === 'needs_more_research') return entry.strategy?.readiness_reason || 'MARCOM needs more research before writing this draft.';
  if (!entry.copy) return 'No draft has been written yet.';
  if (!hasContactFor(entry)) return 'No email address or LinkedIn profile found · copy the draft and use another route';
  return null;
}
