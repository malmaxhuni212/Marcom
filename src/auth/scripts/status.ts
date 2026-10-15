import { closeDatabasePool } from '@/db/client';
import { loadDatabaseEnvironment } from '@/db/load-environment';
import { getSharedPilotCredentialStatus } from '../credentials';
import { promptLine } from '../cli-prompt';

loadDatabaseEnvironment();

async function main(): Promise<void> {
  const username = await promptLine('Shared pilot username: ');
  const result = await getSharedPilotCredentialStatus(username);

  console.log(
    JSON.stringify(
      result
        ? {
            event: 'shared_pilot_credential_status',
            configured: true,
            username: result.username,
            displayName: result.displayName,
            userStatus: result.userStatus,
            membershipStatus: result.membershipStatus,
            credentialVersion: result.credentialVersion,
            passwordChangedAt: result.passwordChangedAt.toISOString(),
            lastLoginAt: result.lastLoginAt?.toISOString() ?? null,
            activeSessionCount: result.activeSessionCount,
          }
        : {
            event: 'shared_pilot_credential_status',
            configured: false,
          },
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'shared_pilot_credential_status_failed',
        message: error instanceof Error ? error.message : 'Unknown credential status failure',
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDatabasePool);
