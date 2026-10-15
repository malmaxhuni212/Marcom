import { NextResponse } from 'next/server';
import { listResearch } from '@/db/repositories/research-repository';
import { resolveLocalPilotActor } from '@/db/local-actor';

export async function GET(req: Request, { params }: { params: Promise<{ id: string, recordId: string }> }) {
  const { id, recordId } = await params;
  
  const actor = await resolveLocalPilotActor();
  const allResearch = await listResearch(actor, id);
  const entry = allResearch.find(r => r.record.record_id === recordId);
  
  if (!entry) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  return NextResponse.json({ entry });
}
