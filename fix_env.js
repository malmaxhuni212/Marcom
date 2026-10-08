const fs = require('fs');
let content = fs.readFileSync('.env.local', 'utf8');
content = content.replace('SEARCH_MAX_RESULTS=25', 'SEARCH_MAX_RESULTS=50');
fs.writeFileSync('.env.local', content);
