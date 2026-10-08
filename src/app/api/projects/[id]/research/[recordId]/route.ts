import { NextResponse } from 'next/server';
import { listResearch } from '@/marcom/memory/research-store';

export async function GET(req: Request, { params }: { params: Promise<{ id: string, recordId: string }> }) {
  const { id, recordId } = await params;
  
  const allResearch = listResearch(id);
  const entry = allResearch.find(r => r.record.record_id === recordId);
  
  if (!entry) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  return NextResponse.json({ entry });
}
