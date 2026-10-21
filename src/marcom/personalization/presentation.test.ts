import assert from 'node:assert/strict';
import test from 'node:test';
import { getPersonalizationActionPresentation } from './presentation';

test('offers generation when a prospect has no outreach draft', () => {
  assert.deepEqual(getPersonalizationActionPresentation('absent'), {
    label: 'Generate personalised outreach',
    disabled: false,
    action: 'generate',
  });
});

test('offers viewing without generation when a draft already exists', () => {
  assert.deepEqual(getPersonalizationActionPresentation('ready'), {
    label: 'View personalised outreach',
    disabled: false,
    action: 'view',
  });
});

test('offers retry after a lookup or generation failure', () => {
  assert.deepEqual(getPersonalizationActionPresentation('error'), {
    label: 'Retry outreach generation',
    disabled: false,
    action: 'generate',
  });
});

test('disables the action while checking or generating', () => {
  assert.equal(getPersonalizationActionPresentation('loading').disabled, true);
  assert.equal(getPersonalizationActionPresentation('generating').disabled, true);
});
