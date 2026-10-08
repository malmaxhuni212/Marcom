'use client';

import { useState } from 'react';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { evidenceCoverage, reviewStatus } from '@/marcom/research/review';

const decisionLabels: Record<ReviewStatus, string> = {
  needs_review: 'Restore to review',
  shortlisted: 'Shortlist',
  rejected: 'Reject',
  enrichment_requested: 'Request more research',
};

export default function ProspectEvidenceDrawer({
  entry,
  position,
  total,
  saving,
  error,
  onClose,
  onPrevious,
  onNext,
  onDecision,
}: {
  entry: ResearchEntry;
  position: number;
  total: number;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDecision: (status: ReviewStatus, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(entry.review?.note ?? '');
  const record = entry.record;
  const status = reviewStatus(entry);
  const evidence = evidenceCoverage(entry);
  const name = record.identity.name ?? entry.seed.name;
  const profileFactGroups = [
    { label: 'Experience', values: record.background },
    { label: 'Relevant work', values: record.work_and_projects },
    { label: 'Achievements', values: record.achievements },
    { label: 'Industry involvement', values: record.industry_activity },
  ]
    .map((group) => ({
      ...group,
      values: group.values.filter((value) => typeof value === 'string' && value.trim() && value.trim() !== '[object Object]'),
    }))
    .filter((group) => group.values.length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/55" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-labelledby="prospect-drawer-title" className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-white/[0.08] bg-[#0d0d12] shadow-2xl">
        <header className="shrink-0 border-b border-white/[0.07] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-300/75">Prospect {position} of {total}</p>
              <h2 id="prospect-drawer-title" className="mt-2 truncate text-2xl font-semibold text-white/90">{name}</h2>
              <p className="mt-1 text-xs text-white/40">{[record.role, record.organisation, record.location ?? record.country].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close prospect details" className="flex h-9 w-9 items-center justify-center rounded-full text-white/40 hover:bg-white/[0.06] hover:text-white">✕</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1 capitalize text-white/55">{record.identity.entity_kind}</span>
                        <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-white/55">Evidence {evidence.supported}/{evidence.total || 0}</span>
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1 capitalize text-white/55">{status.replace(/_/g, ' ')}</span>
            {record.matched_prospect_id && <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-amber-200">Possible duplicate</span>}
          </div>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
          \n
          <section className="rounded-2xl border border-white/[0.07] bg-[#111118] p-4 flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Contact & Links</h3>
                        <div className="flex flex-wrap gap-4">
              {record.public_contact?.find(c => c.kind === "email") && (
                <a href={"mailto:" + record.public_contact.find(c => c.kind === "email")?.value} className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-75"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> {record.public_contact.find(c => c.kind === "email")?.value}
                </a>
              )}
              {record.social_profiles?.find(p => p.platform === "linkedin") && (
                <a href={record.social_profiles.find(p => p.platform === "linkedin")?.profile_url} target="_blank" className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-75"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg> LinkedIn Profile
                </a>
              )}
              {record.websites?.[0]?.url && (
                <a href={record.websites[0]?.url} target="_blank" className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-75"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg> Website
                </a>
              )}
              {!(record.public_contact?.find(c => c.kind === "email") || record.social_profiles?.find(p => p.platform === "linkedin") || record.websites?.[0]?.url) && (
                <span className="text-sm text-white/30 italic">No contact information available.</span>
              )}
            </div>
          </section>


          
          {record.qualification_assessment.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Qualification checks</h3>
              <div className="mt-3 space-y-2">
                {record.qualification_assessment.map((assessment, index) => (
                  <div key={`${assessment.criterion}-${index}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-white/70">{assessment.criterion}</p>
                      <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] capitalize text-white/50">{assessment.status.replace(/_/g, ' ')}</span>
                    </div>
                    {assessment.note && <p className="mt-2 text-xs leading-5 text-white/40">{assessment.note}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {profileFactGroups.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Relevant profile facts</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {profileFactGroups.map(({ label, values }) => (
                  <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <h4 className="text-xs font-medium text-white/60">{label}</h4>
                    <ul className="mt-2 space-y-2 text-xs leading-5 text-white/45">
                      {values.map((value) => <li key={value}>• {value}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Evidence</h3>
            {record.evidence.length === 0 ? (
              <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4 text-xs text-amber-100/70">No supported evidence items are stored for this prospect.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {record.evidence.map((item, index) => (
                  <article key={`${item.field}-${index}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-white/30">{item.field.replace(/_/g, ' ')}</p>
                        <p className="mt-1 text-sm leading-5 text-white/70">{item.claim}</p>
                      </div>
                      <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] capitalize text-white/50">{item.confidence}</span>
                    </div>
                    {item.quote && <blockquote className="mt-3 border-l-2 border-white/10 pl-3 text-xs leading-5 text-white/40">“{item.quote}”</blockquote>}
                    <div className="mt-3 flex flex-wrap gap-3">
                      {item.source_ids.map((sourceId) => {
                        const source = record.sources.find((candidate) => candidate.id === sourceId);
                        return source ? <a key={sourceId} href={source.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:text-cyan-200">{source.title || source.source_type} ↗</a> : null;
                      })}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {(record.unknowns.length > 0 || record.contradictions.length > 0 || entry.qa.issues.length > 0) && (
            <section className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/70">Review warnings</h3>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-100/65">
                {record.unknowns.map((item) => <li key={item.field}>Unknown {item.field}: {item.reason}</li>)}
                {record.contradictions.map((item) => <li key={item}>Contradiction: {item}</li>)}
                {entry.qa.issues.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}
              </ul>
            </section>
          )}

          {((record.websites?.[0]?.url) || (record.social_profiles?.find(p => p.platform === 'linkedin')?.profile_url) || (record.social_profiles?.find(p => p.platform === 'instagram')?.profile_url) || record.public_contact.length > 0) && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Public routes</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {(record.websites?.[0]?.url) && <a href={(record.websites?.[0]?.url)} target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-cyan-300">Website ↗</a>}
                {(record.social_profiles?.find(p => p.platform === 'linkedin')?.profile_url) && <a href={(record.social_profiles?.find(p => p.platform === 'linkedin')?.profile_url)} target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-cyan-300">LinkedIn ↗</a>}
                {(record.social_profiles?.find(p => p.platform === 'instagram')?.profile_url) && <a href={(record.social_profiles?.find(p => p.platform === 'instagram')?.profile_url)} target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-cyan-300">Instagram ↗</a>}
                {record.public_contact.map((contact, index) => <span key={`${contact.kind}-${index}`} className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-white/55">{contact.kind.replace(/_/g, ' ')}: {contact.value}</span>)}
              </div>
            </section>
          )}

          <section>
            <label htmlFor="review-note" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Reviewer note</label>
            <textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Add context for this decision. A reason is required for rejection." className="mt-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-cyan-300/40" />
            {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {(['shortlisted', 'rejected', 'enrichment_requested'] as ReviewStatus[]).map((decision) => (
                <button key={decision} type="button" disabled={saving || status === decision} onClick={() => onDecision(decision, note)} className={`rounded-xl px-4 py-2 text-xs font-medium transition disabled:opacity-40 ${decision === 'shortlisted' ? 'bg-cyan-300 text-black hover:bg-cyan-200' : 'border border-white/[0.09] bg-white/[0.03] text-white/65 hover:bg-white/[0.06]'}`}>
                  {saving ? 'Saving...' : decisionLabels[decision]}
                </button>
              ))}
              {status !== 'needs_review' && <button type="button" disabled={saving} onClick={() => onDecision('needs_review', note)} className="rounded-xl border border-white/[0.09] px-4 py-2 text-xs text-white/55 hover:bg-white/[0.04]">Restore to review</button>}
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.07] px-6 py-4">
          <button type="button" onClick={onPrevious} disabled={position <= 1} className="rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/[0.05] disabled:opacity-30">← Previous</button>
          <button type="button" onClick={onNext} disabled={position >= total} className="rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/[0.05] disabled:opacity-30">Next →</button>
        </footer>
      </aside>
    </div>
  );
}


