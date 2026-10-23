'use client';

import { useEffect } from 'react';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import DraftViewer from './DraftViewer';
import { useWorkspace } from './WorkspaceContext';
import { CloseButton, Icon } from './ui';
import type { DraftChannel } from './format';

/** Right-hand slide-over showing a prospect's drafted messages (view, edit and copy only). */
export default function DraftsDrawer({ draft, onClose, initialChannel }: { draft: PersonalizationEntry; onClose: () => void; initialChannel?: DraftChannel }) {
  const { bundle, updateDraft, reload } = useWorkspace();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ready = draft.copy ? 3 : 0;

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Close drafts" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-[rgba(4,5,7,0.45)]" />
      <aside aria-label="Drafted messages" className="absolute right-0 top-0 flex h-full w-[620px] max-w-full flex-col border-l border-[#2A2F39] bg-[#12151A] shadow-[-24px_0_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-start justify-between gap-3 px-6 pb-3.5 pt-[22px]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 self-start text-[13px] text-[#A7ADB8] hover:text-[#F1F2F4]">
              <Icon name="arrowLeft" size={14} /> {draft.prospect_name}
            </button>
            <h2 className="m-0 text-xl font-semibold text-[#F1F2F4]">Drafted messages</h2>
            <div className="text-xs font-semibold tracking-[0.12em]" style={{ color: ready ? '#B1A6FF' : '#F2C36B' }}>
              {ready ? `${ready} DRAFTS WRITTEN · NOTHING IS SENT` : 'NO DRAFT YET'}
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {bundle && (
            <DraftViewer
              key={`${draft.record_id}-${draft.updated_at}`}
              draft={draft}
              projectId={bundle.projectId}
              settings={bundle.settings}
              initialChannel={initialChannel}
              onUpdated={(entry) => {
                updateDraft(entry);
                void reload();
              }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
