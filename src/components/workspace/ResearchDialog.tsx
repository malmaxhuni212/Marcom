'use client';

import { useState } from 'react';
import { useWorkspace } from './WorkspaceContext';
import { CloseButton, Dialog, Icon, btnPrimary, btnSecondary, serif } from './ui';
import { entriesForTarget } from './format';

/** "Find more prospects" — runs the Research agent with the saved campaign configuration. */
export default function ResearchDialog() {
  const { bundle, researchDialog, closeResearch, startResearch, researchRun } = useWorkspace();
  const targets = bundle?.project.structured_brief?.targets ?? [];
  const defaultLimit = bundle?.project.structured_brief?.research.search_settings?.default_result_limit ?? 10;
  const [targetId, setTargetId] = useState(researchDialog.targetId ?? targets[0]?.id ?? '');
  const [count, setCount] = useState(Math.min(25, Math.max(1, defaultLimit)));
  const [name, setName] = useState('');

  if (!researchDialog.open || !bundle) return null;

  const running = researchRun?.status === 'running';
  const selected = targets.find((target) => target.id === targetId) ?? targets[0];
  const projectName = bundle.project.name;

  const submit = () => {
    if (!selected || running) return;
    void startResearch({ targetId: selected.id, targetLabel: selected.target_type, count, name: name.trim() || undefined });
    closeResearch();
  };

  return (
    <Dialog label="Run research" onClose={closeResearch} width={660}>
      <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-7">
        <div className="flex flex-col gap-2">
          <h1 className={`${serif} m-0 text-[28px] text-[#F1F2F4]`}>Find more prospects</h1>
          <p className="m-0 text-sm leading-relaxed text-[#A7ADB8]">
            The Research agent searches for new matches for {projectName}. Your campaign settings stay the same.
          </p>
        </div>
        <CloseButton onClick={closeResearch} />
      </div>

      <div className="flex flex-col gap-5 px-7 pb-6 pt-5">
        {targets.length === 0 ? (
          <p className="rounded-2xl border border-[#4A3B17] bg-[#231D10] p-4 text-sm text-[#E5D3A8]">
            This project has no target audiences yet. Edit the campaign configuration to add one before running research.
          </p>
        ) : (
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 p-0 text-[13px] font-semibold text-[#A7ADB8]">Who to look for</legend>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {targets.map((target) => {
                const on = target.id === selected?.id;
                const found = entriesForTarget(bundle.research, target).length;
                return (
                  <label
                    key={target.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${on ? 'border-[#2E6B75] bg-[#12313A]' : 'border-[#2A2F39] bg-[#0E1014] hover:border-[#3A3F4A]'}`}
                  >
                    <input type="radio" name="research-target" checked={on} onChange={() => setTargetId(target.id)} className="mt-0.5 h-[18px] w-[18px] accent-[#5ED3DF]" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-[15px] font-semibold capitalize text-[#F1F2F4]">{target.target_type}</span>
                      <span className={`line-clamp-2 text-[13px] leading-snug ${on ? 'text-[#B5D9DE]' : 'text-[#A7ADB8]'}`}>
                        {target.description || [target.entity_kind, ...target.geography].join(' · ')}
                      </span>
                      <span className="text-xs text-[#8A909C]">{found} found so far</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-[14px] border border-[#2A2F39] bg-[#0E1014] px-3.5 py-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-[#F1F2F4]">How many</span>
              <span className="text-xs text-[#8A909C]">{name.trim() ? 'One named prospect' : 'Duplicates are skipped'}</span>
            </span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label="Fewer" disabled={Boolean(name.trim()) || count <= 1} onClick={() => setCount((value) => Math.max(1, value - 1))} className="h-9 w-9 rounded-[10px] border border-[#2A2F39] bg-[#171A20] text-lg text-[#F1F2F4] disabled:opacity-40">−</button>
              <span className="w-9 text-center text-base font-semibold text-[#F1F2F4]">{name.trim() ? 1 : count}</span>
              <button type="button" aria-label="More" disabled={Boolean(name.trim()) || count >= 25} onClick={() => setCount((value) => Math.min(25, value + 1))} className="h-9 w-9 rounded-[10px] border border-[#2A2F39] bg-[#171A20] text-lg text-[#F1F2F4] disabled:opacity-40">+</button>
            </span>
          </div>
          <label className="flex flex-col justify-center gap-1 rounded-[14px] border border-[#2A2F39] bg-[#0E1014] px-3.5 py-2.5">
            <span className="text-xs text-[#8A909C]">Specific person or organisation · optional</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. a name you already know" className="border-0 bg-transparent p-0 text-sm text-[#F1F2F4] outline-none placeholder:text-[#5C616B]" />
          </label>
        </div>

        {running && (
          <p className="rounded-xl border border-[#2E6B75] bg-[#12313A] px-3.5 py-2.5 text-[13px] text-[#B5D9DE]">
            A research run is already in progress. Wait for it to finish before starting another.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-t border-[#2A2F39] px-7 pb-6 pt-4">
        <span className="flex min-w-[200px] flex-1 items-center gap-1.5 text-xs text-[#8A909C]">
          <Icon name="bell" size={14} />
          We&apos;ll show the new prospects in Prospects when they&apos;re ready
        </span>
        <button type="button" onClick={closeResearch} className={`${btnSecondary} h-[46px]`}>Cancel</button>
        <button type="button" onClick={submit} disabled={!selected || running} className={`${btnPrimary} h-[46px]`}>
          <Icon name="search" size={16} stroke={2.2} />
          Start research
        </button>
      </div>
    </Dialog>
  );
}
