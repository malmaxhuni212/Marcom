import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGroqCompletionPayload, shrinkPayloadFor413 } from './groq-provider';

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

test('shrinkPayloadFor413 trims oversized user prompts and lowers excess max_tokens', () => {
  const longEvidence = 'A'.repeat(10_000);
  const original = buildGroqCompletionPayload(
    'openai/gpt-oss-20b',
    { system: 'Keep system intact', user: longEvidence, maxTokens: 5_200 },
    1,
  );

  const shrunk = shrinkPayloadFor413(original);
  const messages = shrunk.messages as Array<{ role: string; content: string }>;

  assert.equal(messages[0]?.content, 'Keep system intact');
  assert.ok((messages[1]?.content.length ?? 0) < longEvidence.length);
  assert.ok((messages[1]?.content.length ?? 0) >= 7_000);
  assert.match(messages[1]?.content ?? '', /\[Evidence trimmed to fit request token budget\.\]/);
  assert.equal(shrunk.max_tokens, 4_420);
});

test('shrinkPayloadFor413 preserves short user messages', () => {
  const shortUser = 'Short prompt under threshold';
  const original = buildGroqCompletionPayload(
    'openai/gpt-oss-20b',
    { system: 'System', user: shortUser, maxTokens: 2_000 },
    1,
  );

  const shrunk = shrinkPayloadFor413(original);
  const messages = shrunk.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[1]?.content, shortUser);
  assert.equal(shrunk.max_tokens, 2_000);
});
