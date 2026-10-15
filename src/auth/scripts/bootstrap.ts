import { closeDatabasePool } from '@/db/client';
import { loadDatabaseEnvironment } from '@/db/load-environment';
import { bootstrapSharedPilotCredential, SHARED_PILOT_DISPLAY_NAME } from '../credentials';
import { promptHidden, promptLine } from '../cli-prompt';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  const username = await promptLine('Shared pilot username: ');
  const displayNameInput = await promptLine(`Display name [${SHARED_PILOT_DISPLAY_NAME}]: `);
  const password = await promptHidden('Password: ');
  const confirmation = await promptHidden('Confirm password: ');

  if (password !== confirmation) throw new Error('Password confirmation does not match.');

  const result = await bootstrapSharedPilotCredential({
    username,
    password,
    displayName: displayNameInput || SHARED_PILOT_DISPLAY_NAME,
  });

  console.log(
    JSON.stringify({
      event: 'shared_pilot_credential_bootstrapped',
      userId: result.actor.userId,
      membershipId: result.actor.membershipId,
      username: result.username,
      credentialVersion: result.credentialVersion,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'shared_pilot_credential_bootstrap_failed',
        message: error instanceof Error ? error.message : 'Unknown bootstrap failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);

