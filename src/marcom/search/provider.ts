export interface SearchCapabilities {
  supportsHighlights: boolean;
  supportsDomains: boolean;
  supportsCategories: boolean;
}

export interface SearchRequest {
  query: string;
  resultLimit?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  category?: 'people' | 'company';
}

export interface SearchResult {
  providerResultId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  text?: string;
  highlights?: string[];
  score?: number;
}

export interface SearchResponse {
  providerKey: string;
  providerRequestId?: string;
  results: SearchResult[];
  query: string;
  latencyMs: number;
  warnings?: string[];
}

export interface SearchContext {
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly key: string;
  capabilities(): SearchCapabilities;
  search(request: SearchRequest, context?: SearchContext): Promise<SearchResponse>;
}
