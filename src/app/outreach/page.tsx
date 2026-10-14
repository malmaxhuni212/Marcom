'use client';

import { useState, useEffect, useMemo } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import PersonalizationPanel from '@/components/personalization/PersonalizationPanel';
import CampaignSettingsModal from '@/components/personalization/CampaignSettingsModal';
import type { PersonalizationEntry, PersonalizationSettings } from '@/marcom/schemas/personalization';
import type { Project } from '@/types';

export default function OutreachPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [entries, setEntries] = useState<PersonalizationEntry[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    drafts: number;
    approved: number;
    rejected: number;
    needs_more_research: number;
    failed: number;
    average_qa_score: number;
  } | null>(null);
  const [settings, setSettings] = useState<PersonalizationSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');

  // Modals & Batch actions
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [copiedTargetId, setCopiedTargetId] = useState<string | null>(null);

  // 1. Fetch available projects
  useEffect(() => {
    fetch('/api/projects')
      .then((res) => res.json())
      .then((data: Project[]) => {
        setProjects(data);
        if (data.length > 0) {
          // Default to the first active project or Maya Book Awards if present
          const mba = data.find((p) => p.name.toLowerCase().includes('book') || p.name.toLowerCase().includes('maya'));
          setSelectedProjectId(mba ? mba.id : data[0].id);
        }
      })
      .catch((err) => setError('Failed to load projects: ' + err.message));
  }, []);

  // 2. Fetch personalization data for active project
  useEffect(() => {
    if (!selectedProjectId) return;
    loadPersonalizationData();
  }, [selectedProjectId]);

  const loadPersonalizationData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/personalization`);
      if (!res.ok) throw new Error('Failed to load personalization data');
      const data = await res.json();
      setEntries(data.items || []);
      setSummary(data.summary || null);
      setSettings(data.settings || null);

      // Select first draft if none selected
      if (data.items?.length > 0 && !selectedRecordId) {
        setSelectedRecordId(data.items[0].record_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching outreach entries.');
    } finally {
      setLoading(false);
    }
  };

  // Run batch personalization for all shortlisted leads
  const handlePersonalizeAllShortlisted = async () => {
    setBatchRunning(true);
    setBatchNotice('Strategist & Copywriter processing all shortlisted prospects...');
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/personalization`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allShortlisted: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch personalization failed.');
      setBatchNotice(`✓ Successfully processed ${data.items?.length || 0} prospects!`);
      await loadPersonalizationData();
      setTimeout(() => setBatchNotice(null), 5000);
    } catch (err) {
      setBatchNotice(null);
      setError(err instanceof Error ? err.message : 'Batch run failed.');
    } finally {
      setBatchRunning(false);
    }
  };

  // Filtered list
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (
        channelFilter !== 'all' &&
        entry.strategy?.recommended_channel !== channelFilter
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (entry.prospect_name || '').toLowerCase();
        const thesis = (entry.strategy?.relevance_thesis || '').toLowerCase();
        const hookText = (entry.strategy?.hooks || []).map((h) => h.fact.toLowerCase()).join(' ');
        if (!name.includes(q) && !thesis.includes(q) && !hookText.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [entries, statusFilter, channelFilter, searchQuery]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.record_id === selectedRecordId) || null,
    [entries, selectedRecordId]
  );

  const activeProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="flex min-h-screen bg-[#08080c] text-white">
      <Sidebar />
      <div className="flex-1 ml-[220px] flex flex-col min-w-0">
        <TopBar />

        <main className="flex-1 px-8 py-6 space-y-6">
          {/* Top Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white/95">Personalized Outreach</h1>
                <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-300">
                  Agent 3 Active
                </span>
              </div>
              <p className="mt-1 text-xs text-white/45">
                Two-model intelligence pipeline: Model 1 extracts grounded evidence hooks, Model 2 writes high-converting copy.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Project selector */}
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs">
                <span className="text-white/40">Campaign:</span>
                <select
                  aria-label="Select campaign project"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="bg-transparent font-medium text-white outline-none cursor-pointer"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-[#111118] text-white">
                      {p.icon} {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Campaign settings */}
              {settings && (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-white/70 hover:bg-white/[0.06] hover:text-white transition"
                >
                  <svg className="w-3.5 h-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Campaign Settings</span>
                </button>
              )}

              {/* Personalize all button */}
              <button
                type="button"
                onClick={handlePersonalizeAllShortlisted}
                disabled={batchRunning}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20 hover:brightness-110 active:scale-95 disabled:opacity-50 transition"
              >
                {batchRunning ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Processing All...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Personalize All Shortlisted</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Batch Notice Toast */}
          {batchNotice && (
            <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.08] p-3 text-xs text-cyan-200 flex items-center justify-between animate-fadeIn">
              <span>{batchNotice}</span>
              <button type="button" onClick={() => setBatchNotice(null)} className="text-white/40 hover:text-white">✕</button>
            </div>
          )}

          {/* Metric Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Total Evaluated</p>
              <h3 className="text-2xl font-bold text-white/90 mt-1">{summary?.total ?? 0}</h3>
              <p className="text-[11px] text-white/35 mt-1">Prospects passed through Agent 3</p>
            </div>

            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.03] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-blue-300/70">Ready Drafts</p>
                {summary && summary.average_qa_score > 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    Avg QA {summary.average_qa_score}%
                  </span>
                )}
              </div>
              <h3 className="text-2xl font-bold text-blue-200 mt-1">{summary?.drafts ?? 0}</h3>
              <p className="text-[11px] text-blue-200/50 mt-1">Grounded and ready to review</p>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-300/70">Approved</p>
              <h3 className="text-2xl font-bold text-emerald-300 mt-1">{summary?.approved ?? 0}</h3>
              <p className="text-[11px] text-emerald-300/50 mt-1">Signed off for sending</p>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-amber-300/70">Needs More Research</p>
              <h3 className="text-2xl font-bold text-amber-300 mt-1">{summary?.needs_more_research ?? 0}</h3>
              <p className="text-[11px] text-amber-200/50 mt-1">Blocked (Missing verified contact)</p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
              <input
                type="text"
                placeholder="Search prospects, hooks, or angles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full max-w-sm rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-white/80 placeholder:text-white/30 outline-none focus:border-cyan-400"
              />

              <select
                aria-label="Filter outreach by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs text-white/70 outline-none"
              >
                <option value="all">All statuses ({entries.length})</option>
                <option value="draft">Ready Drafts ({summary?.drafts ?? 0})</option>
                <option value="approved">Approved ({summary?.approved ?? 0})</option>
                <option value="needs_more_research">Needs Research ({summary?.needs_more_research ?? 0})</option>
              </select>

              <select
                aria-label="Filter outreach by channel"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                className="rounded-xl border border-white/[0.08] bg-[#111118] px-3 py-2 text-xs text-white/70 outline-none"
              >
                <option value="all">All channels</option>
                <option value="email">Email</option>
                <option value="linkedin">LinkedIn</option>
                <option value="phone">Phone Call</option>
                <option value="contact_form">Contact Form</option>
              </select>
            </div>

            <button
              type="button"
              onClick={loadPersonalizationData}
              className="text-xs text-white/40 hover:text-white/80 flex items-center gap-1.5 transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {/* Master-Detail Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Prospect List (4 cols) */}
            <div className="lg:col-span-4 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  Prospects ({filteredEntries.length})
                </span>
                <span className="text-[11px] text-white/30">Select to review draft</span>
              </div>

              {loading && (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-xs text-white/40">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent mx-auto mb-2" />
                  Loading prospects...
                </div>
              )}

              {!loading && filteredEntries.length === 0 && (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 text-center space-y-2">
                  <p className="text-xs text-white/45">No outreach entries match these filters.</p>
                  <p className="text-[11px] text-white/30">
                    Go to the Research page, review leads, and click &ldquo;Personalize&rdquo; or click &ldquo;Personalize All Shortlisted&rdquo; above.
                  </p>
                </div>
              )}

              <div className="space-y-2 max-h-[calc(100vh-360px)] overflow-y-auto pr-1">
                {filteredEntries.map((entry) => {
                  const isSelected = entry.record_id === selectedRecordId;
                  const primaryHook = entry.strategy?.hooks?.find((h) => h.id === entry.strategy?.primary_hook_id) || entry.strategy?.hooks?.[0];

                  return (
                    <div
                      key={entry.record_id}
                      onClick={() => setSelectedRecordId(entry.record_id)}
                      className={`cursor-pointer rounded-2xl border p-4 transition text-xs space-y-2.5 ${
                        isSelected
                          ? 'border-cyan-500/50 bg-cyan-500/[0.08] shadow-lg shadow-cyan-500/10'
                          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-white/95 text-sm">{entry.prospect_name}</h4>
                          <p className="text-[11px] text-white/40 capitalize">{entry.target_type}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                            entry.status === 'approved'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : entry.status === 'draft'
                              ? 'bg-blue-500/15 text-blue-300'
                              : entry.status === 'needs_more_research'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {entry.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* Primary hook or reason */}
                      {primaryHook ? (
                        <p className="line-clamp-2 text-[11px] text-white/60 leading-relaxed">
                          <span className="text-cyan-300/80 font-medium">Hook:</span> {primaryHook.fact}
                        </p>
                      ) : entry.strategy?.readiness_reason ? (
                        <p className="line-clamp-2 text-[11px] text-amber-200/70 leading-relaxed italic">
                          {entry.strategy.readiness_reason}
                        </p>
                      ) : null}

                      {/* Quick Contact Route Pill */}
                      {entry.strategy?.contact_audit?.best_contact_target && (
                        <div className="flex items-center justify-between text-[11px] bg-black/40 border border-white/[0.04] rounded-lg px-2.5 py-1 text-white/70">
                          <span className="truncate max-w-[210px] font-mono text-[10px] text-cyan-200 select-all">
                            {entry.strategy.contact_audit.best_channel === 'email' ? '✉️ ' : entry.strategy.contact_audit.best_channel === 'linkedin' ? '💼 ' : entry.strategy.contact_audit.best_channel === 'phone' ? '📞 ' : '🌐 '}
                            {entry.strategy.contact_audit.best_contact_target}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(entry.strategy!.contact_audit!.best_contact_target);
                              setCopiedTargetId(`card-${entry.record_id}`);
                              setTimeout(() => setCopiedTargetId(null), 1500);
                            }}
                            className="text-white/40 hover:text-cyan-300 ml-1 text-[10px] shrink-0 font-medium"
                            title="Copy contact"
                          >
                            {copiedTargetId === `card-${entry.record_id}` ? '✓' : '📋'}
                          </button>
                        </div>
                      )}

                      {/* Bottom row pills */}
                      <div className="flex items-center justify-between text-[10px] text-white/40 pt-1 border-t border-white/[0.04]">
                        <span className="capitalize">
                          {entry.strategy?.recommended_channel ? `Channel: ${entry.strategy.recommended_channel}` : 'Evaluating'}
                        </span>
                        {entry.qa && (
                          <span className={entry.qa.score >= 75 ? 'text-emerald-300' : 'text-amber-300'}>
                            QA {entry.qa.score}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Active Prospect Outreach Detail (8 cols) */}
            <div className="lg:col-span-8">
              {selectedEntry ? (
                <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c12] p-6 shadow-2xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.06]">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold text-white/95">{selectedEntry.prospect_name}</h2>
                        {selectedEntry.strategy?.contact_audit?.is_direct_contact ? (
                          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            ✓ Direct 1-to-1
                          </span>
                        ) : selectedEntry.strategy?.contact_audit ? (
                          <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                            🏢 Team / Inbox
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-white/40 mt-0.5">
                        Campaign: {activeProject?.name || 'Active Campaign'} · Target: {selectedEntry.target_type}
                      </p>
                    </div>

                    {/* Quick Dispatch Toolbar in Header */}
                    {selectedEntry.strategy?.contact_audit?.best_contact_target && (
                      <div className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-[#121624] px-3 py-1.5 text-xs shadow-sm">
                        <span className="text-cyan-300 text-[11px] font-medium flex items-center gap-1.5">
                          <span>{selectedEntry.strategy.contact_audit.best_channel === 'email' ? '✉️' : selectedEntry.strategy.contact_audit.best_channel === 'linkedin' ? '💼' : '🌐'}</span>
                          <span className="font-mono text-white/90 truncate max-w-[220px] select-all font-semibold">
                            {selectedEntry.strategy.contact_audit.best_contact_target}
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedEntry.strategy!.contact_audit!.best_contact_target);
                            setCopiedTargetId('header-target');
                            setTimeout(() => setCopiedTargetId(null), 1500);
                          }}
                          className="rounded-lg border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-[10px] text-cyan-300 hover:bg-white/[0.1] transition font-medium"
                        >
                          {copiedTargetId === 'header-target' ? '✓ Copied' : '📋 Copy'}
                        </button>

                        {selectedEntry.strategy.contact_audit.best_contact_target.includes('@') && (
                          <a
                            href={`mailto:${selectedEntry.strategy.contact_audit.best_contact_target}`}
                            className="rounded-lg bg-cyan-500/20 px-2 py-0.5 text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/30 transition flex items-center gap-0.5"
                          >
                            <span>Mailto</span>
                            <span>↗</span>
                          </a>
                        )}

                        {selectedEntry.strategy.contact_audit.best_contact_target.startsWith('http') && (
                          <a
                            href={selectedEntry.strategy.contact_audit.best_contact_target}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg bg-cyan-500/20 px-2 py-0.5 text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/30 transition flex items-center gap-0.5"
                          >
                            <span>Open</span>
                            <span>↗</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <PersonalizationPanel
                    key={selectedEntry.record_id}
                    projectId={selectedProjectId}
                    recordId={selectedEntry.record_id}
                    prospectName={selectedEntry.prospect_name}
                    initialEntry={selectedEntry}
                    onUpdated={(updated) => {
                      setEntries((prev) =>
                        prev.map((e) => (e.record_id === updated.record_id ? updated : e))
                      );
                    }}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-16 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.04] mx-auto flex items-center justify-center text-white/20">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-medium text-white/80">Select a Prospect</h3>
                  <p className="text-xs text-white/40 max-w-sm mx-auto">
                    Choose a prospect from the list on the left to inspect Model 1&apos;s strategic dossier, review copy variations, make edits, and approve outreach.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Campaign Settings Modal */}
      {settings && (
        <CampaignSettingsModal
          projectId={selectedProjectId}
          initialSettings={settings}
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSaved={(newSettings) => setSettings(newSettings)}
        />
      )}
    </div>
  );
}