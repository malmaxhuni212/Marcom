const fs = require('fs');
let code = fs.readFileSync('src/app/api/projects/[id]/research/route.ts', 'utf8');

code = code.replace(
  "import { GroqProvider } from '@/marcom/llm/groq-provider';",
  "import { GroqProvider } from '@/marcom/llm/groq-provider';\nimport { getSearchProvider } from '@/marcom/search/registry';\nimport { discoverProspects } from '@/marcom/agents/research/discovery';"
);

code = code.replace(
  "        const entry = await runResearchAgent({\n          projectId,\n          brief: project.structured_brief!,\n          targetId: clean(body.target_id, 100),\n          seed: actualSeed,\n          store,\n          provider,\n          onProgress,\n        });",
  "        const entry = await runResearchAgent({\n          projectId,\n          brief: project.structured_brief!,\n          targetId: clean(body.target_id, 100),\n          seed: actualSeed,\n          store,\n          searchProvider: getSearchProvider(),\n          llmProvider: provider,\n          onProgress,\n        });"
);

// We'll replace the block using regex to avoid exact character match issues
code = code.replace(
  /const target = project\.structured_brief!\.targets\.find[\s\S]*?Please enter a name\."\);\n          \}/,
  `const candidates = await discoverProspects(project.structured_brief!, clean(body.target_id, 100), projectId, store, getSearchProvider(), provider, 1);
          if (candidates.length > 0) {
             actualSeed.name = candidates[0].name;
             if (candidates[0].organisation) actualSeed.organisation = candidates[0].organisation;
             onProgress({ stage: 'resolving', message: \`Discovered: \${actualSeed.name}\` });
          } else {
             throw new Error("Could not discover a prospect automatically. Please enter a name.");
          }`
);

fs.writeFileSync('src/app/api/projects/[id]/research/route.ts', code);
console.log('Fixed research route');
