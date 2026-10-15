/**
 * Model-provider abstraction.
 *
 * Agents never call a vendor SDK directly. They receive an `LLMProvider`.
 * Real providers (Anthropic, OpenAI, Gemini, ...) will be added here later; per the
 * provider implementation may be replaced without changing agent workflows.
 *
 * Available now:
 *  - `UnconfiguredProvider`: throws, so nothing silently pretends to be an LLM.
 *  - Offline baselines (see agents/*\/baseline-provider.ts): deterministic rule-based
 *    stand-ins used to exercise the full pipeline (prompt -> parse -> validate -> evaluate).
 *  - `GroqProvider`: the currently configured live implementation.
 */

export interface LLMRequest {
  system: string;
  user: string;
  /** JSON schema the response must satisfy (passed to providers that support structured output). */
  responseSchema?: unknown;
  /** Optional completion budget (providers fall back to their own default). */
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model?: string;
  /** Returns the raw text response. Callers are responsible for parsing and validation. */
  complete(request: LLMRequest): Promise<string>;
}

export class UnconfiguredProvider implements LLMProvider {
  readonly name = 'unconfigured';
  async complete(): Promise<string> {
    throw new Error(
      'No LLM provider configured. Real model calls are intentionally not implemented in this phase. ' +
        'Use an offline baseline provider for tests.',
    );
  }
}

/** Extracts the first JSON object from a model response (tolerates ```json fences / prose / truncation). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('{');
  if (start === -1) throw new Error('Response contains no JSON object.');

  // Try direct parse from start to last closing brace
  const end = candidate.lastIndexOf('}');
  if (end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // Direct parse failed, fall through to auto-repair
    }
  }

  // Attempt auto-repair for truncated JSON
  const raw = candidate.slice(start);
  const repaired = autoCloseJson(raw);
  return JSON.parse(repaired);
}

function autoCloseJson(raw: string): string {
  let s = raw.trim();
  
  // Clean up trailing incomplete property assignments e.g. `,"key":` or `,"key"` or `,`
  s = s.replace(/,\s*"[^"]*":?\s*$/, '');
  s = s.replace(/:\s*"[^"]*$/, ': ""');

  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] === ch) stack.pop();
      }
    }
  }

  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  while (stack.length) s += stack.pop();
  return s;
}
