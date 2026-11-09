import type { StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { ResearchEntry } from '@/marcom/schemas/research-record';
import type { PersonalizationEntry } from '@/marcom/schemas/personalization';

export interface NotionAccessiblePage {
  id: string;
  title: string;
  url: string;
  parentType?: string;
}

export interface NotionConnectionConfig {
  accessToken: string;
  workspaceId: string;
  workspaceName: string | null;
  workspaceIcon: string | null;
  botId: string;
  owner?: Record<string, unknown> | null;
  connectedAt: string;
  defaultParentPageId?: string | null;
  defaultParentPageTitle?: string | null;
}

export interface NotionConnectionStatus {
  connected: boolean;
  workspaceName?: string | null;
  workspaceIcon?: string | null;
  workspaceId?: string | null;
  connectedAt?: string | null;
  defaultParentPageId?: string | null;
  defaultParentPageTitle?: string | null;
}

export interface NotionProjectSyncRecord {
  projectId: string;
  notionWorkspaceId: string;
  parentPageId: string;
  campaignPageId: string;
  campaignPageUrl: string;
  databaseId: string;
  databaseUrl: string;
  /** Maps Marcom research `record_id` -> Notion page ID inside the Prospects database */
  prospectPageIds: Record<string, string>;
  syncedCount: number;
  lastSyncedAt: string;
}

export interface NotionSyncOptions {
  projectId: string;
  brief: StructuredBrief;
  prospects: ResearchEntry[];
  drafts?: Record<string, PersonalizationEntry>;
  parentPageId?: string;
  notionWorkspaceId?: string;
  existingSync?: NotionProjectSyncRecord | null;
  skipHubUpdate?: boolean;
}

export interface NotionSyncResult {
  success: boolean;
  url: string;
  campaignPageId: string;
  campaignPageUrl: string;
  databaseId: string;
  databaseUrl: string;
  syncedCount: number;
  prospectsSynced: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  isResync: boolean;
  lastSyncedAt: string;
  prospectPageIds?: Record<string, string>;
  errors?: string[];
}
