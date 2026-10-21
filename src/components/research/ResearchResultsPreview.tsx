'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { ResearchReviewSummary } from '@/marcom/research/review';
import { authenticatedFetch } from '@/auth/client';

export default function ResearchResultsPreview({
  projectId,
  entries,
  summary,
}: {
  projectId: string;
  entries: ResearchEntry[];
  summary: ResearchReviewSummary;
}) {
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);

  const handleDeleteBatch = async (batchId: string, batchNumber: number, count: number) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete all ${count} leads in Batch ${batchNumber}? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingBatch(batchId);
    try {
      const res = await authenticatedFetch(`/api/projects/${projectId}/research?batchId=${encodeURIComponent(batchId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete batch');
      }
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to delete batch');
      setDeletingBatch(null);
    }
  };

  const batchGroups = useMemo(() => {
    const map = new Map<number, { id: string; number: number; count: number; sampleNames: string[] }>();
    for (const e of entries) {
      const num = e.batch_number ?? 1;
      const bId = e.batch_id ?? `batch-${num}`;
      const name = e.record?.identity?.name || e.seed?.name;
      const existing = map.get(num);
      if (!existing) {
        map.set(num, {
          id: bId,
          number: num,
          count: 1,
          sampleNames: name ? [name] : [],
        });
      } else {
        existing.count += 1;
        if (name && existing.sampleNames.length < 3 && !existing.sampleNames.includes(name)) {
          existing.sampleNames.push(name);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.number - a.number);
  }, [entries]);

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
      <div className="flex items-center justify-between">
        <h3 id="result-preview-title" className="text-sm font-medium text-white/90">Latest Research Results</h3>
        <span className="text-xs text-white/40">{batchGroups.length} {batchGroups.length === 1 ? 'batch' : 'batches'} completed</span>
      </div>
      
      <div className="space-y-3">
        {batchGroups.map((b) => (
          <article 
            key={b.id} 
            className="rounded-2xl border border-white/[0.07] bg-[#111118] p-5 transition hover:border-cyan-500/30 flex flex-wrap items-center justify-between gap-4"
          >
            <div>
              <div className="flex items-center gap-2.5">
                <h4 className="text-base font-semibold text-white/90">Batch {b.number} Finished</h4>
                <span className="text-[11px] font-medium text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 rounded-lg">
                  {b.count} {b.count === 1 ? 'prospect' : 'prospects'}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-white/40">
                {b.sampleNames.length > 0 
                  ? `Includes ${b.sampleNames.join(', ')}${b.count > b.sampleNames.length ? ' and more' : ''}.` 
                  : `Successfully processed ${b.count} evidence-backed records.`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link 
                href={`/projects/${projectId}/research?batch=${encodeURIComponent(b.id)}`} 
                className="shrink-0 rounded-xl bg-white text-black px-5 py-2 text-xs font-semibold transition hover:bg-white/90 hover:scale-[1.02]"
              >
                Batch {b.number} Page
              </Link>
              <button
                type="button"
                onClick={() => handleDeleteBatch(b.id, b.number, b.count)}
                disabled={deletingBatch === b.id}
                className="rounded-xl border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/20 hover:border-red-500/40 disabled:opacity-50 flex items-center justify-center text-sm"
                title={`Delete Batch ${b.number} leads`}
                aria-label={`Delete Batch ${b.number} leads`}
              >
                {deletingBatch === b.id ? '⏳' : '🗑️'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {batchGroups.length > 1 && (
        <div className="text-center pt-2">
          <Link 
            href={`/projects/${projectId}/research?batch=all`} 
            className="text-xs text-white/40 hover:text-cyan-300 transition-colors underline-offset-4 hover:underline"
          >
            View all {summary.total} results combined →
          </Link>
        </div>
      )}
    </section>
  );
}

