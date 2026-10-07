import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import type { StructuredBrief } from '@/marcom/schemas/structured-brief';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { structured_brief, original_brief, source_type, source_name, project_name } = body;

    if (!structured_brief || !original_brief) {
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
    }

    const sb = structured_brief as StructuredBrief;

    const newProjectId = `proj-${Date.now()}`;
    const newProject = {
      project_id: newProjectId,
      name: project_name || sb.project.name || 'New Brief',
      aliases: [],
      summary: sb.project.description,
      status: 'READY_FOR_RESEARCH' as const,
      structured_brief: sb,
      target_definitions: sb.targets.map(t => ({
        target_type: t.target_type,
        definition: t.description,
        aliases: []
      })),
      notes: [`Original Brief Source: ${source_name || source_type || 'Manual Input'}`]
    };

    const memoryDir = path.join(process.cwd(), 'memory');
    const projectsFile = path.join(memoryDir, 'projects.json');
    
    let existingProjects = [];
    if (fs.existsSync(projectsFile)) {
      existingProjects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
    }
    
    existingProjects.push(newProject);
    fs.writeFileSync(projectsFile, JSON.stringify(existingProjects, null, 2), 'utf8');

    // Store the original brief memory for full history
    const originalBriefPath = path.join(memoryDir, `${newProjectId}-original.json`);
    fs.writeFileSync(originalBriefPath, JSON.stringify({
      project_id: newProjectId,
      source_type,
      source_name,
      original_text: original_brief,
      created_at: new Date().toISOString()
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
