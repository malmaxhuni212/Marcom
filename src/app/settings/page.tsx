'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CampaignSettingsModal from '@/components/personalization/CampaignSettingsModal';
import type { PersonalizationSettings } from '@/marcom/schemas/personalization';
import AppShell, { PageFrame, ProjectGate } from '@/components/workspace/AppShell';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';
import { Icon, btnPrimary, btnSecondary, card, serif } from '@/components/workspace/ui';

const EMPTY_SETTINGS: PersonalizationSettings = {
  sender_name: '',
  sender_role: '',
  organisation: '',
  campaign_facts: [],
  call_to_action_link: '',
  signature: '',
  extra_guidance: '',
  updated_at: null,
};

function SettingsContent() {
  const router = useRouter();
  const { bundle, setSettings, reload, deleteProject } = useWorkspace();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!bundle) return null;
  const current = bundle.settings ?? EMPTY_SETTINGS;

  return (
    <PageFrame className="max-w-[920px] gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className={`${serif} m-0 text-[32px]`}>Settings</h1>
          <p className="m-0 text-sm text-[#A7ADB8]">
            Sender details and campaign configuration for {bundle.project.name}.
          </p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/overview" className={`${btnSecondary} h-11 no-underline`}>
            <Icon name="edit" size={16} /> Campaign configuration
          </Link>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className={`${btnPrimary} h-11`}
          >
            Edit sender details
          </button>
        </div>
      </header>

      <section className={`${card} flex flex-col gap-4 p-6`}>
        <h2 className="m-0 text-base font-semibold text-[#F1F2F4]">
          Sender &amp; outreach identity
        </h2>
        <p className="m-0 text-sm text-[#A7ADB8]">
          These details are written into every personalised draft so you never have to fill in placeholders by hand.
        </p>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 pt-2 text-sm">
          <div className="rounded-xl border border-[#22262E] bg-[#0E1014] p-4">
            <dt className="text-xs font-semibold text-[#8A909C]">SENDER NAME</dt>
            <dd className="m-0 mt-1 text-[#F1F2F4]">{current.sender_name || 'Not set yet'}</dd>
          </div>
          <div className="rounded-xl border border-[#22262E] bg-[#0E1014] p-4">
            <dt className="text-xs font-semibold text-[#8A909C]">ROLE / TITLE</dt>
            <dd className="m-0 mt-1 text-[#F1F2F4]">{current.sender_role || 'Not set yet'}</dd>
          </div>
          <div className="rounded-xl border border-[#22262E] bg-[#0E1014] p-4">
            <dt className="text-xs font-semibold text-[#8A909C]">ORGANISATION</dt>
            <dd className="m-0 mt-1 text-[#F1F2F4]">{current.organisation || 'Not set yet'}</dd>
          </div>
          <div className="rounded-xl border border-[#22262E] bg-[#0E1014] p-4">
            <dt className="text-xs font-semibold text-[#8A909C]">CALL TO ACTION LINK</dt>
            <dd className="m-0 mt-1 truncate text-[#5ED3DF]">
              {current.call_to_action_link || 'Not set yet'}
            </dd>
          </div>
        </dl>
      </section>

      <section className={`${card} flex flex-col gap-4 border-[#3A2226] bg-[#140F11]/60 p-6`}>
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-base font-semibold text-[#F28B82]">
            Danger zone
          </h2>
          <p className="m-0 text-sm text-[#A7ADB8]">
            Permanently delete this campaign and all associated data, including researched prospects, personalized drafts, and settings.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div>
            <p className="m-0 text-sm font-semibold text-[#F1F2F4]">{bundle.project.name}</p>
            <p className="m-0 text-xs text-[#8A909C]">ID: {bundle.projectId}</p>
          </div>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-600/15 px-4 text-sm font-semibold text-red-300 transition hover:bg-red-600/25 hover:text-white"
          >
            <Icon name="trash" size={15} /> Delete campaign
          </button>
        </div>
      </section>

      <CampaignSettingsModal
        projectId={bundle.projectId}
        initialSettings={current}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(updated) => {
          setSettings(updated);
          void reload();
        }}
      />

      {deleteModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(4,5,7,0.75)] p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setDeleteModalOpen(false);
              setDeleteError(null);
            }
          }}
        >
          <div className="relative w-full max-w-[420px] rounded-2xl border border-[#3A2226] bg-[#151820] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.85)]">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-[#F28B82]">
                <Icon name="trash" size={20} stroke={2} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h3 className="m-0 text-base font-semibold text-[#F1F2F4]">
                  Delete campaign?
                </h3>
                <p className="m-0 text-xs text-[#A7ADB8] leading-relaxed">
                  Are you sure you want to delete <span className="font-semibold text-[#F1F2F4]">&ldquo;{bundle.project.name}&rdquo;</span>? This will permanently remove all prospects, personalized drafts, and settings. This cannot be undone.
                </p>
                {deleteError && (
                  <p className="m-0 mt-2 text-xs text-red-400 font-medium">
                    {deleteError}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setDeleteModalOpen(false);
                  setDeleteError(null);
                }}
                className={`${btnSecondary} !h-9 !px-4 text-xs`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  setDeleteError(null);
                  try {
                    await deleteProject(bundle.projectId);
                    setDeleteModalOpen(false);
                    router.push('/overview');
                  } catch (err) {
                    setDeleteError(err instanceof Error ? err.message : 'Failed to delete campaign');
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-red-500/40 bg-red-600/25 px-4 text-xs font-semibold text-red-300 transition hover:bg-red-600/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Icon name="spinner" size={13} /> Deleting…
                  </>
                ) : (
                  <>
                    <Icon name="trash" size={13} /> Delete campaign
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <ProjectGate>
        <SettingsContent />
      </ProjectGate>
    </AppShell>
  );
}
