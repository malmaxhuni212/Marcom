import assert from 'node:assert/strict';
import test from 'node:test';
import { GeneratePersonalizationRequestSchema } from './request-contract';

test('selected prospect ids are accepted as an explicit bounded generation request', () => {
  const parsed = GeneratePersonalizationRequestSchema.parse({
    recordIds: ['record-1', 'record-2'],
  });
  assert.deepEqual(parsed.recordIds, ['record-1', 'record-2']);
});

test('an empty request cannot silently expand to every research result', () => {
  assert.equal(GeneratePersonalizationRequestSchema.safeParse({}).success, false);
  assert.equal(GeneratePersonalizationRequestSchema.safeParse({ mode: 'single' }).success, false);
  assert.equal(GeneratePersonalizationRequestSchema.safeParse({ mode: 'batch' }).success, false);
});

test('unknown generation request fields are rejected', () => {
  assert.equal(
    GeneratePersonalizationRequestSchema.safeParse({ recordId: 'record-1', unexpected: true }).success,
    false,
  );
});
