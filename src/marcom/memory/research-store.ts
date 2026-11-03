export function getNextBatchInfo(projectId: string): { batch_id: string; batch_number: number } {
  const entries = listResearch(projectId);
  if (entries.length === 0) {
    return { batch_id: 'batch-1', batch_number: 1 };
  }
  const maxBatch = entries.reduce((max, e) => Math.max(max, e.batch_number ?? 1), 1);
  const nextNum = maxBatch + 1;
  return { batch_id: `batch-${nextNum}`, batch_number: nextNum };
}

/**
 * Research storage. Same JSON-file approach as the rest of /memory:
 *   memory/research/<project_id>.json  -> ResearchEntry[] for that project
 *   memory/prospects.json              -> ProspectMemory (shared across projects, used for duplicate detection)
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ResearchEntry, ReviewStatus } from '../schemas/research-record';
import type { ProspectMemory } from './types';
import { canonicalUrl, normalizeName } from '../agents/research/qa';

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const RESEARCH_DIR = path.join(MEMORY_DIR, 'research');
const PROSPECTS_FILE = path.join(MEMORY_DIR, 'prospects.json');

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');
const fileFor = (projectId: string) => path.join(RESEARCH_DIR, `${safeId(projectId)}.json`);

const inMemoryResearch = new Map<string, ResearchEntry[]>();

export function listResearch(projectId: string): ResearchEntry[] {
  if (inMemoryResearch.has(projectId)) {
    return inMemoryResearch.get(projectId)!;
  }
  const f = fileFor(projectId);
  if (!existsSync(f)) return [];
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as ResearchEntry[];
    const entries = raw.map((e) => ({
      ...e,
      batch_id: e.batch_id || 'batch-1',
      batch_number: e.batch_number || 1,
    }));
    inMemoryResearch.set(projectId, entries);
    return entries;
  } catch {
    return [];
  }
}

function writeResearch(projectId: string, entries: ResearchEntry[]) {
  inMemoryResearch.set(projectId, entries);
  try {
    if (!existsSync(RESEARCH_DIR)) {
      mkdirSync(RESEARCH_DIR, { recursive: true });
    }
    const file = fileFor(projectId);
    const temporaryFile = `${file}.tmp`;
    writeFileSync(temporaryFile, JSON.stringify(entries, null, 2), 'utf8');
    renameSync(temporaryFile, file);
  } catch (err) {
    console.warn('Could not persist research to disk (serverless read-only environment):', err);
  }
}

/** Finds an existing entry for the same prospect (by name, website or LinkedIn). */
export function findDuplicate(entries: ResearchEntry[], seed: { name: string; website?: string; linkedin?: string }): ResearchEntry | null {
  const n = normalizeName(seed.name);
  const urls = [seed.website, seed.linkedin].filter(Boolean).map((u) => canonicalUrl(u!));
  return (
    entries.find((e) => {
      if (normalizeName(e.seed.name) === n || normalizeName(e.record.identity.name ?? '') === n) return true;
      const theirs = [e.record.websites?.[0]?.url, e.record.social_profiles?.find(p => p.platform === 'linkedin')?.profile_url, e.seed.website, e.seed.linkedin].filter(Boolean).map((u) => canonicalUrl(u!));
      return urls.some((u) => theirs.includes(u));
    }) ?? null
  );
}

/** Saves an entry; re-researching the same prospect replaces the previous entry. */
export function saveResearch(projectId: string, entry: ResearchEntry): void {
  const entries = listResearch(projectId);
  const dup = findDuplicate(entries, entry.seed);

  if (!entry.batch_id) {
    if (dup?.batch_id) {
      entry.batch_id = dup.batch_id;
      entry.batch_number = dup.batch_number;
    } else {
      const nextBatch = getNextBatchInfo(projectId);
      entry.batch_id = nextBatch.batch_id;
      entry.batch_number = nextBatch.batch_number;
    }
  }

  const savedEntry: ResearchEntry = {
    ...entry,
    review: entry.review ?? { project_id: projectId, record_id: entry.record.record_id, status: 'needs_review', note: null, reviewed_at: new Date().toISOString(), reviewed_by: 'system' },
  };
  const next = dup ? entries.map((e) => (e === dup ? savedEntry : e)) : [savedEntry, ...entries];
  writeResearch(projectId, next);
}

export function updateResearchReview(
  projectId: string,
  recordId: string,
  status: ReviewStatus,
  note: string | null,
): ResearchEntry | null {
  const entries = listResearch(projectId);
  const index = entries.findIndex((entry) => entry.record.record_id === recordId);
  if (index === -1) return null;
  const updated: ResearchEntry = {
    ...entries[index],
    review: { project_id: projectId, record_id: recordId, status, note: note?.trim() || null, reviewed_at: new Date().toISOString(), reviewed_by: 'user' },
  };
  entries[index] = updated;
  writeResearch(projectId, entries);
  return updated;
}

export function deleteResearch(projectId: string, recordId: string): boolean {
  const entries = listResearch(projectId);
  const next = entries.filter((e) => e.record.record_id !== recordId);
  if (next.length === entries.length) return false;
  writeResearch(projectId, next);
  return true;
}

export function deleteMultipleResearch(projectId: string, recordIds: string[]): boolean {
  const entries = listResearch(projectId);
  const idSet = new Set(recordIds);
  const next = entries.filter((e) => !idSet.has(e.record.record_id));
  if (next.length === entries.length) return false;
  writeResearch(projectId, next);
  return true;
}

export function deleteBatchResearch(projectId: string, batchId: string): boolean {
  const entries = listResearch(projectId);
  const normalizedBatch = batchId.toLowerCase().trim();
  const targetNum = normalizedBatch.replace(/^batch-?/, '');
  const next = entries.filter((e) => {
    const bId = (e.batch_id || 'batch-1').toLowerCase().trim();
    const bNum = String(e.batch_number ?? 1);
    return bId !== normalizedBatch && bNum !== targetNum && bId !== `batch-${targetNum}`;
  });
  if (next.length === entries.length) return false;
  writeResearch(projectId, next);
  return true;
}

export function deleteProjectResearch(projectId: string): void {
  inMemoryResearch.delete(projectId);
  try {
    const f = fileFor(projectId);
    if (existsSync(f)) unlinkSync(f);
  } catch (err) {
    console.warn('Could not delete research file from disk:', err);
  }
}

/** Upserts the researched prospect into shared prospect memory (only verified identities). */
export function upsertProspectMemory(entry: ResearchEntry): void {
  const r = entry.record;
  if (!r.identity.identity_verified || !r.identity.name) return;
  try {
    const prospects: ProspectMemory[] = existsSync(PROSPECTS_FILE) ? JSON.parse(readFileSync(PROSPECTS_FILE, 'utf8')) : [];
    const n = normalizeName(r.identity.name);
    const existing = prospects.find(
      (p) => p.prospect_id === r.matched_prospect_id || [p.name, ...p.aliases].some((a) => normalizeName(a) === n),
    );
    const base: ProspectMemory = existing ?? {
      prospect_id: `p-${Date.now().toString(36)}`,
      name: r.identity.name,
      aliases: [],
      entity_kind: r.identity.entity_kind,
      target_types: [],
      role: null,
      organisation: null,
      country: null,
      website: null,
      linkedin: null,
      project_ids: [],
      last_researched_at: null,
      summary: '',
    };
    const updated: ProspectMemory = {
      ...base,
      aliases: normalizeName(entry.seed.name) !== n && !base.aliases.includes(entry.seed.name) ? [...base.aliases, entry.seed.name] : base.aliases,
      target_types: base.target_types.includes(r.target_type) ? base.target_types : [...base.target_types, r.target_type],
      role: r.role ?? base.role,
      organisation: r.organisation ?? base.organisation,
      country: r.country ?? base.country,
      website: r.websites?.[0]?.url ?? base.website,
      linkedin: r.social_profiles?.find(p => p.platform === 'linkedin')?.profile_url ?? base.linkedin,
      project_ids: base.project_ids.includes(r.project_id) ? base.project_ids : [...base.project_ids, r.project_id],
      last_researched_at: r.researched_at,
      summary: r.summary.slice(0, 300) || base.summary,
    };
    const next = existing ? prospects.map((p) => (p === existing ? updated : p)) : [...prospects, updated];
    writeFileSync(PROSPECTS_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not upsert prospect memory (read-only filesystem?):', err);
  }
}
