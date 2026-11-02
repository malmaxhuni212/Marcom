'use client';

import { useMemo, useState } from 'react';
import { authenticatedFetch } from '@/auth/client';
import {
  FEEDBACK_SCOPE_LABELS,
  type FeedbackScope,
  type PersonalizationEntry,
  type PersonalizationSettings,
} from '@/marcom/schemas/personalization';
import type { ResearchRecord } from '@/marcom/schemas/research-record';
import { getRelevantFeedback } from '@/marcom/personalization/feedback';
import { Icon, Spinner } from './ui';

const QUICK_FEEDBACK = [
  'Make it shorter',
  'Less flattering, more to the point',
  "Don't open with \"I hope your week is going well\"",
  'Explain the award more clearly',
  'Make the ask clearer',
];

/**
 * Reviewer feedback box shown under a personalised draft.
 * - "Save feedback" stores it so every future draft it applies to learns from it.
 * - "Save & rewrite" stores it AND immediately rewrites this draft using it.
 */
export default function DraftFeedbackPanel({
  projectId,
  record,
  settings,
  disabled = false,
  onDraftUpdated,
  onSettingsUpdated,
}: {
  projectId: string;
  record: ResearchRecord;
  settings: PersonalizationSettings | null;
  disabled?: boolean;
  onDraftUpdated: (entry: PersonalizationEntry) => void;
  onSettingsUpdated?: (settings: PersonalizationSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<FeedbackScope>('project');
  const [busy, setBusy] = useState<'save' | 'rewrite' | 'remove' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const learned = useMemo(() => getRelevantFeedback(settings, record, 50), [settings, record]);
  const categoryLabel = record.target_type || 'this category';

  const scopeLabel = (value: FeedbackScope) =>
    value === 'category' ? `All ${categoryLabel}` : FEEDBACK_SCOPE_LABELS[value].label;

  const saveOnly = async () => {
    if (text.trim().length < 2) return setError('Write a little feedback first.');
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: record.record_id, feedback: { text: text.trim(), scope } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Feedback could not be saved.');
      if (data.settings) onSettingsUpdated?.(data.settings as PersonalizationSettings);
      setText('');
      setNotice('Saved. Future drafts will follow this feedback.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveAndRewrite = async () => {
    if (text.trim().length < 2) return setError('Write a little feedback first.');
    setBusy('rewrite');
    setError(null);
    setNotice(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: record.record_id,
          force: true,
          feedback: { text: text.trim(), scope },
        }),
      });
      const data = await response.json().catch(() => ({}));
      const updated = (data.items as PersonalizationEntry[] | undefined)?.find(
        (item) => item.record_id === record.record_id,
      );
      if (!response.ok || !updated) throw new Error(data.error || 'The draft could not be rewritten.');
      if (data.settings) onSettingsUpdated?.(data.settings as PersonalizationSettings);
      onDraftUpdated(updated);
      setText('');
      setNotice('Rewritten with your feedback. It is also saved for future drafts.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy('remove');
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeFeedbackId: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Feedback could not be removed.');
      if (data.settings) onSettingsUpdated?.(data.settings as PersonalizationSettings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const isDisabled = disabled || busy !== null;

  return (
    <div className="flex flex-col rounded-xl border border-[#2A2F39] bg-[#12151A]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#E2DDFF]">
          <Icon name="message" size={14} /> Give feedback
          {learned.length > 0 && (
            <span className="rounded-full bg-[#26224A] px-2 py-0.5 text-[10px] font-semibold text-[#CFC8FF]">
              {learned.length} learned
            </span>
          )}
        </span>
        <Icon name="chevronDown" size={14} className={`text-[#8A909C] transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-[#22262E] px-3.5 pb-3.5 pt-3">
          <p className="m-0 text-xs leading-relaxed text-[#8A909C]">
            Tell the agent what to change. It remembers this for future messages and can rewrite this one now.
          </p>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_FEEDBACK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setText((curr) => (curr.trim() ? `${curr.trim()}. ${q}` : q))}
                className="rounded-full border border-[#2A2F39] px-2.5 py-1 text-[11px] text-[#C9CDD4] hover:border-[#3A3F4A] hover:text-[#F1F2F4]"
              >
                {q}
              </button>
            ))}
          </div>

          <textarea
            aria-label="Feedback on this draft"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={3}
            maxLength={1000}
            placeholder={'e.g. "Too much praise about her books. Mention the £3,000 top prize and keep it under 100 words."'}
            className="w-full resize-y rounded-lg border border-[#2A2F39] bg-[#0E1014] p-3 text-[13px] leading-relaxed text-[#F1F2F4] outline-none focus:border-[#5ED3DF]"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[#8A909C]">Apply to:</span>
            {(['project', 'category', 'lead'] as FeedbackScope[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                title={FEEDBACK_SCOPE_LABELS[value].description}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                  scope === value
                    ? 'border-[#2E6B75] bg-[#12313A] text-[#9BE6EE]'
                    : 'border-[#2A2F39] text-[#A7ADB8] hover:text-[#F1F2F4]'
                }`}
              >
                {scopeLabel(value)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => void saveOnly()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#2A2F39] bg-[#171A20] px-3 text-xs font-semibold text-[#C9CDD4] hover:text-[#F1F2F4] disabled:opacity-50"
            >
              {busy === 'save' ? <Spinner size={12} /> : <Icon name="check" size={13} />} Save feedback
            </button>
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => void saveAndRewrite()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#26224A] px-3.5 text-xs font-semibold text-[#CFC8FF] hover:bg-[#322D5E] disabled:opacity-50"
            >
              {busy === 'rewrite' ? <Spinner size={12} /> : <Icon name="refresh" size={13} />}
              {busy === 'rewrite' ? 'Rewriting…' : 'Save & rewrite'}
            </button>
          </div>

          {notice && <p className="m-0 text-xs text-[#8EE6B6]">{notice}</p>}
          {error && (
            <p role="alert" className="m-0 text-xs text-[#F7B1AA]">
              {error}
            </p>
          )}

          {learned.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-[#22262E] pt-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8A909C]">
                What the agent has learned for this lead
              </span>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {learned.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-2 rounded-lg border border-[#22262E] bg-[#171A20] px-2.5 py-2"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-xs leading-relaxed text-[#ECEEF2]">{item.text}</span>
                      <span className="text-[10px] text-[#8A909C]">
                        {item.scope === 'lead'
                          ? `Only ${item.prospect_name || 'this lead'}`
                          : item.scope === 'category'
                            ? `All ${item.target_type || 'leads in category'}`
                            : 'All future messages'}{' '}
                        · {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void remove(item.id)}
                      aria-label="Forget this feedback"
                      title="Forget this feedback"
                      className="shrink-0 rounded-md p-1 text-[#8A909C] hover:bg-[#22262E] hover:text-[#F7B1AA] disabled:opacity-50"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
