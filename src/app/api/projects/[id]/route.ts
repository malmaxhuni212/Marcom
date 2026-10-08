import { NextResponse } from 'next/server';
import { z } from 'zod';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { listResearch } from '@/marcom/memory/research-store';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
import { updateProject } from '@/marcom/memory/project-store';
import { summarizeResearch } from '@/marcom/research/review';

const UpdateConfigurationSchema = z.strictObject({
  structured_brief: StructuredBriefSchema,
  expected_revision: z.number().int().positive(),
});

/** Project detail: project memory (incl. structured brief) + saved research entries. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = new JsonFileMemoryStore().projects().find((p) => p.project_id === id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const research = listResearch(id);
  return NextResponse.json({
    project,
    research: research.slice(0, 3),
    research_summary: summarizeResearch(research),
  });
}

/** Replace the human-reviewed campaign configuration using optimistic concurrency. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let revisionConflict = false;
  const updated = updateProject(id, (project) => {
    const currentRevision = project.configuration_revision ?? 1;
    if (currentRevision !== parsed.data.expected_revision) {
      revisionConflict = true;
      return project;
    }
    const brief = parsed.data.structured_brief;
    return {
      ...project,
      name: brief.project.name!,
      summary: brief.project.description,
      structured_brief: brief,
      target_definitions: brief.targets.map((target) => ({
        target_type: target.target_type,
        definition: target.description,
        aliases: [],
      })),
      status: 'READY_FOR_RESEARCH',
      configuration_revision: currentRevision + 1,
      configuration_updated_at: new Date().toISOString(),
    };
  });

  if (!updated) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  if (revisionConflict) {
    return NextResponse.json(
      { error: 'This campaign was changed in another window. Refresh and review the latest version before saving.' },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, project: updated });
}
