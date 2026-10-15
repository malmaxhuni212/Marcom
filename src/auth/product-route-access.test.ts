import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

test('AUTH-003 every product API handler invokes the shared access gate', () => {
  const failures: string[] = [];
  for (const file of routeFiles(API_ROOT)) {
    const name = relative(process.cwd(), file).replaceAll('\\', '/');
    if (name === 'src/app/api/v1/auth/session/route.ts') continue;

    const source = readFileSync(file, 'utf8');
    const handlerCount = [...source.matchAll(/export async function (?:GET|POST|PUT|PATCH|DELETE)\s*\(/g)].length;
    const gateCount = [...source.matchAll(/await authorizeApiRequest\(/g)].length;
    if (handlerCount === 0 || gateCount !== handlerCount) {
      failures.push(`${name}: ${gateCount} access checks for ${handlerCount} handlers`);
    }
    if (source.includes('resolveLocalPilotActor')) {
      failures.push(`${name}: directly resolves the local actor`);
    }
  }

  assert.deepEqual(failures, []);
});
