import React from 'react';
import Link from 'next/link';
import GlassCard from '../ui/GlassCard';

export default function ResearchRecordCard({ entry, onDelete, projectId }: { entry: any, onDelete?: () => void, projectId?: string }) {
  const { record, seed } = entry;
  const { identity, summary, record_id } = record;
  const name = identity?.name || seed.name || 'Unknown Prospect';
  
  // Construct a subtitle like "Author at Penguin Random House · Los Angeles"
  const roleParts = [];
  if (identity?.role) roleParts.push(identity.role);
  if (identity?.organisation) roleParts.push(`at ${identity.organisation}`);
  
  const subtitlePrefix = roleParts.join(' ');
  const subtitle = [subtitlePrefix, identity?.location].filter(Boolean).join(' · ');

  return (
    <GlassCard padding="p-5" className="relative group">
      <div className="flex justify-between items-start">
        <div className="space-y-3 pr-8">
          <div>
            <h4 className="text-lg font-medium text-white/90">{name}</h4>
            {subtitle && <p className="text-sm text-white/50 mt-0.5">{subtitle}</p>}
          </div>
          
          {summary && (
            <p className="text-sm text-white/70 leading-relaxed max-w-3xl line-clamp-3">
              {summary}
            </p>
          )}

          <div className="flex items-center gap-4 pt-2">
            <span className="text-xs text-emerald-400/90 flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Research complete
            </span>
            
            {projectId && (
              <Link 
                href={`/projects/${projectId}/research/${record_id}`}
                className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
              >
                View Research &rarr;
              </Link>
            )}
          </div>
        </div>

        {onDelete && (
          <button 
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/20 text-red-400/50 hover:text-red-400 rounded-lg transition-all absolute top-4 right-4"
            title="Delete prospect"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </GlassCard>
  );
}
