'use client';

import { useState } from 'react';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SecondaryButton from '@/components/ui/SecondaryButton';
import AgentVisual from '@/components/home/AgentVisual';
import BriefIntakeModal from '@/components/ui/BriefIntakeModal';
import DemoTutorialModal from '@/components/ui/DemoTutorialModal';

export default function HeroSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  return (
    <section className="relative ambient-glow pt-6 pb-12">
      <div className="relative z-10 flex items-start justify-between gap-8">
        {/* Left: Copy */}
        <div className="flex-1 max-w-xl pt-4">
          {/* Eyebrow */}
          <p className="text-[11px] font-medium tracking-[0.2em] uppercase text-white/30 mb-5">
            Welcome to MARCOM
          </p>

          {/* Headline */}
          <h2 className="font-[var(--font-playfair)] text-[3.2rem] leading-[1.1] font-medium text-white/95 mb-6" style={{ fontFamily: 'var(--font-playfair), Georgia, serif' }}>
            From research<br />
            to real <span className="gradient-text-connections">connections.</span>
          </h2>

          {/* Supporting copy */}
          <p className="text-[15px] leading-relaxed text-white/45 mb-8 max-w-md">
            MARCOM uses specialized AI agents to research, personalize,
            and help you reach the right people — all connected to your
            Notion workspace.
          </p>

          {/* CTAs */}
          <div className="flex items-center gap-3">
            <PrimaryButton
              onClick={() => setIsModalOpen(true)}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              }
            >
              Create New Project
              <svg className="w-3.5 h-3.5 ml-1 opacity-50" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 3l5 4-5 4" />
              </svg>
            </PrimaryButton>

            <SecondaryButton
              onClick={() => setIsTutorialOpen(true)}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6 3.5v9l6.5-4.5z" />
                </svg>
              }
            >
              View Demo
            </SecondaryButton>
          </div>
        </div>

        {/* Right: Agent Visual */}
        <div className="flex-1 max-w-[560px] -mr-4">
          <AgentVisual />
        </div>
      </div>
      
      <BriefIntakeModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSuccess={() => window.location.reload()} 
      />

      <DemoTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        onStartProject={() => setIsModalOpen(true)}
      />
    </section>
  );
}
