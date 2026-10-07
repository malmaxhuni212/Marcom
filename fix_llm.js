const fs = require('fs');
let code = fs.readFileSync('src/marcom/llm/provider.ts', 'utf8');

if (!code.includes('readonly model: string;')) {
  code = code.replace(
    'export interface LLMProvider {',
    'export interface LLMProvider {\n  readonly model: string;'
  );
  fs.writeFileSync('src/marcom/llm/provider.ts', code);
  console.log('Fixed provider.ts');
}
