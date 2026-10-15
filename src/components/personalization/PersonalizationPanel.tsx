'use client';

import { useState, useEffect } from 'react';
import type { PersonalizationEntry, OutreachCopy, PersonalizationStatus } from '@/marcom/schemas/personalization';
import { authenticatedFetch } from '@/auth/client';

interface PersonalizationPanelProps {
  projectId: string;
  recordId: string;
  prospectName: string;
  initialEntry?: PersonalizationEntry | null;
  onUpdated?: (entry: PersonalizationEntry) => void;
}

export default function PersonalizationPanel({
  projectId,
  recordId,
  prospectName,
  initialEntry,
  onUpdated,
}: PersonalizationPanelProps) {
  const [entry, setEntry] = useState<PersonalizationEntry | null>(initialEntry ?? null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'copy' | 'strategy' | 'qa'>('copy');
  const [showEvaluatedRoutes, setShowEvaluatedRoutes] = useState(true);
  const [callNotes, setCallNotes] = useState('');

  // Local draft states for live editing
  const [selectedSubjectIndex, setSelectedSubjectIndex] = useState(0);
  const [emailBody, setEmailBody] = useState('');
  const [linkedInMessage, setLinkedInMessage] = useState('');
  const [followUpBody, setFollowUpBody] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Sync state when entry changes
  useEffect(() => {
    if (initialEntry) {
      setEntry(initialEntry);
    } else {
      fetchEntry();
    }
  }, [projectId, recordId, initialEntry]);

  useEffect(() => {
    if (entry?.copy) {
      setEmailBody(entry.copy.email_body || '');
      setLinkedInMessage(entry.copy.linkedin_message || '');
      setFollowUpBody(entry.copy.follow_up_body || '');
      setHasChanges(false);
    }
  }, [entry]);

  const fetchEntry = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/projects/${projectId}/personalization?recordId=${recordId}`);
      if (!res.ok) throw new Error('Failed to fetch outreach draft.');
      const data = await res.json();
      const found = data.items?.find((i: PersonalizationEntry) => i.record_id === recordId) || null;
      setEntry(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading personalization.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (force = false) => {
    setGenerating(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate outreach.');
      const updated = data.items?.find((i: PersonalizationEntry) => i.record_id === recordId) || null;
      setEntry(updated);
      if (updated && onUpdated) onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate outreach.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!entry?.copy) return;
    setSaving(true);
    setError(null);
    try {
      const updatedCopy: OutreachCopy = {
        ...entry.copy,
        email_body: emailBody,
        linkedin_message: linkedInMessage,
        follow_up_body: followUpBody,
      };

      const res = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          copy: updatedCopy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save copy changes.');
      const updated = data.items?.find((i: PersonalizationEntry) => i.record_id === recordId) || null;
      setEntry(updated);
      setHasChanges(false);
      if (updated && onUpdated) onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (nextStatus: PersonalizationStatus) => {
    setSaving(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/projects/${projectId}/personalization`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          status: nextStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update status.');
      const updated = data.items?.find((i: PersonalizationEntry) => i.record_id === recordId) || null;
      setEntry(updated);
      if (updated && onUpdated) onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent mb-3" />
        <p className="text-xs text-white/50">Loading personalization data...</p>
      </div>
    );
  }

  // Not generated yet
  if (!entry && !generating) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#101017] p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 mb-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-white/90">No Outreach Drafted Yet</h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/50">
          Run the two-model intelligence pipeline to analyze {prospectName}&apos;s verified research dossier, audit candidate contact routes (real vs fake), extract genuine hooks, and draft tailored copy.
        </p>
        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
        <button
          type="button"
          onClick={() => handleGenerate(false)}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-95 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Generate Personalized Outreach
        </button>
      </div>
    );
  }

  // Generation spinner
  if (generating) {
    return (
      <div className="rounded-2xl border border-cyan-500/20 bg-[#101017] p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-400 mb-4 animate-pulse">
          <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-white/90">Agent 3 Pipeline in Progress</h3>
        <div className="mx-auto mt-3 max-w-sm space-y-2 text-left text-xs">
          <div className="flex items-center gap-2 text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>Model 1 (Strategist): Auditing contact routes & extracting verified hooks...</span>
          </div>
          <div className="flex items-center gap-2 text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <span>Model 2 (Copywriter): Crafting human email & LinkedIn outreach...</span>
          </div>
          <div className="flex items-center gap-2 text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <span>QA Engine: Validating deliverability, word count & citations...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!entry) return null;

  const strategy = entry.strategy;
  const copy = entry.copy;
  const qa = entry.qa;
  const audit = strategy?.contact_audit;

  const candidateEmails = entry.candidate_contacts?.emails || [];
  const candidateLinkedIn = entry.candidate_contacts?.linkedin_urls || [];
  const candidateWebsites = entry.candidate_contacts?.websites || [];
  const candidatePhones = entry.candidate_contacts?.phones || [];

  const targetEmail =
    audit?.best_channel === 'email' && audit.best_contact_target?.includes('@')
      ? audit.best_contact_target
      : candidateEmails[0] || (audit?.backup_route?.includes('@') ? audit.backup_route : null);

  const targetLinkedIn =
    audit?.best_channel === 'linkedin' && audit.best_contact_target?.includes('linkedin')
      ? audit.best_contact_target
      : candidateLinkedIn[0] || null;

  const targetWebsite =
    audit?.best_channel === 'contact_form' || audit?.best_contact_target?.startsWith('http')
      ? audit.best_contact_target
      : candidateWebsites[0] || audit?.backup_route || null;

  const targetPhone =
    audit?.best_channel === 'phone' && audit.best_contact_target
      ? audit.best_contact_target
      : candidatePhones[0] || (audit?.backup_route?.startsWith('+') ? audit.backup_route : null);

  const primaryChannel = audit?.best_channel || strategy?.recommended_channel || 'email';
  const normChannel = primaryChannel.toLowerCase();
  const isLinkedInPrimary = normChannel === 'linkedin';
  const isPhonePrimary = normChannel === 'phone';
  const isFormPrimary = normChannel === 'contact_form' || normChannel === 'website_contact_form';
  const isEmailPrimary = !isLinkedInPrimary && !isPhonePrimary && !isFormPrimary;

  const primaryHook = strategy?.hooks?.find((h) => h.id === strategy?.primary_hook_id) || strategy?.hooks?.[0];
  const phoneOpener = `Hi, this is our team with Maya Book Awards. I'm calling directly for ${prospectName} regarding your literary work and publications. Do you have 60 seconds?`;
  const phoneBridge = `${strategy?.angle || strategy?.relevance_thesis || 'We are reaching out to select authors and publishers regarding entries for the 2026 Maya Book Awards.'}`;
  const phoneCta = `"${strategy?.call_to_action || 'Would you be open to reviewing the guidelines for this year’s submissions?'}"`;
  const fullPhoneScript = `${phoneOpener}\n\n${phoneBridge}\n\nAsk / CTA: ${phoneCta}`;

  const selectedSubjectText = copy?.subject_lines?.[selectedSubjectIndex]?.text || '';

  return (
    <div className="space-y-4">
      {/* Header bar with Status, QA Score & Channel */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#111118] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Badge */}
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${
              entry.status === 'approved'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : entry.status === 'draft'
                ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                : entry.status === 'needs_more_research'
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
            }`}
          >
            {entry.status.replace(/_/g, ' ')}
          </span>

          {/* QA Score */}
          {qa && (
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                qa.score >= 75
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : qa.score >= 60
                  ? 'bg-amber-500/10 text-amber-300'
                  : 'bg-rose-500/10 text-rose-300'
              }`}
            >
              QA {qa.score}/100 ({qa.status})
            </span>
          )}

          {/* Channel */}
          {strategy && (
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] capitalize text-white/70">
              Channel: {strategy.recommended_channel}
            </span>
          )}

          {entry.edited_by_human && (
            <span className="rounded-full bg-purple-500/15 px-2.5 py-1 text-[10px] font-medium text-purple-300">
              Human Edited
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleGenerate(true)}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition"
          >
            <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Regenerate
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Warning for leads marked "needs_more_research" */}
      {entry.status === 'needs_more_research' && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-300 font-medium text-xs">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>Strategist Assessment: Outreach Blocked</span>
          </div>
          <p className="text-xs text-amber-200/80 leading-relaxed">
            {strategy?.readiness_reason || entry.reviewer_note || 'Missing verified direct contact details or unique hooks.'}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => handleGenerate(true)}
              className="rounded-lg bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/30 transition"
            >
              Force Generate Draft Anyway
            </button>
          </div>
        </div>
      )}

      {/* CONTACT ROUTE INTELLIGENCE CARD */}
      {audit && (
        <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-[#121624] to-[#0e1017] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                <span>📍 Recommended Contact Route:</span>
                <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-cyan-200 uppercase text-[10px]">
                  {audit.best_channel}
                </span>
              </span>

              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  audit.is_direct_contact
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                }`}
              >
                {audit.is_direct_contact ? '✓ Direct 1-to-1' : '🏢 Team / Gatekeeper Inbox'}
              </span>
            </div>

            {/* Email deliverability indicator */}
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                audit.email_status === 'verified_direct'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : audit.email_status === 'generic_inbox'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : audit.email_status === 'fake_or_scraping_artifact'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : audit.email_status === 'unverified_risky'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-white/[0.05] text-white/50 border border-white/[0.1]'
              }`}
            >
              Email Deliverability: {audit.email_status.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Destination Target Box */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/40 px-3.5 py-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-white/40 text-xs shrink-0">Destination:</span>
              <span className="font-mono text-xs font-semibold text-cyan-200 truncate select-all">
                {audit.best_contact_target}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => copyToClipboard(audit.best_contact_target, 'target')}
                className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-xs text-cyan-300 hover:bg-white/[0.1] transition"
              >
                {copiedKey === 'target' ? '✓ Copied' : '📋 Copy'}
              </button>
              {audit.best_contact_target.includes('@') && (
                <a
                  href={`mailto:${audit.best_contact_target}`}
                  className="rounded-lg bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 transition"
                >
                  Mailto ↗
                </a>
              )}
              {audit.best_contact_target.startsWith('http') && (
                <a
                  href={audit.best_contact_target}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 transition"
                >
                  Open ↗
                </a>
              )}
            </div>
          </div>

          {/* Rationale explanation */}
          <div className="text-xs leading-relaxed text-white/80 space-y-1">
            <p>
              <span className="font-semibold text-cyan-300">Why this is the best place: </span>
              {audit.why_best_route}
            </p>
            {audit.backup_route && (
              <p className="text-[11px] text-white/50 pt-1">
                <span className="text-white/70 font-medium">Backup Fallback: </span>
                {audit.backup_route}
              </p>
            )}
          </div>

          {/* Evaluated routes audit breakdown */}
          {audit.evaluated_routes && audit.evaluated_routes.length > 0 && (
            <div className="pt-1 border-t border-white/[0.05]">
              <button
                type="button"
                onClick={() => setShowEvaluatedRoutes(!showEvaluatedRoutes)}
                className="text-[11px] font-medium text-cyan-300 hover:underline flex items-center gap-1.5"
              >
                <span>{showEvaluatedRoutes ? '▴ Hide' : '▾ Inspect all audited routes'} ({audit.evaluated_routes.length} candidates evaluated)</span>
              </button>

              {showEvaluatedRoutes && (
                <div className="mt-2 space-y-1.5 pt-1">
                  {(() => {
                    const rankedRoutes = [...audit.evaluated_routes].sort((a, b) => {
                      const verdictScore = (v: string) => {
                        if (v === 'recommended') return 1;
                        if (v === 'viable_backup') return 2;
                        if (v === 'generic_gatekeeper') return 3;
                        if (v === 'not_worth_it') return 4;
                        return 5; // unusable_or_fake
                      };
                      const diff = verdictScore(a.verdict) - verdictScore(b.verdict);
                      if (diff !== 0) return diff;
                      return (a.priority || 99) - (b.priority || 99);
                    });

                    return rankedRoutes.map((route, idx) => {
                      const isEmail = route.value.includes('@');
                      const isUrl = route.value.startsWith('http');
                      const isPhone = route.channel === 'phone' || route.value.startsWith('+');

                      return (
                        <div
                          key={idx}
                          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border p-2.5 text-[11px] transition ${
                            route.verdict === 'recommended'
                              ? 'border-cyan-500/30 bg-cyan-500/[0.05]'
                              : 'border-white/[0.05] bg-black/30'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-mono text-[10px] font-bold text-white/50 shrink-0">
                              #{idx + 1}
                            </span>
                            <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] uppercase font-mono text-white/60 shrink-0">
                              {route.channel}
                            </span>
                            <span className="font-mono text-white/85 truncate max-w-[240px] select-all">
                              {route.value}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                route.verdict === 'recommended'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : route.verdict === 'viable_backup'
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                  : route.verdict === 'generic_gatekeeper'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : route.verdict === 'unusable_or_fake'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-white/[0.06] text-white/40'
                              }`}
                            >
                              {route.verdict === 'recommended'
                                ? '★ #1 Recommended (Highest Chance)'
                                : route.verdict === 'viable_backup'
                                ? `#${idx + 1} Viable Backup Route`
                                : route.verdict === 'generic_gatekeeper'
                                ? `#${idx + 1} Gatekeeper Inbox (Low Chance)`
                                : route.verdict === 'unusable_or_fake'
                                ? '⚠️ Scraping Trap / Fake (Do Not Contact)'
                                : `#${idx + 1} ${route.verdict.replace(/_/g, ' ')}`}
                            </span>

                            <span className="text-white/50 text-[10px] hidden md:inline max-w-xs truncate" title={route.quality_assessment}>
                              {route.quality_assessment}
                            </span>

                            <button
                              type="button"
                              onClick={() => copyToClipboard(route.value, `route-${idx}`)}
                              className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/60 hover:text-cyan-300"
                              title="Copy route value"
                            >
                              {copiedKey === `route-${idx}` ? '✓' : '📋'}
                            </button>

                            {isEmail && (
                              <a
                                href={`mailto:${route.value}`}
                                className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/25"
                                title="Mailto"
                              >
                                ✉️
                              </a>
                            )}
                            {isUrl && (
                              <a
                                href={route.value}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/25"
                                title="Open Link"
                              >
                                ↗
                              </a>
                            )}
                            {isPhone && (
                              <a
                                href={`tel:${route.value}`}
                                className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/25"
                                title="Call"
                              >
                                📞
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/[0.08] text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('copy')}
          className={`px-4 py-2.5 font-medium transition border-b-2 ${
            activeTab === 'copy'
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-white/50 hover:text-white/80'
          }`}
        >
          ✉️ Outreach Copy
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('strategy')}
          className={`px-4 py-2.5 font-medium transition border-b-2 ${
            activeTab === 'strategy'
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-white/50 hover:text-white/80'
          }`}
        >
          🧠 Strategist Brief
        </button>
        {qa && (
          <button
            type="button"
            onClick={() => setActiveTab('qa')}
            className={`px-4 py-2.5 font-medium transition border-b-2 ${
              activeTab === 'qa'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-white/50 hover:text-white/80'
            }`}
          >
            🛡️ QA & Deliverability ({qa.score}%)
          </button>
        )}
      </div>

      {/* TAB 1: OUTREACH COPY */}
      {activeTab === 'copy' && copy && (() => {
        const renderSubjectLines = () => {
          if (!copy?.subject_lines || copy.subject_lines.length === 0) return null;
          return (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Subject Line Options
              </label>
              <div className="space-y-1.5">
                {copy.subject_lines.map((subject, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedSubjectIndex(idx)}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-xs transition ${
                      selectedSubjectIndex === idx
                        ? 'border-cyan-500/50 bg-cyan-500/[0.08] text-white'
                        : 'border-white/[0.06] bg-white/[0.02] text-white/70 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase text-white/50">
                        {subject.style}
                      </span>
                      <span className="truncate">{subject.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(subject.text, `subj-${idx}`);
                      }}
                      className="shrink-0 text-white/40 hover:text-cyan-300 transition"
                      title="Copy subject line"
                    >
                      {copiedKey === `subj-${idx}` ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        };

        const renderEmailBlock = (isPrimary: boolean) => (
          <div className={`space-y-3 rounded-2xl border p-4.5 ${isPrimary ? 'border-cyan-500/35 bg-gradient-to-b from-cyan-500/[0.05] to-transparent shadow-lg shadow-cyan-500/5' : 'border-white/[0.07] bg-white/[0.02]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">✉️</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
                    {isPrimary ? '⭐ #1 Recommended Primary Route: Direct Email Outreach' : 'Secondary / Backup Route: Email Outreach'}
                  </h4>
                  <p className="text-[11px] text-white/45">
                    {isPrimary ? 'Tailored cold email pitch with grounded hook, value bridge, and low-friction CTA.' : 'Viable secondary route if primary channel is unreachable.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-white/40">
                  {wordCount(emailBody)} words
                  {wordCount(emailBody) >= 70 && wordCount(emailBody) <= 150 ? (
                    <span className="text-emerald-400 ml-1">· Optimal</span>
                  ) : (
                    <span className="text-amber-400 ml-1">· Target: 70–150</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(emailBody, 'email')}
                  className="flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 transition font-medium"
                >
                  {copiedKey === 'email' ? '✓ Copied Body' : '📋 Copy Email Body'}
                </button>
              </div>
            </div>

            {renderSubjectLines()}

            {/* Email Dispatch Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white/40 text-[11px] font-medium shrink-0">Send To:</span>
                {targetEmail ? (
                  <span className="font-mono text-cyan-200 font-semibold truncate select-all">{targetEmail}</span>
                ) : (
                  <span className="text-amber-300/80 text-[11px] italic">No direct email found (use primary channel below)</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {targetEmail && (
                  <>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(targetEmail, 'target-email')}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-white/[0.1] transition font-medium"
                    >
                      {copiedKey === 'target-email' ? '✓ Address Copied' : '📋 Copy Address'}
                    </button>
                    <a
                      href={`mailto:${encodeURIComponent(targetEmail)}?subject=${encodeURIComponent(selectedSubjectText)}&body=${encodeURIComponent(emailBody)}`}
                      className="rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition flex items-center gap-1.5 shadow-sm"
                    >
                      <span>✉️ Open in Mail Client</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            <textarea
              rows={7}
              value={emailBody}
              onChange={(e) => {
                setEmailBody(e.target.value);
                setHasChanges(true);
              }}
              className="w-full rounded-xl border border-white/[0.08] bg-[#0c0c12] p-4 text-xs font-mono leading-relaxed text-white/85 outline-none focus:border-cyan-400/50"
            />
          </div>
        );

        const renderLinkedInBlock = (isPrimary: boolean) => (
          <div className={`space-y-3 rounded-2xl border p-4.5 ${isPrimary ? 'border-cyan-500/35 bg-gradient-to-b from-cyan-500/[0.05] to-transparent shadow-lg shadow-cyan-500/5' : 'border-white/[0.07] bg-white/[0.02]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">💼</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
                    {isPrimary ? '⭐ #1 Recommended Primary Route: LinkedIn Direct Outreach & Note' : 'Secondary / Backup Route: LinkedIn Connection Note'}
                  </h4>
                  <p className="text-[11px] text-white/45">
                    {isPrimary ? 'Direct personal 1-to-1 route to their verified profile, bypassing generic inboxes.' : 'Alternative direct route if email bounces or is role-based.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] ${linkedInMessage.length <= 280 ? 'text-white/40' : 'text-rose-400 font-semibold'}`}>
                  {linkedInMessage.length} / 280 chars
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(linkedInMessage, 'linkedin')}
                  className="flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 transition font-medium"
                >
                  {copiedKey === 'linkedin' ? '✓ Copied Note' : '📋 Copy Connection Note'}
                </button>
              </div>
            </div>

            {/* LinkedIn Dispatch Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white/40 text-[11px] font-medium shrink-0">Recipient Profile:</span>
                {targetLinkedIn ? (
                  <span className="font-mono text-cyan-200 font-semibold truncate select-all">{targetLinkedIn}</span>
                ) : (
                  <span className="text-white/40 text-[11px] italic">No direct LinkedIn profile saved</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {targetLinkedIn && (
                  <>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(targetLinkedIn, 'target-linkedin')}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-white/[0.1] transition font-medium"
                    >
                      {copiedKey === 'target-linkedin' ? '✓ Link Copied' : '📋 Copy Profile Link'}
                    </button>
                    <a
                      href={targetLinkedIn}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-blue-500/15 border border-blue-500/30 px-3 py-1 text-[11px] font-medium text-blue-200 hover:bg-blue-500/25 transition flex items-center gap-1.5 shadow-sm"
                    >
                      <span>🔗 Open LinkedIn Profile</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            <textarea
              rows={3}
              value={linkedInMessage}
              onChange={(e) => {
                setLinkedInMessage(e.target.value);
                setHasChanges(true);
              }}
              className="w-full rounded-xl border border-white/[0.08] bg-[#0c0c12] p-3 text-xs font-mono leading-relaxed text-white/85 outline-none focus:border-cyan-400/50"
            />

            {isPrimary && (
              <p className="text-[11px] text-cyan-300/80 bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-2.5 leading-relaxed">
                💡 <span className="font-semibold">Conversion Tip:</span> Send this 280-char note when sending your LinkedIn connection request. Once connected, follow up with the full guidelines or invitation.
              </p>
            )}
          </div>
        );

        const renderPhoneBlock = (isPrimary: boolean) => (
          <div className={`space-y-3 rounded-2xl border p-4.5 ${isPrimary ? 'border-cyan-500/35 bg-gradient-to-b from-cyan-500/[0.05] to-transparent shadow-lg shadow-cyan-500/5' : 'border-white/[0.07] bg-white/[0.02]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">📞</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
                    {isPrimary ? '⭐ #1 Recommended Primary Route: Direct Phone Call & Talk Track' : 'Secondary / Backup Route: Phone Outreach'}
                  </h4>
                  <p className="text-[11px] text-white/45">
                    {isPrimary ? 'Direct verbal outreach is the sole or highest-converting contact method verified for this target.' : 'Alternative voice outreach channel.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(fullPhoneScript, 'phone-script')}
                className="flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 transition font-medium"
              >
                {copiedKey === 'phone-script' ? '✓ Copied Talk Track' : '📋 Copy Pitch Script'}
              </button>
            </div>

            {/* Phone Target Dispatch Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white/40 text-[11px] font-medium shrink-0">Telephone Number:</span>
                {targetPhone ? (
                  <span className="font-mono text-cyan-200 font-semibold truncate select-all">{targetPhone}</span>
                ) : (
                  <span className="text-amber-300/80 text-[11px] italic">No phone number recorded in dossier</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {targetPhone && (
                  <>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(targetPhone, 'target-phone')}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-white/[0.1] transition font-medium"
                    >
                      {copiedKey === 'target-phone' ? '✓ Number Copied' : '📋 Copy Number'}
                    </button>
                    <a
                      href={`tel:${targetPhone.replace(/\s+/g, '')}`}
                      className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 transition flex items-center gap-1.5 shadow-sm"
                    >
                      <span>📞 Call Target</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Talk Track Card */}
            <div className="space-y-2 rounded-xl bg-black/40 border border-white/[0.06] p-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">1. Pattern-Interrupt Opener & Hook</span>
                <p className="text-white/85 font-mono text-[11.5px] leading-relaxed bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
                  {phoneOpener}
                </p>
              </div>
              <div className="space-y-1 pt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">2. Value Bridge & Context</span>
                <p className="text-white/80 font-mono text-[11.5px] leading-relaxed bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
                  {phoneBridge}
                </p>
              </div>
              <div className="space-y-1 pt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">3. Low-Friction Close / Ask</span>
                <p className="text-white/90 font-mono text-[11.5px] leading-relaxed bg-white/[0.02] p-2.5 rounded-lg border border-white/[0.04]">
                  {phoneCta}
                </p>
              </div>
            </div>

            {/* Live Call Notes Field */}
            <div className="space-y-1 pt-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                Call Outcome & Activity Log
              </label>
              <input
                type="text"
                placeholder="Type quick call outcome (e.g. Left message with receptionist / Emailed submissions link)..."
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-[#0c0c12] px-3.5 py-2 text-xs text-white/85 placeholder:text-white/30 outline-none focus:border-cyan-400/50"
              />
            </div>
          </div>
        );

        const renderFormBlock = (isPrimary: boolean) => (
          <div className={`space-y-3 rounded-2xl border p-4.5 ${isPrimary ? 'border-cyan-500/35 bg-gradient-to-b from-cyan-500/[0.05] to-transparent shadow-lg shadow-cyan-500/5' : 'border-white/[0.07] bg-white/[0.02]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2.5">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">🌐</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
                    {isPrimary ? '⭐ #1 Recommended Route: Official Inquiry / Contact Form' : 'Secondary / Backup Route: Contact Form'}
                  </h4>
                  <p className="text-[11px] text-white/45">
                    {isPrimary ? 'Website contact or submissions form audited as the most legitimate route for this organization.' : 'Web portal submission backup.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(emailBody, 'form-body')}
                className="flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 transition font-medium"
              >
                {copiedKey === 'form-body' ? '✓ Copied Message' : '📋 Copy Form Text'}
              </button>
            </div>

            {/* Form Target Dispatch Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-white/40 text-[11px] font-medium shrink-0">Form URL:</span>
                {targetWebsite ? (
                  <span className="font-mono text-cyan-200 font-semibold truncate select-all">{targetWebsite}</span>
                ) : (
                  <span className="text-white/40 text-[11px] italic">No form URL recorded</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {targetWebsite && (
                  <>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(targetWebsite, 'target-website')}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-white/[0.1] transition font-medium"
                    >
                      {copiedKey === 'target-website' ? '✓ Link Copied' : '📋 Copy URL'}
                    </button>
                    <a
                      href={targetWebsite}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition flex items-center gap-1.5 shadow-sm"
                    >
                      <span>↗ Open Contact Form</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Inquiry Topic / Subject</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(selectedSubjectText || `Maya Book Awards 2026 - ${prospectName}`, 'form-subject')}
                  className="text-[10px] text-cyan-300 hover:underline"
                >
                  {copiedKey === 'form-subject' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <p className="font-mono text-xs text-white/85 bg-black/40 border border-white/[0.06] rounded-lg p-2.5">
                {selectedSubjectText || `Maya Book Awards 2026 - ${prospectName}`}
              </p>
            </div>

            <div className="space-y-1 pt-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Message Body</span>
              <textarea
                rows={6}
                value={emailBody}
                onChange={(e) => {
                  setEmailBody(e.target.value);
                  setHasChanges(true);
                }}
                className="w-full rounded-xl border border-white/[0.08] bg-[#0c0c12] p-3 text-xs font-mono leading-relaxed text-white/85 outline-none focus:border-cyan-400/50"
              />
            </div>
          </div>
        );

        const renderFollowUpBlock = () => (
          <div className="space-y-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-white/60">
                  Follow-Up Outreach (4–6 Days Later)
                </h4>
                <p className="text-[11px] text-white/40">
                  Low-pressure follow-up adding a new value nugget or deadline reminder without guilt-tripping.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {targetEmail && (
                  <a
                    href={`mailto:${encodeURIComponent(targetEmail)}?subject=${encodeURIComponent(`Following up: ${selectedSubjectText}`)}&body=${encodeURIComponent(followUpBody)}`}
                    className="rounded-lg bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition flex items-center gap-1"
                  >
                    <span>✉️ Open in Mail Client</span>
                    <span className="text-[10px]">↗</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => copyToClipboard(followUpBody, 'followup')}
                  className="flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 transition font-medium"
                >
                  {copiedKey === 'followup' ? '✓ Copied' : '📋 Copy Follow-up'}
                </button>
              </div>
            </div>
            <textarea
              rows={4}
              value={followUpBody}
              onChange={(e) => {
                setFollowUpBody(e.target.value);
                setHasChanges(true);
              }}
              className="w-full rounded-xl border border-white/[0.08] bg-[#0c0c12] p-3 text-xs font-mono leading-relaxed text-white/85 outline-none focus:border-cyan-400/50"
            />
          </div>
        );

        return (
          <div className="space-y-5">
            {/* Top Primary Route Priority Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-transparent border border-cyan-500/25 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-base">
                  {isLinkedInPrimary ? '💼' : isPhonePrimary ? '📞' : isFormPrimary ? '🌐' : '✉️'}
                </span>
                <span className="text-xs font-semibold text-cyan-200">
                  Primary Contact Strategy: <span className="uppercase font-bold text-white">{primaryChannel}</span>
                </span>
                <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold">
                  ★ Ranked #1 (Highest Chance of Conversion)
                </span>
              </div>
              <span className="text-[11px] text-white/50">
                The tailored strategy and copy for <span className="text-white/85 font-semibold capitalize">{primaryChannel}</span> are prioritized first below.
              </span>
            </div>

            {/* DYNAMIC CHANNEL RENDERING: BEST CONTACT WAY ALWAYS FIRST */}
            {isLinkedInPrimary && (
              <>
                {renderLinkedInBlock(true)}
                {renderEmailBlock(false)}
                {renderFollowUpBlock()}
              </>
            )}

            {isPhonePrimary && (
              <>
                {renderPhoneBlock(true)}
                {renderLinkedInBlock(false)}
                {renderEmailBlock(false)}
                {renderFollowUpBlock()}
              </>
            )}

            {isFormPrimary && (
              <>
                {renderFormBlock(true)}
                {renderEmailBlock(false)}
                {renderLinkedInBlock(false)}
                {renderFollowUpBlock()}
              </>
            )}

            {isEmailPrimary && (
              <>
                {renderEmailBlock(true)}
                {renderLinkedInBlock(false)}
                {renderFollowUpBlock()}
              </>
            )}

            {/* Hook Usage Note */}
            {copy.hook_usage && (
              <p className="text-[11px] text-white/40 italic">
                AI Hook Strategy: {copy.hook_usage}
              </p>
            )}

            {/* Bottom Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.08]">
              <div className="flex items-center gap-2">
                {hasChanges && (
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={saving}
                    className="rounded-xl bg-purple-500 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-600 transition disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Edits'}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {entry.status !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange('approved')}
                    disabled={saving}
                    className="rounded-xl bg-emerald-500/20 border border-emerald-500/30 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition disabled:opacity-50"
                  >
                    ✓ Approve Outreach
                  </button>
                )}
                {entry.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange('draft')}
                    disabled={saving}
                    className="rounded-xl border border-white/[0.08] px-4 py-2 text-xs text-white/60 hover:bg-white/[0.05] transition"
                  >
                    Move Back to Draft
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAB 2: STRATEGIST DOSSIER */}
      {activeTab === 'strategy' && strategy && (
        <div className="space-y-4">
          {/* Best Contact Route Strategy Overview */}
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                🎯 Best Contact Route Strategy
              </span>
              <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase">
                ★ Ranked #1: {primaryChannel}
              </span>
            </div>
            <p className="text-xs text-white/90">
              <span className="font-semibold text-cyan-200">Recommended Destination:</span>{' '}
              <span className="font-mono text-cyan-300 select-all">{audit?.best_contact_target || 'Pending target assignment'}</span>
            </p>
            <p className="text-[11.5px] text-white/70 leading-relaxed">
              <span className="font-semibold text-white/90">Strategist Rationale:</span> {audit?.why_best_route || strategy.channel_reason}
            </p>
            {audit?.backup_route && (
              <p className="text-[11px] text-white/50 pt-1 border-t border-white/[0.04]">
                <span className="font-medium text-white/70">Viable Backup Route:</span> {audit.backup_route}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-cyan-300/80">Relevance Thesis</h4>
            <p className="text-xs text-white/80 leading-relaxed">{strategy.relevance_thesis}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40">Campaign Objective</h4>
              <p className="mt-1 text-xs text-white/70">{strategy.campaign_objective}</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40">Outreach Goal</h4>
              <p className="mt-1 text-xs text-white/70">{strategy.outreach_goal}</p>
            </div>
          </div>

          {/* Hooks */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Verified Evidence Hooks ({strategy.hooks.length})
            </h4>
            <div className="space-y-2">
              {strategy.hooks.map((hook) => (
                <div
                  key={hook.id}
                  className={`rounded-xl border p-3 space-y-2 text-xs transition ${
                    hook.id === strategy.primary_hook_id
                      ? 'border-cyan-500/40 bg-cyan-500/[0.05]'
                      : 'border-white/[0.06] bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-cyan-300">
                      {hook.id} {hook.id === strategy.primary_hook_id && '★ Primary Hook'}
                    </span>
                    <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] uppercase text-white/50">
                      {hook.strength}
                    </span>
                  </div>
                  <p className="text-white/85">{hook.fact}</p>
                  {hook.evidence_quote && (
                    <blockquote className="border-l-2 border-cyan-400/40 pl-2 text-[11px] text-white/50 italic">
                      &ldquo;{hook.evidence_quote}&rdquo;
                    </blockquote>
                  )}
                  <p className="text-[11px] text-white/40">
                    <span className="text-white/60 font-medium">Why it resonates:</span> {hook.why_it_resonates}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Angle & Tone */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40">Angle & Tone</h4>
            <p className="text-xs text-white/80"><span className="text-cyan-300 font-medium">Angle:</span> {strategy.angle}</p>
            <p className="text-xs text-white/60"><span className="text-white/80 font-medium">Tone ({strategy.tone.register}):</span> {strategy.tone.guidance}</p>
          </div>

          {/* Call to Action */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 text-xs space-y-1">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Proposed Call To Action</h4>
            <p className="text-emerald-100 font-medium">&ldquo;{strategy.call_to_action}&rdquo;</p>
          </div>

          {/* Strictly Avoid */}
          {strategy.avoid && strategy.avoid.length > 0 && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.03] p-3 text-xs space-y-1">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80">Strictly Avoid</h4>
              <ul className="list-disc list-inside space-y-1 text-white/50">
                {strategy.avoid.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: QA & DELIVERABILITY */}
      {activeTab === 'qa' && qa && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/40">Quality Assessment</p>
              <h4 className="text-xl font-bold text-white/90 mt-1">{qa.score} / 100</h4>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                qa.status === 'passed'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : qa.status === 'needs_review'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {qa.status.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Verified hooks */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              Verified Grounded Hooks ({qa.verified_hook_ids.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {qa.verified_hook_ids.map((id) => (
                <span key={id} className="rounded-md bg-emerald-500/15 px-2 py-1 text-emerald-300 font-mono text-[11px]">
                  ✓ {id} verified from research evidence
                </span>
              ))}
            </div>
          </div>

          {/* Issues */}
          {qa.issues.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                QA Feedback & Warnings ({qa.issues.length})
              </h4>
              <div className="space-y-1.5">
                {qa.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-3 text-xs ${
                      issue.severity === 'error'
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                        : issue.severity === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        : 'border-white/[0.06] bg-white/[0.02] text-white/70'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase opacity-75">[{issue.field}]</span>
                      <span>{issue.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 text-xs text-emerald-300">
              ✓ All automated QA quality checks passed cleanly! No buzzwords, optimal length, authentic evidence cited.
            </div>
          )}

          {/* Model info */}
          <div className="text-[11px] text-white/30 space-y-1">
            <p>Strategist: {entry.models.strategist} ({entry.timings_ms.strategist}ms)</p>
            <p>Copywriter: {entry.models.writer} ({entry.timings_ms.writer}ms)</p>
            <p>Generated: {new Date(entry.generated_at).toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}
