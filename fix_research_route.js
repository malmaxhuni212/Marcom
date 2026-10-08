const fs = require('fs');
let code = fs.readFileSync('src/app/api/projects/[id]/research/route.ts', 'utf8');

// Imports
code = code.replace(
  "import { GroqProvider } from '@/marcom/llm/groq-provider';",
  "import { GroqProvider } from '@/marcom/llm/groq-provider';\nimport { getSearchProvider } from '@/marcom/search/registry';\nimport { discoverProspects } from '@/marcom/agents/research/discovery';"
);

// Delete old discovery block
const oldDiscovery = \          const target = project.structured_brief!.targets.find((t: any) => t.id === clean(body.target_id, 100));
          const targetName = target ? target.target_type : 'relevant professionals';
          
          // Use provider to generate a name
          const discoveryQuery = \\\Find ONE highly specific real-world example of a \ relevant to: \. Return ONLY a JSON object with {"name": "...", "organisation": "..."}. Do not use Markdown.\\\;
          
          const text = await provider.complete({
             system: "You are a web discovery agent. Output ONLY valid JSON.",
             user: discoveryQuery,
             maxTokens: 500
          });
          
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch(e) {
             const m = text.match(/\\{[\\s\\S]*\\}/);
             if (m) parsed = JSON.parse(m[0]);
          }
          if (parsed && parsed.name) {
             actualSeed.name = parsed.name;
             if (parsed.organisation && !actualSeed.organisation) {
                actualSeed.organisation = parsed.organisation;
             }
             onProgress({ stage: 'resolving', message: \\\Discovered: \\\\ });
          } else {
             throw new Error("Could not discover a prospect automatically. Please enter a name.");
          }\;

const newDiscovery = \          const candidates = await discoverProspects(project.structured_brief!, clean(body.target_id, 100), projectId, store, getSearchProvider(), provider, 1);
          if (candidates.length > 0) {
             actualSeed.name = candidates[0].name;
             actualSeed.organisation = candidates[0].organisation;
             onProgress({ stage: 'resolving', message: \\\Discovered: \\\\ });
          } else {
             throw new Error("Could not discover a prospect automatically. Please enter a name.");
          }\;

code = code.replace(oldDiscovery, newDiscovery);

// Refactor runResearchAgent
const oldRun = \        const entry = await runResearchAgent({
          projectId,
          brief: project.structured_brief!,
          targetId: clean(body.target_id, 100),
          seed: actualSeed,
          store,
          provider,\;

const newRun = \        const entry = await runResearchAgent({
          projectId,
          brief: project.structured_brief!,
          targetId: clean(body.target_id, 100),
          seed: actualSeed,
          store,
          searchProvider: getSearchProvider(),
          llmProvider: provider,\;

code = code.replace(oldRun, newRun);

fs.writeFileSync('src/app/api/projects/[id]/research/route.ts', code);
console.log('Fixed research route');
