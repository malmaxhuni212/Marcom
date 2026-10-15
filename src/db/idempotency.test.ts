import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestHash, stableJson } from './idempotency';

test('stable JSON produces the same value regardless of object key order', () => {
  assert.equal(
    stableJson({ campaign: { title: 'Example', target: ['writers'] }, count: 10 }),
    stableJson({ count: 10, campaign: { target: ['writers'], title: 'Example' } }),
  );
});

test('request hashes change when command content changes', () => {
  assert.notEqual(
    requestHash({ title: 'Campaign A' }),
    requestHash({ title: 'Campaign B' }),
  );
});
