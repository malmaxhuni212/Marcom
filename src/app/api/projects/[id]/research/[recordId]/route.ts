import { NextResponse } from 'next/server';
import { listResearch } from '@/db/repositories/research-repository';
import { authorizeApiRequest } from '@/auth/access';

export async function GET(req: Request, { params }: { params: Promise<{ id: string, recordId: string }> }) {
  const access = await authorizeApiRequest(req);
  if (!access.ok) return access.response;
  const { id, recordId } = await params;
  
  const allResearch = await listResearch(access.actor, id);
  const entry = allResearch.find(r => r.record.record_id === recordId);
  
  if (!entry) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  return NextResponse.json({ entry });
}
