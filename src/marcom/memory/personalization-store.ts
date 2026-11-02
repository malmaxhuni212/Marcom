/**
 * Personalization storage.
 * Follows the same JSON-file persistence pattern as research-store:
 *   memory/personalization/<project_id>.json          -> PersonalizationEntry[]
 *   memory/personalization/<project_id>-settings.json -> PersonalizationSettings
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  OutreachCopy,
  PersonalizationEntry,
  PersonalizationSettings,
  PersonalizationStatus,
} from '../schemas/personalization';
import { PersonalizationSettingsSchema } from '../schemas/personalization';

const MEMORY_DIR = path.join(process.cwd(), 'memory');
const PERSONALIZATION_DIR = path.join(MEMORY_DIR, 'personalization');

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');
const fileFor = (projectId: string) => path.join(PERSONALIZATION_DIR, `${safeId(projectId)}.json`);
const settingsFileFor = (projectId: string) =>
  path.join(PERSONALIZATION_DIR, `${safeId(projectId)}-settings.json`);

function ensureDir() {
  if (!existsSync(PERSONALIZATION_DIR)) {
    mkdirSync(PERSONALIZATION_DIR, { recursive: true });
  }
}

export function listPersonalizations(projectId: string): PersonalizationEntry[] {
  const f = fileFor(projectId);
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as PersonalizationEntry[];
  } catch {
    return [];
  }
}

export function getPersonalization(projectId: string, recordId: string): PersonalizationEntry | null {
  const entries = listPersonalizations(projectId);
  return entries.find((e) => e.record_id === recordId) ?? null;
}

function writeEntries(projectId: string, entries: PersonalizationEntry[]): void {
  ensureDir();
  const file = fileFor(projectId);
  const tempFile = `${file}.tmp`;
  writeFileSync(tempFile, JSON.stringify(entries, null, 2), 'utf8');
  renameSync(tempFile, file);
}

export function savePersonalization(projectId: string, entry: PersonalizationEntry): void {
  const entries = listPersonalizations(projectId);
  const index = entries.findIndex((e) => e.record_id === entry.record_id);
  if (index >= 0) {
    entries[index] = entry;
  } else {
    entries.unshift(entry);
  }
  writeEntries(projectId, entries);
}

export function saveMultiplePersonalizations(projectId: string, newEntries: PersonalizationEntry[]): void {
  const existing = listPersonalizations(projectId);
  const map = new Map<string, PersonalizationEntry>();
  for (const e of existing) map.set(e.record_id, e);
  for (const e of newEntries) map.set(e.record_id, e);
  writeEntries(projectId, Array.from(map.values()));
}

export function updatePersonalizationCopy(
  projectId: string,
  recordId: string,
  copyUpdates: Partial<OutreachCopy>,
): PersonalizationEntry | null {
  const entries = listPersonalizations(projectId);
  const index = entries.findIndex((e) => e.record_id === recordId);
  if (index === -1) return null;

  const current = entries[index];
  if (!current.copy) return null;

  const updatedCopy: OutreachCopy = {
    ...current.copy,
    ...copyUpdates,
  };

  const updated: PersonalizationEntry = {
    ...current,
    copy: updatedCopy,
    edited_by_human: true,
    updated_at: new Date().toISOString(),
  };

  entries[index] = updated;
  writeEntries(projectId, entries);
  return updated;
}

export function updatePersonalizationStatus(
  projectId: string,
  recordId: string,
  status: PersonalizationStatus,
  reviewerNote: string | null = null,
): PersonalizationEntry | null {
  const entries = listPersonalizations(projectId);
  const index = entries.findIndex((e) => e.record_id === recordId);
  if (index === -1) return null;

  const updated: PersonalizationEntry = {
    ...entries[index],
    status,
    reviewer_note: reviewerNote?.trim() || null,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  entries[index] = updated;
  writeEntries(projectId, entries);
  return updated;
}

export function deletePersonalization(projectId: string, recordId: string): boolean {
  const entries = listPersonalizations(projectId);
  const next = entries.filter((e) => e.record_id !== recordId);
  if (next.length === entries.length) return false;
  writeEntries(projectId, next);
  return true;
}

export function deleteProjectPersonalizations(projectId: string): void {
  const f = fileFor(projectId);
  if (existsSync(f)) unlinkSync(f);
  const sf = settingsFileFor(projectId);
  if (existsSync(sf)) unlinkSync(sf);
}

/* ------------------------------------------------------------------ */
/* Campaign settings (Sender details, campaign facts, rules)          */
/* ------------------------------------------------------------------ */

export function getPersonalizationSettings(projectId: string): PersonalizationSettings {
  const f = settingsFileFor(projectId);
  if (!existsSync(f)) {
    return PersonalizationSettingsSchema.parse({});
  }
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    return PersonalizationSettingsSchema.parse(raw);
  } catch {
    return PersonalizationSettingsSchema.parse({});
  }
}

export function savePersonalizationSettings(
  projectId: string,
  settings: Partial<PersonalizationSettings>,
): PersonalizationSettings {
  ensureDir();
  const current = getPersonalizationSettings(projectId);
  const updated: PersonalizationSettings = {
    ...current,
    ...settings,
    updated_at: new Date().toISOString(),
  };
  const parsed = PersonalizationSettingsSchema.parse(updated);
  const file = settingsFileFor(projectId);
  const tempFile = `${file}.tmp`;
  writeFileSync(tempFile, JSON.stringify(parsed, null, 2), 'utf8');
  renameSync(tempFile, file);
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Summary stats helper                                               */
/* ------------------------------------------------------------------ */

export interface PersonalizationSummary {
  total: number;
  drafts: number;
  approved: number;
  rejected: number;
  needs_more_research: number;
  failed: number;
  average_qa_score: number;
}

export function summarizePersonalizations(entries: PersonalizationEntry[]): PersonalizationSummary {
  let approved = 0;
  let rejected = 0;
  let needs_more_research = 0;
  let drafts = 0;
  let failed = 0;
  let totalScore = 0;
  let scoredCount = 0;

  for (const e of entries) {
    if (e.status === 'approved') approved++;
    else if (e.status === 'rejected') rejected++;
    else if (e.status === 'needs_more_research') needs_more_research++;
    else if (e.status === 'failed') failed++;
    else drafts++;

    if (e.qa?.score !== undefined) {
      totalScore += e.qa.score;
      scoredCount++;
    }
  }

  return {
    total: entries.length,
    drafts,
    approved,
    rejected,
    needs_more_research,
    failed,
    average_qa_score: scoredCount ? Math.round(totalScore / scoredCount) : 0,
  };
}
