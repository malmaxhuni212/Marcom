const fs = require('fs');
let code = fs.readFileSync('src/app/api/projects/[id]/batch-research/route.ts', 'utf8');

code = code.replace(
  "  const count = Number(body.count) || 1;",
  "  const maxAppLimit = parseInt(process.env.SEARCH_MAX_RESULTS || '25', 10);\n  let count = Number(body.count) || 1;\n  if (count <= 0 || count > maxAppLimit) return NextResponse.json({ error: \Count must be between 1 and \\ }, { status: 400 });"
);

fs.writeFileSync('src/app/api/projects/[id]/batch-research/route.ts', code);
console.log('Fixed batch limit');
