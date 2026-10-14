/**
 * Memory storage. `MemoryStore` is the seam where a real database (Notion, Postgres, vector store, ...)
 * will plug in later. Today: JSON files under /memory and the Lunim markdown doc.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  HumanDecision,
  Learning,
  LunimSection,
  ProjectMemory,
  ProspectMemory,
  RelationshipMemory,
  TaskKind,
} from './types';

export interface MemoryStore {
  lunim(): LunimSection[];
  projects(): ProjectMemory[];
  prospects(): ProspectMemory[];
  relationships(): RelationshipMemory[];
  decisions(): HumanDecision[];
  learnings(): Learning[];
}

export interface MemoryData {
  lunim: LunimSection[];
  projects: ProjectMemory[];
  prospects: ProspectMemory[];
  relationships: RelationshipMemory[];
  decisions: HumanDecision[];
  learnings: Learning[];
}

export class InMemoryStore implements MemoryStore {
  constructor(private data: MemoryData) {}
  lunim() { return this.data.lunim; }
  projects() { return this.data.projects; }
  prospects() { return this.data.prospects; }
  relationships() { return this.data.relationships; }
  decisions() { return this.data.decisions; }
  learnings() { return this.data.learnings; }
}

/** Which Lunim sections matter for which task. Keeps calls small and on-topic. */
const LUNIM_SECTION_TASKS: { match: RegExp; used_for: TaskKind[] }[] = [
  { match: /mission|vision/i, used_for: ['brief_analysis', 'personalization'] },
  { match: /positioning|differentiator/i, used_for: ['brief_analysis', 'personalization'] },
  { match: /values/i, used_for: ['research', 'personalization'] },
  { match: /communication|voice|messaging/i, used_for: ['brief_analysis', 'personalization'] },
  { match: /audience/i, used_for: [] }, // Client briefs define their own target audiences
  { match: /history/i, used_for: ['personalization'] },
  { match: /visual|governance/i, used_for: [] },
];

export function parseLunimMarkdown(markdown: string): LunimSection[] {
  const chunks = markdown.split(/^## /m).slice(1);
  return chunks.map((chunk) => {
    const [heading, ...rest] = chunk.split('\n');
    const status = /\(pending confirmation\)/i.test(heading)
      ? 'pending_confirmation'
      : /\(inferred\)/i.test(heading)
        ? 'inferred'
        : 'confirmed';
    const title = heading.replace(/\((confirmed|inferred|pending confirmation)\)/i, '').trim();
    const rule = LUNIM_SECTION_TASKS.find((r) => r.match.test(title));
    return {
      id: `lunim-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
      title,
      body: rest.join('\n').trim(),
      used_for: rule?.used_for ?? [],
      status,
    } satisfies LunimSection;
  });
}

function readJson<T>(file: string): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : ([] as unknown as T);
}

export class JsonFileMemoryStore implements MemoryStore {
  private cache: MemoryData;
  constructor(root = process.cwd()) {
    const dir = path.join(root, 'memory');
    const lunimDoc = path.join(root, 'docs', 'lunim-context.md');
    this.cache = {
      lunim: existsSync(lunimDoc) ? parseLunimMarkdown(readFileSync(lunimDoc, 'utf8')) : [],
      projects: readJson(path.join(dir, 'projects.json')),
      prospects: readJson(path.join(dir, 'prospects.json')),
      relationships: readJson(path.join(dir, 'relationships.json')),
      decisions: readJson(path.join(dir, 'human-decisions.json')),
      learnings: readJson(path.join(dir, 'learnings.json')),
    };
  }
  lunim() { return this.cache.lunim; }
  projects() { return this.cache.projects; }
  prospects() { return this.cache.prospects; }
  relationships() { return this.cache.relationships; }
  decisions() { return this.cache.decisions; }
  learnings() { return this.cache.learnings; }
}
