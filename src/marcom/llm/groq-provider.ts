import { LLMProvider, LLMRequest } from './provider';
import { KeyPool } from './key-pool';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODELS = [
  'llama-3.1-70b-versatile',
  'llama3-70b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'llama-3.1-8b-instant'
];

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
}

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
  readonly model = GROQ_MODELS[0];

  constructor() {}

  /** POST with automatic wait-and-retry on 429 using KeyPool. */
  private async post(payload: Record<string, unknown>, opts: GroqCallOptions = {}): Promise<any> {
    const maxRetries = opts.maxRetries ?? 15;
    let modelIndex = 0;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const apiKey = await KeyPool.getAvailableKey(opts.onWait);
      const currentModel = GROQ_MODELS[modelIndex % GROQ_MODELS.length];
      const body = { ...payload, model: currentModel };
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
      if (response.status === 429 || response.status === 413 || response.status === 404) {
        const wait = response.status === 413 ? 60 : Math.min(parseRetrySeconds(response, errorText), 65);
        if (response.status !== 404) KeyPool.markRateLimited(apiKey, wait);
        modelIndex++;
        continue;
      }
      throw new Error(`Groq API Error (${response.status}): ${errorText}`);
    }
    throw new Error('Groq API Error: Max retries exceeded across all keys.');
  }

  async complete(request: LLMRequest, opts?: GroqCallOptions): Promise<string> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const data = await this.post({
        
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ],
        temperature: 0.1 + (attempt * 0.1), // slightly higher temp on retry
        max_tokens: request.maxTokens ?? 5200
      }, opts);

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


