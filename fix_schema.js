const fs = require('fs');
let code = fs.readFileSync('src/marcom/schemas/research-record.ts', 'utf8');

if (!code.includes('search_provider')) {
  code = code.replace(
    '  searches: z.array(z.string()).describe(\'Search queries run\'),',
    '  searches: z.array(z.string()).describe(\'Search queries run\'),\n  search_provider: z.string().optional().describe(\'Search provider used\'),'
  );
  
  code = code.replace(
    '  searches: string[];',
    '  searches: string[];\n  search_provider?: string;'
  );
  
  fs.writeFileSync('src/marcom/schemas/research-record.ts', code);
  console.log('Fixed research-record.ts');
}
