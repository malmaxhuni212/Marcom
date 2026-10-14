import { isDatabaseConfigured } from '@/db/env';
import { getCampaign, listCampaigns } from '@/db/repositories/campaign-repository';
import { resolveLocalPilotActor } from '@/db/local-actor';
import { InMemoryStore, JsonFileMemoryStore, type MemoryStore } from './store';

export async function createServerMemoryStore(): Promise<MemoryStore> {
  if (isDatabaseConfigured()) {
    try {
      const actor = await resolveLocalPilotActor();
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
      console.warn('Database error in createServerMemoryStore, falling back to JSON memory store:', e);
    }
  }
  return new JsonFileMemoryStore();
}

export async function readCampaignMemory(campaignId: string) {
  if (isDatabaseConfigured()) {
    try {
      const actor = await resolveLocalPilotActor();
      return await getCampaign(actor, campaignId);
    } catch (e) {
      console.warn('Database error in readCampaignMemory, falling back to JSON memory store:', e);
    }
  }
  const store = new JsonFileMemoryStore();
  return store.projects().find((p) => p.project_id === campaignId) ?? null;
}
