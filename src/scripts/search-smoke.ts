import { GroqProvider } from '../marcom/llm/groq-provider';
import { readSearchConfiguration, resolveSearchProvider } from '../marcom/search/registry';

async function main() {
  const config = readSearchConfiguration();
  const provider = resolveSearchProvider(config, new GroqProvider());
  const response = await provider.search({
    query: 'UK independent poetry organisations literary awards',
    resultLimit: Math.min(3, provider.capabilities().maximumResults),
    includeDomains: [],
    excludeDomains: [],
  });

  console.log(
    JSON.stringify(
      {
        provider: response.providerKey,
        requestId: response.providerRequestId,
        query: response.query,
        resultCount: response.candidates.length,
        latencyMs: response.latencyMs,
        estimatedCostUsd: response.usage.estimatedCostUsd,
        warnings: response.warnings,
        results: response.candidates.map((candidate) => ({
          title: candidate.title,
          url: candidate.url,
          highlights: candidate.highlights.slice(0, 2),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
