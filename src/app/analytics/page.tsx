'use client';

import AppShell, { PageFrame, ProjectGate } from '@/components/workspace/AppShell';
import { useWorkspace } from '@/components/workspace/WorkspaceContext';
import { card, serif } from '@/components/workspace/ui';
import { entriesForTarget, plural, reviewStatus, verificationOf } from '@/components/workspace/format';

function AnalyticsContent() {
  const { bundle, activeProject } = useWorkspace();
  if (!bundle) return null;
  const { project, research, drafts } = bundle;
  const brief = project.structured_brief;
  const title = brief?.project.name || project.name || activeProject?.name || 'Active campaign';

  const verifiedCount = research.filter((entry) => verificationOf(entry).state === 'verified').length;
  const approvedCount = research.filter((entry) => reviewStatus(entry) === 'shortlisted').length;
  const toReviewCount = research.filter((entry) => reviewStatus(entry) === 'needs_review').length;
  const readyDraftsCount = drafts.filter((item) => Boolean(item.copy)).length;

  return (
    <PageFrame className="max-w-[1160px] gap-6">
      <header className="flex flex-col gap-1">
        <h1 className={`${serif} m-0 text-[32px]`}>Analytics</h1>
        <p className="m-0 text-sm text-[#A7ADB8]">
          Research verification and outreach pipeline metrics for {title}.
        </p>
      </header>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <div className={`${card} flex flex-col gap-1 p-5`}>
          <span className="text-[28px] font-semibold text-[#F1F2F4]">{research.length}</span>
          <span className="text-[13px] text-[#A7ADB8]">Prospects researched</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-5`}>
          <span className="text-[28px] font-semibold text-[#5BD69A]">{verifiedCount}</span>
          <span className="text-[13px] text-[#A7ADB8]">Identity &amp; evidence verified</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-5`}>
          <span className="text-[28px] font-semibold text-[#F2C36B]">{toReviewCount}</span>
          <span className="text-[13px] text-[#A7ADB8]">Waiting for review</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-5`}>
          <span className="text-[28px] font-semibold text-[#8EE6B6]">{approvedCount}</span>
          <span className="text-[13px] text-[#A7ADB8]">Approved for outreach</span>
        </div>
        <div className={`${card} flex flex-col gap-1 p-5`}>
          <span className="text-[28px] font-semibold text-[#B1A6FF]">{readyDraftsCount}</span>
          <span className="text-[13px] text-[#A7ADB8]">Drafts ready to copy</span>
        </div>
      </section>

      {brief && brief.targets.length > 0 && (
        <section className={`${card} flex flex-col gap-4 p-6`}>
          <h2 className="m-0 text-base font-semibold text-[#F1F2F4]">Breakdown by target audience</h2>
          <div className="flex flex-col gap-3">
            {brief.targets.map((target) => {
              const items = entriesForTarget(research, target);
              const approved = items.filter((e) => reviewStatus(e) === 'shortlisted').length;
              return (
                <div
                  key={target.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#22262E] bg-[#0E1014] px-4 py-3.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold capitalize text-[#F1F2F4]">
                      {target.target_type}
                    </span>
                    <span className="text-xs text-[#8A909C]">{target.description}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[#C9CDD4]">
                    <span>{plural(items.length, 'found', 'found')}</span>
                    <span className="text-[#8EE6B6]">{approved} approved</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </PageFrame>
  );
}

export default function AnalyticsPage() {
  return (
    <AppShell>
      <ProjectGate>
        <AnalyticsContent />
      </ProjectGate>
    </AppShell>
  );
}
