import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NotionAccessiblePage, NotionConnectionConfig } from './types';

export const NOTION_API_VERSION = '2022-06-28';
const NOTION_BASE_URL = 'https://api.notion.com/v1';

export class NotionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'NotionApiError';
  }
}

function stripSurroundingQuotes(val: string | undefined): string | undefined {
  if (!val) return undefined;
  return val.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim() || undefined;
}

export function getNotionOAuthConfig() {
  const clientId = stripSurroundingQuotes(process.env.NOTION_CLIENT_ID);
  const clientSecret = stripSurroundingQuotes(process.env.NOTION_CLIENT_SECRET);
  const configuredRedirect = stripSurroundingQuotes(process.env.NOTION_REDIRECT_URI);

  return {
    clientId,
    clientSecret,
    redirectUri: configuredRedirect || 'http://localhost:3000/api/integrations/notion/callback',
    isConfigured: Boolean(clientId && clientSecret),
  };
}

function getOAuthStateSecret(): string {
  const { clientSecret } = getNotionOAuthConfig();
  return (clientSecret || process.env.AUTH_SECRET || '').trim();
}

export interface NotionOAuthStatePayload {
  workspaceId?: string;
  returnOrigin?: string;
  sessionScope?: string;
  ttlSeconds?: number;
}

export interface VerifiedNotionOAuthState {
  valid: boolean;
  workspaceId?: string;
  returnOrigin?: string;
  sessionScope?: string;
  error?: string;
}

/**
 * Generates an HMAC-SHA256 signed state parameter for Notion OAuth CSRF protection.
 */
export function createNotionOAuthState(options: NotionOAuthStatePayload = {}): string {
  const secret = getOAuthStateSecret();
  if (!secret) {
    throw new Error('Cannot sign Notion OAuth state: NOTION_CLIENT_SECRET is missing.');
  }

  const ttlMs = (options.ttlSeconds ?? 600) * 1000;
  const payload = {
    n: randomBytes(16).toString('hex'),
    w: options.workspaceId || undefined,
    o: options.returnOrigin || undefined,
    s: options.sessionScope || undefined,
    exp: Date.now() + ttlMs,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies an HMAC-SHA256 signed Notion OAuth state token and checks expiration.
 */
export function verifyNotionOAuthState(stateToken: string | null | undefined): VerifiedNotionOAuthState {
  if (!stateToken || typeof stateToken !== 'string') {
    return { valid: false, error: 'Missing OAuth state parameter.' };
  }

  const secret = getOAuthStateSecret();
  if (!secret) {
    return { valid: false, error: 'Notion OAuth secret is not configured.' };
  }

  const dotIdx = stateToken.indexOf('.');
  if (dotIdx <= 0 || dotIdx === stateToken.length - 1) {
    return { valid: false, error: 'Malformed OAuth state parameter.' };
  }

  const encodedPayload = stateToken.slice(0, dotIdx);
  const providedSig = stateToken.slice(dotIdx + 1);
  const expectedSig = createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, error: 'Invalid OAuth state signature.' };
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as {
      n?: string;
      w?: string;
      o?: string;
      s?: string;
      exp?: number;
    };

    if (typeof decoded.exp !== 'number' || decoded.exp < Date.now()) {
      return { valid: false, error: 'Expired OAuth state token.' };
    }

    return {
      valid: true,
      workspaceId: decoded.w,
      returnOrigin: decoded.o,
      sessionScope: decoded.s,
    };
  } catch {
    return { valid: false, error: 'Corrupted OAuth state payload.' };
  }
}

/**
 * Builds the authorization URL where the user connects their Notion workspace.
 */
export function buildNotionAuthUrl(redirectUri?: string, state?: string): string {
  const { clientId, redirectUri: fallbackRedirect } = getNotionOAuthConfig();
  if (!clientId) {
    throw new Error('NOTION_CLIENT_ID is not configured in the environment.');
  }

  const targetRedirect = redirectUri || fallbackRedirect;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: targetRedirect,
  });

  if (state) {
    params.set('state', state);
  }

  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

/**
 * Exchanges the one-time authorization code for a Notion access token.
 */
export async function exchangeNotionCode(
  code: string,
  redirectUri: string,
): Promise<NotionConnectionConfig> {
  const { clientId, clientSecret } = getNotionOAuthConfig();
  if (!clientId || !clientSecret) {
    throw new Error('NOTION_CLIENT_ID or NOTION_CLIENT_SECRET is missing.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(`${NOTION_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorJson = (await response.json().catch(() => ({}))) as Record<string, any>;
    throw new NotionApiError(
      errorJson.message || errorJson.error_description || `Notion OAuth failed with status ${response.status}`,
      response.status,
      errorJson.error || errorJson.code,
    );
  }

  const data = (await response.json()) as Record<string, any>;

  return {
    accessToken: data.access_token,
    workspaceId: data.workspace_id,
    workspaceName: data.workspace_name || null,
    workspaceIcon: data.workspace_icon || null,
    botId: data.bot_id,
    owner: data.owner || null,
    connectedAt: new Date().toISOString(),
    defaultParentPageId: data.duplicated_template_id || null,
    defaultParentPageTitle: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Standard fetch helper for authenticated Notion API requests with automatic 429 & transient 5xx retry.
 */
export async function notionFetch(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<any> {
  const url = endpoint.startsWith('http') ? endpoint : `${NOTION_BASE_URL}${endpoint}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(12000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.ok) {
      return response.json();
    }

    const isRateLimited = response.status === 429;
    const isTransientServer =
      response.status === 502 || response.status === 503 || response.status === 504;

    if ((isRateLimited || isTransientServer) && attempt < maxRetries) {
      const retryAfterSec = Number(response.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 2000)
          : 400 * Math.pow(2, attempt);
      await sleep(waitMs);
      continue;
    }

    const errorJson = (await response.json().catch(() => ({}))) as Record<string, any>;
    throw new NotionApiError(
      errorJson.message || `Notion request failed (${response.status} ${response.statusText})`,
      response.status,
      errorJson.code,
    );
  }

  throw new NotionApiError('Notion request exceeded maximum retries.');
}

function extractNotionPageTitle(page: Record<string, any>): string {
  const props = page?.properties;
  if (props && typeof props === 'object') {
    for (const value of Object.values(props) as Array<Record<string, any>>) {
      if (value?.type === 'title' && Array.isArray(value.title)) {
        const text = value.title.map((t: any) => t?.plain_text || '').join('').trim();
        if (text) return text;
      }
    }
    const fallbackTitle = props.title?.title || props.Name?.title;
    if (Array.isArray(fallbackTitle)) {
      const text = fallbackTitle.map((t: any) => t?.plain_text || '').join('').trim();
      if (text) return text;
    }
  }
  return 'Untitled Page';
}

export function filterAndRankAccessiblePages(rawPages: any[]): NotionAccessiblePage[] {
  const candidates: Array<NotionAccessiblePage & { rank: number }> = [];

  for (const page of rawPages) {
    if (!page || page.object !== 'page') continue;
    if (page.archived === true || page.in_trash === true) continue;

    const parentType: string = page.parent?.type || 'unknown';
    // Never select a database row page as the parent for a Campaign Hub
    if (parentType === 'database_id') continue;

    const title = extractNotionPageTitle(page);
    // Avoid nesting a new Campaign Hub inside an existing Marcom Campaign Hub
    if (
      title.endsWith('— Intelligence & Outreach Hub') ||
      title.endsWith('— Campaign Hub')
    ) {
      continue;
    }

    const isSystemPeoplePage = title.trim().toLowerCase() === 'people';
    let rank = 2;
    if (isSystemPeoplePage) {
      rank = 3; // Valid fallback only if no regular workspace/user page is shared
    } else if (parentType === 'workspace') {
      rank = 0; // Best choice: top-level shared page
    } else if (parentType === 'page_id') {
      rank = 1; // Good choice: shared subpage
    }

    candidates.push({
      id: page.id,
      title,
      url: page.url,
      parentType,
      rank,
    });
  }

  candidates.sort((a, b) => a.rank - b.rank);
  return candidates.map(({ rank: _rank, ...rest }) => rest);
}

/**
 * Searches for accessible pages in the user's Notion workspace suitable to host a Campaign Hub.
 */
export async function searchNotionAccessiblePages(
  accessToken: string,
): Promise<NotionAccessiblePage[]> {
  const data = await notionFetch('/search', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      filter: { value: 'page', property: 'object' },
      page_size: 50,
    }),
  });

  const results: any[] = Array.isArray(data.results) ? data.results : [];
  return filterAndRankAccessiblePages(results);
}

/**
 * Creates a new Notion page.
 */
export async function createNotionPage(
  accessToken: string,
  payload: Record<string, any>,
): Promise<{ id: string; url: string }> {
  const data = await notionFetch('/pages', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: data.id, url: data.url };
}

/**
 * Retrieves an existing Notion page or returns null if not found.
 */
export async function getNotionPage(
  accessToken: string,
  pageId: string,
): Promise<{ id: string; url: string; archived: boolean; inTrash: boolean } | null> {
  try {
    const data = await notionFetch(`/pages/${pageId}`, accessToken, { method: 'GET' });
    return {
      id: data.id,
      url: data.url,
      archived: Boolean(data.archived),
      inTrash: Boolean(data.in_trash),
    };
  } catch (err) {
    if (err instanceof NotionApiError && (err.status === 404 || err.status === 400)) {
      return null;
    }
    throw err;
  }
}

/**
 * Updates properties or icon/archive state on an existing Notion page.
 */
export async function updateNotionPage(
  accessToken: string,
  pageId: string,
  payload: Record<string, any>,
): Promise<{ id: string; url: string }> {
  const data = await notionFetch(`/pages/${pageId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return { id: data.id, url: data.url };
}

/**
 * Creates a new Notion database (with column definitions).
 */
export async function createNotionDatabase(
  accessToken: string,
  payload: Record<string, any>,
): Promise<{ id: string; url: string }> {
  const data = await notionFetch('/databases', accessToken, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id: data.id, url: data.url };
}

/**
 * Retrieves an existing Notion database or returns null if not found.
 */
export async function getNotionDatabase(
  accessToken: string,
  databaseId: string,
): Promise<{
  id: string;
  url: string;
  archived: boolean;
  inTrash: boolean;
  properties: Record<string, any>;
} | null> {
  try {
    const data = await notionFetch(`/databases/${databaseId}`, accessToken, { method: 'GET' });
    return {
      id: data.id,
      url: data.url,
      archived: Boolean(data.archived),
      inTrash: Boolean(data.in_trash),
      properties: data.properties || {},
    };
  } catch (err) {
    if (err instanceof NotionApiError && (err.status === 404 || err.status === 400)) {
      return null;
    }
    throw err;
  }
}

/**
 * Updates schema properties or title on an existing Notion database.
 */
export async function updateNotionDatabase(
  accessToken: string,
  databaseId: string,
  payload: Record<string, any>,
): Promise<{ id: string; url: string }> {
  const data = await notionFetch(`/databases/${databaseId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  return { id: data.id, url: data.url };
}

/**
 * Queries all active rows in a Notion Prospects database so re-syncs can match by Record ID or Prospect Name.
 */
export async function queryNotionDatabaseRows(
  accessToken: string,
  databaseId: string,
): Promise<Array<{ id: string; url: string; recordId: string | null; prospectName: string | null }>> {
  const rows: Array<{ id: string; url: string; recordId: string | null; prospectName: string | null }> = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, any> = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const data = await notionFetch(`/databases/${databaseId}/query`, accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const pageResults: any[] = Array.isArray(data.results) ? data.results : [];
    for (const page of pageResults) {
      if (page.archived || page.in_trash) continue;
      const props = page.properties || {};
      const recordIdRich = props['Record ID']?.rich_text;
      const recordId = Array.isArray(recordIdRich)
        ? recordIdRich.map((t: any) => t?.plain_text || '').join('').trim() || null
        : null;
      const titleArr = props.Prospect?.title;
      const prospectName = Array.isArray(titleArr)
        ? titleArr.map((t: any) => t?.plain_text || '').join('').trim() || null
        : null;

      rows.push({
        id: page.id,
        url: page.url,
        recordId,
        prospectName,
      });
    }

    startCursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (startCursor);

  return rows;
}

/**
 * Appends blocks to an existing page or block.
 * Automatically chunks into batches of 80 blocks to respect Notion's 100-block limit.
 */
export async function appendNotionBlocks(
  accessToken: string,
  blockId: string,
  blocks: any[],
): Promise<void> {
  const CHUNK_SIZE = 80;
  for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
    const chunk = blocks.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await notionFetch(`/blocks/${blockId}/children`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ children: chunk }),
    });
  }
}

/**
 * Lists top-level child blocks of a page or block.
 */
export async function listNotionBlockChildren(
  accessToken: string,
  blockId: string,
): Promise<Array<{ id: string; type: string }>> {
  const blocks: Array<{ id: string; type: string }> = [];
  let startCursor: string | undefined;

  do {
    const query = startCursor ? `?page_size=100&start_cursor=${encodeURIComponent(startCursor)}` : '?page_size=100';
    const data = await notionFetch(`/blocks/${blockId}/children${query}`, accessToken, {
      method: 'GET',
    });

    const results: any[] = Array.isArray(data.results) ? data.results : [];
    for (const blk of results) {
      if (blk?.id && !blk.archived && !blk.in_trash) {
        blocks.push({ id: blk.id, type: blk.type });
      }
    }

    startCursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (startCursor);

  return blocks;
}

/**
 * Updates a single Notion block in-place (e.g., updating a summary callout on re-sync).
 */
export async function updateNotionBlock(
  accessToken: string,
  blockId: string,
  payload: Record<string, any>,
): Promise<void> {
  await notionFetch(`/blocks/${blockId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates the top summary callout and outreach section of a prospect page above the divider
 * without touching the static intelligence dossier blocks below the divider.
 * Falls back to full block replacement if the page has no divider structure.
 */
export async function replaceNotionPageBlocks(
  accessToken: string,
  pageId: string,
  newBlocks: any[],
): Promise<void> {
  const existing = await listNotionBlockChildren(accessToken, pageId);
  const existingDividerIdx = existing.findIndex((b) => b.type === 'divider');
  const newDividerIdx = newBlocks.findIndex((b) => b.type === 'divider');

  if (
    existingDividerIdx >= 2 &&
    newDividerIdx >= 2 &&
    existing[0]?.type === 'callout' &&
    newBlocks[0]?.type === 'callout' &&
    existing[1]?.type === 'heading_2'
  ) {
    // 1. Update top summary callout in-place (preserves block ID & comments)
    await updateNotionBlock(accessToken, existing[0].id, {
      callout: newBlocks[0].callout,
    }).catch(() => null);

    // 2. Replace only the outreach section between heading_2 (index 1) and the divider
    const oldOutreachBlocks = existing.slice(2, existingDividerIdx);
    const newOutreachBlocks = newBlocks.slice(2, newDividerIdx);

    const BATCH_SIZE = 4;
    for (let i = 0; i < oldOutreachBlocks.length; i += BATCH_SIZE) {
      const batch = oldOutreachBlocks.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((blk) =>
          notionFetch(`/blocks/${blk.id}`, accessToken, { method: 'DELETE' }).catch(() => null),
        ),
      );
    }

    if (newOutreachBlocks.length > 0) {
      await notionFetch(`/blocks/${pageId}/children`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({
          children: newOutreachBlocks.slice(0, 80),
          after: existing[1].id,
        }),
      });
    }
    return;
  }

  const deletable = existing.filter(
    (b) => b.type !== 'child_database' && b.type !== 'child_page',
  );

  const BATCH_SIZE = 4;
  for (let i = 0; i < deletable.length; i += BATCH_SIZE) {
    const batch = deletable.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((blk) =>
        notionFetch(`/blocks/${blk.id}`, accessToken, { method: 'DELETE' }).catch(() => null),
      ),
    );
  }

  if (newBlocks.length > 0) {
    await appendNotionBlocks(accessToken, pageId, newBlocks);
  }
}
