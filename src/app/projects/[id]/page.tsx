'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import StatusBadge from '@/components/ui/StatusBadge';
import ResearchStreamForm, { type ResearchCompletion } from '@/components/research/ResearchStreamForm';
import ResearchResultsPreview from '@/components/research/ResearchResultsPreview';
import CampaignConfigurationForm from '@/components/campaign/CampaignConfigurationForm';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ProjectMemory } from '@/marcom/memory/types';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { ResearchReviewSummary } from '@/marcom/research/review';
import { authenticatedFetch } from '@/auth/client';

const emptyResearchSummary: ResearchReviewSummary = {
  total: 0,
  needs_review: 0,
  shortlisted: 0,
  rejected: 0,
  enrichment_requested: 0,
  possible_duplicates: 0,
};

export default function ProjectDetailClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<ProjectMemory | null>(null);
  const [researchEntries, setResearchEntries] = useState<ResearchEntry[]>([]);
  const [researchSummary, setResearchSummary] = useState<ResearchReviewSummary>(emptyResearchSummary);
  const [researchNotice, setResearchNotice] = useState<{ message: string; recordId?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingConfiguration, setEditingConfiguration] = useState(false);
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const res = await authenticatedFetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setResearchEntries(data.research || []);
        setResearchSummary(data.research_summary || emptyResearchSummary);
      }
    } catch (e) {
      console.error('Error fetching project:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch(`/api/projects/${id}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Project could not be loaded.')))
      .then((data: { project: ProjectMemory; research?: ResearchEntry[]; research_summary?: ResearchReviewSummary }) => {
        if (cancelled) return;
        setProject(data.project);
        setResearchEntries(data.research || []);
        setResearchSummary(data.research_summary || emptyResearchSummary);
      })
      .catch((error: unknown) => console.error('Error fetching project:', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleResearchComplete = (result: ResearchCompletion) => {
    setResearchNotice({
      message: result.message,
      recordId: result.entry?.record.record_id,
    });
    void loadData();
  };

  const saveConfiguration = async (structuredBrief: StructuredBrief) => {
    if (!project) return;
    setSavingConfiguration(true);
    setConfigurationError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured_brief: structuredBrief,
          expected_revision: project.configuration_revision ?? 1,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Campaign configuration could not be saved.');
      setProject(data.project);
      setEditingConfiguration(false);
    } catch (error) {
      setConfigurationError((error as Error).message);
    } finally {
      setSavingConfiguration(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-10 text-center">
        <h2 className="text-xl text-white/80">Project not found</h2>
        <Link href="/" className="text-cyan-400 hover:underline mt-4 inline-block">
          Back to home
        </Link>
      </div>
    );
  }

  const structuredBrief = project.structured_brief;
  const brief = structuredBrief?.project;
  const targetProspects = structuredBrief?.targets || [];
  const searchSettings = structuredBrief?.research.search_settings;

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <Link href="/" className="text-[13px] text-white/40 hover:text-white/80 mb-3 inline-flex items-center gap-1.5 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Projects
          </Link>
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-semibold text-white/90">{project.name}</h1>
            <StatusBadge status={project.status === 'READY_FOR_RESEARCH' ? 'active' : (project.status || 'draft')} />
          </div>
          <p className="text-sm text-white/40 mt-2 max-w-2xl">{brief?.description}</p>
        </div>
        {structuredBrief && (
          <button
            type="button"
            onClick={() => {
              setConfigurationError(null);
              setEditingConfiguration(true);
            }}
            className="mt-8 shrink-0 rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white"
          >
            Edit configuration
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column - Context */}
        <div className="lg:col-span-4 space-y-6">
          <GlassCard padding="p-6" hover={false}>
            <h3 className="text-sm font-medium text-white/80 mb-4 uppercase tracking-wider text-[11px]">Primary objective</h3>
            <p className="text-[13px] text-white/60 leading-relaxed mb-6">
              {brief?.primary_objective || 'No objective provided.'}
            </p>

            {brief?.secondary_objectives && brief.secondary_objectives.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/80">Additional objectives</h3>
                <ul className="space-y-2 text-xs leading-5 text-white/50">
                  {brief.secondary_objectives.map((objective) => <li key={objective} className="flex gap-2"><span className="text-cyan-300">•</span>{objective}</li>)}
                </ul>
              </div>
            )}

            <h3 className="text-sm font-medium text-white/80 mb-4 uppercase tracking-wider text-[11px]">Target Audiences</h3>
            <div className="space-y-4">
              {targetProspects.map((t) => (
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[13px] font-medium text-white/80 capitalize">{t.target_type}</span>
                    <span className="text-[10px] text-cyan-400 px-2 py-0.5 rounded-md bg-cyan-400/10 border border-cyan-400/20">{t.priority}</span>
                  </div>
                  <p className="text-[11px] text-white/40">{t.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-white/45">{t.entity_kind}</span>
                    {(t.geography.length ? t.geography : ['No geographic restriction']).map((location: string) => (
                      <span key={location} className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-white/45">{location}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {searchSettings && (
              <div className="mt-6 border-t border-white/[0.06] pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-white/80">Search defaults</h3>
                  <span className="text-[10px] text-white/35">Up to {searchSettings.default_result_limit} results</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {searchSettings.keywords.map((keyword) => (
                    <span key={keyword} className="rounded-md border border-cyan-400/10 bg-cyan-400/[0.05] px-2 py-1 text-[10px] text-cyan-200/70">{keyword}</span>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>
        </div>

        {/* Right Column - Agent & Records */}
        <div className="lg:col-span-8 space-y-6">
          <GlassCard padding="p-6" hover={false} className="border-cyan-500/20 bg-cyan-500/[0.02]">
            <h3 className="text-sm font-medium text-white/90 mb-1">Search for prospects</h3>
            <p className="mb-4 text-xs text-white/40">Choose a target group and adjust the result limit for this run. The saved campaign configuration remains unchanged.</p>
            <ResearchStreamForm projectId={id} targetOptions={targetProspects} defaultResultLimit={searchSettings?.default_result_limit} onComplete={handleResearchComplete} />
          </GlassCard>

          {researchNotice && (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-green-300/15 bg-green-300/[0.045] px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-green-100/85">Search finished</p>
                <p className="mt-0.5 text-xs text-green-100/50">{researchNotice.message}</p>
              </div>
              <Link href={`/projects/${id}/research${researchNotice.recordId ? `?prospect=${encodeURIComponent(researchNotice.recordId)}` : ''}`} className="rounded-lg bg-green-200 px-3 py-2 text-xs font-medium text-[#07110d] hover:bg-green-100">
                Review results
              </Link>
              <button type="button" aria-label="Dismiss search completion notice" onClick={() => setResearchNotice(null)} className="rounded-lg p-2 text-green-100/45 hover:bg-white/[0.05] hover:text-green-100">✕</button>
            </div>
          )}

          <ResearchResultsPreview projectId={id} entries={researchEntries} summary={researchSummary} />
        </div>
      </div>

      {editingConfiguration && structuredBrief && (
        <div role="dialog" aria-modal="true" aria-labelledby="edit-configuration-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#08080c]/90 p-4 backdrop-blur-md md:p-6">
          <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d12] shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-6 py-5 md:px-8">
              <div>
                <h2 id="edit-configuration-title" className="text-xl font-semibold text-white/90">Edit campaign configuration</h2>
                <p className="mt-1 text-xs text-white/40">Changes apply to future research runs. Existing results are not rewritten.</p>
              </div>
              <button type="button" aria-label="Close configuration editor" onClick={() => setEditingConfiguration(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-white/40 hover:bg-white/[0.05] hover:text-white">✕</button>
            </div>
            <CampaignConfigurationForm
              key={project.configuration_revision ?? 1}
              initialBrief={structuredBrief}
              submitLabel="Save changes"
              submitting={savingConfiguration}
              serverError={configurationError}
              onCancel={() => setEditingConfiguration(false)}
              onSubmit={saveConfiguration}
            />
          </div>
        </div>
      )}
    </div>
  );
}
