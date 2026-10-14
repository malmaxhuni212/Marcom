import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { closeDatabasePool, getDatabase } from './client';
import { sql } from 'drizzle-orm';
import { loadDatabaseEnvironment } from './load-environment';
import { resolveLocalPilotActor } from './local-actor';
import { listCampaigns } from './repositories/campaign-repository';
import {
  completeResearchRun,
  listResearch,
  saveResearch,
  startResearchRun,
} from './repositories/research-repository';
import type { ResearchEntry } from '@/marcom/schemas/research-record';

loadDatabaseEnvironment();

async function main() {
  const actor = await resolveLocalPilotActor();
  const campaigns = await listCampaigns(actor);
  let imported = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    const file = path.join(process.cwd(), 'memory', 'research', `${campaign.project_id}.json`);
    if (!existsSync(file)) continue;
    const entries = JSON.parse(readFileSync(file, 'utf8')) as ResearchEntry[];
    const existing = await listResearch(actor, campaign.project_id);
    const existingIds = new Set(existing.map((entry) => entry.record.record_id));
    const groups = new Map<number, ResearchEntry[]>();
    for (const entry of entries) {
      if (existingIds.has(entry.record.record_id)) {
        skipped += 1;
        continue;
      }
      const batchNumber = entry.batch_number ?? 1;
      const group = groups.get(batchNumber) ?? [];
      group.push(entry);
      groups.set(batchNumber, group);
    }

    for (const [batchNumber, batchEntries] of groups) {
      const batch = { batch_id: batchEntries[0]?.batch_id ?? `batch-${batchNumber}`, batch_number: batchNumber };
      const runId = await startResearchRun(
        actor,
        campaign.project_id,
        batch,
        Math.min(50, Math.max(1, batchEntries.length)),
        batchEntries[0]?.record.brief_target_id ?? 'legacy',
      );
      let failed = 0;
      for (const entry of batchEntries) {
        try {
          await saveResearch(actor, campaign.project_id, runId, {
            ...entry,
            record: { ...entry.record, project_id: campaign.project_id },
            batch_id: batch.batch_id,
            batch_number: batch.batch_number,
          });
          imported += 1;
        } catch (error) {
          failed += 1;
          const cause = error instanceof Error && error.cause instanceof Error
            ? { cause: error.cause.message, code: 'code' in error.cause ? String(error.cause.code) : undefined }
            : {};
          console.error(JSON.stringify({
            event: 'research_import_item_failed',
            campaignId: campaign.project_id,
            recordId: entry.record.record_id,
            message: (error as Error).message,
            ...cause,
          }));
        }
      }
      await completeResearchRun(actor, runId, failed);
    }
  }

  await getDatabase().execute(sql`
    update campaign_prospects as campaign_prospect
    set
      created_at = coalesce(
        (research_result.metadata->'entry'->'record'->>'researched_at')::timestamptz,
        campaign_prospect.created_at
      ),
      updated_at = coalesce(
        (research_result.metadata->'entry'->'review'->>'reviewed_at')::timestamptz,
        (research_result.metadata->'entry'->'record'->>'researched_at')::timestamptz,
        campaign_prospect.updated_at
      )
    from research_results as research_result
    where research_result.campaign_prospect_id = campaign_prospect.id
  `);

  console.log(JSON.stringify({ event: 'research_import_complete', imported, skipped }));
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'research_import_failed', message: (error as Error).message }));
  process.exitCode = 1;
}).finally(closeDatabasePool);
