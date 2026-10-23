'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authenticatedFetch } from '@/auth/client';
import type { PersonalizationEntry, PersonalizationSettings } from '@/marcom/schemas/personalization';
import CampaignSettingsModal from '@/components/personalization/CampaignSettingsModal';
import { PageFrame, ProjectGate } from '../AppShell';
import { useWorkspace } from '../WorkspaceContext';
import DraftViewer from '../DraftViewer';
import { useClipboard } from '../prospect-parts';
import { EmptyState, Icon, btnPrimary, btnSecondary, card, serif } from '../ui';
import {
  CHANNEL_LABEL,
  draftNeedsAttention,
  draftTargets,
  hostOf,
  messageFor,
  plural,
  primaryChannel,
  prospectName,
  reviewStatus,
  subjectFor,
} from '../format';

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

export default function OutreachView() {
  return (
    <ProjectGate>
      <OutreachBody />
    </ProjectGate>
  );
}

function OutreachBody() {
  const { bundle, activeProject, reload, updateDraft, setSettings } = useWorkspace();
  const [justPersonalised, setJustPersonalised] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [personalising, setPersonalising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useClipboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('just') === 'yes') setJustPersonalised(true);
    const draftParam = params.get('draft');
    if (draftParam) setActiveDraftId(draftParam);
  }, []);

  if (!bundle) return null;
  const { project, research, drafts, settings, projectId } = bundle;
  const title = project.structured_brief?.project.name || project.name || activeProject?.name || 'Untitled project';

  const approvedResearch = useMemo(
    () => research.filter((entry) => reviewStatus(entry) === 'shortlisted'),
    [research],
  );

  const unpersonalisedApproved = useMemo(() => {
    const draftedIds = new Set(drafts.filter((d) => d.copy).map((d) => d.record_id));
    return approvedResearch.filter((entry) => !draftedIds.has(entry.record.record_id));
  }, [approvedResearch, drafts]);

  const readyDrafts = useMemo(
    () => drafts.filter((entry) => Boolean(entry.copy) && entry.status !== 'failed'),
    [drafts],
  );

  const approvedDraftsCount = useMemo(
    () => drafts.filter((entry) => entry.status === 'approved').length,
    [drafts],
  );

  const avgQuality = useMemo(() => {
    const scores = readyDrafts
      .map((entry) => entry.qa?.score)
      .filter((score): score is number => typeof score === 'number');
    if (!scores.length) return null;
    return Math.round(scores.reduce((sum, item) => sum + item, 0) / scores.length);
  }, [readyDrafts]);

  const attentionItems = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      reason: string;
      actionLabel: string;
      kind: 'draft' | 'unpersonalised';
    }> = [];

    for (const entry of drafts) {
      const reason = draftNeedsAttention(entry);
      if (reason) {
        list.push({
          id: entry.record_id,
          name: entry.prospect_name,
          reason,
          actionLabel: entry.copy ? 'View draft' : 'Rewrite draft',
          kind: 'draft',
        });
      }
    }

    for (const entry of unpersonalisedApproved) {
      if (!list.some((item) => item.id === entry.record.record_id)) {
        list.push({
          id: entry.record.record_id,
          name: prospectName(entry),
          reason: 'Approved prospect · no outreach drafts written yet',
          actionLabel: 'Write drafts',
          kind: 'unpersonalised',
        });
      }
    }

    return list;
  }, [drafts, unpersonalisedApproved]);

  const personaliseRecords = async (recordIds: string[], openRecordId?: string) => {
    if (personalising || !recordIds.length) return;
    setPersonalising(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          recordIds.length === 1
            ? { recordId: recordIds[0], force: true }
            : { recordIds },
        ),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Personalisation failed.');
      await reload();
      setJustPersonalised(true);
      if (openRecordId) setActiveDraftId(openRecordId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPersonalising(false);
    }
  };

  const activeDraft = useMemo(
    () => (activeDraftId ? drafts.find((item) => item.record_id === activeDraftId) ?? null : null),
    [drafts, activeDraftId],
  );

  // Full-screen DMessage view when a draft is selected
  if (activeDraft) {
    const idx = readyDrafts.findIndex((item) => item.record_id === activeDraft.record_id);
    const nextDraft = idx >= 0 && idx < readyDrafts.length - 1 ? readyDrafts[idx + 1] : null;
    const readyChannelsCount = activeDraft.copy ? 3 : 0;

    return (
      <PageFrame className="max-w-[1160px] gap-[22px]">
        <header className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setActiveDraftId(null)}
            className="inline-flex items-center gap-1.5 self-start text-sm text-[#A7ADB8] hover:text-[#F1F2F4]"
          >
            <Icon name="arrowLeft" size={16} /> Back to Outreach
            {idx >= 0 ? ` · ${idx + 1} of ${readyDrafts.length}` : ''}
          </button>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className={`${serif} m-0 text-[30px]`}>{activeDraft.prospect_name}</h1>
            <span
              style={{ color: readyChannelsCount === 3 ? '#B1A6FF' : '#9BE6EE' }}
              className="text-[13px] font-semibold tracking-[0.12em]"
            >
              {readyChannelsCount === 3 ? '3 DRAFTS WRITTEN · VIEW & COPY ONLY' : 'DRAFTING'}
            </span>
          </div>
        </header>

        <DraftViewer
          key={`${activeDraft.record_id}-${activeDraft.updated_at}`}
          draft={activeDraft}
          projectId={projectId}
          settings={settings}
          onUpdated={(entry) => {
            updateDraft(entry);
            void reload();
          }}
        />

        {nextDraft && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setActiveDraftId(nextDraft.record_id)}
              className={btnSecondary}
            >
              Next prospect: {nextDraft.prospect_name} <Icon name="arrowRight" size={16} />
            </button>
          </div>
        )}
      </PageFrame>
    );
  }

  return (
    <PageFrame className="max-w-[1160px] gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
          <h1 className={`${serif} m-0 text-[32px]`}>Outreach</h1>
          <p className="m-0 text-sm text-[#A7ADB8]">
            Personalised drafts for {title}. Nothing is sent automatically — view each draft and copy the message to send yourself.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className={`${btnSecondary} h-11 px-4`}
          >
            <Icon name="settings" size={16} /> Sender details
          </button>
          {unpersonalisedApproved.length > 0 && (
            <button
              type="button"
              disabled={personalising}
              onClick={() =>
                void personaliseRecords(unpersonalisedApproved.map((item) => item.record.record_id))
              }
              className={`${btnPrimary} h-11 px-[18px]`}
            >
              <Icon name="sparkle" size={16} />
              {personalising
                ? 'Writing drafts…'
                : `Personalise ${plural(unpersonalisedApproved.length, 'approved prospect')}`}
            </button>
          )}
        </div>
      </header>

      {/* DOutreachNew banner when redirected from Personalise */}
      {justPersonalised && readyDrafts.length > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-[#2E6B75] bg-[#12313A] px-[18px] py-4"
        >
          <Icon name="sparkle" size={20} className="text-[#5ED3DF]" />
          <div className="flex flex-[1_1_320px] flex-col gap-[3px]">
            <span className="text-[15px] font-semibold text-[#9BE6EE]">
              {plural(readyDrafts.length, 'prospect')} personalised and ready in Outreach
            </span>
            <span className="text-[13px] leading-snug text-[#B5D9DE]">
              Drafts for Email, LinkedIn and Follow-up have been written from verified facts. Check each one, then copy the message.
            </span>
          </div>
          <Link
            href="/prospects"
            className="text-[13px] font-semibold text-[#9BE6EE] no-underline hover:underline"
          >
            Back to prospects
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 rounded-xl border border-[#5A2D29] bg-[#2A1715] px-4 py-3 text-sm text-[#F7B1AA]">
          {error}
        </p>
      )}

      {/* 4 Outreach metric cards */}
      <section
        aria-label="Outreach numbers"
        className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
      >
        <div className={`${card} flex flex-col gap-1 p-[18px]`}>
          <span className="text-[28px] font-semibold text-[#F1F2F4]">{readyDrafts.length}</span>
          <span className="text-[13px] text-[#A7ADB8]">Ready to copy</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-[18px]`}>
          <span className="text-[28px] font-semibold text-[#F2C36B]">{attentionItems.length}</span>
          <span className="text-[13px] text-[#A7ADB8]">Need your attention</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-[18px]`}>
          <span className="text-[28px] font-semibold text-[#8EE6B6]">{approvedDraftsCount}</span>
          <span className="text-[13px] text-[#A7ADB8]">Approved drafts</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-[18px]`}>
          <span className="text-[28px] font-semibold text-[#B1A6FF]">
            {avgQuality !== null ? `${avgQuality}%` : '—'}
          </span>
          <span className="text-[13px] text-[#A7ADB8]">Quality check score</span>
        </div>
      </section>

      {/* Ready to copy table */}
      <section className="flex flex-col gap-2.5">
        <h2 className="m-0 text-[15px] font-semibold text-[#F1F2F4]">
          Ready to copy · {readyDrafts.length}
        </h2>
        {readyDrafts.length === 0 ? (
          <EmptyState
            title="No outreach drafts ready yet"
            body={
              approvedResearch.length > 0
                ? `You have ${plural(approvedResearch.length, 'approved prospect')}. Personalise them to generate Email, LinkedIn and Follow-up drafts from verified facts.`
                : 'Approve prospects in Review first, then personalise them to generate outreach drafts.'
            }
            action={
              approvedResearch.length > 0 ? (
                <button
                  type="button"
                  disabled={personalising}
                  onClick={() =>
                    void personaliseRecords(approvedResearch.map((item) => item.record.record_id))
                  }
                  className={btnPrimary}
                >
                  <Icon name="sparkle" size={16} />
                  {personalising ? 'Writing drafts…' : `Personalise ${plural(approvedResearch.length, 'prospect')}`}
                </button>
              ) : (
                <Link href="/review" className={`${btnPrimary} no-underline`}>
                  Go to Review <Icon name="arrowRight" size={16} />
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-[18px] border border-[#2A2F39] bg-[#171A20]">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[#A7ADB8]">
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Prospect
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Channel
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    To
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Checks
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {readyDrafts.map((entry) => {
                  const channel = primaryChannel(entry);
                  const targets = draftTargets(entry);
                  const toValue =
                    channel === 'linkedin'
                      ? targets.linkedin
                        ? hostOf(targets.linkedin)
                        : 'LinkedIn profile not found'
                      : targets.email || 'Email not found · copy message';
                  const factCount = entry.strategy?.hooks?.length ?? 0;
                  const copyKey = `row-${entry.record_id}`;
                  const subject = subjectFor(entry, 0);
                  const body = messageFor(entry, channel);
                  const clipboardPayload =
                    channel === 'email' && subject ? `Subject: ${subject}\n\n${body}` : body;

                  return (
                    <tr key={entry.record_id} className="hover:bg-[#1B1F27]">
                      <td className="border-b border-[#22262E] px-4 py-3.5 font-semibold text-[#F1F2F4]">
                        {entry.prospect_name}
                      </td>
                      <td className="border-b border-[#22262E] px-4 py-3.5 text-[#C9CDD4]">
                        {CHANNEL_LABEL[channel]}
                      </td>
                      <td className="border-b border-[#22262E] px-4 py-3.5 text-[#C9CDD4]">
                        {toValue}
                      </td>
                      <td className="border-b border-[#22262E] px-4 py-3.5">
                        <span
                          className={`inline-block rounded-lg px-2.5 py-1 text-xs font-medium ${
                            factCount > 0
                              ? 'bg-[#10261B] text-[#8EE6B6]'
                              : 'bg-[#231D10] text-[#F2C36B]'
                          }`}
                        >
                          {factCount > 0
                            ? `${plural(factCount, 'verified fact')} · prefilled`
                            : 'General draft · check before copying'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap border-b border-[#22262E] px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setActiveDraftId(entry.record_id)}
                          className="mr-1.5 inline-flex h-9 items-center rounded-[10px] border border-[#2A2F39] bg-transparent px-3 text-[13px] font-semibold text-[#F1F2F4] hover:border-[#3A3F4A]"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => void copy(clipboardPayload, copyKey)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border-0 bg-[#F1F2F4] px-3.5 text-[13px] font-semibold text-[#0E1014] hover:opacity-95"
                        >
                          <Icon name={copied === copyKey ? 'check' : 'copy'} size={14} />
                          {copied === copyKey ? 'Copied' : 'Copy message'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Needs your attention */}
      {attentionItems.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="m-0 text-[15px] font-semibold text-[#F2C36B]">
            Needs your attention · {attentionItems.length}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
            {attentionItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3.5 rounded-2xl border border-[#4A3B17] bg-[#171A20] px-[18px] py-4"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate text-[15px] font-semibold text-[#F1F2F4]">
                    {item.name}
                  </span>
                  <span className="text-[13px] text-[#F2C36B]">{item.reason}</span>
                </span>
                {item.kind === 'unpersonalised' ? (
                  <button
                    type="button"
                    disabled={personalising}
                    onClick={() => void personaliseRecords([item.id], item.id)}
                    className="inline-flex h-[38px] shrink-0 items-center rounded-[10px] border border-[#6B5524] bg-transparent px-3.5 text-[13px] font-semibold text-[#F2C36B] hover:bg-[#231D10]"
                  >
                    {personalising ? 'Writing…' : item.actionLabel}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const found = drafts.find((d) => d.record_id === item.id);
                      if (found?.copy) setActiveDraftId(item.id);
                      else void personaliseRecords([item.id], item.id);
                    }}
                    className="inline-flex h-[38px] shrink-0 items-center rounded-[10px] border border-[#6B5524] bg-transparent px-3.5 text-[13px] font-semibold text-[#F2C36B] hover:bg-[#231D10]"
                  >
                    {item.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* View & copy policy callout */}
      <section className="flex flex-col gap-2.5">
        <h2 className="m-0 text-[15px] font-semibold text-[#A7ADB8]">How outreach works</h2>
        <div className="rounded-2xl border border-dashed border-[#2E333D] px-5 py-[18px] text-sm leading-relaxed text-[#A7ADB8]">
          MARCOM never sends messages automatically. Open any prospect&apos;s draft to inspect the highlighted verified facts, edit or rewrite the message, and copy the text or subject line into your email client or LinkedIn.
        </div>
      </section>

      <CampaignSettingsModal
        projectId={projectId}
        initialSettings={settings ?? EMPTY_SETTINGS}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(updated) => {
          setSettings(updated);
          void reload();
        }}
      />
    </PageFrame>
  );
}
