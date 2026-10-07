'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import StatusBadge from '@/components/ui/StatusBadge';
import ResearchStreamForm from '@/components/research/ResearchStreamForm';
import ResearchRecordCard from '@/components/research/ResearchRecordCard';

export default function ProjectDetailClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<any>(null);
  const [researchEntries, setResearchEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setResearchEntries(data.research || []);
      }
    } catch (e) {
      console.error('Error fetching project:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleResearchComplete = (entry: any) => {
    setResearchEntries((prev) => [entry, ...prev]);
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

  const brief = project.structured_brief?.project;
  const targetProspects = project.structured_brief?.targets || [];

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column - Context */}
        <div className="lg:col-span-4 space-y-6">
          <GlassCard padding="p-6" hover={false}>
            <h3 className="text-sm font-medium text-white/80 mb-4 uppercase tracking-wider text-[11px]">Research Goal</h3>
            <p className="text-[13px] text-white/60 leading-relaxed mb-6">
              {brief?.objective || brief?.primary_objective || 'No objective provided.'}
            </p>

            <h3 className="text-sm font-medium text-white/80 mb-4 uppercase tracking-wider text-[11px]">Target Audiences</h3>
            <div className="space-y-4">
              {targetProspects.map((t: any) => (
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[13px] font-medium text-white/80 capitalize">{t.target_type}</span>
                    <span className="text-[10px] text-cyan-400 px-2 py-0.5 rounded-md bg-cyan-400/10 border border-cyan-400/20">{t.priority}</span>
                  </div>
                  <p className="text-[11px] text-white/40">{t.description}</p>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Right Column - Agent & Records */}
        <div className="lg:col-span-8 space-y-6">
          <GlassCard padding="p-6" hover={false} className="border-cyan-500/20 bg-cyan-500/[0.02]">
            <h3 className="text-sm font-medium text-white/90 mb-4">Run Research Agent</h3>
            <ResearchStreamForm projectId={id} targetOptions={targetProspects} onComplete={handleResearchComplete} />
          </GlassCard>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-white/90 flex items-center justify-between">
              Research Results
              <span className="text-xs bg-white/10 px-2.5 py-1 rounded-full text-white/60">{researchEntries.length}</span>
            </h3>
            
            {researchEntries.length === 0 ? (
              <div className="text-center py-12 bg-white/[0.01] border border-white/[0.03] rounded-2xl border-dashed">
                <p className="text-sm text-white/40">No prospects researched yet.</p>
                <p className="text-[12px] text-white/30 mt-1">Use the Research Agent above to find and verify contacts.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {researchEntries.map((entry) => (
                  <ResearchRecordCard 
                    key={entry.record.record_id} 
                    entry={entry} 
                    onDelete={async () => {
                      const res = await fetch(`/api/projects/${id}/research?recordId=${entry.record.record_id}`, { method: 'DELETE' });
                      if (res.ok) {
                        setResearchEntries(prev => prev.filter(e => e.record.record_id !== entry.record.record_id));
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
