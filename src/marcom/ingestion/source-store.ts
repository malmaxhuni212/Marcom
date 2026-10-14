/**
 * Local store for original uploaded brief files, so a human can always review the source document
 * next to the structured brief.
 *
 * Files are kept server-side under `storage/brief-sources/` (git-ignored) and are only addressable
 * by a random UUID — never by user-supplied names — which prevents path traversal.
 * In hosted deployments this is the seam to swap for object storage (the `stored_files` table's
 * `storage_key` column already models this).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STORE_DIR = path.join(process.cwd(), 'storage', 'brief-sources');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredSourceMeta {
  id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_key: string;
  page_count?: number;
  created_at: string;
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'brief';
}

export async function saveSourceFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  extra: { page_count?: number } = {},
): Promise<StoredSourceMeta> {
  await mkdir(STORE_DIR, { recursive: true });
  const id = randomUUID();
  const meta: StoredSourceMeta = {
    id,
    original_filename: safeFilename(originalFilename),
    mime_type: mimeType,
    size_bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    storage_key: `local:brief-sources/${id}`,
    created_at: new Date().toISOString(),
    ...extra,
  };
  await writeFile(path.join(STORE_DIR, `${id}.bin`), buffer);
  await writeFile(path.join(STORE_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

export async function readSourceMeta(id: string): Promise<StoredSourceMeta | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(STORE_DIR, `${id}.json`), 'utf8')) as StoredSourceMeta;
  } catch {
    return null;
  }
}

export async function readSourceFile(id: string): Promise<{ meta: StoredSourceMeta; data: Buffer } | null> {
  const meta = await readSourceMeta(id);
  if (!meta) return null;
  try {
    return { meta, data: await readFile(path.join(STORE_DIR, `${id}.bin`)) };
  } catch {
    return null;
  }
}
