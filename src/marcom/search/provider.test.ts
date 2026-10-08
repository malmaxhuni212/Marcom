import assert from 'node:assert/strict';
import test from 'node:test';
import { ExaSearchProvider } from './exa-search-provider';
import { FakeSearchProvider } from './fake-search-provider';
import { SearchProviderError } from './errors';
import { readSearchConfiguration, resolveSearchProvider } from './registry';

test('provider selection can switch to fake without changing application code', () => {
  const config = readSearchConfiguration({
    SEARCH_PROVIDER: 'fake',
    SEARCH_MAX_RESULTS: '12',
    SEARCH_TIMEOUT_MS: '5000',
  });

  assert.equal(resolveSearchProvider(config).key, 'fake');
  assert.equal(config.SEARCH_MAX_RESULTS, 12);
});

test('Exa selection fails clearly when its key is missing', () => {
  assert.throws(
    () => readSearchConfiguration({ SEARCH_PROVIDER: 'exa' }),
    (error: unknown) => error instanceof SearchProviderError && error.code === 'configuration_error',
  );
});

test('fake provider returns a deterministic bounded normalized response', async () => {
  const response = await new FakeSearchProvider().search({
    query: 'independent filmmakers Manchester',
    resultLimit: 2,
    includeDomains: [],
    excludeDomains: [],
    category: 'people',
  });

  assert.equal(response.providerKey, 'fake');
  assert.equal(response.candidates.length, 2);
  assert.equal(response.usage.estimatedCostUsd, 0);
  assert.match(response.candidates[0].url, /^https:/);
});

test('Exa adapter maps vendor data into the shared search contract', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImplementation = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        requestId: 'request-123',
        costDollars: { total: 0.004 },
        results: [
          {
            id: 'exa-1',
            url: 'https://example.org/profile',
            title: 'Example profile',
            highlights: ['Supported fact'],
            score: 0.91,
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const provider = new ExaSearchProvider({
    apiKey: 'test-key',
    maximumResults: 25,
    timeoutMs: 5_000,
    fetchImplementation,
  });
  const response = await provider.search({
    query: 'poetry organisations UK',
    resultLimit: 5,
    includeDomains: [],
    excludeDomains: [],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.exa.ai/search');
  assert.equal(new Headers(calls[0].init?.headers).get('x-api-key'), 'test-key');
  assert.equal(response.providerRequestId, 'request-123');
  assert.equal(response.candidates[0].highlights[0], 'Supported fact');
  assert.equal(response.usage.estimatedCostUsd, 0.004);
});

test('Exa adapter maps rate limiting to a retryable provider error', async () => {
  const provider = new ExaSearchProvider({
    apiKey: 'test-key',
    maximumResults: 25,
    timeoutMs: 5_000,
    fetchImplementation: (async () => new Response('', { status: 429 })) as typeof fetch,
  });

  await assert.rejects(
    provider.search({ query: 'poetry organisations UK', resultLimit: 5, includeDomains: [], excludeDomains: [] }),
    (error: unknown) => error instanceof SearchProviderError && error.code === 'rate_limited' && error.retryable,
  );
});

test('Exa adapter rejects unsafe URLs returned by the provider', async () => {
  const provider = new ExaSearchProvider({
    apiKey: 'test-key',
    maximumResults: 25,
    timeoutMs: 5_000,
    fetchImplementation: (async () =>
      new Response(
        JSON.stringify({ results: [{ id: 'unsafe', url: 'http://127.0.0.1/admin', title: 'Unsafe' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch,
  });
  const response = await provider.search({
    query: 'poetry organisations UK',
    resultLimit: 5,
    includeDomains: [],
    excludeDomains: [],
  });

  assert.equal(response.candidates.length, 0);
  assert.equal(response.warnings.length, 1);
});
