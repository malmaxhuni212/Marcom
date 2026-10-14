import { LLMProvider, LLMRequest } from './provider';
import { getKeyPool, type KeyPoolName } from './key-pool';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'openai/gpt-oss-20b';

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
}

const isReasoningModel = (model: string) => model.startsWith('openai/gpt-oss');

function parseRetrySeconds(res: Response, body: string): number {
  const header = res.headers.get('retry-after');
  if (header && !Number.isNaN(Number(header))) return Math.ceil(Number(header));
  const m = body.match(/try again in\s+(?:(\d+)m)?([\d.]+)s/i);
  if (m) return Math.ceil((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]));
  return 20;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  readonly model: string;
  private readonly pool: KeyPoolName;

  constructor(options: GroqProviderOptions = {}) {
    this.model = options.model ?? GROQ_MODEL;
    this.pool = options.pool ?? 'research';
  }

  /** POST with automatic wait-and-retry on 429 using the configured key pool. */
  private async post(payload: Record<string, unknown>, opts: GroqCallOptions = {}): Promise<any> {
    const maxRetries = opts.maxRetries ?? 15;
    const keyPool = getKeyPool(this.pool);
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const apiKey = await keyPool.getAvailableKey(opts.onWait);
      const body = payload;
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
      });
      if (response.ok) return response.json();
      const errorText = await response.text();
      if (response.status === 429 || response.status === 413) {
        const wait = response.status === 413 ? 60 : Math.min(parseRetrySeconds(response, errorText), 65);
        keyPool.markRateLimited(apiKey, wait);
        continue;
      }
      throw new Error(`Groq API Error (${response.status}): ${errorText}`);
    }
    throw new Error('Groq API Error: Max retries exceeded across all keys.');
  }

  async complete(request: LLMRequest, opts?: GroqCallOptions): Promise<string> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const payload: Record<string, unknown> = {
        model: this.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ],
        temperature: opts?.temperature ?? 0.1 + (attempt * 0.1), // slightly higher temp on retry
        max_tokens: request.maxTokens ?? 5200
      };
      if (opts?.jsonMode) payload.response_format = { type: 'json_object' };
      if (opts?.reasoningEffort && isReasoningModel(this.model)) payload.reasoning_effort = opts.reasoningEffort;

      const data = await this.post(payload, opts);

      const text = data.choices?.[0]?.message?.content;
      if (text) return text;
      
      console.warn(`Groq returned empty text on attempt ${attempt}. Full response:`, JSON.stringify(data));
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
        { role: 'user', content: request.user }
      ],
      tools: [{ type: 'browser_search' }],
      tool_choice: 'required',
      temperature: 0.2,
      reasoning_effort: 'low',
      max_tokens: request.maxTokens ?? 3500,
    }, opts);

    const message = data.choices?.[0]?.message ?? {};
    const executed: any[] = message.executed_tools ?? [];
    const seen: SeenSource[] = [];
    const pages: { url: string; text: string }[] = [];
    const queries: string[] = [];
    const toolTextParts: string[] = [];

    for (const tool of executed) {
      const isSearch = String(tool.name ?? tool.type ?? '').includes('search');
      if (isSearch) {
        try {
          const q = JSON.parse(tool.arguments ?? '{}').query;
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



