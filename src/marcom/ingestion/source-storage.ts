import { getStore, type Store } from '@netlify/blobs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BRIEF_SOURCE_STORE_NAME = 'brief-sources';
export const DEFAULT_NETLIFY_BLOBS_REGION = 'us-east-2';

const NETLIFY_BLOBS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
] as const;

export type NetlifyBlobsRegion = (typeof NETLIFY_BLOBS_REGIONS)[number];
export type BriefSourceStorageProvider = 'local' | 'netlify-blobs';

export interface BriefSourceStorageConfiguration {
  provider: BriefSourceStorageProvider;
  region: NetlifyBlobsRegion;
}

export interface BriefSourceObjectStorage {
  readonly provider: BriefSourceStorageProvider;
  readonly region?: NetlifyBlobsRegion;
  put(objectKey: string, data: Buffer): Promise<void>;
  get(objectKey: string): Promise<Buffer | null>;
  delete(objectKey: string): Promise<void>;
  toStorageKey(objectKey: string): string;
}

type NetlifyBlobStore = Pick<Store, 'delete' | 'getWithMetadata' | 'set'>;

function isNetlifyBlobsRegion(value: string): value is NetlifyBlobsRegion {
  return NETLIFY_BLOBS_REGIONS.includes(value as NetlifyBlobsRegion);
}

export function getBriefSourceStorageConfiguration(
  environment: Record<string, string | undefined> = process.env,
  netlifyBlobsContext: unknown = globalThis.netlifyBlobsContext,
): BriefSourceStorageConfiguration {
  const configuredProvider = environment.BRIEF_FILE_STORAGE?.trim();
  const hasNetlifyBlobsContext =
    (typeof environment.NETLIFY_BLOBS_CONTEXT === 'string' &&
      environment.NETLIFY_BLOBS_CONTEXT.trim().length > 0) ||
    (typeof netlifyBlobsContext === 'string' && netlifyBlobsContext.length > 0);
  const isNetlifyRuntime = environment.NETLIFY === 'true' || hasNetlifyBlobsContext;
  const provider = configuredProvider || (isNetlifyRuntime ? 'netlify-blobs' : 'local');
  if (provider !== 'local' && provider !== 'netlify-blobs') {
    throw new Error('BRIEF_FILE_STORAGE must be local or netlify-blobs.');
  }

  const region = environment.NETLIFY_BLOBS_REGION?.trim() || DEFAULT_NETLIFY_BLOBS_REGION;
  if (!isNetlifyBlobsRegion(region)) {
    throw new Error('NETLIFY_BLOBS_REGION is not a supported Netlify Blobs region.');
  }

  return { provider, region };
}

function assertSafeObjectKey(objectKey: string): void {
  if (
    !objectKey ||
    objectKey.startsWith('/') ||
    objectKey.includes('\\') ||
    objectKey.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    !/^[a-zA-Z0-9/_-]+$/.test(objectKey)
  ) {
    throw new Error('The brief source object key is invalid.');
  }
}

function stripStorePrefix(storageKey: string): string {
  const prefix = `${BRIEF_SOURCE_STORE_NAME}/`;
  if (!storageKey.startsWith(prefix)) {
    throw new Error('The brief source storage key uses an unexpected store.');
  }
  const objectKey = storageKey.slice(prefix.length);
  assertSafeObjectKey(objectKey);
  return objectKey;
}

export class LocalBriefSourceStorage implements BriefSourceObjectStorage {
  readonly provider = 'local' as const;

  constructor(
    private readonly rootDirectory = path.join(process.cwd(), 'storage', BRIEF_SOURCE_STORE_NAME),
  ) {}

  async put(objectKey: string, data: Buffer): Promise<void> {
    const filePath = this.resolvePath(objectKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data, { flag: 'wx' });
  }

  async get(objectKey: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolvePath(objectKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await unlink(this.resolvePath(objectKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  toStorageKey(objectKey: string): string {
    assertSafeObjectKey(objectKey);
    return `local:${BRIEF_SOURCE_STORE_NAME}/${objectKey}`;
  }

  private resolvePath(objectKey: string): string {
    assertSafeObjectKey(objectKey);
    return path.join(this.rootDirectory, ...objectKey.split('/'));
  }
}

export class NetlifyBlobBriefSourceStorage implements BriefSourceObjectStorage {
  readonly provider = 'netlify-blobs' as const;

  constructor(
    readonly region: NetlifyBlobsRegion,
    private readonly store: NetlifyBlobStore = getStore({
      name: BRIEF_SOURCE_STORE_NAME,
      region,
      consistency: 'strong',
    }),
  ) {}

  async put(objectKey: string, data: Buffer): Promise<void> {
    assertSafeObjectKey(objectKey);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const result = await this.store.set(objectKey, arrayBuffer, { onlyIfNew: true });
    if (!result.modified) {
      throw new Error('A brief source object already exists for this generated key.');
    }
  }

  async get(objectKey: string): Promise<Buffer | null> {
    assertSafeObjectKey(objectKey);
    const result = await this.store.getWithMetadata(objectKey, { type: 'blob', consistency: 'strong' });
    if (!result) return null;
    return Buffer.from(await result.data.arrayBuffer());
  }

  async delete(objectKey: string): Promise<void> {
    assertSafeObjectKey(objectKey);
    await this.store.delete(objectKey);
  }

  toStorageKey(objectKey: string): string {
    assertSafeObjectKey(objectKey);
    return `netlify-blobs:${this.region}:${BRIEF_SOURCE_STORE_NAME}/${objectKey}`;
  }
}

export function createBriefSourceStorage(
  configuration = getBriefSourceStorageConfiguration(),
): BriefSourceObjectStorage {
  if (configuration.provider === 'netlify-blobs') {
    return new NetlifyBlobBriefSourceStorage(configuration.region);
  }
  return new LocalBriefSourceStorage();
}

export function resolveBriefSourceStorage(storageKey: string): {
  storage: BriefSourceObjectStorage;
  objectKey: string;
} {
  if (storageKey.startsWith('local:')) {
    return {
      storage: new LocalBriefSourceStorage(),
      objectKey: stripStorePrefix(storageKey.slice('local:'.length)),
    };
  }

  if (storageKey.startsWith('netlify-blobs:')) {
    const remainder = storageKey.slice('netlify-blobs:'.length);
    const separator = remainder.indexOf(':');
    if (separator < 1) throw new Error('The Netlify Blob storage key is malformed.');
    const region = remainder.slice(0, separator);
    if (!isNetlifyBlobsRegion(region)) {
      throw new Error('The Netlify Blob storage key contains an unsupported region.');
    }
    return {
      storage: new NetlifyBlobBriefSourceStorage(region),
      objectKey: stripStorePrefix(remainder.slice(separator + 1)),
    };
  }

  throw new Error('The brief source storage provider is unsupported.');
}
