'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ReviewStatus } from '@/marcom/schemas/research-record';
import { PageFrame, ProjectGate } from '../AppShell';
import { useWorkspace, type ProjectBundle } from '../WorkspaceContext';
import { ContactRows, FitList, MoreResearchDialog, VerificationCard, saveDecision } from '../prospect-parts';
import { Icon, btnDanger, btnPrimary, btnSecondary, serif } from '../ui';
import { entriesForTarget, locationOf, plural, prospectName, reviewStatus, shortDate, targetFor } from '../format';

type Decision = 'Approved' | 'More research' | 'Rejected' | 'Skipped';

function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

function ReviewContent({ bundle }: { bundle: ProjectBundle }) {
  const { reload, openResearch } = useWorkspace();
  const brief = bundle.project.structured_brief;
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [focusId, setFocusId] = useState<string | null>(() => readParam('prospect'));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreResearchOpen, setMoreResearchOpen] = useState(false);

  const queue = useMemo(
    () =>
      bundle.research
        .filter((entry) => reviewStatus(entry) === 'needs_review' || decisions[entry.record.record_id])
        .sort((a, b) => Date.parse(b.record.researched_at) - Date.parse(a.record.researched_at) || prospectName(a).localeCompare(prospectName(b))),
    [bundle.research, decisions],
  );
  const pending = queue.filter((entry) => !decisions[entry.record.record_id]);
  const current = (focusId ? pending.find((entry) => entry.record.record_id === focusId) : undefined) ?? pending[0] ?? null;
  const decidedCount = queue.length - pending.length;

  if (!current) {
    const counts = Object.values(decisions).reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
    const sessionHadWork = Object.keys(decisions).length > 0;
    const unresearched = (brief?.targets ?? []).filter((target) => entriesForTarget(bundle.research, target).length === 0);
    const cards = sessionHadWork
      ? [
          { value: counts.Approved ?? 0, label: 'Approved', note: 'Ready to personalise', color: '#B1A6FF' },
          { value: counts['More research'] ?? 0, label: 'More research', note: 'Kept out of outreach for now', color: '#5ED3DF' },
          { value: counts.Rejected ?? 0, label: 'Rejected', note: 'Kept with your note', color: '#F28B82' },
        ]
      : [
          { value: bundle.summary.shortlisted, label: 'Approved', note: 'Across all research runs', color: '#B1A6FF' },
          { value: bundle.summary.enrichment_requested, label: 'More research', note: 'Waiting for another pass', color: '#5ED3DF' },
          { value: bundle.summary.rejected, label: 'Rejected', note: 'Kept with your notes', color: '#F28B82' },
        ];
    return (
      <PageFrame>
        <section className="mx-auto flex w-full max-w-[640px] flex-col gap-7 py-8">
          <div className="flex items-center gap-5">
            <div aria-hidden="true" className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-[#133524] text-[#5BD69A]"><Icon name="check" size={34} stroke={2.4} /></div>
            <div className="flex flex-col gap-1.5">
              <h1 className={`${serif} m-0 text-4xl leading-[1.1]`}>{sessionHadWork ? 'All caught up' : 'Nothing to review'}</h1>
              <p className="m-0 text-[15px] text-[#A7ADB8]">
                {sessionHadWork ? `You reviewed ${plural(Object.keys(decisions).filter((id) => decisions[id] !== 'Skipped').length, 'prospect')} in this session.` : bundle.research.length ? 'Every prospect found so far has a decision.' : 'Run research to find your first prospects.'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            {cards.map((item) => (
              <div key={item.label} className="flex flex-col gap-1.5 rounded-2xl border border-[#2A2F39] bg-[#171A20] p-[18px]">
                <span className="text-[28px] font-semibold" style={{ color: item.color }}>{item.value}</span>
                <span className="text-sm font-semibold">{item.label}</span>
                <span className="text-xs text-[#8A909C]">{item.note}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {bundle.summary.shortlisted > 0 ? (
              <Link href="/prospects?tab=approved" className={`${btnPrimary} h-[50px] px-6 text-[15px] no-underline`}><Icon name="sparkle" size={18} /> Personalise approved</Link>
            ) : (
              <button type="button" onClick={() => openResearch()} className={`${btnPrimary} h-[50px] px-6 text-[15px]`}><Icon name="search" size={18} /> Find prospects</button>
            )}
            <Link href="/outreach" className={`${btnSecondary} h-[50px] px-5 text-[15px] no-underline`}>Go to Outreach</Link>
            {bundle.summary.shortlisted > 0 && <button type="button" onClick={() => openResearch()} className={`${btnSecondary} h-[50px] px-5 text-[15px]`}>Find more prospects</button>}
          </div>
          {unresearched.length > 0 && (
            <div className="flex gap-3 rounded-2xl border border-[#4A3B17] bg-[#231D10] px-[18px] py-4">
              <Icon name="info" size={18} className="mt-px text-[#F2C36B]" />
              <span className="text-sm leading-relaxed text-[#E5D3A8]">
                Nobody from <span className="font-semibold capitalize text-[#F1F2F4]">{unresearched[0]!.target_type}</span> has been researched yet.{' '}
                <button type="button" onClick={() => openResearch(unresearched[0]!.id)} className="font-semibold text-[#5ED3DF]">Research this audience</button>
              </span>
            </div>
          )}
        </section>
      </PageFrame>
    );
  }

  const id = current.record.record_id;
  const name = prospectName(current);
  const note = notes[id] ?? current.review?.note ?? '';
  const target = targetFor(brief, current);
  const currentIndex = queue.indexOf(current);
  const windowStart = Math.max(0, Math.min(currentIndex - 2, queue.length - 5));
  const visible = queue.slice(windowStart, windowStart + 5);
  const remaining = queue.length - (windowStart + visible.length);
  const location = locationOf(current);
  const record = current.record;

  const decide = async (status: ReviewStatus, label: Decision, decisionNote: string) => {
    if (status === 'rejected' && !decisionNote.trim()) {
      setError('Add a note explaining why before rejecting this prospect.');
      document.getElementById('review-note')?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDecision(bundle.projectId, id, status, decisionNote);
      setDecisions((existing) => ({ ...existing, [id]: label }));
      setFocusId(null);
      setMoreResearchOpen(false);
      void reload();
    } catch (decisionError) {
      setError((decisionError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageFrame>
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex flex-[1_1_300px] flex-col gap-2.5">
          <div className="flex items-baseline gap-3">
            <h1 className={`${serif} m-0 text-[30px]`}>Review prospects</h1>
            <span className="text-[15px] text-[#A7ADB8]">{decidedCount + 1} of {queue.length}</span>
          </div>
          <div aria-hidden="true" className="h-1 max-w-[420px] overflow-hidden rounded-sm bg-[#2A2F39]"><div className="h-1 bg-[#F2C36B] transition-all" style={{ width: `${((decidedCount + 1) / queue.length) * 100}%` }} /></div>
        </div>
        <button type="button" onClick={() => { setDecisions((existing) => ({ ...existing, [id]: 'Skipped' })); setFocusId(null); setError(null); }} className={`${btnSecondary} h-10`}>Skip</button>
      </header>

      <div className="flex flex-wrap items-start gap-6">
        <nav aria-label="Review queue" className="flex min-w-0 max-w-full flex-[1_1_240px] flex-col gap-2 lg:max-w-[300px]">
          <div className="text-[13px] font-semibold text-[#A7ADB8]">Queue</div>
          <ol className="m-0 flex list-none flex-col overflow-hidden rounded-[18px] border border-[#2A2F39] bg-[#171A20] p-0">
            {windowStart > 0 && <li className="border-b border-[#22262E] px-3.5 py-2.5 text-xs text-[#8A909C]">{windowStart} earlier</li>}
            {visible.map((entry) => {
              const entryId = entry.record.record_id;
              const decision = decisions[entryId];
              const isCurrent = entryId === id;
              const position = queue.indexOf(entry) + 1;
              return (
                <li key={entryId} className={`border-b border-[#22262E] last:border-b-0 ${isCurrent ? 'bg-[#1F232B]' : ''}`}>
                  <button type="button" disabled={Boolean(decision)} onClick={() => { setFocusId(entryId); setError(null); }} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left disabled:cursor-default">
                    <span aria-hidden="true" className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: decision ? '#133524' : isCurrent ? '#F2C36B' : '#22262E', color: decision ? '#5BD69A' : isCurrent ? '#0E1014' : '#A7ADB8' }}>
                      {decision ? '✓' : position}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-sm ${isCurrent ? 'font-semibold text-[#F1F2F4]' : decision ? 'text-[#8A909C]' : 'text-[#F1F2F4]'}`}>{prospectName(entry)}</span>
                    <span className="text-xs text-[#8A909C]">{isCurrent ? 'Now' : decision ?? ''}</span>
                  </button>
                </li>
              );
            })}
            {remaining > 0 && (
              <li className="flex items-center gap-2.5 px-3.5 py-3 text-sm text-[#A7ADB8]">
                <span aria-hidden="true" className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#22262E] text-[11px] font-bold">…</span>
                {remaining} more
              </li>
            )}
          </ol>
        </nav>

        <article className="flex min-w-0 flex-[2_1_480px] flex-col gap-[18px] rounded-3xl border border-[#2A2F39] bg-[#171A20] p-7">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[#1F232B] px-2.5 py-[5px] text-xs capitalize text-[#C9CDD4]">{record.identity.entity_kind}</span>
            <span className="rounded-full bg-[#1F232B] px-2.5 py-[5px] text-xs text-[#C9CDD4]">Found {shortDate(record.researched_at)}</span>
            {current.batch_number && <span className="rounded-full bg-[#1F232B] px-2.5 py-[5px] text-xs text-[#C9CDD4]">Run {current.batch_number}</span>}
            {record.matched_prospect_id && <span className="rounded-full bg-[#3A2F17] px-2.5 py-[5px] text-xs text-[#F2C36B]">Possible duplicate</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className={`${serif} m-0 text-[34px] leading-[1.1]`}>{name}</h2>
            {(location || record.role || record.organisation) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#A7ADB8]">
                {location && <span className="inline-flex items-center gap-1.5"><Icon name="pin" size={15} />{location}</span>}
                {(record.role || record.organisation) && <span>{[record.role, record.organisation].filter(Boolean).join(' · ')}</span>}
              </div>
            )}
          </div>
          <p className="m-0 max-w-[640px] text-base leading-relaxed text-[#D5D8DE]">{record.summary || 'No profile summary yet. More research would fill this in.'}</p>
          {record.reason_for_relevance && <p className="m-0 max-w-[640px] text-sm leading-relaxed text-[#A7ADB8]"><span className="font-semibold text-[#C9CDD4]">Why they fit: </span>{record.reason_for_relevance}</p>}

          <VerificationCard entry={current} brief={brief} />

          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold text-[#A7ADB8]">Fit with your criteria</div>
            <FitList entry={current} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold text-[#A7ADB8]">Contact</div>
            <ContactRows entry={current} />
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-[#A7ADB8]">Your note <span className="font-normal text-[#8A909C]">· for your team, required when rejecting</span></span>
            <textarea id="review-note" value={note} onChange={(event) => setNotes((existing) => ({ ...existing, [id]: event.target.value }))} placeholder="Why approve, reject or research further?" className="h-[72px] resize-none rounded-xl border border-[#2A2F39] bg-[#12151A] px-3 py-2.5 text-sm text-[#F1F2F4] outline-none placeholder:text-[#5C616B] focus:border-[#2E6B75]" />
          </label>
          {error && <p role="alert" className="m-0 text-[13px] text-[#F7B1AA]">{error}</p>}

          <div className="flex flex-wrap gap-2.5 border-t border-[#2A2F39] pt-[18px]">
            <button type="button" disabled={saving} onClick={() => void decide('rejected', 'Rejected', note)} className={`${btnDanger} h-[50px] px-5`}>Reject</button>
            <button type="button" disabled={saving} onClick={() => { setError(null); setMoreResearchOpen(true); }} className={`${btnSecondary} h-[50px] bg-[#12151A] px-5`}>More research</button>
            <Link href={`/prospects?prospect=${encodeURIComponent(id)}`} className="inline-flex h-[50px] items-center px-2 text-sm font-semibold text-[#5ED3DF] no-underline">Full details</Link>
            <button type="button" disabled={saving} onClick={() => void decide('shortlisted', 'Approved', note)} className={`${btnPrimary} ml-auto h-[50px] px-6 text-[15px]`}>
              <Icon name="check" size={18} stroke={2.2} /> {saving ? 'Saving…' : 'Approve'}
            </button>
          </div>
        </article>

        <aside aria-label="Campaign goal" className="flex min-w-0 max-w-full flex-[1_1_240px] flex-col gap-3 rounded-[20px] border border-[#22262E] bg-[#12151A] p-5 lg:max-w-[300px]">
          <div className="text-[11px] font-semibold tracking-[0.12em] text-[#8A909C]">YOU&apos;RE LOOKING FOR</div>
          <p className="m-0 text-[15px] font-medium leading-snug">{brief?.project.primary_objective || 'No primary objective set.'}</p>
          <div className="flex flex-col gap-2">
            {(brief?.targets ?? []).map((item) => (
              <div key={item.id} className={`rounded-xl border p-3 text-[13px] capitalize leading-snug ${item.id === target?.id ? 'border-[#2E6B75] bg-[#12313A] text-[#F1F2F4]' : 'border-[#2A2F39] bg-[#171A20] text-[#C9CDD4]'}`}>
                {item.target_type}
              </div>
            ))}
          </div>
          <Link href="/overview" className="text-[13px] font-semibold text-[#5ED3DF] no-underline">Full goal & objectives</Link>
        </aside>
      </div>

      {moreResearchOpen && (
        <MoreResearchDialog
          prospect={name}
          saving={saving}
          error={error}
          onCancel={() => setMoreResearchOpen(false)}
          onSubmit={(instructions) => void decide('enrichment_requested', 'More research', [instructions, note.trim()].filter(Boolean).join(' Note: '))}
        />
      )}
    </PageFrame>
  );
}

export default function ReviewView() {
  const { bundle } = useWorkspace();
  return <ProjectGate>{bundle && <ReviewContent key={bundle.projectId} bundle={bundle} />}</ProjectGate>;
}
