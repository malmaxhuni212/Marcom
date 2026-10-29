import { signResearchJob } from './worker-auth';

function resolveWorkerBaseUrl(requestUrl?: string): string {
  const candidate = [
    requestUrl,
    process.env.DEPLOY_PRIME_URL,
    process.env.URL,
    process.env.APP_ORIGIN,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  if (!candidate) {
    throw new Error('Unable to resolve base URL to dispatch Netlify research worker.');
  }
  return candidate.trim();
}

export async function dispatchNetlifyResearchWorker(
  jobId: string,
  requestUrl?: string,
): Promise<void> {
  const endpoint = new URL(
    '/.netlify/functions/research-worker-background',
    resolveWorkerBaseUrl(requestUrl),
  );
  const signature = signResearchJob(jobId);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Marcom-Job-Signature': signature,
        },
        body: JSON.stringify({ jobId }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return;
      if (response.status >= 500 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw new Error(`Research worker dispatch failed with status ${response.status}.`);
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
}
