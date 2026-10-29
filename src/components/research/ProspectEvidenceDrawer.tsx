'use client';

import { useState } from 'react';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { evidenceCoverage, reviewStatus } from '@/marcom/research/review';
import PersonalizationPanel from '@/components/personalization/PersonalizationPanel';
import { socialPlatformLabel } from '@/components/workspace/format';
import {
  getPersonalizationActionPresentation,
  type PersonalizationAvailability,
} from '@/marcom/personalization/presentation';

const decisionLabels: Partial<Record<ReviewStatus, string>> = {
  rejected: 'Reject',
  enrichment_requested: 'Request more research',
};

export default function ProspectEvidenceDrawer({
  entry,
  position,
  total,
  saving,
  error,
  projectId,
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
  projectId?: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDecision: (status: ReviewStatus, note: string) => Promise<void>;
}) {
  const [drawerTab, setDrawerTab] = useState<'evidence' | 'outreach'>('evidence');
  const [note, setNote] = useState(entry.review?.note ?? '');
  const [personalizationAvailability, setPersonalizationAvailability] = useState<PersonalizationAvailability>('loading');
  const [generationRequest, setGenerationRequest] = useState(0);
  const record = entry.record;
  const status = reviewStatus(entry);
  const evidence = evidenceCoverage(entry);
  const name = record.identity.name ?? entry.seed.name;
  const resolvedProjectId = projectId || record.project_id || '';
  const personalizationAction = getPersonalizationActionPresentation(personalizationAvailability);

  const handlePersonalizationAction = async () => {
    if (personalizationAction.action === 'view') {
      setDrawerTab('outreach');
      return;
    }

    try {
      if (status !== 'shortlisted') {
        await onDecision('shortlisted', note);
      }
      setDrawerTab('outreach');
      setGenerationRequest((current) => current + 1);
    } catch {
      // The parent owns and displays the review-decision error.
    }
  };

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

        {/* Drawer Tabs */}
        <div className="flex border-b border-white/[0.08] bg-white/[0.015] px-6">
          <button
            type="button"
            onClick={() => setDrawerTab('evidence')}
            className={`py-3 px-4 text-xs font-medium border-b-2 transition ${
              drawerTab === 'evidence'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            📊 Research & Evidence
          </button>
          <button
            type="button"
            onClick={() => setDrawerTab('outreach')}
            className={`py-3 px-4 text-xs font-medium border-b-2 transition flex items-center gap-2 ${
              drawerTab === 'outreach'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            <span>✉️ Personalized Outreach</span>
            {status === 'shortlisted' && (
              <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                Shortlisted
              </span>
            )}
          </button>
        </div>

        {/* TAB CONTENT */}
        <div className={drawerTab === 'outreach' ? 'flex-1 overflow-y-auto px-6 py-6' : 'hidden'}>
            <PersonalizationPanel
              projectId={resolvedProjectId}
              recordId={record.record_id}
              prospectName={name}
              generationRequest={generationRequest}
              onAvailabilityChange={setPersonalizationAvailability}
            />
        </div>
        {drawerTab === 'evidence' && (
          <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
            <section className="rounded-2xl border border-white/[0.07] bg-[#111118] p-4 flex flex-col gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Contact & Links</h3>
              <div className="flex flex-wrap gap-4">
                {record.public_contact?.find(c => c.kind === "email") && (
                  <a href={"mailto:" + record.public_contact.find(c => c.kind === "email")?.value} className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-75"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> {record.public_contact.find(c => c.kind === "email")?.value}
                  </a>
                )}
                {record.public_contact?.find(c => c.kind === "phone") && (
                  <a href={"tel:" + record.public_contact.find(c => c.kind === "phone")?.value?.replace(/\s+/g, '')} className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition">
                    <span>📞</span> {record.public_contact.find(c => c.kind === "phone")?.value}
                  </a>
                )}
                {record.social_profiles?.map((profile, idx) => (
                  <a key={`${profile.platform}-${idx}`} href={profile.profile_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition">
                    <span>🔗</span> {socialPlatformLabel(profile.platform)} Profile ↗
                  </a>
                ))}
                {record.websites?.[0]?.url && (
                  <a href={record.websites[0]?.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-75"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg> Website
                  </a>
                )}
                {!(record.public_contact?.find(c => c.kind === "email") || record.public_contact?.find(c => c.kind === "phone") || (record.social_profiles && record.social_profiles.length > 0) || record.websites?.[0]?.url || (record.key_contacts && record.key_contacts.length > 0)) && (
                  <span className="text-sm text-white/30 italic">No contact information available.</span>
                )}
              </div>
              {record.key_contacts && record.key_contacts.length > 0 && (
                <div className="mt-2 border-t border-white/[0.06] pt-3 flex flex-col gap-2">
                  <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Relevant People ({record.key_contacts.length})</h4>
                  <div className="space-y-2">
                    {record.key_contacts.map((person, idx) => (
                      <div key={`${person.name}-${idx}`} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white/85">{person.name}</span>
                          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] capitalize text-white/50">{person.confidence}</span>
                        </div>
                        {(person.role || person.department) && (
                          <div className="mt-0.5 text-white/55">{[person.role, person.department].filter(Boolean).join(' · ')}</div>
                        )}
                        {person.relevance && <div className="mt-1 text-white/40">{person.relevance}</div>}
                        <div className="mt-2 flex flex-wrap gap-3">
                          {person.email && <a href={`mailto:${person.email}`} className="text-blue-400 hover:underline">{person.email}</a>}
                          {person.linkedin_url && <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">LinkedIn ↗</a>}
                          {person.phone && <span className="text-emerald-400">{person.phone}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
                  {record.contradictions.map((item, index) => <li key={index}>Contradiction: {String(item)}</li>)}
                  {entry.qa.issues.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}
                </ul>
              </section>
            )}

            {((record.websites?.[0]?.url) || (record.social_profiles && record.social_profiles.length > 0) || record.public_contact.length > 0) && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Public routes</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(record.websites?.[0]?.url) && <a href={(record.websites?.[0]?.url)} target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-cyan-300">Website ↗</a>}
                  {record.social_profiles?.map((profile, idx) => (
                    <a key={`${profile.platform}-${idx}`} href={profile.profile_url} target="_blank" rel="noreferrer" className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-cyan-300">
                      {socialPlatformLabel(profile.platform)} ↗
                    </a>
                  ))}
                  {record.public_contact.map((contact, index) => <span key={`${contact.kind}-${index}`} className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-white/55">{contact.kind.replace(/_/g, ' ')}: {contact.value}</span>)}
                </div>
              </section>
            )}

            <section>
              <label htmlFor="review-note" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Reviewer note</label>
              <textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Add context for this decision. A reason is required for rejection." className="mt-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-cyan-300/40" />
              {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving || personalizationAction.disabled}
                  onClick={() => void handlePersonalizationAction()}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-40"
                >
                  {saving ? 'Saving...' : personalizationAction.label}
                </button>
                {(['rejected', 'enrichment_requested'] as ReviewStatus[]).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={saving || status === decision}
                    onClick={() => void onDecision(decision, note)}
                    className="rounded-xl border border-white/[0.09] bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/65 transition hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    {saving ? 'Saving...' : decisionLabels[decision] ?? decision}
                  </button>
                ))}
                {status !== 'needs_review' && (
                  <button type="button" disabled={saving} onClick={() => onDecision('needs_review', note)} className="rounded-xl border border-white/[0.09] px-4 py-2 text-xs text-white/55 hover:bg-white/[0.04]">
                    Restore to review
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.07] px-6 py-4">
          <button type="button" onClick={onPrevious} disabled={position <= 1} className="rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/[0.05] disabled:opacity-30">← Previous</button>
          <button type="button" onClick={onNext} disabled={position >= total} className="rounded-lg px-3 py-2 text-xs text-white/50 hover:bg-white/[0.05] disabled:opacity-30">Next →</button>
        </footer>
      </aside>
    </div>
  );
}
