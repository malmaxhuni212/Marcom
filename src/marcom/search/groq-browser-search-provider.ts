import type { GroqProvider } from '../llm/groq-provider';
import {
  SearchRequestSchema,
  SearchResponseSchema,
  type SearchCapabilities,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from './provider';

export class GroqBrowserSearchProvider implements SearchProvider {
  readonly key = 'groq-browser';

  constructor(private readonly provider: GroqProvider) {}

  capabilities(): SearchCapabilities {
    return { maximumResults: 25, supportsDomainFilters: false, supportsCategory: false };
  }

  async search(rawRequest: SearchRequest): Promise<SearchResponse> {
    const request = SearchRequestSchema.parse(rawRequest);
    if (request.resultLimit > this.capabilities().maximumResults) {
      throw new Error(`Groq browser search supports at most ${this.capabilities().maximumResults} results per request.`);
    }
    const startedAt = Date.now();
    const domainGuidance = [
      request.includeDomains.length ? `Prefer these domains: ${request.includeDomains.join(', ')}.` : '',
      request.excludeDomains.length ? `Do not use these domains: ${request.excludeDomains.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const result = await this.provider.browserSearch({
      system:
        'Search the public web for sources matching the query. Return concise notes based only on pages the browser tool actually returns.',
      user: `${request.query}\nReturn at most ${request.resultLimit} useful results. ${domainGuidance}`.trim(),
      maxTokens: 2_500,
    });
    const pageByUrl = new Map(result.pages.map((page) => [page.url, page.text]));
    const unique = new Map<string, (typeof result.seen)[number]>();
    for (const source of result.seen) {
      if (!unique.has(source.url)) unique.set(source.url, source);
    }

    return SearchResponseSchema.parse({
      providerKey: this.key,
      providerRequestId: null,
      query: request.query,
      candidates: [...unique.values()].slice(0, request.resultLimit).map((source, index) => ({
        providerResultId: `groq-${index + 1}`,
        url: source.url,
        title: source.title,
        author: null,
        publishedAt: null,
        text: (pageByUrl.get(source.url) ?? '').slice(0, 12_000),
        highlights: [],
        score: null,
      })),
      latencyMs: Date.now() - startedAt,
      usage: { requests: 1, estimatedCostUsd: null },
      warnings: result.seen.length ? [] : ['Groq browser search returned no source URLs.'],
    });
  }
}
