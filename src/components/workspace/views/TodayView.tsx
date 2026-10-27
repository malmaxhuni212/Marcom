'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { PageFrame, ProjectGate } from '../AppShell';
import { useWorkspace, type ProjectBundle } from '../WorkspaceContext';
import { Eyebrow, Icon, Initials, Pill, ProjectArt, StepProgress, btnPrimary, btnSecondary, card, serif } from '../ui';
import {
  STATUS_META,
  entriesForTarget,
  hostOf,
  initials,
  longDate,
  plural,
  prospectGoal,
  prospectName,
  relativeTime,
  reviewStatus,
  shortDate,
  verificationOf,
} from '../format';

const STEPS = ['Brief', 'Targets', 'Research', 'Review'];

interface Activity {
  id: string;
  time: string;
  title: string;
  body: string;
  href: string;
  tone: 'teal' | 'purple' | 'neutral';
  icon: 'search' | 'shield' | 'sparkle';
}

function buildActivity(bundle: ProjectBundle): Activity[] {
  const items: Activity[] = [];
  const batches = new Map<number, { latest: string; count: number; toReview: number }>();
  for (const entry of bundle.research) {
    const number = entry.batch_number ?? 1;
    const current = batches.get(number) ?? { latest: entry.record.researched_at, count: 0, toReview: 0 };
    current.count += 1;
    if (reviewStatus(entry) === 'needs_review') current.toReview += 1;
    if (Date.parse(entry.record.researched_at) > Date.parse(current.latest)) current.latest = entry.record.researched_at;
    batches.set(number, current);
  }
  for (const [number, batch] of batches) {
    items.push({
      id: `batch-${number}`,
      time: batch.latest,
      title: `Research run finished · ${shortDate(batch.latest)}`,
      body: batch.toReview > 0 ? `${plural(batch.toReview, 'new prospect')} to review` : `${plural(batch.count, 'prospect')} found`,
      href: batch.toReview > 0 ? '/prospects?tab=review' : '/prospects',
      tone: 'teal',
      icon: 'search',
    });
  }
  for (const entry of bundle.research) {
    if (entry.review?.status === 'shortlisted' && entry.review.reviewed_at) {
      const verification = verificationOf(entry);
      items.push({
        id: `approved-${entry.record.record_id}`,
        time: entry.review.reviewed_at,
        title: `${prospectName(entry)} personalized`,
        body: verification.sourceCount ? `Saved with ${plural(verification.sourceCount, 'supporting source')}` : 'Personalized for outreach',
        href: `/prospects?tab=personalized&id=${encodeURIComponent(entry.record.record_id)}`,
        tone: 'purple',
        icon: 'shield',
      });
    }
  }
  for (const draft of bundle.drafts) {
    if (!draft.copy) continue;
    items.push({
      id: `draft-${draft.record_id}`,
      time: draft.generated_at,
      title: `Drafts written for ${draft.prospect_name}`,
      body: 'Email, LinkedIn, WhatsApp, Website form and Message ready in Prospects',
      href: `/prospects?id=${encodeURIComponent(draft.record_id)}`,
      tone: 'neutral',
      icon: 'sparkle',
    });
  }
  return items.filter((item) => !Number.isNaN(Date.parse(item.time))).sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 5);
}

const TONES: Record<Activity['tone'], { box: string; iconBox: string; body: string; when: string }> = {
  teal: { box: 'bg-[#12313A] border-[#2E6B75]', iconBox: 'bg-[#0E2228] text-[#5ED3DF]', body: 'text-[#B5D9DE]', when: 'text-[#9BC4CA]' },
  purple: { box: 'bg-[#1B1830] border-[#3B3577]', iconBox: 'bg-[#13111F] text-[#B1A6FF]', body: 'text-[#C4BEEA]', when: 'text-[#A9A3D0]' },
  neutral: { box: 'bg-[#171A20] border-[#2A2F39]', iconBox: 'bg-[#0E1014] text-[#C9CDD4]', body: 'text-[#A7ADB8]', when: 'text-[#8A909C]' },
};

function TodayContent({ bundle }: { bundle: ProjectBundle }) {
  const { openResearch, researchRun, activeId } = useWorkspace();
  const brief = bundle.project.structured_brief;
  const targets = brief?.targets ?? [];
  const research = bundle.research;
  const summary = bundle.summary;
  const draftIds = new Set(bundle.drafts.filter((draft) => draft.copy).map((draft) => draft.record_id));
  const draftsReady = bundle.drafts.filter((draft) => draft.copy && (draft.status === 'draft' || draft.status === 'approved')).length;
  const approvedWithoutDrafts = research.filter((entry) => reviewStatus(entry) === 'shortlisted' && !draftIds.has(entry.record.record_id)).length;
  const toReview = research
    .filter((entry) => reviewStatus(entry) === 'needs_review')
    .sort((a, b) => Date.parse(b.record.researched_at) - Date.parse(a.record.researched_at));
  const batchCount = new Set(research.map((entry) => entry.batch_number ?? 1)).size;
  const goal = prospectGoal(brief);
  const activity = useMemo(() => buildActivity(bundle), [bundle]);
  const lastRun = research.reduce<string | null>((latest, entry) => (!latest || Date.parse(entry.record.researched_at) > Date.parse(latest) ? entry.record.researched_at : latest), null);
  const running = researchRun?.status === 'running' && researchRun.projectId === activeId;

  const coverage = targets.map((target) => {
    const entries = entriesForTarget(research, target);
    return {
      target,
      count: entries.length,
      runs: new Set(entries.map((entry) => entry.batch_number ?? 1)).size,
      toReview: entries.filter((entry) => reviewStatus(entry) === 'needs_review').length,
    };
  });
  const maxCoverage = Math.max(1, ...coverage.map((item) => item.count));

  // Next step adapts to where the campaign is.
  let next: { eyebrow: string; title: string; body: string; step: number; action: ReactNode; aside: 'queue' | 'targets' };
  if (toReview.length > 0) {
    next = {
      eyebrow: 'Your next step',
      title: `${plural(toReview.length, 'prospect is', 'prospects are')} waiting for your review`,
      body: `Found across ${plural(batchCount, 'research run')}. Approve, reject or send back for more research.`,
      step: 3,
      action: <Link href="/prospects?tab=review" className={`${btnPrimary} h-[50px] self-start px-6 text-[15px] no-underline`}>Start review <Icon name="arrowRight" size={18} /></Link>,
      aside: 'queue',
    };
  } else if (research.length === 0) {
    next = {
      eyebrow: 'Your next step',
      title: running ? 'Your first prospects are on the way' : 'Find your first prospects',
      body: running
        ? 'The Research agent is searching with your campaign configuration. New prospects will appear in Prospects.'
        : 'Your campaign configuration is saved. Run research to find people and organisations that match your target audiences.',
      step: 2,
      action: (
        <button type="button" disabled={running} onClick={() => openResearch()} className={`${btnPrimary} h-[50px] self-start px-6 text-[15px]`}>
          <Icon name="search" size={18} /> {running ? 'Research running…' : 'Find prospects'}
        </button>
      ),
      aside: 'targets',
    };
  } else if (approvedWithoutDrafts > 0) {
    next = {
      eyebrow: 'Your next step',
      title: `${plural(approvedWithoutDrafts, 'approved prospect is', 'approved prospects are')} ready to personalise`,
      body: 'Personalising writes their drafts across all 5 channels from verified facts so you can review, edit and copy each message.',
      step: 4,
      action: <Link href="/prospects?tab=approved" className={`${btnPrimary} h-[50px] self-start px-6 text-[15px] no-underline`}><Icon name="sparkle" size={18} /> Personalise approved</Link>,
      aside: 'targets',
    };
  } else if (draftsReady > 0) {
    next = {
      eyebrow: 'Your next step',
      title: `${plural(draftsReady, 'draft is', 'drafts are')} ready to copy`,
      body: 'Check each message in Prospects and copy it when you are ready to reach out.',
      step: 4,
      action: <Link href="/prospects?tab=approved" className={`${btnPrimary} h-[50px] self-start px-6 text-[15px] no-underline`}>View drafts <Icon name="arrowRight" size={18} /></Link>,
      aside: 'targets',
    };
  } else {
    next = {
      eyebrow: 'All caught up',
      title: 'Every prospect has been reviewed',
      body: 'Find more prospects to keep the campaign moving toward its goal.',
      step: 4,
      action: <button type="button" disabled={running} onClick={() => openResearch()} className={`${btnPrimary} h-[50px] self-start px-6 text-[15px]`}><Icon name="search" size={18} /> Find more prospects</button>,
      aside: 'targets',
    };
  }

  return (
    <PageFrame>
      <section aria-label="Current project" className="flex flex-wrap items-center gap-6">
        <ProjectArt seed={bundle.projectId} size={88} radius={22} />
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className={`${serif} m-0 text-[32px] leading-[1.15]`}>{bundle.project.name}</h1>
            <Pill bg="#133524" fg="#5BD69A"><span className="h-1.5 w-1.5 rounded-full bg-[#5BD69A]" />{bundle.project.status === 'paused' ? 'Paused' : bundle.project.status === 'completed' ? 'Completed' : 'Active'}</Pill>
          </div>
          {(lastRun || bundle.project.configuration_updated_at) && (
            <span className="text-[13px] text-[#8A909C]">
              {lastRun ? `Last research run ${longDate(lastRun)}` : `Configuration saved ${longDate(bundle.project.configuration_updated_at)}`}
            </span>
          )}
          <p className="m-0 max-w-[720px] text-[15px] leading-relaxed text-[#A7ADB8]">{brief?.project.description || bundle.project.summary}</p>
          <Link href="/overview" className="inline-flex items-center gap-1 self-start text-sm font-semibold text-[#5ED3DF] no-underline">
            Goal, audiences & objectives <Icon name="chevronRight" size={14} stroke={2.2} />
          </Link>
        </div>
        <button type="button" disabled={running} onClick={() => openResearch()} className={`${btnSecondary} h-11`}>
          <Icon name="search" size={16} /> {running ? 'Research running…' : 'Run research'}
        </button>
      </section>

      <section aria-label="Your next step" className={`${card} flex flex-wrap gap-7 rounded-3xl p-7`}>
        <div className="flex flex-[1_1_320px] flex-col gap-4">
          <Eyebrow color="#F2C36B">{next.eyebrow}</Eyebrow>
          <h2 className={`${serif} m-0 text-[34px] leading-[1.12]`}>{next.title}</h2>
          <p className="m-0 text-[15px] leading-relaxed text-[#A7ADB8]">{next.body}</p>
          <StepProgress steps={STEPS} current={next.step} />
          {next.action}
        </div>
        <div className="flex flex-[1_1_260px] flex-col gap-2.5">
          {next.aside === 'queue' ? (
            <>
              <div className="flex justify-between text-[13px] text-[#A7ADB8]">
                <span>Up next</span>
                <Link href="/prospects?tab=review" className="font-semibold text-[#5ED3DF] no-underline">See all {toReview.length}</Link>
              </div>
              <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-[#2A2F39] bg-[#0E1014] p-0">
                {toReview.slice(0, 4).map((entry) => (
                  <li key={entry.record.record_id} className="border-b border-[#1C1F26] last:border-b-0">
                    <Link href={`/prospects?tab=review&id=${encodeURIComponent(entry.record.record_id)}`} className="flex items-center gap-3 px-3.5 py-3 text-[#F1F2F4] no-underline hover:bg-[#15181D]">
                      <Initials text={initials(prospectName(entry))} size={34} />
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate text-sm font-semibold">{prospectName(entry)}</span>
                        <span className="text-xs text-[#8A909C]">Found {shortDate(entry.record.researched_at)}</span>
                      </span>
                      <Pill bg={STATUS_META.needs_review.bg} fg={STATUS_META.needs_review.fg} className="!text-[11px]">To review</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="text-[13px] text-[#A7ADB8]">Target audiences</div>
              <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl border border-[#2A2F39] bg-[#0E1014] p-0">
                {targets.slice(0, 4).map((target) => (
                  <li key={target.id} className="flex items-center gap-3 border-b border-[#1C1F26] px-3.5 py-3 last:border-b-0">
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-sm font-semibold capitalize">{target.target_type}</span>
                      <span className="truncate text-xs text-[#8A909C]">{[target.entity_kind !== 'unknown' ? target.entity_kind : null, ...target.geography].filter(Boolean).join(' · ') || 'No location restriction'}</span>
                    </span>
                    <span className="text-sm font-semibold">{entriesForTarget(research, target).length}</span>
                  </li>
                ))}
                {targets.length === 0 && <li className="px-3.5 py-3 text-sm text-[#8A909C]">No target audiences configured yet.</li>}
              </ul>
            </>
          )}
        </div>
      </section>

      <section aria-label="Prospect numbers" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <Link href="/prospects" className={`${card} flex flex-col gap-1 rounded-2xl p-[18px] text-[#F1F2F4] no-underline hover:border-[#3A3F4A]`}>
          <span className="text-[28px] font-semibold">{summary.total}</span><span className="text-[13px] text-[#A7ADB8]">Prospects found</span>
        </Link>
        <Link href="/prospects?tab=review" className={`${card} flex flex-col gap-1 rounded-2xl p-[18px] text-[#F1F2F4] no-underline hover:border-[#3A3F4A]`}>
          <span className="text-[28px] font-semibold text-[#F2C36B]">{summary.needs_review}</span><span className="text-[13px] text-[#A7ADB8]">To review</span>
        </Link>
        <Link href="/prospects?tab=approved" className={`${card} flex flex-col gap-1 rounded-2xl p-[18px] text-[#F1F2F4] no-underline hover:border-[#3A3F4A]`}>
          <span className="text-[28px] font-semibold text-[#B1A6FF]">{draftsReady}</span><span className="text-[13px] text-[#A7ADB8]">Drafts ready</span>
        </Link>
        {goal ? (
          <Link href="/overview" className={`${card} flex flex-col gap-2 rounded-2xl p-[18px] text-[#F1F2F4] no-underline hover:border-[#3A3F4A]`}>
            <span className="text-[28px] font-semibold">{summary.shortlisted} <span className="text-[15px] font-medium text-[#8A909C]">/ {goal.toLocaleString('en-GB')}</span></span>
            <span aria-hidden="true" className="h-1 overflow-hidden rounded-sm bg-[#2A2F39]"><span className="block h-1 min-w-1 bg-[#5ED3DF]" style={{ width: `${Math.min(100, (summary.shortlisted / goal) * 100)}%` }} /></span>
            <span className="text-[13px] text-[#A7ADB8]">Personalized toward goal</span>
          </Link>
        ) : (
          <Link href="/prospects?tab=personalized" className={`${card} flex flex-col gap-1 rounded-2xl p-[18px] text-[#F1F2F4] no-underline hover:border-[#3A3F4A]`}>
            <span className="text-[28px] font-semibold text-[#5BD69A]">{summary.shortlisted}</span><span className="text-[13px] text-[#A7ADB8]">Personalized</span>
          </Link>
        )}
      </section>

      <section aria-label="Audience coverage" className={`${card} flex flex-col gap-3.5 px-[22px] py-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 text-[17px] font-semibold">Audience coverage</h2>
          <span className="text-[13px] text-[#8A909C]">Prospects found for each target audience in your brief</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
          {coverage.map(({ target, count, runs, toReview: pending }) =>
            count > 0 ? (
              <div key={target.id} className="flex flex-col gap-2.5 rounded-[14px] border border-[#22262E] bg-[#0E1014] p-4">
                <div className="flex items-center justify-between gap-2.5"><span className="text-sm font-semibold capitalize">{target.target_type}</span><span className="text-sm font-semibold">{count}</span></div>
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-[3px] bg-[#22262E]"><div className="h-1.5 bg-[#5ED3DF]" style={{ width: `${(count / maxCoverage) * 100}%` }} /></div>
                <span className="text-xs text-[#8A909C]">{plural(runs, 'research run')} · {pending} to review</span>
              </div>
            ) : (
              <div key={target.id} className="flex flex-col gap-2.5 rounded-[14px] border border-dashed border-[#6B5524] bg-[#0E1014] p-4">
                <div className="flex items-center justify-between gap-2.5"><span className="text-sm font-semibold capitalize">{target.target_type}</span><span className="text-sm font-semibold text-[#F2C36B]">0</span></div>
                <div aria-hidden="true" className="h-1.5 rounded-[3px] bg-[#22262E]" />
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <span className="text-xs text-[#F2C36B]">Not researched yet</span>
                  <button type="button" disabled={running} onClick={() => openResearch(target.id)} className="text-[13px] font-semibold text-[#5ED3DF] disabled:opacity-50">Run research for this audience</button>
                </div>
              </div>
            ),
          )}
          {coverage.length === 0 && <p className="m-0 text-sm text-[#8A909C]">Add target audiences in the campaign configuration to track coverage.</p>}
        </div>
      </section>

      <aside aria-label="Recent activity" className="flex flex-col gap-3 rounded-3xl border border-[#22262E] bg-[#12151A] p-5">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-[17px] font-semibold">Recent activity</h2>
          <Link href="/prospects" className="text-[13px] font-semibold text-[#5ED3DF] no-underline">View prospects</Link>
        </div>
        {activity.length === 0 && <p className="m-0 text-sm text-[#8A909C]">Activity appears here once research runs and reviews happen.</p>}
        {activity.map((item) => {
          const tone = TONES[item.tone];
          return (
            <Link key={item.id} href={item.href} className={`flex items-center gap-3 rounded-2xl border p-3.5 text-[#F1F2F4] no-underline ${tone.box}`}>
              <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.iconBox}`}><Icon name={item.icon} size={18} /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold">{item.title}</span>
                <span className={`truncate text-[13px] ${tone.body}`}>{item.body}</span>
              </span>
              <span className={`self-start text-xs ${tone.when}`}>{relativeTime(item.time)}</span>
            </Link>
          );
        })}
        {bundle.research.length > 0 && (
          <p className="m-0 text-xs text-[#5C616B]">Sources checked across {new Set(bundle.research.flatMap((entry) => entry.record.sources.map((source) => hostOf(source.url)))).size} websites.</p>
        )}
      </aside>
    </PageFrame>
  );
}

export default function TodayView() {
  const { bundle } = useWorkspace();
  return <ProjectGate>{bundle && <TodayContent bundle={bundle} />}</ProjectGate>;
}
