import { getCampaign, listCampaigns } from '@/db/repositories/campaign-repository';
import { resolveLocalPilotActor } from '@/db/local-actor';
import { InMemoryStore, JsonFileMemoryStore, type MemoryStore } from './store';

export async function createServerMemoryStore(): Promise<MemoryStore> {
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
}

export async function readCampaignMemory(campaignId: string) {
  const actor = await resolveLocalPilotActor();
  return getCampaign(actor, campaignId);
}
