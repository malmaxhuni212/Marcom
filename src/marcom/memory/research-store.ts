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

export function listResearch(projectId: string): ResearchEntry[] {
  const f = fileFor(projectId);
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as ResearchEntry[];
  } catch {
    return [];
  }
}

function writeResearch(projectId: string, entries: ResearchEntry[]) {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  const file = fileFor(projectId);
  const temporaryFile = `${file}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(entries, null, 2), 'utf8');
  renameSync(temporaryFile, file);
}

/** Finds an existing entry for the same prospect (by name, website or LinkedIn). */
export function findDuplicate(entries: ResearchEntry[], seed: { name: string; website?: string; linkedin?: string }): ResearchEntry | null {
  const n = normalizeName(seed.name);
  const urls = [seed.website, seed.linkedin].filter(Boolean).map((u) => canonicalUrl(u!));
  return (
    entries.find((e) => {
      if (normalizeName(e.seed.name) === n || normalizeName(e.record.identity.name ?? '') === n) return true;
      const theirs = [e.record.website, e.record.linkedin, e.seed.website, e.seed.linkedin].filter(Boolean).map((u) => canonicalUrl(u!));
      return urls.some((u) => theirs.includes(u));
    }) ?? null
  );
}

/** Saves an entry; re-researching the same prospect replaces the previous entry. */
export function saveResearch(projectId: string, entry: ResearchEntry): void {
  const entries = listResearch(projectId);
  const dup = findDuplicate(entries, entry.seed);
  const savedEntry: ResearchEntry = {
    ...entry,
    review: entry.review ?? { status: 'needs_review', note: null, reviewed_at: null },
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
    review: {
      status,
      note: note?.trim() || null,
      reviewed_at: new Date().toISOString(),
    },
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
export function deleteProjectResearch(projectId: string): void {
  const f = fileFor(projectId);
  if (existsSync(f)) unlinkSync(f);
}

/** Upserts the researched prospect into shared prospect memory (only verified identities). */
export function upsertProspectMemory(entry: ResearchEntry): void {
  const r = entry.record;
  if (!r.identity.identity_verified || !r.identity.name) return;
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
    website: r.website ?? base.website,
    linkedin: r.linkedin ?? base.linkedin,
    project_ids: base.project_ids.includes(r.project_id) ? base.project_ids : [...base.project_ids, r.project_id],
    last_researched_at: r.researched_at,
    summary: r.summary.slice(0, 300) || base.summary,
  };
  const next = existing ? prospects.map((p) => (p === existing ? updated : p)) : [...prospects, updated];
  writeFileSync(PROSPECTS_FILE, JSON.stringify(next, null, 2), 'utf8');
}
