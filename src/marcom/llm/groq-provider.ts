import { LLMProvider, LLMRequest } from './provider';
import { getKeyPool, type KeyPoolName } from './key-pool';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'openai/gpt-oss-20b';
export const DEFAULT_GROQ_TIMEOUT_MS = 45_000;
export const DEFAULT_GROQ_MAX_RETRIES = 8;

/** A page or search hit the Groq browser tool actually returned. Used to verify citations. */
export interface SeenSource {
  url: string;
  title: string;
  /** 'search' = appeared in a search results list, 'page' = the tool opened and read it. */
  via: 'search' | 'page';
}

export interface BrowserSearchResult {
  content: string;
  seen: SeenSource[];
  pages: { url: string; text: string }[];
  toolText: string;
  queries: string[];
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

export interface GroqCallOptions {
  /** Called when we have to wait for the free-tier rate limit window. */
  onWait?: (seconds: number) => void;
  maxRetries?: number;
  /** Per-request HTTP timeout in milliseconds. Defaults to 45s. */
  timeoutMs?: number;
  /** Force Groq JSON mode (response is guaranteed to be a JSON object). */
  jsonMode?: boolean;
  /** Override the default temperature schedule. */
  temperature?: number;
  /** Reasoning effort — only sent to reasoning models (gpt-oss family). */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface GroqProviderOptions {
  /** Groq model id. Defaults to GROQ_MODEL. */
  model?: string;
  /** Which API key pool to draw from. Defaults to 'research'. */
  pool?: KeyPoolName;
  /** Default per-request HTTP timeout in milliseconds. */
  timeoutMs?: number;
  /** Default max retries per call. */
  maxRetries?: number;
  /** Default callback when waiting for rate-limit cooldown. */
  onWait?: (seconds: number) => void;
}

interface GroqExecutedTool {
  name?: unknown;
  type?: unknown;
  arguments?: unknown;
  output?: unknown;
  search_results?: {
    results?: Array<{ url?: unknown; title?: unknown; content?: unknown }>;
  };
}

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      executed_tools?: GroqExecutedTool[];
    };
  }>;
  usage?: BrowserSearchResult['usage'];
}

const isReasoningModel = (model: string) => model.startsWith('openai/gpt-oss');

export function buildGroqCompletionPayload(
  model: string,
  request: LLMRequest,
  attempt: number,
  opts?: GroqCallOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    temperature: opts?.temperature ?? 0.1 + (attempt * 0.1),
    max_tokens: request.maxTokens ?? 5200,
  };
  if (opts?.jsonMode || request.responseSchema !== undefined) {
    payload.response_format = { type: 'json_object' };
  }
  if (opts?.reasoningEffort && isReasoningModel(model)) {
    payload.reasoning_effort = opts.reasoningEffort;
  }
  return payload;
}

/**
 * Shrinks oversized user messages and excess max_tokens when Groq returns HTTP 413
 * (Request Too Large / per-request TPM exceeded) so the retry fits within budget
 * immediately instead of resending the identical oversized payload.
 */
export function shrinkPayloadFor413(
  payload: Record<string, unknown>,
  ratio = 0.7,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  if (Array.isArray(payload.messages)) {
    next.messages = payload.messages.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const msg = entry as { role?: unknown; content?: unknown };
      if (msg.role !== 'user' || typeof msg.content !== 'string' || msg.content.length <= 1_200) {
        return entry;
      }
      const targetLen = Math.max(1_200, Math.floor(msg.content.length * ratio));
      return {
        ...msg,
        content: `${msg.content.slice(0, targetLen)}\n\n[Evidence trimmed to fit request token budget.]`,
      };
    });
  }
  if (typeof payload.max_tokens === 'number' && payload.max_tokens > 2_400) {
    next.max_tokens = Math.max(2_400, Math.floor(payload.max_tokens * 0.85));
  }
  return next;
}

function parseRetrySeconds(res: Response, body: string): number {
  const header = res.headers.get('retry-after');
  if (header && !Number.isNaN(Number(header))) return Math.ceil(Number(header));
  const m = body.match(/try again in\s+(?:(\d+)m)?([\d.]+)s/i);
  if (m) return Math.ceil((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]));
  return 20;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  readonly model: string;
  private readonly pool: KeyPoolName;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly defaultOnWait?: (seconds: number) => void;

  constructor(options: GroqProviderOptions = {}) {
    this.model = options.model ?? GROQ_MODEL;
    this.pool = options.pool ?? 'research';
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_GROQ_TIMEOUT_MS;
    this.defaultMaxRetries = options.maxRetries ?? DEFAULT_GROQ_MAX_RETRIES;
    this.defaultOnWait = options.onWait;
  }

  /** POST with automatic key rotation on 429, payload shrinking on 413, and bounded HTTP timeouts. */
  private async post(payload: Record<string, unknown>, opts: GroqCallOptions = {}): Promise<GroqResponse> {
    const maxRetries = opts.maxRetries ?? this.defaultMaxRetries;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const onWait = opts.onWait ?? this.defaultOnWait;
    const keyPool = getKeyPool(this.pool);

    let currentPayload = payload;
    let shrinkCount = 0;
    let transientFailures = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const apiKey = await keyPool.getAvailableKey(onWait);
      let response: Response;
      try {
        response = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(currentPayload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (networkError) {
        transientFailures += 1;
        if (transientFailures <= 2 && attempt < maxRetries - 1) {
          await delay(1_500);
          continue;
        }
        const reason = networkError instanceof Error ? networkError.message : 'Request timed out or failed';
        throw new Error(`Groq network/timeout error after ${timeoutMs}ms: ${reason}`);
      }

      if (response.ok) return response.json() as Promise<GroqResponse>;
      const errorText = await response.text();

      if (response.status === 413) {
        shrinkCount += 1;
        if (shrinkCount <= 3) {
          currentPayload = shrinkPayloadFor413(currentPayload);
          continue;
        }
        throw new Error(`Groq API Error (413): ${errorText}`);
      }

      if (response.status === 429) {
        const wait = Math.min(parseRetrySeconds(response, errorText), 65);
        keyPool.markRateLimited(apiKey, wait);
        continue;
      }

      if (response.status >= 500 && response.status < 600) {
        transientFailures += 1;
        if (transientFailures <= 2 && attempt < maxRetries - 1) {
          await delay(2_000);
          continue;
        }
      }

      throw new Error(`Groq API Error (${response.status}): ${errorText}`);
    }
    throw new Error('Groq API Error: Max retries exceeded across all keys.');
  }

  async complete(request: LLMRequest, opts?: GroqCallOptions): Promise<string> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const payload = buildGroqCompletionPayload(this.model, request, attempt, opts);

      const data = await this.post(payload, opts);

      const text = data.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.length > 0) return text;

      console.warn(JSON.stringify({
        event: 'ai.provider.empty_completion',
        provider: this.name,
        model: this.model,
        attempt,
      }));
      if (attempt === 3) {
        throw new Error('No text returned from Groq after 3 attempts');
      }
    }
    throw new Error('No text returned from Groq');
  }

  /**
   * Web research via Groq's built-in `browser_search` tool (GPT-OSS only).
   * Structured outputs cannot be combined with browser_search, so the caller parses `content` itself.
   */
  async browserSearch(request: LLMRequest, opts?: GroqCallOptions): Promise<BrowserSearchResult> {
    const data = await this.post({
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      temperature: 0.2,
      reasoning_effort: 'low',
      max_tokens: request.maxTokens ?? 3500,
    }, opts);

    const message = data.choices?.[0]?.message ?? {};
    const executed = message.executed_tools ?? [];
    const seen: SeenSource[] = [];
    const pages: { url: string; text: string }[] = [];
    const queries: string[] = [];
    const toolTextParts: string[] = [];

    for (const tool of executed) {
      const isSearch = String(tool.name ?? tool.type ?? '').includes('search');
      if (isSearch) {
        try {
          const q = JSON.parse(typeof tool.arguments === 'string' ? tool.arguments : '{}').query;
          if (q) queries.push(String(q));
        } catch { /* arguments not JSON — ignore */ }
      }
      for (const r of tool.search_results?.results ?? []) {
        if (r?.url) seen.push({ url: String(r.url), title: String(r.title ?? ''), via: isSearch ? 'search' : 'page' });
        if (r?.content) {
          toolTextParts.push(String(r.content));
          if (r?.url) pages.push({ url: String(r.url), text: String(r.content) });
        }
      }
      if (tool.output) {
        toolTextParts.push(String(tool.output));
        // Opened pages: output begins with "URL: <url>" — attribute the text to that page.
        const m = String(tool.output).match(/URL:\s*\n?\s*(https?:\/\/\S+)/);
        if (!isSearch && m) pages.push({ url: m[1], text: String(tool.output) });
      }
    }

    return {
      content: String(message.content ?? ''),
      seen,
      pages,
      toolText: toolTextParts.join('\n'),
      queries,
      usage: data.usage ?? null,
    };
  }
}
