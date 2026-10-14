import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { listResearch } from '@/db/repositories/research-repository';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
import { summarizeResearch } from '@/marcom/research/review';
import { resolveLocalPilotActor } from '@/db/local-actor';
import {
  CampaignNotFoundError,
  CampaignVersionConflictError,
  getCampaign,
  updateCampaignConfiguration,
} from '@/db/repositories/campaign-repository';

const UpdateConfigurationSchema = z.strictObject({
  structured_brief: StructuredBriefSchema,
  expected_revision: z.number().int().positive(),
});

/** Project detail: project memory (incl. structured brief) + saved research entries. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await resolveLocalPilotActor();
  const project = await getCampaign(actor, id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const research = await listResearch(actor, id);
  return NextResponse.json({
    project,
    research,
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

  try {
    const actor = await resolveLocalPilotActor();
    const updated = await updateCampaignConfiguration(actor, id, {
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
    console.error('Error updating campaign configuration:', error);
    return NextResponse.json({ error: 'The campaign configuration could not be saved.' }, { status: 500 });
  }
}
