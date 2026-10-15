import { loadEnvConfig } from '@next/env';

export function loadDatabaseEnvironment(): void {
  loadEnvConfig(process.cwd());
}
