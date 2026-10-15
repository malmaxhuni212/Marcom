import {
  SearchRequestSchema,
  SearchResponseSchema,
  type SearchCapabilities,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from './provider';

const candidates = [
  {
    providerResultId: 'fake-person-1',
    url: 'https://example.org/profiles/amira-cole',
    title: 'Amira Cole, independent filmmaker',
    author: null,
    publishedAt: null,
    text: 'Amira Cole is an independent filmmaker and workshop facilitator based in Manchester.',
    highlights: ['Independent filmmaker and workshop facilitator based in Manchester.'],
    score: 0.94,
  },
  {
    providerResultId: 'fake-org-1',
    url: 'https://example.net/organisations/north-star-film',
    title: 'North Star Film Collective',
    author: null,
    publishedAt: null,
    text: 'A regional film collective supporting emerging documentary and short-film makers.',
    highlights: ['Supports emerging documentary and short-film makers.'],
    score: 0.86,
  },
  {
    providerResultId: 'fake-incomplete-1',
    url: 'https://example.com/directory/profile-104',
    title: 'Creative practitioner profile',
    author: null,
    publishedAt: null,
    text: 'A public directory profile with limited professional information.',
    highlights: [],
    score: 0.42,
  },
  {
    providerResultId: 'fake-duplicate-like-1',
    url: 'https://www.example.org/profiles/amira-cole?ref=directory',
    title: 'Amira Cole profile',
    author: null,
    publishedAt: null,
    text: 'Another listing for independent filmmaker Amira Cole.',
    highlights: ['Independent filmmaker Amira Cole.'],
    score: 0.38,
  },
] as const;

export class FakeSearchProvider implements SearchProvider {
  readonly key = 'fake';

  capabilities(): SearchCapabilities {
    return { maximumResults: 100, supportsDomainFilters: true, supportsCategory: true };
  }

  async search(rawRequest: SearchRequest): Promise<SearchResponse> {
    const request = SearchRequestSchema.parse(rawRequest);
    const startedAt = Date.now();
    return SearchResponseSchema.parse({
      providerKey: this.key,
      providerRequestId: `fake-${encodeURIComponent(request.query).slice(0, 30)}`,
      query: request.query,
      candidates: candidates.slice(0, request.resultLimit).map((candidate) => ({ ...candidate })),
      latencyMs: Date.now() - startedAt,
      usage: { requests: 1, estimatedCostUsd: 0 },
      warnings: [],
    });
  }
}
