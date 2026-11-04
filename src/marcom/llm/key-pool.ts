/**
 * Groq API key pools with round-robin rotation and per-key rate-limit cooldowns.
 *
 * Pools are separate so one agent cannot starve another's rate-limit budget:
 *   - 'research'        : GROQ_RESEARCH_API_KEY_1/_2, GROQ_RESEARCH_API_KEY
 *   - 'personalization' : GROQ_PERSONALIZATION_API_KEY_1/_2/_3, GROQ_PERSONALIZATION_API_KEY
 *                         (falls back to the research keys + GROQ_API_KEY when none are set)
 */
export type KeyPoolName = 'research' | 'personalization';

const POOL_ENV: Record<KeyPoolName, string[]> = {
  research: ['GROQ_RESEARCH_API_KEY_1', 'GROQ_RESEARCH_API_KEY_2', 'GROQ_RESEARCH_API_KEY'],
  personalization: [
    'GROQ_PERSONALIZATION_API_KEY_1',
    'GROQ_PERSONALIZATION_API_KEY_2',
    'GROQ_PERSONALIZATION_API_KEY_3',
    'GROQ_PERSONALIZATION_API_KEY',
  ],
};

const POOL_FALLBACK: Partial<Record<KeyPoolName, string[]>> = {
  research: ['GROQ_API_KEY'],
  personalization: [...POOL_ENV.research, 'GROQ_API_KEY'],
};

class RotatingKeyPool {
  private keys: { key: string; availableAt: number }[] = [];
  private cursor = 0;

  constructor(private readonly poolName: KeyPoolName) {}

  private initialize() {
    if (this.keys.length > 0) return;
    const read = (names: string[]) => names.map((name) => process.env[name]).filter(Boolean) as string[];
    let envKeys = read(POOL_ENV[this.poolName]);
    if (!envKeys.length && POOL_FALLBACK[this.poolName]) envKeys = read(POOL_FALLBACK[this.poolName]!);
    this.keys = [...new Set(envKeys)].map((key) => ({ key, availableAt: 0 }));
    if (!this.keys.length) throw new Error(`No Groq API keys configured for the ${this.poolName} pool.`);
  }

  size(): number {
    this.initialize();
    return this.keys.length;
  }

  async getAvailableKey(onWait?: (seconds: number) => void): Promise<string> {
    this.initialize();
    const now = Date.now();
    const n = this.keys.length;
    let bestKey = this.keys[0];

    // Round-robin selection among immediately available keys
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      const k = this.keys[idx];
      if (k.availableAt <= now) {
        this.cursor = (idx + 1) % n;
        return k.key;
      }
      if (k.availableAt < bestKey.availableAt) bestKey = k;
    }

    // All keys are on cooldown. Wait for the best one (capped to 4s so serverless requests do not time out).
    const waitMs = bestKey.availableAt - now;
    if (waitMs > 4_000) {
      throw new Error(`All Groq API keys are currently rate-limited (cooling down for ${Math.ceil(waitMs / 1000)}s). Falling back to adaptive personalization.`);
    }
    if (waitMs > 0) {
      if (onWait) onWait(Math.ceil(waitMs / 1000));
      await new Promise((r) => setTimeout(r, waitMs));
    }
    return bestKey.key;
  }

  markRateLimited(key: string, retryAfterSeconds: number) {
    const k = this.keys.find((x) => x.key === key);
    if (k) {
      // Add a small buffer of 2 seconds
      k.availableAt = Date.now() + (retryAfterSeconds + 2) * 1000;
      console.log(`Key pool [${this.poolName}]: key ...${key.slice(-4)} rate limited for ${retryAfterSeconds}s`);
    }
  }
}

const pools = new Map<KeyPoolName, RotatingKeyPool>();

export function getKeyPool(name: KeyPoolName): RotatingKeyPool {
  let pool = pools.get(name);
  if (!pool) {
    pool = new RotatingKeyPool(name);
    pools.set(name, pool);
  }
  return pool;
}

/** Backwards-compatible static facade over the research pool (used by the Research Agent). */
export class KeyPool {
  static getAvailableKey(onWait?: (seconds: number) => void): Promise<string> {
    return getKeyPool('research').getAvailableKey(onWait);
  }

  static markRateLimited(key: string, retryAfterSeconds: number) {
    getKeyPool('research').markRateLimited(key, retryAfterSeconds);
  }
}
