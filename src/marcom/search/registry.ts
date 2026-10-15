import { z } from 'zod';
import { GroqProvider } from '../llm/groq-provider';
import { ExaSearchProvider } from './exa-search-provider';
import { FakeSearchProvider } from './fake-search-provider';
import { GroqBrowserSearchProvider } from './groq-browser-search-provider';
import { SearchProviderError } from './errors';
import type { SearchProvider } from './provider';

const SearchConfigSchema = z
  .object({
    SEARCH_PROVIDER: z.enum(['fake', 'exa', 'groq-browser']).default('groq-browser'),
    SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(100).default(25),
    SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    EXA_API_KEY: z.string().trim().optional(),
  })
  .superRefine((config, context) => {
    if (config.SEARCH_PROVIDER === 'exa' && !config.EXA_API_KEY) {
      context.addIssue({ code: 'custom', path: ['EXA_API_KEY'], message: 'EXA_API_KEY is required when SEARCH_PROVIDER=exa.' });
    }
  });

export type SearchConfiguration = z.infer<typeof SearchConfigSchema>;

export function readSearchConfiguration(
  environment: Record<string, string | undefined> = process.env,
): SearchConfiguration {
  const result = SearchConfigSchema.safeParse(environment);
  if (!result.success) {
    throw new SearchProviderError(
      'configuration_error',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      false,
    );
  }
  return result.data;
}

export function resolveSearchProvider(
  config: SearchConfiguration = readSearchConfiguration(),
  groqProvider: GroqProvider = new GroqProvider(),
): SearchProvider {
  if (config.SEARCH_PROVIDER === 'fake') return new FakeSearchProvider();
  if (config.SEARCH_PROVIDER === 'exa') {
    return new ExaSearchProvider({
      apiKeys: [config.EXA_API_KEY!, process.env.EXA_API_KEY_2, process.env.EXA_API_KEY_3].filter((k): k is string => !!k),
      maximumResults: config.SEARCH_MAX_RESULTS,
      timeoutMs: config.SEARCH_TIMEOUT_MS,
    });
  }
  if (config.SEARCH_PROVIDER === 'groq-browser') return new GroqBrowserSearchProvider(groqProvider);
  throw new SearchProviderError('configuration_error', `Unknown search provider: ${String(config.SEARCH_PROVIDER)}`, false);
}
