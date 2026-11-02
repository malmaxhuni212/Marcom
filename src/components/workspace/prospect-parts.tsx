'use client';

import { useState } from 'react';
import { authenticatedFetch } from '@/auth/client';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { CloseButton, Dialog, Icon, btnPrimary, btnSecondary, serif } from './ui';
import { contactsOf, formatProfileDisplay, hostOf, longDate, plural, sourceUsage, targetFor, verificationOf } from './format';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';

/** Saves one human review decision (approve / reject / more research / restore). */
export async function saveDecision(projectId: string, recordId: string, status: ReviewStatus, note: string | null) {
  const response = await authenticatedFetch(`/api/projects/${projectId}/research`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ record_id: recordId, status, note: note?.trim() || null }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The decision could not be saved.');
  return data;
}

export function useClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(key);
    window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800);
  };
  return { copied, copy };
}

export function VerificationCard({ entry, brief }: { entry: ResearchEntry; brief: StructuredBrief | null | undefined }) {
  const verification = verificationOf(entry);
  const target = targetFor(brief, entry);
  const status = entry.review?.status;
  if (status === 'enrichment_requested') {
    return (
      <div className="flex gap-3 rounded-2xl border border-[#2E6B75] bg-[#12313A] p-3.5">
        <Icon name="search" size={20} className="text-[#5ED3DF]" />
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-[#9BE6EE]">More research requested</div>
          <div className="text-[13px] leading-snug text-[#B5D9DE]">{entry.review?.note || 'Marked for another research pass before outreach.'}</div>
        </div>
      </div>
    );
  }
  if (verification.state === 'unverified') {
    return (
      <div className="flex gap-3 rounded-2xl border border-[#4A3B17] bg-[#231D10] p-3.5">
        <Icon name="warning" size={20} className="text-[#F2C36B]" />
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-[#F7D58E]">Not verified yet</div>
          <div className="text-[13px] leading-snug text-[#D9C9A3]">No sources confirm this prospect fits your criteria. We suggest more research before writing to them.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 rounded-2xl border border-[#1F4A33] bg-[#10261B] p-3.5">
      <Icon name="shield" size={20} stroke={2.2} className="text-[#5BD69A]" />
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-[#8EE6B6]">{verification.label}</div>
        <div className="text-[13px] leading-snug text-[#B7D9C6]">
          Matches target group: <span className="capitalize text-[#F1F2F4]">{target?.target_type ?? entry.record.target_type}</span>
        </div>
      </div>
    </div>
  );
}

const FIT_STATE: Record<string, { label: string; bg: string; fg: string }> = {
  met: { label: 'Confirmed', bg: '#10261B', fg: '#8EE6B6' },
  partially_met: { label: 'Partly', bg: '#12313A', fg: '#9BE6EE' },
  not_met: { label: 'Not met', bg: '#2A1715', fg: '#F7B1AA' },
  unknown: { label: 'Not confirmed', bg: '#1F232B', fg: '#C9CDD4' },
};

export function FitList({ entry }: { entry: ResearchEntry }) {
  const items = entry.record.qualification_assessment;
  if (!items.length) {
    return <div className="rounded-[14px] border border-dashed border-[#2E333D] bg-[#171A20] px-3.5 py-3 text-[13px] text-[#A7ADB8]">No criteria were assessed for this prospect.</div>;
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#2A2F39] bg-[#171A20]">
      {items.map((item, index) => {
        const state = FIT_STATE[item.status] ?? FIT_STATE.unknown!;
        const sources = item.source_ids.map((id) => entry.record.sources.find((source) => source.id === id)).filter(Boolean);
        return (
          <div key={`${item.criterion}-${index}`} className="flex items-center gap-3 border-b border-[#22262E] px-3.5 py-3 last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm text-[#F1F2F4]">{item.criterion}</span>
              <span className="text-xs text-[#8A909C]">
                {item.note || (sources.length ? `Source: ${sources.map((source) => hostOf(source!.url)).join(', ')}` : "No source found. We don't guess.")}
              </span>
            </span>
            <span style={{ background: state.bg, color: state.fg }} className="whitespace-nowrap rounded-md px-2 py-[3px] text-xs">{state.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SourcesList({ entry }: { entry: ResearchEntry }) {
  const sources = entry.record.sources;
  if (!sources.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#2E333D] bg-[#171A20] px-3.5 py-3 text-[13px] leading-relaxed text-[#A7ADB8]">
        No sources found yet. Anything without a source stays <span className="text-[#F1F2F4]">Not confirmed</span> and is never used in drafts.
      </div>
    );
  }
  return (
    <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#2A2F39] bg-[#171A20]">
      {sources.map((source) => {
        const used = sourceUsage(entry, source.id);
        return (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="flex gap-3 border-b border-[#22262E] px-3.5 py-3 text-[#F1F2F4] no-underline last:border-b-0 hover:bg-[#1A1D24]">
            <Icon name="link" size={16} className="mt-0.5 text-[#5ED3DF]" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm text-[#5ED3DF]">{source.title || hostOf(source.url)}</span>
              <span className="truncate text-xs text-[#A7ADB8]">{hostOf(source.url)}{used.length ? ` · Used for: ${used.join(', ')}` : ''}</span>
              {source.retrieved_at && <span className="text-xs text-[#8A909C]">Checked {longDate(source.retrieved_at)}</span>}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function KeyContactsList({ entry }: { entry: ResearchEntry }) {
  const keyContacts = entry.record.key_contacts ?? [];
  const { copied, copy } = useClipboard();
  if (!keyContacts.length) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8A909C]">
        Relevant people at this organisation · {keyContacts.length}
      </div>
      <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#2A2F39] bg-[#171A20]">
        {keyContacts.map((person, index) => {
          const roleLine = [person.role, person.department].filter(Boolean).join(' · ');
          const copyEmailKey = `kc-email-${index}`;
          const copyLiKey = `kc-li-${index}`;
          return (
            <div key={`${person.name}-${index}`} className="flex flex-col gap-1.5 border-b border-[#22262E] px-3.5 py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#F1F2F4]">{person.name}</div>
                  {roleLine && <div className="text-xs text-[#A7ADB8]">{roleLine}</div>}
                </div>
                <span className="shrink-0 rounded-md bg-[#1F232B] px-2 py-0.5 text-[11px] capitalize text-[#9BE6EE]">
                  {person.confidence}
                </span>
              </div>
              {person.relevance && <div className="text-xs leading-snug text-[#8A909C]">{person.relevance}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {person.email && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-[#2A2F39] bg-[#12151A] px-2.5 py-1 text-xs">
                    <a href={`mailto:${person.email}`} className="text-[#5ED3DF] no-underline hover:underline">
                      {person.email}
                    </a>
                    <button
                      type="button"
                      onClick={() => void copy(person.email!, copyEmailKey)}
                      aria-label={`Copy ${person.name} email`}
                      className="ml-1 text-[#A7ADB8] hover:text-[#F1F2F4]"
                    >
                      {copied === copyEmailKey ? '✓' : <Icon name="copy" size={12} />}
                    </button>
                  </span>
                )}
                {person.linkedin_url && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-[#2A2F39] bg-[#12151A] px-2.5 py-1 text-xs">
                    <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="text-[#5ED3DF] no-underline hover:underline">
                      LinkedIn profile ↗
                    </a>
                    <button
                      type="button"
                      onClick={() => void copy(person.linkedin_url!, copyLiKey)}
                      aria-label={`Copy ${person.name} LinkedIn`}
                      className="ml-1 text-[#A7ADB8] hover:text-[#F1F2F4]"
                    >
                      {copied === copyLiKey ? '✓' : <Icon name="copy" size={12} />}
                    </button>
                  </span>
                )}
                {person.phone && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-[#2A2F39] bg-[#12151A] px-2.5 py-1 text-xs text-[#C9CDD4]">
                    {person.phone}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ContactRows({ entry, compact = false }: { entry: ResearchEntry; compact?: boolean }) {
  const contacts = contactsOf(entry);
  const { copied, copy } = useClipboard();
  const rows = [
    {
      key: 'email',
      abbr: '@',
      label: contacts.emailOwner ? `Email · ${contacts.emailOwner}` : 'Email',
      value: contacts.email,
      href: contacts.email ? `mailto:${contacts.email}` : null,
      missing: 'Email not found',
    },
    {
      key: 'linkedin',
      abbr: 'in',
      label: contacts.linkedinOwner ? `LinkedIn · ${contacts.linkedinOwner}` : 'LinkedIn',
      value: contacts.linkedin,
      display: contacts.linkedin ? formatProfileDisplay(contacts.linkedin) : null,
      href: contacts.linkedin,
      missing: 'LinkedIn not found',
    },
    ...contacts.extraSocials.map((social, idx) => ({
      key: `social-${social.platform}-${idx}`,
      abbr: social.abbr,
      label: social.label,
      value: social.url,
      display: social.display,
      href: social.url,
      missing: `${social.label} not found`,
    })),
    {
      key: 'website',
      abbr: 'www',
      label: contacts.contactForm ? 'Website · contact form found' : 'Website',
      value: contacts.contactForm || contacts.website,
      display: contacts.contactForm || contacts.website ? hostOf((contacts.contactForm || contacts.website)!) : null,
      href: contacts.contactForm || contacts.website,
      missing: 'Website not found',
    },
    { key: 'phone', abbr: 'tel', label: 'Phone', value: contacts.phone, display: contacts.phone, href: null, missing: 'Phone not found' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-[#2A2F39] bg-[#12151A] p-0">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 border-b border-[#22262E] px-4 last:border-b-0">
            {!compact && <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#1F232B] text-[11px] font-bold text-[#A7ADB8]">{row.abbr}</span>}
            <span className="flex min-w-0 flex-1 flex-col gap-px py-2.5">
              {row.value ? (
                row.href ? (
                  <a href={row.href} target={row.href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer" className="truncate text-sm text-[#5ED3DF] no-underline hover:underline">
                    {row.key === 'email' ? row.value : (row.display ?? hostOf(row.value))}
                  </a>
                ) : (
                  <span className="truncate text-sm text-[#5ED3DF]">{row.value}</span>
                )
              ) : (
                <span className="text-sm text-[#A7ADB8]">{row.missing}</span>
              )}
              <span className={`text-xs ${row.value ? 'text-[#8A909C]' : 'text-[#F2C36B]'}`}>{row.value ? row.label : 'Not found by research'}</span>
            </span>
            {row.value && (
              <button type="button" onClick={() => void copy(row.value!, row.key)} aria-label={`Copy ${row.label}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-[#A7ADB8] hover:bg-[#1F232B] hover:text-[#F1F2F4]">
                {copied === row.key ? '✓ Copied' : <Icon name="copy" size={14} />}
              </button>
            )}
          </li>
        ))}
      </ul>
      <KeyContactsList entry={entry} />
    </div>
  );
}

const CHECK_OPTIONS = [
  ['contact', 'Contact details'],
  ['fit', 'Fit with criteria'],
  ['location', 'Location'],
  ['activity', 'Recent activity'],
] as const;

/** "What should we check?" — records a more-research request with clear instructions. */
export function MoreResearchDialog({
  prospect,
  saving,
  error,
  onCancel,
  onSubmit,
  onResearchNow,
}: {
  prospect: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (note: string) => void;
  onResearchNow?: (note: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({ contact: true, fit: true, location: false, activity: false });
  const [details, setDetails] = useState('');
  const chosen = CHECK_OPTIONS.filter(([key]) => selected[key]).map(([, label]) => label);

  const getInstructions = () => {
    const parts = [chosen.length ? `Check: ${chosen.join(', ')}.` : null, details.trim() || null].filter(Boolean);
    return parts.join(' ') || 'More research requested.';
  };

  const submit = () => {
    onSubmit(getInstructions());
  };

  return (
    <Dialog label={`More research for ${prospect}`} onClose={onCancel} width={620}>
      <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-[#A7ADB8]">{prospect}</span>
          <h1 className={`${serif} m-0 text-[28px]`}>What should we check?</h1>
        </div>
        <CloseButton onClick={onCancel} />
      </div>
      <div className="flex flex-col gap-[18px] px-7 pb-5 pt-3.5">
        <div role="group" aria-label="What to check" className="flex flex-wrap gap-2">
          {CHECK_OPTIONS.map(([key, label]) => {
            const on = Boolean(selected[key]);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected((current) => ({ ...current, [key]: !on }))}
                className={`inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold ${on ? 'border-[#2E6B75] bg-[#12313A] text-[#F1F2F4]' : 'border-[#2A2F39] bg-[#0E1014] text-[#C9CDD4]'}`}
              >
                <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px] text-[11px] font-extrabold text-[#0E1014] ${on ? 'border-[#5ED3DF] bg-[#5ED3DF]' : 'border-[#5C616B]'}`}>{on ? '✓' : ''}</span>
                {label}
              </button>
            );
          })}
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-[#A7ADB8]">Anything specific? <span className="font-normal text-[#8A909C]">· optional instructions for research</span></span>
          <textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="e.g. Find their literary agent or direct submission email" className="h-[90px] resize-none rounded-[14px] border border-[#2A2F39] bg-[#0E1014] px-3.5 py-3 text-sm leading-relaxed text-[#F1F2F4] outline-none placeholder:text-[#5C616B] focus:border-[#2E6B75]" />
        </label>
        <div className="flex gap-2.5 rounded-xl border border-[#22262E] bg-[#0E1014] px-3.5 py-3 text-[13px] leading-snug text-[#A7ADB8]">
          <Icon name="info" size={16} className="mt-px text-[#5ED3DF]" />
          <span>
            You can <strong className="text-[#F1F2F4]">save to the More Research tab</strong> to differentiate and track this lead, or click <strong className="text-[#5ED3DF]">Research now</strong> to have the agent immediately run live web research.
          </span>
        </div>
        {error && <p role="alert" className="m-0 text-[13px] text-[#F7B1AA]">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#2A2F39] px-7 pb-6 pt-4">
        <button type="button" onClick={onCancel} className={`${btnSecondary} h-[44px] px-3 text-[13px]`}>Cancel</button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className={`${btnSecondary} h-[44px] border-[#2E6B75] bg-[#12313A] px-4 text-[13px] font-semibold text-[#9BE6EE] hover:bg-[#183D48]`}
          >
            <Icon name="search" size={14} stroke={2} /> {saving ? 'Saving…' : 'Move to More research tab'}
          </button>
          {onResearchNow && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onResearchNow(getInstructions())}
              className={`${btnPrimary} h-[44px] px-4 text-[13px] font-semibold`}
            >
              <Icon name="sparkle" size={15} stroke={2.2} /> Research now
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
