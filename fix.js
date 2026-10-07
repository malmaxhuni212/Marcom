const fs = require('fs');
let content = fs.readFileSync('src/app/api/projects/route.ts', 'utf8');
content = content.replace(/let icon = '[^']*';/g, "let icon = '📁';");
content = content.replace(/if \(pm\.name\.toLowerCase\(\)\.includes\('book'\)\) \{ icon = '[^']*';/g, "if (pm.name.toLowerCase().includes('book')) { icon = '📚';");
content = content.replace(/else if \(pm\.name\.toLowerCase\(\)\.includes\('sponsor'\)\) \{ icon = '[^']*';/g, "else if (pm.name.toLowerCase().includes('sponsor')) { icon = '🏆';");
content = content.replace(/else if \(pm\.name\.toLowerCase\(\)\.includes\('film'\) \|\| pm\.name\.toLowerCase\(\)\.includes\('soulbound'\)\) \{ icon = '[^']*';/g, "else if (pm.name.toLowerCase().includes('film') || pm.name.toLowerCase().includes('soulbound')) { icon = '🎬';");
fs.writeFileSync('src/app/api/projects/route.ts', content, 'utf8');
