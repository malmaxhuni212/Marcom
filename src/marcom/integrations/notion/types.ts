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

export interface NotionDatabaseRowSnapshot {
  id: string;
  url: string;
  recordId: string | null;
  prospectName: string | null;
  lastEditedTime?: string | null;
  reviewStatus?: string | null;
  outreachStatus?: string | null;
  topSubjectLine?: string | null;
  primaryEmailDraft?: string | null;
  linkedinDraft?: string | null;
  role?: string | null;
  organisation?: string | null;
  location?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  websiteUrl?: string | null;
  fitScore?: number | null;
  qualificationRating?: string | null;
  targetSegment?: string | null;
}

export interface NotionReconciledReviewUpdate {
  recordId: string;
  status: 'needs_review' | 'shortlisted' | 'rejected' | 'enrichment_requested';
  note: string | null;
  relationshipStatus?: 'contacted' | null;
}

export interface NotionReconciledChanges {
  updatedBrief?: StructuredBrief | null;
  updatedResearchEntries?: ResearchEntry[];
  updatedDrafts: PersonalizationEntry[];
  updatedReviews: NotionReconciledReviewUpdate[];
  pulledCount: number;
}

export interface NotionProjectSyncRecord {
  projectId: string;
  notionWorkspaceId: string;
  workspaceName?: string | null;
  /** Server-side token bound to this specific synced campaign so collaborators on the project share Notion sync */
  projectAccessToken?: string;
  parentPageId: string;
  campaignPageId: string;
  campaignPageUrl: string;
  databaseId: string;
  databaseUrl: string;
  /** Maps Marcom research `record_id` -> Notion page ID inside the Prospects database */
  prospectPageIds: Record<string, string>;
  syncedCount: number;
  lastSyncedAt: string;
  /** Timestamp before the current sync began, preserved across batch chunks */
  priorLastSyncedAt?: string | null;
  /** Optional snapshot of Notion database rows captured during Step 0 for batch reconciliation */
  existingRowsSnapshot?: NotionDatabaseRowSnapshot[];
}

export interface NotionSyncOptions {
  projectId: string;
  brief: StructuredBrief;
  configurationUpdatedAt?: string | null;
  prospects: ResearchEntry[];
  drafts?: Record<string, PersonalizationEntry>;
  parentPageId?: string;
  notionWorkspaceId?: string;
  existingSync?: NotionProjectSyncRecord | null;
  skipHubUpdate?: boolean;
  activeRecordIds?: string[];
  statsOverride?: {
    totalProspects: number;
    shortlistedCount: number;
    draftsReadyCount: number;
  };
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
  priorLastSyncedAt?: string | null;
  prospectPageIds?: Record<string, string>;
  existingRowsSnapshot?: NotionDatabaseRowSnapshot[];
  reconciledChanges?: NotionReconciledChanges;
  errors?: string[];
}
