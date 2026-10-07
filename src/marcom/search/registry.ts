import { SearchProvider } from './provider';
import { FakeSearchProvider } from './fake-search-provider';
import { ExaSearchProvider } from './exa-search-provider';
import { GroqBrowserSearchProvider } from './groq-browser-search-provider';
import { SearchError } from './errors';

export function getSearchProvider(): SearchProvider {
  const providerKey = (process.env.SEARCH_PROVIDER || 'fake').toLowerCase();

  switch (providerKey) {
    case 'fake':
      return new FakeSearchProvider();
    case 'exa':
      return new ExaSearchProvider();
    case 'groq-browser':
      return new GroqBrowserSearchProvider();
    default:
      throw new SearchError('configuration_error', `Unknown SEARCH_PROVIDER configured: "${providerKey}"`);
  }
}
