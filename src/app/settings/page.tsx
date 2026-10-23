'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  const { bundle, setSettings, reload } = useWorkspace();
  const [modalOpen, setModalOpen] = useState(false);

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
