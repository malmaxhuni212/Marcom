'use client';

import { notionConnection } from '@/data/mockData';
import type { Agent } from '@/types';

const defaultAgents: Agent[] = [
  {
    id: '1',
    name: 'Brief Analyzer',
    description: 'Understands your goals.',
    status: 'idle',
    progress: 'Waiting for brief',
    icon: 'file-text',
    step: 1,
  },
  {
    id: '2',
    name: 'Research Agent',
    description: 'Finds relevant people.',
    status: 'idle',
    progress: 'Waiting for analysis',
    icon: 'search',
    step: 2,
  },
  {
    id: '3',
    name: 'Personalization Agent',
    description: 'Creates tailored messages.',
    status: 'idle',
    progress: 'Waiting for research',
    icon: 'sparkles',
    step: 3,
  },
];

function AgentNode({ agent, color, delay }: { agent: Agent, color: string, delay: string }) {
  return (
    <div className="relative group" style={{ animationDelay: delay }}>
      <div className="relative backdrop-blur-2xl bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 w-[240px] transition-all duration-500 hover:bg-white/[0.07] hover:border-white/[0.14] hover:shadow-lg hover:shadow-black/20">
        
        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" style={{ color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {agent.icon === 'file-text' && <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
              {agent.icon === 'search' && <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />}
              {agent.icon === 'sparkles' && <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />}
            </svg>
            <h4 className="text-[13px] font-semibold text-white/90">{agent.name}</h4>
          </div>
          
          {/* Status Indicator */}
          {agent.status === 'completed' && (
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
          )}
          {agent.status === 'working' && (
            <div className="w-1.5 h-1.5 rounded-full bg-accent-blue shadow-[0_0_8px_rgba(108,156,255,0.6)] animate-pulse" />
          )}
          {agent.status === 'waiting' && (
            <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
          )}
        </div>

        {/* Status Text */}
        <p className="text-[11px] text-white/50 font-medium">
          {agent.progress}
        </p>

        {/* Progress Bar (if working) */}
        {agent.status === 'working' && (
          <div className="mt-3 w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-accent-blue rounded-full animate-pulse" style={{ width: '47%' }} />
          </div>
        )}

        {/* Subtle glow */}
        <div
          className="absolute -inset-1 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-xl"
          style={{ backgroundColor: `${color}08` }}
        />
      </div>
    </div>
  );
}

function NotionCard() {
  return (
    <div className="relative group animate-float-delayed-2">
      <div className="relative backdrop-blur-2xl bg-white/[0.05] border border-white/[0.08] rounded-2xl p-5 w-[190px] transition-all duration-500 hover:bg-white/[0.08] hover:border-white/[0.14]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center">
            <svg className="w-5 h-5 text-white/90" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.256 2.32c-.42-.326-.98-.7-2.055-.607L3.132 2.8c-.466.046-.56.28-.373.466l1.7 1.142zm.793 3.358v13.846c0 .746.373 1.026 1.214.98l14.523-.84c.84-.046.933-.56.933-1.166V6.63c0-.606-.233-.933-.746-.886l-15.177.886c-.56.047-.747.327-.747.936zm14.337.42c.093.42 0 .84-.42.886l-.7.14v10.264c-.606.327-1.166.513-1.633.513-.746 0-.933-.233-1.493-.933l-4.573-7.178v6.952l1.46.327s0 .84-1.166.84l-3.218.186c-.093-.186 0-.653.327-.746l.84-.233V8.862l-1.167-.093c-.093-.42.14-1.026.793-1.073l3.452-.233 4.759 7.272V8.349l-1.213-.14c-.093-.513.28-.886.746-.933l3.453-.233z"/>
            </svg>
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-white/90">Notion</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${notionConnection.isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-[10px] text-white/50">{notionConnection.isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
        </div>

        {notionConnection.isConnected && notionConnection.databaseName && (
          <div className="mt-4 pt-3 border-t border-white/[0.06]">
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Database</p>
            <p className="text-[11px] text-white/70 truncate">{notionConnection.databaseName}</p>
          </div>
        )}

        <div className="absolute -inset-1 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-xl bg-white/[0.03]" />
      </div>
    </div>
  );
}

export default function AgentVisual() {
  const agentColors = {
    1: '#A78BFA', // Purple
    2: '#6C9CFF', // Blue
    3: '#F472B6', // Pink
  };

  return (
    <div className="relative flex items-center justify-center min-h-[360px]">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-accent-purple/[0.06] rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-60 h-60 bg-accent-blue/[0.05] rounded-full blur-[80px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-accent-pink/[0.03] rounded-full blur-[120px]" />
      </div>

      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 500 360" preserveAspectRatio="xMidYMid meet">
        <path d="M160 90 C200 90, 180 180, 160 180" stroke="rgba(167, 139, 250, 0.15)" strokeWidth="1" fill="none" strokeDasharray="4 4" className="animate-flow" />
        <path d="M160 200 C200 200, 180 280, 160 280" stroke="rgba(108, 156, 255, 0.15)" strokeWidth="1" fill="none" strokeDasharray="4 4" className="animate-flow" />
        <path d="M280 270 C340 270, 360 220, 390 200" stroke="rgba(244, 114, 182, 0.15)" strokeWidth="1" fill="none" strokeDasharray="4 4" className="animate-flow" />
        <path d="M280 80 C360 80, 400 140, 400 180" stroke="rgba(167, 139, 250, 0.08)" strokeWidth="1" fill="none" strokeDasharray="4 4" className="animate-flow" />

        <circle r="2" fill="rgba(167, 139, 250, 0.5)">
          <animateMotion dur="4s" repeatCount="indefinite" path="M160 90 C200 90, 180 180, 160 180" />
        </circle>
        <circle r="2" fill="rgba(108, 156, 255, 0.5)">
          <animateMotion dur="4s" repeatCount="indefinite" path="M160 200 C200 200, 180 280, 160 280" />
        </circle>
        <circle r="2" fill="rgba(244, 114, 182, 0.5)">
          <animateMotion dur="5s" repeatCount="indefinite" path="M280 270 C340 270, 360 220, 390 200" />
        </circle>
      </svg>

      <div className="relative z-20 flex gap-6">
        <div className="flex flex-col gap-4">
          {defaultAgents.map((agent) => (
            <div
              key={agent.step}
              className={
                agent.step === 1 ? 'animate-float' :
                agent.step === 2 ? 'animate-float-delayed' :
                'animate-float-delayed-2'
              }
            >
              <AgentNode 
                agent={agent} 
                color={agentColors[agent.step as keyof typeof agentColors]} 
                delay={agent.step === 1 ? '0s' : agent.step === 2 ? '-2s' : '-4s'} 
              />
            </div>
          ))}
        </div>

        <div className="flex items-center ml-4">
          <div className="flex items-center mr-4">
            <div className="w-12 h-px bg-gradient-to-r from-white/[0.08] to-white/[0.15]" />
            <svg className="w-3 h-3 text-white/20 -ml-1" viewBox="0 0 12 12" fill="currentColor">
              <path d="M4 2l6 4-6 4z" />
            </svg>
          </div>
          <NotionCard />
        </div>
      </div>
    </div>
  );
}

