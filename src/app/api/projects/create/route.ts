import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
import { isDatabaseConfigured } from '@/db/env';
import { resolveLocalPilotActor } from '@/db/local-actor';
import {
  CampaignCommandInProgressError,
  CampaignIdempotencyConflictError,
  createCampaign,
} from '@/db/repositories/campaign-repository';

const CreateProjectSchema = z.strictObject({
  structured_brief: StructuredBriefSchema,
  original_brief: z.string().min(1),
  source_type: z.enum(['PASTE', 'UPLOAD', 'URL']),
  source_name: z.string().min(1),
  source_file_id: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return NextResponse.json(
        { error: 'A valid Idempotency-Key header is required.' },
        { status: 400 },
      );
    }
    const parsed = CreateProjectSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'The campaign configuration is invalid.', field_errors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const { structured_brief: sb, original_brief, source_type, source_name } = parsed.data;
    const readiness = validateResearchReadyConfiguration(sb);
    if (!readiness.ok) {
      return NextResponse.json(
        { error: 'Complete the required campaign fields before saving.', field_errors: readiness.errors },
        { status: 422 },
      );
    }

    let newProject;
    if (isDatabaseConfigured()) {
      try {
        const actor = await resolveLocalPilotActor();
        newProject = await createCampaign(actor, {
          structuredBrief: sb,
          originalBrief: original_brief,
          sourceType: source_type,
          sourceName: source_name,
          idempotencyKey,
          requestId: req.headers.get('x-request-id') ?? randomUUID(),
        });
      } catch (dbErr) {
        if (dbErr instanceof CampaignIdempotencyConflictError || dbErr instanceof CampaignCommandInProgressError) {
          throw dbErr;
        }
        console.warn('Database error in createCampaign, falling back to JSON memory store:', dbErr);
      }
    }

    if (!newProject) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { addProject } = await import('@/marcom/memory/project-store');
      const newProjectId = `proj-${Date.now()}`;
      const createdAt = new Date().toISOString();
      newProject = {
        project_id: newProjectId,
        name: sb.project.name || 'Untitled Project',
        aliases: [],
        summary: sb.project.description,
        status: 'READY_FOR_RESEARCH' as const,
        structured_brief: sb,
        target_definitions: sb.targets.map(t => ({
          target_type: t.target_type,
          definition: t.description,
          aliases: []
        })),
        notes: [`Original Brief Source: ${source_name}`],
        configuration_revision: 1,
        configuration_updated_at: createdAt,
      };
      addProject(newProject);

      const memoryDir = path.join(process.cwd(), 'memory');
      const originalBriefPath = path.join(memoryDir, `${newProjectId}-original.json`);
      fs.writeFileSync(originalBriefPath, JSON.stringify({
        project_id: newProjectId,
        source_type,
        source_name,
        original_text: original_brief,
        source_file_id: parsed.data.source_file_id,
        created_at: createdAt
      }, null, 2), 'utf8');
    }

    return NextResponse.json({ 
      success: true, 
      project: newProject,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof CampaignIdempotencyConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof CampaignCommandInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error creating project:', error);
    return NextResponse.json({ error: (error as Error).message || 'The campaign could not be created.' }, { status: 500 });
  }
}
