const fs = require('fs');
let code = fs.readFileSync('src/marcom/agents/research/discovery.ts', 'utf8');

code = code.replace(
  '  if (candidates.length === 0) return [];',
  '  if (candidates.length === 0) { console.log(\\'Search returned 0 results for queries:\\', searchQueries); return []; }\\n  console.log(\\'Search returned\\', candidates.length, \\'results\\');'
);

code = code.replace(
  '  const text = await llmProvider.complete({ system, user: evidence, maxTokens: 2000 });',
  '  const text = await llmProvider.complete({ system, user: evidence, maxTokens: 2000 });\\n  console.log(\\'LLM response text:\\', text);'
);

fs.writeFileSync('src/marcom/agents/research/discovery.ts', code);
console.log('Added debug logs');
