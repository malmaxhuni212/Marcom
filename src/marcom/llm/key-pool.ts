export class KeyPool {
  private static keys: { key: string; availableAt: number }[] = [];

  static initialize() {
    if (this.keys.length > 0) return;
    const envKeys = [
      process.env.GROQ_RESEARCH_API_KEY_1,
      process.env.GROQ_RESEARCH_API_KEY_2,
      process.env.GROQ_RESEARCH_API_KEY
    ].filter(Boolean) as string[];

    // Remove duplicates
    const uniqueKeys = [...new Set(envKeys)];
    this.keys = uniqueKeys.map(key => ({ key, availableAt: 0 }));
  }

  private static cursor = 0;

  static async getAvailableKey(onWait?: (seconds: number) => void): Promise<string> {
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
