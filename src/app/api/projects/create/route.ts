import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StructuredBriefSchema } from '@/marcom/schemas/structured-brief';
import { validateResearchReadyConfiguration } from '@/marcom/validation/campaign-configuration';
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

    const actor = await resolveLocalPilotActor();
    const newProject = await createCampaign(actor, {
      structuredBrief: sb,
      originalBrief: original_brief,
      sourceType: source_type,
      sourceName: source_name,
      idempotencyKey,
      requestId: req.headers.get('x-request-id') ?? randomUUID(),
    });

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
    return NextResponse.json({ error: 'The campaign could not be created.' }, { status: 500 });
  }
}
