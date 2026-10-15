import { closeDatabasePool } from '@/db/client';
import { loadDatabaseEnvironment } from '@/db/load-environment';
import { getSharedPilotCredentialStatus } from '../credentials';
import { promptLine } from '../cli-prompt';
import { revokeAllUserSessions } from '../session';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  const username = await promptLine('Shared pilot username: ');
  const reasonInput = await promptLine('Revocation reason [Administrator revocation]: ');
  const credential = await getSharedPilotCredentialStatus(username);
  if (!credential) throw new Error('The shared pilot credential was not found.');

  const sessionCount = await revokeAllUserSessions(
    credential.actor.userId,
    reasonInput || 'Administrator revocation',
  );
  console.log(
    JSON.stringify({
      event: 'shared_pilot_sessions_revoked',
      userId: credential.actor.userId,
      sessionCount,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'shared_pilot_session_revocation_failed',
        message: error instanceof Error ? error.message : 'Unknown session revocation failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);

