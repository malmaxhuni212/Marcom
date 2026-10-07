import { NextResponse } from 'next/server';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { listResearch } from '@/marcom/memory/research-store';

/** Project detail: project memory (incl. structured brief) + saved research entries. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = new JsonFileMemoryStore().projects().find((p) => p.project_id === id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return NextResponse.json({ project, research: listResearch(id) });
}
