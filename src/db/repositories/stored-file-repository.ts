import { and, eq, ne } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '../client';
import type { ActorContext } from '../local-actor';
import { storedFiles } from '../schema';

export type StoredFileRow = typeof storedFiles.$inferSelect;

export interface CreateStoredFileInput {
  id: string;
  storageKey: string;
  originalFilename: string;
  declaredMimeType?: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string;
}

export async function createStoredFile(
  actor: ActorContext,
  input: CreateStoredFileInput,
  database: MarcomDatabase = getDatabase(),
): Promise<StoredFileRow> {
  const [created] = await database
    .insert(storedFiles)
    .values({
      id: input.id,
      workspaceId: actor.workspaceId,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      detectedMimeType: input.detectedMimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      status: 'ready',
      createdByMembershipId: actor.membershipId,
    })
    .returning();

  if (!created) throw new Error('The stored file metadata could not be created.');
  return created;
}

export async function getStoredFile(
  actor: ActorContext,
  storedFileId: string,
  database: MarcomDatabase = getDatabase(),
): Promise<StoredFileRow | null> {
  const [row] = await database
    .select()
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.id, storedFileId),
        eq(storedFiles.workspaceId, actor.workspaceId),
        ne(storedFiles.status, 'deleted'),
      ),
    )
    .limit(1);

  return row ?? null;
}
