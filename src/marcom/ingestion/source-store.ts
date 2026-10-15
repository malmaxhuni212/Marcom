import { createHash, randomUUID } from 'node:crypto';
import type { MarcomDatabase } from '@/db/client';
import type { ActorContext } from '@/db/local-actor';
import {
  createStoredFile,
  getStoredFile,
  type StoredFileRow,
} from '@/db/repositories/stored-file-repository';
import {
  createBriefSourceStorage,
  resolveBriefSourceStorage,
  type BriefSourceObjectStorage,
} from './source-storage';

export interface StoredSourceMeta {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  created_at: string;
}

export interface SaveSourceFileOptions {
  actor: ActorContext;
  declaredMimeType?: string;
  detectedMimeType: string;
  storage?: BriefSourceObjectStorage;
  database?: MarcomDatabase;
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'brief';
}

function toMeta(row: StoredFileRow): StoredSourceMeta {
  return {
    id: row.id,
    original_filename: row.originalFilename,
    mime_type: row.detectedMimeType,
    size_bytes: row.sizeBytes,
    sha256: row.sha256,
    storage_key: row.storageKey,
    created_at: row.createdAt.toISOString(),
  };
}

export async function saveSourceFile(
  buffer: Buffer,
  originalFilename: string,
  options: SaveSourceFileOptions,
): Promise<StoredSourceMeta> {
  const id = randomUUID();
  const storage = options.storage ?? createBriefSourceStorage();
  const objectKey = `v1/${options.actor.workspaceId}/${id}`;
  const storageKey = storage.toStorageKey(objectKey);
  const filename = safeFilename(originalFilename);
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  await storage.put(objectKey, buffer);

  try {
    const row = await createStoredFile(
      options.actor,
      {
        id,
        storageKey,
        originalFilename: filename,
        declaredMimeType: options.declaredMimeType,
        detectedMimeType: options.detectedMimeType,
        sizeBytes: buffer.length,
        sha256,
      },
      options.database,
    );
    return toMeta(row);
  } catch (error) {
    try {
      await storage.delete(objectKey);
    } catch {
      console.error(JSON.stringify({
        event: 'brief_source.rollback_delete_failed',
        storedFileId: id,
        storageProvider: storage.provider,
      }));
    }
    throw error;
  }
}

export async function readSourceMeta(
  actor: ActorContext,
  id: string,
  database?: MarcomDatabase,
): Promise<StoredSourceMeta | null> {
  const row = await getStoredFile(actor, id, database);
  return row ? toMeta(row) : null;
}

export async function readSourceFile(
  actor: ActorContext,
  id: string,
  database?: MarcomDatabase,
): Promise<{ meta: StoredSourceMeta; data: Buffer } | null> {
  const row = await getStoredFile(actor, id, database);
  if (!row) return null;

  const { storage, objectKey } = resolveBriefSourceStorage(row.storageKey);
  const data = await storage.get(objectKey);
  if (!data) return null;
  return { meta: toMeta(row), data };
}
