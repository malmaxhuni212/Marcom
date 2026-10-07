import { SearchProvider, SearchRequest, SearchResponse, SearchContext, SearchResult } from './provider';
import { GroqProvider } from '../llm/groq-provider';
import { SearchError } from './errors';

export class GroqBrowserSearchProvider implements SearchProvider {
  readonly key = 'groq-browser';
  private groqProvider: GroqProvider;

  constructor() {
    this.groqProvider = new GroqProvider();
  }

  capabilities() {
    return {
      supportsHighlights: false,
      supportsDomains: false,
      supportsCategories: false,
    };
  }

  async search(request: SearchRequest, context?: SearchContext): Promise<SearchResponse> {
    const start = Date.now();
    try {
      const groqRes = await this.groqProvider.browserSearch({
        system: "You are a web search agent. Perform searches to gather information about the requested topic.",
        user: request.query,
        maxTokens: 3500
      });

      const results: SearchResult[] = groqRes.pages.map((p, i) => ({
        providerResultId: `groq-${i}`,
        url: p.url,
        title: groqRes.seen.find(s => s.url === p.url)?.title || '',
        text: p.text
      }));

      return {
        providerKey: this.key,
        query: request.query,
        results,
        latencyMs: Date.now() - start
      };
    } catch (e: any) {
      if (e.name === 'AbortError') throw new SearchError('timeout', 'Groq request timed out');
      if (e.message?.includes('429')) throw new SearchError('rate_limited', 'Groq rate limited');
      if (e.message?.includes('401')) throw new SearchError('auth_failed', 'Groq auth failed');
      throw new SearchError('invalid_response', e.message || 'Groq search failed');
    }
  }
}
