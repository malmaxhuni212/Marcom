import { SearchProvider, SearchRequest, SearchResponse, SearchContext, SearchResult } from './provider';
import { SearchError } from './errors';

export class FakeSearchProvider implements SearchProvider {
  readonly key = 'fake';

  capabilities() {
    return {
      supportsHighlights: true,
      supportsDomains: true,
      supportsCategories: true,
    };
  }

  async search(request: SearchRequest, context?: SearchContext): Promise<SearchResponse> {
    const start = Date.now();
    
    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    if (context?.signal?.aborted) {
      throw new SearchError('timeout', 'Search was aborted');
    }

    if (request.query.includes('TRIGGER_429')) {
      throw new SearchError('rate_limited', 'Rate limit exceeded', 60);
    }

    if (request.query.includes('TRIGGER_401')) {
      throw new SearchError('auth_failed', 'Authentication failed');
    }

    const results: SearchResult[] = [];
    const limit = request.resultLimit ? Math.min(request.resultLimit, 100) : 10;
    
    for (let i = 0; i < limit; i++) {
      results.push({
        providerResultId: `fake-id-${i}`,
        url: `https://fake.com/result-${i}`,
        title: `Fake Result ${i} for ${request.query}`,
        text: `This is some fake text content for result ${i} matching ${request.query}.`,
        highlights: [`highlight ${i}`]
      });
    }
    
    if (request.query.includes('DUPLICATES')) {
      results.push({
        providerResultId: `fake-id-dup`,
        url: `https://fake.com/result-0`, // Exact URL duplicate
        title: `Duplicate Fake Result`,
        text: `Duplicate text`
      });
    }

    return {
      providerKey: this.key,
      providerRequestId: `fake-req-${Date.now()}`,
      query: request.query,
      results,
      latencyMs: Date.now() - start,
    };
  }
}
