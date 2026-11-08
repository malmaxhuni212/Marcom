'use client';

/**
 * Workspace state shared by every MARCOM screen:
 *  - the project list and the active project (remembered per browser),
 *  - the active project's data bundle (campaign, research, drafts, outreach settings),
 *  - guest vs team session mode and live guest daily/monthly quota state,
 *  - background research runs, which keep polling even when their dialog is closed.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  authenticatedFetch,
  getLatestGuestQuota,
  refreshGuestSessionAndQuota,
  setClientAccessMode,
  subscribeGuestQuota,
} from '@/auth/client';
import type { PageAccessContext } from '@/auth/page-access';
import type { GuestQuotaSnapshot } from '@/db/repositories/guest-quota-repository';
import { clearAllGuestProjects } from '@/lib/guest-storage';
import type { ProjectMemory } from '@/marcom/memory/types';
import { summarizeResearch, type ResearchReviewSummary } from '@/marcom/research/review';
import type {
  PersonalizationEntry,
  PersonalizationSettings,
} from '@/marcom/schemas/personalization';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import type { Project } from '@/types';

const ACTIVE_PROJECT_KEY = 'marcom_active_project';

export interface ProjectBundle {
  projectId: string;
  project: ProjectMemory;
  research: ResearchEntry[];
  summary: ResearchReviewSummary;
  drafts: PersonalizationEntry[];
  settings: PersonalizationSettings | null;
}

export interface ResearchRun {
  projectId: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  message: string;
  taskId: string | null;
  startedAt: number;
}

export interface StartResearchInput {
  targetId: string;
  targetLabel: string;
  count: number;
  name?: string;
  force?: boolean;
  notes?: string;
  organisation?: string;
  role?: string;
  website?: string;
}

interface WorkspaceValue {
  projects: Project[];
  projectsLoaded: boolean;
  projectsError: string | null;
  activeId: string | null;
  activeProject: Project | null;
  setActiveId: (id: string) => void;
  deleteProject: (id: string) => Promise<boolean>;
  bundle: ProjectBundle | null;
  bundleError: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  refreshProjects: () => Promise<Project[]>;
  updateDraft: (entry: PersonalizationEntry) => void;
  updateResearchReview: (recordId: string, status: ReviewStatus, note: string | null) => void;
  setSettings: (settings: PersonalizationSettings) => void;
  researchRun: ResearchRun | null;
  startResearch: (input: StartResearchInput) => Promise<void>;
  stopResearch: () => Promise<void>;
  dismissResearchRun: () => void;
  globalSearch: string;
  setGlobalSearch: (value: string) => void;
  newProjectOpen: boolean;
  openNewProject: () => void;
  closeNewProject: () => void;
  researchDialog: { open: boolean; targetId?: string };
  openResearch: (targetId?: string) => void;
  closeResearch: () => void;
  // Guest & Team access state
  isGuest: boolean;
  userDisplayName: string;
  guestQuota: GuestQuotaSnapshot | null;
  refreshQuota: () => Promise<void>;
  resetGuestWorkspace: () => Promise<void>;
  signOutTeamSession: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>.');
  return value;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await authenticatedFetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data && data.error) || `Request failed (${response.status}).`);
  return data as T;
}

export function WorkspaceProvider({
  children,
  initialAccess,
}: {
  children: ReactNode;
  initialAccess?: PageAccessContext;
}) {
  const existing = useContext(WorkspaceContext);
  if (existing) {
    return <>{children}</>;
  }
  return (
    <WorkspaceProviderRoot initialAccess={initialAccess}>
      {children}
    </WorkspaceProviderRoot>
  );
}

function WorkspaceProviderRoot({
  children,
  initialAccess,
}: {
  children: ReactNode;
  initialAccess?: PageAccessContext;
}) {
  const pathname = usePathname();
  const isPublicAuthRoute = pathname === '/login' || pathname === '/bootstrap';
  const initialIsGuest = initialAccess ? initialAccess.mode === 'guest' : true;
  if (typeof window !== 'undefined') {
    setClientAccessMode(initialIsGuest ? 'guest' : 'team');
  }

  const [isGuest, setIsGuest] = useState<boolean>(initialIsGuest);
  const [userDisplayName, setUserDisplayName] = useState<string>(
    initialAccess?.displayName ?? 'Guest',
  );
  const [guestQuota, setGuestQuota] = useState<GuestQuotaSnapshot | null>(() =>
    getLatestGuestQuota(),
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [researchRun, setResearchRun] = useState<ResearchRun | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [researchDialog, setResearchDialog] = useState<{
    open: boolean;
    targetId?: string;
  }>({ open: false });

  const activeIdRef = useRef<string | null>(null);
  const bundleRef = useRef<ProjectBundle | null>(null);
  const pollRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const lastModeRef = useRef<boolean>(initialIsGuest);

  useEffect(() => {
    return subscribeGuestQuota((updated) => {
      setGuestQuota(updated);
    });
  }, []);

  const refreshQuota = useCallback(async () => {
    try {
      const info = await refreshGuestSessionAndQuota();
      const nextIsGuest = !info.authenticated;
      setIsGuest(nextIsGuest);
      setUserDisplayName(info.displayName);
      if (info.quota) {
        setGuestQuota(info.quota);
      }
      if (lastModeRef.current !== nextIsGuest) {
        lastModeRef.current = nextIsGuest;
        initializedRef.current = false;
      }
    } catch {
      // Ignore transient quota fetch error
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await fetchJson<Project[]>('/api/projects');
      setProjects(list);
      setProjectsError(null);
      return list;
    } catch (error) {
      setProjectsError((error as Error).message);
      return [];
    } finally {
      setProjectsLoaded(true);
    }
  }, []);

  const loadBundle = useCallback(
    async (projectId: string) => {
      try {
        const [detail, personalization] = await Promise.all([
          fetchJson<{
            project: ProjectMemory;
            research?: ResearchEntry[];
            research_summary: ResearchReviewSummary;
          }>(`/api/projects/${projectId}`),
          fetchJson<{
            items?: PersonalizationEntry[];
            settings?: PersonalizationSettings;
          }>(`/api/projects/${projectId}/personalization`).catch(() => null),
        ]);
        if (activeIdRef.current !== projectId) return;
        const nextBundle: ProjectBundle = {
          projectId,
          project: detail.project,
          research: detail.research ?? [],
          summary: detail.research_summary,
          drafts: personalization?.items ?? [],
          settings: personalization?.settings ?? null,
        };
        bundleRef.current = nextBundle;
        setBundle(nextBundle);
        setBundleError(null);
      } catch (error) {
        if (activeIdRef.current !== projectId) return;
        const message = (error as Error).message;
        if (message.toLowerCase().includes('not found')) {
          const list = await refreshProjects();
          const fallback = list.find((p) => p.id !== projectId) ?? list[0];
          if (fallback && fallback.id !== projectId) {
            activeIdRef.current = fallback.id;
            setBundleError(null);
            setActiveIdState(fallback.id);
            try {
              window.localStorage.setItem(ACTIVE_PROJECT_KEY, fallback.id);
            } catch {}
            void loadBundle(fallback.id);
            return;
          }
        }
        setBundleError(message);
      }
    },
    [refreshProjects],
  );

  useEffect(() => {
    if (isPublicAuthRoute) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;

    const requested = new URLSearchParams(window.location.search).get('project');
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
    } catch {
      remembered = null;
    }

    void (async () => {
      await refreshQuota();
      setProjectsError(null);
      setBundleError(null);

      const list = await refreshProjects();
      if (!list.length) {
        activeIdRef.current = null;
        bundleRef.current = null;
        setActiveIdState(null);
        setBundle(null);
        return;
      }
      const chosen =
        [requested, remembered].find(
          (id) => id && list.some((project) => project.id === id),
        ) ?? list[0]!.id;
      activeIdRef.current = chosen;
      setBundleError(null);
      setActiveIdState(chosen);
      try {
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, chosen);
      } catch {}
      void loadBundle(chosen);
    })();
  }, [isPublicAuthRoute, refreshQuota, refreshProjects, loadBundle, isGuest]);

  useEffect(() => {
    if (!activeId || isPublicAuthRoute) return;
    activeIdRef.current = activeId;
    if (bundleRef.current?.projectId === activeId) return;
    void loadBundle(activeId);
  }, [activeId, isPublicAuthRoute, loadBundle]);

  const setActiveId = useCallback((id: string) => {
    activeIdRef.current = id;
    setBundleError(null);
    setActiveIdState(id);
    try {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    } catch {
      // Storage can be unavailable (private mode); the selection still applies for this session.
    }
  }, []);

  const reload = useCallback(async () => {
    setBundleError(null);
    const list = await refreshProjects();
    let id = activeIdRef.current;
    if (list.length > 0 && (!id || !list.some((p) => p.id === id))) {
      id = list[0]!.id;
      activeIdRef.current = id;
      setActiveIdState(id);
      try {
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      } catch {}
    }
    if (!id) return;
    await loadBundle(id);
  }, [loadBundle, refreshProjects]);

  const updateDraft = useCallback((entry: PersonalizationEntry) => {
    setBundle((current) => {
      if (!current || current.projectId !== entry.project_id) return current;
      const exists = current.drafts.some((draft) => draft.record_id === entry.record_id);
      const merged = (draft: PersonalizationEntry) =>
        draft.record_id === entry.record_id
          ? {
              ...entry,
              candidate_contacts: entry.candidate_contacts ?? draft.candidate_contacts,
              strategy: entry.strategy ?? draft.strategy,
            }
          : draft;
      return {
        ...current,
        drafts: exists ? current.drafts.map(merged) : [...current.drafts, entry],
      };
    });
  }, []);

  const updateResearchReview = useCallback(
    (recordId: string, status: ReviewStatus, note: string | null) => {
      setBundle((current) => {
        if (!current) return current;
        const nextResearch = current.research.map((entry) => {
          if (entry.record.record_id !== recordId) return entry;
          return {
            ...entry,
            review: {
              project_id: current.projectId,
              record_id: recordId,
              status,
              note,
              reviewed_at: new Date().toISOString(),
              reviewed_by: entry.review?.reviewed_by ?? 'user',
            },
          };
        });
        const nextSummary = summarizeResearch(nextResearch);
        return { ...current, research: nextResearch, summary: nextSummary };
      });
    },
    [],
  );

  const setSettings = useCallback((settings: PersonalizationSettings) => {
    setBundle((current) => (current ? { ...current, settings } : current));
  }, []);

  const deleteProject = useCallback(
    async (id: string): Promise<boolean> => {
      const response = await authenticatedFetch(
        `/api/projects?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          (data && data.error) || `Failed to delete project (${response.status}).`,
        );
      }

      setProjects((currentProjects) => {
        const remaining = currentProjects.filter((p) => p.id !== id);
        if (activeIdRef.current === id) {
          const next = remaining[0] ?? null;
          if (next) {
            setActiveId(next.id);
          } else {
            activeIdRef.current = null;
            setActiveIdState(null);
            setBundle(null);
            bundleRef.current = null;
            try {
              window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
            } catch {}
          }
        }
        return remaining;
      });

      void refreshProjects();
      return true;
    },
    [setActiveId, refreshProjects],
  );

  const resetGuestWorkspace = useCallback(async () => {
    await clearAllGuestProjects();
    activeIdRef.current = null;
    bundleRef.current = null;
    setActiveIdState(null);
    setBundle(null);
    setProjects([]);
    try {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {}
  }, []);

  const signOutTeamSession = useCallback(async () => {
    await authenticatedFetch('/api/v1/auth/session', { method: 'DELETE' }).catch(
      () => undefined,
    );
    setClientAccessMode('guest');
    setIsGuest(true);
    setUserDisplayName('Guest');
    activeIdRef.current = null;
    bundleRef.current = null;
    setActiveIdState(null);
    setBundle(null);
    try {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {}
    await refreshQuota();
    const guestList = await refreshProjects();
    if (guestList.length > 0) {
      const firstId = guestList[0]!.id;
      activeIdRef.current = firstId;
      setActiveIdState(firstId);
      void loadBundle(firstId);
    }
  }, [loadBundle, refreshProjects, refreshQuota]);

  /* ---------------------------- research runs ---------------------------- */

  const clearPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => clearPoll(), []);

  const finishRun = useCallback(
    (projectId: string, status: ResearchRun['status'], message: string) => {
      clearPoll();
      setResearchRun((current) =>
        current && current.projectId === projectId
          ? { ...current, status, message, taskId: null }
          : current,
      );
      if (activeIdRef.current === projectId) void loadBundle(projectId);
      void refreshProjects();
    },
    [loadBundle, refreshProjects],
  );

  const startResearch = useCallback(
    async (input: StartResearchInput) => {
      const {
        targetId,
        targetLabel,
        count,
        name,
        force,
        notes,
        organisation,
        role,
        website,
      } = input;
      const projectId = activeIdRef.current;
      if (!projectId) return;
      clearPoll();
      const label = name?.trim()
        ? `Researching ${name.trim()}`
        : `Finding up to ${count} ${targetLabel}`;
      setResearchRun({
        projectId,
        label,
        status: 'running',
        message: 'Starting the Research agent…',
        taskId: null,
        startedAt: Date.now(),
      });

      const isGuestProject = isGuest || projectId.startsWith('guest-');

      // Several prospects without a specific name run as a background batch for team projects.
      if (!isGuestProject && !name?.trim() && count > 1) {
        const response = await authenticatedFetch(
          `/api/projects/${projectId}/batch-research`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': crypto.randomUUID(),
            },
            body: JSON.stringify({ target_id: targetId, count }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.taskId) {
          finishRun(
            projectId,
            'failed',
            data.error || 'The research run could not be started.',
          );
          return;
        }
        const taskId = String(data.taskId);
        let lastCompleted = 0;
        let pollInFlight = false;
        setResearchRun((current) =>
          current
            ? { ...current, taskId, message: 'Searching for matching prospects…' }
            : current,
        );
        pollRef.current = window.setInterval(async () => {
          if (pollInFlight) return;
          pollInFlight = true;
          try {
            const statusResponse = await authenticatedFetch(
              `/api/projects/${projectId}/batch-research?taskId=${encodeURIComponent(taskId)}`,
            );
            if (statusResponse.status === 404) {
              finishRun(
                projectId,
                'failed',
                'The research run could not be found. Refresh and try again.',
              );
              return;
            }
            if (!statusResponse.ok) return;
            const status = await statusResponse.json();
            const completedNow =
              typeof status.completed === 'number' ? status.completed : 0;
            const message =
              status.message ||
              `Saved ${completedNow} of ${status.total ?? count} prospects.`;
            if (
              status.status === 'completed' ||
              status.status === 'completed_with_errors'
            ) {
              finishRun(projectId, 'completed', message);
            } else if (status.status === 'error') {
              finishRun(projectId, 'failed', message);
            } else if (status.status === 'cancelled') {
              finishRun(projectId, 'cancelled', message);
            } else {
              setResearchRun((current) =>
                current && current.taskId === taskId
                  ? { ...current, message }
                  : current,
              );
              if (completedNow > lastCompleted) {
                lastCompleted = completedNow;
                if (activeIdRef.current === projectId) void loadBundle(projectId);
                void refreshProjects();
              }
            }
          } catch {
            // Transient polling failures are retried on the next tick.
          } finally {
            pollInFlight = false;
          }
        }, 2500);
        return;
      }

      // One prospect (or 1..5 prospects in guest mode) streams progress as NDJSON.
      try {
        const response = await authenticatedFetch(
          `/api/projects/${projectId}/research`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name?.trim() ?? '',
              target_id: targetId,
              count: name?.trim() ? 1 : count,
              entity_kind: 'unknown',
              force: force ?? Boolean(name?.trim()),
              notes: notes?.trim() || undefined,
              organisation: organisation?.trim() || undefined,
              role: role?.trim() || undefined,
              website: website?.trim() || undefined,
            }),
          },
        );
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          finishRun(
            projectId,
            'failed',
            data.error || `Research request failed (${response.status}).`,
          );
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        let savedInRun = 0;
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === 'progress') {
                setResearchRun((current) =>
                  current && current.projectId === projectId
                    ? { ...current, message: event.message }
                    : current,
                );
              } else if (event.type === 'result') {
                savedInRun += 1;
                const found =
                  event.entry?.record?.identity?.name ||
                  event.entry?.seed?.name ||
                  'The new prospect';
                if (count <= 1 || name?.trim()) {
                  finishRun(
                    projectId,
                    'completed',
                    `${found} is ready for your review.`,
                  );
                  finished = true;
                } else {
                  setResearchRun((current) =>
                    current && current.projectId === projectId
                      ? {
                          ...current,
                          message: `Saved ${savedInRun} of ${count}: ${found}`,
                        }
                      : current,
                  );
                  if (activeIdRef.current === projectId) void loadBundle(projectId);
                  void refreshProjects();
                }
              } else if (event.type === 'batch_complete') {
                finishRun(
                  projectId,
                  'completed',
                  event.message ||
                    `Saved ${event.count ?? savedInRun} prospect(s) for review.`,
                );
                finished = true;
              } else if (event.type === 'error') {
                finishRun(
                  projectId,
                  'failed',
                  event.error || 'Research failed.',
                );
                finished = true;
              }
            } catch {
              // Ignore malformed progress lines.
            }
          }
        }
        if (!finished) {
          finishRun(projectId, 'completed', 'Research finished.');
        }
      } catch (error) {
        finishRun(
          projectId,
          'failed',
          (error as Error).message || 'Research failed.',
        );
      }
    },
    [finishRun, isGuest, loadBundle, refreshProjects],
  );

  const stopResearch = useCallback(async () => {
    const run = researchRun;
    if (!run?.taskId) return;
    clearPoll();
    setResearchRun({ ...run, message: 'Stopping…' });
    let cancelMessage = 'Research stopped.';
    try {
      const response = await authenticatedFetch(
        `/api/projects/${run.projectId}/batch-research?taskId=${encodeURIComponent(run.taskId)}`,
        { method: 'DELETE' },
      );
      const data = await response.json().catch(() => ({}));
      if (typeof data.message === 'string' && data.message.trim()) {
        cancelMessage = data.message;
      }
    } catch {
      // Release UI state and reload any prospects saved before stopping even if network drops.
    }
    finishRun(run.projectId, 'cancelled', cancelMessage);
  }, [researchRun, finishRun]);

  const dismissResearchRun = useCallback(() => {
    setResearchRun((current) => (current?.status === 'running' ? current : null));
  }, []);

  const value = useMemo<WorkspaceValue>(
    () => ({
      projects,
      projectsLoaded,
      projectsError,
      activeId,
      activeProject: projects.find((project) => project.id === activeId) ?? null,
      setActiveId,
      deleteProject,
      bundle: bundle && bundle.projectId === activeId ? bundle : null,
      bundleError,
      loading:
        Boolean(activeId) &&
        (!bundle || bundle.projectId !== activeId) &&
        !bundleError,
      reload,
      refreshProjects,
      updateDraft,
      updateResearchReview,
      setSettings,
      researchRun,
      startResearch,
      stopResearch,
      dismissResearchRun,
      globalSearch,
      setGlobalSearch,
      newProjectOpen,
      openNewProject: () => setNewProjectOpen(true),
      closeNewProject: () => setNewProjectOpen(false),
      researchDialog,
      openResearch: (targetId?: string) =>
        setResearchDialog({ open: true, targetId }),
      closeResearch: () => setResearchDialog({ open: false }),
      isGuest,
      userDisplayName,
      guestQuota,
      refreshQuota,
      resetGuestWorkspace,
      signOutTeamSession,
    }),
    [
      projects,
      projectsLoaded,
      projectsError,
      activeId,
      setActiveId,
      deleteProject,
      bundle,
      bundleError,
      reload,
      refreshProjects,
      updateDraft,
      updateResearchReview,
      setSettings,
      researchRun,
      startResearch,
      stopResearch,
      dismissResearchRun,
      globalSearch,
      newProjectOpen,
      researchDialog,
      isGuest,
      userDisplayName,
      guestQuota,
      refreshQuota,
      resetGuestWorkspace,
      signOutTeamSession,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
