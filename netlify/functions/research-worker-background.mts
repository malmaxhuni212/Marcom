import { z } from 'zod';
import { runQueuedResearchJob } from '../../src/marcom/research/job-runner';
import { safeResearchLog } from '../../src/marcom/research/safe-error';
import { verifyResearchJobSignature } from '../../src/marcom/research/worker-auth';

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
    if (result.status === 'retry_scheduled') {
      throw new Error(`Research retry scheduled: ${result.errorCode}`);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    safeResearchLog('research.background_worker.crashed', error);
    throw error;
  }
}
