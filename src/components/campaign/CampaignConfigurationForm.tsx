'use client';

import { useMemo, useState } from 'react';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SecondaryButton from '@/components/ui/SecondaryButton';
import type { Criterion, StructuredBrief, Target } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';

interface CampaignConfigurationFormProps {
  initialBrief: StructuredBrief;
  originalBrief?: string;
  submitLabel: string;
  submitting?: boolean;
  serverError?: string | null;
  onCancel: () => void;
  onSubmit: (brief: StructuredBrief) => Promise<void> | void;
}

const fieldClass = 'w-full rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-white/90 outline-none transition focus:border-cyan-400/60 focus:ring-1 focus:ring-cyan-400/30 placeholder:text-white/25';
const labelClass = 'mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50';

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function prepareBrief(brief: StructuredBrief): StructuredBrief {
  const prepared = structuredClone(brief);
  prepared.targets = prepared.targets.map((target) => ({
    ...target,
    geography_mode: target.geography_mode ?? (target.geography.length ? 'specified' : 'unspecified'),
  }));
  if (!prepared.research.search_settings) {
    prepared.research.search_settings = {
      keywords: unique([
        ...prepared.targets.map((target) => target.target_type),
        ...prepared.targets.flatMap((target) => target.qualification_criteria.map((criterion) => criterion.text)),
      ]).slice(0, 12),
      excluded_keywords: unique(prepared.targets.flatMap((target) => target.exclusion_criteria.map((criterion) => criterion.text))),
      preferred_domains: [],
      excluded_domains: [],
      default_result_limit: 10,
    };
  }
  return prepared;
}

function newCriterion(): Criterion {
  return { text: '', origin: 'explicit', needs_operational_definition: false };
}

function newTarget(index: number): Target {
  return {
    id: `target-${Date.now()}-${index}`,
    target_type: '',
    entity_kind: 'unknown',
    description: '',
    geography_mode: 'unspecified',
    geography: [],
    qualification_criteria: [newCriterion()],
    exclusion_criteria: [],
    priority: index === 0 ? 'primary' : 'secondary',
  };
}

function StringListEditor({
  label,
  values,
  placeholder,
  onChange,
  error,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
  error?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={`${label}-${index}`} className="flex gap-2">
            <input
              aria-label={`${label} ${index + 1}`}
              className={fieldClass}
              value={value}
              placeholder={placeholder}
              onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
            />
            <button
              type="button"
              className="rounded-xl border border-white/[0.08] px-3 text-white/40 transition hover:border-red-400/30 hover:text-red-300"
              onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-xs font-medium text-cyan-300 transition hover:text-cyan-200"
          onClick={() => onChange([...values, ''])}
        >
          + Add another
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function CriterionEditor({
  label,
  criteria,
  onChange,
}: {
  label: string;
  criteria: Criterion[];
  onChange: (criteria: Criterion[]) => void;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="space-y-2">
        {criteria.map((criterion, index) => (
          <div key={`${label}-${index}`} className="rounded-xl border border-white/[0.06] bg-black/10 p-3">
            <div className="flex gap-2">
              <input
                aria-label={`${label} ${index + 1}`}
                className={fieldClass}
                value={criterion.text}
                placeholder="Describe the requirement in plain language"
                onChange={(event) => onChange(criteria.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))}
              />
              <button
                type="button"
                className="rounded-xl border border-white/[0.08] px-3 text-white/40 transition hover:border-red-400/30 hover:text-red-300"
                onClick={() => onChange(criteria.filter((_, itemIndex) => itemIndex !== index))}
              >
                Remove
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-white/45">
              <input
                type="checkbox"
                checked={criterion.needs_operational_definition}
                onChange={(event) => onChange(criteria.map((item, itemIndex) => itemIndex === index ? { ...item, needs_operational_definition: event.target.checked } : item))}
              />
              This is still vague and must be defined before it is used as a filter
            </label>
          </div>
        ))}
        <button type="button" className="text-xs font-medium text-cyan-300 hover:text-cyan-200" onClick={() => onChange([...criteria, newCriterion()])}>
          + Add criterion
        </button>
      </div>
    </div>
  );
}

type ProspectField = StructuredBrief['database']['fields'][number];

function ProspectFieldEditor({ fields, onChange }: { fields: ProspectField[]; onChange: (fields: ProspectField[]) => void }) {
  return (
    <div>
      <label className={labelClass}>Prospect record fields</label>
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={`prospect-field-${index}`} className="grid gap-3 rounded-xl border border-white/[0.06] bg-black/10 p-3 md:grid-cols-[1fr_1.5fr_auto]">
            <input
              aria-label={`Prospect field name ${index + 1}`}
              className={fieldClass}
              value={field.name}
              placeholder="Field name"
              onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
            />
            <input
              aria-label={`Prospect field purpose ${index + 1}`}
              className={fieldClass}
              value={field.purpose}
              placeholder="Why the team needs this field"
              onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, purpose: event.target.value } : item))}
            />
            <button type="button" className="rounded-xl border border-white/[0.08] px-3 text-xs text-white/40 hover:border-red-400/30 hover:text-red-300" onClick={() => onChange(fields.filter((_, itemIndex) => itemIndex !== index))}>
              Remove
            </button>
            <div className="flex flex-wrap items-center gap-4 md:col-span-3">
              <label className="flex items-center gap-2 text-xs text-white/45">
                <input type="checkbox" checked={field.required} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item))} />
                Required
              </label>
              <label className="flex items-center gap-2 text-xs text-white/45">
                Expected source
                <select className="rounded-lg border border-white/[0.08] bg-[#111118] px-2 py-1.5 text-xs text-white/70" value={field.expected_source} onChange={(event) => onChange(fields.map((item, itemIndex) => itemIndex === index ? { ...item, expected_source: event.target.value as ProspectField['expected_source'] } : item))}>
                  <option value="research">Research</option>
                  <option value="brief">Brief</option>
                  <option value="human">Human</option>
                  <option value="system">System</option>
                  <option value="personalization">Personalisation</option>
                </select>
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="text-xs font-medium text-cyan-300 hover:text-cyan-200"
          onClick={() => onChange([...fields, { name: '', required: false, purpose: '', expected_source: 'research' }])}
        >
          + Add prospect field
        </button>
      </div>
    </div>
  );
}

function Section({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-xs font-semibold text-cyan-300">{number}</span>
        <div>
          <h3 className="text-base font-semibold text-white/90">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-white/40">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function CampaignConfigurationForm({
  initialBrief,
  originalBrief,
  submitLabel,
  submitting = false,
  serverError,
  onCancel,
  onSubmit,
}: CampaignConfigurationFormProps) {
  const [draft, setDraft] = useState<StructuredBrief>(() => prepareBrief(initialBrief));
  const [showOriginal, setShowOriginal] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const validation = useMemo(() => validateResearchReadyConfiguration(draft), [draft]);
  const errors = useMemo(() => new Map(validation.errors.map((issue) => [issue.path, issue.message])), [validation.errors]);
  const searchSettings = draft.research.search_settings!;

  const updateTarget = (index: number, update: (target: Target) => Target) => {
    setDraft((current) => ({ ...current, targets: current.targets.map((target, targetIndex) => targetIndex === index ? update(target) : target) }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttemptedSubmit(true);
    if (!validation.ok) return;
    const cleaned = structuredClone(draft);
    cleaned.project.secondary_objectives = unique(cleaned.project.secondary_objectives);
    cleaned.project.success_metrics = unique(cleaned.project.success_metrics);
    cleaned.research.required_fields = unique(cleaned.research.required_fields);
    cleaned.research.preferred_source_types = unique(cleaned.research.preferred_source_types);
    cleaned.database.fields = cleaned.database.fields.map((field) => ({ ...field, name: field.name.trim(), purpose: field.purpose.trim() }));
    cleaned.research.search_settings = {
      ...cleaned.research.search_settings!,
      keywords: unique(cleaned.research.search_settings!.keywords),
      excluded_keywords: unique(cleaned.research.search_settings!.excluded_keywords),
      preferred_domains: unique(cleaned.research.search_settings!.preferred_domains),
      excluded_domains: unique(cleaned.research.search_settings!.excluded_domains),
    };
    cleaned.targets = cleaned.targets.map((target) => ({
      ...target,
      geography: target.geography_mode === 'unrestricted' ? [] : unique(target.geography),
      qualification_criteria: target.qualification_criteria.filter((criterion) => criterion.text.trim()),
      exclusion_criteria: target.exclusion_criteria.filter((criterion) => criterion.text.trim()),
    }));
    await onSubmit(cleaned);
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Human review required</p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
                  MARCOM extracted these details from the brief. Correct anything that is wrong and complete the required fields before saving. No prospect search starts from this screen.
                </p>
              </div>
              {originalBrief && (
                <button type="button" className="text-xs font-medium text-white/55 hover:text-white" onClick={() => setShowOriginal((value) => !value)}>
                  {showOriginal ? 'Hide original brief' : 'View original brief'}
                </button>
              )}
            </div>
            {showOriginal && originalBrief && (
              <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/20 p-4 font-sans text-xs leading-5 text-white/50">{originalBrief}</pre>
            )}
          </div>

          {(serverError || (attemptedSubmit && !validation.ok)) && (
            <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-200">
              <p className="font-medium">The campaign cannot be saved yet.</p>
              {serverError && <p className="mt-1 text-xs text-red-200/80">{serverError}</p>}
              {attemptedSubmit && validation.errors.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-200/80">
                  {validation.errors.map((issue) => <li key={issue.path}>{issue.message}</li>)}
                </ul>
              )}
            </div>
          )}

          <Section number="01" title="Campaign overview" description="The information that identifies the campaign and explains what success should achieve.">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="campaign-name" className={labelClass}>Campaign name *</label>
                <input id="campaign-name" className={fieldClass} value={draft.project.name ?? ''} onChange={(event) => setDraft((current) => ({ ...current, project: { ...current.project, name: event.target.value } }))} />
                {attemptedSubmit && errors.get('project.name') && <p className="mt-2 text-xs text-red-300">{errors.get('project.name')}</p>}
              </div>
              <div>
                <label htmlFor="primary-objective" className={labelClass}>Primary objective *</label>
                <input id="primary-objective" className={fieldClass} value={draft.project.primary_objective} onChange={(event) => setDraft((current) => ({ ...current, project: { ...current.project, primary_objective: event.target.value } }))} />
                {attemptedSubmit && errors.get('project.primary_objective') && <p className="mt-2 text-xs text-red-300">{errors.get('project.primary_objective')}</p>}
              </div>
              <div className="md:col-span-2">
                <label htmlFor="campaign-description" className={labelClass}>Campaign summary</label>
                <textarea id="campaign-description" rows={4} className={fieldClass} value={draft.project.description} onChange={(event) => setDraft((current) => ({ ...current, project: { ...current.project, description: event.target.value } }))} />
              </div>
              <StringListEditor label="Additional objectives" values={draft.project.secondary_objectives} placeholder="Add another objective" onChange={(values) => setDraft((current) => ({ ...current, project: { ...current.project, secondary_objectives: values } }))} />
              <StringListEditor label="Success measures" values={draft.project.success_metrics} placeholder="How will the team know this worked?" onChange={(values) => setDraft((current) => ({ ...current, project: { ...current.project, success_metrics: values } }))} />
            </div>
          </Section>

          <Section number="02" title="Target audiences" description="Define who or what the research should find. Each target group becomes a selectable research stream.">
            <div className="space-y-5">
              {draft.targets.map((target, index) => (
                <div key={target.id} className="rounded-2xl border border-white/[0.07] bg-black/10 p-5">
                  <div className="mb-5 flex items-center justify-between">
                    <p className="text-sm font-medium text-white/80">Target group {index + 1}</p>
                    {draft.targets.length > 1 && <button type="button" className="text-xs text-red-300/70 hover:text-red-200" onClick={() => setDraft((current) => ({ ...current, targets: current.targets.filter((_, targetIndex) => targetIndex !== index) }))}>Remove target</button>}
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className={labelClass}>Target audience *</label>
                      <input className={fieldClass} value={target.target_type} placeholder="Example: independent book reviewers" onChange={(event) => updateTarget(index, (current) => ({ ...current, target_type: event.target.value }))} />
                      {attemptedSubmit && errors.get(`targets.${index}.target_type`) && <p className="mt-2 text-xs text-red-300">{errors.get(`targets.${index}.target_type`)}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Entity type *</label>
                        <select className={fieldClass} value={target.entity_kind} onChange={(event) => updateTarget(index, (current) => ({ ...current, entity_kind: event.target.value as Target['entity_kind'] }))}>
                          <option className="bg-gray-950" value="unknown">Choose type</option>
                          <option className="bg-gray-950" value="person">People</option>
                          <option className="bg-gray-950" value="organisation">Organisations</option>
                          <option className="bg-gray-950" value="either">People or organisations</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Priority</label>
                        <select className={fieldClass} value={target.priority} onChange={(event) => updateTarget(index, (current) => ({ ...current, priority: event.target.value as Target['priority'] }))}>
                          {['primary', 'secondary', 'tertiary', 'unspecified'].map((value) => <option className="bg-gray-950" value={value} key={value}>{value}</option>)}
                        </select>
                      </div>
                      {attemptedSubmit && errors.get(`targets.${index}.entity_kind`) && <p className="col-span-2 text-xs text-red-300">{errors.get(`targets.${index}.entity_kind`)}</p>}
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelClass}>Description</label>
                      <textarea rows={3} className={fieldClass} value={target.description} placeholder="Describe who belongs in this target group" onChange={(event) => updateTarget(index, (current) => ({ ...current, description: event.target.value }))} />
                    </div>
                    <div>
                      <label className={labelClass}>Geographic scope *</label>
                      <select className={fieldClass} value={target.geography_mode ?? 'unspecified'} onChange={(event) => updateTarget(index, (current) => ({ ...current, geography_mode: event.target.value as Target['geography_mode'], geography: event.target.value === 'unrestricted' ? [] : current.geography }))}>
                        <option className="bg-gray-950" value="unspecified">Choose scope</option>
                        <option className="bg-gray-950" value="specified">Specific locations</option>
                        <option className="bg-gray-950" value="unrestricted">No geographic restriction</option>
                      </select>
                      {attemptedSubmit && errors.get(`targets.${index}.geography_mode`) && <p className="mt-2 text-xs text-red-300">{errors.get(`targets.${index}.geography_mode`)}</p>}
                    </div>
                    {target.geography_mode === 'specified' && (
                      <StringListEditor label="Locations *" values={target.geography} placeholder="Country, region, or city" onChange={(values) => updateTarget(index, (current) => ({ ...current, geography: values }))} error={attemptedSubmit ? errors.get(`targets.${index}.geography`) : undefined} />
                    )}
                    <div className="md:col-span-2 grid gap-5 md:grid-cols-2">
                      <CriterionEditor label="Must-have criteria" criteria={target.qualification_criteria} onChange={(criteria) => updateTarget(index, (current) => ({ ...current, qualification_criteria: criteria }))} />
                      <CriterionEditor label="Exclusion criteria" criteria={target.exclusion_criteria} onChange={(criteria) => updateTarget(index, (current) => ({ ...current, exclusion_criteria: criteria }))} />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" className="rounded-xl border border-dashed border-cyan-400/25 px-4 py-3 text-xs font-medium text-cyan-300 hover:bg-cyan-400/[0.05]" onClick={() => setDraft((current) => ({ ...current, targets: [...current.targets, newTarget(current.targets.length)] }))}>
                + Add target audience
              </button>
            </div>
          </Section>

          <Section number="03" title="Research setup" description="These values become the default inputs for a bounded search. They remain editable before every research run.">
            <div className="grid gap-5 md:grid-cols-2">
              <StringListEditor label="Search keywords and phrases *" values={searchSettings.keywords} placeholder="Example: emerging poet" onChange={(values) => setDraft((current) => ({ ...current, research: { ...current.research, search_settings: { ...current.research.search_settings!, keywords: values } } }))} error={attemptedSubmit ? errors.get('research.search_settings.keywords') : undefined} />
              <StringListEditor label="Excluded keywords" values={searchSettings.excluded_keywords} placeholder="Results containing this should be excluded" onChange={(values) => setDraft((current) => ({ ...current, research: { ...current.research, search_settings: { ...current.research.search_settings!, excluded_keywords: values } } }))} />
              <StringListEditor label="Preferred websites" values={searchSettings.preferred_domains} placeholder="example.org" onChange={(values) => setDraft((current) => ({ ...current, research: { ...current.research, search_settings: { ...current.research.search_settings!, preferred_domains: values } } }))} />
              <StringListEditor label="Excluded websites" values={searchSettings.excluded_domains} placeholder="example.org" onChange={(values) => setDraft((current) => ({ ...current, research: { ...current.research, search_settings: { ...current.research.search_settings!, excluded_domains: values } } }))} />
              <div>
                <label htmlFor="result-limit" className={labelClass}>Default maximum results *</label>
                <input id="result-limit" type="number" min={1} max={25} className={fieldClass} value={searchSettings.default_result_limit} onChange={(event) => setDraft((current) => ({ ...current, research: { ...current.research, search_settings: { ...current.research.search_settings!, default_result_limit: Number(event.target.value) } } }))} />
                <p className="mt-2 text-xs leading-5 text-white/35">The live provider currently supports a maximum of 25 results per request.</p>
                {attemptedSubmit && errors.get('research.search_settings.default_result_limit') && <p className="mt-2 text-xs text-red-300">{errors.get('research.search_settings.default_result_limit')}</p>}
              </div>
              <StringListEditor label="Preferred source types" values={draft.research.preferred_source_types} placeholder="Example: official website" onChange={(values) => setDraft((current) => ({ ...current, research: { ...current.research, preferred_source_types: values } }))} />
            </div>
          </Section>

          <Section number="04" title="Research outputs and prospect fields" description="Define what research should answer and which fields each prospect record should contain. Missing information remains unknown rather than being invented.">
            <div className="space-y-7">
              <StringListEditor label="Questions or information research must cover" values={draft.research.required_fields} placeholder="Example: relevant experience and current role" onChange={(values) => setDraft((current) => ({ ...current, research: { ...current.research, required_fields: values } }))} />
              <div className="border-t border-white/[0.06] pt-6">
                <ProspectFieldEditor fields={draft.database.fields} onChange={(fields) => setDraft((current) => ({ ...current, database: { fields } }))} />
                {attemptedSubmit && errors.get('database.fields') && <p className="mt-2 text-xs text-red-300">{errors.get('database.fields')}</p>}
              </div>
            </div>
          </Section>

          {draft.unknowns_requiring_confirmation.length > 0 && (
            <Section number="05" title="Questions from the analysis" description="These are details the analyser could not confirm. Resolve the relevant field above, then dismiss the question.">
              <div className="space-y-3">
                {draft.unknowns_requiring_confirmation.map((unknown, index) => (
                  <div key={`${unknown.topic}-${index}`} className="flex items-start justify-between gap-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white/80">{unknown.topic}</p>
                        {unknown.blocking && <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">Important</span>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-white/45">{unknown.reason}</p>
                    </div>
                    <button type="button" className="shrink-0 text-xs text-white/45 hover:text-white" onClick={() => setDraft((current) => ({ ...current, unknowns_requiring_confirmation: current.unknowns_requiring_confirmation.filter((_, unknownIndex) => unknownIndex !== index) }))}>
                      Mark resolved
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.07] bg-[#0d0d12]/95 px-6 py-4 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <p className="hidden text-xs text-white/35 md:block">
            {validation.ok ? 'Required research fields are complete.' : `${validation.errors.length} required item${validation.errors.length === 1 ? '' : 's'} need attention.`}
          </p>
          <div className="ml-auto flex gap-3">
            <SecondaryButton type="button" onClick={onCancel} disabled={submitting}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" disabled={submitting}>{submitting ? 'Saving...' : submitLabel}</PrimaryButton>
          </div>
        </div>
      </div>
    </form>
  );
}
