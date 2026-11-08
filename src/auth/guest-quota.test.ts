import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import {
  GUEST_LIMITS,
  getGuestQuotaSnapshot,
  reserveGuestQuota,
  refundGuestQuota,
  resetInMemoryGuestQuotaForTests,
} from '@/db/repositories/guest-quota-repository';
import { createGuestToken, verifyGuestToken, resolveGuestIdentity } from '@/auth/guest';
import { authorizeApiRequest } from '@/auth/access';

const TEST_SECRET = 'test-auth-secret-with-at-least-32-bytes';

test('Guest token signing and verification rejects tampered tokens', () => {
  const identity = createGuestToken(TEST_SECRET, 'guest_1234567890abcdef');
  assert.equal(identity.guestId, 'guest_1234567890abcdef');
  assert.equal(verifyGuestToken(identity.token, TEST_SECRET)?.guestId, 'guest_1234567890abcdef');
  assert.equal(verifyGuestToken(`${identity.token}tampered`, TEST_SECRET), null);
  assert.equal(verifyGuestToken('invalid.token', TEST_SECRET), null);
});

test('Guest research limits enforce 5/day and 15/month simultaneously and reset on new UTC day/month', async () => {
  resetInMemoryGuestQuotaForTests();
  const guestIdHash = 'guest_research_limit_test_hash_00000000000000000000000000000000';
  const day1 = new Date('2026-11-08T10:00:00.000Z');

  // Initial snapshot has full quota (5 daily, 15 monthly)
  const initial = await getGuestQuotaSnapshot(guestIdHash, day1);
  assert.equal(initial.research.dailyLimit, GUEST_LIMITS.research.daily);
  assert.equal(initial.research.monthlyLimit, GUEST_LIMITS.research.monthly);
  assert.equal(initial.research.dailyRemaining, 5);
  assert.equal(initial.research.monthlyRemaining, 15);
  assert.equal(initial.research.effectiveRemaining, 5);

  // Reserve 5 research leads on Day 1
  const res1 = await reserveGuestQuota(guestIdHash, 'research', 5, day1);
  assert.equal(res1.allowed, true);
  if (res1.allowed) {
    assert.equal(res1.reserved, 5);
  }
  assert.equal(res1.snapshot.research.dailyUsed, 5);
  assert.equal(res1.snapshot.research.dailyRemaining, 0);
  assert.equal(res1.snapshot.research.monthlyUsed, 5);
  assert.equal(res1.snapshot.research.monthlyRemaining, 10);
  assert.equal(res1.snapshot.research.isExhausted, true);

  // 6th lead on Day 1 is blocked by daily limit
  const blockedDaily = await reserveGuestQuota(guestIdHash, 'research', 1, day1);
  assert.equal(blockedDaily.allowed, false);
  if (!blockedDaily.allowed) {
    assert.equal(blockedDaily.limitScope, 'daily');
  }

  // Next day (Day 2 in same month): daily counter resets to 0, monthly stays at 5
  const day2 = new Date('2026-11-09T09:00:00.000Z');
  const day2Snap = await getGuestQuotaSnapshot(guestIdHash, day2);
  assert.equal(day2Snap.research.dailyUsed, 0);
  assert.equal(day2Snap.research.dailyRemaining, 5);
  assert.equal(day2Snap.research.monthlyUsed, 5);
  assert.equal(day2Snap.research.monthlyRemaining, 10);

  // Reserve 5 on Day 2 and 5 on Day 3 -> reaches 15 monthly limit
  await reserveGuestQuota(guestIdHash, 'research', 5, day2);
  const day3 = new Date('2026-11-10T09:00:00.000Z');
  const res3 = await reserveGuestQuota(guestIdHash, 'research', 5, day3);
  assert.equal(res3.allowed, true);
  assert.equal(res3.snapshot.research.monthlyUsed, 15);
  assert.equal(res3.snapshot.research.monthlyRemaining, 0);

  // Day 4 in same month: daily has 0 used, but monthly is 15/15 -> blocked by monthly limit!
  const day4 = new Date('2026-11-11T09:00:00.000Z');
  const blockedMonthly = await reserveGuestQuota(guestIdHash, 'research', 1, day4);
  assert.equal(blockedMonthly.allowed, false);
  if (!blockedMonthly.allowed) {
    assert.equal(blockedMonthly.limitScope, 'monthly');
  }

  // Next calendar month (2026-12-01): both daily and monthly counters reset!
  const nextMonth = new Date('2026-12-01T00:05:00.000Z');
  const nextMonthSnap = await getGuestQuotaSnapshot(guestIdHash, nextMonth);
  assert.equal(nextMonthSnap.research.dailyUsed, 0);
  assert.equal(nextMonthSnap.research.monthlyUsed, 0);
  assert.equal(nextMonthSnap.research.effectiveRemaining, 5);
});

test('Guest personalisation limits enforce 2/day and 5/month simultaneously', async () => {
  resetInMemoryGuestQuotaForTests();
  const guestIdHash = 'guest_personalization_limit_test_hash_000000000000000000000000';
  const day1 = new Date('2026-11-08T12:00:00.000Z');

  // Reserve 2 personalisations on Day 1
  const res1 = await reserveGuestQuota(guestIdHash, 'personalization', 2, day1);
  assert.equal(res1.allowed, true);
  if (res1.allowed) {
    assert.equal(res1.reserved, 2);
  }
  assert.equal(res1.snapshot.personalization.dailyUsed, 2);
  assert.equal(res1.snapshot.personalization.dailyRemaining, 0);
  assert.equal(res1.snapshot.personalization.monthlyUsed, 2);
  assert.equal(res1.snapshot.personalization.monthlyRemaining, 3);

  // 3rd personalisation on Day 1 is blocked by daily limit
  const blockedDaily = await reserveGuestQuota(guestIdHash, 'personalization', 1, day1);
  assert.equal(blockedDaily.allowed, false);
  if (!blockedDaily.allowed) {
    assert.equal(blockedDaily.limitScope, 'daily');
  }

  // Day 2: reserve 2 more (monthly = 4/5)
  const day2 = new Date('2026-11-09T12:00:00.000Z');
  await reserveGuestQuota(guestIdHash, 'personalization', 2, day2);

  // Day 3: daily limit is 2, but monthly remaining is 1 -> requesting 2 is rejected by monthly limit, requesting 1 succeeds
  const day3 = new Date('2026-11-10T12:00:00.000Z');
  const tooManyForMonth = await reserveGuestQuota(guestIdHash, 'personalization', 2, day3);
  assert.equal(tooManyForMonth.allowed, false);
  if (!tooManyForMonth.allowed) {
    assert.equal(tooManyForMonth.limitScope, 'monthly');
  }

  const res3 = await reserveGuestQuota(guestIdHash, 'personalization', 1, day3);
  assert.equal(res3.allowed, true);
  assert.equal(res3.snapshot.personalization.monthlyUsed, 5);
  assert.equal(res3.snapshot.personalization.monthlyRemaining, 0);

  // Further personalisation in November is blocked by monthly limit
  const blockedMonthly = await reserveGuestQuota(guestIdHash, 'personalization', 1, day3);
  assert.equal(blockedMonthly.allowed, false);
  if (!blockedMonthly.allowed) {
    assert.equal(blockedMonthly.limitScope, 'monthly');
  }

  // Refunding 1 restores 1 credit
  const afterRefund = await refundGuestQuota(guestIdHash, 'personalization', 1, day3);
  assert.equal(afterRefund.personalization.monthlyUsed, 4);
  assert.equal(afterRefund.personalization.monthlyRemaining, 1);
});

test('Guest mode never grants access to internal team project APIs', async () => {
  const req = new NextRequest('https://pilot.example.test/api/projects', {
    headers: {
      'x-marcom-client-mode': 'guest',
    },
  });
  const access = await authorizeApiRequest(req);
  assert.equal(access.ok, false);
  if (!access.ok) {
    assert.equal(access.response.status, 401);
  }
});

test('Cookie-less direct API mutation requests map to a deterministic fingerprint so quotas cannot be bypassed by omitting cookies', () => {
  const req1 = new NextRequest('https://pilot.example.test/api/v1/guest/research', {
    method: 'POST',
    headers: {
      'user-agent': 'curl/8.5.0',
      'x-forwarded-for': '203.0.113.42',
    },
  });
  const req2 = new NextRequest('https://pilot.example.test/api/v1/guest/research', {
    method: 'POST',
    headers: {
      'user-agent': 'curl/8.5.0',
      'x-forwarded-for': '203.0.113.42',
    },
  });
  const id1 = resolveGuestIdentity(req1, TEST_SECRET, true);
  const id2 = resolveGuestIdentity(req2, TEST_SECRET, true);
  assert.equal(id1.guestId, id2.guestId);
  assert.equal(id1.guestIdHash, id2.guestIdHash);
  assert.equal(id1.source, 'request_fingerprint');
});
