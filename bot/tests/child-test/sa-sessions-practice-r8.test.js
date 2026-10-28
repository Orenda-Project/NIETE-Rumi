'use strict';

/**
 * Round 8, the results dashboard's read (saSessions):
 * - sa_r8_hide_practice ON: every row (sessions and stopSessions) says whether its school is a practice school
 *   (schools.is_probable_test), and the answer carries practiceFilter: true, so the page leaves them out by default and
 *   offers a toggle to add them back. OFF: the answer is exactly today's.
 * - sa_r8_coach_name_guard ON: a coach's stored name that is a chat command or a route ("/assessment") or holds no
 *   letter is never shown as a person: coachName is null. OFF: the stored name as today.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SLASH = 'aaaaaaaa-0000-4000-8000-000000000002';
const S1 = 'cccccccc-0000-4000-8000-000000000001';
const S2 = 'cccccccc-0000-4000-8000-000000000002';
const S3 = 'cccccccc-0000-4000-8000-000000000003';
const REAL = 'sch-real';
const PRACTICE = 'sch-practice';

const session = (id, coach, school, extra = {}) => ({
  id, coach_user_id: coach, student_id: `st-${id}`, draw_id: `d-${id}`, school_id: school, grade: 3, form: 'A',
  item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-10-27T05:00:00Z', finished_at: '2026-10-27T05:30:00Z',
  created_at: '2026-10-27T04:59:00Z', device: { block: 'rdf_auto' }, ...extra,
});
const block = (sessionId) => ({
  session_id: sessionId, block: 'ur.words4', response_mode: 'record', lang: 'ur', created_at: '2026-10-27T05:05:00Z', ai_status: 'scored',
  ai_marks: { correct: 3, attempted: 4 }, audio_r2_key: `k/${sessionId}.webm`, responses: [{ kind: 'result', mode: 'record' }],
});

function world({ hide = true, guard = true, dash = true, names = { [COACH]: 'Coach Testwala', [SLASH]: '/assessment' } } = {}) {
  const calls = { schoolReads: 0 };
  const all = [
    session(S1, COACH, REAL),
    session(S2, SLASH, PRACTICE),
    // a test ended at once in the practice school: no task, one stop
    session(S3, SLASH, PRACTICE, { device: { block: 'rdf_auto', events: [{ seq: 1, type: 'end_test', task_id: null, at: '2026-10-27T05:01:00Z', data: { by: 'coach' } }] } }),
  ];
  const store = {
    listSaSessions: async () => ({ ok: true, sessions: all }),
    listBlocksForSessions: async (ids) => ({ ok: true, blocks: [S1, S2].filter((id) => ids.includes(id)).map(block) }),
    getSchoolsByIds: async (ids) => ({ ok: true, schools: [{ id: REAL, name: 'Real School', region: 'Urban-I' }, { id: PRACTICE, name: 'SIM Practice', region: 'ICT' }].filter((s) => ids.includes(s.id)) }),
    getUserNamesByIds: async (ids) => ({ ok: true, users: ids.map((id) => ({ id, name: names[id] })) }),
    getSessionDrawOrigins: async () => ({ ok: true, origins: [] }),
  };
  // the one direct read: which of these schools are practice (is_probable_test) schools
  const supabase = {
    from: (table) => {
      if (table !== 'schools') throw new Error(`unexpected read of ${table}`);
      calls.schoolReads += 1;
      const q = { ids: [], test: null };
      const chain = {
        select: () => chain,
        in: (_c, ids) => { q.ids = ids; return chain; },
        eq: (_c, v) => { q.test = v; return chain; },
        then: (ok, ko) => Promise.resolve({ data: q.test === true && q.ids.includes(PRACTICE) ? [{ id: PRACTICE }] : [], error: null }).then(ok, ko),
      };
      return chain;
    },
  };
  return {
    calls,
    deps: {
      enabled: async () => true, practiceSwitch: false, stopRules: false, dashFilters: dash, hidePractice: hide, coachNameGuard: guard,
      supabase, store, saStore: {}, bank: null, now: () => new Date('2026-10-28T08:00:00Z'), log: () => {}, logError: () => {},
    },
  };
}

const byId = (list) => Object.fromEntries(list.map((r) => [r.results.session.id, r]));

describe('saSessions: practice schools (sa_r8_hide_practice)', () => {
  test('OFF: today\'s answer, no practice mark, no practiceFilter, no school read', async () => {
    const w = world({ hide: false, guard: false });
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(out.practiceFilter).toBeUndefined();
    for (const r of [...out.sessions, ...out.stopSessions]) expect(r.practice).toBeUndefined();
    expect(w.calls.schoolReads).toBe(0);
  });

  test('ON: each row says whether its school is a practice school, stop-only rows too, and practiceFilter is true', async () => {
    const w = world();
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(out.practiceFilter).toBe(true);
    const rows = byId(out.sessions);
    expect(rows[S1].practice).toBe(false);
    expect(rows[S2].practice).toBe(true);
    expect(byId(out.stopSessions)[S3].practice).toBe(true);
    expect(w.calls.schoolReads).toBe(1);
  });

  test('ON without the round-7b filters: still marked (the page hides practice rows either way)', async () => {
    const w = world({ dash: false });
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, w.deps);
    expect(out.practiceFilter).toBe(true);
    expect(byId(out.sessions)[S2].practice).toBe(true);
    expect(byId(out.sessions)[S1].practice).toBe(false);
  });
});

describe('saSessions: a command is never a coach\'s name (sa_r8_coach_name_guard)', () => {
  test('OFF: the stored name as today', async () => {
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, world({ guard: false }).deps);
    expect(byId(out.sessions)[S2].coachName).toBe('/assessment');
  });

  test('ON: "/assessment" becomes null; a real name is kept', async () => {
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, world().deps);
    expect(byId(out.sessions)[S2].coachName).toBeNull();
    expect(byId(out.stopSessions)[S3].coachName).toBeNull();
    expect(byId(out.sessions)[S1].coachName).toBe('Coach Testwala');
  });

  test.each([['/assessment'], ['  /menu '], ['https://x.y/z'], ['/'], ['123'], ['...'], ['']])('ON: %j is not a person', async (bad) => {
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, world({ names: { [COACH]: bad, [SLASH]: 'x' } }).deps);
    expect(byId(out.sessions)[S1].coachName).toBeNull();
  });

  test.each([['Abdul Khaliq'], ['نور فاطمہ'], ['A. Rehman'], ['Noor']])('ON: %j is kept', async (good) => {
    const out = await sa.saSessions({ userId: COACH, asAdmin: true }, world({ names: { [COACH]: good, [SLASH]: 'x' } }).deps);
    expect(byId(out.sessions)[S1].coachName).toBe(good);
  });
});

describe('the round-8 dashboard switches', () => {
  test.each([
    ['../../shared/services/child-test/app/hide-practice-switch', 'sa_r8_hide_practice', 'hidePractice'],
    ['../../shared/services/child-test/app/coach-name-guard-switch', 'sa_r8_coach_name_guard', 'coachNameGuard'],
  ])('%s: key, JSON true only, fails closed', async (path, key, dep) => {
    const sw = require(path); // eslint-disable-line global-require
    expect(sw.KEY).toBe(key);
    expect(await sw.enabled({ [dep]: true })).toBe(true);
    expect(await sw.enabled({ [dep]: false })).toBe(false);
    const client = (value, error = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: value === undefined ? [] : [{ key, value }], error }) }) }) });
    expect(await sw.on(1e12, client('true'))).toBe(false);
    expect(await sw.on(2e12, client(['u1']))).toBe(false);
    expect(await sw.on(3e12, client(undefined, { message: 'down' }))).toBe(false);
    expect(await sw.on(4e12, client(true))).toBe(true);
  });
});
