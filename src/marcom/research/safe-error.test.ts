import assert from 'node:assert/strict';
import test from 'node:test';
import { SearchProviderError } from '@/marcom/search/errors';
import { toSafeResearchFailure } from './safe-error';

test('research errors expose a safe provider message', () => {
  const failure = toSafeResearchFailure(
    new SearchProviderError('invalid_response', 'raw upstream response details', true),
  );

  assert.equal(failure.code, 'SEARCH_PROVIDER_INVALID_RESPONSE');
  assert.equal(failure.retryable, true);
  assert.doesNotMatch(failure.message, /raw upstream response details/);
});

test('unknown research failures do not expose database query text', () => {
  const failure = toSafeResearchFailure(
    new Error('Failed query: select * from credentials where password_hash = $1'),
  );

  assert.equal(failure.code, 'RESEARCH_OPERATION_FAILED');
  assert.doesNotMatch(failure.message, /select|credentials|password_hash/i);
});
