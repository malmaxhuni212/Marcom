'use client';

import SectionHeader from '@/components/ui/SectionHeader';
import { steps } from '@/data/mockData';
import React, { useEffect, useState } from 'react';
import BriefIntakeModal from '@/components/ui/BriefIntakeModal';

function StepIcon({ step }: { step: number }) {
  const icons: Record<number, React.ReactElement> = {
    1: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    2: <><path d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7" /><ellipse cx="12" cy="7" rx="8" ry="4" /><path d="M4 12c0 2.21 3.58 4 8 4s8-1.79 8-4" /></>,
    3: <><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /><circle cx="12" cy="12" r="3" /></>,
    4: <polygon points="5 3 19 12 5 21 5 3" />,
  };
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {icons[step]}
    </svg>
  );
}

function ArrowConnector() {
  return (
    <div className="flex items-center justify-center px-1 text-white/15 self-center shrink-0">
      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M7 4l6 6-6 6" />
      </svg>
    </div>
  );
}

export default function GetStartedSection() {
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then(res => res.json())
      .then(data => {
        setProjects(data);
        if (data.length > 0) {
          setSelectedProjectId(data[0].id);
        }
        setLoading(false);
      })
      .catch(() => {
        setProjects([]);
        setLoading(false);
      });
  }, []);

  if (loading) return null;

  if (projects.length > 0) {
    const activeProject = projects.find(p => p.id === selectedProjectId) || projects[0];
    const isReady = activeProject.status === 'READY_FOR_RESEARCH' || activeProject.status === 'active' || activeProject.status === 'completed';
    const hasResearch = activeProject.prospectsCurrent > 0;
    const allReviewed = hasResearch && activeProject.reviewCount === 0;
    const hasReviewsPending = hasResearch && activeProject.reviewCount > 0;

    const dynamicSteps = [
      { 
        step: 1, 
        title: 'Create project brief', 
        isCompleted: true,
        href: `/projects/${activeProject.id}`
      },
      { 
        step: 2, 
        title: 'Analyze targets', 
        isCompleted: isReady,
        href: `/projects/${activeProject.id}`
      },
      { 
        step: 3, 
        title: hasResearch ? `Run research agent (${activeProject.prospectsCurrent} found)` : 'Run research agent', 
        isCompleted: hasResearch,
        href: `/projects/${activeProject.id}`
      },
      { 
        step: 4, 
        title: allReviewed 
          ? 'Review prospects (Completed)' 
          : hasReviewsPending 
            ? `Review prospects (${activeProject.reviewCount} pending)` 
            : 'Review prospects', 
        isCompleted: allReviewed,
        isActive: hasReviewsPending,
        href: `/projects/${activeProject.id}/research`
      },
    ];

    return (
      <section className="py-6 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 backdrop-blur-xl bg-white/[0.02] border border-white/[0.04] rounded-xl px-6 py-4">
          <div className="flex flex-col xl:flex-row xl:items-center gap-4 w-full">
            <div className="flex items-center gap-2.5 shrink-0">
              <h4 className="text-[13px] font-semibold text-white/90 whitespace-nowrap">Setup Status</h4>
              {projects.length > 1 ? (
                <select
                  value={activeProject.id}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="bg-white/[0.04] border border-cyan-500/30 text-cyan-300 text-xs rounded-lg px-2.5 py-1 font-medium outline-none cursor-pointer hover:bg-white/[0.07] transition-colors"
                  aria-label="Select project for setup status"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-[#111118] text-white">
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[12px] font-medium text-cyan-300/80 bg-cyan-500/[0.08] border border-cyan-500/20 px-2 py-0.5 rounded-lg">
                  {activeProject.name}
                </span>
              )}
            </div>
            <div className="hidden xl:block h-4 w-px bg-white/10 shrink-0" />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {dynamicSteps.map((step, index) => (
                <div key={step.step} className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center border shrink-0 ${
                    step.isCompleted 
                      ? 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400' 
                      : (step as any).isActive 
                        ? 'bg-amber-400/10 border-amber-400/30 text-amber-300 animate-pulse' 
                        : 'border-white/20 text-white/40'
                  }`}>
                    {step.isCompleted ? (
                      <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>
                    ) : (
                      <span className="text-[9px] font-bold">{step.step}</span>
                    )}
                  </div>
                  <a href={step.href} className={`text-[12px] whitespace-nowrap transition-colors hover:underline ${
                    step.isCompleted 
                      ? 'text-white/80 hover:text-white' 
                      : (step as any).isActive 
                        ? 'text-amber-200 font-medium' 
                        : 'text-white/40'
                  }`}>
                    {step.title}
                  </a>
                  {index < dynamicSteps.length - 1 && <svg className="w-3 h-3 text-white/10 ml-4 hidden sm:block shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M7 4l6 6-6 6" /></svg>}
                </div>
              ))}
            </div>
          </div>
          <button 
            type="button" 
            className="text-[12px] text-cyan-400 hover:text-cyan-200 transition-colors whitespace-nowrap xl:ml-auto font-medium" 
            onClick={() => setIsModalOpen(true)}
          >
            + Create New Project
          </button>
        </div>
        <BriefIntakeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={() => window.location.reload()} />
      </section>
    );
  }

  return (
    <section className="py-10">
      <SectionHeader title="Get started" subtitle="Set up a new project in a few simple steps." />
      <div className="flex items-stretch gap-0 mt-6">
        {steps.map((step, index) => (
          <div key={step.step} className="flex items-stretch">
            <div 
              onClick={() => step.step === 1 ? setIsModalOpen(true) : null}
              className={`group relative flex-1 min-w-[200px] backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 transition-all duration-300 ${step.step === 1 ? 'hover:bg-white/[0.05] hover:border-white/[0.1] hover:-translate-y-0.5 cursor-pointer' : ''}`}
            >
              <div className="flex items-center gap-3 mb-3.5">
                <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[12px] font-bold text-white/70">
                  {step.step}
                </div>
                <div className="text-white/35 group-hover:text-white/50 transition-colors">
                  <StepIcon step={step.step} />
                </div>
              </div>
              <h4 className="text-[14px] font-semibold text-white/85 mb-2">{step.title}</h4>
              <p className="text-[12px] text-white/35 leading-relaxed">{step.description}</p>
              <div className="absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 bg-gradient-to-b from-white/[0.02] to-transparent blur-sm" />
            </div>
            {index < steps.length - 1 && <ArrowConnector />}
          </div>
        ))}
      </div>
      <BriefIntakeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSuccess={() => window.location.reload()} />
    </section>
  );
}
