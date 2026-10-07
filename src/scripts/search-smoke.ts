import { getSearchProvider } from '../marcom/search/registry';

async function runSmokeTest() {
  console.log('--- Search Provider Smoke Test ---');
  
  try {
    const provider = getSearchProvider();
    console.log(`Configured Provider: ${provider.key}`);
    
    const capabilities = provider.capabilities();
    console.log(`Capabilities: ${JSON.stringify(capabilities)}`);

    const query = 'test synthetic query';
    console.log(`\nExecuting query: "${query}" (limit: 3)`);
    
    const start = Date.now();
    const res = await provider.search({
      query,
      resultLimit: 3
    });
    const latency = Date.now() - start;

    console.log(`\nSuccess! Latency: ${res.latencyMs || latency}ms`);
    console.log(`Provider Request ID: ${res.providerRequestId || 'N/A'}`);
    console.log(`Warnings: ${res.warnings?.join(', ') || 'None'}`);
    console.log(`\nResults returned: ${res.results.length}`);
    
    res.results.forEach((r, i) => {
      console.log(`\n[Result ${i+1}] ${r.title}`);
      console.log(`URL: ${r.url}`);
      console.log(`ID: ${r.providerResultId}`);
      if (r.text) {
        console.log(`Text preview: ${r.text.substring(0, 50)}...`);
      } else if (r.highlights) {
        console.log(`Highlights: ${r.highlights.length}`);
      }
    });

  } catch (e: any) {
    console.error('\nSmoke test failed with error:');
    console.error(`Name: ${e.name}`);
    console.error(`Message: ${e.message}`);
    if (e.code) console.error(`Code: ${e.code}`);
  }
}

runSmokeTest();
