import { isDatabaseConfigured } from '@/db/env';
import { getCampaign, listCampaigns } from '@/db/repositories/campaign-repository';
import type { ActorContext } from '@/db/local-actor';
import { InMemoryStore, JsonFileMemoryStore, type MemoryStore } from './store';
import type { ProjectMemory } from './types';

export async function createServerMemoryStore(
  actor: ActorContext,
  allowFileFallback: boolean,
): Promise<MemoryStore> {
  const auxiliary = new JsonFileMemoryStore();
  let dbProjects: ProjectMemory[] = [];
  if (isDatabaseConfigured()) {
    try {
      dbProjects = await listCampaigns(actor);
    } catch (e) {
      console.warn('Database error in createServerMemoryStore, falling back to JSON memory store:', e);
      if (!allowFileFallback && dbProjects.length === 0) {
        // Continue with file projects
      }
    }
  }
  
  let fileProjects: ProjectMemory[] = [];
  try {
    fileProjects = auxiliary.projects();
  } catch (e) {
    console.warn('File memory read error in createServerMemoryStore:', e);
  }

  // Merge so preloaded projects and DB campaigns are both available seamlessly
  const projectMap = new Map<string, ProjectMemory>();
  for (const p of fileProjects) projectMap.set(p.project_id, p);
  for (const p of dbProjects) projectMap.set(p.project_id, p);
  const mergedProjects = Array.from(projectMap.values());

  return new InMemoryStore({
    lunim: auxiliary.lunim(),
    projects: mergedProjects,
    prospects: auxiliary.prospects(),
    relationships: auxiliary.relationships(),
    decisions: auxiliary.decisions(),
    learnings: auxiliary.learnings(),
  });
}

export async function readCampaignMemory(
  actor: ActorContext,
  campaignId: string,
  allowFileFallback: boolean,
): Promise<ProjectMemory | null> {
  if (isDatabaseConfigured()) {
    try {
      const camp = await getCampaign(actor, campaignId);
      if (camp) return camp;
    } catch (e) {
      console.warn('Database error in readCampaignMemory, falling back to JSON memory store:', e);
    }
  }
  try {
    const store = new JsonFileMemoryStore();
    return store.projects().find((p) => p.project_id === campaignId) ?? null;
  } catch {
    return null;
  }
}
