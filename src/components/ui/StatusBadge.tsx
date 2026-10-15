'use client';

import React from 'react';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status = 'active', className = '' }: StatusBadgeProps) {
  const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
    active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    working: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    ready: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
    ready_for_research: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
    paused: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    idle: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
    completed: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
    draft: { bg: 'bg-white/10', text: 'text-white/60', dot: 'bg-white/40' },
    error: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  };

  const normalized = (status || 'draft').toLowerCase().replace(/[\s-]+/g, '_');
  const style = statusStyles[normalized] || statusStyles.active;
  const label = (status || 'active').replace(/_/g, ' ');

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text} border border-current/10 ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      <span className="capitalize">{label}</span>
    </div>
  );
}
