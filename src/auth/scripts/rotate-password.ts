import { closeDatabasePool } from '@/db/client';
import { loadDatabaseEnvironment } from '@/db/load-environment';
import { rotateSharedPilotPassword } from '../credentials';
import { promptHidden, promptLine } from '../cli-prompt';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  const username = await promptLine('Shared pilot username: ');
  const password = await promptHidden('New password: ');
  const confirmation = await promptHidden('Confirm new password: ');

  if (password !== confirmation) throw new Error('Password confirmation does not match.');

  const result = await rotateSharedPilotPassword(username, password);
  console.log(
    JSON.stringify({
      event: 'shared_pilot_password_rotated',
      userId: result.actor.userId,
      username: result.username,
      credentialVersion: result.credentialVersion,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'shared_pilot_password_rotation_failed',
        message: error instanceof Error ? error.message : 'Unknown password rotation failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);

