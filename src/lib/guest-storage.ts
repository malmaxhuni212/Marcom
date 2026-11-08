import type { ProjectMemory } from '@/marcom/memory/types';
import { appendFeedback, createFeedbackItem } from '@/marcom/personalization/feedback';
import {
  evidenceCoverage,
  reviewStatus,
  summarizeResearch,
  type ResearchReviewSummary,
} from '@/marcom/research/review';
import {
  CategoryOutreachTemplateSchema,
  FeedbackScopeSchema,
  LeadPersonalizationSettingsSchema,
  normalizeCategoryKey,
  PersonalizationSettingsSchema,
  type EvaluatedRoute,
  type LeadPersonalizationSettings,
  type OutreachCopy,
  type PersonalizationEntry,
  type PersonalizationFeedback,
  type PersonalizationSettings,
  type PersonalizationStatus,
} from '@/marcom/schemas/personalization';
import type { ResearchEntry, ReviewStatus } from '@/marcom/schemas/research-record';
import { StructuredBriefSchema, type StructuredBrief } from '@/marcom/schemas/structured-brief';
import type { Project } from '@/types';
import { z } from 'zod';

const DB_NAME = 'marcom_guest_workspace_db';
const DB_VERSION = 1;
const STORE_NAME = 'guest_projects';
const FALLBACK_STORAGE_KEY = 'marcom_guest_projects_fallback_v1';
const GUEST_TOKEN_STORAGE_KEY = 'marcom_guest_token_v1';

export type StoredGuestCampaign = {
  id: string;
  createdAt: string;
  updatedAt: string;
  originalBrief: string;
  sourceType: string;
  sourceName: string;
  project: ProjectMemory;
  research: ResearchEntry[];
  personalizations: PersonalizationEntry[];
  settings: PersonalizationSettings;
};

const memoryStore = new Map<string, StoredGuestCampaign>();

function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openGuestIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function readAllGuestCampaigns(): Promise<StoredGuestCampaign[]> {
  if (isIndexedDbAvailable()) {
    try {
      const db = await openGuestIndexedDb();
      return await new Promise<StoredGuestCampaign[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          db.close();
          const list = Array.isArray(req.result) ? (req.result as StoredGuestCampaign[]) : [];
          list.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          resolve(list);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      });
    } catch {
      // Fall back to localStorage / memory
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredGuestCampaign[];
        if (Array.isArray(parsed)) {
          return parsed.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
        }
      }
    } catch {
      // Ignore storage error
    }
  }

  return Array.from(memoryStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

async function writeGuestCampaign(campaign: StoredGuestCampaign): Promise<void> {
  memoryStore.set(campaign.id, campaign);

  if (isIndexedDbAvailable()) {
    try {
      const db = await openGuestIndexedDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(campaign);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
      return;
    } catch {
      // Fall back to localStorage
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const all = await readAllGuestCampaigns();
      const byId = new Map(all.map((c) => [c.id, c]));
      byId.set(campaign.id, campaign);
      window.localStorage.setItem(
        FALLBACK_STORAGE_KEY,
        JSON.stringify(Array.from(byId.values())),
      );
    } catch {
      // Ignore quota errors
    }
  }
}

export async function getStoredGuestCampaign(
  projectId: string,
): Promise<StoredGuestCampaign | null> {
  const all = await readAllGuestCampaigns();
  return all.find((item) => item.id === projectId) ?? null;
}

export async function deleteGuestProject(projectId: string): Promise<boolean> {
  memoryStore.delete(projectId);

  if (isIndexedDbAvailable()) {
    try {
      const db = await openGuestIndexedDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(projectId);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
      return true;
    } catch {
      // Fall through
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const all = await readAllGuestCampaigns();
      const filtered = all.filter((c) => c.id !== projectId);
      window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(filtered));
    } catch {
      // Ignore
    }
  }
  return true;
}

export async function clearAllGuestProjects(): Promise<void> {
  memoryStore.clear();
  if (isIndexedDbAvailable()) {
    try {
      const db = await openGuestIndexedDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    } catch {
      // Ignore
    }
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function getStoredGuestToken(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredGuestToken(token: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !token) return;
  try {
    window.localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore
  }
}

function mapCampaignToUiProject(c: StoredGuestCampaign): Project {
  const pm = c.project;
  let icon = '📁';
  let accentColor: Project['accentColor'] = 'blue';
  const lower = (pm.name || '').toLowerCase();
  if (lower.includes('book') || lower.includes('author') || lower.includes('literary')) {
    icon = '📚';
    accentColor = 'pink';
  } else if (lower.includes('sponsor')) {
    icon = '🏆';
    accentColor = 'purple';
  } else if (lower.includes('film') || lower.includes('soulbound')) {
    icon = '🎬';
    accentColor = 'blue';
  } else if (lower.includes('robot') || lower.includes('tech') || lower.includes('launch')) {
    icon = '🤖';
    accentColor = 'blue';
  } else if (lower.includes('hire') || lower.includes('recruit') || lower.includes('talent')) {
    icon = '🎯';
    accentColor = 'amber';
  } else if (lower.includes('partner') || lower.includes('sales')) {
    icon = '🤝';
    accentColor = 'blue';
  }

  const research = c.research ?? [];
  const personalizations = c.personalizations ?? [];
  const prospectsCurrent = research.length;
  const qualifiedCount = personalizations.length;
  const reviewCount = research.filter(
    (r) => r && (!r.review?.status || r.review?.status === 'needs_review'),
  ).length;

  const status: Project['status'] =
    pm.status === 'READY_FOR_RESEARCH'
      ? 'active'
      : pm.status === 'active' || pm.status === 'paused' || pm.status === 'completed'
        ? pm.status
        : 'draft';

  return {
    id: pm.project_id,
    name: pm.name || 'Untitled Project',
    description:
      pm.summary ||
      pm.structured_brief?.project?.description ||
      'No description provided.',
    prospectsCurrent,
    prospectsTotal: Math.max(100, prospectsCurrent),
    qualifiedCount,
    reviewCount,
    status,
    accentColor,
    icon,
  };
}

export async function listGuestProjects(): Promise<Project[]> {
  const campaigns = await readAllGuestCampaigns();
  return campaigns.map(mapCampaignToUiProject);
}

export async function createGuestProject(input: {
  structured_brief: unknown;
  original_brief: string;
  source_type?: string;
  source_name?: string;
}): Promise<ProjectMemory> {
  const sb: StructuredBrief = StructuredBriefSchema.parse(input.structured_brief);
  const now = new Date().toISOString();
  const projectId = `guest-proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const project: ProjectMemory = {
    project_id: projectId,
    name: sb.project.name || 'Guest Project',
    aliases: [],
    summary: sb.project.description,
    status: 'READY_FOR_RESEARCH',
    structured_brief: sb,
    target_definitions: sb.targets.map((t) => ({
      target_type: t.target_type,
      definition: t.description,
      aliases: [],
    })),
    notes: [
      `Original Brief Source: ${input.source_name || 'Guest Brief'}`,
      'Saved only on this device (Guest Mode)',
    ],
    configuration_revision: 1,
    configuration_updated_at: now,
  };

  const campaign: StoredGuestCampaign = {
    id: projectId,
    createdAt: now,
    updatedAt: now,
    originalBrief: input.original_brief,
    sourceType: input.source_type || 'PASTE',
    sourceName: input.source_name || 'Guest Input',
    project,
    research: [],
    personalizations: [],
    settings: PersonalizationSettingsSchema.parse({}),
  };

  await writeGuestCampaign(campaign);
  return project;
}

export async function getGuestProjectDetail(projectId: string): Promise<{
  project: ProjectMemory;
  research: ResearchEntry[];
  research_summary: ResearchReviewSummary;
} | null> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) return null;
  const research = [...(campaign.research ?? [])].sort(
    (a, b) =>
      Date.parse(b.record.researched_at) - Date.parse(a.record.researched_at),
  );
  return {
    project: campaign.project,
    research,
    research_summary: summarizeResearch(research),
  };
}

export async function updateGuestProjectConfiguration(
  projectId: string,
  structuredBriefInput: unknown,
): Promise<ProjectMemory | null> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) return null;

  const sb = StructuredBriefSchema.parse(structuredBriefInput);
  const now = new Date().toISOString();
  const nextProject: ProjectMemory = {
    ...campaign.project,
    name: sb.project.name || campaign.project.name,
    summary: sb.project.description || campaign.project.summary,
    structured_brief: sb,
    target_definitions: sb.targets.map((t) => ({
      target_type: t.target_type,
      definition: t.description,
      aliases: [],
    })),
    configuration_revision: (campaign.project.configuration_revision ?? 1) + 1,
    configuration_updated_at: now,
  };

  await writeGuestCampaign({
    ...campaign,
    updatedAt: now,
    project: nextProject,
  });
  return nextProject;
}

function searchableText(entry: ResearchEntry): string {
  return [
    entry.record.identity.name,
    entry.seed.name,
    entry.record.role,
    entry.record.organisation,
    entry.record.location,
    entry.record.country,
    entry.record.summary,
    entry.record.target_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export async function getGuestResearchPaginated(
  projectId: string,
  search: URLSearchParams,
): Promise<Record<string, unknown> | null> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) return null;

  const allEntries = campaign.research ?? [];
  const query = search.get('q')?.trim().toLowerCase() ?? '';
  const status = search.get('status') ?? 'all';
  const entityType = search.get('type') ?? 'all';
  const target = search.get('target')?.trim().toLowerCase() ?? '';
  const location = search.get('location')?.trim().toLowerCase() ?? '';
  const confidence = search.get('confidence') ?? 'all';
  const coverage = search.get('coverage') ?? 'all';
  const batch = search.get('batch') ?? 'all';
  const sort = search.get('sort') ?? 'newest';
  const page = Math.max(1, Number.parseInt(search.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(5, Number.parseInt(search.get('pageSize') ?? '20', 10) || 20),
  );

  const locations = [
    ...new Set(
      allEntries
        .flatMap((entry) => [entry.record.location, entry.record.country])
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const targets = [
    ...new Set(allEntries.map((entry) => entry.record.target_type).filter(Boolean)),
  ].sort();

  const batchMap = new Map<number, { id: string; number: number; count: number }>();
  for (const entry of allEntries) {
    const num = entry.batch_number ?? 1;
    const bId = entry.batch_id ?? `batch-${num}`;
    const cur = batchMap.get(num) ?? { id: bId, number: num, count: 0 };
    cur.count += 1;
    batchMap.set(num, cur);
  }
  const batches = [...batchMap.values()].sort((a, b) => b.number - a.number);

  const filtered = allEntries.filter((entry) => {
    if (query && !searchableText(entry).includes(query)) return false;
    if (status !== 'all' && reviewStatus(entry) !== status) return false;
    if (entityType !== 'all' && entry.record.identity.entity_kind !== entityType) return false;
    if (target && entry.record.target_type.toLowerCase() !== target) return false;
    if (
      location &&
      ![entry.record.location, entry.record.country]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(location)
    ) {
      return false;
    }
    if (confidence !== 'all' && entry.record.research_confidence !== confidence) return false;
    const evidence = evidenceCoverage(entry);
    if (coverage === 'complete' && (evidence.unsupported > 0 || evidence.supported === 0)) {
      return false;
    }
    if (coverage === 'incomplete' && evidence.unsupported === 0 && evidence.supported > 0) {
      return false;
    }
    if (batch !== 'all' && entry.batch_id !== batch && String(entry.batch_number) !== batch) {
      return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'fit_desc') return b.record.fit.score - a.record.fit.score;
    if (sort === 'name_asc') {
      return (a.record.identity.name ?? a.seed.name).localeCompare(
        b.record.identity.name ?? b.seed.name,
      );
    }
    if (sort === 'evidence_desc') {
      return evidenceCoverage(b).percent - evidenceCoverage(a).percent;
    }
    return Date.parse(b.record.researched_at) - Date.parse(a.record.researched_at);
  });

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;

  return {
    project: { id: campaign.project.project_id, name: campaign.project.name },
    items: filtered.slice(start, start + pageSize),
    pagination: { page: safePage, page_size: pageSize, total, page_count: pageCount },
    summary: summarizeResearch(allEntries),
    facets: { locations, targets, batches },
  };
}

export async function getGuestNextBatchInfo(
  projectId: string,
): Promise<{ batch_id: string; batch_number: number }> {
  const campaign = await getStoredGuestCampaign(projectId);
  const highest = (campaign?.research ?? []).reduce(
    (max, entry) => Math.max(max, entry.batch_number ?? 0),
    0,
  );
  const nextNumber = highest + 1;
  return {
    batch_id: `batch-${nextNumber}`,
    batch_number: nextNumber,
  };
}

export async function appendGuestResearchEntries(
  projectId: string,
  entries: ResearchEntry[],
): Promise<ResearchEntry[]> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign || entries.length === 0) return campaign?.research ?? [];

  const byRecordId = new Map<string, ResearchEntry>();
  for (const existing of campaign.research ?? []) {
    byRecordId.set(existing.record.record_id, existing);
  }
  for (const incoming of entries) {
    byRecordId.set(incoming.record.record_id, incoming);
  }

  const nextResearch = Array.from(byRecordId.values()).sort(
    (a, b) =>
      Date.parse(b.record.researched_at) - Date.parse(a.record.researched_at),
  );

  await writeGuestCampaign({
    ...campaign,
    updatedAt: new Date().toISOString(),
    research: nextResearch,
  });
  return nextResearch;
}

export async function updateGuestResearchReview(
  projectId: string,
  recordId: string,
  status: ReviewStatus,
  note: string | null,
): Promise<ResearchEntry | null> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) return null;

  let updated: ResearchEntry | null = null;
  const now = new Date().toISOString();
  const nextResearch = (campaign.research ?? []).map((entry) => {
    if (entry.record.record_id !== recordId) return entry;
    updated = {
      ...entry,
      review: {
        project_id: projectId,
        record_id: recordId,
        status,
        note,
        reviewed_at: now,
        reviewed_by: 'guest',
      },
    };
    return updated;
  });

  if (!updated) return null;

  await writeGuestCampaign({
    ...campaign,
    updatedAt: now,
    research: nextResearch,
  });
  return updated;
}

export async function deleteGuestResearch(
  projectId: string,
  opts: {
    recordId?: string | null;
    batchId?: string | null;
    recordIds?: string[] | null;
    all?: boolean;
  },
): Promise<boolean> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) return false;

  const before = campaign.research.length;
  let nextResearch = campaign.research;

  if (opts.all) {
    nextResearch = [];
  } else if (opts.batchId) {
    nextResearch = nextResearch.filter(
      (r) =>
        r.batch_id !== opts.batchId &&
        String(r.batch_number) !== String(opts.batchId).replace('batch-', ''),
    );
  } else if (opts.recordIds && opts.recordIds.length > 0) {
    const idSet = new Set(opts.recordIds);
    nextResearch = nextResearch.filter((r) => !idSet.has(r.record.record_id));
  } else if (opts.recordId) {
    nextResearch = nextResearch.filter((r) => r.record.record_id !== opts.recordId);
  }

  if (nextResearch.length === before && !opts.all) return false;

  await writeGuestCampaign({
    ...campaign,
    updatedAt: new Date().toISOString(),
    research: nextResearch,
  });
  return true;
}

function summarizePersonalizationList(entries: PersonalizationEntry[]) {
  return {
    total: entries.length,
    draft: entries.filter((e) => e.status === 'draft').length,
    approved: entries.filter((e) => e.status === 'approved').length,
    rejected: entries.filter((e) => e.status === 'rejected').length,
    needs_more_research: entries.filter((e) => e.status === 'needs_more_research').length,
    failed: entries.filter((e) => e.status === 'failed').length,
    edited_by_human: entries.filter((e) => e.edited_by_human).length,
  };
}

function enrichPersonalizationWithResearch(
  entries: PersonalizationEntry[],
  allResearch: ResearchEntry[],
): PersonalizationEntry[] {
  const researchMap = new Map(allResearch.map((r) => [r.record.record_id, r.record]));
  return entries.map((e) => {
    const rec = researchMap.get(e.record_id);
    if (!rec) return e;
    const keyPeople = rec.key_contacts ?? [];
    const emails = [
      ...new Set(
        [
          ...(rec.public_contact?.filter((c) => c.kind === 'email').map((c) => c.value) || []),
          ...keyPeople.map((p) => p.email ?? ''),
        ].filter(Boolean),
      ),
    ];
    const phones = [
      ...new Set(
        [
          ...(rec.public_contact?.filter((c) => c.kind === 'phone').map((c) => c.value) || []),
          ...keyPeople.map((p) => p.phone ?? ''),
        ].filter(Boolean),
      ),
    ];
    const linkedin_urls = [
      ...new Set(
        [
          ...(rec.social_profiles?.filter((s) => s.platform === 'linkedin').map((s) => s.profile_url) || []),
          ...keyPeople.map((p) => p.linkedin_url ?? ''),
        ].filter(Boolean),
      ),
    ];
    const seenSocialUrls = new Set<string>();
    const social_profiles = (rec.social_profiles ?? [])
      .filter((s) => s.platform !== 'linkedin' && Boolean(s.profile_url))
      .filter((s) => {
        const key = s.profile_url.trim().toLowerCase();
        if (seenSocialUrls.has(key)) return false;
        seenSocialUrls.add(key);
        return true;
      })
      .map((s) => ({ platform: s.platform, url: s.profile_url }));
    const websites = rec.websites?.map((w) => w.url).filter(Boolean) || [];

    const candidate_contacts = {
      emails,
      linkedin_urls,
      websites,
      phones,
      social_profiles,
    };

    const evaluated_routes: EvaluatedRoute[] = [
      ...emails.map((em): EvaluatedRoute => ({
        channel: 'email',
        value: em,
        verdict: 'recommended',
        quality_assessment: 'Verified email route',
        priority: 1,
      })),
      ...linkedin_urls.map((li): EvaluatedRoute => ({
        channel: 'linkedin',
        value: li,
        verdict: 'viable_backup',
        quality_assessment: 'LinkedIn route',
        priority: 2,
      })),
    ];

    return {
      ...e,
      candidate_contacts,
      strategy: e.strategy
        ? {
            ...e.strategy,
            contact_audit: e.strategy.contact_audit ?? {
              best_channel: emails[0] ? 'email' : linkedin_urls[0] ? 'linkedin' : 'other',
              best_contact_target:
                emails[0] || linkedin_urls[0] || websites[0] || 'No direct contact found',
              why_best_route: 'Discovered in prospect research dossier.',
              is_direct_contact: Boolean(emails[0] || linkedin_urls[0]),
              email_status: emails[0] ? 'verified_direct' : 'not_available',
              backup_route: linkedin_urls[0] || websites[0] || null,
              evaluated_routes,
            },
          }
        : e.strategy,
    };
  });
}

export async function getGuestPersonalizationPayload(
  projectId: string,
  search: URLSearchParams,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) {
    return { status: 404, data: { error: 'Project not found' } };
  }

  const recordId = search.get('recordId');
  const batch = search.get('batch');
  const status = search.get('status');

  const settings = campaign.settings ?? PersonalizationSettingsSchema.parse({});
  const enriched = enrichPersonalizationWithResearch(
    campaign.personalizations ?? [],
    campaign.research ?? [],
  );

  if (recordId) {
    const item = enriched.find((e) => e.record_id === recordId);
    return item
      ? { status: 200, data: { item, settings } }
      : { status: 404, data: { error: 'Personalization not found for this record' } };
  }

  let filtered = enriched;
  if (batch && batch !== 'all') {
    filtered = filtered.filter(
      (e) => e.batch_id === batch || String(e.batch_number) === batch.replace('batch-', ''),
    );
  }
  if (status && status !== 'all') {
    filtered = filtered.filter((e) => e.status === status);
  }

  return {
    status: 200,
    data: {
      items: filtered,
      summary: summarizePersonalizationList(enriched),
      settings,
    },
  };
}

export async function saveGuestPersonalizationGeneration(
  projectId: string,
  generatedItems: PersonalizationEntry[],
  updatedSettings?: PersonalizationSettings,
): Promise<{
  items: PersonalizationEntry[];
  settings: PersonalizationSettings;
  summary: ReturnType<typeof summarizePersonalizationList>;
}> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) {
    const fallbackSettings = updatedSettings ?? PersonalizationSettingsSchema.parse({});
    return {
      items: generatedItems,
      settings: fallbackSettings,
      summary: summarizePersonalizationList(generatedItems),
    };
  }

  const byRecordId = new Map<string, PersonalizationEntry>();
  for (const existing of campaign.personalizations ?? []) {
    byRecordId.set(existing.record_id, existing);
  }
  for (const item of generatedItems) {
    byRecordId.set(item.record_id, item);
  }

  const generatedIds = new Set(generatedItems.map((i) => i.record_id));
  const now = new Date().toISOString();
  const nextResearch = (campaign.research ?? []).map((entry) => {
    if (!generatedIds.has(entry.record.record_id)) return entry;
    return {
      ...entry,
      review: {
        project_id: projectId,
        record_id: entry.record.record_id,
        status: 'shortlisted' as const,
        note: entry.review?.note ?? 'Personalized by Agent 3',
        reviewed_at: now,
        reviewed_by: 'guest',
      },
    };
  });

  const nextSettings: PersonalizationSettings = updatedSettings ?? campaign.settings;
  const allPersonalizations = Array.from(byRecordId.values());

  await writeGuestCampaign({
    ...campaign,
    updatedAt: now,
    research: nextResearch,
    personalizations: allPersonalizations,
    settings: nextSettings,
  });

  const enriched = enrichPersonalizationWithResearch(generatedItems, nextResearch);
  return {
    items: enriched,
    settings: nextSettings,
    summary: summarizePersonalizationList(allPersonalizations),
  };
}

const FeedbackInputSchema = z.strictObject({
  text: z.string().trim().min(2, 'Write a little feedback first.').max(1_000),
  scope: FeedbackScopeSchema.default('project'),
});

export async function patchGuestPersonalization(
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) {
    return { status: 404, data: { error: 'Project not found' } };
  }

  const recordId =
    typeof body.recordId === 'string'
      ? body.recordId
      : typeof body.record_id === 'string'
        ? body.record_id
        : '';
  const removeFeedbackId =
    typeof body.removeFeedbackId === 'string' ? body.removeFeedbackId.trim() : '';
  const rawCategoryTemplate = body.categoryTemplate ?? body.category_template;
  const resetCategoryTargetId =
    typeof body.resetCategoryTemplateTargetId === 'string'
      ? body.resetCategoryTemplateTargetId.trim()
      : '';
  const rawLeadSettings = body.leadSettings ?? body.lead_settings;

  let currentSettings = campaign.settings ?? PersonalizationSettingsSchema.parse({});

  if (removeFeedbackId) {
    const nextSettings: PersonalizationSettings = {
      ...currentSettings,
      feedback_memory: (currentSettings.feedback_memory ?? []).filter(
        (f) => f.id !== removeFeedbackId,
      ),
      updated_at: new Date().toISOString(),
    };
    await writeGuestCampaign({
      ...campaign,
      updatedAt: new Date().toISOString(),
      settings: nextSettings,
    });
    return { status: 200, data: { success: true, settings: nextSettings } };
  }

  if (body.feedback) {
    const parsedFeedback = FeedbackInputSchema.safeParse(body.feedback);
    if (!parsedFeedback.success) {
      return {
        status: 400,
        data: { error: parsedFeedback.error.issues[0]?.message ?? 'Invalid feedback.' },
      };
    }
    const feedbackRecord = recordId
      ? (campaign.research ?? []).find((r) => r.record.record_id === recordId)?.record ??
        null
      : null;
    const item = createFeedbackItem({
      ...parsedFeedback.data,
      record: feedbackRecord,
    });
    const nextSettings: PersonalizationSettings = {
      ...currentSettings,
      feedback_memory: appendFeedback(currentSettings.feedback_memory, item),
      updated_at: new Date().toISOString(),
    };
    await writeGuestCampaign({
      ...campaign,
      updatedAt: new Date().toISOString(),
      settings: nextSettings,
    });
    return {
      status: 200,
      data: { success: true, feedback: item, settings: nextSettings },
    };
  }

  if (rawCategoryTemplate || resetCategoryTargetId) {
    const nextCategoryTemplates = { ...(currentSettings.category_templates ?? {}) };
    if (resetCategoryTargetId) {
      delete nextCategoryTemplates[resetCategoryTargetId];
      delete nextCategoryTemplates[normalizeCategoryKey(resetCategoryTargetId)];
      const nextSettings: PersonalizationSettings = {
        ...currentSettings,
        category_templates: nextCategoryTemplates,
        updated_at: new Date().toISOString(),
      };
      await writeGuestCampaign({
        ...campaign,
        updatedAt: new Date().toISOString(),
        settings: nextSettings,
      });
      return { status: 200, data: { success: true, settings: nextSettings } };
    }

    const parsedTemplate = CategoryOutreachTemplateSchema.safeParse({
      ...(rawCategoryTemplate as Record<string, unknown>),
      is_custom: true,
      updated_at: new Date().toISOString(),
    });
    if (!parsedTemplate.success) {
      return {
        status: 400,
        data: {
          error: parsedTemplate.error.issues[0]?.message ?? 'Invalid category template.',
        },
      };
    }
    nextCategoryTemplates[parsedTemplate.data.target_id] = parsedTemplate.data;
    const nextSettings: PersonalizationSettings = {
      ...currentSettings,
      category_templates: nextCategoryTemplates,
      updated_at: new Date().toISOString(),
    };
    await writeGuestCampaign({
      ...campaign,
      updatedAt: new Date().toISOString(),
      settings: nextSettings,
    });
    return {
      status: 200,
      data: {
        success: true,
        categoryTemplate: parsedTemplate.data,
        settings: nextSettings,
      },
    };
  }

  if (!recordId) {
    return { status: 400, data: { error: 'recordId is required' } };
  }

  let savedLeadSettings: LeadPersonalizationSettings | undefined;
  if (rawLeadSettings) {
    const parsedLead = LeadPersonalizationSettingsSchema.safeParse({
      ...(rawLeadSettings as Record<string, unknown>),
      updated_at: new Date().toISOString(),
    });
    if (!parsedLead.success) {
      return {
        status: 400,
        data: {
          error:
            parsedLead.error.issues[0]?.message ??
            'Invalid lead personalization settings.',
        },
      };
    }
    savedLeadSettings = parsedLead.data;
    currentSettings = {
      ...currentSettings,
      lead_settings: {
        ...(currentSettings.lead_settings ?? {}),
        [recordId]: savedLeadSettings,
      },
      updated_at: new Date().toISOString(),
    };
  }

  let updatedEntry: PersonalizationEntry | null = null;
  const now = new Date().toISOString();
  const nextPersonalizations = (campaign.personalizations ?? []).map((entry) => {
    if (entry.record_id !== recordId) return entry;
    updatedEntry = {
      ...entry,
      ...(savedLeadSettings ? { lead_settings: savedLeadSettings } : {}),
      ...(body.copy
        ? {
            copy: body.copy as OutreachCopy,
            edited_by_human: true,
          }
        : {}),
      ...(body.status
        ? {
            status: body.status as PersonalizationStatus,
            reviewed_at: now,
            reviewer_note:
              typeof body.reviewer_note === 'string'
                ? body.reviewer_note
                : entry.reviewer_note,
          }
        : {}),
      updated_at: now,
    };
    return updatedEntry;
  });

  if (!updatedEntry && !savedLeadSettings) {
    return { status: 404, data: { error: 'Personalization entry not found' } };
  }

  await writeGuestCampaign({
    ...campaign,
    updatedAt: now,
    settings: currentSettings,
    personalizations: nextPersonalizations,
  });

  const enriched = updatedEntry
    ? enrichPersonalizationWithResearch([updatedEntry], campaign.research ?? [])[0]
    : null;

  return {
    status: 200,
    data: {
      success: true,
      item: enriched,
      items: enriched ? [enriched] : [],
      leadSettings: savedLeadSettings,
      settings: currentSettings,
    },
  };
}

export async function putGuestPersonalizationSettings(
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) {
    return { status: 404, data: { error: 'Project not found' } };
  }

  try {
    const parsed = PersonalizationSettingsSchema.partial().parse(body);
    const nextSettings: PersonalizationSettings = {
      ...(campaign.settings ?? PersonalizationSettingsSchema.parse({})),
      ...parsed,
      updated_at: new Date().toISOString(),
    };
    await writeGuestCampaign({
      ...campaign,
      updatedAt: new Date().toISOString(),
      settings: nextSettings,
    });
    return { status: 200, data: { success: true, settings: nextSettings } };
  } catch (error) {
    return {
      status: 400,
      data: { error: 'Invalid settings format: ' + (error as Error).message },
    };
  }
}

export async function deleteGuestPersonalizationEntry(
  projectId: string,
  recordId: string,
): Promise<boolean> {
  const campaign = await getStoredGuestCampaign(projectId);
  if (!campaign) return false;

  const before = (campaign.personalizations ?? []).length;
  const nextPersonalizations = (campaign.personalizations ?? []).filter(
    (entry) => entry.record_id !== recordId,
  );
  if (nextPersonalizations.length === before) return false;

  await writeGuestCampaign({
    ...campaign,
    updatedAt: new Date().toISOString(),
    personalizations: nextPersonalizations,
  });
  return true;
}
