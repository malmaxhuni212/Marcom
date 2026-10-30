'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { authenticatedFetch } from '@/auth/client';
import type { Project } from '@/types';
import BriefIntakeModal from '@/components/ui/BriefIntakeModal';
import NotificationBell from '@/components/layout/NotificationBell';
import ResearchDialog from './ResearchDialog';
import { useWorkspace, WorkspaceProvider } from './WorkspaceContext';
import { Icon, ProjectArt, Spinner, btnSecondary } from './ui';
import { initials } from './format';

const PRIMARY_NAV = [
  { href: '/', label: 'Today', icon: 'home' as const },
  { href: '/prospects', label: 'Prospects', icon: 'list' as const, badge: true },
];

const SECONDARY_NAV = [
  { href: '/analytics', label: 'Analytics', icon: 'chart' as const },
  { href: '/integrations', label: 'Integrations', icon: 'plug' as const },
  { href: '/settings', label: 'Settings', icon: 'settings' as const },
];

function ProjectSwitcher({ onNavigate }: { onNavigate: () => void }) {
  const { projects, activeProject, bundle, setActiveId, openNewProject, deleteProject } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const reviewCount = bundle?.summary?.needs_review ?? activeProject?.reviewCount ?? 0;
  const personalizedCount = bundle
    ? Math.max(bundle.summary?.shortlisted ?? 0, bundle.drafts?.length ?? 0)
    : (activeProject?.qualifiedCount ?? 0);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Switch project"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
          open
            ? 'border-[#2E6B75] bg-[#141920] shadow-[0_0_0_1px_rgba(94,211,223,0.2)]'
            : 'border-[#232832] bg-[#13161C] hover:border-[#343B48] hover:bg-[#171B22]'
        }`}
      >
        {activeProject ? (
          <ProjectArt seed={activeProject.id} size={38} radius={11} />
        ) : (
          <span className="h-[38px] w-[38px] shrink-0 rounded-[11px] bg-[#1F232B]" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold text-[#F1F2F4]">
            {activeProject?.name ?? 'No project yet'}
          </span>
          <span className="truncate text-[11.5px] text-[#9BA1AE]">
            {activeProject ? `${reviewCount} to review · ${personalizedCount} personalized` : 'Create one to begin'}
          </span>
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#1C2029] text-[#A7ADB8]">
          <Icon name="updown" size={14} />
        </span>
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Projects"
          className="absolute left-0 top-[calc(100%+8px)] z-[80] w-[284px] rounded-2xl border border-[#2E333D] bg-[#151820] p-2.5 shadow-[0_24px_60px_rgba(0,0,0,0.75)]"
        >
          <div className="flex items-center justify-between pl-2 pr-0 pb-2.5 pt-1">
            <h2 className="m-0 text-xs font-bold uppercase tracking-[0.1em] text-[#8A909C]">
              Projects · {projects.length}
            </h2>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openNewProject();
                onNavigate();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5ED3DF] px-3 text-xs font-bold text-[#0E1014] shadow-[0_2px_10px_rgba(94,211,223,0.25)] transition hover:bg-[#74DEE9] whitespace-nowrap shrink-0"
            >
              <Icon name="plus" size={13} stroke={2.6} /> New project
            </button>
          </div>
          <ul className="m-0 flex max-h-[340px] list-none flex-col gap-1.5 overflow-y-auto p-0">
            {projects.length === 0 ? (
              <li className="p-4 text-center text-xs text-[#8A909C]">No campaigns found</li>
            ) : (
              projects.map((project) => {
                const current = project.id === activeProject?.id;
                const stage = project.reviewCount > 0 ? 4 : project.prospectsCurrent > 0 ? 3 : 2;
                return (
                  <li key={project.id} className="group relative">
                    <button
                      type="button"
                      aria-current={current}
                      onClick={() => {
                        setActiveId(project.id);
                        setOpen(false);
                        onNavigate();
                      }}
                      className={`flex w-full items-start gap-2.5 rounded-xl border p-2.5 pr-9 text-left transition ${
                        current
                          ? 'border-[#2E6B75] bg-[#112A32]'
                          : 'border-transparent bg-[#111318] hover:border-[#2A2F39] hover:bg-[#1A1E26]'
                      }`}
                    >
                      <ProjectArt seed={project.id} size={36} radius={10} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-[13.5px] font-semibold text-[#F1F2F4]">
                            {project.name}
                          </span>
                          {current && <Icon name="check" size={15} stroke={2.5} className="shrink-0 text-[#5ED3DF]" />}
                        </span>
                        <span className="grid grid-cols-4 gap-1">
                          {[0, 1, 2, 3].map((step) => (
                            <span
                              key={step}
                              className="h-[3px] rounded-sm"
                              style={{ background: step < stage ? '#5ED3DF' : current ? '#23434B' : '#252A34' }}
                            />
                          ))}
                        </span>
                        <span className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] ${current ? 'text-[#B5D9DE]' : 'text-[#9BA1AE]'}`}>
                          <span className="font-semibold text-[#F2C36B]">{project.reviewCount} to review</span>
                          <span>·</span>
                          <span>{project.qualifiedCount} personalized</span>
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      title={`Delete "${project.name}"`}
                      aria-label={`Delete "${project.name}"`}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setDeleteError(null);
                        setProjectToDelete(project);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[#8A909C] transition-all hover:bg-red-500/15 hover:text-[#F28B82] focus:bg-red-500/15 focus:text-[#F28B82]"
                    >
                      <Icon name="trash" size={14} stroke={2} />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>
      )}

      {projectToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(4,5,7,0.75)] p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setProjectToDelete(null);
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
                <h3 id="delete-project-title" className="m-0 text-base font-semibold text-[#F1F2F4]">
                  Delete campaign?
                </h3>
                <p className="m-0 text-xs text-[#A7ADB8] leading-relaxed">
                  Are you sure you want to delete <span className="font-semibold text-[#F1F2F4]">&ldquo;{projectToDelete.name}&rdquo;</span>? This will permanently remove all associated prospects, personalized drafts, and campaign settings.
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
                  setProjectToDelete(null);
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
                    await deleteProject(projectToDelete.id);
                    setProjectToDelete(null);
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
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const { activeProject, bundle, openNewProject } = useWorkspace();
  const isActive = (href: string) =>
    href === '/'
      ? pathname === '/' || pathname === '/overview'
      : href === '/prospects'
        ? pathname.startsWith('/prospects') || pathname.startsWith('/review') || pathname.startsWith('/outreach')
        : pathname.startsWith(href);
  const reviewCount = bundle?.summary?.needs_review ?? activeProject?.reviewCount ?? 0;

  const linkClass = (active: boolean) =>
    `flex h-[42px] items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium no-underline transition ${
      active
        ? 'bg-[#1A1F28] font-semibold text-[#F1F2F4] shadow-[inset_3px_0_0_#5ED3DF]'
        : 'text-[#A7ADB8] hover:bg-[#14171E] hover:text-[#F1F2F4]'
    }`;

  return (
    <nav aria-label="Main" className="flex h-full min-h-full w-[256px] flex-col gap-5 bg-[#0B0D10] px-4 pb-5 pt-6 text-[#F1F2F4]">
      <div className="flex items-center px-1">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#5ED3DF] shadow-[0_0_8px_#5ED3DF]" />
          <span className="text-[13px] font-bold tracking-[0.28em] text-[#F1F2F4]">MARCOM</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <ProjectSwitcher onNavigate={onNavigate} />
        <button
          type="button"
          onClick={() => {
            openNewProject();
            onNavigate();
          }}
          className="flex h-9.5 w-full items-center justify-center gap-2 rounded-xl border border-[#2E6B75] bg-[#12313A] px-3 text-[13px] font-semibold text-[#9BE6EE] transition hover:border-[#5ED3DF] hover:bg-[#173D48] hover:text-[#F1F2F4]"
        >
          <Icon name="plus" size={14} stroke={2.5} />
          New project
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#68707E]">
          Workspace
        </div>
        {PRIMARY_NAV.map((item) => (
          <Link key={item.href} href={item.href} onClick={onNavigate} className={linkClass(isActive(item.href))}>
            <Icon name={item.icon} size={18} stroke={1.8} />
            <span className="flex-1">{item.label}</span>
            {item.badge && reviewCount > 0 && (
              <span className="flex h-5 min-w-[22px] items-center justify-center rounded-full bg-[#F2C36B] px-1.5 text-[11px] font-bold text-[#0E1014]">
                {reviewCount}
              </span>
            )}
          </Link>
        ))}
      </div>

      <div className="mx-2 h-px bg-[#181B22]" />

      <div className="flex flex-col gap-1">
        <div className="px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#68707E]">
          Configuration
        </div>
        {SECONDARY_NAV.map((item) => (
          <Link key={item.href} href={item.href} onClick={onNavigate} className={`${linkClass(isActive(item.href))} !h-10 ${isActive(item.href) ? '' : '!text-[#8A909C]'}`}>
            <Icon name={item.icon} size={17} stroke={1.8} />
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function AccountMenu() {
  const router = useRouter();
  const { bundle } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sender = bundle?.settings?.sender_name?.trim();
  const displayName = sender || 'MARCOM team';

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const signOut = async () => {
    setOpen(false);
    await authenticatedFetch('/api/v1/auth/session', { method: 'DELETE' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Profile and account"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-[42px] items-center gap-2.5 rounded-[21px] border border-[#2A2F39] bg-[#171A20] pl-1 pr-2.5 text-[#F1F2F4]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[#1F232B] text-[13px] font-semibold">{initials(displayName)}</span>
        <span className="hidden text-[13px] font-medium sm:inline">{displayName}</span>
        <Icon name="chevronDown" size={14} className="text-[#A7ADB8]" />
      </button>
      {open && (
        <section role="dialog" aria-label="Account" className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[320px] max-w-[calc(100vw-32px)] rounded-[20px] border border-[#2E333D] bg-[#171A20] shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
          <div className="flex items-center gap-3 border-b border-[#2A2F39] px-[18px] py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-[20px] border border-[#2A2F39] bg-[#1F232B] text-[15px] font-semibold">{initials(displayName)}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">{displayName}</span>
              <span className="truncate text-xs text-[#8A909C]">
                {[bundle?.settings?.sender_role, bundle?.settings?.organisation].filter(Boolean).join(' · ') || 'MARCOM shared pilot · internal access'}
              </span>
            </span>
          </div>
          <nav aria-label="Account" className="flex flex-col px-2 pb-2 pt-1.5">
            <Link href="/prospects?settings=1" onClick={() => setOpen(false)} className="flex h-10 items-center rounded-[10px] px-2.5 text-sm text-[#F1F2F4] no-underline hover:bg-[#1F232B]">Sender & outreach details</Link>
            <Link href="/settings" onClick={() => setOpen(false)} className="flex h-10 items-center rounded-[10px] px-2.5 text-sm text-[#F1F2F4] no-underline hover:bg-[#1F232B]">Workspace settings</Link>
            <button type="button" onClick={() => void signOut()} className="flex h-10 items-center rounded-[10px] px-2.5 text-left text-sm text-[#F28B82] hover:bg-[#1C1517]">Sign out</button>
          </nav>
        </section>
      )}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { globalSearch, setGlobalSearch } = useWorkspace();
  const [value, setValue] = useState(globalSearch);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setGlobalSearch(value.trim());
    if (!pathname.startsWith('/prospects')) router.push('/prospects');
  };

  return (
    <header className="sticky top-0 z-40 flex h-[72px] items-center gap-4 border-b border-[#1C1F26] bg-[#0E1014]/95 px-4 backdrop-blur sm:px-10">
      <button type="button" aria-label="Open navigation" onClick={onMenu} className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-[#2A2F39] bg-[#171A20] text-[#F1F2F4] lg:hidden">
        <Icon name="menu" size={18} />
      </button>
      <form onSubmit={submit} role="search" className="flex h-[42px] min-w-0 max-w-[560px] flex-1 items-center gap-2.5 rounded-xl border border-[#2A2F39] bg-[#171A20] px-3.5 text-[#8A909C]">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (pathname.startsWith('/prospects')) setGlobalSearch(event.target.value);
          }}
          placeholder="Search prospects by name, organisation or bio"
          aria-label="Search prospects"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[#F1F2F4] outline-none placeholder:text-[#8A909C]"
        />
      </form>
      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}

function ResearchRunToast() {
  const pathname = usePathname();
  const { researchRun, activeId, stopResearch, dismissResearchRun } = useWorkspace();
  if (!researchRun || researchRun.projectId !== activeId) return null;
  const running = researchRun.status === 'running';
  const tone = running
    ? 'border-[#2E6B75] bg-[#12313A] text-[#B5D9DE]'
    : researchRun.status === 'completed'
      ? 'border-[#1F4A33] bg-[#10261B] text-[#B7D9C6]'
      : 'border-[#5A3A38] bg-[#1C1517] text-[#F7B1AA]';
  return (
    <div role="status" className={`fixed bottom-5 right-5 z-[65] flex w-[380px] max-w-[calc(100vw-40px)] items-start gap-3 rounded-2xl border p-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] ${tone}`}>
      <span className="mt-0.5">{running ? <Spinner /> : <Icon name={researchRun.status === 'completed' ? 'check' : 'warning'} size={18} stroke={2.4} />}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-[#F1F2F4]">{running ? researchRun.label : researchRun.status === 'completed' ? 'Research finished' : researchRun.status === 'cancelled' ? 'Research stopped' : 'Research failed'}</span>
        <span className="text-[13px] leading-snug">{researchRun.message}</span>
        {!running && researchRun.status === 'completed' && !pathname.startsWith('/prospects') && (
          <Link href="/prospects?tab=review" onClick={dismissResearchRun} className="mt-1 text-[13px] font-semibold text-[#5ED3DF] no-underline">Review new prospects →</Link>
        )}
      </span>
      {running ? (
        researchRun.taskId && <button type="button" onClick={() => void stopResearch()} className="text-xs font-semibold text-[#F28B82]">Stop</button>
      ) : (
        <button type="button" aria-label="Dismiss" onClick={dismissResearchRun} className="text-[#8A909C] hover:text-[#F1F2F4]"><Icon name="x" size={14} /></button>
      )}
    </div>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { newProjectOpen, closeNewProject, refreshProjects, setActiveId, researchDialog, bundle } = useWorkspace();
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#0E1014] font-sans text-[#F1F2F4]">
      <aside className="sticky top-0 z-50 hidden h-screen w-[256px] shrink-0 overflow-visible border-r border-[#1C1F26] bg-[#0B0D10] lg:block">
        <SidebarNav onNavigate={() => undefined} />
      </aside>

      {mobileNav && (
        <div className="fixed inset-0 z-[55] lg:hidden">
          <button type="button" aria-label="Close navigation" onClick={() => setMobileNav(false)} className="absolute inset-0 h-full w-full bg-[rgba(4,5,7,0.6)]" />
          <aside className="relative h-full w-[256px] overflow-visible border-r border-[#1C1F26] bg-[#0B0D10]">
            <SidebarNav onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileNav(true)} />
        {children}
      </div>

      <BriefIntakeModal
        isOpen={newProjectOpen}
        onClose={closeNewProject}
        onSuccess={(projectId) => {
          void refreshProjects().then(() => {
            if (projectId) setActiveId(projectId);
            router.push('/');
          });
        }}
      />
      {researchDialog.open && bundle && <ResearchDialog key={researchDialog.targetId ?? 'any'} />}
      <ResearchRunToast />
    </div>
  );
}

/** Workspace layout: sidebar + topbar around every MARCOM screen. */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <ShellInner>{children}</ShellInner>
    </WorkspaceProvider>
  );
}

/** Standard page frame used by workspace screens. */
export function PageFrame({ children, wide = false, className = '' }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <main className="min-w-0 flex-1 px-4 pb-12 pt-8 sm:px-10">
      <div className={`mx-auto flex flex-col gap-6 ${wide ? 'max-w-[1400px]' : 'max-w-[1160px]'} ${className}`}>{children}</div>
    </main>
  );
}

/** Shown when the workspace has no project yet or the active project is still loading. */
export function ProjectGate({ children }: { children: ReactNode }) {
  const { projectsLoaded, projects, projectsError, loading, bundle, bundleError, openNewProject, reload } = useWorkspace();

  if (!projectsLoaded || (projects.length > 0 && loading)) {
    return (
      <PageFrame>
        <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-[#A7ADB8]">
          <Spinner /> Loading your workspace…
        </div>
      </PageFrame>
    );
  }

  if (projectsError && !projects.length) {
    return (
      <PageFrame>
        <div className="rounded-2xl border border-[#5A3A38] bg-[#1C1517] p-5 text-sm text-[#F7B1AA]">Projects could not be loaded: {projectsError}</div>
      </PageFrame>
    );
  }

  if (!projects.length) {
    return (
      <PageFrame>
        <section className="flex flex-col items-start gap-5 rounded-3xl border border-[#2A2F39] bg-[#171A20] p-8 sm:p-10">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F2C36B]">Get started</div>
          <h1 className="m-0 font-serif text-[34px] font-semibold leading-tight">Create your first project</h1>
          <p className="m-0 max-w-xl text-[15px] leading-relaxed text-[#A7ADB8]">
            Tell MARCOM what you&apos;re working on. It turns your brief into a detailed campaign configuration, researches matching prospects, and writes personalised drafts you can copy.
          </p>
          <button type="button" onClick={openNewProject} className="inline-flex h-[50px] items-center gap-2 rounded-[14px] bg-[#F1F2F4] px-6 text-[15px] font-semibold text-[#0E1014]">
            <Icon name="plus" size={18} stroke={2.2} /> New project
          </button>
        </section>
      </PageFrame>
    );
  }

  if (bundleError || !bundle) {
    return (
      <PageFrame>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#5A3A38] bg-[#1C1517] p-5 text-sm text-[#F7B1AA]">
          <span className="flex-1">This project could not be loaded{bundleError ? `: ${bundleError}` : '.'}</span>
          <button type="button" onClick={() => void reload()} className={`${btnSecondary} h-10`}>Try again</button>
        </div>
      </PageFrame>
    );
  }

  return <>{children}</>;
}
