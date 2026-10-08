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
  const index = projects.findIndex((project) => project.project_id === projectId);
  if (index === -1) return null;
  const updated = update(projects[index]);
  projects[index] = updated;
  writeProjects(projects, root);
  return updated;
}

