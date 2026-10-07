const fs = require('fs');
let code = fs.readFileSync('.env.example', 'utf8');

if (!code.includes('SEARCH_PROVIDER')) {
  code += '\\n\\n# Search Provider Configuration\\nSEARCH_PROVIDER=exa # exa | groq-browser | fake\\nEXA_API_KEY=\\nSEARCH_MAX_RESULTS=25\\nSEARCH_TIMEOUT_MS=15000\\n';
  fs.writeFileSync('.env.example', code);
}
