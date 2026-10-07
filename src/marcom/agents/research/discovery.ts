import { SearchProvider } from '../../search/provider';
import { LLMProvider, extractJson } from '../../llm/provider';
import { StructuredBrief } from '../../schemas/structured-brief';
import { planResearch } from './planner';
import { MemoryStore } from '../../memory/store';
import { retrieveMemoryContext } from '../../memory/retrieval';

export async function discoverProspects(
  brief: StructuredBrief,
  targetId: string | undefined,
  projectId: string,
  store: MemoryStore,
  searchProvider: SearchProvider,
  llmProvider: LLMProvider,
  count: number = 1
): Promise<{ name: string; organisation?: string; url?: string }[]> {
  const target = brief.targets.find(t => t.id === targetId) || brief.targets[0];
  if (!target) return [];

  const memory = retrieveMemoryContext(
    { task: 'research', project_id: projectId, target_type: target.target_type, prospect_names: [], max_prospects: 1 },
    store
  );
  
  const plan = planResearch(brief, target.id, projectId, memory);
  
  // 1. Build discovery queries
  const geo = target.geography.length ? target.geography.join(' OR ') : '';
  const searchQueries = [
    `list of top ${target.target_type} ${geo}`.trim(),
    `award winning ${target.target_type} ${geo}`.trim()
  ];

  // 2. Ask SearchProvider for bounded result set
  const candidates: {url: string; text: string; title: string}[] = [];
  const urls = new Set<string>();

  for (const q of searchQueries) {
    const res = await searchProvider.search({ query: q, resultLimit: 10, category: target.entity_kind === 'person' ? 'people' : target.entity_kind === 'organisation' ? 'company' : undefined });
    for (const r of res.results) {
      if (!urls.has(r.url)) {
        urls.add(r.url);
        candidates.push({ url: r.url, text: r.text || r.highlights?.join('\n') || '', title: r.title });
      }
    }
  }

  // 4. Remove exact duplicates before LLM enrichment (already handled by Set, but we could also check memory here if needed. Memory check happens later per prospect.)
  
  if (candidates.length === 0) return [];

  // 5. Use an LLM to structure the returned search results into prospect candidates
  const evidence = candidates.map((c, i) => `[Source ${i}] URL: ${c.url}\nTITLE: ${c.title}\nTEXT: ${c.text.slice(0, 500)}`).join('\n\n');

  const system = `Extract a JSON list of prospects from the evidence. Return an object with a "prospects" array.
Format: {"prospects": [{"name": "...", "organisation": "...", "url": "..."}]}
Only extract prospects that match: ${target.target_type}. They MUST be found in the text.`;

  const text = await llmProvider.complete({ system, user: evidence, maxTokens: 2000 });
  let parsed: any;
  try {
    parsed = extractJson(text);
  } catch {
    return [];
  }

  if (parsed && Array.isArray(parsed.prospects)) {
    return parsed.prospects.slice(0, count);
  }

  return [];
}
