import { SearchProvider, SearchRequest, SearchResponse, SearchContext, SearchResult } from './provider';
import { SearchError } from './errors';

export class ExaSearchProvider implements SearchProvider {
  readonly key = 'exa';

  private get apiKey() {
    return process.env.EXA_API_KEY || '';
  }

  capabilities() {
    return {
      supportsHighlights: true,
      supportsDomains: true,
      supportsCategories: true,
    };
  }

  async search(request: SearchRequest, context?: SearchContext): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new SearchError('configuration_error', 'EXA_API_KEY is not configured');
    }

    const start = Date.now();
    const maxAppLimit = parseInt(process.env.SEARCH_MAX_RESULTS || '25', 10);
    let numResults = request.resultLimit ? Math.min(request.resultLimit, maxAppLimit, 100) : maxAppLimit;

    const payload: any = {
      query: request.query,
      type: 'auto',
      numResults,
      contents: {
        text: true,
        highlights: true
      }
    };

    if (request.category) {
      payload.category = request.category;
    } else {
      if (request.includeDomains && request.includeDomains.length > 0) {
        payload.includeDomains = request.includeDomains;
      }
      if (request.excludeDomains && request.excludeDomains.length > 0) {
        payload.excludeDomains = request.excludeDomains;
      }
    }

    try {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: context?.signal
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new SearchError('auth_failed', 'Exa API authentication failed');
        }
        if (response.status === 429) {
          throw new SearchError('rate_limited', 'Exa API rate limit exceeded');
        }
        if (response.status === 402) {
          throw new SearchError('quota_exceeded', 'Exa API quota exceeded');
        }
        if (response.status >= 500) {
          throw new SearchError('unavailable', 'Exa API is currently unavailable');
        }
        throw new SearchError('invalid_response', `Exa API returned ${response.status}`);
      }

      const data = await response.json();

      if (!data || !Array.isArray(data.results)) {
        throw new SearchError('invalid_response', 'Malformed response from Exa API');
      }

      const results: SearchResult[] = data.results.map((r: any) => ({
        providerResultId: String(r.id),
        url: String(r.url),
        title: String(r.title || ''),
        author: r.author ? String(r.author) : undefined,
        publishedAt: r.publishedDate ? String(r.publishedDate) : undefined,
        text: r.text ? String(r.text) : undefined,
        highlights: Array.isArray(r.highlights) ? r.highlights.map(String) : undefined,
        score: typeof r.score === 'number' ? r.score : undefined
      }));

      return {
        providerKey: this.key,
        providerRequestId: data.requestId,
        query: request.query,
        results,
        latencyMs: Date.now() - start
      };

    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new SearchError('timeout', 'Exa API request timed out');
      }
      if (e instanceof SearchError) throw e;
      throw new SearchError('invalid_response', 'Failed to communicate with Exa API');
    }
  }
}
