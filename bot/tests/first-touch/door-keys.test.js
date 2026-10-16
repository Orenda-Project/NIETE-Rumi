'use strict';
/**
 * door.keys.js — the ONE writer of the first-touch door's keys in `user_feature_first_use`
 * (quiz_door_teacher, quiz_door_child, quiz_door_asked, quiz_tour), through FeatureIntroService, in the order
 * upsert (markVideoShown) → update (markFeatureUsed): markFeatureUsed is an UPDATE that writes 0 rows when no row
 * exists, so the row is created first. Every door write ends in forgetDoorVerdict(raw, norm), both phone forms.
 * Nothing here touches the users row. Red-first per key: no row → the writer → the row exists with feature_used_at.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true), setNX: jest.fn(async () => true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true) }));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const StudentIdentity = require('../../shared/services/quiz/student-identity.service');
const { CACHE_KEY } = require('../../shared/services/student-ingress-cache');
const Keys = require('../../shared/services/first-touch/door.keys');
const { TABLE, UNKNOWN_USER, PHONE, PHONE_PLUS, seedDb, firstUse, firstUseReads, writes, daysAgo } = require('./door-fixture');

const UID = UNKNOWN_USER.id;
let fake;
beforeEach(() => { jest.clearAllMocks(); fake = seedDb(supabase); });
afterEach(() => jest.restoreAllMocks());

const row = (feature) => fake.db[TABLE].find((r) => r.user_id === UID && r.feature === feature);

describe('the names', () => {
  test('the four keys and the table are SPEC v2 §3\'s, and this module is the only one that names them', () => {
    expect(Keys.TABLE).toBe('user_feature_first_use');
    expect(Keys.KEYS).toEqual({ TEACHER: 'quiz_door_teacher', CHILD: 'quiz_door_child', ASKED: 'quiz_door_asked', TOUR: 'quiz_tour' });
    expect(Keys.DOOR_KEYS).toEqual(['quiz_door_teacher', 'quiz_door_child', 'quiz_door_asked']);
    expect(Keys.KEY_TTL_DAYS).toBe(90);
  });
});

describe('readDoorKeys — ONE indexed read of the three door rows', () => {
  test('returns the rows this user holds, keyed by feature, with count and usedAt; other users and the tour row are not read', async () => {
    const twoDaysAgo = daysAgo(2);
    fake = seedDb(supabase, { rows: [
      firstUse('quiz_door_teacher', { usedAt: twoDaysAgo, count: 0 }),
      firstUse('quiz_door_asked', { usedAt: daysAgo(3), count: 1 }),
      firstUse('quiz_tour', { usedAt: daysAgo(1) }),
      firstUse('quiz_door_child', { userId: 'u-other', usedAt: daysAgo(1) }),
    ] });
    const keys = await Keys.readDoorKeys(UID);
    expect(Object.keys(keys).sort()).toEqual(['quiz_door_asked', 'quiz_door_teacher']);
    expect(keys.quiz_door_teacher).toEqual({ count: 0, usedAt: new Date(twoDaysAgo) });
    expect(keys.quiz_door_asked.count).toBe(1);
    expect(firstUseReads(fake)).toBe(1);
    expect(fake.inLists).toEqual([{ table: TABLE, column: 'feature', values: Keys.DOOR_KEYS }]);
  });

  test('no rows → {} after exactly one read', async () => {
    expect(await Keys.readDoorKeys(UID)).toEqual({});
    expect(firstUseReads(fake)).toBe(1);
  });

  test('a read error THROWS (the caller fails towards today\'s path; nothing here guesses "no key")', async () => {
    fake = seedDb(supabase, { throwOn: TABLE });
    await expect(Keys.readDoorKeys(UID)).rejects.toThrow(/down/);
  });
});

describe.each([
  ['markTeacher', 'quiz_door_teacher'],
  ['markChild', 'quiz_door_child'],
])('%s → %s', (fn, feature) => {
  test('no row → the writer → the row exists with feature_used_at set; upsert BEFORE update; forgetDoorVerdict(raw, norm)', async () => {
    const forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
    expect(row(feature)).toBeUndefined();
    await Keys[fn](UID, PHONE_PLUS);
    expect(row(feature)).toMatchObject({ user_id: UID, feature, feature_used_at: expect.any(String), video_shown_at: expect.any(String) });
    expect(writes(fake)).toEqual([`upsert:${TABLE}`, `update:${TABLE}`]);
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(PHONE_PLUS, PHONE);          // raw, then the normalised form
    expect(redisService.delete).toHaveBeenCalledWith(CACHE_KEY(PHONE));
  });

  test('a second write refreshes feature_used_at on the SAME row (UNIQUE user_id × feature), never a second row', async () => {
    fake = seedDb(supabase, { rows: [firstUse(feature, { usedAt: daysAgo(5) })] });
    await Keys[fn](UID, PHONE);
    const rows = fake.db[TABLE].filter((r) => r.feature === feature);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].feature_used_at).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  test('the users row is byte-identical and the only table written is user_feature_first_use', async () => {
    const before = JSON.stringify(fake.db.users);
    await Keys[fn](UID, PHONE);
    expect(JSON.stringify(fake.db.users)).toBe(before);
    expect(new Set(writes(fake).map((w) => w.split(':')[1]))).toEqual(new Set([TABLE]));
  });
});

describe('markAsked — the chooser SHOW', () => {
  test('increment:true → intro_shown_count +1 (0 → 1 → 2), feature_used_at set, forget called each time', async () => {
    const forget = jest.spyOn(StudentIdentity, 'forgetDoorVerdict');
    await Keys.markAsked(UID, PHONE, { increment: true });
    expect(row('quiz_door_asked')).toMatchObject({ intro_shown_count: 1, feature_used_at: expect.any(String) });
    await Keys.markAsked(UID, PHONE, { increment: true });
    expect(row('quiz_door_asked').intro_shown_count).toBe(2);
    expect(forget).toHaveBeenCalledTimes(2);
  });

  test('increment:false → the count stays, feature_used_at is refreshed (the same-PKT-day re-send, +0)', async () => {
    fake = seedDb(supabase, { rows: [firstUse('quiz_door_asked', { usedAt: daysAgo(0.1), count: 1 })] });
    await Keys.markAsked(UID, PHONE, { increment: false });
    expect(row('quiz_door_asked').intro_shown_count).toBe(1);
    expect(firstUseReads(fake)).toBe(0);     // no count read when not incrementing
  });
});

describe('the tour key (TOUR.md §2.4; written by TOUR\'s route through this module)', () => {
  test('markTourShown → the row with video_shown_at and intro_shown_count 1; markTourDismissed → feature_used_at (row created if absent)', async () => {
    await Keys.markTourShown(UID);
    expect(row('quiz_tour')).toMatchObject({ video_shown_at: expect.any(String), intro_shown_count: 1 });
    expect(row('quiz_tour').feature_used_at).toBeNull();
    await Keys.markTourDismissed(UID);
    expect(row('quiz_tour').feature_used_at).toEqual(expect.any(String));
    fake = seedDb(supabase);
    await Keys.markTourDismissed(UID);
    expect(row('quiz_tour')).toMatchObject({ feature_used_at: expect.any(String) });
    expect(writes(fake)).toEqual([`upsert:${TABLE}`, `update:${TABLE}`]);
  });

  test('tourSeen: false with no row, true once shown or dismissed, true on a read error (no banner when unsure)', async () => {
    expect(await Keys.tourSeen(UID)).toBe(false);
    await Keys.markTourShown(UID);
    expect(await Keys.tourSeen(UID)).toBe(true);
    fake = seedDb(supabase, { throwOn: TABLE });
    expect(await Keys.tourSeen(UID)).toBe(true);
  });
});
