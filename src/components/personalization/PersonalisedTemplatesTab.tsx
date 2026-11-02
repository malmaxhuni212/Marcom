'use client';

import { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/auth/client';
import {
  buildDefaultCategoryTemplate,
  getProjectCategoryTemplates,
  type CategoryOutreachTemplate,
  type PersonalizationSettings,
  TEMPLATE_USAGE_MODE_LABELS,
} from '@/marcom/schemas/personalization';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import { entriesForTarget, plural } from '../workspace/format';
import { btnPrimary, btnSecondary, card, Icon } from '../workspace/ui';

interface PersonalisedTemplatesTabProps {
  projectId: string;
  brief: StructuredBrief;
  research: ResearchEntry[];
  settings: PersonalizationSettings | null;
  onSettingsUpdated: (updated: PersonalizationSettings) => void;
  onEditCategories?: () => void;
}

export default function PersonalisedTemplatesTab({
  projectId,
  brief,
  research,
  settings,
  onSettingsUpdated,
  onEditCategories,
}: PersonalisedTemplatesTabProps) {
  const categoryTemplates = useMemo(
    () => getProjectCategoryTemplates(brief, settings),
    [brief, settings],
  );

  const [selectedTargetId, setSelectedTargetId] = useState<string>(
    () => brief.targets[0]?.id ?? '',
  );
  const [draftsByTargetId, setDraftsByTargetId] = useState<
    Record<string, { subject_line: string; body: string }>
  >({});
  const [savingTargetId, setSavingTargetId] = useState<string | null>(null);
  const [resettingTargetId, setResettingTargetId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Keep selectedTargetId valid if project or targets change
  useEffect(() => {
    if (!brief.targets.length) {
      setSelectedTargetId('');
      return;
    }
    if (!brief.targets.some((t) => t.id === selectedTargetId)) {
      setSelectedTargetId(brief.targets[0]!.id);
    }
  }, [brief.targets, selectedTargetId]);

  // Clear local unsaved drafts when switching projects
  useEffect(() => {
    setDraftsByTargetId({});
    setStatusBanner(null);
  }, [projectId]);

  const activeTarget =
    brief.targets.find((t) => t.id === selectedTargetId) ?? brief.targets[0] ?? null;
  const activeSavedOrDefault: CategoryOutreachTemplate | null =
    categoryTemplates.find((t) => t.target_id === activeTarget?.id) ??
    (activeTarget ? buildDefaultCategoryTemplate(brief, activeTarget, settings) : null);

  const currentDraft = activeTarget
    ? draftsByTargetId[activeTarget.id] ?? {
        subject_line: activeSavedOrDefault?.subject_line ?? '',
        body: activeSavedOrDefault?.body ?? '',
      }
    : { subject_line: '', body: '' };

  const isDirty = Boolean(
    activeTarget &&
      activeSavedOrDefault &&
      (currentDraft.subject_line.trim() !== activeSavedOrDefault.subject_line.trim() ||
        currentDraft.body.trim() !== activeSavedOrDefault.body.trim()),
  );

  const updateDraftField = (field: 'subject_line' | 'body', value: string) => {
    if (!activeTarget) return;
    setStatusBanner(null);
    setDraftsByTargetId((prev) => ({
      ...prev,
      [activeTarget.id]: {
        subject_line:
          field === 'subject_line'
            ? value
            : (prev[activeTarget.id]?.subject_line ?? activeSavedOrDefault?.subject_line ?? ''),
        body:
          field === 'body'
            ? value
            : (prev[activeTarget.id]?.body ?? activeSavedOrDefault?.body ?? ''),
      },
    }));
  };

  const handleSaveTemplate = async () => {
    if (!activeTarget) return;
    const trimmedBody = currentDraft.body.trim();
    if (!trimmedBody) {
      setStatusBanner({
        type: 'error',
        message: 'Template message cannot be empty. Write a reference message or reset to default.',
      });
      return;
    }

    setSavingTargetId(activeTarget.id);
    setStatusBanner(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryTemplate: {
            target_id: activeTarget.id,
            target_type: activeTarget.target_type,
            subject_line: currentDraft.subject_line.trim(),
            body: trimmedBody,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Could not save category template.');
      }
      if (data.settings) {
        onSettingsUpdated(data.settings);
      }
      setDraftsByTargetId((prev) => {
        const next = { ...prev };
        delete next[activeTarget.id];
        return next;
      });
      setStatusBanner({
        type: 'success',
        message: `Saved "${activeTarget.target_type}" template. The Personalization Agent will use this as its primary reference for future ${activeTarget.target_type} outreach.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: (err as Error).message,
      });
    } finally {
      setSavingTargetId(null);
    }
  };

  const handleResetToDefault = async () => {
    if (!activeTarget) return;
    setResettingTargetId(activeTarget.id);
    setStatusBanner(null);
    try {
      const defaultTpl = buildDefaultCategoryTemplate(brief, activeTarget, settings);
      if (activeSavedOrDefault?.is_custom) {
        const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resetCategoryTemplateTargetId: activeTarget.id,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Could not reset category template.');
        }
        if (data.settings) {
          onSettingsUpdated(data.settings);
        }
      }
      setDraftsByTargetId((prev) => ({
        ...prev,
        [activeTarget.id]: {
          subject_line: defaultTpl.subject_line,
          body: defaultTpl.body,
        },
      }));
      setStatusBanner({
        type: 'success',
        message: `Restored the pre-built "${activeTarget.target_type}" template from the project brief.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: (err as Error).message,
      });
    } finally {
      setResettingTargetId(null);
    }
  };

  if (!brief.targets.length) {
    return (
      <div className={`${card} flex flex-col items-start gap-3 p-6`}>
        <h3 className="m-0 text-base font-semibold text-[#F1F2F4]">
          No lead categories configured
        </h3>
        <p className="m-0 text-sm text-[#A7ADB8]">
          Add target audiences to this project&apos;s configuration to automatically generate
          category-specific outreach templates.
        </p>
        {onEditCategories && (
          <button type="button" onClick={onEditCategories} className={btnSecondary}>
            + Add lead category
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Section Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-lg font-semibold text-[#F1F2F4]">
            Personalised Outreach Templates
          </h2>
          <p className="m-0 max-w-[760px] text-sm leading-relaxed text-[#A7ADB8]">
            Each lead category has its own independently editable reference template generated from
            your project brief. These templates guide the Personalization Agent with consistent
            positioning while preserving genuine, prospect-specific personalisation.
          </p>
        </div>
        {onEditCategories && (
          <button type="button" onClick={onEditCategories} className={btnSecondary}>
            <Icon name="edit" size={15} /> + Add / Edit lead categories
          </button>
        )}
      </div>

      {/* How the Personalization Agent Uses Templates Banner */}
      <div className="rounded-[18px] border border-[#2E6B75]/70 bg-[#12313A]/55 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-[#9BE6EE]">
            How the Personalization Agent uses these templates (Not Mail-Merge)
          </span>
          <span className="rounded-full bg-[#173D47] px-2.5 py-0.5 text-[11px] font-medium text-[#B5D9DE]">
            Primary reference &amp; starting framework
          </span>
        </div>
        <p className="m-0 mt-1.5 text-xs leading-relaxed text-[#C9CDD4]">
          When generating outreach for a prospect, the agent identifies their lead category,
          retrieves the template below, analyses their research, and intelligently decides how to
          apply it:
        </p>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
          {(
            [
              ['use', '#5BD69A'],
              ['adapt', '#5ED3DF'],
              ['inspiration', '#F6C667'],
              ['ignore', '#C9CDD4'],
            ] as const
          ).map(([mode, accent]) => {
            const info = TEMPLATE_USAGE_MODE_LABELS[mode];
            return (
              <div
                key={mode}
                className="flex flex-col gap-1 rounded-xl border border-[#264750] bg-[#111B21]/90 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <span className="text-xs font-semibold text-[#F1F2F4]">{info.label}</span>
                </div>
                <span className="text-[11px] leading-snug text-[#9DA5B2]">
                  {info.description}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Split Layout: Dynamic Lead Categories List + Full Free-Form Template Editor */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[310px_1fr]">
        {/* Left column: Dynamic Lead Categories */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8A909C]">
              Lead Categories · {brief.targets.length}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {brief.targets.map((target) => {
              const isSelected = target.id === activeTarget?.id;
              const resolved = categoryTemplates.find((t) => t.target_id === target.id);
              const hasUnsaved = Boolean(
                draftsByTargetId[target.id] &&
                  resolved &&
                  (draftsByTargetId[target.id]!.subject_line.trim() !==
                    resolved.subject_line.trim() ||
                    draftsByTargetId[target.id]!.body.trim() !== resolved.body.trim()),
              );
              const foundCount = entriesForTarget(research, target).length;
              const entityLabel =
                target.entity_kind === 'person'
                  ? 'People'
                  : target.entity_kind === 'organisation'
                    ? 'Organisation'
                    : 'People & Orgs';

              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => {
                    setSelectedTargetId(target.id);
                    setStatusBanner(null);
                  }}
                  className={`flex flex-col gap-1.5 rounded-[16px] border p-3.5 text-left transition-all ${
                    isSelected
                      ? 'border-[#5ED3DF] bg-[#152831] shadow-[0_0_0_1px_rgba(94,211,223,0.25)]'
                      : 'border-[#2A2F39] bg-[#171A20] hover:border-[#3A414E] hover:bg-[#1B1F27]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold leading-snug text-[#F1F2F4]">
                      {target.target_type}
                    </span>
                    {hasUnsaved ? (
                      <span className="shrink-0 rounded-full bg-[#3A2E14] px-2 py-0.5 text-[10px] font-semibold text-[#F6C667]">
                        Unsaved
                      </span>
                    ) : resolved?.is_custom ? (
                      <span className="shrink-0 rounded-full bg-[#133524] px-2 py-0.5 text-[10px] font-semibold text-[#5BD69A]">
                        Edited &amp; saved
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-[#1F232B] px-2 py-0.5 text-[10px] font-medium text-[#A7ADB8]">
                        Pre-built
                      </span>
                    )}
                  </div>

                  <p className="m-0 line-clamp-2 text-xs leading-relaxed text-[#8A909C]">
                    {target.description}
                  </p>

                  <div className="mt-1 flex items-center justify-between text-[11px] text-[#8A909C]">
                    <span className="rounded-md bg-[#1F232B] px-2 py-0.5 text-[#C9CDD4]">
                      {entityLabel}
                    </span>
                    <span>{plural(foundCount, 'prospect')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right column: Active Category Template Editor */}
        {activeTarget && activeSavedOrDefault && (
          <div className={`${card} flex flex-col gap-4 p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#242933] pb-4">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="m-0 text-lg font-semibold text-[#F1F2F4]">
                    {activeTarget.target_type}
                  </h3>
                  {activeSavedOrDefault.is_custom ? (
                    <span className="rounded-full bg-[#133524] px-2.5 py-0.5 text-xs font-semibold text-[#5BD69A]">
                      Custom saved template
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#12313A] px-2.5 py-0.5 text-xs font-semibold text-[#9BE6EE]">
                      Pre-built from project brief
                    </span>
                  )}
                </div>
                <p className="m-0 text-xs leading-relaxed text-[#A7ADB8]">
                  {activeTarget.description}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  disabled={resettingTargetId === activeTarget.id || savingTargetId === activeTarget.id}
                  className={`${btnSecondary} h-9 px-3 text-xs`}
                >
                  {resettingTargetId === activeTarget.id ? 'Resetting…' : 'Reset to default'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={savingTargetId === activeTarget.id}
                  className={`${btnPrimary} h-9 px-4 text-xs`}
                >
                  {savingTargetId === activeTarget.id
                    ? 'Saving…'
                    : isDirty
                      ? 'Save template changes'
                      : 'Save template'}
                </button>
              </div>
            </div>

            {statusBanner && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  statusBanner.type === 'success'
                    ? 'border-[#1E563B] bg-[#112A1E] text-[#7CE8B4]'
                    : 'border-[#5C2626] bg-[#291315] text-[#F28B82]'
                }`}
              >
                {statusBanner.message}
              </div>
            )}

            {/* Editable Reference Subject Line */}
            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A7ADB8]">
                  Reference Subject Line
                </span>
                <span className="text-[11px] text-[#8A909C]">
                  Guides subject line framing for {activeTarget.target_type}
                </span>
              </div>
              <input
                type="text"
                aria-label={`Subject line template for ${activeTarget.target_type}`}
                value={currentDraft.subject_line}
                onChange={(e) => updateDraftField('subject_line', e.target.value)}
                placeholder="Enter a reference subject line for this category..."
                className="h-10 w-full rounded-xl border border-[#2A2F39] bg-[#111318] px-3.5 text-sm text-[#F1F2F4] outline-none transition-colors focus:border-[#5ED3DF]"
              />
            </label>

            {/* Editable Full Message Template */}
            <label className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#A7ADB8]">
                  Outreach Message Template (Fully Editable)
                </span>
                <span className="text-[11px] text-[#8A909C]">
                  Understands plain text as well as contextual cues in{' '}
                  <code className="rounded bg-[#1F232B] px-1 py-0.5 text-[#9BE6EE]">[...]</code> or{' '}
                  <code className="rounded bg-[#1F232B] px-1 py-0.5 text-[#9BE6EE]">(...)</code>{' '}
                  (e.g. personalised benefit, specific request, or work detail)
                </span>
              </div>
              <textarea
                aria-label={`Outreach message template for ${activeTarget.target_type}`}
                rows={14}
                value={currentDraft.body}
                onChange={(e) => updateDraftField('body', e.target.value)}
                placeholder="Write the full reference outreach message for this lead category..."
                className="w-full resize-y rounded-xl border border-[#2A2F39] bg-[#111318] p-4 font-sans text-sm leading-relaxed text-[#F1F2F4] outline-none transition-colors focus:border-[#5ED3DF]"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#22262E] pt-3 text-xs text-[#8A909C]">
              <span>
                {activeSavedOrDefault.updated_at
                  ? `Last saved ${new Date(activeSavedOrDefault.updated_at).toLocaleString()}`
                  : 'Using initial pre-built template derived from project brief'}
              </span>
              <span>
                Changes apply to future generations for{' '}
                <strong className="text-[#C9CDD4]">{activeTarget.target_type}</strong> without
                overwriting existing prospect messages.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
