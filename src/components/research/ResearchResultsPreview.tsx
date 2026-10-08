'use client';

import Link from 'next/link';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import { evidenceCoverage, reviewStatus, type ResearchReviewSummary } from '@/marcom/research/review';

const statusLabels = {
  needs_review: 'Needs review',
  shortlisted: 'Shortlisted',
  rejected: 'Rejected',
  enrichment_requested: 'More research',
} as const;

function PreviewCard({ projectId, entry }: { projectId: string; entry: ResearchEntry }) {
  const record = entry.record;
  const evidence = evidenceCoverage(entry);
  const status = reviewStatus(entry);
  const name = record.identity.name ?? entry.seed.name;
  return (
    <article className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 transition hover:border-white/[0.12] hover:bg-white/[0.035]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-base font-semibold text-white/90">{name}</h4>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] capitalize text-white/45">{record.identity.entity_kind}</span>
          </div>
          <p className="mt-1 truncate text-xs text-white/40">
            {[record.role, record.organisation, record.location ?? record.country].filter(Boolean).join(' · ') || 'Profile details require review'}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-2.5 py-1 text-[10px] font-medium text-cyan-200/80">
          {statusLabels[status]}
        </span>
      </div>

      <p className="mt-4 line-clamp-2 text-[13px] leading-5 text-white/55">{record.summary || 'No profile summary is available.'}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.05] pt-3 text-[11px] text-white/40">
        <span className="capitalize">{record.fit.band.replace(/_/g, ' ')} fit</span>
        <span>{evidence.supported}/{evidence.total || 0} evidence fields</span>
        <span className="capitalize">{record.research_confidence} confidence</span>
        <button 
          type="button"
          onClick={async (e) => {
            e.preventDefault();
            if (confirm('Are you sure you want to delete this prospect?')) {
              await fetch(`/api/projects/${projectId}/research?recordId=${encodeURIComponent(record.record_id)}`, { method: 'DELETE' });
              window.location.reload();
            }
          }}
          className="ml-auto font-medium text-red-400 transition hover:text-red-300"
        >
          Delete
        </button>
        <Link
          href={`/projects/${projectId}/research?prospect=${encodeURIComponent(record.record_id)}`}
          className="font-medium text-cyan-300 transition hover:text-cyan-200"
        >
          Review profile →
        </Link>
      </div>
    </article>
  );
}

export default function ResearchResultsPreview({
  projectId,
  entries,
  summary,
}: {
  projectId: string;
  entries: ResearchEntry[];
  summary: ResearchReviewSummary;
}) {
  if (summary.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.07] bg-white/[0.01] py-12 text-center">
        <p className="text-sm text-white/45">No prospects researched yet.</p>
        <p className="mt-1 text-xs text-white/30">Run a bounded search to create the first reviewable prospect records.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="result-preview-title">
      <div>
        <h3 id="result-preview-title" className="text-sm font-medium text-white/90">Latest Research Results</h3>
      </div>
      
      <article className="rounded-2xl border border-white/[0.07] bg-[#111118] p-6 transition hover:border-white/[0.12] flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="text-base font-semibold text-white/90">Research Batch Finished</h4>
          <p className="mt-1 text-sm text-white/40">
            Successfully processed latest prospects. Your database now contains {summary.total} evidence-backed records.
          </p>
        </div>
        <Link href={`/projects/${projectId}/research`} className="shrink-0 rounded-xl bg-white text-black px-6 py-2.5 text-sm font-medium transition hover:bg-white/90 hover:scale-[1.02]">
          View all {summary.total} results
        </Link>
      </article>
    </section>
  );
}

