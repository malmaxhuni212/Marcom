/**
 * Prompt assembly. Keeps the architectural separation explicit:
 *
 *   global rules   (agents/shared/global-rules.md)       -> inherited behaviour
 *   agent prompt   (agents/<agent>/system-prompt.md)     -> what the agent is instructed to do
 *   agent rules    (agents/<agent>/rules.md)             -> agent-specific hard rules
 *   knowledge      (MemoryContext.lunim_context)         -> what Lunim knows (retrieved, not dumped)
 *   project config (StructuredBrief / project memory)    -> what the current project requires
 *   memory         (MemoryContext)                       -> what has happened before
 *   schema         (agents/<agent>/schema.json)          -> what data must be produced
 *
 * Validation is NOT in the prompt — it runs deterministically after the model responds.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = process.cwd();
export const AGENTS_DIR = path.join(REPO_ROOT, 'agents');

export type AgentName = 'brief-analyzer' | 'research';

function read(rel: string): string {
  return readFileSync(path.join(AGENTS_DIR, rel), 'utf8');
}

export function loadAgentPrompt(agent: AgentName): { system: string; schema: unknown } {
  const parts: string[] = [];
  try {
    parts.push(read('shared/global-rules.md'));
  } catch {
    // optional
  }
  try {
    parts.push(read(`${agent}/rules.md`));
  } catch {
    // optional
  }
  parts.push(read(`${agent}/system-prompt.md`));
  const systemPrompt = parts.join('\n\n---\n\n');
  const schema = JSON.parse(read(`${agent}/schema.json`));
  return { system: systemPrompt, schema };
}

/** System prompt only (for agents whose output contract is described inside the prompt). */
export function loadSystemPrompt(agent: AgentName): string {
  return read(`${agent}/system-prompt.md`);
}

export function loadResearchEvidencePrompt(): string {
  return read('research/evidence-system-prompt.md');
}

/** Personalization Agent — Model 1 (Strategist) and Model 2 (Copywriter) system prompts. */
export function loadPersonalizationPrompts(): { strategist: string; writer: string; globalRules: string } {
  return {
    strategist: read('personalization/strategist-system-prompt.md'),
    writer: read('personalization/writer-system-prompt.md'),
    globalRules: read('shared/global-rules.md'),
  };
}

/** Wraps a context section with clear delimiters so the model can tell sources apart. */
export function section(title: string, body: unknown): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return `<${title}>\n${content}\n</${title}>`;
}
