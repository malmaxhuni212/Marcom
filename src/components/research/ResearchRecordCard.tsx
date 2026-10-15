'use client';

import { useState } from 'react';

export default function ResearchRecordCard({ entry, onDelete }: { entry: any, onDelete?: () => void }) {
  const { record, qa } = entry;
  const [expanded, setExpanded] = useState(false);

  const fitColor = 
    record.fit.band === 'highly_relevant' ? 'text-green-400 bg-green-400/10 border-green-400/20' :
    record.fit.band === 'strong' ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' :
    record.fit.band === 'possible' ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' :
    'text-white/40 bg-white/5 border-white/10';

  return (
    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden transition-all duration-300 hover:border-white/[0.1]">
      <div className="p-5 flex flex-col md:flex-row gap-5 items-start">
        {/* Fit Score Badge */}
        <div className={`shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-xl border ${fitColor}`}>
          <span className="text-xl font-bold">{record.fit.score}</span>
          <span className="text-[9px] uppercase tracking-wider font-semibold opacity-80">Fit</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-lg font-semibold text-white/90 truncate flex items-center gap-2">
                {record.identity.name || entry.seed.name}
                {record.identity.entity_kind === 'organisation' && <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">ORG</span>}
              </h4>
              <p className="text-[13px] text-white/50 truncate mt-0.5">
                {[record.role, record.organisation].filter(Boolean).join(' at ')} 
                {record.location && ` • ${record.location}`}
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              {qa?.status !== 'passed' && (
                <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-lg text-[11px] font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  QA Flag
                </div>
              )}
              {onDelete && (
                <button onClick={onDelete} className="text-white/20 hover:text-red-400 transition-colors p-1" title="Delete record">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              )}
            </div>
          </div>

          <p className="text-[13px] text-white/60 mt-3 leading-relaxed">
            {record.summary}
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            {entry.search_provider && (
              <span className="flex items-center text-[11px] text-white/50 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
                Search: {entry.search_provider}
              </span>
            )}
            {record.linkedin && (
              <a href={record.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-blue-400 bg-blue-400/10 px-2.5 py-1 rounded-full hover:bg-blue-400/20 transition-colors">
                LinkedIn ↗
              </a>
            )}
            {record.website && (
              <a href={record.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-cyan-400 bg-cyan-400/10 px-2.5 py-1 rounded-full hover:bg-cyan-400/20 transition-colors">
                Website ↗
              </a>
            )}
            {record.public_contact?.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-white/70 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
                <span className="opacity-50">{c.kind}:</span> {c.value}
              </div>
            ))}
            <button 
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-white/40 hover:text-white/80 transition-colors ml-auto flex items-center gap-1"
            >
              {expanded ? 'Hide Details' : 'View Evidence'}
              <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] p-5 bg-black/20 space-y-5 text-[13px]">
          
          {qa?.issues?.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
              <h5 className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-2">QA Warnings</h5>
              <ul className="space-y-1.5">
                {qa.issues.map((iss: any, i: number) => (
                  <li key={i} className="text-amber-200/70 flex gap-2">
                    <span className="opacity-50">•</span> {iss.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h5 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Relevance</h5>
            <p className="text-white/70 bg-white/[0.03] p-3 rounded-xl border border-white/[0.05] italic">"{record.fit.rationale}"</p>
          </div>

          {(record.relevant_projects?.length > 0 || record.achievements?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {record.relevant_projects?.length > 0 && (
                <div>
                  <h5 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Relevant Work</h5>
                  <ul className="space-y-1.5 text-white/70">
                    {record.relevant_projects.map((p: string, i: number) => <li key={i}>• {p}</li>)}
                  </ul>
                </div>
              )}
              {record.achievements?.length > 0 && (
                <div>
                  <h5 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Achievements</h5>
                  <ul className="space-y-1.5 text-white/70">
                    {record.achievements.map((p: string, i: number) => <li key={i}>• {p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {record.evidence?.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Key Evidence</h5>
              <div className="space-y-2">
                {record.evidence.map((ev: any, i: number) => (
                  <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-xl">
                    <div className="flex gap-2 justify-between">
                      <p className="text-white/80">{ev.claim}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${ev.confidence === 'verified' ? 'text-green-400 bg-green-400/10' : 'text-amber-400 bg-amber-400/10'}`}>
                        {ev.confidence}
                      </span>
                    </div>
                    {ev.quote && <p className="text-[11px] text-white/40 mt-2 border-l-2 border-white/10 pl-2 italic">"{ev.quote}"</p>}
                    <div className="flex gap-2 mt-2">
                      {ev.source_ids.map((sid: string) => {
                        const src = record.sources.find((s: any) => s.id === sid);
                        return src ? (
                          <a key={sid} href={src.url} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline">
                            Source: {src.title || src.source_type}
                          </a>
                        ) : null;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
