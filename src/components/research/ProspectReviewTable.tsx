'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ProspectEvidenceDrawer from './ProspectEvidenceDrawer';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { evidenceCoverage, reviewStatus, type ResearchReviewSummary } from '@/marcom/research/review';

interface ReviewResponse {
  project: { id: string; name: string };
  items: ResearchEntry[];
  pagination: { page: number; page_size: number; total: number; page_count: number };
  summary: ResearchReviewSummary;
  facets: { locations: string[]; targets: string[]; batches?: { id: string; number: number; count: number }[] };
}

const emptySummary: ResearchReviewSummary = {
  total: 0,
  needs_review: 0,
  shortlisted: 0,
  rejected: 0,
  enrichment_requested: 0,
  possible_duplicates: 0,
};

const statusLabel: Record<ReviewStatus, string> = {
  needs_review: 'Needs review',
  shortlisted: 'Personalized',
  rejected: 'Rejected',
  enrichment_requested: 'More research',
};

function StatusPill({ status }: { status: ReviewStatus }) {
  const style = status === 'shortlisted'
    ? 'border-purple-300/20 bg-purple-500/10 text-purple-200'
    : status === 'rejected'
      ? 'border-red-300/15 bg-red-300/[0.06] text-red-200'
      : status === 'enrichment_requested'
        ? 'border-amber-300/15 bg-amber-300/[0.06] text-amber-200'
        : 'border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium ${style}`}>{statusLabel[status]}</span>;
}

function SummaryItem({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border p-4 text-left transition ${active ? 'border-cyan-300/30 bg-cyan-300/[0.07]' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]'}`}>
      <span className="block text-2xl font-semibold text-white/85">{value}</span>
      <span className="mt-1 block text-xs text-white/40">{label}</span>
    </button>
  );
}

export default function ProspectReviewTable({ projectId, initialProspectId, initialBatch }: { projectId: string; initialProspectId?: string; initialBatch?: string }) {
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [entityType, setEntityType] = useState('all');
  const [target, setTarget] = useState('');
  const [location, setLocation] = useState('');
  const [confidence, setConfidence] = useState('all');
  const [coverage, setCoverage] = useState('all');
  const [batch, setBatch] = useState(initialBatch || 'all');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openRecordId, setOpenRecordId] = useState<string | null>(initialProspectId ?? null);
  const [savingDecision, setSavingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: query,
        status,
        type: entityType,
        target,
        location,
        confidence,
        coverage,
        sort,
        page: String(page),
        pageSize: '20',
        ...(batch !== 'all' ? { batch } : {}),
      });
      setLoading(true);
      setError(null);
      fetch(`/api/projects/${projectId}/research?${params}`, { signal: controller.signal })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Research results could not be loaded.');
          return result as ReviewResponse;
        })
        .then((result) => {
          setData(result);
          setSelectedIds(new Set());
        })
        .catch((fetchError: unknown) => {
          if ((fetchError as Error).name !== 'AbortError') setError(fetchError instanceof Error ? fetchError.message : 'Research results could not be loaded.');
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, query, status, entityType, target, location, confidence, coverage, batch, sort, page, refreshToken]);

  const openIndex = useMemo(() => data?.items.findIndex((entry) => entry.record.record_id === openRecordId) ?? -1, [data, openRecordId]);
  const openEntry = openIndex >= 0 ? data?.items[openIndex] ?? null : null;

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

  const saveDecision = async (entry: ResearchEntry, nextStatus: ReviewStatus, note: string) => {
    setSavingDecision(true);
    setDecisionError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/research`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_id: entry.record.record_id, status: nextStatus, note: note || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The review decision could not be saved.');
      setRefreshToken((value) => value + 1);
    } catch (saveError) {
      setDecisionError(saveError instanceof Error ? saveError.message : 'The review decision could not be saved.');
    } finally {
      setSavingDecision(false);
    }
  };

  const applyBatchDecision = async (nextStatus: 'shortlisted' | 'enrichment_requested') => {
    const entries = data?.items.filter((entry) => selectedIds.has(entry.record.record_id)) ?? [];
    if (!entries.length) return;
    setSavingDecision(true);
    setError(null);
    try {
      for (const entry of entries) {
        const response = await fetch(`/api/projects/${projectId}/research`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record_id: entry.record.record_id, status: nextStatus, note: null }),
        });
        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || 'A selected prospect could not be updated.');
        }
      }
      setRefreshToken((value) => value + 1);
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : 'The selected prospects could not be updated.');
    } finally {
      setSavingDecision(false);
    }
  };

  const summary = data?.summary ?? emptySummary;
  const items = data?.items ?? [];
  
  const itemsByBatch = useMemo(() => {
    if (batch !== 'all') return [{ batchId: batch, items }];
    
    const groups = new Map<string, ResearchEntry[]>();
    const unknownItems: ResearchEntry[] = [];
    for (const item of items) {
      const bid = item.batch_id ?? (item.record as any).batch_id ?? 'batch-1';
      if (!groups.has(bid)) groups.set(bid, []);
      groups.get(bid)!.push(item);
    }
    
    const sortedGroups = Array.from(groups.entries())
      .sort(([a], [b]) => {
         const numA = parseInt(a.replace(/\D/g, '')) || 0;
         const numB = parseInt(b.replace(/\D/g, '')) || 0;
         if (numA !== numB) return numA - numB;
         return a.localeCompare(b);
      })
      .map(([batchId, batchItems]) => ({ batchId, items: batchItems }));
      
    if (unknownItems.length > 0) {
      sortedGroups.push({ batchId: 'unknown', items: unknownItems });
    }
    
    return sortedGroups.length > 0 ? sortedGroups : [{ batchId: 'all', items }];
  }, [items, batch]);
  const allVisibleSelected = items.length > 0 && items.every((entry) => selectedIds.has(entry.record.record_id));

  return (
    <div className="mx-auto max-w-[1500px] space-y-7 animate-fadeIn">
      <header>
        <Link href={`/projects/${projectId}`} className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70">← Back to campaign</Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-300/70">Prospect review</p>
            <h1 className="mt-2 text-3xl font-semibold text-white/90">{data?.project.name ?? 'Campaign research'}</h1>
            <p className="mt-2 text-sm text-white/40">Filter the evidence-backed results, inspect each profile, and record a human decision.</p>
          </div>
        <button type="button" onClick={async () => { if (confirm('Are you sure you want to delete ALL researched prospects for this project? This cannot be undone.')) { await fetch(`/api/projects/${projectId}/research?all=true`, { method: 'DELETE' }); window.location.reload(); } }} className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/10">Delete Database</button></div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Research result summary">
        <SummaryItem label="All prospects" value={summary.total} active={status === 'all'} onClick={() => updateFilter(setStatus, 'all')} />
        <SummaryItem label="Needs review" value={summary.needs_review} active={status === 'needs_review'} onClick={() => updateFilter(setStatus, 'needs_review')} />
        <SummaryItem label="Personalized" value={summary.shortlisted} active={status === 'shortlisted'} onClick={() => updateFilter(setStatus, 'shortlisted')} />
        <SummaryItem label="More research" value={summary.enrichment_requested} active={status === 'enrichment_requested'} onClick={() => updateFilter(setStatus, 'enrichment_requested')} />
        <SummaryItem label="Rejected" value={summary.rejected} active={status === 'rejected'} onClick={() => updateFilter(setStatus, 'rejected')} />
      </section>

            {/* Dedicated Batch Navigation Tabs */}
      {(data?.facets.batches?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#111118] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/40 mr-1">Batch View:</span>
            {data?.facets.batches?.map((b) => {
              const isSelected = batch === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => updateFilter(setBatch, b.id)}
                  className={`rounded-xl px-4 py-2 text-xs font-medium transition-all flex items-center gap-2 ${
                    isSelected
                      ? 'bg-cyan-400 text-black shadow-lg shadow-cyan-400/20 font-semibold scale-[1.02]'
                      : 'bg-white/[0.04] border border-white/[0.08] text-white/70 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span>Batch {b.number}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isSelected ? 'bg-black/20 text-black' : 'bg-white/10 text-white/60'}`}>
                    {b.count}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => updateFilter(setBatch, 'all')}
              className={`rounded-xl px-3.5 py-2 text-xs font-medium transition-all ${
                batch === 'all'
                  ? 'bg-white text-black font-semibold'
                  : 'bg-white/[0.03] border border-white/[0.07] text-white/45 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              All Batches ({summary.total})
            </button>
          </div>

          {batch !== 'all' && (
            <div className="flex items-center gap-3 text-xs text-white/40">
              <span>Showing only <strong className="text-cyan-300 font-medium">Batch {data?.facets.batches?.find(b => b.id === batch)?.number ?? batch}</strong> ({items.length} prospects)</span>
              <button
                type="button"
                onClick={async () => {
                  const bNum = data?.facets.batches?.find(b => b.id === batch)?.number ?? batch;
                  if (confirm(`Are you sure you want to delete Batch ${bNum} (${items.length} prospects)? This cannot be undone.`)) {
                    await fetch(`/api/projects/${projectId}/research?batchId=${encodeURIComponent(batch)}`, { method: 'DELETE' });
                    window.location.reload();
                  }
                }}
                className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete this Batch
              </button>
            </div>
          )}
        </div>
      )}

      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02]">
        <div className="border-b border-white/[0.06] p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <input aria-label="Search prospects" value={query} onChange={(event) => updateFilter(setQuery, event.target.value)} placeholder="Search name, bio, role..." className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-xs text-white/75 outline-none placeholder:text-white/25 focus:border-cyan-300/35 xl:col-span-2" />
            <select aria-label="Review status" value={status} onChange={(event) => updateFilter(setStatus, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2.5 text-xs text-white/65 outline-none">
              <option value="all">All statuses</option>
              <option value="needs_review">Needs review</option>
              <option value="shortlisted">Personalized</option>
              <option value="enrichment_requested">More research</option>
              <option value="rejected">Rejected</option>
            </select>
            <select aria-label="Entity type" value={entityType} onChange={(event) => updateFilter(setEntityType, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2.5 text-xs text-white/65 outline-none">
              <option value="all">People and organisations</option>
              <option value="person">People</option>
              <option value="organisation">Organisations</option>
            </select>
            <select aria-label="Research confidence" value={confidence} onChange={(event) => updateFilter(setConfidence, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2.5 text-xs text-white/65 outline-none">
              <option value="all">All confidence</option>
              <option value="high">High confidence</option>
              <option value="medium">Medium confidence</option>
              <option value="low">Low confidence</option>
            </select>
            <select aria-label="Evidence coverage" value={coverage} onChange={(event) => updateFilter(setCoverage, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2.5 text-xs text-white/65 outline-none">
              <option value="all">All evidence coverage</option>
              <option value="complete">Complete evidence</option>
              <option value="incomplete">Missing evidence</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <select aria-label="Research batch" value={batch} onChange={(event) => updateFilter(setBatch, event.target.value)} className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] px-3 py-2 text-xs font-medium text-cyan-300 outline-none">
              <option value="all" className="bg-[#111118] text-white">All batches ({summary.total})</option>
              {(data?.facets.batches ?? []).map((b) => (
                <option key={b.id} value={b.id} className="bg-[#111118] text-white">
                  Batch {b.number} ({b.count} prospects)
                </option>
              ))}
            </select>
            <select aria-label="Target group" value={target} onChange={(event) => updateFilter(setTarget, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs text-white/60 outline-none">
              <option value="">All target groups</option>
              {(data?.facets.targets ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select aria-label="Location" value={location} onChange={(event) => updateFilter(setLocation, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs text-white/60 outline-none">
              <option value="">All locations</option>
              {(data?.facets.locations ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select aria-label="Sort results" value={sort} onChange={(event) => updateFilter(setSort, event.target.value)} className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs text-white/60 outline-none">
              <option value="newest">Newest first</option>
                            <option value="evidence_desc">Best evidence coverage</option>
              <option value="name_asc">Name A to Z</option>
            </select>
            {summary.possible_duplicates > 0 && <span className="self-center rounded-full bg-amber-300/[0.07] px-3 py-1.5 text-xs text-amber-200/75">{summary.possible_duplicates} possible duplicate{summary.possible_duplicates === 1 ? '' : 's'}</span>}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-cyan-300/10 bg-cyan-300/[0.035] px-4 py-3">
            <span className="text-xs font-medium text-cyan-100/75">{selectedIds.size} selected</span>
            <button type="button" disabled={savingDecision} onClick={() => applyBatchDecision('shortlisted')} className="rounded-lg bg-purple-400 px-3 py-2 text-xs font-medium text-black disabled:opacity-50">Personalize selected</button>
            <button type="button" disabled={savingDecision} onClick={() => applyBatchDecision('enrichment_requested')} className="rounded-lg border border-white/[0.09] px-3 py-2 text-xs text-white/60 disabled:opacity-50">Request more research</button>
            <button
              type="button"
              disabled={savingDecision}
              onClick={async () => {
                if (confirm(`Are you sure you want to delete ${selectedIds.size} selected prospects? This cannot be undone.`)) {
                  setSavingDecision(true);
                  try {
                    await fetch(`/api/projects/${projectId}/research`, {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ recordIds: Array.from(selectedIds) }),
                    });
                    setRefreshToken((v) => v + 1);
                    setSelectedIds(new Set());
                  } finally {
                    setSavingDecision(false);
                  }
                }
              }}
              className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
            >
              Delete selected
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-white/40 hover:text-white/70">Clear selection</button>
          </div>
        )}

        {error && <div role="alert" className="border-b border-red-300/15 bg-red-300/[0.04] px-4 py-3 text-xs text-red-200">{error}</div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-[0.12em] text-white/30">
                <th className="w-12 px-4 py-3"><input aria-label="Select all visible prospects" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(items.map((entry) => entry.record.record_id)) : new Set())} /></th>
                <th className="px-3 py-3 font-medium">Prospect and bio</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Location</th>
                <th className="px-3 py-3 font-medium">Role or organisation</th>
                                <th className="px-3 py-3 font-medium">Evidence</th>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Links</th>
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            {itemsByBatch.map(({ batchId, items: batchItems }) => {
              const batchInfo = data?.facets.batches?.find(b => b.id === batchId);
              const title = batchInfo ? `Batch ${batchInfo.number}` : (batchId.startsWith('batch-') ? `Batch ${batchId.replace('batch-', '')}` : batchId);

              return (
                <tbody key={batchId} className="divide-y divide-white/[0.05]">
                  {batch === 'all' && (
                    <tr className="bg-[#111118] border-y border-white/[0.08]">
                      <td colSpan={9} className="px-4 py-3 text-xs font-medium text-cyan-300 uppercase tracking-widest">
                        {title} <span className="ml-2 text-white/40 font-normal tracking-normal normal-case">({batchItems.length} prospects)</span>
                      </td>
                    </tr>
                  )}
                  {batchItems.map((entry) => {
                    const record = entry.record;
                const id = record.record_id;
                const evidence = evidenceCoverage(entry);
                const hasContact = Boolean((record.websites?.[0]?.url) || (record.social_profiles?.find(p => p.platform === 'linkedin')?.profile_url) || (record.social_profiles?.find(p => p.platform === 'instagram')?.profile_url) || record.public_contact.length);
                return (
                  <tr key={id} className="group hover:bg-white/[0.025]">
                    <td className="px-4 py-4 align-top">
                      <input
                        aria-label={`Select ${record.identity.name ?? entry.seed.name}`}
                        type="checkbox"
                        checked={selectedIds.has(id)}
                        onChange={(event) => setSelectedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="max-w-md px-3 py-4 align-top">
                      <button type="button" onClick={() => { setDecisionError(null); setOpenRecordId(id); }} className="block w-full text-left">
                        <span className="block text-sm font-medium text-white/80 group-hover:text-cyan-200">{record.identity.name ?? entry.seed.name}</span>
                        <span className="mt-1 block line-clamp-2 text-xs leading-5 text-white/40">{record.summary || 'No profile summary available.'}</span>
                      </button>
                      {(record.matched_prospect_id || entry.qa.status !== 'passed') && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {record.matched_prospect_id && <span className="text-[10px] text-amber-200/70">Possible duplicate</span>}
                          {entry.qa.status !== 'passed' && <span className="text-[10px] text-amber-200/70">QA review</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-4 align-top text-xs capitalize text-white/45">{record.identity.entity_kind}</td>
                    <td className="px-3 py-4 align-top text-xs text-white/45">{record.location ?? record.country ?? <span className="italic text-white/25">Unknown</span>}</td>
                    <td className="max-w-48 px-3 py-4 align-top text-xs text-white/45">{[record.role, record.organisation].filter(Boolean).join(' · ') || <span className="italic text-white/25">Unknown</span>}</td>
                                        <td className="px-3 py-4 align-top"><span className="text-xs text-white/55">{evidence.supported}/{evidence.total || 0}</span><span className="mt-1 block text-[10px] text-white/25">{evidence.percent}% supported</span></td>
                    <td className="px-3 py-4 align-top text-xs text-white/60">
  {(() => {
    const emailContact = record.public_contact?.find(c => c.kind === "email");
    return emailContact?.value ? (
      <a href={"mailto:" + emailContact.value} className="text-[11px] text-blue-400 hover:underline">{emailContact.value}</a>
    ) : (
      <span className="italic text-white/25">Not found</span>
    );
  })()}
</td>
<td className="px-3 py-4 align-top">
  <div className="flex flex-col gap-1.5">
    {record.social_profiles?.find(p => p.platform === "linkedin")?.profile_url && (
      <a href={record.social_profiles.find(p => p.platform === "linkedin")?.profile_url} target="_blank" className="text-[11px] text-blue-400 hover:underline flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg> LinkedIn</a>
    )}
    {record.websites?.[0]?.url && (
      <a href={record.websites[0]?.url} target="_blank" className="text-[11px] text-blue-400 hover:underline flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg> Website</a>
    )}
    {!(record.social_profiles?.find(p => p.platform === "linkedin") || record.websites?.[0]?.url) && (
      <span className="italic text-white/25 text-[11px]">Unknown</span>
    )}
  </div>
</td>

                    <td className="px-3 py-4 align-top"><StatusPill status={reviewStatus(entry)} /></td>
                  </tr>
                );
              })}
                </tbody>
              );
            })}
          </table>
        </div>

        {!loading && items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-white/45">No prospects match these filters.</p>
            <button type="button" onClick={() => { setQuery(''); setStatus('all'); setEntityType('all'); setTarget(''); setLocation(''); setConfidence('all'); setCoverage('all'); setPage(1); }} className="mt-3 text-xs text-cyan-300">Clear filters</button>
          </div>
        )}
        {loading && <div className="px-6 py-12 text-center text-xs text-white/35">Loading research results...</div>}

        {data && data.pagination.page_count > 1 && (
          <footer className="flex items-center justify-between border-t border-white/[0.06] px-4 py-4">
            <p className="text-xs text-white/35">Page {data.pagination.page} of {data.pagination.page_count} · {data.pagination.total} matching prospects</p>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-white/55 disabled:opacity-30">Previous</button>
              <button type="button" disabled={page >= data.pagination.page_count} onClick={() => setPage((value) => Math.min(data.pagination.page_count, value + 1))} className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-white/55 disabled:opacity-30">Next</button>
            </div>
          </footer>
        )}
      </section>

      {openEntry && (
        <ProspectEvidenceDrawer
          key={openEntry.record.record_id}
          entry={openEntry}
          position={openIndex + 1}
          total={items.length}
          saving={savingDecision}
          error={decisionError}
          onClose={() => setOpenRecordId(null)}
          onPrevious={() => setOpenRecordId(items[Math.max(0, openIndex - 1)].record.record_id)}
          onNext={() => setOpenRecordId(items[Math.min(items.length - 1, openIndex + 1)].record.record_id)}
          onDecision={(nextStatus, note) => saveDecision(openEntry, nextStatus, note)}
        />
      )}
    </div>
  );
}


