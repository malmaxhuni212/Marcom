import { NextResponse } from 'next/server';
import { JsonFileMemoryStore } from '@/marcom/memory/store';
import { Project } from '@/types';

export async function GET() {
  try {
    const store = new JsonFileMemoryStore();
    const projectMemories = store.projects();

    // Map ProjectMemory to the UI Project type
    const projects: Project[] = projectMemories.map(pm => {
      let icon = '📁';
      let accentColor: Project['accentColor'] = 'blue';

      // Infer an icon/color based on name just for visual variety, or fallback
      if (pm.name.toLowerCase().includes('book')) { icon = '📚'; accentColor = 'pink'; }
      else if (pm.name.toLowerCase().includes('sponsor')) { icon = '🏆'; accentColor = 'purple'; }
      else if (pm.name.toLowerCase().includes('film') || pm.name.toLowerCase().includes('soulbound')) { icon = '🎬'; accentColor = 'blue'; }

      return {
        id: pm.project_id,
        name: pm.name || 'Untitled Project',
        description: pm.summary || pm.structured_brief?.project.description || 'No description provided.',
        prospectsCurrent: 0,
        prospectsTotal: 100,
        qualifiedCount: 0,
        reviewCount: 0,
        status: (pm.status as any) === 'READY_FOR_RESEARCH' ? 'active' : ((pm.status || 'draft').toLowerCase() as any),
        accentColor,
        icon,
      };
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');

    const memoryDir = path.join(process.cwd(), 'memory');
    const projectsFile = path.join(memoryDir, 'projects.json');

    if (!fs.existsSync(projectsFile)) {
      return NextResponse.json({ error: 'No projects found' }, { status: 404 });
    }

    const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
    const filtered = projects.filter((p: any) => p.project_id !== id);

    fs.writeFileSync(projectsFile, JSON.stringify(filtered, null, 2), 'utf8');

    // Also delete original brief file if exists
    const origFile = path.join(memoryDir, `${id}-original.json`);
    if (fs.existsSync(origFile)) {
      fs.unlinkSync(origFile);
    }

    return NextResponse.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}

