import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/db/env';
import { listResearch as listDbResearch } from '@/db/repositories/research-repository';
import { listResearch as listFileResearch } from '@/marcom/memory/research-store';
import { authorizeApiRequest } from '@/auth/access';

export async function GET(req: Request, { params }: { params: Promise<{ id: string, recordId: string }> }) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id, recordId } = await params;
  
  const allResearch = isDatabaseConfigured()
    ? await listDbResearch(access.actor, id)
    : listFileResearch(id);
  const entry = allResearch.find(r => r.record.record_id === recordId);
  
  if (!entry) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  return NextResponse.json({ entry });
}
