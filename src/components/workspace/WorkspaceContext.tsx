'use client';

/**
 * Workspace state shared by every MARCOM screen:
 *  - the project list and the active project (remembered per browser),
 *  - the active project's data bundle (campaign, research, drafts, outreach settings),
 *  - background research runs, which keep polling even when their dialog is closed.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authenticatedFetch } from '@/auth/client';
import type { Project } from '@/types';
import type { ProjectMemory } from '@/marcom/memory/types';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { summarizeResearch, type ResearchReviewSummary } from '@/marcom/research/review';
import type { PersonalizationEntry, PersonalizationSettings } from '@/marcom/schemas/personalization';

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
}

interface WorkspaceValue {
  projects: Project[];
  projectsLoaded: boolean;
  projectsError: string | null;
  activeId: string | null;
  activeProject: Project | null;
  setActiveId: (id: string) => void;
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const existing = useContext(WorkspaceContext);
  if (existing) {
    return <>{children}</>;
  }
  return <WorkspaceProviderRoot>{children}</WorkspaceProviderRoot>;
}

function WorkspaceProviderRoot({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [researchRun, setResearchRun] = useState<ResearchRun | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [researchDialog, setResearchDialog] = useState<{ open: boolean; targetId?: string }>({ open: false });
  const activeIdRef = useRef<string | null>(null);
  const bundleRef = useRef<ProjectBundle | null>(null);
  const pollRef = useRef<number | null>(null);

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

  const loadBundle = useCallback(async (projectId: string) => {
    try {
      const [detail, personalization] = await Promise.all([
        fetchJson<{ project: ProjectMemory; research?: ResearchEntry[]; research_summary: ResearchReviewSummary }>(`/api/projects/${projectId}`),
        fetchJson<{ items?: PersonalizationEntry[]; settings?: PersonalizationSettings }>(`/api/projects/${projectId}/personalization`).catch(() => null),
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
      if (activeIdRef.current === projectId) setBundleError((error as Error).message);
    }
  }, []);

  // Initial project list + active project (URL ?project= wins, then the remembered project, then the first).
  // Fire loadBundle in parallel if a remembered/requested project ID is available to eliminate waterfall latency.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('project');
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
    } catch {
      remembered = null;
    }
    const eagerCandidate = requested || remembered;
    if (eagerCandidate) {
      activeIdRef.current = eagerCandidate;
      setActiveIdState(eagerCandidate);
      void loadBundle(eagerCandidate);
    }

    void refreshProjects().then((list) => {
      if (!list.length) {
        activeIdRef.current = null;
        setActiveIdState(null);
        return;
      }
      const chosen = [requested, remembered].find((id) => id && list.some((project) => project.id === id)) ?? list[0]!.id;
      if (chosen !== activeIdRef.current) {
        activeIdRef.current = chosen;
        setActiveIdState(chosen);
      }
    });
  }, [refreshProjects, loadBundle]);

  useEffect(() => {
    if (!activeId) return;
    activeIdRef.current = activeId;
    if (bundleRef.current?.projectId === activeId) return;
    void loadBundle(activeId);
  }, [activeId, loadBundle]);

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
    const id = activeIdRef.current;
    if (!id) return;
    await Promise.all([loadBundle(id), refreshProjects()]);
  }, [loadBundle, refreshProjects]);

  const updateDraft = useCallback((entry: PersonalizationEntry) => {
    setBundle((current) => {
      if (!current || current.projectId !== entry.project_id) return current;
      const exists = current.drafts.some((draft) => draft.record_id === entry.record_id);
      const merged = (draft: PersonalizationEntry) =>
        draft.record_id === entry.record_id ? { ...entry, candidate_contacts: entry.candidate_contacts ?? draft.candidate_contacts, strategy: entry.strategy ?? draft.strategy } : draft;
      return { ...current, drafts: exists ? current.drafts.map(merged) : [...current.drafts, entry] };
    });
  }, []);

  const updateResearchReview = useCallback((recordId: string, status: ReviewStatus, note: string | null) => {
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
  }, []);

  const setSettings = useCallback((settings: PersonalizationSettings) => {
    setBundle((current) => (current ? { ...current, settings } : current));
  }, []);

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
      setResearchRun((current) => (current && current.projectId === projectId ? { ...current, status, message, taskId: null } : current));
      if (activeIdRef.current === projectId) void loadBundle(projectId);
      void refreshProjects();
    },
    [loadBundle, refreshProjects],
  );

  const startResearch = useCallback(
    async ({ targetId, targetLabel, count, name }: StartResearchInput) => {
      const projectId = activeIdRef.current;
      if (!projectId) return;
      clearPoll();
      const label = name?.trim() ? `Researching ${name.trim()}` : `Finding up to ${count} ${targetLabel}`;
      setResearchRun({ projectId, label, status: 'running', message: 'Starting the Research agent…', taskId: null, startedAt: Date.now() });

      // Several prospects without a specific name run as a background batch.
      if (!name?.trim() && count > 1) {
        const response = await authenticatedFetch(`/api/projects/${projectId}/batch-research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ target_id: targetId, count }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.taskId) {
          finishRun(projectId, 'failed', data.error || 'The research run could not be started.');
          return;
        }
        const taskId = String(data.taskId);
        setResearchRun((current) => (current ? { ...current, taskId, message: 'Searching for matching prospects…' } : current));
        pollRef.current = window.setInterval(async () => {
          try {
            const statusResponse = await authenticatedFetch(`/api/projects/${projectId}/batch-research?taskId=${encodeURIComponent(taskId)}`);
            if (statusResponse.status === 404) {
              finishRun(projectId, 'failed', 'The research run could not be found. Refresh and try again.');
              return;
            }
            if (!statusResponse.ok) return;
            const status = await statusResponse.json();
            const message = status.message || `Saved ${status.completed ?? 0} of ${status.total ?? count} prospects.`;
            if (status.status === 'completed' || status.status === 'completed_with_errors') finishRun(projectId, 'completed', message);
            else if (status.status === 'error') finishRun(projectId, 'failed', message);
            else if (status.status === 'cancelled') finishRun(projectId, 'cancelled', message);
            else setResearchRun((current) => (current && current.taskId === taskId ? { ...current, message } : current));
          } catch {
            // Transient polling failures are retried on the next tick.
          }
        }, 4000);
        return;
      }

      // One prospect (named or auto-discovered) streams progress as NDJSON.
      try {
        const response = await authenticatedFetch(`/api/projects/${projectId}/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name?.trim() ?? '', target_id: targetId, entity_kind: 'unknown' }),
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          finishRun(projectId, 'failed', data.error || `Research request failed (${response.status}).`);
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
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
                setResearchRun((current) => (current && current.projectId === projectId ? { ...current, message: event.message } : current));
              } else if (event.type === 'result') {
                const found = event.entry?.record?.identity?.name || event.entry?.seed?.name || 'The new prospect';
                finishRun(projectId, 'completed', `${found} is ready for your review.`);
                finished = true;
              } else if (event.type === 'error') {
                finishRun(projectId, 'failed', event.error || 'Research failed.');
                finished = true;
              }
            } catch {
              // Ignore malformed progress lines.
            }
          }
        }
        if (!finished) finishRun(projectId, 'completed', 'Research finished.');
      } catch (error) {
        finishRun(projectId, 'failed', (error as Error).message || 'Research failed.');
      }
    },
    [finishRun],
  );

  const stopResearch = useCallback(async () => {
    const run = researchRun;
    if (!run?.taskId) return;
    setResearchRun({ ...run, message: 'Stopping…' });
    await authenticatedFetch(`/api/projects/${run.projectId}/batch-research?taskId=${encodeURIComponent(run.taskId)}`, { method: 'DELETE' }).catch(() => undefined);
  }, [researchRun]);

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
      bundle: bundle && bundle.projectId === activeId ? bundle : null,
      bundleError,
      loading: Boolean(activeId) && (!bundle || bundle.projectId !== activeId) && !bundleError,
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
      openResearch: (targetId?: string) => setResearchDialog({ open: true, targetId }),
      closeResearch: () => setResearchDialog({ open: false }),
    }),
    [projects, projectsLoaded, projectsError, activeId, setActiveId, bundle, bundleError, reload, refreshProjects, updateDraft, updateResearchReview, setSettings, researchRun, startResearch, stopResearch, dismissResearchRun, globalSearch, newProjectOpen, researchDialog],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
