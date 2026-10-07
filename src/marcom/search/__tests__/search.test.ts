import test from 'node:test';
import assert from 'node:assert';
import { FakeSearchProvider } from '../fake-search-provider';
import { ExaSearchProvider } from '../exa-search-provider';
import { getSearchProvider } from '../registry';
import { SearchError } from '../errors';

test('FakeSearchProvider - deterministic results', async () => {
  const provider = new FakeSearchProvider();
  const res = await provider.search({ query: 'test', resultLimit: 2 });
  assert.strictEqual(res.results.length, 2);
  assert.strictEqual(res.results[0].url, 'https://fake.com/result-0');
});

test('FakeSearchProvider - rate limits', async () => {
  const provider = new FakeSearchProvider();
  try {
    await provider.search({ query: 'TRIGGER_429' });
    assert.fail('Should have thrown');
  } catch (e: any) {
    assert.strictEqual(e.code, 'rate_limited');
  }
});

test('FakeSearchProvider - exact URL duplicates', async () => {
  const provider = new FakeSearchProvider();
  const res = await provider.search({ query: 'DUPLICATES', resultLimit: 2 });
  // Should have duplicate URL
  const urls = res.results.map(r => r.url);
  assert.ok(urls.includes('https://fake.com/result-0'));
});

test('Registry - resolves provider based on env', () => {
  process.env.SEARCH_PROVIDER = 'fake';
  let provider = getSearchProvider();
  assert.strictEqual(provider.key, 'fake');

  process.env.SEARCH_PROVIDER = 'exa';
  provider = getSearchProvider();
  assert.strictEqual(provider.key, 'exa');

  process.env.SEARCH_PROVIDER = 'groq-browser';
  provider = getSearchProvider();
  assert.strictEqual(provider.key, 'groq-browser');

  process.env.SEARCH_PROVIDER = 'invalid';
  try {
    getSearchProvider();
    assert.fail('Should have thrown');
  } catch (e: any) {
    assert.strictEqual(e.code, 'configuration_error');
  }
});
