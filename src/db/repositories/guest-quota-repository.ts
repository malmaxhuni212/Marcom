import fs from 'fs';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { getDatabase, type MarcomDatabase } from '@/db/client';
import { isDatabaseConfigured, markDatabaseTemporarilyUnavailable } from '@/db/env';
import { guestUsageQuotas } from '@/db/schema';

export const GUEST_LIMITS = {
  research: {
    daily: 5,
    monthly: 15,
  },
  personalization: {
    daily: 2,
    monthly: 5,
  },
} as const;

export type GuestQuotaFeature = keyof typeof GUEST_LIMITS;

export type GuestFeatureQuotaStatus = {
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  monthlyLimit: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  effectiveRemaining: number;
  isDailyExhausted: boolean;
  isMonthlyExhausted: boolean;
  isExhausted: boolean;
  exhaustedReason: string | null;
  limitMessage: string | null;
};

export type GuestQuotaSnapshot = {
  dayBucket: string;
  monthBucket: string;
  nextDayResetAt: string;
  nextMonthResetAt: string;
  research: GuestFeatureQuotaStatus;
  personalization: GuestFeatureQuotaStatus;
};

export type GuestQuotaReservationResult =
  | {
      allowed: true;
      reserved: number;
      snapshot: GuestQuotaSnapshot;
    }
  | {
      allowed: false;
      reason: string;
      limitScope: 'daily' | 'monthly';
      snapshot: GuestQuotaSnapshot;
    };

type StoredGuestQuotaRecord = {
  guestIdHash: string;
  dayBucket: string;
  monthBucket: string;
  researchDayCount: number;
  researchMonthCount: number;
  personalizationDayCount: number;
  personalizationMonthCount: number;
  updatedAt: string;
};

type GuestQuotaGlobal = typeof globalThis & {
  __marcomGuestQuotaTableReady?: boolean;
  __marcomGuestQuotaMemoryStore?: Map<string, StoredGuestQuotaRecord>;
};

const quotaGlobal = globalThis as GuestQuotaGlobal;
const FALLBACK_QUOTA_FILE = path.join(process.cwd(), 'memory', 'guest-quotas.json');

function getMemoryStore(): Map<string, StoredGuestQuotaRecord> {
  if (!quotaGlobal.__marcomGuestQuotaMemoryStore) {
    quotaGlobal.__marcomGuestQuotaMemoryStore = new Map<string, StoredGuestQuotaRecord>();
    try {
      if (fs.existsSync(FALLBACK_QUOTA_FILE)) {
        const raw = fs.readFileSync(FALLBACK_QUOTA_FILE, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, StoredGuestQuotaRecord>;
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value.guestIdHash === 'string') {
            quotaGlobal.__marcomGuestQuotaMemoryStore.set(key, value);
          }
        }
      }
    } catch {
      // Ignore corrupt or missing local fallback file
    }
  }
  return quotaGlobal.__marcomGuestQuotaMemoryStore;
}

function persistMemoryStoreToDisk(): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    const store = getMemoryStore();
    const dir = path.dirname(FALLBACK_QUOTA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized: Record<string, StoredGuestQuotaRecord> = {};
    for (const [key, value] of store.entries()) {
      serialized[key] = value;
    }
    fs.writeFileSync(FALLBACK_QUOTA_FILE, JSON.stringify(serialized, null, 2), 'utf8');
  } catch {
    // Non-fatal in read-only serverless filesystems when DB is primary
  }
}

export function resetInMemoryGuestQuotaForTests(): void {
  quotaGlobal.__marcomGuestQuotaMemoryStore = new Map<string, StoredGuestQuotaRecord>();
}

export function getGuestUtcBuckets(now: Date = new Date()): {
  dayBucket: string;
  monthBucket: string;
  nextDayResetAt: string;
  nextMonthResetAt: string;
} {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const day = now.getUTCDate();

  const monthStr = String(monthIndex + 1).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');

  const dayBucket = `${year}-${monthStr}-${dayStr}`;
  const monthBucket = `${year}-${monthStr}`;

  const nextDay = new Date(Date.UTC(year, monthIndex, day + 1, 0, 0, 0, 0));
  const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));

  return {
    dayBucket,
    monthBucket,
    nextDayResetAt: nextDay.toISOString(),
    nextMonthResetAt: nextMonth.toISOString(),
  };
}

function normalizeCountsForBuckets(
  record: {
    dayBucket: string;
    monthBucket: string;
    researchDayCount: number;
    researchMonthCount: number;
    personalizationDayCount: number;
    personalizationMonthCount: number;
  } | null,
  currentDayBucket: string,
  currentMonthBucket: string,
): {
  dayBucket: string;
  monthBucket: string;
  researchDayCount: number;
  researchMonthCount: number;
  personalizationDayCount: number;
  personalizationMonthCount: number;
} {
  if (!record) {
    return {
      dayBucket: currentDayBucket,
      monthBucket: currentMonthBucket,
      researchDayCount: 0,
      researchMonthCount: 0,
      personalizationDayCount: 0,
      personalizationMonthCount: 0,
    };
  }

  const sameMonth = record.monthBucket === currentMonthBucket;
  const sameDay = sameMonth && record.dayBucket === currentDayBucket;

  return {
    dayBucket: currentDayBucket,
    monthBucket: currentMonthBucket,
    researchDayCount: sameDay ? Math.max(0, record.researchDayCount) : 0,
    researchMonthCount: sameMonth ? Math.max(0, record.researchMonthCount) : 0,
    personalizationDayCount: sameDay ? Math.max(0, record.personalizationDayCount) : 0,
    personalizationMonthCount: sameMonth ? Math.max(0, record.personalizationMonthCount) : 0,
  };
}

function buildFeatureStatus(
  feature: GuestQuotaFeature,
  dailyUsed: number,
  monthlyUsed: number,
): GuestFeatureQuotaStatus {
  const limits = GUEST_LIMITS[feature];
  const label = feature === 'research' ? 'lead research' : 'lead personalisation';
  const clampedDailyUsed = Math.min(limits.daily, Math.max(0, dailyUsed));
  const clampedMonthlyUsed = Math.min(limits.monthly, Math.max(0, monthlyUsed));

  const dailyRemaining = Math.max(0, limits.daily - clampedDailyUsed);
  const monthlyRemaining = Math.max(0, limits.monthly - clampedMonthlyUsed);
  const effectiveRemaining = Math.min(dailyRemaining, monthlyRemaining);

  const isDailyExhausted = dailyRemaining === 0;
  const isMonthlyExhausted = monthlyRemaining === 0;
  const isExhausted = isDailyExhausted || isMonthlyExhausted;

  let exhaustedReason: string | null = null;
  if (isMonthlyExhausted) {
    exhaustedReason = `Monthly guest ${label} limit reached (${limits.monthly}/${limits.monthly} leads used this month). Resets at the start of next month.`;
  } else if (isDailyExhausted) {
    exhaustedReason = `Daily guest ${label} limit reached (${limits.daily}/${limits.daily} leads used today). Resets tomorrow at 00:00 UTC.`;
  }

  return {
    dailyLimit: limits.daily,
    dailyUsed: clampedDailyUsed,
    dailyRemaining,
    monthlyLimit: limits.monthly,
    monthlyUsed: clampedMonthlyUsed,
    monthlyRemaining,
    effectiveRemaining,
    isDailyExhausted,
    isMonthlyExhausted,
    isExhausted,
    exhaustedReason,
    limitMessage: exhaustedReason,
  };
}

function toSnapshot(
  normalized: {
    dayBucket: string;
    monthBucket: string;
    researchDayCount: number;
    researchMonthCount: number;
    personalizationDayCount: number;
    personalizationMonthCount: number;
  },
  buckets: {
    dayBucket: string;
    monthBucket: string;
    nextDayResetAt: string;
    nextMonthResetAt: string;
  },
): GuestQuotaSnapshot {
  return {
    dayBucket: buckets.dayBucket,
    monthBucket: buckets.monthBucket,
    nextDayResetAt: buckets.nextDayResetAt,
    nextMonthResetAt: buckets.nextMonthResetAt,
    research: buildFeatureStatus(
      'research',
      normalized.researchDayCount,
      normalized.researchMonthCount,
    ),
    personalization: buildFeatureStatus(
      'personalization',
      normalized.personalizationDayCount,
      normalized.personalizationMonthCount,
    ),
  };
}

async function ensureGuestQuotaTable(database: MarcomDatabase): Promise<void> {
  if (quotaGlobal.__marcomGuestQuotaTableReady) return;
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS "guest_usage_quotas" (
      "guest_id_hash" char(64) PRIMARY KEY NOT NULL,
      "day_bucket" char(10) NOT NULL,
      "month_bucket" char(7) NOT NULL,
      "research_day_count" integer DEFAULT 0 NOT NULL,
      "research_month_count" integer DEFAULT 0 NOT NULL,
      "personalization_day_count" integer DEFAULT 0 NOT NULL,
      "personalization_month_count" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "guest_usage_quotas_counts_bounds_check" CHECK (
        "guest_usage_quotas"."research_day_count" >= 0
        and "guest_usage_quotas"."research_day_count" <= 5
        and "guest_usage_quotas"."research_month_count" >= 0
        and "guest_usage_quotas"."research_month_count" <= 15
        and "guest_usage_quotas"."personalization_day_count" >= 0
        and "guest_usage_quotas"."personalization_day_count" <= 2
        and "guest_usage_quotas"."personalization_month_count" >= 0
        and "guest_usage_quotas"."personalization_month_count" <= 5
      )
    );
  `);
  quotaGlobal.__marcomGuestQuotaTableReady = true;
}

export async function getGuestQuotaSnapshot(
  guestIdHash: string,
  now: Date = new Date(),
  database?: MarcomDatabase,
): Promise<GuestQuotaSnapshot> {
  const buckets = getGuestUtcBuckets(now);

  if (database || isDatabaseConfigured()) {
    try {
      const db = database ?? getDatabase();
      await ensureGuestQuotaTable(db);
      const [row] = await db
        .select()
        .from(guestUsageQuotas)
        .where(eq(guestUsageQuotas.guestIdHash, guestIdHash))
        .limit(1);

      const normalized = normalizeCountsForBuckets(
        row ?? null,
        buckets.dayBucket,
        buckets.monthBucket,
      );
      return toSnapshot(normalized, buckets);
    } catch (error) {
      console.warn('[guest-quota] Database unavailable, falling back to local server store:', error);
      markDatabaseTemporarilyUnavailable();
    }
  }

  const store = getMemoryStore();
  const existing = store.get(guestIdHash) ?? null;
  const normalized = normalizeCountsForBuckets(
    existing,
    buckets.dayBucket,
    buckets.monthBucket,
  );
  return toSnapshot(normalized, buckets);
}

function evaluateReservation(
  normalized: {
    dayBucket: string;
    monthBucket: string;
    researchDayCount: number;
    researchMonthCount: number;
    personalizationDayCount: number;
    personalizationMonthCount: number;
  },
  buckets: {
    dayBucket: string;
    monthBucket: string;
    nextDayResetAt: string;
    nextMonthResetAt: string;
  },
  feature: GuestQuotaFeature,
  requestedAmount: number,
): {
  allowed: boolean;
  limitScope?: 'daily' | 'monthly';
  reason?: string;
  nextCounts: typeof normalized;
} {
  const amount = Math.max(1, Math.floor(requestedAmount));
  const limits = GUEST_LIMITS[feature];
  const label = feature === 'research' ? 'lead research' : 'lead personalisation';

  const currentDay =
    feature === 'research'
      ? normalized.researchDayCount
      : normalized.personalizationDayCount;
  const currentMonth =
    feature === 'research'
      ? normalized.researchMonthCount
      : normalized.personalizationMonthCount;

  const dailyRemaining = Math.max(0, limits.daily - currentDay);
  const monthlyRemaining = Math.max(0, limits.monthly - currentMonth);

  if (monthlyRemaining === 0) {
    return {
      allowed: false,
      limitScope: 'monthly',
      reason: `Monthly guest ${label} limit reached (${limits.monthly}/${limits.monthly} leads used this month). Resets at the beginning of next month.`,
      nextCounts: normalized,
    };
  }

  if (dailyRemaining === 0) {
    return {
      allowed: false,
      limitScope: 'daily',
      reason: `Daily guest ${label} limit reached (${limits.daily}/${limits.daily} leads used today). Resets tomorrow at 00:00 UTC.`,
      nextCounts: normalized,
    };
  }

  if (amount > monthlyRemaining) {
    return {
      allowed: false,
      limitScope: 'monthly',
      reason: `Requested ${amount} ${label} lead${amount === 1 ? '' : 's'}, but only ${monthlyRemaining} monthly credit${monthlyRemaining === 1 ? '' : 's'} remain (${currentMonth}/${limits.monthly} used this month).`,
      nextCounts: normalized,
    };
  }

  if (amount > dailyRemaining) {
    return {
      allowed: false,
      limitScope: 'daily',
      reason: `Requested ${amount} ${label} lead${amount === 1 ? '' : 's'}, but only ${dailyRemaining} daily credit${dailyRemaining === 1 ? '' : 's'} remain (${currentDay}/${limits.daily} used today).`,
      nextCounts: normalized,
    };
  }

  const nextCounts = {
    ...normalized,
    researchDayCount:
      feature === 'research' ? currentDay + amount : normalized.researchDayCount,
    researchMonthCount:
      feature === 'research' ? currentMonth + amount : normalized.researchMonthCount,
    personalizationDayCount:
      feature === 'personalization'
        ? currentDay + amount
        : normalized.personalizationDayCount,
    personalizationMonthCount:
      feature === 'personalization'
        ? currentMonth + amount
        : normalized.personalizationMonthCount,
  };

  return {
    allowed: true,
    nextCounts,
  };
}

export async function reserveGuestQuota(
  guestIdHash: string,
  feature: GuestQuotaFeature,
  requestedAmount: number,
  now: Date = new Date(),
  database?: MarcomDatabase,
): Promise<GuestQuotaReservationResult> {
  const amount = Math.max(1, Math.floor(requestedAmount));
  const buckets = getGuestUtcBuckets(now);

  if (database || isDatabaseConfigured()) {
    try {
      const db = database ?? getDatabase();
      await ensureGuestQuotaTable(db);

      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(guestUsageQuotas)
          .where(eq(guestUsageQuotas.guestIdHash, guestIdHash))
          .limit(1);

        const normalized = normalizeCountsForBuckets(
          existing ?? null,
          buckets.dayBucket,
          buckets.monthBucket,
        );

        const decision = evaluateReservation(normalized, buckets, feature, amount);
        if (!decision.allowed) {
          return {
            allowed: false,
            reason: decision.reason!,
            limitScope: decision.limitScope!,
            snapshot: toSnapshot(normalized, buckets),
          };
        }

        const next = decision.nextCounts;
        await tx
          .insert(guestUsageQuotas)
          .values({
            guestIdHash,
            dayBucket: next.dayBucket,
            monthBucket: next.monthBucket,
            researchDayCount: next.researchDayCount,
            researchMonthCount: next.researchMonthCount,
            personalizationDayCount: next.personalizationDayCount,
            personalizationMonthCount: next.personalizationMonthCount,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: guestUsageQuotas.guestIdHash,
            set: {
              dayBucket: next.dayBucket,
              monthBucket: next.monthBucket,
              researchDayCount: next.researchDayCount,
              researchMonthCount: next.researchMonthCount,
              personalizationDayCount: next.personalizationDayCount,
              personalizationMonthCount: next.personalizationMonthCount,
              updatedAt: now,
            },
          });

        return {
          allowed: true,
          reserved: amount,
          snapshot: toSnapshot(next, buckets),
        };
      });
    } catch (error) {
      console.warn('[guest-quota] Database transaction failed, falling back to local server store:', error);
      markDatabaseTemporarilyUnavailable();
    }
  }

  const store = getMemoryStore();
  const existing = store.get(guestIdHash) ?? null;
  const normalized = normalizeCountsForBuckets(
    existing,
    buckets.dayBucket,
    buckets.monthBucket,
  );
  const decision = evaluateReservation(normalized, buckets, feature, amount);

  if (!decision.allowed) {
    return {
      allowed: false,
      reason: decision.reason!,
      limitScope: decision.limitScope!,
      snapshot: toSnapshot(normalized, buckets),
    };
  }

  const next = decision.nextCounts;
  store.set(guestIdHash, {
    guestIdHash,
    ...next,
    updatedAt: now.toISOString(),
  });
  persistMemoryStoreToDisk();

  return {
    allowed: true,
    reserved: amount,
    snapshot: toSnapshot(next, buckets),
  };
}

export async function refundGuestQuota(
  guestIdHash: string,
  feature: GuestQuotaFeature,
  refundAmount: number,
  now: Date = new Date(),
  database?: MarcomDatabase,
): Promise<GuestQuotaSnapshot> {
  const amount = Math.max(0, Math.floor(refundAmount));
  if (amount === 0) {
    return getGuestQuotaSnapshot(guestIdHash, now, database);
  }

  const buckets = getGuestUtcBuckets(now);

  if (database || isDatabaseConfigured()) {
    try {
      const db = database ?? getDatabase();
      await ensureGuestQuotaTable(db);

      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(guestUsageQuotas)
          .where(eq(guestUsageQuotas.guestIdHash, guestIdHash))
          .limit(1);

        const normalized = normalizeCountsForBuckets(
          existing ?? null,
          buckets.dayBucket,
          buckets.monthBucket,
        );

        const next = {
          ...normalized,
          researchDayCount:
            feature === 'research'
              ? Math.max(0, normalized.researchDayCount - amount)
              : normalized.researchDayCount,
          researchMonthCount:
            feature === 'research'
              ? Math.max(0, normalized.researchMonthCount - amount)
              : normalized.researchMonthCount,
          personalizationDayCount:
            feature === 'personalization'
              ? Math.max(0, normalized.personalizationDayCount - amount)
              : normalized.personalizationDayCount,
          personalizationMonthCount:
            feature === 'personalization'
              ? Math.max(0, normalized.personalizationMonthCount - amount)
              : normalized.personalizationMonthCount,
        };

        await tx
          .insert(guestUsageQuotas)
          .values({
            guestIdHash,
            dayBucket: next.dayBucket,
            monthBucket: next.monthBucket,
            researchDayCount: next.researchDayCount,
            researchMonthCount: next.researchMonthCount,
            personalizationDayCount: next.personalizationDayCount,
            personalizationMonthCount: next.personalizationMonthCount,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: guestUsageQuotas.guestIdHash,
            set: {
              dayBucket: next.dayBucket,
              monthBucket: next.monthBucket,
              researchDayCount: next.researchDayCount,
              researchMonthCount: next.researchMonthCount,
              personalizationDayCount: next.personalizationDayCount,
              personalizationMonthCount: next.personalizationMonthCount,
              updatedAt: now,
            },
          });

        return toSnapshot(next, buckets);
      });
    } catch (error) {
      console.warn('[guest-quota] Refund fallback to local store:', error);
      markDatabaseTemporarilyUnavailable();
    }
  }

  const store = getMemoryStore();
  const existing = store.get(guestIdHash) ?? null;
  const normalized = normalizeCountsForBuckets(
    existing,
    buckets.dayBucket,
    buckets.monthBucket,
  );
  const next = {
    ...normalized,
    researchDayCount:
      feature === 'research'
        ? Math.max(0, normalized.researchDayCount - amount)
        : normalized.researchDayCount,
    researchMonthCount:
      feature === 'research'
        ? Math.max(0, normalized.researchMonthCount - amount)
        : normalized.researchMonthCount,
    personalizationDayCount:
      feature === 'personalization'
        ? Math.max(0, normalized.personalizationDayCount - amount)
        : normalized.personalizationDayCount,
    personalizationMonthCount:
      feature === 'personalization'
        ? Math.max(0, normalized.personalizationMonthCount - amount)
        : normalized.personalizationMonthCount,
  };
  store.set(guestIdHash, {
    guestIdHash,
    ...next,
    updatedAt: now.toISOString(),
  });
  persistMemoryStoreToDisk();

  return toSnapshot(next, buckets);
}
