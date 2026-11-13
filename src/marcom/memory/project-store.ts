import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectMemory } from './types';

function projectsPath(root = process.cwd()): string {
  return path.join(root, 'memory', 'projects.json');
}

export function readProjects(root = process.cwd()): ProjectMemory[] {
  const file = projectsPath(root);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProjectMemory[]) : [];
}

function writeProjects(projects: ProjectMemory[], root = process.cwd()): void {
  const file = projectsPath(root);
  const temporaryFile = `${file}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(projects, null, 2), 'utf8');
  renameSync(temporaryFile, file);
}

export function addProject(project: ProjectMemory, root = process.cwd()): void {
  const projects = readProjects(root);
  projects.push(project);
  writeProjects(projects, root);
}

export function updateProject(
  projectId: string,
  update: (project: ProjectMemory) => ProjectMemory,
  root = process.cwd(),
): ProjectMemory | null {
  const projects = readProjects(root);
  let index = projects.findIndex(
    (project) => project.project_id === projectId || project.aliases?.includes(projectId),
  );
  if (index === -1) {
    const fallbackBase: ProjectMemory = {
      project_id: projectId,
      name: 'Campaign',
      aliases: [],
      summary: '',
      status: 'READY_FOR_RESEARCH',
      structured_brief: {
        structured_brief_version: '1.0',
        project: {
          name: 'Campaign',
          description: '',
          primary_objective: '',
          secondary_objectives: [],
          success_metrics: [],
        },
        targets: [
          {
            id: 'target-1',
            target_type: 'General',
            entity_kind: 'person',
            description: '',
            geography: [],
            qualification_criteria: [],
            exclusion_criteria: [],
            priority: 'primary',
          },
        ],
        research: {
          required_fields: ['Name'],
          preferred_source_types: ['Web'],
          evidence_requirements: [],
          verification_requirements: [],
          unknown_handling: 'skip',
        },
        personalization: {
          allowed: [],
          preferred_details: [],
          tone: ['Professional'],
          avoid: [],
        },
        outreach: {
          channels: ['Email'],
          tone: ['Professional'],
          objectives: ['Reach out'],
          approval_required: true,
        },
        database: {
          fields: [{ name: 'Name', required: true, purpose: 'Identity', expected_source: 'research' }],
        },
        human_review: {
          requirements: [],
          approval_points: ['outreach'],
        },
        constraints: [],
        conflicts: [],
        approximations: [],
        unknowns_requiring_confirmation: [],
      },
      target_definitions: [],
      notes: [],
      configuration_revision: 0,
      configuration_updated_at: new Date().toISOString(),
    };
    projects.push(fallbackBase);
    index = projects.length - 1;
  }
  const updated = update(projects[index]!);
  projects[index] = updated;
  writeProjects(projects, root);
  return updated;
}

