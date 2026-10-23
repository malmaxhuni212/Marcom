'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatedFetch } from '@/auth/client';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';
import { PageFrame, ProjectGate } from '../AppShell';
import { useWorkspace } from '../WorkspaceContext';
import DraftsDrawer from '../DraftsDrawer';
import {
  FitList,
  MoreResearchDialog,
  SourcesList,
  VerificationCard,
  saveDecision,
  useClipboard,
} from '../prospect-parts';
import {
  Dialog,
  EmptyState,
  Icon,
  Initials,
  Pill,
  btnDanger,
  btnPrimary,
  btnSecondary,
  serif,
} from '../ui';
import {
  STATUS_META,
  contactSummary,
  contactsOf,
  hostOf,
  locationOf,
  plural,
  prospectName,
  reviewStatus,
  shortDate,
  targetFor,
  verificationOf,
  type DraftChannel,
} from '../format';

type TabId = 'all' | 'needs_review' | 'shortlisted' | 'enrichment_requested' | 'rejected';
type SortOrder = 'newest' | 'verified' | 'name';

interface FilterState {
  entityKind: 'all' | 'person' | 'organisation';
  targetId: string | null;
  runDate: string | null;
  location: string | null;
  verifiedOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  entityKind: 'all',
  targetId: null,
  runDate: null,
  location: null,
  verifiedOnly: false,
};

export default function ProspectsView() {
  return (
    <ProjectGate>
      <ProspectsBody />
    </ProjectGate>
  );
}

function ProspectsBody() {
  const router = useRouter();
  const {
    bundle,
    activeProject,
    reload,
    openResearch,
    globalSearch,
    setGlobalSearch,
  } = useWorkspace();

  const [tab, setTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [personalising, setPersonalising] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drawerState, setDrawerState] = useState<{ draft: PersonalizationEntry; channel?: DraftChannel } | null>(null);

  // Sync URL query params (?tab=approved, ?id=...) on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'approved' || tabParam === 'shortlisted') setTab('shortlisted');
    else if (tabParam === 'review' || tabParam === 'needs_review') setTab('needs_review');
    else if (tabParam === 'more' || tabParam === 'enrichment_requested') setTab('enrichment_requested');
    else if (tabParam === 'rejected') setTab('rejected');
    const idParam = params.get('id');
    if (idParam) setSelectedId(idParam);
  }, []);

  if (!bundle) return null;
  const { project, research, drafts, projectId } = bundle;
  const brief = project.structured_brief;
  const title = brief?.project.name || project.name || activeProject?.name || 'Untitled project';

  const draftByRecordId = useMemo(() => {
    const map = new Map<string, PersonalizationEntry>();
    for (const item of drafts) map.set(item.record_id, item);
    return map;
  }, [drafts]);

  // Distinct research dates and locations for the Filters dialog
  const runDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of research) {
      const label = shortDate(entry.record.researched_at);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [research]);

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const entry of research) {
      const loc = entry.record.country || entry.record.location;
      if (loc) set.add(loc);
    }
    return [...set];
  }, [research]);

  // Counts per status tab
  const counts = useMemo(() => {
    const map: Record<TabId, number> = {
      all: research.length,
      needs_review: 0,
      shortlisted: 0,
      enrichment_requested: 0,
      rejected: 0,
    };
    for (const entry of research) {
      const status = reviewStatus(entry);
      map[status] = (map[status] ?? 0) + 1;
    }
    return map;
  }, [research]);

  const approvedEntries = useMemo(
    () => research.filter((entry) => reviewStatus(entry) === 'shortlisted'),
    [research],
  );

  // Default all approved prospects to checked when none have been toggled yet
  useEffect(() => {
    setCheckedIds((current) => {
      const next = { ...current };
      let changed = false;
      for (const entry of approvedEntries) {
        if (!(entry.record.record_id in next)) {
          next[entry.record.record_id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [approvedEntries]);

  const effectiveQuery = (search || globalSearch).trim().toLowerCase();

  const matchesFilters = (entry: ResearchEntry, state: FilterState): boolean => {
    if (state.entityKind !== 'all' && entry.record.identity.entity_kind !== state.entityKind) return false;
    if (state.targetId) {
      const target = targetFor(brief, entry);
      if (target?.id !== state.targetId && entry.record.brief_target_id !== state.targetId) return false;
    }
    if (state.runDate && shortDate(entry.record.researched_at) !== state.runDate) return false;
    if (state.location) {
      const loc = `${entry.record.location ?? ''} ${entry.record.country ?? ''}`.toLowerCase();
      if (!loc.includes(state.location.toLowerCase())) return false;
    }
    if (state.verifiedOnly && verificationOf(entry).state === 'unverified') return false;
    return true;
  };

  const visible = useMemo(() => {
    const filtered = research.filter((entry) => {
      const status = reviewStatus(entry);
      if (tab !== 'all' && status !== tab) return false;
      if (!matchesFilters(entry, filters)) return false;
      if (effectiveQuery) {
        const hay = `${prospectName(entry)} ${entry.record.summary ?? ''} ${locationOf(entry) ?? ''} ${entry.record.target_type ?? ''}`.toLowerCase();
        if (!hay.includes(effectiveQuery)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return prospectName(a).localeCompare(prospectName(b));
      if (sort === 'verified') {
        const rank = { verified: 0, partial: 1, unverified: 2 };
        const diff = rank[verificationOf(a).state] - rank[verificationOf(b).state];
        if (diff !== 0) return diff;
      }
      return (b.record.researched_at || '').localeCompare(a.record.researched_at || '');
    });
  }, [research, tab, filters, effectiveQuery, sort, brief]);

  const selectedEntry = useMemo(
    () => (selectedId ? research.find((entry) => entry.record.record_id === selectedId) ?? null : null),
    [research, selectedId],
  );
  const hasPanel = Boolean(selectedEntry);

  const selectedApprovedIds = useMemo(
    () => approvedEntries.filter((entry) => checkedIds[entry.record.record_id]).map((entry) => entry.record.record_id),
    [approvedEntries, checkedIds],
  );
  const allApprovedChecked = approvedEntries.length > 0 && selectedApprovedIds.length === approvedEntries.length;

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (filters.entityKind !== 'all') {
      chips.push({
        key: 'entityKind',
        label: `Type: ${filters.entityKind === 'person' ? 'People' : 'Organisations'}`,
        clear: () => setFilters((f) => ({ ...f, entityKind: 'all' })),
      });
    }
    if (filters.targetId) {
      const target = brief?.targets.find((item) => item.id === filters.targetId);
      chips.push({
        key: 'targetId',
        label: `Audience: ${target?.target_type ?? 'Selected'}`,
        clear: () => setFilters((f) => ({ ...f, targetId: null })),
      });
    }
    if (filters.runDate) {
      chips.push({
        key: 'runDate',
        label: `Run: ${filters.runDate}`,
        clear: () => setFilters((f) => ({ ...f, runDate: null })),
      });
    }
    if (filters.location) {
      chips.push({
        key: 'location',
        label: `Location: ${filters.location}`,
        clear: () => setFilters((f) => ({ ...f, location: null })),
      });
    }
    if (filters.verifiedOnly) {
      chips.push({
        key: 'verifiedOnly',
        label: 'Verified evidence only',
        clear: () => setFilters((f) => ({ ...f, verifiedOnly: false })),
      });
    }
    if (globalSearch.trim()) {
      chips.push({
        key: 'globalSearch',
        label: `Search: "${globalSearch.trim()}"`,
        clear: () => setGlobalSearch(''),
      });
    }
    return chips;
  }, [filters, brief, globalSearch, setGlobalSearch]);

  const runPersonalise = async (recordIds: string[], openDrawerAfter = false) => {
    if (!recordIds.length || personalising) return;
    setPersonalising(true);
    setActionError(null);
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
      if (!response.ok) throw new Error(data.error || 'Personalisation could not be completed.');
      await reload();
      if (openDrawerAfter && recordIds.length === 1 && data.entry) {
        setDrawerState({ draft: data.entry as PersonalizationEntry });
      } else {
        router.push('/outreach?just=yes');
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPersonalising(false);
    }
  };

  const tabDefs: Array<{ id: TabId; label: string; dot?: boolean }> = [
    { id: 'all', label: `All · ${counts.all}` },
    { id: 'needs_review', label: `To review · ${counts.needs_review}` },
    { id: 'shortlisted', label: `Approved · ${counts.shortlisted}`, dot: true },
    { id: 'enrichment_requested', label: `More research · ${counts.enrichment_requested}` },
    { id: 'rejected', label: `Rejected · ${counts.rejected}` },
  ];

  const isApprovedTab = tab === 'shortlisted';
  const showHint = tab === 'all' && counts.shortlisted > 0 && !hasPanel;

  return (
    <div className="relative flex min-w-0 flex-1 flex-wrap">
      <div className="min-w-0 flex-[1_1_520px]">
        <PageFrame className="max-w-[1160px] gap-5">
          <header className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
              <h1 className={`${serif} m-0 text-[32px]`}>Prospects</h1>
              <p className="m-0 text-sm text-[#A7ADB8]">{title}</p>
            </div>
            <button type="button" onClick={() => openResearch()} className={`${btnPrimary} h-11 px-[18px]`}>
              <Icon name="plus" size={16} stroke={2.2} /> Find more prospects
            </button>
          </header>

          {/* Status tabs */}
          <div role="tablist" aria-label="Status" className="flex flex-wrap gap-2">
            {tabDefs.map((item) => {
              const on = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(item.id)}
                  className={`inline-flex h-[38px] items-center gap-[7px] rounded-full border px-4 text-[13px] transition-colors ${
                    on
                      ? 'border-[#F1F2F4] bg-[#F1F2F4] font-semibold text-[#0E1014]'
                      : 'border-[#2A2F39] bg-[#171A20] font-medium text-[#F1F2F4] hover:border-[#3A3F4A]'
                  }`}
                >
                  {item.dot && <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[#5BD69A]" />}
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Search + Filters + Sort */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-11 flex-[1_1_260px] items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] px-3.5 text-[#8A909C] focus-within:border-[#2E6B75]">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or bio"
                aria-label="Search prospects"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#F1F2F4] outline-none placeholder:text-[#8A909C]"
              />
            </label>
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] px-4 text-sm font-semibold text-[#F1F2F4] hover:border-[#3A3F4A]"
            >
              <Icon name="filter" size={16} />
              Filters
              {activeFilterChips.length > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#5ED3DF] px-1 text-[11px] font-bold text-[#0E1014]">
                  {activeFilterChips.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                setSort((current) => (current === 'newest' ? 'verified' : current === 'verified' ? 'name' : 'newest'))
              }
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#2A2F39] bg-[#171A20] pl-4 pr-3.5 text-sm font-medium text-[#F1F2F4] hover:border-[#3A3F4A]"
            >
              {sort === 'newest' ? 'Newest first' : sort === 'verified' ? 'Verified first' : 'Name A–Z'}
              <Icon name="chevronDown" size={16} className="text-[#A7ADB8]" />
            </button>
          </div>

          {/* Active filter chips */}
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {activeFilterChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-lg bg-[#12313A] pl-2.5 pr-1.5 text-[#9BE6EE]"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`Remove ${chip.label} filter`}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded text-[#9BE6EE] hover:bg-[#1E4A52]"
                  >
                    <Icon name="close" size={12} stroke={2.6} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setSearch('');
                  setGlobalSearch('');
                }}
                className="h-[30px] px-2 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Green hint banner on All tab */}
          {showHint && (
            <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#1F4A33] bg-[#10261B] py-3 pl-4 pr-3.5">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#5BD69A]" />
              <span className="flex-[1_1_260px] text-sm text-[#B7D9C6]">
                <span className="font-semibold text-[#8EE6B6]">
                  {plural(counts.shortlisted, 'approved prospect')} {counts.shortlisted === 1 ? 'is' : 'are'} ready to personalise.
                </span>{' '}
                Personalising writes their drafts and moves them to Outreach.
              </span>
              <button
                type="button"
                onClick={() => setTab('shortlisted')}
                className="h-9 rounded-[10px] border border-[#2F6B4B] bg-transparent px-3.5 text-[13px] font-semibold text-[#8EE6B6] hover:bg-[#153324]"
              >
                View approved
              </button>
            </div>
          )}

          {/* Approved tab personalisation bar */}
          {isApprovedTab && counts.shortlisted > 0 && (
            <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-[#2A2F39] bg-[#171A20] px-4 py-3.5">
              <div className="flex flex-[1_1_320px] flex-col gap-[3px]">
                <span className="text-[15px] font-semibold text-[#F1F2F4]">
                  Ready for personalisation · {selectedApprovedIds.length} of {counts.shortlisted} selected
                </span>
                <span className="text-[13px] leading-snug text-[#A7ADB8]">
                  We&apos;ll write a personalised draft for every channel from each prospect&apos;s verified facts, your brief and your account details. Then they move to Outreach, where you check and copy them.
                </span>
              </div>
              <button
                type="button"
                disabled={selectedApprovedIds.length === 0 || personalising}
                onClick={() => void runPersonalise(selectedApprovedIds)}
                className={`inline-flex h-[46px] items-center gap-2 rounded-xl px-5 text-sm font-semibold transition-opacity ${
                  selectedApprovedIds.length > 0
                    ? 'bg-[#F1F2F4] text-[#0E1014] hover:opacity-95'
                    : 'cursor-not-allowed bg-[#22262E] text-[#8A909C]'
                }`}
              >
                <Icon name="sparkle" size={16} />
                {personalising
                  ? 'Writing drafts…'
                  : selectedApprovedIds.length > 0
                    ? `Personalise ${selectedApprovedIds.length}`
                    : 'Select prospects'}
              </button>
            </div>
          )}

          {actionError && (
            <p role="alert" className="m-0 rounded-xl border border-[#5A2D29] bg-[#2A1715] px-4 py-3 text-sm text-[#F7B1AA]">
              {actionError}
            </p>
          )}

          {/* Prospects table */}
          {visible.length === 0 ? (
            <EmptyState
              title={research.length === 0 ? 'No prospects found yet' : 'No prospects match these filters'}
              body={
                research.length === 0
                  ? 'Run the Research agent to find prospects that match your campaign brief.'
                  : 'Try clearing a filter or switching to the All tab.'
              }
              action={
                research.length === 0 ? (
                  <button type="button" onClick={() => openResearch()} className={btnPrimary}>
                    <Icon name="search" size={16} /> Run research
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTab('all');
                      setFilters(DEFAULT_FILTERS);
                      setSearch('');
                      setGlobalSearch('');
                    }}
                    className={btnSecondary}
                  >
                    Reset filters
                  </button>
                )
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-[18px] border border-[#2A2F39] bg-[#171A20]">
                <table
                  style={{ minWidth: hasPanel ? 560 : 900 }}
                  className="w-full border-collapse text-sm"
                >
                  <thead>
                    <tr className="text-left text-xs text-[#A7ADB8]">
                      {isApprovedTab && (
                        <th scope="col" className="w-11 border-b border-[#2A2F39] py-2 pl-3.5 pr-0">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={allApprovedChecked}
                            aria-label="Select all approved"
                            onClick={() =>
                              setCheckedIds(
                                Object.fromEntries(
                                  approvedEntries.map((entry) => [entry.record.record_id, !allApprovedChecked]),
                                ),
                              )
                            }
                            className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border-[1.5px] p-0 text-[#0E1014] ${
                              allApprovedChecked ? 'border-[#5BD69A] bg-[#5BD69A]' : 'border-[#4A505C] bg-transparent'
                            }`}
                          >
                            {allApprovedChecked && <Icon name="check" size={13} stroke={3.2} />}
                          </button>
                        </th>
                      )}
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Prospect
                      </th>
                      {!hasPanel && (
                        <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                          Type
                        </th>
                      )}
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Location
                      </th>
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Evidence
                      </th>
                      {!hasPanel && (
                        <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                          Contact found
                        </th>
                      )}
                      <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => {
                      const id = entry.record.record_id;
                      const name = prospectName(entry);
                      const status = reviewStatus(entry);
                      const statusMeta = STATUS_META[status];
                      const verification = verificationOf(entry);
                      const isSelected = selectedEntry?.record.record_id === id;
                      const checked = Boolean(checkedIds[id]);
                      const draft = draftByRecordId.get(id);
                      const entityLabel =
                        entry.record.identity.entity_kind === 'person'
                          ? 'Person'
                          : entry.record.identity.entity_kind === 'organisation'
                            ? 'Organisation'
                            : '—';

                      return (
                        <tr
                          key={id}
                          onClick={() => setSelectedId(id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-[#1F232B]' : 'hover:bg-[#1B1F27]'
                          }`}
                        >
                          {isApprovedTab && (
                            <td
                              onClick={(event) => event.stopPropagation()}
                              className="w-11 border-b border-[#22262E] pl-3.5 pr-0"
                            >
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={checked}
                                aria-label={`Select ${name}`}
                                onClick={() => setCheckedIds((curr) => ({ ...curr, [id]: !checked }))}
                                className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border-[1.5px] p-0 text-[#0E1014] ${
                                  checked ? 'border-[#5BD69A] bg-[#5BD69A]' : 'border-[#4A505C] bg-transparent'
                                }`}
                              >
                                {checked && <Icon name="check" size={13} stroke={3.2} />}
                              </button>
                            </td>
                          )}
                          <td
                            style={{ boxShadow: isSelected ? 'inset 3px 0 0 #5ED3DF' : 'none' }}
                            className="border-b border-[#22262E] px-4 py-3.5"
                          >
                            <div className="flex items-center gap-3 text-[#F1F2F4]">
                              <Initials name={name} size={36} />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate font-semibold">{name}</span>
                                <span className="text-xs text-[#8A909C]">
                                  {entry.record.researched_at ? `Found ${shortDate(entry.record.researched_at)}` : entry.record.target_type}
                                </span>
                              </span>
                            </div>
                          </td>
                          {!hasPanel && (
                            <td className="border-b border-[#22262E] px-[18px] py-3.5 text-[#C9CDD4]">
                              {entityLabel}
                            </td>
                          )}
                          <td className="border-b border-[#22262E] px-[18px] py-3.5 text-[#C9CDD4]">
                            {locationOf(entry) || '—'}
                          </td>
                          <td
                            style={{ color: verification.color }}
                            className="border-b border-[#22262E] px-[18px] py-3.5 font-medium"
                          >
                            {verification.label}
                          </td>
                          {!hasPanel && (
                            <td className="border-b border-[#22262E] px-4 py-3.5 text-[#C9CDD4]">
                              {contactSummary(entry)}
                            </td>
                          )}
                          <td className="border-b border-[#22262E] px-[18px] py-3.5">
                            <div className="flex items-center gap-2">
                              <Pill bg={statusMeta.bg} fg={statusMeta.fg}>
                                {statusMeta.label}
                              </Pill>
                              {draft?.copy && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDrawerState({ draft });
                                  }}
                                  className="rounded-full bg-[#26224A] px-2.5 py-1 text-[11px] font-semibold text-[#CFC8FF] hover:bg-[#322D5E]"
                                >
                                  Drafts
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between text-[13px] text-[#8A909C]">
                <span>
                  Showing {visible.length} of {research.length}
                </span>
              </div>
            </>
          )}
        </PageFrame>
      </div>

      {/* Right-hand prospect detail panel */}
      {selectedEntry && (
        <ProspectDetailPanel
          key={selectedEntry.record.record_id}
          entry={selectedEntry}
          index={visible.findIndex((item) => item.record.record_id === selectedEntry.record.record_id)}
          total={visible.length}
          projectId={projectId}
          brief={brief}
          draft={draftByRecordId.get(selectedEntry.record.record_id) ?? null}
          personalising={personalising}
          onClose={() => setSelectedId(null)}
          onNavigate={(delta) => {
            const idx = visible.findIndex((item) => item.record.record_id === selectedEntry.record.record_id);
            const next = visible[idx + delta];
            if (next) setSelectedId(next.record.record_id);
          }}
          onSaved={reload}
          onPersonalise={() => void runPersonalise([selectedEntry.record.record_id], true)}
          onOpenDrafts={(channel) => {
            const draft = draftByRecordId.get(selectedEntry.record.record_id);
            if (draft) setDrawerState({ draft, channel });
          }}
        />
      )}

      {/* Filters modal */}
      {filtersOpen && (
        <FiltersDialog
          initial={filters}
          targets={brief?.targets ?? []}
          runDates={runDates}
          locations={locations}
          countPreview={(candidate) => research.filter((entry) => matchesFilters(entry, candidate)).length}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setFiltersOpen(false);
          }}
        />
      )}

      {/* Drafted messages drawer */}
      {drawerState && (
        <DraftsDrawer
          draft={drawerState.draft}
          initialChannel={drawerState.channel}
          onClose={() => setDrawerState(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Right-hand Prospect Detail Panel (DProspectDetail)                  */
/* ------------------------------------------------------------------ */

function ProspectDetailPanel({
  entry,
  index,
  total,
  projectId,
  brief,
  draft,
  personalising,
  onClose,
  onNavigate,
  onSaved,
  onPersonalise,
  onOpenDrafts,
}: {
  entry: ResearchEntry;
  index: number;
  total: number;
  projectId: string;
  brief: NonNullable<ReturnType<typeof useWorkspace>['bundle']>['project']['structured_brief'];
  draft: PersonalizationEntry | null;
  personalising: boolean;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
  onSaved: () => Promise<void>;
  onPersonalise: () => void;
  onOpenDrafts: (channel?: DraftChannel) => void;
}) {
  const [note, setNote] = useState(entry.review?.note ?? '');
  const [noteSaved, setNoteSaved] = useState(Boolean(entry.review?.note));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreResearchOpen, setMoreResearchOpen] = useState(false);
  const { copied, copy } = useClipboard();

  const name = prospectName(entry);
  const status = reviewStatus(entry);
  const statusMeta = STATUS_META[status];
  const verification = verificationOf(entry);
  const contacts = contactsOf(entry);
  const isApproved = status === 'shortlisted';
  const hasDraft = Boolean(draft?.copy);

  const entityLabel =
    entry.record.identity.entity_kind === 'person'
      ? 'Person'
      : entry.record.identity.entity_kind === 'organisation'
        ? 'Organisation'
        : null;
  const metaParts = [entityLabel, locationOf(entry) || (entry.record.researched_at ? `Found ${shortDate(entry.record.researched_at)}` : null)].filter(Boolean);

  const commitDecision = async (nextStatus: ReviewStatus, customNote?: string) => {
    const finalNote = customNote !== undefined ? customNote : note;
    if (nextStatus === 'rejected' && !finalNote.trim()) {
      setError('Add a short note before rejecting so your team knows why.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveDecision(projectId, entry.record.record_id, nextStatus, finalNote);
      setNoteSaved(true);
      setMoreResearchOpen(false);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const contactItems: Array<{
    key: string;
    value: string | null;
    missingLabel: string;
    sub: string;
    channel: DraftChannel;
  }> = [
    {
      key: 'email',
      value: contacts.email,
      missingLabel: 'Email not found',
      sub: contacts.email ? 'Email' : 'Not found by research',
      channel: 'email',
    },
    {
      key: 'linkedin',
      value: contacts.linkedin ? hostOf(contacts.linkedin) : null,
      missingLabel: 'LinkedIn not found',
      sub: contacts.linkedin ? 'LinkedIn' : 'Not found by research',
      channel: 'linkedin',
    },
    {
      key: 'website',
      value: contacts.contactForm || contacts.website ? hostOf((contacts.contactForm || contacts.website)!) : null,
      missingLabel: 'Website not found',
      sub: contacts.contactForm
        ? 'Website · contact form found'
        : contacts.website
          ? 'Website'
          : 'Not found by research',
      channel: 'follow_up',
    },
  ];

  return (
    <aside
      aria-label={name}
      className="flex min-h-[calc(100vh-72px)] w-full max-w-full flex-[0_1_460px] flex-col border-l border-[#22262E] bg-[#12151A]"
    >
      {/* Top navigation bar */}
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <span className="text-xs font-semibold tracking-[0.14em] text-[#5ED3DF]">
          PROSPECT {index >= 0 ? index + 1 : 1} OF {Math.max(total, 1)}
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => onNavigate(-1)}
            aria-label="Previous prospect"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] disabled:opacity-40"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            disabled={index < 0 || index >= total - 1}
            onClick={() => onNavigate(1)}
            aria-label="Next prospect"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] disabled:opacity-40"
          >
            <Icon name="chevronRight" size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4]"
          >
            <Icon name="close" size={14} stroke={2.2} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-6 pb-5 pt-2">
        <div className="flex flex-col gap-1.5">
          <h2 className={`${serif} m-0 text-[30px] leading-[1.1]`}>{name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#A7ADB8]">
            <span>{metaParts.join(' · ') || 'Found by research'}</span>
            <Pill bg={statusMeta.bg} fg={statusMeta.fg}>
              {statusMeta.label}
            </Pill>
          </div>
        </div>

        <VerificationCard entry={entry} brief={brief} />

        {/* About */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">About</h3>
          <p
            className={`m-0 text-sm leading-[1.55] ${
              entry.record.summary ? 'text-[#D5D8DE]' : 'text-[#8A909C]'
            }`}
          >
            {entry.record.summary || 'No profile summary yet. More research would fill this in.'}
          </p>
        </section>

        {/* Sources */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">
            Sources · {entry.record.sources.length}
          </h3>
          <SourcesList entry={entry} />
        </section>

        {/* Fit with your criteria */}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">Fit with your criteria</h3>
          <FitList entry={entry} />
        </section>

        {/* Contact */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-[13px] font-semibold text-[#A7ADB8]">Contact</h3>
            {hasDraft && (
              <button
                type="button"
                onClick={() => onOpenDrafts('email')}
                className="h-8 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
              >
                All drafts · 3
              </button>
            )}
          </div>
          <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#2A2F39] bg-[#171A20]">
            {contactItems.map((item) => (
              <div
                key={item.key}
                className="flex min-h-[52px] items-center gap-2 border-b border-[#22262E] pl-3.5 pr-2 last:border-b-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px py-2.5">
                  <span
                    className={`truncate text-sm ${
                      item.value ? 'text-[#5ED3DF]' : 'text-[#A7ADB8]'
                    }`}
                  >
                    {item.value || item.missingLabel}
                  </span>
                  <span
                    className={`text-xs ${
                      item.value ? 'text-[#8A909C]' : 'text-[#F2C36B]'
                    }`}
                  >
                    {item.sub}
                  </span>
                </span>
                {item.value && (
                  <button
                    type="button"
                    onClick={() => void copy(item.value!, item.key)}
                    aria-label={`Copy ${item.key}`}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-[#A7ADB8] hover:bg-[#1F232B] hover:text-[#F1F2F4]"
                  >
                    {copied === item.key ? '✓' : <Icon name="copy" size={14} />}
                  </button>
                )}
                {hasDraft && (
                  <button
                    type="button"
                    onClick={() => onOpenDrafts(item.channel)}
                    aria-label={`Open ${item.key} draft`}
                    className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] border-0 bg-[#26224A] text-[#CFC8FF] hover:bg-[#322D5E]"
                  >
                    <Icon name="message" size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="text-xs text-[#8A909C]">
            {hasDraft
              ? 'Click the message icon to view and copy the draft for that channel.'
              : isApproved
                ? 'Personalise this prospect to write drafts from their verified facts.'
                : 'Drafts are written once you approve and personalise this prospect.'}
          </div>
        </section>

        {/* Your note */}
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-[#A7ADB8]">
            <span>
              Your note <span className="font-normal text-[#8A909C]">· for your team, required when rejecting</span>
            </span>
            {noteSaved && (
              <span className="inline-flex items-center gap-1 font-medium text-[#5BD69A]">
                <Icon name="check" size={12} stroke={3} /> Saved
              </span>
            )}
          </span>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteSaved(false);
              if (error) setError(null);
            }}
            placeholder="Notes save with your decision. They don't start any research."
            className="h-[72px] resize-none rounded-xl border border-[#2A2F39] bg-[#171A20] px-3 py-2.5 text-sm text-[#F1F2F4] outline-none placeholder:text-[#5C616B] focus:border-[#2E6B75]"
          />
        </label>

        {error && (
          <p role="alert" className="m-0 text-[13px] text-[#F7B1AA]">
            {error}
          </p>
        )}
      </div>

      {/* Bottom decision bar */}
      <div className="grid grid-cols-[1fr_1.3fr_1.3fr] gap-2 border-t border-[#22262E] px-6 pb-5 pt-3.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => void commitDecision('rejected')}
          className={`${btnDanger} h-[46px] px-3`}
        >
          Reject
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setMoreResearchOpen(true)}
          className={`${
            verification.state === 'unverified' && !isApproved ? btnPrimary : btnSecondary
          } h-[46px] px-3`}
        >
          More research
        </button>
        {isApproved ? (
          hasDraft ? (
            <button
              type="button"
              onClick={() => onOpenDrafts('email')}
              className={`${btnPrimary} h-[46px] px-3`}
            >
              View drafts
            </button>
          ) : (
            <button
              type="button"
              disabled={personalising}
              onClick={onPersonalise}
              className={`${btnPrimary} h-[46px] px-3`}
            >
              {personalising ? 'Writing…' : 'Personalise'}
            </button>
          )
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => void commitDecision('shortlisted')}
            className={`${
              verification.state === 'unverified' ? btnSecondary : btnPrimary
            } h-[46px] px-3`}
          >
            Approve
          </button>
        )}
      </div>

      {moreResearchOpen && (
        <MoreResearchDialog
          prospect={name}
          saving={saving}
          error={error}
          onCancel={() => setMoreResearchOpen(false)}
          onSubmit={(instructions) => void commitDecision('enrichment_requested', instructions)}
        />
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Filters Dialog (DFilters)                                           */
/* ------------------------------------------------------------------ */

function FiltersDialog({
  initial,
  targets,
  runDates,
  locations,
  countPreview,
  onClose,
  onApply,
}: {
  initial: FilterState;
  targets: Array<{ id: string; target_type: string }>;
  runDates: Array<[string, number]>;
  locations: string[];
  countPreview: (state: FilterState) => number;
  onClose: () => void;
  onApply: (state: FilterState) => void;
}) {
  const [draft, setDraft] = useState<FilterState>(initial);
  const matchingCount = countPreview(draft);

  return (
    <Dialog label="Filter prospects" onClose={onClose} width={400}>
      <div className="flex items-center justify-between px-[18px] pb-2 pt-4">
        <h1 className="m-0 text-base font-semibold text-[#F1F2F4]">Filters</h1>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_FILTERS)}
          className="h-8 border-0 bg-transparent px-1.5 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col gap-[18px] px-[18px] pb-4 pt-2">
        {/* Type */}
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-[#A7ADB8]">Type</div>
          <div
            role="group"
            aria-label="Type"
            className="grid grid-cols-3 rounded-xl border border-[#2A2F39] bg-[#0E1014] p-[3px]"
          >
            {(
              [
                ['all', 'All'],
                ['person', 'People'],
                ['organisation', 'Organisations'],
              ] as const
            ).map(([id, label]) => {
              const on = draft.entityKind === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft((curr) => ({ ...curr, entityKind: id }))}
                  className={`h-[34px] rounded-[9px] border-0 text-[13px] ${
                    on ? 'bg-[#2A2F39] font-semibold text-[#F1F2F4]' : 'bg-transparent font-medium text-[#A7ADB8]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Target group */}
        {targets.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-[#A7ADB8]">Target group</div>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((target) => {
                const on = draft.targetId === target.id;
                return (
                  <button
                    key={target.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft((curr) => ({ ...curr, targetId: on ? null : target.id }))
                    }
                    className={`h-[34px] rounded-full border px-3 text-[13px] capitalize ${
                      on
                        ? 'border-[#2E6B75] bg-[#12313A] font-semibold text-[#9BE6EE]'
                        : 'border-[#2A2F39] bg-[#0E1014] font-medium text-[#F1F2F4]'
                    }`}
                  >
                    {target.target_type}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Research run */}
        {runDates.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-[#A7ADB8]">Research run</div>
            <div className="flex flex-wrap gap-1.5">
              {runDates.map(([date, count]) => {
                const on = draft.runDate === date;
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((curr) => ({ ...curr, runDate: on ? null : date }))}
                    className={`h-[34px] rounded-full border px-3 text-[13px] ${
                      on
                        ? 'border-[#2E6B75] bg-[#12313A] font-semibold text-[#9BE6EE]'
                        : 'border-[#2A2F39] bg-[#0E1014] font-medium text-[#F1F2F4]'
                    }`}
                  >
                    {date} · {count}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Location + Verified evidence only */}
        <div className="flex flex-col rounded-[14px] border border-[#2A2F39] bg-[#0E1014]">
          <label className="flex h-[46px] items-center justify-between border-b border-[#2A2F39] px-3.5 text-sm font-medium text-[#F1F2F4]">
            <span>Location</span>
            <select
              value={draft.location ?? ''}
              onChange={(event) =>
                setDraft((curr) => ({ ...curr, location: event.target.value || null }))
              }
              className="border-0 bg-transparent text-right text-sm font-medium text-[#9BE6EE] outline-none"
            >
              <option value="" className="bg-[#171A20] text-[#F1F2F4]">
                All locations
              </option>
              {locations.map((loc) => (
                <option key={loc} value={loc} className="bg-[#171A20] text-[#F1F2F4]">
                  {loc}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-[46px] cursor-pointer items-center justify-between px-3.5 text-sm text-[#F1F2F4]">
            <span>Verified evidence only</span>
            <input
              type="checkbox"
              checked={draft.verifiedOnly}
              onChange={(event) =>
                setDraft((curr) => ({ ...curr, verifiedOnly: event.target.checked }))
              }
              className="h-[18px] w-[18px] accent-[#5ED3DF]"
            />
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-[#2A2F39] px-[18px] pb-4 pt-3">
        <button type="button" onClick={onClose} className={`${btnSecondary} h-10 px-3.5`}>
          Cancel
        </button>
        <button type="button" onClick={() => onApply(draft)} className={`${btnPrimary} h-10 px-4`}>
          Show {plural(matchingCount, 'prospect')}
        </button>
      </div>
    </Dialog>
  );
}
