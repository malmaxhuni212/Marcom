import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  NotionAccessiblePage,
  NotionConnectionConfig,
  NotionDatabaseRowSnapshot,
} from './types';

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
): Promise<{
  id: string;
  url: string;
  title: string;
  lastEditedTime: string | null;
  archived: boolean;
  inTrash: boolean;
} | null> {
  try {
    const data = await notionFetch(`/pages/${pageId}`, accessToken, { method: 'GET' });
    return {
      id: data.id,
      url: data.url,
      title: extractNotionPageTitle(data),
      lastEditedTime: data.last_edited_time || null,
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

function joinRichTextPlain(richArr: any): string {
  if (!Array.isArray(richArr)) return '';
  return richArr
    .map((t: any) => t?.plain_text ?? t?.text?.content ?? '')
    .join('')
    .trim();
}

export function extractBlockPlainText(blk: Record<string, any> | null | undefined): string {
  if (!blk || typeof blk !== 'object') return '';
  if (typeof blk.plainText === 'string') return blk.plainText;
  const type = blk.type;
  if (!type || !blk[type]) return '';
  return joinRichTextPlain(blk[type].rich_text);
}

export function normalizeComparableBlockText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\s*·\s*Synced\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC/gi, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('🔄 '))
    .join('\n')
    .trim();
}

/**
 * Queries all active rows in a Notion Prospects database so re-syncs can match by Record ID or Prospect Name
 * and reconcile any status, research field, or draft edits made directly in Notion.
 */
export async function queryNotionDatabaseRows(
  accessToken: string,
  databaseId: string,
): Promise<NotionDatabaseRowSnapshot[]> {
  const rows: NotionDatabaseRowSnapshot[] = [];
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
      const recordId = joinRichTextPlain(props['Record ID']?.rich_text) || null;
      const prospectName = joinRichTextPlain(props.Prospect?.title) || null;
      const reviewStatus: string | null = props['Review Status']?.select?.name || null;
      const outreachStatus: string | null = props['Outreach Status']?.select?.name || null;
      const topSubjectLine = joinRichTextPlain(props['Top Subject Line']?.rich_text) || null;
      const primaryEmailDraft = joinRichTextPlain(props['Primary Email Draft']?.rich_text) || null;
      const linkedinDraft = joinRichTextPlain(props['LinkedIn / DM Draft']?.rich_text) || null;
      const role = joinRichTextPlain(props['Role / Title']?.rich_text) || null;
      const organisation = joinRichTextPlain(props.Organisation?.rich_text) || null;
      const location = joinRichTextPlain(props.Location?.rich_text) || null;
      const email: string | null = props.Email?.email || null;
      const phone: string | null = props.Phone?.phone_number || null;
      const linkedinUrl: string | null = props.LinkedIn?.url || null;
      const websiteUrl: string | null = props.Website?.url || null;
      const fitScore: number | null =
        typeof props['Fit Score']?.number === 'number' ? props['Fit Score'].number : null;
      const qualificationRating: string | null =
        props['Qualification Rating']?.select?.name || null;
      const targetSegment: string | null = props['Target Segment']?.select?.name || null;

      rows.push({
        id: page.id,
        url: page.url,
        recordId,
        prospectName,
        lastEditedTime: page.last_edited_time || null,
        reviewStatus,
        outreachStatus,
        topSubjectLine,
        primaryEmailDraft,
        linkedinDraft,
        role,
        organisation,
        location,
        email,
        phone,
        linkedinUrl,
        websiteUrl,
        fitScore,
        qualificationRating,
        targetSegment,
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

export interface NotionBlockChild {
  id: string;
  type: string;
  lastEditedTime?: string | null;
  plainText?: string;
}

/**
 * Lists top-level child blocks of a page or block, including plain text and lastEditedTime.
 */
export async function listNotionBlockChildren(
  accessToken: string,
  blockId: string,
): Promise<NotionBlockChild[]> {
  const blocks: NotionBlockChild[] = [];
  let startCursor: string | undefined;

  do {
    const query = startCursor ? `?page_size=100&start_cursor=${encodeURIComponent(startCursor)}` : '?page_size=100';
    const data = await notionFetch(`/blocks/${blockId}/children${query}`, accessToken, {
      method: 'GET',
    });

    const results: any[] = Array.isArray(data.results) ? data.results : [];
    for (const blk of results) {
      if (blk?.id && !blk.archived && !blk.in_trash) {
        blocks.push({
          id: blk.id,
          type: blk.type,
          lastEditedTime: blk.last_edited_time || null,
          plainText: extractBlockPlainText(blk),
        });
      }
    }

    startCursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (startCursor);

  return blocks;
}

/**
 * Updates a single Notion block in-place (e.g., updating a summary callout or email quote block on re-sync).
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

export interface ReplaceNotionPageBlocksOptions {
  /**
   * When false, the outreach section between the `✉️` heading and the `---` divider is NOT modified in Notion,
   * preserving 100% of Notion inline text comment anchors, block comments, and user-added notes.
   */
  allowOutreachMutation?: boolean;
  /**
   * When false, the top summary callout block is NOT patched in Notion unless a status banner was added.
   */
  allowSummaryCalloutMutation?: boolean;
}

/**
 * Updates the top summary callout and outreach section of a prospect page in-place above the divider
 * without touching the static intelligence dossier blocks below the divider or deleting blocks/comments.
 */
export async function replaceNotionPageBlocks(
  accessToken: string,
  pageId: string,
  newBlocks: any[],
  prefetchedExisting?: NotionBlockChild[],
  options?: ReplaceNotionPageBlocksOptions,
): Promise<void> {
  const existing = prefetchedExisting ?? (await listNotionBlockChildren(accessToken, pageId));
  if (existing.length === 0) {
    if (newBlocks.length > 0) {
      await appendNotionBlocks(accessToken, pageId, newBlocks);
    }
    return;
  }

  const existingDividerIdx = existing.findIndex((b) => b.type === 'divider');
  const newDividerIdx = newBlocks.findIndex((b) => b.type === 'divider');
  const existingHeadingIdx = existing.findIndex(
    (b, idx) =>
      b.type === 'heading_2' &&
      (existingDividerIdx === -1 || idx < existingDividerIdx) &&
      (b.plainText || '').toLowerCase().includes('outreach'),
  );
  const resolvedHeadingIdx =
    existingHeadingIdx !== -1
      ? existingHeadingIdx
      : existing[1]?.type === 'heading_2'
        ? 1
        : -1;

  // 1. Update top summary callout in-place ONLY if its substantive text changed and allowed
  const existingCallout = existing.find(
    (b, idx) => b.type === 'callout' && (resolvedHeadingIdx === -1 || idx < resolvedHeadingIdx),
  );
  if (
    existingCallout &&
    newBlocks[0]?.type === 'callout' &&
    options?.allowSummaryCalloutMutation !== false
  ) {
    const newSummaryNorm = normalizeComparableBlockText(extractBlockPlainText(newBlocks[0]));
    const oldSummaryNorm = normalizeComparableBlockText(existingCallout.plainText ?? '');
    if (newSummaryNorm !== oldSummaryNorm) {
      await updateNotionBlock(accessToken, existingCallout.id, {
        callout: newBlocks[0].callout,
      }).catch(() => null);
    }
  }

  if (resolvedHeadingIdx === -1 || existingDividerIdx <= resolvedHeadingIdx || newDividerIdx < 2) {
    // Never delete existing blocks on non-standard pages so user comments/notes are never lost
    return;
  }

  const oldOutreach = existing.slice(resolvedHeadingIdx + 1, existingDividerIdx);
  const newOutreach = newBlocks.slice(2, newDividerIdx);

  // 2. Handle transition from unpersonalized placeholder callout -> newly generated outreach blocks
  const placeholderBlock =
    oldOutreach.length === 1 &&
    oldOutreach[0]?.type === 'callout' &&
    (oldOutreach[0].plainText || '').includes('have not been generated')
      ? oldOutreach[0]
      : null;
  const newIsPlaceholder =
    newOutreach.length === 1 &&
    newOutreach[0]?.type === 'callout' &&
    extractBlockPlainText(newOutreach[0]).includes('have not been generated');

  if (placeholderBlock && !newIsPlaceholder && newOutreach.length > 0) {
    await notionFetch(`/blocks/${pageId}/children`, accessToken, {
      method: 'PATCH',
      body: JSON.stringify({
        children: newOutreach.slice(0, 80),
        after: existing[resolvedHeadingIdx]!.id,
      }),
    });
    await notionFetch(`/blocks/${placeholderBlock.id}`, accessToken, {
      method: 'DELETE',
    }).catch(() => null);
    return;
  }

  // 3. If outreach was not modified in Marcom (or the change originated in Notion), do NOT patch outreach blocks
  if (options?.allowOutreachMutation === false) {
    return;
  }

  // 4. Match leading non-toggle blocks of identical type and PATCH in-place ONLY when normalized text differs
  let matchedPrefixLen = 0;
  const minLen = Math.min(oldOutreach.length, newOutreach.length);
  while (
    matchedPrefixLen < minLen &&
    oldOutreach[matchedPrefixLen]!.type === newOutreach[matchedPrefixLen]!.type &&
    newOutreach[matchedPrefixLen]!.type !== 'toggle'
  ) {
    matchedPrefixLen += 1;
  }

  const inPlaceUpdates: Array<() => Promise<void>> = [];
  for (let i = 0; i < matchedPrefixLen; i += 1) {
    const oldBlk = oldOutreach[i]!;
    const newBlk = newOutreach[i]!;
    const blkType = newBlk.type;
    const oldNorm = normalizeComparableBlockText(oldBlk.plainText ?? '');
    const newNorm = normalizeComparableBlockText(extractBlockPlainText(newBlk));
    if (oldNorm !== newNorm && newBlk[blkType]) {
      inPlaceUpdates.push(() =>
        updateNotionBlock(accessToken, oldBlk.id, {
          [blkType]: newBlk[blkType],
        }).catch(() => undefined),
      );
    }
  }

  const BATCH_SIZE = 4;
  for (let i = 0; i < inPlaceUpdates.length; i += BATCH_SIZE) {
    const batch = inPlaceUpdates.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((fn) => fn()));
  }

  // 5. If Marcom regenerated a draft and produced a "🕘 Previous Draft Version" backup toggle,
  // append it before the divider without deleting any existing blocks or comments.
  const backupToggle = newOutreach.find(
    (b) =>
      b.type === 'toggle' &&
      extractBlockPlainText(b).includes('Previous Draft Version'),
  );
  if (backupToggle) {
    const alreadyHasBackup = oldOutreach.some(
      (b) => b.type === 'toggle' && (b.plainText || '').includes('Previous Draft Version'),
    );
    if (!alreadyHasBackup) {
      const afterBlockId =
        oldOutreach[oldOutreach.length - 1]?.id || existing[resolvedHeadingIdx]!.id;
      await notionFetch(`/blocks/${pageId}/children`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({
          children: [backupToggle],
          after: afterBlockId,
        }),
      }).catch(() => null);
    }
  }
}
