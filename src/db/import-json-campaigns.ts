import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { closeDatabasePool } from './client';
import { loadDatabaseEnvironment } from './load-environment';
import { resolveLocalPilotActor } from './local-actor';
import {
  CampaignIdempotencyConflictError,
  createCampaign,
} from './repositories/campaign-repository';
import type { ProjectMemory } from '@/marcom/memory/types';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';

interface OriginalBriefFile {
  source_type?: 'PASTE' | 'UPLOAD' | 'URL';
  source_name?: string;
  original_text?: string;
}

loadDatabaseEnvironment();

function readOriginalBrief(root: string, project: ProjectMemory): Required<OriginalBriefFile> {
  const file = path.join(root, 'memory', `${project.project_id}-original.json`);
  if (!existsSync(file)) {
    return {
      source_type: 'PASTE',
      source_name: 'Legacy JSON campaign',
      original_text: project.summary,
    };
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as OriginalBriefFile;
  return {
    source_type: parsed.source_type ?? 'PASTE',
    source_name: parsed.source_name ?? 'Legacy JSON campaign',
    original_text: parsed.original_text ?? project.summary,
  };
}

function copyRuntimeFile(source: string, destination: string): boolean {
  if (!existsSync(source) || existsSync(destination)) return false;
  copyFileSync(source, destination);
  return true;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const projectsFile = path.join(root, 'memory', 'projects.json');
  if (!existsSync(projectsFile)) {
    console.log(JSON.stringify({ event: 'json_campaign_import_complete', imported: 0 }));
    return;
  }

  const projects = JSON.parse(readFileSync(projectsFile, 'utf8')) as ProjectMemory[];
  const actor = await resolveLocalPilotActor();
  const mappings: Array<{ legacyId: string; campaignId: string; copiedRuntimeFiles: number }> = [];

  for (const legacy of projects) {
    const parsedBrief = StructuredBriefSchema.safeParse(legacy.structured_brief);
    if (!parsedBrief.success) {
      console.warn(JSON.stringify({
        event: 'json_campaign_import_skipped',
        legacyId: legacy.project_id,
        reason: 'Campaign has no valid structured brief.',
      }));
      continue;
    }

    const original = readOriginalBrief(root, legacy);
    try {
      const campaign = await createCampaign(actor, {
        structuredBrief: parsedBrief.data,
        originalBrief: original.original_text,
        sourceType: original.source_type === 'UPLOAD' ? 'PASTE' : original.source_type,
        sourceName: original.source_name,
        idempotencyKey: `legacy-json-import:${legacy.project_id}`,
      });

      let copiedRuntimeFiles = 0;
      const runtimeFiles = [
        ['research', `${legacy.project_id}.json`, `${campaign.project_id}.json`],
        ['personalization', `${legacy.project_id}.json`, `${campaign.project_id}.json`],
        ['personalization', `${legacy.project_id}-settings.json`, `${campaign.project_id}-settings.json`],
      ];
      for (const [directory, sourceName, destinationName] of runtimeFiles) {
        if (copyRuntimeFile(
          path.join(root, 'memory', directory, sourceName),
          path.join(root, 'memory', directory, destinationName),
        )) copiedRuntimeFiles += 1;
      }
      mappings.push({ legacyId: legacy.project_id, campaignId: campaign.project_id, copiedRuntimeFiles });
    } catch (error) {
      if (error instanceof CampaignIdempotencyConflictError) {
        console.warn(JSON.stringify({
          event: 'json_campaign_import_conflict',
          legacyId: legacy.project_id,
          reason: error.message,
        }));
        continue;
      }
      throw error;
    }
  }

  console.log(JSON.stringify({ event: 'json_campaign_import_complete', imported: mappings.length, mappings }));
}

main()
  .catch((error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : undefined;
    console.error(JSON.stringify({
      event: 'json_campaign_import_failed',
      message: error instanceof Error ? error.message : 'Unknown JSON campaign import failure',
      cause,
    }));
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
