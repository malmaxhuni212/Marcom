'use client';

import { useMemo, useState } from 'react';
import { authenticatedFetch } from '@/auth/client';
import type { PersonalizationEntry, PersonalizationSettings } from '@/marcom/schemas/personalization';
import { useClipboard } from './prospect-parts';
import { Icon, Spinner, btnPrimary, btnSecondary } from './ui';
import { CHANNEL_LABEL, draftTargets, hostOf, messageFor, primaryChannel, subjectFor, type DraftChannel } from './format';

interface Marker {
  text: string;
  kind: 'you' | 'fact';
  title: string;
}

/** Splits text into plain / highlighted segments for exact (case-insensitive) marker matches. */
function segment(text: string, markers: Marker[]) {
  const lower = text.toLowerCase();
  const ranges: { start: number; end: number; marker: Marker }[] = [];
  for (const marker of markers) {
    const needle = marker.text.trim().toLowerCase();
    if (needle.length < 3) continue;
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      ranges.push({ start: index, end: index + needle.length, marker });
      from = index + needle.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { text: string; marker?: Marker }[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) out.push({ text: text.slice(cursor, range.start) });
    out.push({ text: text.slice(range.start, range.end), marker: range.marker });
    cursor = range.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

const CHECK_TONE = {
  ok: 'bg-[#10261B] text-[#8EE6B6] border-[#1F4A33]',
  warn: 'bg-[#231D10] text-[#F2C36B] border-[#4A3B17]',
  you: 'bg-[#12313A] text-[#9BE6EE] border-[#2E6B75]',
  info: 'bg-[#1A1D24] text-[#C9CDD4] border-[#2A2F39]',
};
const CHECK_DOT = { ok: '#5BD69A', warn: '#F2C36B', you: '#5ED3DF', info: '#8A909C' };

export default function DraftViewer({
  draft,
  projectId,
  settings,
  onUpdated,
  initialChannel,
}: {
  draft: PersonalizationEntry;
  projectId: string;
  settings: PersonalizationSettings | null;
  onUpdated: (entry: PersonalizationEntry) => void;
  initialChannel?: DraftChannel;
}) {
  const [channel, setChannel] = useState<DraftChannel>(initialChannel ?? primaryChannel(draft));
  const [subjectIndex, setSubjectIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<DraftChannel, string>>({
    email: draft.copy?.email_body ?? '',
    linkedin: draft.copy?.linkedin_message ?? '',
    follow_up: draft.copy?.follow_up_body ?? '',
  });
  const [busy, setBusy] = useState<'save' | 'rewrite' | 'status' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useClipboard();
  const targets = draftTargets(draft);
  const strategy = draft.strategy;
  const qa = draft.qa;

  const markers = useMemo<Marker[]>(() => {
    const list: Marker[] = [];
    const you = (value: string | null | undefined, title: string) => value && list.push({ text: value, kind: 'you', title });
    you(settings?.sender_name, 'From your outreach settings: sender name');
    you(settings?.organisation, 'From your outreach settings: organisation');
    you(settings?.sender_role, 'From your outreach settings: role');
    you(settings?.call_to_action_link, 'From your outreach settings: link');
    for (const fact of settings?.campaign_facts ?? []) if (fact.length <= 140) you(fact, 'From your campaign facts');
    for (const hook of strategy?.hooks ?? []) {
      const sources = hook.source_ids.join(', ');
      if (hook.fact.length <= 160) list.push({ text: hook.fact, kind: 'fact', title: `Verified fact${sources ? ` · sources ${sources}` : ''}` });
      if (hook.evidence_quote && hook.evidence_quote.length <= 160) list.push({ text: hook.evidence_quote, kind: 'fact', title: `Quoted from research${sources ? ` · sources ${sources}` : ''}` });
    }
    return list;
  }, [settings, strategy]);

  const patch = async (body: Record<string, unknown>) => {
    const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId: draft.record_id, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.item) throw new Error(data.error || 'The draft could not be updated.');
    onUpdated(data.item as PersonalizationEntry);
  };

  const saveEdits = async () => {
    if (!draft.copy) return;
    setBusy('save');
    setError(null);
    try {
      await patch({ copy: { ...draft.copy, email_body: edits.email, linkedin_message: edits.linkedin, follow_up_body: edits.follow_up } });
      setEditing(false);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const rewrite = async () => {
    setBusy('rewrite');
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: draft.record_id, force: true }),
      });
      const data = await response.json().catch(() => ({}));
      const updated = (data.items as PersonalizationEntry[] | undefined)?.find((item) => item.record_id === draft.record_id);
      if (!response.ok || !updated) throw new Error(data.error || 'The draft could not be rewritten.');
      onUpdated(updated);
      setEdits({ email: updated.copy?.email_body ?? '', linkedin: updated.copy?.linkedin_message ?? '', follow_up: updated.copy?.follow_up_body ?? '' });
      setEditing(false);
    } catch (rewriteError) {
      setError((rewriteError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggleApproved = async () => {
    setBusy('status');
    setError(null);
    try {
      await patch({ status: draft.status === 'approved' ? 'draft' : 'approved' });
    } catch (statusError) {
      setError((statusError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (busy === 'rewrite') {
    return (
      <div className="flex flex-col gap-3.5 rounded-[18px] border border-[#2A2F39] bg-[#171A20] px-5 pb-8 pt-7">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-[#9BE6EE]"><Spinner /> Rewriting the drafts from verified facts…</div>
        <div aria-hidden="true" className="flex flex-col gap-2.5">
          {[88, 94, 72, 60].map((width) => <div key={width} className="h-3 rounded-md bg-[#22262E]" style={{ width: `${width}%` }} />)}
        </div>
        <div className="text-xs text-[#8A909C]">Your sender details and campaign facts are filled in for you. Nothing is sent.</div>
      </div>
    );
  }

  if (!draft.copy) {
    const failed = draft.status === 'failed';
    return (
      <div className="flex flex-col items-start gap-3 rounded-[18px] border border-[#2A2F39] bg-[#171A20] px-5 pb-8 pt-7">
        <div className={`flex items-center gap-2.5 text-[15px] font-semibold ${failed ? 'text-[#F7B1AA]' : 'text-[#F7D58E]'}`}>
          <Icon name="warning" size={18} /> {failed ? "Couldn't write the drafts" : 'Drafts held back'}
        </div>
        <p className="m-0 text-sm leading-relaxed text-[#C9CDD4]">
          {failed ? draft.error || 'The agent stopped before finishing. Nothing was saved, so there is no half-written message.' : strategy?.readiness_reason || 'MARCOM needs more verified information before writing to this prospect.'}
        </p>
        {error && <p role="alert" className="m-0 text-[13px] text-[#F7B1AA]">{error}</p>}
        <button type="button" onClick={() => void rewrite()} className={`${btnSecondary} h-10`}><Icon name="refresh" size={16} /> {failed ? 'Try again' : 'Write the drafts anyway'}</button>
      </div>
    );
  }

  const text = editing ? edits[channel] : messageFor(draft, channel);
  const subject = subjectFor(draft, subjectIndex);
  const to = channel === 'linkedin' ? targets.linkedin : targets.email;
  const verifiedHooks = qa?.verified_hook_ids.length ?? 0;
  const checks: { text: string; tone: keyof typeof CHECK_TONE }[] = [
    verifiedHooks > 0 ? { text: `Uses ${verifiedHooks} verified fact${verifiedHooks === 1 ? '' : 's'}`, tone: 'ok' } : { text: 'No verified facts · may read as generic', tone: 'warn' },
    { text: 'Filled in from your brief and outreach settings', tone: 'you' },
  ];
  if (qa) checks.push({ text: `Quality check ${qa.score}/100`, tone: qa.score >= 75 ? 'ok' : 'warn' });
  if (strategy?.contact_audit) checks.push(strategy.contact_audit.is_direct_contact ? { text: 'Direct contact route', tone: 'ok' } : { text: 'Team or shared inbox', tone: 'info' });
  if (draft.edited_by_human) checks.push({ text: 'Edited by you', tone: 'info' });
  if (strategy?.readiness === 'needs_more_research') checks.push({ text: 'Strategist suggested more research', tone: 'warn' });
  const linkedInTooLong = channel === 'linkedin' && text.length > 300;

  const channels: { id: DraftChannel; dot: string }[] = [
    { id: 'email', dot: targets.email ? '#5BD69A' : '#F2C36B' },
    { id: 'linkedin', dot: targets.linkedin ? '#5BD69A' : '#F2C36B' },
    { id: 'follow_up', dot: targets.email ? '#8A909C' : '#F2C36B' },
  ];
  const how: Record<DraftChannel, string> = {
    email: 'Copy the subject and message, then paste them into your own email. Nothing is sent from MARCOM.',
    linkedin: 'Copy the note, open their profile and paste it into a connection request or message.',
    follow_up: 'A short follow-up to send yourself 4–6 days later if there is no reply.',
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Channel" className="flex flex-wrap gap-2">
        {channels.map((item) => {
          const on = item.id === channel;
          return (
            <button key={item.id} type="button" role="tab" aria-selected={on} onClick={() => setChannel(item.id)} className={`inline-flex h-9 items-center gap-[7px] rounded-full border px-[13px] text-[13px] font-semibold ${on ? 'border-[#F1F2F4] bg-[#F1F2F4] text-[#0E1014]' : 'border-[#2A2F39] bg-[#171A20] text-[#F1F2F4]'}`}>
              <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ background: item.dot }} />
              {CHANNEL_LABEL[item.id]}
            </button>
          );
        })}
      </div>

      {strategy?.readiness === 'needs_more_research' && (
        <div className="flex gap-2.5 rounded-xl border border-[#4A3B17] bg-[#231D10] px-3.5 py-3 text-[13px] leading-snug text-[#E5D3A8]">
          <Icon name="warning" size={16} className="mt-px text-[#F2C36B]" />
          <span>{strategy.readiness_reason}</span>
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-[18px] border border-[#2A2F39] bg-[#171A20]">
        {to ? (
          <div className="flex items-center gap-2.5 border-b border-[#2A2F39] px-[18px] py-3 text-sm">
            <span className="w-[60px] shrink-0 text-[#8A909C]">{channel === 'linkedin' ? 'Profile' : 'To'}</span>
            <span className="min-w-0 flex-1 truncate text-[#5ED3DF]">{channel === 'linkedin' ? hostOf(to) + (to.includes('/in/') ? to.slice(to.indexOf('/in/')) : '') : to}</span>
            <button type="button" onClick={() => void copy(to, 'to')} className="rounded-lg border border-[#2A2F39] px-2.5 py-1 text-xs font-semibold text-[#C9CDD4] hover:text-[#F1F2F4]">{copied === 'to' ? '✓ Copied' : 'Copy'}</button>
            {channel === 'linkedin' && (
              <a href={to.startsWith('http') ? to : `https://${to}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[#2E6B75] px-2.5 py-1 text-xs font-semibold text-[#9BE6EE] no-underline">Open <Icon name="external" size={12} /></a>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 border-b border-[#4A3B17] bg-[#231D10] px-[18px] py-2.5 text-[13px] text-[#E5D3A8]">
            <Icon name="warning" size={16} className="text-[#F2C36B]" />
            <span className="flex-1">{channel === 'linkedin' ? 'No LinkedIn profile found' : 'No email address found'} · you can still copy the message and use another route</span>
          </div>
        )}
        {(channel === 'email' || channel === 'follow_up') && settings?.sender_name && (
          <div className="flex gap-2.5 border-b border-[#2A2F39] px-[18px] py-3 text-sm">
            <span className="w-[60px] shrink-0 text-[#8A909C]">From</span>
            <span className="min-w-0 break-words">{settings.sender_name}{settings.sender_role ? ` · ${settings.sender_role}` : ''}{settings.organisation ? ` · ${settings.organisation}` : ''}</span>
          </div>
        )}
        {channel === 'email' && (
          <div className="flex flex-col gap-2 border-b border-[#2A2F39] px-[18px] py-3 text-sm">
            <div className="flex items-center gap-2.5">
              <span className="w-[60px] shrink-0 text-[#8A909C]">Subject</span>
              <span className="min-w-0 flex-1">{subject}</span>
              <button type="button" onClick={() => void copy(subject, 'subject')} className="rounded-lg border border-[#2A2F39] px-2.5 py-1 text-xs font-semibold text-[#C9CDD4] hover:text-[#F1F2F4]">{copied === 'subject' ? '✓ Copied' : 'Copy'}</button>
            </div>
            {(draft.copy.subject_lines?.length ?? 0) > 1 && (
              <div className="flex flex-wrap gap-1.5 pl-[70px]">
                {draft.copy.subject_lines.map((line, index) => (
                  <button key={line.text} type="button" onClick={() => setSubjectIndex(index)} className={`rounded-full border px-2.5 py-1 text-xs ${index === subjectIndex ? 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE]' : 'border-[#2A2F39] text-[#A7ADB8] hover:text-[#F1F2F4]'}`}>
                    {line.style} option
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {channel === 'follow_up' && (
          <div className="flex gap-2.5 border-b border-[#2A2F39] px-[18px] py-3 text-sm">
            <span className="w-[60px] shrink-0 text-[#8A909C]">Subject</span>
            <span className="min-w-0 flex-1">Re: {subject}</span>
          </div>
        )}

        {editing ? (
          <textarea
            aria-label={`${CHANNEL_LABEL[channel]} message`}
            value={edits[channel]}
            onChange={(event) => setEdits((current) => ({ ...current, [channel]: event.target.value }))}
            rows={channel === 'linkedin' ? 6 : 12}
            className="w-full resize-y border-0 bg-[#12151A] px-[18px] py-4 text-[14.5px] leading-[1.65] text-[#F1F2F4] outline-none"
          />
        ) : (
          <div className="whitespace-pre-line px-[18px] pb-2.5 pt-4 text-[14.5px] leading-[1.65] text-[#D5D8DE]">
            {segment(text, markers).map((part, index) =>
              part.marker ? (
                <span key={index} title={part.marker.title} className={`rounded px-[3px] py-px ${part.marker.kind === 'fact' ? 'bg-[#26224A] text-[#E2DDFF]' : 'bg-[#12313A] text-[#9BE6EE]'}`}>{part.text}</span>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </div>
        )}
        <div className={`px-[18px] pb-3.5 pt-1 text-xs ${linkedInTooLong ? 'text-[#F7B1AA]' : 'text-[#8A909C]'}`}>
          {channel === 'linkedin' ? `${text.length} / 300 characters · short connection note` : channel === 'email' ? `${text.trim().split(/\s+/).filter(Boolean).length} words · full email with subject line` : 'Short follow-up email'}
        </div>
        <div className="flex gap-2.5 border-t border-[#22262E] bg-[#12151A] px-[18px] py-3 text-[12.5px] leading-snug text-[#A7ADB8]">
          <Icon name="copy" size={15} className="mt-px text-[#5ED3DF]" />
          <span>{how[channel]}</span>
        </div>
      </div>

      <div aria-label="Draft checks" className="flex flex-wrap gap-2">
        {checks.map((check) => (
          <span key={check.text} className={`inline-flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-xs font-medium ${CHECK_TONE[check.tone]}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: CHECK_DOT[check.tone] }} />
            {check.text}
          </span>
        ))}
      </div>
      <div className="text-xs text-[#8A909C]">
        <span className="rounded bg-[#26224A] px-1 text-[#E2DDFF]">Highlighted</span> = verified fact, hover for the source · <span className="rounded bg-[#12313A] px-1 text-[#9BE6EE]">Blue</span> = from your brief or outreach settings
      </div>

      {strategy && (
        <details className="group rounded-[14px] border border-[#2A2F39] bg-[#12151A]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[13px] font-semibold text-[#C9CDD4]">
            Why this message
            <Icon name="chevronDown" size={14} className="transition group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 border-t border-[#22262E] px-4 py-3.5 text-[13px] leading-relaxed text-[#A7ADB8]">
            <p className="m-0"><span className="font-semibold text-[#F1F2F4]">Angle: </span>{strategy.angle}</p>
            <p className="m-0"><span className="font-semibold text-[#F1F2F4]">Why they matter: </span>{strategy.relevance_thesis}</p>
            {strategy.hooks.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {strategy.hooks.map((hook) => (
                  <li key={hook.id} className="rounded-lg border border-[#22262E] bg-[#171A20] px-3 py-2">
                    <span className="text-[#E2DDFF]">{hook.fact}</span>
                    <span className="mt-0.5 block text-xs text-[#8A909C]">{hook.why_it_resonates} · {hook.strength}</span>
                  </li>
                ))}
              </ul>
            )}
            {qa && qa.issues.length > 0 && (
              <ul className="m-0 list-disc pl-4 text-xs text-[#E5D3A8]">
                {qa.issues.slice(0, 5).map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
              </ul>
            )}
          </div>
        </details>
      )}

      {error && <p role="alert" className="m-0 text-[13px] text-[#F7B1AA]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== null} onClick={() => void rewrite()} className={`${btnSecondary} h-[46px]`}><Icon name="refresh" size={16} /> Rewrite</button>
        {editing ? (
          <>
            <button type="button" disabled={busy !== null} onClick={() => { setEditing(false); setEdits({ email: draft.copy?.email_body ?? '', linkedin: draft.copy?.linkedin_message ?? '', follow_up: draft.copy?.follow_up_body ?? '' }); }} className={`${btnSecondary} h-[46px]`}>Cancel</button>
            <button type="button" disabled={busy !== null} onClick={() => void saveEdits()} className={`${btnSecondary} h-[46px] border-[#2E6B75] text-[#9BE6EE]`}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          </>
        ) : (
          <button type="button" disabled={busy !== null} onClick={() => setEditing(true)} className={`${btnSecondary} h-[46px]`}><Icon name="edit" size={16} /> Edit</button>
        )}
        <button type="button" disabled={busy !== null} onClick={() => void toggleApproved()} className={`${btnSecondary} h-[46px] ${draft.status === 'approved' ? 'border-[#1F4A33] text-[#8EE6B6]' : ''}`}>
          <Icon name="check" size={16} /> {draft.status === 'approved' ? 'Approved' : 'Approve draft'}
        </button>
        <button type="button" onClick={() => void copy(text, 'message')} className={`${btnPrimary} h-[46px] min-w-[170px] flex-1`}>
          <Icon name={copied === 'message' ? 'check' : 'copy'} size={16} /> {copied === 'message' ? 'Copied to clipboard' : `Copy ${channel === 'linkedin' ? 'note' : 'message'}`}
        </button>
      </div>
    </div>
  );
}
