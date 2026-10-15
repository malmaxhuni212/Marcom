require('dotenv').config({ path: '.env.local' });
const fetch = require('node-fetch');
async function run() {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_RESEARCH_API_KEY}`
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: 'You are a web discovery agent. Output ONLY valid JSON.' },
        { role: 'user', content: 'Find ONE highly specific real-world example of a Authors relevant to: Maya Book Awards. Return ONLY a JSON object with {"name": "...", "organisation": "..."}. Do not use Markdown.' }
      ],
      temperature: 0.1,
      max_tokens: 500
    })
  });
  console.log(await res.text());
}
run();
