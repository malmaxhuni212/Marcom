const fs = require('fs');
let code = fs.readFileSync('src/app/api/projects/[id]/batch-research/route.ts', 'utf8');

code = code.replace(
  "NextResponse.json({ error: Count must be between 1 and \\ }, { status: 400 });",
  "NextResponse.json({ error: \Count must be between 1 and \\ }, { status: 400 });"
);

fs.writeFileSync('src/app/api/projects/[id]/batch-research/route.ts', code);
console.log('Fixed batch limit quotes');
