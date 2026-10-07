/**
 * Brief Analyzer — Agent 1.
 *
 * Human brief -> StructuredBrief.
 * Does NOT research. Does NOT write outreach.
 *
 * Pipeline: assemble prompt -> provider.complete -> extract JSON -> deterministic validation
 *           -> (one repair attempt with validation errors) -> accept or reject.
 */
import { extractJson, type LLMProvider } from '../../llm/provider';
import type { StructuredBrief } from '../../schemas/structured-brief';
import { validateStructuredBrief, type ValidationIssue } from '../../validation/brief-validator';
import { loadAgentPrompt, section } from '../prompt-loader';
import type { MemoryContext } from '../../memory/types';

export const BRIEF_START = '<<<BRIEF';
export const BRIEF_END = 'BRIEF>>>';

export interface AnalyzeOptions {
  /** Retrieved organisational context (only the relevant slices — never the whole memory). */
  memory?: Partial<MemoryContext>;
  /** Number of repair attempts after a validation failure. */
  maxRepairs?: number;
}

export type AnalyzeResult =
  | { ok: true; brief: StructuredBrief; warnings: ValidationIssue[]; attempts: number; provider: string }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[]; attempts: number; provider: string; raw?: string };

export function buildUserMessage(humanBrief: string, memory?: Partial<MemoryContext>): string {
  const parts: string[] = [];
  if (memory?.lunim_context) parts.push(section('lunim_context', memory.lunim_context));
  if (memory?.human_decisions && memory.human_decisions.length) parts.push(section('human_decisions', memory.human_decisions));
  if (memory?.relevant_learnings && memory.relevant_learnings.length) parts.push(section('relevant_learnings', memory.relevant_learnings));
  parts.push('Analyse the following human project brief and return ONLY a StructuredBrief JSON object.');
  parts.push(`${BRIEF_START}\n${humanBrief}\n${BRIEF_END}`);
  return parts.join('\n\n');
}

export async function analyzeBrief(
  humanBrief: string,
  provider: LLMProvider,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const { system, schema } = loadAgentPrompt('brief-analyzer');
  const maxRepairs = options.maxRepairs ?? 1;
  let user = buildUserMessage(humanBrief, options.memory);
  let lastErrors: ValidationIssue[] = [];
  let lastWarnings: ValidationIssue[] = [];
  let raw: string | undefined;

  for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
    raw = await provider.complete({ system, user, responseSchema: schema });
    let json: unknown;
    try {
      json = extractJson(raw);
    } catch (e) {
      lastErrors = [{ code: 'unparseable', message: (e as Error).message }];
      user = repairMessage(user, lastErrors);
      continue;
    }
    const result = validateStructuredBrief(json, humanBrief);
    lastWarnings = result.warnings;
    if (result.ok && result.data) {
      return { ok: true, brief: result.data, warnings: result.warnings, attempts: attempt, provider: provider.name };
    }
    lastErrors = result.errors;
    user = repairMessage(user, lastErrors);
  }
  return { ok: false, errors: lastErrors, warnings: lastWarnings, attempts: maxRepairs + 1, provider: provider.name, raw };
}

function repairMessage(previousUser: string, errors: ValidationIssue[]): string {
  return `${previousUser}\n\n${section(
    'validation_errors',
    errors.map((e) => `- [${e.code}] ${e.path ? e.path + ': ' : ''}${e.message}`).join('\n'),
  )}\nYour previous output was rejected. Return a corrected StructuredBrief JSON object only.`;
}
