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

const inMemoryEntries = new Map<string, PersonalizationEntry[]>();
const inMemorySettings = new Map<string, PersonalizationSettings>();

function ensureDir() {
  try {
    if (!existsSync(PERSONALIZATION_DIR)) {
      mkdirSync(PERSONALIZATION_DIR, { recursive: true });
    }
  } catch {
    // Read-only filesystem in serverless environments
  }
}

export function listPersonalizations(projectId: string): PersonalizationEntry[] {
  if (inMemoryEntries.has(projectId)) {
    return inMemoryEntries.get(projectId)!;
  }
  const f = fileFor(projectId);
  if (!existsSync(f)) return [];
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as PersonalizationEntry[];
    inMemoryEntries.set(projectId, parsed);
    return parsed;
  } catch {
    return [];
  }
}

export function getPersonalization(projectId: string, recordId: string): PersonalizationEntry | null {
  const entries = listPersonalizations(projectId);
  return entries.find((e) => e.record_id === recordId) ?? null;
}

function writeEntries(projectId: string, entries: PersonalizationEntry[]): void {
  inMemoryEntries.set(projectId, entries);
  try {
    ensureDir();
    const file = fileFor(projectId);
    const tempFile = `${file}.tmp`;
    writeFileSync(tempFile, JSON.stringify(entries, null, 2), 'utf8');
    renameSync(tempFile, file);
  } catch (err) {
    console.warn('Could not persist personalizations to disk (read-only serverless environment):', err);
  }
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
  inMemoryEntries.delete(projectId);
  inMemorySettings.delete(projectId);
  try {
    const f = fileFor(projectId);
    if (existsSync(f)) unlinkSync(f);
    const sf = settingsFileFor(projectId);
    if (existsSync(sf)) unlinkSync(sf);
  } catch (err) {
    console.warn('Could not delete personalization files from disk:', err);
  }
}

/* ------------------------------------------------------------------ */
/* Campaign settings (Sender details, campaign facts, rules)          */
/* ------------------------------------------------------------------ */

export function getPersonalizationSettings(projectId: string): PersonalizationSettings {
  if (inMemorySettings.has(projectId)) {
    return inMemorySettings.get(projectId)!;
  }
  let f = settingsFileFor(projectId);
  if (!existsSync(f)) {
    const altProjectId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
      ? 'proj-1791464115518'
      : '90b3c855-0937-4d6d-a364-702a43d019c5';
    const altFile = settingsFileFor(altProjectId);
    if (existsSync(altFile)) {
      f = altFile;
    }
  }
  if (!existsSync(f)) {
    const fallback = PersonalizationSettingsSchema.parse({});
    inMemorySettings.set(projectId, fallback);
    return fallback;
  }
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    const parsed = PersonalizationSettingsSchema.parse(raw);
    inMemorySettings.set(projectId, parsed);
    return parsed;
  } catch {
    const fallback = PersonalizationSettingsSchema.parse({});
    inMemorySettings.set(projectId, fallback);
    return fallback;
  }
}

export function savePersonalizationSettings(
  projectId: string,
  settings: Partial<PersonalizationSettings>,
): PersonalizationSettings {
  const current = getPersonalizationSettings(projectId);
  const updated: PersonalizationSettings = {
    ...current,
    ...settings,
    updated_at: new Date().toISOString(),
  };
  const parsed = PersonalizationSettingsSchema.parse(updated);
  inMemorySettings.set(projectId, parsed);
  try {
    ensureDir();
    const file = settingsFileFor(projectId);
    const tempFile = `${file}.tmp`;
    writeFileSync(tempFile, JSON.stringify(parsed, null, 2), 'utf8');
    renameSync(tempFile, file);
  } catch (err) {
    console.warn('Could not persist personalization settings to disk (read-only serverless environment):', err);
  }
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
