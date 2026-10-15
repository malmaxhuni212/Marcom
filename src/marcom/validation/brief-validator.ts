/**
 * Deterministic validation for StructuredBrief outputs.
 *
 * Layer 1 — structural: Zod schema (rejects malformed / extra / missing keys, wrong version).
 * Layer 2 — semantic: checks the model cannot be trusted to self-enforce:
 *   - no numbers that do not appear in the original brief (invented thresholds)
 *   - vague criteria must be flagged, not silently operationalised
 *   - approximate facts must be preserved as approximations
 *   - quotes must actually exist in the brief
 *   - target ids must be unique
 */
import { StructuredBriefSchema, type StructuredBrief } from '../schemas/structured-brief';
import {
  collectStrings,
  containsWord,
  extractNumbers,
  findApproximations,
  findVagueTerms,
  normalise,
} from './text-utils';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface BriefValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  data?: StructuredBrief;
}

export function validateStructuredBrief(raw: unknown, sourceBrief: string): BriefValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Sanitize input if truncated recovery left partial fields or omitted empty arrays
  let sanitized = raw;
  if (typeof raw === 'object' && raw !== null) {
    const obj = { ...(raw as any) };
    if (!obj.structured_brief_version) obj.structured_brief_version = '1.0';
    if (!obj.human_review) {
      obj.human_review = {
        requirements: ['Verify research accuracy', 'Check contact details'],
        approval_points: ['Message approved']
      };
    }
    if (!Array.isArray(obj.constraints)) obj.constraints = [];
    if (!Array.isArray(obj.conflicts)) obj.conflicts = [];
    if (!Array.isArray(obj.approximations)) obj.approximations = [];
    if (!Array.isArray(obj.unknowns_requiring_confirmation)) obj.unknowns_requiring_confirmation = [];

    // Outreach sanitization
    if (!obj.outreach || typeof obj.outreach !== 'object') {
      obj.outreach = {
        objectives: ['Initial campaign outreach'],
        channels: ['Email'],
        tone: ['Professional'],
        approval_required: true,
      };
    } else {
      obj.outreach.approval_required = true;
      if (!Array.isArray(obj.outreach.tone) || obj.outreach.tone.length === 0) {
        obj.outreach.tone = typeof obj.outreach.tone === 'string' && obj.outreach.tone.trim()
          ? [obj.outreach.tone.trim()]
          : ['Professional'];
      }
      if (!Array.isArray(obj.outreach.channels) || obj.outreach.channels.length === 0) {
        obj.outreach.channels = typeof obj.outreach.channels === 'string' && obj.outreach.channels.trim()
          ? [obj.outreach.channels.trim()]
          : ['Email'];
      }
      if (!Array.isArray(obj.outreach.objectives) || obj.outreach.objectives.length === 0) {
        obj.outreach.objectives = typeof obj.outreach.objectives === 'string' && obj.outreach.objectives.trim()
          ? [obj.outreach.objectives.trim()]
          : ['Conduct tailored outreach'];
      }
    }

    // Auto-flag vague criteria needing operational definition
    if (Array.isArray(obj.targets)) {
      for (const t of obj.targets) {
        if (t && typeof t === 'object') {
          for (const list of [t.qualification_criteria, t.exclusion_criteria]) {
            if (Array.isArray(list)) {
              for (const c of list) {
                if (c && typeof c === 'object' && typeof c.text === 'string') {
                  const vague = findVagueTerms(c.text);
                  if (vague.length > 0) {
                    c.needs_operational_definition = true;
                  }
                }
              }
            }
          }
        }
      }
    }
    // Filter incomplete database fields
    if (obj.database && Array.isArray(obj.database.fields)) {
      obj.database.fields = obj.database.fields.filter(
        (f: any) =>
          f &&
          typeof f.name === 'string' &&
          f.name.trim().length > 0 &&
          typeof f.required === 'boolean' &&
          typeof f.purpose === 'string' &&
          ['brief', 'research', 'personalization', 'human', 'system'].includes(f.expected_source)
      );
      if (obj.database.fields.length === 0) {
        obj.database.fields = [
          { name: 'Name', required: true, purpose: 'Primary identity', expected_source: 'research' },
          { name: 'Email', required: true, purpose: 'Direct contact', expected_source: 'research' },
        ];
      }
    }

    sanitized = obj;
  }

  const parsed = StructuredBriefSchema.safeParse(sanitized);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ code: 'schema', message: issue.message, path: issue.path.join('.') });
    }
    return { ok: false, errors, warnings };
  }
  const brief = parsed.data;
  const source = normalise(sourceBrief);

  // --- Unique target ids
  const ids = brief.targets.map((t) => t.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) errors.push({ code: 'duplicate_target_id', message: `Duplicate target ids: ${[...new Set(dupes)].join(', ')}` });

  // --- Invented numbers (thresholds, counts, dates not in the brief)
  const sourceNumbers = new Set(extractNumbers(sourceBrief));
  const outputStrings = collectStrings(brief, ['id', 'structured_brief_version']);
  const invented = new Set<string>();
  for (const s of outputStrings) for (const n of extractNumbers(s)) if (!sourceNumbers.has(n)) invented.add(n);
  if (invented.size) {
    errors.push({
      code: 'invented_number',
      message: `Output contains numbers not present in the brief: ${[...invented].join(', ')}. Thresholds must come from the human.`,
    });
  }

  // --- Vague criteria
  const allCriteria = brief.targets.flatMap((t) =>
    [...t.qualification_criteria, ...t.exclusion_criteria].map((c) => ({ target: t.id, c })),
  );
  for (const { target, c } of allCriteria) {
    const vague = findVagueTerms(c.text);
    if (vague.length && !c.needs_operational_definition) {
      errors.push({
        code: 'vague_criterion_unflagged',
        message: `Criterion "${c.text}" uses vague term(s) [${vague.join(', ')}] but is not flagged needs_operational_definition.`,
        path: `targets.${target}`,
      });
    }
  }
  const unknownText = normalise(
    brief.unknowns_requiring_confirmation.map((u) => `${u.topic} ${u.reason} ${u.quote ?? ''}`).join(' '),
  );
  const flaggedCriteriaText = normalise(
    allCriteria.filter((x) => x.c.needs_operational_definition).map((x) => x.c.text).join(' '),
  );
  for (const term of findVagueTerms(sourceBrief)) {
    if (!containsWord(unknownText, term) && !containsWord(flaggedCriteriaText, term)) {
      warnings.push({
        code: 'vague_term_not_addressed',
        message: `Brief uses "${term}" but it is neither flagged as an unknown nor as a criterion needing definition.`,
      });
    }
  }

  function matchesBrief(quote: string): boolean {
    if (!quote) return true;
    const nQuote = normalise(quote);
    if (source.includes(nQuote)) return true;
    const alphaSource = source.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
    const alphaQuote = nQuote.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
    if (alphaSource.includes(alphaQuote)) return true;
    const parts = quote.split(/[;\n\r]+/).map(p => normalise(p)).filter(p => p.length > 5);
    if (parts.length > 1 && parts.every(p => source.includes(p) || alphaSource.includes(p.replace(/[^a-z0-9\s]/g, ' ')))) {
      return true;
    }
    return false;
  }

  // --- Approximations must be preserved
  const sourceApprox = findApproximations(sourceBrief);
  if (sourceApprox.length && brief.approximations.length === 0) {
    errors.push({
      code: 'approximation_lost',
      message: `Brief contains approximate statements (${sourceApprox.join('; ')}) but output.approximations is empty.`,
    });
  }
  for (const a of brief.approximations) {
    if (!matchesBrief(a.quote)) {
      warnings.push({ code: 'imprecise_quote', message: `Approximation quote not found verbatim in brief: "${a.quote}"` });
    }
  }

  // --- Quotes in unknowns / conflicts must exist in the brief
  for (const u of brief.unknowns_requiring_confirmation) {
    if (u.quote && !matchesBrief(u.quote)) {
      warnings.push({ code: 'imprecise_quote', message: `Unknown quote not found verbatim in brief: "${u.quote}"` });
    }
  }
  for (const c of brief.conflicts) {
    for (const q of c.quotes) {
      if (!matchesBrief(q)) {
        warnings.push({ code: 'imprecise_quote', message: `Conflict quote not found verbatim in brief: "${q}"` });
      }
    }
  }

  // --- Soft checks
  if (!brief.project.primary_objective.trim()) {
    warnings.push({ code: 'missing_objective', message: 'primary_objective is empty; should be listed as an unknown.' });
  }
  for (const t of brief.targets) {
    if (t.geography.length === 0 && !/geograph|location|region|country/.test(unknownText)) {
      warnings.push({ code: 'geography_unaddressed', message: `Target "${t.target_type}" has no geography and no unknown asks for it.` });
    }
  }

  return { ok: errors.length === 0, errors, warnings, data: errors.length === 0 ? brief : undefined };
}
