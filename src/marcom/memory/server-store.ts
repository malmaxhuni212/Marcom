import { isDatabaseConfigured } from '@/db/env';
import { getCampaign, listCampaigns } from '@/db/repositories/campaign-repository';
import type { ActorContext } from '@/db/local-actor';
import { InMemoryStore, JsonFileMemoryStore, type MemoryStore } from './store';

export async function createServerMemoryStore(
  actor: ActorContext,
  allowFileFallback: boolean,
): Promise<MemoryStore> {
  if (isDatabaseConfigured()) {
    try {
      const projects = await listCampaigns(actor);
      const auxiliary = new JsonFileMemoryStore();
      return new InMemoryStore({
        lunim: auxiliary.lunim(),
        projects,
        prospects: auxiliary.prospects(),
        relationships: auxiliary.relationships(),
        decisions: auxiliary.decisions(),
        learnings: auxiliary.learnings(),
      });
    } catch (e) {
      if (!allowFileFallback) throw e;
      console.warn('Database error in createServerMemoryStore, falling back to JSON memory store.');
    }
  }
  if (!allowFileFallback) throw new Error('The authoritative database is unavailable.');
  return new JsonFileMemoryStore();
}

export async function readCampaignMemory(
  actor: ActorContext,
  campaignId: string,
  allowFileFallback: boolean,
) {
  if (isDatabaseConfigured()) {
    try {
      return await getCampaign(actor, campaignId);
    } catch (e) {
      if (!allowFileFallback) throw e;
      console.warn('Database error in readCampaignMemory, falling back to JSON memory store.');
    }
  }
  if (!allowFileFallback) throw new Error('The authoritative database is unavailable.');
  const store = new JsonFileMemoryStore();
  return store.projects().find((p) => p.project_id === campaignId) ?? null;
}
