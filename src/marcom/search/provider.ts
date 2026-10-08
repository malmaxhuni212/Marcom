import { z } from 'zod';

export const SearchCategorySchema = z.enum(['people', 'company']);

export const SearchRequestSchema = z.strictObject({
  query: z.string().trim().min(3).max(500),
  resultLimit: z.number().int().min(1).max(100),
  includeDomains: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  excludeDomains: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  category: SearchCategorySchema.optional(),
});

export const SearchCandidateSchema = z.strictObject({
  providerResultId: z.string().min(1),
  url: z.url(),
  title: z.string(),
  author: z.string().nullable(),
  publishedAt: z.string().nullable(),
  text: z.string(),
  highlights: z.array(z.string()),
  score: z.number().nullable(),
});

export const SearchUsageSchema = z.strictObject({
  requests: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0).nullable(),
});

export const SearchResponseSchema = z.strictObject({
  providerKey: z.string().min(1),
  providerRequestId: z.string().nullable(),
  query: z.string(),
  candidates: z.array(SearchCandidateSchema),
  latencyMs: z.number().int().min(0),
  usage: SearchUsageSchema,
  warnings: z.array(z.string()),
});

export type SearchCategory = z.infer<typeof SearchCategorySchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchCandidate = z.infer<typeof SearchCandidateSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export interface SeenSource {
  url: string;
  title: string;
  via: 'search' | 'page';
}

export interface SearchCapabilities {
  maximumResults: number;
  supportsDomainFilters: boolean;
  supportsCategory: boolean;
}

export interface SearchContext {
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly key: string;
  capabilities(): SearchCapabilities;
  search(request: SearchRequest, context?: SearchContext): Promise<SearchResponse>;
}
