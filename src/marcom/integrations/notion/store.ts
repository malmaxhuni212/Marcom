import { getStore } from '@netlify/blobs';
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

const BLOB_OP_TIMEOUT_MS = 1800;
const BLOBS_COOLDOWN_MS = 60_000;
let blobsUnavailableUntil = 0;

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

function readCookieFromRequest(req: Request | null | undefined, cookieName: string): string | null {
  if (!req) return null;
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    if (trimmed.slice(0, eqIdx) === cookieName) {
      try {
        return decodeURIComponent(trimmed.slice(eqIdx + 1));
      } catch {
        return trimmed.slice(eqIdx + 1);
      }
    }
  }
  return null;
}

function isHostedOrSharedEnvironment(): boolean {
  return Boolean(
    process.env.APP_ACCESS_MODE === 'shared' ||
      process.env.NODE_ENV === 'production' ||
      process.env.NETLIFY === 'true' ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      (globalThis as Record<string, unknown>).netlifyBlobsContext,
  );
}

/**
 * Resolves a per-session / per-browser scope identifier so that in shared/hosted mode,
 * User B never inherits User A's Notion workspace connection.
 * Falls back to 'default' in local development (`APP_ACCESS_MODE=local` without session cookies)
 * and unit tests where `req` is omitted.
 */
export function resolveNotionSessionScope(req?: Request | null): string {
  if (!req) return 'default';

  const sessionToken =
    readCookieFromRequest(req, '__Host-marcom_session') ||
    readCookieFromRequest(req, 'marcom_session');
  if (sessionToken) {
    const hash = createHash('sha256').update(sessionToken).digest('hex').slice(0, 24);
    return `sess_${hash}`;
  }

  const guestToken =
    readCookieFromRequest(req, '__Host-marcom_guest') ||
    readCookieFromRequest(req, 'marcom_guest');
  if (guestToken) {
    const hash = createHash('sha256').update(guestToken).digest('hex').slice(0, 24);
    return `guest_${hash}`;
  }

  if (isHostedOrSharedEnvironment()) {
    return 'anon';
  }

  return 'default';
}

function scopedNotionBlobKey(scope: string): string {
  if (!scope || scope === 'default') return NOTION_BLOB_KEY;
  return `${NOTION_BLOB_KEY}:${scope}`;
}

function scopedNotionFileName(scope: string): string {
  if (!scope || scope === 'default') return 'notion.json';
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '');
  return `notion-${safeScope}.json`;
}

interface CookiePayload extends NotionConnectionConfig {
  _scope?: string;
}

export function serializeNotionConnectionCookie(
  config: NotionConnectionConfig,
  scope = 'default',
): string | null {
  try {
    const minimal: CookiePayload = {
      accessToken: config.accessToken,
      workspaceId: config.workspaceId,
      workspaceName: config.workspaceName ?? null,
      workspaceIcon: config.workspaceIcon ?? null,
      botId: config.botId || 'bot',
      owner: null,
      connectedAt: config.connectedAt || new Date().toISOString(),
      defaultParentPageId: config.defaultParentPageId ?? null,
      defaultParentPageTitle: config.defaultParentPageTitle ?? null,
      _scope: scope,
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

export function parseNotionConnectionCookie(
  req?: Request | null,
  expectedScope?: string,
): NotionConnectionConfig | null {
  if (!req) return null;
  try {
    const rawCookie = readCookieFromRequest(req, NOTION_CONNECTION_COOKIE);
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
    const parsed = JSON.parse(decrypted.toString('utf8')) as CookiePayload;
    if (!parsed || typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) {
      return null;
    }

    const activeScope = expectedScope ?? resolveNotionSessionScope(req);
    if (
      activeScope.startsWith('sess_') &&
      parsed._scope &&
      parsed._scope.startsWith('sess_') &&
      parsed._scope !== activeScope
    ) {
      // A different user session logged in on this browser; do not leak previous session's Notion token
      return null;
    }

    const { _scope: _ignored, ...cleanConfig } = parsed;
    return cleanConfig;
  } catch {
    return null;
  }
}

export function setNotionConnectionCookieOnResponse(
  res: NextResponse,
  config: NotionConnectionConfig | null,
  reqOrScope?: Request | string | null,
): void {
  const isSecure =
    process.env.NODE_ENV === 'production' &&
    Boolean(process.env.APP_ORIGIN?.trim().startsWith('https://'));

  if (!config) {
    res.cookies.set(NOTION_CONNECTION_COOKIE, '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 0,
    });
    return;
  }
  const scope =
    typeof reqOrScope === 'string'
      ? reqOrScope
      : resolveNotionSessionScope(reqOrScope);
  const encoded = serializeNotionConnectionCookie(config, scope);
  if (!encoded) return;
  res.cookies.set(NOTION_CONNECTION_COOKIE, encoded, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
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

function isNetlifyBlobsEnvironment(): boolean {
  if (isCustomTestStoreDir()) return false;
  if (Date.now() < blobsUnavailableUntil) return false;
  return Boolean(
    process.env.NETLIFY === 'true' ||
      process.env.NETLIFY_BLOBS_CONTEXT ||
      (globalThis as Record<string, unknown>).netlifyBlobsContext,
  );
}

/**
 * Custom fetch wrapper for @netlify/blobs that enforces a 1.5s timeout and prevents
 * @netlify/blobs's internal `fetchAndRetry` from sleeping 5,000ms x 5 (25s+) on 5xx errors.
 */
const fastBlobFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, {
    ...init,
    signal: AbortSignal.timeout(1500),
  });
  if (res.status >= 500 || res.status === 429) {
    blobsUnavailableUntil = Date.now() + BLOBS_COOLDOWN_MS;
    return new Response(res.body, {
      status: 400,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  return res;
};

function withBlobTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      blobsUnavailableUntil = Date.now() + BLOBS_COOLDOWN_MS;
      resolve(fallback);
    }, BLOB_OP_TIMEOUT_MS);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        blobsUnavailableUntil = Date.now() + BLOBS_COOLDOWN_MS;
        resolve(fallback);
      });
  });
}

function getNetlifyBlobStore() {
  if (!isNetlifyBlobsEnvironment()) {
    return null;
  }
  const configuredRegion = process.env.NETLIFY_BLOBS_REGION?.trim();
  try {
    return getStore({
      name: BLOB_STORE_NAME,
      ...(configuredRegion ? { region: configuredRegion as any } : {}),
      fetch: fastBlobFetch,
    });
  } catch {
    try {
      return getStore({
        name: BLOB_STORE_NAME,
        region: 'us-east-2',
        fetch: fastBlobFetch,
      });
    } catch {
      blobsUnavailableUntil = Date.now() + BLOBS_COOLDOWN_MS;
      return null;
    }
  }
}

async function readBlobJson<T>(key: string): Promise<T | null> {
  const store = getNetlifyBlobStore();
  if (!store) return null;
  return withBlobTimeout(
    store.get(key, { type: 'json' }) as Promise<T | null>,
    null,
  );
}

async function writeBlobJson(key: string, value: unknown): Promise<boolean> {
  const store = getNetlifyBlobStore();
  if (!store) return false;
  return withBlobTimeout(
    store.setJSON(key, value).then(() => true),
    false,
  );
}

async function deleteBlobKey(key: string): Promise<void> {
  const store = getNetlifyBlobStore();
  if (!store) return;
  await withBlobTimeout(store.delete(key), undefined);
}

export async function getNotionConnection(
  reqOrScope?: Request | string | null,
): Promise<NotionConnectionConfig | null> {
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

  const req = typeof reqOrScope === 'object' ? reqOrScope : null;
  const scope =
    typeof reqOrScope === 'string'
      ? reqOrScope
      : resolveNotionSessionScope(req);

  // 2. Check signed encrypted browser cookie first (0.1ms, zero network latency, strictly isolated per browser/session)
  if (req) {
    const cookieConn = parseNotionConnectionCookie(req, scope);
    if (cookieConn) {
      return cookieConn;
    }
  }

  // Never allow an unauthenticated/anonymous browser in hosted/shared mode to read someone else's stored token
  if (scope === 'anon') {
    return null;
  }

  // 3. Scoped Netlify Blobs lookup
  const blobKey = scopedNotionBlobKey(scope);
  const blobData = await readBlobJson<Record<string, unknown>>(blobKey);
  if (
    blobData &&
    typeof blobData === 'object' &&
    typeof blobData.accessToken === 'string' &&
    blobData.accessToken.length > 0
  ) {
    return blobData as unknown as NotionConnectionConfig;
  }

  // 4. Scoped local or /tmp filesystem memory
  const fileName = scopedNotionFileName(scope);
  for (const dir of candidateMemoryDirs()) {
    try {
      const raw = await readFile(path.join(dir, fileName), 'utf8');
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

export async function saveNotionConnection(
  config: NotionConnectionConfig,
  reqOrScope?: Request | string | null,
): Promise<void> {
  const scope =
    typeof reqOrScope === 'string'
      ? reqOrScope
      : resolveNotionSessionScope(reqOrScope);
  const blobKey = scopedNotionBlobKey(scope);
  const fileName = scopedNotionFileName(scope);

  const savedToBlob = await writeBlobJson(blobKey, config);
  let savedLocally = false;

  for (const dir of candidateMemoryDirs()) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, fileName), JSON.stringify(config, null, 2), 'utf8');
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
  reqOrScope?: Request | string | null,
): Promise<NotionConnectionConfig | null> {
  const existing = await getNotionConnection(reqOrScope);
  if (!existing) return null;
  if (existing.workspaceId === 'env-workspace') return existing;

  const updated: NotionConnectionConfig = {
    ...existing,
    defaultParentPageId: pageId || null,
    defaultParentPageTitle: pageTitle || null,
  };
  await saveNotionConnection(updated, reqOrScope);
  return updated;
}

export async function disconnectNotion(
  reqOrScope?: Request | string | null,
): Promise<void> {
  const scope =
    typeof reqOrScope === 'string'
      ? reqOrScope
      : resolveNotionSessionScope(reqOrScope);
  const blobKey = scopedNotionBlobKey(scope);
  const fileName = scopedNotionFileName(scope);

  await deleteBlobKey(blobKey);

  for (const dir of candidateMemoryDirs()) {
    try {
      await unlink(path.join(dir, fileName));
    } catch {
      // Ignore if already deleted
    }
  }
}

export async function getNotionConnectionStatus(
  reqOrScope?: Request | string | null,
): Promise<NotionConnectionStatus> {
  const conn = await getNotionConnection(reqOrScope);
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

export function sanitizeProjectSyncRecordForClient(
  record: NotionProjectSyncRecord | null,
): NotionProjectSyncRecord | null {
  if (!record) return null;
  const { projectAccessToken: _ignored, ...safeRecord } = record;
  return safeRecord;
}

/**
 * Resolves the Notion connection for a specific campaign project.
 * - Prefers the caller's session-scoped connection if it matches the project's synced workspace (or if the project hasn't been synced yet).
 * - Falls back to the project's stored `projectAccessToken` when a campaign has already been synced to Notion,
 *   allowing all collaborators on that campaign project to view, pull, and push Notion updates seamlessly
 *   without leaking global Notion workspace connections across unrelated sessions or unsynced projects.
 */
export async function getProjectNotionConnection(
  projectId: string,
  reqOrScope?: Request | string | null,
): Promise<NotionConnectionConfig | null> {
  const [sessionConn, syncRecord] = await Promise.all([
    getNotionConnection(reqOrScope),
    getProjectNotionSync(projectId),
  ]);

  if (sessionConn?.accessToken) {
    const matchesProjectWorkspace =
      !syncRecord?.notionWorkspaceId ||
      !sessionConn.workspaceId ||
      syncRecord.notionWorkspaceId === sessionConn.workspaceId;
    if (matchesProjectWorkspace || !syncRecord?.projectAccessToken) {
      return sessionConn;
    }
  }

  if (syncRecord?.projectAccessToken && syncRecord.databaseId) {
    return {
      accessToken: syncRecord.projectAccessToken,
      workspaceId: syncRecord.notionWorkspaceId || 'project-workspace',
      workspaceName: syncRecord.workspaceName ?? 'Campaign Notion Workspace',
      workspaceIcon: null,
      botId: 'project-bot',
      owner: null,
      connectedAt: syncRecord.lastSyncedAt || new Date().toISOString(),
      defaultParentPageId: syncRecord.parentPageId || null,
      defaultParentPageTitle: null,
    };
  }

  return sessionConn;
}

export async function saveProjectNotionSync(record: NotionProjectSyncRecord): Promise<void> {
  const all = await readAllProjectNotionSyncs();
  const previous = all[record.projectId];
  all[record.projectId] = {
    ...record,
    projectAccessToken: record.projectAccessToken ?? previous?.projectAccessToken,
    workspaceName: record.workspaceName ?? previous?.workspaceName ?? null,
  };
  await writeAllProjectNotionSyncs(all);
}
