const fs = require('fs');
let code = fs.readFileSync('README.md', 'utf8');

if (!code.includes('## Search Providers')) {
  code += `

## Search Providers
MARCOM uses a provider-neutral search architecture.
You can switch search providers via the \`.env.local\` file:

\`\`\`env
SEARCH_PROVIDER=exa
EXA_API_KEY=your-exa-key
SEARCH_MAX_RESULTS=25
SEARCH_TIMEOUT_MS=15000
\`\`\`

### Available Providers
- \`exa\`: Uses the Exa Neural Search API (requires EXA_API_KEY). Highly recommended for production.
- \`groq-browser\`: Uses the legacy Groq built-in browser search.
- \`fake\`: Uses deterministic fake results for testing.

### Developer Scripts
- **Smoke Test:** \`npm run search:smoke\` (Tests the configured search provider without hitting the database)
- **Tests:** \`npm run test\`
`;
  fs.writeFileSync('README.md', code);
}
