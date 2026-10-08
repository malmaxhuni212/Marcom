const fs = require('fs');
let content = fs.readFileSync('.env.example', 'utf8');
content = content.replace('SEARCH_MAX_RESULTS=25', 'SEARCH_MAX_RESULTS=50');
fs.writeFileSync('.env.example', content);
