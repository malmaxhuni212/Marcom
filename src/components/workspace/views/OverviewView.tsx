'use client';

import { useState } from 'react';
import { authenticatedFetch } from '@/auth/client';
import CampaignConfigurationForm from '@/components/campaign/CampaignConfigurationForm';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import { PageFrame, ProjectGate } from '../AppShell';
import { useWorkspace } from '../WorkspaceContext';
import {
  CloseButton,
  Dialog,
  EmptyState,
  Icon,
  Pill,
  ProjectArt,
  btnPrimary,
  btnSecondary,
  card,
  serif,
} from '../ui';
import { entriesForTarget, longDate, plural, prospectGoal, shortDate } from '../format';

type OverviewTab = 'overview' | 'research' | 'fields';

export default function OverviewView() {
  return (
    <ProjectGate>
      <OverviewBody />
    </ProjectGate>
  );
}

function OverviewBody() {
  const { bundle, activeProject, reload, openResearch } = useWorkspace();
  const [tab, setTab] = useState<OverviewTab>('overview');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!bundle) return null;
  const { project, research, projectId } = bundle;
  const brief = project.structured_brief;
  const title = brief?.project.name || project.name || activeProject?.name || 'Untitled project';
  const summary = brief?.project.description || project.summary || '';
  const goalNumber = prospectGoal(brief);

  const lastRunIso = research.reduce<string | null>((latest, entry) => {
    const iso = entry.record.researched_at;
    if (!iso) return latest;
    if (!latest || Date.parse(iso) > Date.parse(latest)) return iso;
    return latest;
  }, null);

  const saveConfiguration = async (updatedBrief: StructuredBrief) => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await authenticatedFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured_brief: updatedBrief,
          expected_revision: project.configuration_revision ?? 1,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Could not save the campaign configuration.');
      }
      await reload();
      setEditing(false);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!brief) {
    return (
      <PageFrame className="max-w-[1160px]">
        <EmptyState
          title="No structured brief saved for this project"
          body="Create a new project from a brief to configure target audiences, research settings and prospect fields."
        />
      </PageFrame>
    );
  }

  const objectives = [
    ...brief.project.secondary_objectives,
    ...brief.project.success_metrics,
  ].filter(Boolean);

  const searchSettings = brief.research.search_settings;

  return (
    <PageFrame className="max-w-[1160px] gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-6">
        <div className="relative shrink-0">
          <ProjectArt seed={projectId} size={96} radius={24} />
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill bg="#133524" fg="#5BD69A">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5BD69A]" />
              {project.status === 'paused' ? 'Paused' : project.status === 'completed' ? 'Completed' : 'Active'}
            </Pill>
            <span className="text-[13px] text-[#8A909C]">
              {project.configuration_updated_at
                ? `Updated ${longDate(project.configuration_updated_at)}`
                : 'Active campaign'}
              {lastRunIso ? ` · last research run ${shortDate(lastRunIso)}` : ''}
            </span>
          </div>
          <h1 className={`${serif} m-0 text-[32px] leading-[1.15]`}>{title}</h1>
          {summary && (
            <p className="m-0 max-w-[760px] text-[15px] leading-relaxed text-[#A7ADB8]">
              {summary}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setSaveError(null);
            setEditing(true);
          }}
          className={`${btnSecondary} h-11 px-[18px]`}
        >
          <Icon name="edit" size={16} /> Edit project
        </button>
      </header>

      {/* Section tabs */}
      <div
        role="tablist"
        aria-label="Project sections"
        className="flex gap-1 border-b border-[#22262E]"
      >
        {(
          [
            ['overview', 'Overview'],
            ['research', 'Research settings'],
            ['fields', 'Prospect fields'],
          ] as const
        ).map(([id, label]) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(id)}
              className={`h-11 border-0 border-b-2 bg-transparent px-4 text-sm transition-colors ${
                on
                  ? 'border-[#5ED3DF] font-semibold text-[#F1F2F4]'
                  : 'border-transparent font-medium text-[#A7ADB8] hover:text-[#F1F2F4]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Overview */}
      {tab === 'overview' && (
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[3_1_480px] flex-col gap-5">
            {/* Primary Goal card */}
            <section className="flex flex-col gap-2 rounded-[20px] border border-[#2E6B75] bg-[#12313A] p-[22px]">
              <h2 className="m-0 text-[11px] font-semibold tracking-[0.12em] text-[#9BE6EE]">
                PRIMARY GOAL
              </h2>
              <p className="m-0 text-xl font-medium leading-[1.4] text-[#F1F2F4]">
                {brief.project.primary_objective || 'No primary goal specified.'}
              </p>
              <div className="mt-1.5 flex items-center gap-2.5 text-[13px] text-[#B5D9DE]">
                <span
                  aria-hidden="true"
                  className="h-1 max-w-[280px] flex-1 overflow-hidden rounded-sm bg-[#1E4A52]"
                >
                  <span
                    style={{
                      width: goalNumber
                        ? `${Math.min(100, Math.max(2, Math.round((research.length / goalNumber) * 100)))}%`
                        : research.length > 0
                          ? '25%'
                          : '2%',
                    }}
                    className="block h-1 min-w-[4px] bg-[#5ED3DF]"
                  />
                </span>
                <span>
                  {goalNumber
                    ? `${research.length.toLocaleString()} of ${goalNumber.toLocaleString()} found`
                    : `${plural(research.length, 'prospect')} found`}
                </span>
              </div>
            </section>

            {/* Objectives list */}
            {objectives.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <h2 className="m-0 text-sm font-semibold text-[#A7ADB8]">Objectives</h2>
                <ol className="m-0 flex list-none flex-col overflow-hidden rounded-[18px] border border-[#2A2F39] bg-[#171A20] p-0">
                  {objectives.map((item, idx) => (
                    <li
                      key={`${idx}-${item}`}
                      className="flex gap-3.5 border-b border-[#2A2F39] px-[18px] py-4 text-[15px] leading-relaxed text-[#F1F2F4] last:border-b-0"
                    >
                      <span className="font-semibold text-[#8A909C]">{idx + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Constraints & Personalization guidance */}
            {(brief.constraints.length > 0 || brief.personalization.tone.length > 0) && (
              <section className="flex flex-col gap-2.5">
                <h2 className="m-0 text-sm font-semibold text-[#A7ADB8]">
                  Tone &amp; guardrails
                </h2>
                <div className={`${card} flex flex-col gap-3 p-[18px]`}>
                  {brief.personalization.tone.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-[#8A909C]">MESSAGE TONE</span>
                      <div className="flex flex-wrap gap-1.5">
                        {brief.personalization.tone.map((t) => (
                          <span
                            key={t}
                            className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {brief.constraints.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-[#8A909C]">CONSTRAINTS</span>
                      <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-sm text-[#C9CDD4]">
                        {brief.constraints.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Target audiences column */}
          <section
            aria-label="Target audiences"
            className="flex min-w-0 flex-[2_1_320px] flex-col gap-2.5"
          >
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-sm font-semibold text-[#A7ADB8]">
                Target audiences · {brief.targets.length}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="h-8 border-0 bg-transparent px-2 text-[13px] font-semibold text-[#5ED3DF] hover:underline"
              >
                + Add / Edit
              </button>
            </div>

            {brief.targets.map((target) => {
              const foundCount = entriesForTarget(research, target).length;
              const entityTag =
                target.entity_kind === 'person'
                  ? 'People'
                  : target.entity_kind === 'organisation'
                    ? 'Organisation'
                    : 'People & Orgs';
              const geoLabel =
                target.geography.length > 0
                  ? target.geography.join(', ')
                  : target.geography_mode === 'unrestricted'
                    ? 'Any location'
                    : 'Geography unspecified';

              return (
                <article
                  key={target.id}
                  className="flex flex-col gap-2.5 rounded-[18px] border border-[#2A2F39] bg-[#171A20] p-[18px]"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <h3 className="m-0 text-base font-semibold capitalize leading-snug text-[#F1F2F4]">
                      {target.target_type}
                    </h3>
                    <span className="rounded-full bg-[#12313A] px-2.5 py-[3px] text-xs font-semibold capitalize text-[#9BE6EE]">
                      {target.priority === 'unspecified' ? 'Primary' : target.priority}
                    </span>
                  </div>
                  <p className="m-0 text-sm leading-relaxed text-[#A7ADB8]">
                    {target.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]">
                      {entityTag}
                    </span>
                    <span className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]">
                      {geoLabel}
                    </span>
                    <span className="rounded-lg bg-[#1F232B] px-2.5 py-1 text-xs text-[#C9CDD4]">
                      {plural(target.qualification_criteria.length, 'must-have check')}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-[#22262E] pt-2.5 text-xs text-[#8A909C]">
                    <span>{plural(foundCount, 'prospect')} found</span>
                    <button
                      type="button"
                      onClick={() => openResearch(target.id)}
                      className="border-0 bg-transparent p-0 text-xs font-semibold text-[#5ED3DF] hover:underline"
                    >
                      Run research →
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      )}

      {/* TAB 2: Research settings */}
      {tab === 'research' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-lg font-semibold text-[#F1F2F4]">Research configuration</h2>
              <p className="m-0 text-sm text-[#A7ADB8]">
                Controls how the Research agent searches for prospects and verifies evidence.
              </p>
            </div>
            <button type="button" onClick={() => setEditing(true)} className={btnSecondary}>
              <Icon name="edit" size={16} /> Edit research settings
            </button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
            <div className={`${card} flex flex-col gap-3 p-5`}>
              <span className="text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                SEARCH KEYWORDS
              </span>
              {searchSettings?.keywords?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {searchSettings.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded-lg border border-[#2E6B75] bg-[#12313A] px-2.5 py-1 text-xs text-[#9BE6EE]"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-[#8A909C]">Derived automatically from target audiences</span>
              )}

              <span className="mt-2 text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                EXCLUDED KEYWORDS
              </span>
              {searchSettings?.excluded_keywords?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {searchSettings.excluded_keywords.map((kw) => (
                    <span
                      key={kw}
                      className="rounded-lg border border-[#3A303A] bg-[#1C1517] px-2.5 py-1 text-xs text-[#F28B82]"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-[#8A909C]">None specified</span>
              )}
            </div>

            <div className={`${card} flex flex-col gap-3 p-5`}>
              <span className="text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                PREFERRED SOURCE TYPES
              </span>
              {brief.research.preferred_source_types.length > 0 ? (
                <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-sm text-[#C9CDD4]">
                  {brief.research.preferred_source_types.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-[#8A909C]">Official websites, directories and public profiles</span>
              )}

              <span className="mt-2 text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                DEFAULT BATCH SIZE
              </span>
              <span className="text-sm font-semibold text-[#F1F2F4]">
                {searchSettings?.default_result_limit ?? 10} prospects per run
              </span>
            </div>

            <div className={`${card} flex flex-col gap-3 p-5`}>
              <span className="text-xs font-semibold tracking-[0.12em] text-[#8A909C]">
                EVIDENCE &amp; VERIFICATION RULES
              </span>
              <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-sm text-[#C9CDD4]">
                {[
                  ...brief.research.evidence_requirements,
                  ...brief.research.verification_requirements,
                ].map((req) => (
                  <li key={req}>{req}</li>
                ))}
              </ul>
              <div className="mt-1 rounded-xl border border-[#22262E] bg-[#0E1014] px-3 py-2.5 text-xs text-[#A7ADB8]">
                <strong className="text-[#F1F2F4]">Unknown handling:</strong> {brief.research.unknown_handling}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Prospect fields */}
      {tab === 'fields' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-lg font-semibold text-[#F1F2F4]">
                Prospect fields · {brief.database.fields.length}
              </h2>
              <p className="m-0 text-sm text-[#A7ADB8]">
                Information MARCOM collects and stores for each prospect in this campaign.
              </p>
            </div>
            <button type="button" onClick={() => setEditing(true)} className={btnSecondary}>
              <Icon name="edit" size={16} /> Edit prospect fields
            </button>
          </div>

          <div className="overflow-x-auto rounded-[18px] border border-[#2A2F39] bg-[#171A20]">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[#A7ADB8]">
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Field
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Purpose
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Source
                  </th>
                  <th scope="col" className="border-b border-[#2A2F39] px-4 py-3 font-semibold">
                    Requirement
                  </th>
                </tr>
              </thead>
              <tbody>
                {brief.database.fields.map((field) => (
                  <tr key={field.name} className="border-b border-[#22262E] last:border-b-0">
                    <td className="px-4 py-3.5 font-mono text-xs font-semibold text-[#F1F2F4]">
                      {field.name}
                    </td>
                    <td className="px-4 py-3.5 text-[#C9CDD4]">{field.purpose}</td>
                    <td className="px-4 py-3.5 capitalize text-[#A7ADB8]">
                      {field.expected_source}
                    </td>
                    <td className="px-4 py-3.5">
                      <Pill
                        bg={field.required ? '#12313A' : '#1F232B'}
                        fg={field.required ? '#9BE6EE' : '#A7ADB8'}
                      >
                        {field.required ? 'Required' : 'Optional'}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full Campaign Configuration Editor Modal */}
      {editing && (
        <Dialog
          label="Edit campaign configuration"
          onClose={() => !saving && setEditing(false)}
          width={980}
        >
          <div className="flex items-center justify-between border-b border-[#2A2F39] px-7 py-5">
            <div>
              <span className="text-xs font-semibold tracking-[0.12em] text-[#5ED3DF]">
                DETAILED CAMPAIGN CONFIGURATION
              </span>
              <h2 className={`${serif} m-0 mt-1 text-2xl text-[#F1F2F4]`}>
                Edit {title}
              </h2>
            </div>
            <CloseButton onClick={() => !saving && setEditing(false)} />
          </div>
          <div className="max-h-[78vh] overflow-y-auto px-7 py-6">
            <CampaignConfigurationForm
              initialBrief={brief}
              originalBrief={project.summary}
              submitLabel={saving ? 'Saving configuration…' : 'Save configuration'}
              submitting={saving}
              serverError={saveError}
              onCancel={() => setEditing(false)}
              onSubmit={saveConfiguration}
            />
          </div>
        </Dialog>
      )}
    </PageFrame>
  );
}
