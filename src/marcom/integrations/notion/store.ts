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

async function getNetlifyBlobStore() {
  if (!isNetlifyBlobsEnvironment()) {
    return null;
  }
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
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
  const blobStore = await getNetlifyBlobStore();
  if (blobStore) {
    try {
      const data = await blobStore.get(NOTION_BLOB_KEY, { type: 'json' });
      if (
        data &&
        typeof data === 'object' &&
        typeof (data as Record<string, unknown>).accessToken === 'string' &&
        (data as Record<string, string>).accessToken.length > 0
      ) {
        return data as NotionConnectionConfig;
      }
    } catch {
      // Fall through to local file
    }
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
  let savedToBlob = false;
  const blobStore = await getNetlifyBlobStore();
  if (blobStore) {
    try {
      await blobStore.setJSON(NOTION_BLOB_KEY, config);
      savedToBlob = true;
    } catch (err) {
      console.warn('Failed to save Notion connection to Netlify Blobs:', err);
    }
  }

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
  const blobStore = await getNetlifyBlobStore();
  if (blobStore) {
    try {
      await blobStore.delete(NOTION_BLOB_KEY);
    } catch {
      // Ignore
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
  const blobStore = await getNetlifyBlobStore();
  if (blobStore) {
    try {
      const data = await blobStore.get(NOTION_SYNCS_BLOB_KEY, { type: 'json' });
      if (data && typeof data === 'object') {
        return data as Record<string, NotionProjectSyncRecord>;
      }
    } catch {
      // Fall through to local file
    }
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
  let savedToBlob = false;
  const blobStore = await getNetlifyBlobStore();
  if (blobStore) {
    try {
      await blobStore.setJSON(NOTION_SYNCS_BLOB_KEY, records);
      savedToBlob = true;
    } catch (err) {
      console.warn('Failed to save Notion project syncs to Netlify Blobs:', err);
    }
  }

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
