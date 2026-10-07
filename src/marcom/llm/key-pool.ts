export class KeyPool {
  private static keys: { key: string; availableAt: number }[] = [];

  static initialize() {
    if (this.keys.length > 0) return;
    const envKeys = [
      process.env.GROQ_RESEARCH_API_KEY_1,
      process.env.GROQ_RESEARCH_API_KEY_2,
      process.env.GROQ_RESEARCH_API_KEY,
      process.env.GROQ_API_KEY
    ].filter(Boolean) as string[];

    // Remove duplicates
    const uniqueKeys = [...new Set(envKeys)];
    this.keys = uniqueKeys.map(key => ({ key, availableAt: 0 }));
  }

  static async getAvailableKey(onWait?: (seconds: number) => void): Promise<string> {
    this.initialize();
    
    // Find the key that is available the soonest
    const now = Date.now();
    let bestKey = this.keys[0];
    for (const k of this.keys) {
      if (k.availableAt <= now) {
        return k.key; // immediately available
      }
      if (k.availableAt < bestKey.availableAt) {
        bestKey = k;
      }
    }

    // All keys are on cooldown. Wait for the best one.
    const waitMs = bestKey.availableAt - now;
    if (waitMs > 0) {
      if (onWait) onWait(Math.ceil(waitMs / 1000));
      await new Promise(r => setTimeout(r, waitMs));
    }
    return bestKey.key;
  }

  static markRateLimited(key: string, retryAfterSeconds: number) {
    const k = this.keys.find(x => x.key === key);
    if (k) {
      // Add a small buffer of 2 seconds
      k.availableAt = Date.now() + (retryAfterSeconds + 2) * 1000;
      console.log(`Key pool: marked key ending in ...${key.slice(-4)} as rate limited for ${retryAfterSeconds}s`);
    }
  }
}
