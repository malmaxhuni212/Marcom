/**
 * Brief Analyzer evaluation harness.
 *
 * Scores a provider's StructuredBrief output against per-example expectations on ten dimensions.
 * All scoring is deterministic keyword/structure matching — it is a coarse proxy, NOT a substitute
 * for human review of outputs. Dimensions with no expectations for an example are reported as N/A
 * and excluded from that example's average.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LLMProvider } from '../llm/provider';
import { extractJson } from '../llm/provider';
import type { StructuredBrief } from '../schemas/structured-brief';
import { analyzeBrief } from '../agents/brief-analyzer/analyzer';
import { validateStructuredBrief } from '../validation/brief-validator';
import { collectStrings, containsWord, DOMAIN_LEAK_TERMS, normalise } from '../validation/text-utils';

export interface BriefExpectation {
  intent_keywords: string[];
  targets: { any_of: string[]; geography?: string[] }[];
  max_targets?: number;
  criteria_keywords: string[];
  exclusion_keywords: string[];
  research_keywords: string[];
  personalization_keywords: string[];
  must_flag_unknowns: string[];
  must_detect_conflict?: boolean;
  must_preserve_approximations?: string[];
  database_fields: string[];
}

export interface BriefExample {
  id: string;
  category: string;
  title: string;
  edge_case: boolean;
  brief: string;
  expected: BriefExpectation;
  notes?: string;
}

export const DIMENSIONS = [
  'intent_preservation',
  'target_extraction',
  'criteria_extraction',
  'exclusion_extraction',
  'research_instructions',
  'personalization_instructions',
  'unknown_handling',
  'database_mapping',
  'reusability',
  'hallucination_avoidance',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface ExampleResult {
  id: string;
  category: string;
  title: string;
  edge_case: boolean;
  accepted: boolean;
  status: 'pass' | 'partial' | 'fail' | 'rejected';
  average: number;
  scores: Record<Dimension, number | null>;
  findings: string[];
  validation_errors: string[];
  validation_warnings: string[];
  output?: StructuredBrief;
}

export function loadExamples(dir: string): BriefExample[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as BriefExample);
}

function keywordRecall(keywords: string[], text: string, label: string, findings: string[]): number | null {
  if (!keywords.length) return null;
  const t = normalise(text);
  const missing = keywords.filter((k) => !t.includes(normalise(k)));
  if (missing.length) findings.push(`${label}: missing [${missing.join(', ')}]`);
  return (keywords.length - missing.length) / keywords.length;
}

export function scoreOutput(example: BriefExample, out: StructuredBrief, validationErrorCodes: string[]): { scores: Record<Dimension, number | null>; findings: string[] } {
  const e = example.expected;
  const findings: string[] = [];
  const crit = (kind: 'qualification_criteria' | 'exclusion_criteria') => out.targets.flatMap((t) => t[kind].map((c) => c.text)).join(' ');

  // target extraction
  let target: number | null = null;
  if (e.targets.length) {
    let hit = 0;
    let geoHit = 0;
    let geoTotal = 0;
    for (const exp of e.targets) {
      const match = out.targets.find((t) => exp.any_of.some((k) => normalise(`${t.target_type} ${t.description}`).includes(normalise(k))));
      if (match) hit++;
      else findings.push(`target_extraction: no target matching [${exp.any_of.join(' | ')}]`);
      if (exp.geography?.length) {
        geoTotal++;
        if (match && exp.geography.some((g) => match.geography.some((mg) => normalise(mg).includes(normalise(g))))) geoHit++;
        else findings.push(`target_extraction: geography [${exp.geography.join(' | ')}] not attached to target`);
      }
    }
    const recall = hit / e.targets.length;
    const geo = geoTotal ? geoHit / geoTotal : 1;
    const max = e.max_targets ?? e.targets.length + 1;
    const precision = out.targets.length > max ? max / out.targets.length : 1;
    if (precision < 1) findings.push(`target_extraction: ${out.targets.length} targets extracted, expected at most ${max} (spurious targets)`);
    target = (0.7 * recall + 0.3 * geo) * precision;
  }

  // unknown handling = flagged unknowns + conflicts + approximations
  const unknownText = out.unknowns_requiring_confirmation.map((u) => `${u.topic} ${u.reason} ${u.quote ?? ''}`).join(' ') +
    ' ' + out.targets.flatMap((t) => t.qualification_criteria.filter((c) => c.needs_operational_definition).map((c) => c.text)).join(' ');
  const parts: number[] = [];
  const u = keywordRecall(e.must_flag_unknowns, unknownText, 'unknown_handling', findings);
  if (u !== null) parts.push(u);
  if (e.must_detect_conflict) {
    const ok = out.conflicts.length > 0;
    if (!ok) findings.push('unknown_handling: conflicting requirements were not reported in `conflicts`');
    parts.push(ok ? 1 : 0);
  }
  if (e.must_preserve_approximations?.length) {
    const a = keywordRecall(e.must_preserve_approximations, out.approximations.map((x) => x.quote).join(' '), 'approximations', findings);
    if (a !== null) parts.push(a);
  }
  const unknownScore = parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : null;

  // reusability: domain terms leaked into output that the brief never mentioned
  const outText = collectStrings(out, ['id', 'structured_brief_version']).join(' ');
  const leaks = DOMAIN_LEAK_TERMS.filter((t) => containsWord(outText, t) && !containsWord(example.brief, t));
  if (leaks.length) findings.push(`reusability: introduced domain terms not in brief [${leaks.join(', ')}]`);
  const reusability = Math.max(0, 1 - leaks.length * 0.25);

  // hallucination avoidance: invented numbers / fabricated quotes / unflagged vague criteria
  const halluCodes = validationErrorCodes.filter((c) => ['invented_number', 'fabricated_quote', 'vague_criterion_unflagged'].includes(c));
  if (halluCodes.length) findings.push(`hallucination_avoidance: validator flagged [${[...new Set(halluCodes)].join(', ')}]`);
  const hallucination = halluCodes.length === 0 ? 1 : Math.max(0, 1 - halluCodes.length * 0.34);

  const scores: Record<Dimension, number | null> = {
    intent_preservation: keywordRecall(
      e.intent_keywords,
      `${out.project.name ?? ''} ${out.project.description} ${out.project.primary_objective} ${out.project.secondary_objectives.join(' ')}`,
      'intent_preservation',
      findings,
    ),
    target_extraction: target,
    criteria_extraction: keywordRecall(e.criteria_keywords, crit('qualification_criteria'), 'criteria_extraction', findings),
    exclusion_extraction: keywordRecall(e.exclusion_keywords, `${crit('exclusion_criteria')} ${out.constraints.join(' ')}`, 'exclusion_extraction', findings),
    research_instructions: keywordRecall(
      e.research_keywords,
      [...out.research.required_fields, ...out.research.preferred_source_types, ...out.research.evidence_requirements, ...out.research.verification_requirements].join(' '),
      'research_instructions',
      findings,
    ),
    personalization_instructions: keywordRecall(
      e.personalization_keywords,
      [...out.personalization.allowed, ...out.personalization.preferred_details, ...out.personalization.tone, ...out.personalization.avoid, ...out.outreach.tone, ...out.outreach.channels].join(' '),
      'personalization_instructions',
      findings,
    ),
    unknown_handling: unknownScore,
    database_mapping: keywordRecall(e.database_fields, out.database.fields.map((f) => f.name).join(' | '), 'database_mapping', findings),
    reusability,
    hallucination_avoidance: hallucination,
  };
  return { scores, findings };
}

function average(scores: Record<Dimension, number | null>): number {
  const vals = Object.values(scores).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

export async function evaluateExample(example: BriefExample, provider: LLMProvider): Promise<ExampleResult> {
  const result = await analyzeBrief(example.brief, provider, { maxRepairs: 0 });
  const base = { id: example.id, category: example.category, title: example.title, edge_case: example.edge_case };

  // Even when rejected, score the raw output for diagnostics (if it parses + passes schema).
  let output: StructuredBrief | undefined = result.ok ? result.brief : undefined;
  let errorCodes: string[] = [];
  let errors: string[] = [];
  let warnings = result.warnings.map((w) => `[${w.code}] ${w.message}`);
  if (!result.ok) {
    errors = result.errors.map((x) => `[${x.code}] ${x.path ? x.path + ': ' : ''}${x.message}`);
    errorCodes = result.errors.map((x) => x.code);
    if (result.raw) {
      try {
        const json = extractJson(result.raw) as StructuredBrief;
        const v = validateStructuredBrief(json, example.brief);
        if (!errorCodes.includes('schema')) output = json;
        warnings = v.warnings.map((w) => `[${w.code}] ${w.message}`);
      } catch {
        /* unparseable */
      }
    }
  }

  if (!output) {
    const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
    return { ...base, accepted: false, status: 'rejected', average: 0, scores, findings: ['Output unusable (schema failure)'], validation_errors: errors, validation_warnings: warnings };
  }
  const { scores, findings } = scoreOutput(example, output, errorCodes);
  const avg = average(scores);
  const status: ExampleResult['status'] = !result.ok ? 'rejected' : avg >= 0.8 ? 'pass' : avg >= 0.6 ? 'partial' : 'fail';
  return { ...base, accepted: result.ok, status, average: avg, scores, findings, validation_errors: errors, validation_warnings: warnings, output };
}

export async function evaluateAll(examples: BriefExample[], provider: LLMProvider) {
  const results: ExampleResult[] = [];
  for (const ex of examples) results.push(await evaluateExample(ex, provider));
  const dimensionAverages = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const vals = results.map((r) => r.scores[d]).filter((v): v is number => v !== null);
      return [d, vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null];
    }),
  ) as Record<Dimension, number | null>;
  const overall = results.reduce((s, r) => s + r.average, 0) / results.length;
  return { provider: provider.name, results, dimensionAverages, overall };
}
