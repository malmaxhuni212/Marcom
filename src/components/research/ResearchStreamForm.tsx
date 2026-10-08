'use client';

import { useState } from 'react';
import PrimaryButton from '@/components/ui/PrimaryButton';
import type { Target } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';

export interface ResearchCompletion {
  status: 'completed' | 'completed_with_errors';
  message: string;
  entry?: ResearchEntry;
}

export default function ResearchStreamForm({ 
  projectId, 
  targetOptions,
  defaultResultLimit,
  onComplete 
}: { 
  projectId: string, 
  targetOptions: Target[],
  defaultResultLimit?: number,
  onComplete: (result: ResearchCompletion) => void
}) {
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [website, setWebsite] = useState('');
  const [targetId, setTargetId] = useState(targetOptions[0]?.id || '');
  const [batchCount, setBatchCount] = useState<number | ''>(defaultResultLimit ?? '');
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const count = typeof batchCount === 'number' ? batchCount : 1;

    if (!name.trim() && count > 1) {
      setIsStreaming(true);
      setProgressStage('resolving');
      setProgressMsg(`Starting a bounded search for up to ${count} prospects...`);
      setError(null);

      try {
        const res = await fetch(`/api/projects/${projectId}/batch-research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_id: targetId, count: count })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const taskId = data.taskId;
        setActiveTaskId(taskId);
        const interval = setInterval(async () => {
          const statusRes = await fetch(`/api/projects/${projectId}/batch-research?taskId=${taskId}`);
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();
          setProgressMsg(statusData.message || `Saved ${statusData.completed} of ${statusData.total} prospects.`);
          if (['completed', 'completed_with_errors', 'error', 'cancelled'].includes(statusData.status)) {
            clearInterval(interval);
            setIsStreaming(false);
            setProgressStage('');
            setActiveTaskId(null);
            setProgressMsg('');
            if (statusData.status === 'error') {
              setError(statusData.message || 'Research failed.');
            } else if (statusData.status === 'cancelled') {
              setError(statusData.message || 'Research was cancelled.');
            } else {
              onComplete({
                status: statusData.status,
                message: statusData.message || `Research finished with ${statusData.completed ?? 0} saved prospects.`,
              });
            }
          }
        }, 5000);
      } catch (err) {
        setError((err as Error).message);
        setIsStreaming(false);
      }
      return;
    }

    setIsStreaming(true);
    setError(null);
    setProgressStage('initializing');
    setProgressMsg('Connecting to Research Agent...');

    try {
      const res = await fetch(`/api/projects/${projectId}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          organisation,
          website,
          target_id: targetId,
          entity_kind: 'unknown'
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Research request failed with status ${res.status}.`);
      }

      if (!res.body) throw new Error('No response body');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            
            if (data.type === 'progress') {
              setProgressStage(data.stage);
              setProgressMsg(data.message);
            } else if (data.type === 'result') {
              onComplete({
                status: 'completed',
                message: 'Research complete. The new prospect is ready for review.',
                entry: data.entry as ResearchEntry,
              });
              // reset form
              setName('');
              setOrganisation('');
              setWebsite('');
              setTimeout(() => {
                setIsStreaming(false);
                setProgressStage('');
                setProgressMsg('');
              }, 1000);
            } else if (data.type === 'error') {
              setError(data.error || 'An error occurred during research');
              setIsStreaming(false);
            }
          } catch {
            console.error('Failed to parse NDJSON line:', line);
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Stream failed');
      setIsStreaming(false);
    }
  };

  const handleStop = async () => {
    if (!activeTaskId) return;
    try {
      await fetch(`/api/projects/${projectId}/batch-research?taskId=${activeTaskId}`, { method: 'DELETE' });
      setProgressMsg('Stopping...');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] text-white/50 uppercase tracking-wider mb-1.5 font-medium">Target Group</label>
            <select 
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5 text-[13px] text-white/80 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all appearance-none"
              disabled={isStreaming}
            >
              {targetOptions.map(t => (
                <option key={t.id} value={t.id} className="bg-gray-900 capitalize">{t.target_type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-white/50 uppercase tracking-wider mb-1.5 font-medium">Name</label>
            <input 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)}
              placeholder="Leave blank to auto-discover" 
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
              disabled={isStreaming}
            />
          </div>
          <div>
            <label className="block text-[11px] text-white/50 uppercase tracking-wider mb-1.5 font-medium">Organisation / Company</label>
            <input 
              type="text" 
              value={organisation}
              onChange={e => setOrganisation(e.target.value)}
              placeholder="Optional" 
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
              disabled={isStreaming}
            />
          </div>
          <div>
            {name.trim() === '' ? (
              <>
                <label className="block text-[11px] text-cyan-400/80 uppercase tracking-wider mb-1.5 font-medium flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  Maximum Prospects
                </label>
                <input 
                  type="number" 
                  min="1"
                  max="50"
                  placeholder="e.g. 10"
                  value={batchCount === '' ? '' : batchCount} 
                  onChange={e => {
                    const val = e.target.value;
                    setBatchCount(val === '' ? '' : parseInt(val));
                  }}
                  className="w-full bg-cyan-500/[0.05] border border-cyan-500/20 rounded-xl px-4 py-2.5 text-[13px] text-white/80 placeholder:text-cyan-500/30 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                  disabled={isStreaming}
                />
                <p className="mt-1.5 text-[10px] leading-relaxed text-white/30">
                  Search returns up to this number. Unsupported or duplicate results are skipped.
                </p>
              </>
            ) : (
              <>
                <label className="block text-[11px] text-white/50 uppercase tracking-wider mb-1.5 font-medium">Website</label>
                <input 
                  type="text" 
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                  placeholder="Optional" 
                  className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                  disabled={isStreaming}
                />
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[13px] text-red-400">
            {error}
          </div>
        )}

        {!isStreaming ? (
          <div className="flex justify-end pt-2">
            <PrimaryButton type="submit" className="bg-cyan-500 text-black hover:bg-cyan-400">
              Run Research
            </PrimaryButton>
          </div>
        ) : (
          <div className="pt-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-[12px] font-medium text-cyan-400 capitalize">{progressStage.replace(/_/g, ' ')}...</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-white/40">{progressMsg}</span>
                {activeTaskId && (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="text-[11px] font-medium text-red-400 hover:text-red-300 transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>
            <div className="h-1.5 w-full bg-white/[0.05] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 w-full animate-[progress_2s_ease-in-out_infinite]" style={{ transformOrigin: 'left' }} />
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
