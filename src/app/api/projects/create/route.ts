import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
import { addProject } from '@/marcom/memory/project-store';
import type { ProjectMemory } from '@/marcom/memory/types';

const CreateProjectSchema = z.strictObject({
  structured_brief: StructuredBriefSchema,
  original_brief: z.string().min(1),
  source_type: z.enum(['PASTE', 'UPLOAD', 'URL']),
  source_name: z.string().min(1),
});

export async function POST(req: Request) {
  try {
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

    const newProjectId = `proj-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const newProject: ProjectMemory = {
      project_id: newProjectId,
      name: sb.project.name!,
      aliases: [],
      summary: sb.project.description,
      status: 'READY_FOR_RESEARCH',
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

    // Store the original brief memory for full history
    const memoryDir = path.join(process.cwd(), 'memory');
    const originalBriefPath = path.join(memoryDir, `${newProjectId}-original.json`);
    fs.writeFileSync(originalBriefPath, JSON.stringify({
      project_id: newProjectId,
      source_type,
      source_name,
      original_text: original_brief,
      created_at: createdAt
    }, null, 2), 'utf8');

    return NextResponse.json({ 
      success: true, 
      project: newProject
    });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
