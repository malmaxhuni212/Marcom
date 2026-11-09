import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NextResponse } from 'next/server';
import type {
  NotionConnectionConfig,
  NotionConnectionStatus,
  NotionProjectSyncRecord,
} from './types';

const BLOB_STORE_NAME = 'marcom-integrations';
const NOTION_BLOB_KEY = 'notion-connection';
const NOTION_SYNCS_BLOB_KEY = 'notion-project-syncs';
export const NOTION_CONNECTION_COOKIE = 'marcom_notion_conn';

function stripQuotes(val: string | undefined): string {
  if (!val) return '';
  return val.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

function getCookieCipherKey(): Buffer {
  const secret =
    stripQuotes(process.env.NOTION_CLIENT_SECRET) ||
    stripQuotes(process.env.AUTH_SECRET) ||
    'marcom-notion-fallback-cookie-secret-key';
  return createHash('sha256').update(secret).digest();
}

export function serializeNotionConnectionCookie(config: NotionConnectionConfig): string | null {
  try {
    const minimal: NotionConnectionConfig = {
      accessToken: config.accessToken,
      workspaceId: config.workspaceId,
      workspaceName: config.workspaceName ?? null,
      workspaceIcon: config.workspaceIcon ?? null,
      botId: config.botId || 'bot',
      owner: null,
      connectedAt: config.connectedAt || new Date().toISOString(),
      defaultParentPageId: config.defaultParentPageId ?? null,
      defaultParentPageTitle: config.defaultParentPageTitle ?? null,
    };
    const key = getCookieCipherKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(minimal), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  } catch {
    return null;
  }
}

export function parseNotionConnectionCookie(req?: Request | null): NotionConnectionConfig | null {
  if (!req) return null;
  try {
    const cookieHeader = req.headers.get('cookie');
    if (!cookieHeader) return null;
    let rawCookie: string | null = null;
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      if (trimmed.slice(0, eqIdx) === NOTION_CONNECTION_COOKIE) {
        rawCookie = decodeURIComponent(trimmed.slice(eqIdx + 1));
        break;
      }
    }
    if (!rawCookie) return null;
    const segments = rawCookie.split('.');
    if (segments.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = segments;
    const key = getCookieCipherKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64!, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64!, 'base64url')),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString('utf8')) as NotionConnectionConfig;
    if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.length > 0) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setNotionConnectionCookieOnResponse(
  res: NextResponse,
  config: NotionConnectionConfig | null,
): void {
  if (!config) {
    res.cookies.set(NOTION_CONNECTION_COOKIE, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 0,
    });
    return;
  }
  const encoded = serializeNotionConnectionCookie(config);
  if (!encoded) return;
  res.cookies.set(NOTION_CONNECTION_COOKIE, encoded, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}

function candidateMemoryDirs(): string[] {
  const override = process.env.MARCOM_NOTION_STORE_DIR?.trim();
  if (override) return [override];
  return [
    path.join(process.cwd(), 'memory', 'integrations'),
    path.join(os.tmpdir(), 'marcom-integrations'),
  ];
}

function isCustomTestStoreDir(): boolean {
  return Boolean(process.env.MARCOM_NOTION_STORE_DIR?.trim());
}

async function getNetlifyBlobStore(strongConsistency = true) {
  if (isCustomTestStoreDir()) {
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
  } catch {
    return false;
  }
}

export async function getNotionConnection(req?: Request | null): Promise<NotionConnectionConfig | null> {
  // 1. Static environment variable fallback (for private internal token setups)
  if (process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_INTERNAL_TOKEN) {
    const token = stripQuotes(process.env.NOTION_ACCESS_TOKEN || process.env.NOTION_INTERNAL_TOKEN);
    if (token) {
      return {
        accessToken: token,
        workspaceId: 'env-workspace',
        workspaceName: process.env.NOTION_WORKSPACE_NAME || 'Environment Workspace',
        workspaceIcon: null,
        botId: 'env-bot',
        owner: null,
        connectedAt: new Date().toISOString(),
        defaultParentPageId: stripQuotes(process.env.NOTION_DEFAULT_PARENT_PAGE_ID) || null,
        defaultParentPageTitle: null,
      };
    }
  }

  // 2. Check signed encrypted browser cookie first if available (instant consistency across serverless instances)
  const cookieConn = parseNotionConnectionCookie(req);

  // 3. Netlify Blobs (production serverless runtime)
  const blobData = await readBlobJson<Record<string, unknown>>(NOTION_BLOB_KEY);
  if (
    blobData &&
    typeof blobData === 'object' &&
    typeof blobData.accessToken === 'string' &&
    blobData.accessToken.length > 0
  ) {
    const blobConn = blobData as unknown as NotionConnectionConfig;
    if (cookieConn && cookieConn.workspaceId === blobConn.workspaceId) {
      return {
        ...blobConn,
        defaultParentPageId: cookieConn.defaultParentPageId ?? blobConn.defaultParentPageId ?? null,
        defaultParentPageTitle:
          cookieConn.defaultParentPageTitle ?? blobConn.defaultParentPageTitle ?? null,
      };
    }
    return blobConn;
  }

  if (cookieConn) {
    return cookieConn;
  }

  // 4. Local or /tmp filesystem memory
  for (const dir of candidateMemoryDirs()) {
    try {
      const raw = await readFile(path.join(dir, 'notion.json'), 'utf8');
      const parsed = JSON.parse(raw) as NotionConnectionConfig;
      if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.length > 0) {
        return parsed;
      }
    } catch {
      // Try next candidate directory
    }
  }

  return null;
}

export async function saveNotionConnection(config: NotionConnectionConfig): Promise<void> {
  const savedToBlob = await writeBlobJson(NOTION_BLOB_KEY, config);
  let savedLocally = false;

  for (const dir of candidateMemoryDirs()) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'notion.json'), JSON.stringify(config, null, 2), 'utf8');
      savedLocally = true;
      break;
    } catch {
      // Try next candidate directory (e.g. os.tmpdir() on Lambda/Netlify)
    }
  }

  if (!savedToBlob && !savedLocally) {
    console.warn('Could not persist Notion connection to Blobs or local disk.');
  }
}

export async function updateDefaultNotionParentPage(
  pageId: string | null,
  pageTitle?: string | null,
  req?: Request | null,
): Promise<NotionConnectionConfig | null> {
  const existing = await getNotionConnection(req);
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

  for (const dir of candidateMemoryDirs()) {
    try {
      await unlink(path.join(dir, 'notion.json'));
    } catch {
      // Ignore if already deleted
    }
  }
}

export async function getNotionConnectionStatus(
  req?: Request | null,
): Promise<NotionConnectionStatus> {
  const conn = await getNotionConnection(req);
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

  for (const dir of candidateMemoryDirs()) {
    try {
      const raw = await readFile(path.join(dir, 'notion-syncs.json'), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, NotionProjectSyncRecord>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Try next candidate directory
    }
  }

  return {};
}

async function writeAllProjectNotionSyncs(
  records: Record<string, NotionProjectSyncRecord>,
): Promise<void> {
  await writeBlobJson(NOTION_SYNCS_BLOB_KEY, records);

  for (const dir of candidateMemoryDirs()) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'notion-syncs.json'), JSON.stringify(records, null, 2), 'utf8');
      break;
    } catch {
      // Try next candidate directory
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
