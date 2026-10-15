import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'scrypt';
const FORMAT_VERSION = 1;
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 3;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = 16;
export const PASSWORD_MAX_LENGTH = 128;

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
}

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

function lengthInCodePoints(value: string): number {
  return Array.from(value).length;
}

export function normalizeUsername(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export function validateUsername(value: string): string {
  const normalized = normalizeUsername(value);
  const length = lengthInCodePoints(normalized);

  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    throw new Error(
      `Username must contain between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`,
    );
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error(
      'Username may contain lowercase letters, numbers, dots, underscores and hyphens only.',
    );
  }

  return normalized;
}

export function validatePassword(value: string): void {
  const length = lengthInCodePoints(value);

  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Password must contain between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt, {
    cost: COST,
    blockSize: BLOCK_SIZE,
    parallelization: PARALLELIZATION,
  });

  return [
    ALGORITHM,
    `v=${FORMAT_VERSION}`,
    `N=${COST},r=${BLOCK_SIZE},p=${PARALLELIZATION}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (lengthInCodePoints(password) > PASSWORD_MAX_LENGTH) return false;

  const parts = encodedHash.split('$');
  if (parts.length !== 5 || parts[0] !== ALGORITHM || parts[1] !== `v=${FORMAT_VERSION}`) {
    return false;
  }

  const parameterMatch = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[2]);
  if (!parameterMatch) return false;

  const parameters: ScryptParameters = {
    cost: Number(parameterMatch[1]),
    blockSize: Number(parameterMatch[2]),
    parallelization: Number(parameterMatch[3]),
  };

  if (
    parameters.cost !== COST ||
    parameters.blockSize !== BLOCK_SIZE ||
    parameters.parallelization !== PARALLELIZATION
  ) {
    return false;
  }

  let salt: Buffer;
  let expectedKey: Buffer;
  try {
    salt = Buffer.from(parts[3], 'base64url');
    expectedKey = Buffer.from(parts[4], 'base64url');
  } catch {
    return false;
  }

  if (salt.length !== SALT_LENGTH || expectedKey.length !== KEY_LENGTH) return false;

  const actualKey = await deriveKey(password, salt, parameters);
  return timingSafeEqual(actualKey, expectedKey);
}

