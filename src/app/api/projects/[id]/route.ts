import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/db/env';
import { listResearch as listDbResearch } from '@/db/repositories/research-repository';
import { listResearch as listFileResearch } from '@/marcom/memory/research-store';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
import { summarizeResearch } from '@/marcom/research/review';
import { authorizeApiRequest } from '@/auth/access';
import {
  CampaignNotFoundError,
  CampaignVersionConflictError,
  getCampaign,
  updateCampaignConfiguration,
} from '@/db/repositories/campaign-repository';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import type { ResearchEntry } from '@/marcom/schemas/research-record';

const UpdateConfigurationSchema = z.strictObject({
  structured_brief: StructuredBriefSchema,
  expected_revision: z.number().int().positive(),
});

/** Project detail: project memory (incl. structured brief) + saved research entries. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id } = await params;
  let project = null;
  let research: ResearchEntry[] = [];

  if (isDatabaseConfigured()) {
    try {
      project = await getCampaign(access.actor, id);
      if (project) {
        research = await listDbResearch(access.actor, id);
      }
    } catch (e) {
      if (!access.allowFileFallback) throw e;
      console.warn(`Database error in GET /api/projects/${id}, falling back to JSON memory.`);
    }
  }

  if (!project) {
    if (!access.allowFileFallback) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const store = new JsonFileMemoryStore();
    project = store.projects().find((p) => p.project_id === id) ?? null;
    if (project) {
      research = listFileResearch(id);
    }
  }

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json({
    project,
    research,
    research_summary: summarizeResearch(research),
  });
}

/** Replace the human-reviewed campaign configuration using optimistic concurrency. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id } = await params;
  const parsed = UpdateConfigurationSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'The campaign configuration is invalid.', field_errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const readiness = validateResearchReadyConfiguration(parsed.data.structured_brief);
  if (!readiness.ok) {
    return NextResponse.json(
      { error: 'Complete the required campaign fields before saving.', field_errors: readiness.errors },
      { status: 422 },
    );
  }

  if (isDatabaseConfigured()) {
    try {
      const updated = await updateCampaignConfiguration(access.actor, id, {
        structuredBrief: parsed.data.structured_brief,
        expectedRevision: parsed.data.expected_revision,
        requestId: req.headers.get('x-request-id') ?? randomUUID(),
      });
      return NextResponse.json({ success: true, project: updated });
    } catch (error) {
      if (error instanceof CampaignNotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error instanceof CampaignVersionConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (!access.allowFileFallback) throw error;
      console.warn('Database error in PATCH /api/projects/[id], falling back to JSON memory.');
    }
  }

  if (!access.allowFileFallback) throw new Error('The authoritative database is unavailable.');
  const { updateProject } = await import('@/marcom/memory/project-store');
  const updated = updateProject(id, (current) => {
    if (current.configuration_revision !== parsed.data.expected_revision) {
      throw new Error(`Revision conflict: current revision is ${current.configuration_revision}, expected ${parsed.data.expected_revision}`);
    }
    return {
      ...current,
      name: parsed.data.structured_brief.project.name || current.name,
      summary: parsed.data.structured_brief.project.description || current.summary,
      structured_brief: parsed.data.structured_brief,
      target_definitions: parsed.data.structured_brief.targets.map((t) => ({
        target_type: t.target_type,
        definition: t.description,
        aliases: [],
      })),
      configuration_revision: current.configuration_revision + 1,
      configuration_updated_at: new Date().toISOString(),
    };
  });

  if (!updated) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, project: updated });
}

