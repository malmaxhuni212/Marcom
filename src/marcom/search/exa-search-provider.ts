import { z } from 'zod';
import { SearchProviderError } from './errors';
import {
  SearchRequestSchema,
  SearchResponseSchema,
  type SearchCapabilities,
  type SearchContext,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from './provider';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';

const ExaResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      url: z.string().min(1),
      title: z.string().nullish(),
      author: z.string().nullish(),
      publishedDate: z.string().nullish(),
      text: z.string().nullish(),
      highlights: z.array(z.string()).nullish(),
      score: z.number().nullish(),
    }),
  ),
  requestId: z.string().nullish(),
  searchTime: z.number().nullish(),
  costDollars: z.object({ total: z.number().nonnegative().nullish() }).nullish(),
});

export interface ExaSearchProviderOptions {
  apiKeys: string[];
  maximumResults: number;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
}

export class ExaSearchProvider implements SearchProvider {
  readonly key = 'exa';
  readonly #apiKeys: string[];
  readonly #maximumResults: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ExaSearchProviderOptions) {
    this.#apiKeys = options.apiKeys;
    this.#maximumResults = Math.min(100, Math.max(1, options.maximumResults));
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  capabilities(): SearchCapabilities {
    return { maximumResults: this.#maximumResults, supportsDomainFilters: true, supportsCategory: true };
  }

  async search(rawRequest: SearchRequest, context: SearchContext = {}): Promise<SearchResponse> {
    const request = SearchRequestSchema.parse(rawRequest);
    if (request.resultLimit > this.#maximumResults) {
      throw new SearchProviderError(
        'invalid_request',
        `Requested ${request.resultLimit} results, but the configured maximum is ${this.#maximumResults}.`,
        false,
      );
    }
    if (request.category && request.excludeDomains.length) {
      throw new SearchProviderError(
        'invalid_request',
        'Exa does not support excludeDomains with the people or company category.',
        false,
      );
    }

    const warnings: string[] = [];
    const body: Record<string, unknown> = {
      query: request.query,
      type: 'auto',
      numResults: request.resultLimit,
      moderation: true,
      contents: { highlights: true },
    };
    if (request.includeDomains.length) body.includeDomains = request.includeDomains;
    if (request.excludeDomains.length) body.excludeDomains = request.excludeDomains;
    if (request.category) body.category = request.category;

    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const signal = context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal;
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await this.#fetch(EXA_SEARCH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.#apiKeys[0] },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new SearchProviderError('timeout', 'Exa search exceeded its deadline.', true, { cause: error });
      }
      throw new SearchProviderError('unavailable', 'Exa search could not be reached.', true, { cause: error });
    }

    if (!response.ok) throw mapExaHttpError(response.status);

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      throw new SearchProviderError('invalid_response', 'Exa returned invalid JSON.', false, { cause: error });
    }

    const parsed = ExaResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SearchProviderError('invalid_response', 'Exa returned an unexpected response shape.', false);
    }

    const candidates = parsed.data.results.flatMap((result) => {
      if (!isSafePublicUrl(result.url)) {
        warnings.push(`Discarded an unsafe result URL from Exa result ${result.id}.`);
        return [];
      }
      return [
        {
          providerResultId: result.id,
          url: result.url,
          title: result.title ?? '',
          author: result.author ?? null,
          publishedAt: result.publishedDate ?? null,
          text: (result.text ?? '').slice(0, 12_000),
          highlights: (result.highlights ?? []).slice(0, 12).map((value) => value.slice(0, 2_000)),
          score: result.score ?? null,
        },
      ];
    });

    return SearchResponseSchema.parse({
      providerKey: this.key,
      providerRequestId: parsed.data.requestId ?? null,
      query: request.query,
      candidates,
      latencyMs: Date.now() - startedAt,
      usage: { requests: 1, estimatedCostUsd: parsed.data.costDollars?.total ?? null },
      warnings,
    });
  }
}

function mapExaHttpError(status: number): SearchProviderError {
  if (status === 401 || status === 403) {
    return new SearchProviderError('authentication_failed', 'Exa rejected the configured API key.', false);
  }
  if (status === 402) {
    return new SearchProviderError('payment_required', 'Exa has no available credit for this request.', false);
  }
  if (status === 429) {
    return new SearchProviderError('rate_limited', 'Exa search rate limit was reached.', true);
  }
  if (status >= 500) {
    return new SearchProviderError('unavailable', 'Exa search is temporarily unavailable.', true);
  }
  return new SearchProviderError('invalid_request', `Exa rejected the search request with status ${status}.`, false);
}

function isSafePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
    if (/^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    const match = host.match(/^172\.(\d+)\./);
    if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
    return true;
  } catch {
    return false;
  }
}

