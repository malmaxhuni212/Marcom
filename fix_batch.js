const fs = require('fs');
let code = fs.readFileSync('src/app/api/projects/[id]/batch-research/route.ts', 'utf8');

code = code.replace(
  "import { GroqProvider } from '@/marcom/llm/groq-provider';",
  "import { GroqProvider } from '@/marcom/llm/groq-provider';\nimport { getSearchProvider } from '@/marcom/search/registry';\nimport { discoverProspects } from '@/marcom/agents/research/discovery';"
);

code = code.replace(
  "        const entry = await runResearchAgent({\n          projectId,\n          brief: project.structured_brief,\n          targetId,\n          seed,\n          store,\n          provider,\n        });",
  "        const entry = await runResearchAgent({\n          projectId,\n          brief: project.structured_brief,\n          targetId,\n          seed,\n          store,\n          searchProvider: getSearchProvider(),\n          llmProvider: provider,\n        });"
);

// Delete old discovery block and replace with array-based discovery
const batchReplace = `// 1. Auto-discover a name
      const candidates = await discoverProspects(project.structured_brief, targetId, projectId, store, getSearchProvider(), provider, count - i);
      
      if (!candidates || candidates.length === 0) {
        console.log('No candidates found by discovery.');
        break; // Stop loop if no candidates found
      }

      for (const parsed of candidates) {
        if (i >= count) break;
        if (parsed && parsed.name) {
          const seed = {
            name: parsed.name,
            entity_kind: target?.entity_kind === 'person' || target?.entity_kind === 'organisation' ? target.entity_kind : 'unknown' as any,
            organisation: parsed.organisation || undefined
          };

          // 2. Run research
          const entry = await runResearchAgent({
            projectId,
            brief: project.structured_brief,
            targetId,
            seed,
            store,
            searchProvider: getSearchProvider(),
            llmProvider: provider,
          });

          saveResearch(projectId, entry);
          upsertProspectMemory(entry);
        }
        
        const task = backgroundTasks.get(taskId);
        if (task && task.status !== 'cancelled') task.completed++;
        i++; // advance the counter since we just completed one
      }
      i--; // adjust because the outer loop will do i++
`;

code = code.replace(/\/\/ 1\. Auto-discover a name[\s\S]*?if \(task && task\.status !== 'cancelled'\) task\.completed\+\+;/g, batchReplace);

fs.writeFileSync('src/app/api/projects/[id]/batch-research/route.ts', code);
console.log('Fixed batch route');
