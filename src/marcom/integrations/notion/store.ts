import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  NotionConnectionConfig,
  NotionConnectionStatus,
  NotionProjectSyncRecord,
} from './types';

const BLOB_STORE_NAME = 'marcom-integrations';
const NOTION_BLOB_KEY = 'notion-connection';
const NOTION_SYNCS_BLOB_KEY = 'notion-project-syncs';

function resolveMemoryDir(): string {
  const override = process.env.MARCOM_NOTION_STORE_DIR?.trim();
  if (override) return override;
  return path.join(process.cwd(), 'memory', 'integrations');
}

function localNotionFilePath(): string {
  return path.join(resolveMemoryDir(), 'notion.json');
}

function localNotionSyncsFilePath(): string {
  return path.join(resolveMemoryDir(), 'notion-syncs.json');
}

function isNetlifyBlobsEnvironment(): boolean {
  return Boolean(
    process.env.NETLIFY === 'true' ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      (globalThis as Record<string, unknown>).netlifyBlobsContext,
  );
}

async function getNetlifyBlobStore(strongConsistency = true) {
  if (!isNetlifyBlobsEnvironment()) {
    return null;
  }
  try {
    const { getStore } = await import('@netlify/blobs');
    if (strongConsistency) {
      try {
        return getStore({
          name: BLOB_STORE_NAME,
          consistency: 'strong',
          region: 'us-east-2',
        });
      } catch {
        // Fall back to default store if strong consistency is unavailable
      }
    }
    return getStore({
      name: BLOB_STORE_NAME,
      region: 'us-east-2',
    });
  } catch {
    return null;
  }
}

async function readBlobJson<T>(key: string): Promise<T | null> {
  const strongStore = await getNetlifyBlobStore(true);
  if (strongStore) {
    try {
      return (await strongStore.get(key, { type: 'json' })) as T | null;
    } catch {
      // Retry with eventual consistency store if strong consistency fails
    }
  }
  const fallbackStore = await getNetlifyBlobStore(false);
  if (!fallbackStore) return null;
  try {
    return (await fallbackStore.get(key, { type: 'json' })) as T | null;
  } catch {
    return null;
  }
}

async function writeBlobJson(key: string, value: unknown): Promise<boolean> {
  const strongStore = await getNetlifyBlobStore(true);
  if (strongStore) {
    try {
      await strongStore.setJSON(key, value);
      return true;
    } catch {
      // Retry with eventual consistency store if strong consistency fails
    }
  }
  const fallbackStore = await getNetlifyBlobStore(false);
  if (!fallbackStore) return false;
  try {
    await fallbackStore.setJSON(key, value);
    return true;
  } catch (err) {
    console.warn(`Failed to save ${key} to Netlify Blobs:`, err);
    return false;
  }
}

export async function getNotionConnection(): Promise<NotionConnectionConfig | null> {
  // 1. Static environment variable fallback (for private internal token setups)
  if (process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_INTERNAL_TOKEN) {
    const token = (process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_INTERNAL_TOKEN)!.trim();
    if (token) {
      return {
        accessToken: token,
        workspaceId: 'env-workspace',
        workspaceName: process.env.NOTION_WORKSPACE_NAME || 'Environment Workspace',
        workspaceIcon: null,
        botId: 'env-bot',
        owner: null,
        connectedAt: new Date().toISOString(),
        defaultParentPageId: process.env.NOTION_DEFAULT_PARENT_PAGE_ID || null,
        defaultParentPageTitle: null,
      };
    }
  }

  // 2. Netlify Blobs (production serverless runtime)
  const blobData = await readBlobJson<Record<string, unknown>>(NOTION_BLOB_KEY);
  if (
    blobData &&
    typeof blobData === 'object' &&
    typeof blobData.accessToken === 'string' &&
    blobData.accessToken.length > 0
  ) {
    return blobData as unknown as NotionConnectionConfig;
  }

  // 3. Local filesystem memory (development)
  try {
    const raw = await readFile(localNotionFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as NotionConnectionConfig;
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.length > 0) {
      return parsed;
    }
  } catch {
    // File not found or invalid
  }

  return null;
}

export async function saveNotionConnection(config: NotionConnectionConfig): Promise<void> {
  const savedToBlob = await writeBlobJson(NOTION_BLOB_KEY, config);

  try {
    const dir = resolveMemoryDir();
    await mkdir(dir, { recursive: true });
    await writeFile(localNotionFilePath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    if (!savedToBlob) {
      console.warn('Failed to save Notion connection locally:', err);
      throw err;
    }
  }
}

export async function updateDefaultNotionParentPage(
  pageId: string | null,
  pageTitle?: string | null,
): Promise<NotionConnectionConfig | null> {
  const existing = await getNotionConnection();
  if (!existing) return null;
  if (existing.workspaceId === 'env-workspace') return existing;

  const updated: NotionConnectionConfig = {
    ...existing,
    defaultParentPageId: pageId || null,
    defaultParentPageTitle: pageTitle || null,
  };
  await saveNotionConnection(updated);
  return updated;
}

export async function disconnectNotion(): Promise<void> {
  const strongStore = await getNetlifyBlobStore(true);
  if (strongStore) {
    try {
      await strongStore.delete(NOTION_BLOB_KEY);
    } catch {
      const fallbackStore = await getNetlifyBlobStore(false);
      await fallbackStore?.delete(NOTION_BLOB_KEY).catch(() => undefined);
    }
  }

  try {
    await unlink(localNotionFilePath());
  } catch {
    // Ignore if already deleted
  }
}

export async function getNotionConnectionStatus(): Promise<NotionConnectionStatus> {
  const conn = await getNotionConnection();
  if (!conn) {
    return { connected: false };
  }
  return {
    connected: true,
    workspaceName: conn.workspaceName,
    workspaceIcon: conn.workspaceIcon,
    workspaceId: conn.workspaceId,
    connectedAt: conn.connectedAt,
    defaultParentPageId: conn.defaultParentPageId ?? null,
    defaultParentPageTitle: conn.defaultParentPageTitle ?? null,
  };
}

async function readAllProjectNotionSyncs(): Promise<Record<string, NotionProjectSyncRecord>> {
  const blobData = await readBlobJson<Record<string, NotionProjectSyncRecord>>(NOTION_SYNCS_BLOB_KEY);
  if (blobData && typeof blobData === 'object') {
    return blobData;
  }

  try {
    const raw = await readFile(localNotionSyncsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, NotionProjectSyncRecord>;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // File not found or invalid
  }

  return {};
}

async function writeAllProjectNotionSyncs(
  records: Record<string, NotionProjectSyncRecord>,
): Promise<void> {
  const savedToBlob = await writeBlobJson(NOTION_SYNCS_BLOB_KEY, records);

  try {
    const dir = resolveMemoryDir();
    await mkdir(dir, { recursive: true });
    await writeFile(localNotionSyncsFilePath(), JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    if (!savedToBlob) {
      console.warn('Failed to save Notion project syncs locally:', err);
    }
  }
}

export async function getProjectNotionSync(
  projectId: string,
): Promise<NotionProjectSyncRecord | null> {
  const all = await readAllProjectNotionSyncs();
  return all[projectId] ?? null;
}

export async function saveProjectNotionSync(record: NotionProjectSyncRecord): Promise<void> {
  const all = await readAllProjectNotionSyncs();
  all[record.projectId] = record;
  await writeAllProjectNotionSyncs(all);
}
