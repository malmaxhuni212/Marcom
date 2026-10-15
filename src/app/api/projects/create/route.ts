import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
import { isDatabaseConfigured } from '@/db/env';
import { authorizeApiRequest } from '@/auth/access';
import {
  CampaignCommandInProgressError,
  CampaignIdempotencyConflictError,
  CampaignSourceFileError,
  createCampaign,
} from '@/db/repositories/campaign-repository';

const CreateProjectSchema = z
  .strictObject({
    structured_brief: StructuredBriefSchema,
    original_brief: z.string().min(1),
    source_type: z.enum(['PASTE', 'UPLOAD', 'URL']),
    source_name: z.string().min(1),
    source_file_id: z.uuid().optional(),
  })
  .superRefine((value, context) => {
    if (value.source_type === 'UPLOAD' && !value.source_file_id) {
      context.addIssue({
        code: 'custom',
        path: ['source_file_id'],
        message: 'An uploaded brief requires its stored source file ID.',
      });
    }
    if (value.source_type !== 'UPLOAD' && value.source_file_id) {
      context.addIssue({
        code: 'custom',
        path: ['source_file_id'],
        message: 'Only uploaded briefs can include a stored source file ID.',
      });
    }
  });

export async function POST(req: Request) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
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
    const { structured_brief: sb, original_brief, source_type, source_name, source_file_id } = parsed.data;
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
        newProject = await createCampaign(access.actor, {
          structuredBrief: sb,
          originalBrief: original_brief,
          sourceType: source_type,
          sourceName: source_name,
          sourceFileId: source_file_id,
          idempotencyKey,
          requestId: req.headers.get('x-request-id') ?? randomUUID(),
        });
      } catch (dbErr) {
        if (
          dbErr instanceof CampaignIdempotencyConflictError ||
          dbErr instanceof CampaignCommandInProgressError ||
          dbErr instanceof CampaignSourceFileError
        ) {
          throw dbErr;
        }
        if (!access.allowFileFallback) throw dbErr;
        console.warn('Database error in createCampaign, falling back to JSON memory store.');
      }
    }

    if (!newProject) {
      if (!access.allowFileFallback) throw new Error('The authoritative database is unavailable.');
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
    if (error instanceof CampaignSourceFileError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error('Error creating project:', error);
    return NextResponse.json({ error: (error as Error).message || 'The campaign could not be created.' }, { status: 500 });
  }
}
