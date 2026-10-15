'use client';

import { useState } from 'react';

interface DemoTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartProject?: () => void;
}

export default function DemoTutorialModal({ isOpen, onClose, onStartProject }: DemoTutorialModalProps) {
  const [step, setStep] = useState(0);

  if (!isOpen) return null;

  const steps = [
    {
      title: 'Welcome to MARCOM Automation',
      subtitle: 'Your AI-powered prospect discovery, research, and outreach engine.',
      icon: '🚀',
      content: (
        <div className="space-y-4 text-xs leading-relaxed text-white/70">
          <p>
            MARCOM transforms raw marketing briefs into verified, evidence-backed leads ready for targeted outreach.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-3">
              <span className="text-base mb-1 block">📝</span>
              <p className="font-semibold text-white/90">1. Brief Analyzer</p>
              <p className="text-[11px] text-white/40 mt-1">Extracts goals & target criteria automatically.</p>
            </div>
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
              <span className="text-base mb-1 block">🔍</span>
              <p className="font-semibold text-white/90">2. Research Agent</p>
              <p className="text-[11px] text-white/40 mt-1">Deep-crawls web sources for bios, awards & emails.</p>
            </div>
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/[0.04] p-3">
              <span className="text-base mb-1 block">✨</span>
              <p className="font-semibold text-white/90">3. Personalization</p>
              <p className="text-[11px] text-white/40 mt-1">Generates tailored outreach hooks per prospect.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: 'Step 1: Campaign Brief Intake',
      subtitle: 'Agent 1 reads your campaign goals and structures search criteria.',
      icon: '📋',
      content: (
        <div className="space-y-3 text-xs leading-relaxed text-white/70">
          <p>
            Click <strong className="text-white font-medium">"Create New Project"</strong> and paste in your project description or campaign brief (1–3 pages).
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-white/60 ml-1">
            <li>Identifies primary objectives and secondary goals.</li>
            <li>Defines distinct <span className="text-cyan-300">Target Audiences</span> (e.g. Literary publishers, festival directors).</li>
            <li>Calibrates search keywords and location constraints automatically.</li>
          </ul>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[11px] text-white/50">
            💡 <strong className="text-white/80">Pro Tip:</strong> Tightly scoped briefs with clear criteria produce significantly higher quality search results.
          </div>
        </div>
      ),
    },
    {
      title: 'Step 2: Autonomous Research & QA',
      subtitle: 'Agent 2 discovers candidates, scrapes up to 10 sources, and verifies facts.',
      icon: '🔎',
      content: (
        <div className="space-y-3 text-xs leading-relaxed text-white/70">
          <p>
            Inside your project, choose a Target Group and set your desired prospect count (e.g. 10 or 20).
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-white/60 ml-1">
            <li><strong className="text-white">Multi-Source Extraction:</strong> Crawls author bios, mastheads, press releases, and websites.</li>
            <li><strong className="text-white">Public Contact Discovery:</strong> Captures public emails, official domains, and LinkedIn/social profiles.</li>
            <li><strong className="text-white">Evidence & QA Verification:</strong> Cross-references every claim with web citations and calculates a confidence score.</li>
            <li><strong className="text-white">Duplicate Filter:</strong> Prevents researching the same person twice across all projects.</li>
          </ul>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-[11px] text-cyan-200/80">
            ⚡ <strong className="text-white">Sweet Spot:</strong> Researching <strong>10 to 20 leads per run</strong> takes just 1–2 minutes and prevents hitting AI rate-limit walls.
          </div>
        </div>
      ),
    },
    {
      title: 'Step 3: Organized Stacked Batches',
      subtitle: 'Every research run creates a dedicated, organized batch page.',
      icon: '📁',
      content: (
        <div className="space-y-3 text-xs leading-relaxed text-white/70">
          <p>
            To keep your database organized and clutter-free, each run creates a separate batch:
          </p>
          <div className="space-y-2 pt-1">
            <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white/90 text-xs">Dedicated Batch Pages</p>
                <p className="text-[11px] text-white/40">Open Batch 1, Batch 2, or Batch 3 independently so leads stay clean.</p>
              </div>
              <span className="text-[10px] text-cyan-300 font-medium bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-md">Separated</span>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white/90 text-xs">Evidence Drawer & One-Click Review</p>
                <p className="text-[11px] text-white/40">Inspect live website citations and mark prospects as Qualified or Rejected.</p>
              </div>
              <span className="text-[10px] text-green-300 font-medium bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-md">Verified</span>
            </div>
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-[#08080c]/85 p-4 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-xl rounded-2xl border border-white/[0.1] bg-[#0e0e14] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{currentStep.icon}</span>
            <div>
              <h3 className="text-sm font-semibold text-white/90">{currentStep.title}</h3>
              <p className="text-[11px] text-white/40">{currentStep.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 min-h-[220px]">
          {currentStep.content}
        </div>

        {/* Footer / Navigation */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3.5 bg-white/[0.01]">
          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setStep(idx)}
                className={`h-1.5 rounded-full transition-all ${step === idx ? 'w-5 bg-cyan-400' : 'w-1.5 bg-white/20 hover:bg-white/40'}`}
                aria-label={`Go to tutorial step ${idx + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="px-3 py-1.5 text-xs text-white/60 hover:text-white transition-colors"
              >
                Previous
              </button>
            )}

            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                className="rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 px-4 py-1.5 text-xs font-medium hover:bg-cyan-500/30 transition-colors"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onStartProject) onStartProject();
                }}
                className="rounded-xl bg-white text-black px-4 py-1.5 text-xs font-semibold hover:bg-white/90 transition-all hover:scale-[1.02]"
              >
                Get Started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
