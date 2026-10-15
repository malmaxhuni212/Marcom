import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Store } from '@netlify/blobs';
import {
  LocalBriefSourceStorage,
  NetlifyBlobBriefSourceStorage,
  getBriefSourceStorageConfiguration,
} from './source-storage';

test('local storage is the default outside Netlify', () => {
  assert.deepEqual(getBriefSourceStorageConfiguration({}), {
    provider: 'local',
    region: 'us-east-2',
  });
});

test('Netlify deployments automatically select Netlify Blobs', () => {
  assert.deepEqual(getBriefSourceStorageConfiguration({ NETLIFY: 'true' }), {
    provider: 'netlify-blobs',
    region: 'us-east-2',
  });
});

test('storage provider and supported region can be selected explicitly', () => {
  assert.deepEqual(
    getBriefSourceStorageConfiguration({
      BRIEF_FILE_STORAGE: 'netlify-blobs',
      NETLIFY_BLOBS_REGION: 'eu-central-1',
    }),
    { provider: 'netlify-blobs', region: 'eu-central-1' },
  );
});

test('invalid storage configuration fails before a file is accepted', () => {
  assert.throws(
    () => getBriefSourceStorageConfiguration({ BRIEF_FILE_STORAGE: 'unknown' }),
    /BRIEF_FILE_STORAGE/,
  );
  assert.throws(
    () => getBriefSourceStorageConfiguration({ NETLIFY_BLOBS_REGION: 'eu-west-2' }),
    /NETLIFY_BLOBS_REGION/,
  );
});

test('local storage writes, reads and deletes only generated object keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'marcom-brief-storage-'));
  const storage = new LocalBriefSourceStorage(directory);
  const objectKey = 'v1/10000000-0000-4000-8000-000000000001/file-id';

  try {
    await storage.put(objectKey, Buffer.from('brief contents'));
    assert.equal((await storage.get(objectKey))?.toString('utf8'), 'brief contents');
    assert.equal(
      storage.toStorageKey(objectKey),
      `local:brief-sources/${objectKey}`,
    );
    assert.throws(() => storage.toStorageKey('../outside'), /object key is invalid/);

    await storage.delete(objectKey);
    assert.equal(await storage.get(objectKey), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Netlify adapter uses conditional writes and strongly consistent reads', async () => {
  let stored: Blob | null = null;
  let deletedKey: string | null = null;
  const fakeStore = {
    async set(key: string, input: string | ArrayBuffer | Blob, options?: { onlyIfNew?: boolean }) {
      assert.equal(key, 'v1/workspace/file-id');
      assert.equal(options?.onlyIfNew, true);
      stored = input instanceof Blob ? input : new Blob([input]);
      return { modified: true, etag: 'test-etag' };
    },
    async getWithMetadata(key: string, options?: { type?: string; consistency?: string }) {
      assert.equal(key, 'v1/workspace/file-id');
      assert.equal(options?.type, 'blob');
      assert.equal(options?.consistency, 'strong');
      return stored ? { data: stored, metadata: {}, etag: 'test-etag' } : null;
    },
    async delete(key: string) {
      deletedKey = key;
      stored = null;
    },
  } as unknown as Store;
  const storage = new NetlifyBlobBriefSourceStorage('us-east-2', fakeStore);

  await storage.put('v1/workspace/file-id', Buffer.from('hosted brief'));
  assert.equal((await storage.get('v1/workspace/file-id'))?.toString('utf8'), 'hosted brief');
  assert.equal(
    storage.toStorageKey('v1/workspace/file-id'),
    'netlify-blobs:us-east-2:brief-sources/v1/workspace/file-id',
  );

  await storage.delete('v1/workspace/file-id');
  assert.equal(deletedKey, 'v1/workspace/file-id');
});
