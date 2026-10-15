import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGroqCompletionPayload } from './groq-provider';

test('Groq enables JSON mode when an operation supplies a response schema', () => {
  const payload = buildGroqCompletionPayload(
    'openai/gpt-oss-20b',
    { system: 'System', user: 'User', responseSchema: { type: 'object' } },
    1,
  );

  assert.deepEqual(payload.response_format, { type: 'json_object' });
});

test('Groq leaves ordinary text completions outside JSON mode', () => {
  const payload = buildGroqCompletionPayload(
    'openai/gpt-oss-20b',
    { system: 'System', user: 'User' },
    1,
  );

  assert.equal(payload.response_format, undefined);
});
