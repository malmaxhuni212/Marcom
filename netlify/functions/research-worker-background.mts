import { z } from 'zod';
import { runQueuedResearchJob } from '../../src/marcom/research/job-runner';
import { safeResearchLog } from '../../src/marcom/research/safe-error';
import { verifyResearchJobSignature } from '../../src/marcom/research/worker-auth';
import { dispatchNetlifyResearchWorker } from '../../src/marcom/research/worker-dispatch';

const WorkerRequestSchema = z.strictObject({ jobId: z.uuid() });

export const config = { background: true } as const;

export default async function researchWorker(request: Request): Promise<Response> {
  const parsed = WorkerRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response('Invalid request.', { status: 400 });

  const signature = request.headers.get('x-marcom-job-signature') ?? '';
  if (!verifyResearchJobSignature(parsed.data.jobId, signature)) {
    return new Response('Unauthorised.', { status: 401 });
  }

  try {
    const result = await runQueuedResearchJob(parsed.data.jobId);
    if (result.status === 'continue') {
      await dispatchNetlifyResearchWorker(parsed.data.jobId, request.url).catch((error) => {
        safeResearchLog('research.worker_relay.failed', error);
      });
    } else if (result.status === 'retry_scheduled') {
      // Wait past the minimum retry window so unattended background runs also self-resume.
      await new Promise((resolve) => setTimeout(resolve, 31_000));
      await dispatchNetlifyResearchWorker(parsed.data.jobId, request.url).catch((error) => {
        safeResearchLog('research.worker_retry_relay.failed', error);
      });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    safeResearchLog('research.background_worker.crashed', error);
    return new Response(null, { status: 204 });
  }
}
