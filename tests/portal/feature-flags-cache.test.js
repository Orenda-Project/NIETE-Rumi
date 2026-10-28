'use strict';
/**
 * Feature-flag reads are cached in process. GET /api/portal/config asks 13 app_settings keys on every request, and
 * without a cache each one is a PostgREST GET: about half of all API traffic on prod. These tests run the real
 * helpers in lib/feature-flags.js with only the supabase client faked, and count the reads it makes.
 *
 *   - a burst of /config requests makes at most one read per key per TTL (30 s, FLAG_CACHE_TTL_MS)
 *   - after the TTL the next ask reads again, so a flag change shows within the TTL
 *   - a failed read answers OFF, but that OFF is held for at most 5 s, so a DB blip cannot pin a flag off
 *   - the cache holds the ROW, not the answer, so pilot lists and "teachers" still answer per user
 */
const flags = require('../../dashboard/lib/feature-flags');

const {
  isAssessmentGeneratorEnabled, isPortalAssessmentEditingEnabled, isFlagEnabledForUser, isLoginIntlNumbersEnabled,
  rmSectorFor, readUserListFlag,
} = flags;

/** A fake supabase client: `rows` maps app_settings.key -> value; `reads` counts reads per key. */
function fakeDb(rows, { fail = () => false, throws = () => false, users = {} } = {}) {
  const reads = {};
  const db = {
    reads,
    total: () => Object.values(reads).reduce((a, b) => a + b, 0),
    from(table) {
      let key;
      const chain = {
        select: () => chain,
        eq: (_col, val) => { key = val; return chain; },
        maybeSingle: async () => {
          await new Promise((r) => setImmediate(r));
          if (table === 'users') return { data: users[key] ? { role: users[key] } : null, error: null };
          reads[key] = (reads[key] || 0) + 1;
          if (throws(key)) throw new Error('socket hang up');
          if (fail(key)) return { data: null, error: { message: 'upstream timeout' } };
          return { data: Object.prototype.hasOwnProperty.call(rows, key) ? { value: rows[key] } : null, error: null };
        },
      };
      return chain;
    },
  };
  return db;
}

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

/** The 13 app_settings reads /api/portal/config makes for one user (dashboard/routes/portal.routes.js). */
function portalConfig(db, userId) {
  return Promise.all([
    isAssessmentGeneratorEnabled(db),
    isPortalAssessmentEditingEnabled(db),
    isFlagEnabledForUser(db, flags.PORTAL_SELF_OBSERVATION_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_CHILD_TEST_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_COACH_OBSERVATION_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_NEW_UI_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_COACH_V2_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_TEACHER_V2_KEY, userId),
    isFlagEnabledForUser(db, flags.COACH_DISAGREEMENT_CARD_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_CHILD_TEST_SA_KEY, userId),
    isFlagEnabledForUser(db, flags.PORTAL_TEACHER_HOME_CARD_KEY, userId),
    isLoginIntlNumbersEnabled(db),
    rmSectorFor(db, userId),
  ]);
}

const CONFIG_ROWS = {
  assessment_generator_enabled: true,
  portal_assessment_editing_enabled: 'true',
  portal_self_observation: [USER],
  portal_child_test: true,
  portal_coach_observation: false,
  portal_new_ui: [OTHER],
  portal_coach_v2: [USER],
  portal_teacher_v2: 'teachers',
  coach_disagreement_card: true,
  portal_child_test_sa: [USER],
  portal_teacher_home_card: true,
  portal_login_intl_numbers: false,
  portal_coachip_rm: {},
};

let now;
beforeEach(() => {
  now = 1_800_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  delete process.env.FLAG_CACHE_TTL_MS;
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.FLAG_CACHE_TTL_MS;
});

describe('feature-flag cache: a burst makes one read per key', () => {
  it('100 concurrent /config requests read each of the 13 keys at most once', async () => {
    const db = fakeDb(CONFIG_ROWS, { users: { [USER]: 'teacher' } });
    const answers = await Promise.all(Array.from({ length: 100 }, () => portalConfig(db, USER)));
    expect(db.total()).toBeLessThanOrEqual(13);
    for (const key of Object.keys(CONFIG_ROWS)) expect(db.reads[key]).toBe(1);
    // Every request still gets the uncached answer.
    const expected = [true, true, true, true, false, false, true, true, true, true, true, false, null];
    for (const a of answers) expect(a).toEqual(expected);
  });

  it('100 sequential /config requests inside the TTL read each key once', async () => {
    const db = fakeDb(CONFIG_ROWS, { users: { [USER]: 'teacher' } });
    for (let i = 0; i < 100; i++) {
      now += 250; // 100 requests over 25 s, all inside the 30 s TTL
      await portalConfig(db, USER);
    }
    expect(db.total()).toBe(13);
  });

  it('caches the row, not the answer: a pilot list still answers per user', async () => {
    const db = fakeDb({ portal_coach_v2: [USER] });
    expect(await isFlagEnabledForUser(db, 'portal_coach_v2', USER)).toBe(true);
    expect(await isFlagEnabledForUser(db, 'portal_coach_v2', OTHER)).toBe(false);
    expect(await readUserListFlag(db, 'portal_coach_v2')).toEqual([USER]);
    expect(db.reads.portal_coach_v2).toBe(1);
  });

  it('"teachers" still answers from each user\'s role', async () => {
    const db = fakeDb({ portal_teacher_v2: 'teachers' }, { users: { [USER]: 'teacher', [OTHER]: 'coach' } });
    expect(await isFlagEnabledForUser(db, 'portal_teacher_v2', USER)).toBe(true);
    expect(await isFlagEnabledForUser(db, 'portal_teacher_v2', OTHER)).toBe(false);
    expect(db.reads.portal_teacher_v2).toBe(1);
  });

  it('an absent row is cached too (it is the commonest answer: off)', async () => {
    const db = fakeDb({});
    for (let i = 0; i < 10; i++) expect(await isLoginIntlNumbersEnabled(db)).toBe(false);
    expect(db.reads.portal_login_intl_numbers).toBe(1);
  });

  it('two clients never share an entry', async () => {
    const a = fakeDb({ portal_new_ui: true });
    const b = fakeDb({ portal_new_ui: false });
    expect(await isFlagEnabledForUser(a, 'portal_new_ui', USER)).toBe(true);
    expect(await isFlagEnabledForUser(b, 'portal_new_ui', USER)).toBe(false);
  });
});

describe('feature-flag cache: expiry', () => {
  it('re-reads after 30 s, so a flag change shows within the TTL', async () => {
    const rows = { portal_new_ui: false };
    const db = fakeDb(rows);
    expect(await isFlagEnabledForUser(db, 'portal_new_ui', USER)).toBe(false);
    rows.portal_new_ui = true;
    now += 29_999;
    expect(await isFlagEnabledForUser(db, 'portal_new_ui', USER)).toBe(false);
    expect(db.reads.portal_new_ui).toBe(1);
    now += 2;
    expect(await isFlagEnabledForUser(db, 'portal_new_ui', USER)).toBe(true);
    expect(db.reads.portal_new_ui).toBe(2);
  });

  it('FLAG_CACHE_TTL_MS sets the TTL', async () => {
    process.env.FLAG_CACHE_TTL_MS = '1000';
    const db = fakeDb({ assessment_generator_enabled: true });
    await isAssessmentGeneratorEnabled(db);
    now += 999;
    await isAssessmentGeneratorEnabled(db);
    expect(db.reads.assessment_generator_enabled).toBe(1);
    now += 2;
    await isAssessmentGeneratorEnabled(db);
    expect(db.reads.assessment_generator_enabled).toBe(2);
  });

  it('FLAG_CACHE_TTL_MS=0 turns the cache off (every ask reads)', async () => {
    process.env.FLAG_CACHE_TTL_MS = '0';
    const db = fakeDb({ assessment_generator_enabled: true });
    for (let i = 0; i < 3; i++) await isAssessmentGeneratorEnabled(db);
    expect(db.reads.assessment_generator_enabled).toBe(3);
  });
});

describe('feature-flag cache: a failed read is a short negative cache', () => {
  it('an error answers OFF, is held at most 5 s, then the recovered row is read', async () => {
    let down = true;
    const db = fakeDb({ portal_teacher_v2: [USER] }, { fail: () => down });
    expect(await isFlagEnabledForUser(db, 'portal_teacher_v2', USER)).toBe(false);
    expect(await isFlagEnabledForUser(db, 'portal_teacher_v2', USER)).toBe(false);
    expect(db.reads.portal_teacher_v2).toBe(1); // a blip during a burst is still one read, not a stampede
    down = false;
    now += 5_001;
    expect(await isFlagEnabledForUser(db, 'portal_teacher_v2', USER)).toBe(true);
    expect(db.reads.portal_teacher_v2).toBe(2);
  });

  it('a thrown read is held at most 5 s too', async () => {
    let down = true;
    const db = fakeDb({ assessment_generator_enabled: true }, { throws: () => down });
    expect(await isAssessmentGeneratorEnabled(db)).toBe(false);
    down = false;
    now += 5_001;
    expect(await isAssessmentGeneratorEnabled(db)).toBe(true);
  });

  it('a failure is never held longer than a shorter configured TTL', async () => {
    process.env.FLAG_CACHE_TTL_MS = '1000';
    let down = true;
    const db = fakeDb({ assessment_generator_enabled: true }, { fail: () => down });
    expect(await isAssessmentGeneratorEnabled(db)).toBe(false);
    down = false;
    now += 1_001;
    expect(await isAssessmentGeneratorEnabled(db)).toBe(true);
  });

  it('strict callers and list readers still see a cached failure as a failure, not as OFF', async () => {
    const db = fakeDb({}, { fail: () => true });
    await expect(isFlagEnabledForUser(db, 'portal_teacher_v2', USER, { strict: true })).rejects.toThrow();
    await expect(isFlagEnabledForUser(db, 'portal_teacher_v2', USER, { strict: true })).rejects.toThrow();
    await expect(readUserListFlag(db, 'portal_teacher_v2')).rejects.toThrow(/app_settings read failed/);
    expect(db.reads.portal_teacher_v2).toBe(1);
  });

  it('portal_assessment_editing_enabled keeps its fallback: absent row follows assessment_editing_enabled', async () => {
    const db = fakeDb({ assessment_editing_enabled: true });
    expect(await isPortalAssessmentEditingEnabled(db)).toBe(true);
    expect(await isPortalAssessmentEditingEnabled(db)).toBe(true);
    expect(db.reads.portal_assessment_editing_enabled).toBe(1);
    expect(db.reads.assessment_editing_enabled).toBe(1);
  });
});
