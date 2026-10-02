/**
 * Child test — a visit with no observe2 field form (CONTRACT v0.7 §12 CR-1, bd-s1oo0.11).
 *
 * Two coach paths have no observation_field_forms row: /egra on a visit day with no observe2 visit,
 * and the offer after classic /observe. They name their visit with a visit key instead:
 *   cs:<coaching_session_id>                                  classic /observe
 *   day:<coachUserId>:<schoolId>:<YYYY-MM-DD, Pakistan time>  /egra with no visit
 * The list is idempotent on whichever identifier is given, exactly as it is on visitId, and the key
 * travels with the child into markOutcome and the session. Only the Supabase client is replaced.
 */
const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
const { buildRoster } = require('../L3/helpers/roster');

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
const draw = require('../../../bot/shared/services/child-test/draw');
const store = require('../../../bot/shared/services/child-test/store');
const { visitKeyFor, parseVisitKey, isVisitKey } = require('../../../bot/shared/services/child-test/draw/visit-key');

const NOW = new Date('2026-10-05T06:00:00Z'); // 11:00 PKT, 5 Oct
const COACH = '11111111-1111-4111-8111-111111111111';
const SCHOOL = '22222222-2222-4222-8222-222222222222';
const CS = '33333333-3333-4333-8333-333333333333';
const CS2 = '44444444-4444-4444-8444-444444444444';
const DAY_KEY = `day:${COACH}:${SCHOOL}:2026-10-05`;
const CS_KEY = `cs:${CS}`;

function setup() {
  mockFake = createFakeSupabase(
    buildRoster({ schoolId: SCHOOL, coachId: COACH, classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] }),
    { unique: CHILD_TEST_UNIQUE },
  );
  return mockFake;
}
const T = () => mockFake.__tables;
const call = (extra = {}) => draw.todaysList({ coachUserId: COACH, schoolId: SCHOOL, observedGrade: 3, now: NOW, ...extra });
const ids = (kids) => kids.map((k) => k.studentId);

beforeEach(() => { process.env.CHILD_TEST_DRAW_SECRET = 'test-secret'; jest.clearAllMocks(); setup(); });
afterAll(() => { delete process.env.CHILD_TEST_DRAW_SECRET; });

describe('visitKeyFor / parseVisitKey', () => {
  test('a classic /observe visit is cs:<coaching_session_id>', () => {
    expect(visitKeyFor({ coachingSessionId: CS })).toBe(CS_KEY);
    expect(parseVisitKey(CS_KEY)).toEqual({ kind: 'cs', coachingSessionId: CS });
  });
  test('/egra with no visit is day:<coach>:<school>:<date in Pakistan time>', () => {
    expect(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: NOW })).toBe(DAY_KEY);
    // 20:30 UTC on 4 Oct is 01:30 on 5 Oct in Pakistan.
    expect(visitKeyFor({ coachUserId: COACH, schoolId: SCHOOL, now: new Date('2026-10-04T20:30:00Z') })).toBe(DAY_KEY);
    expect(parseVisitKey(DAY_KEY)).toEqual({ kind: 'day', coachUserId: COACH, schoolId: SCHOOL, date: '2026-10-05' });
  });
  test('malformed keys do not parse', () => {
    for (const k of ['', 'cs:', 'cs:not-a-uuid', `cs:${CS}:x`, `day:${COACH}:${SCHOOL}`, `day:${COACH}:${SCHOOL}:2026-13-01`,
      `day:${COACH}:${SCHOOL}:2026-02-30`, `day:coach-1:${SCHOOL}:2026-10-05`, `obs:${CS}`, CS, null, 42]) {
      expect(parseVisitKey(k)).toBeNull();
    }
    expect(isVisitKey(CS_KEY)).toBe(true);
    expect(isVisitKey(CS)).toBe(false);
    expect(visitKeyFor({ coachingSessionId: 'nope' })).toBeNull();
    expect(visitKeyFor({ coachUserId: COACH })).toBeNull();
  });
});

describe('todaysList with a visit key', () => {
  test.each([['day', DAY_KEY], ['cs', CS_KEY]])('%s key: a list is drawn and stored under the key, not a visit id', async (_k, key) => {
    const r = await call({ visitKey: key });
    expect(r.ok).toBe(true);
    expect(r.children).toHaveLength(5);
    expect(r.alternates).toHaveLength(2);
    expect(r.reused).toBe(false);
    const listed = T().child_test_draws.filter((d) => d.list_slot);
    expect(listed).toHaveLength(7);
    for (const d of listed) {
      expect(d.visit_key).toBe(key);
      expect(d.last_listed_visit_id).toBeNull();
      expect(d.history[0]).toMatchObject({ event: 'listed', visit_key: key });
      expect(d.history[0].visit_id).toBeUndefined();
    }
  });

  test.each([['day', DAY_KEY], ['cs', CS_KEY]])('%s key: idempotent — the same key returns the same list', async (_k, key) => {
    const a = await call({ visitKey: key });
    const b = await call({ visitKey: key });
    expect(b.reused).toBe(true);
    expect(ids(b.children)).toEqual(ids(a.children));
    expect(ids(b.alternates)).toEqual(ids(a.alternates));
    expect(T().child_test_draws.filter((d) => d.list_slot)).toHaveLength(7);
  });

  test('two keys are two visits: once the first five are tested, the second gets the next children', async () => {
    const a = await call({ visitKey: CS_KEY });
    for (const k of a.children) expect((await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: NOW })).ok).toBe(true);
    const b = await call({ visitKey: `cs:${CS2}` });
    expect(b.children).toHaveLength(5);
    expect(b.reused).toBe(false);
    expect(ids(b.children).filter((s) => ids(a.children).includes(s))).toEqual([]);
  });

  test('a key and an observe2 visit are separate visits; a child not reached at one is listed at the next', async () => {
    const a = await call({ visitKey: DAY_KEY });
    const b = await call({ visitId: 'visit-1', now: new Date(NOW.getTime() + 7 * 86400000) });
    expect(b.ok).toBe(true);
    // Nobody was marked at the day visit, so the same children come back at their rank.
    expect(ids(b.children).sort()).toEqual(ids(a.children).sort());
    for (const d of T().child_test_draws.filter((x) => x.list_slot === 'main')) {
      expect(d.last_listed_visit_id).toBe('visit-1');
      expect(d.visit_key).toBeNull();
    }
  });

  test('a malformed key is refused before anything is read or written', async () => {
    for (const bad of ['cs:not-a-uuid', 'day:x', `day:${COACH}:${SCHOOL}:2026-02-30`, 'visit-1']) {
      expect(await call({ visitKey: bad })).toEqual({ ok: false, reason: 'bad_visit_key' });
    }
    expect(mockFake.__calls).toHaveLength(0);
  });

  test("a day key must be this coach's, at this school, today", async () => {
    const OTHER = '55555555-5555-4555-8555-555555555555';
    expect(await call({ visitKey: `day:${OTHER}:${SCHOOL}:2026-10-05` })).toEqual({ ok: false, reason: 'bad_visit_key' });
    expect(await call({ visitKey: `day:${COACH}:${OTHER}:2026-10-05` })).toEqual({ ok: false, reason: 'bad_visit_key' });
    expect(await call({ visitKey: `day:${COACH}:${SCHOOL}:2026-10-06` })).toEqual({ ok: false, reason: 'bad_visit_key' });
    expect(T().child_test_draws).toHaveLength(0);
  });

  test("yesterday's day list can still be reopened (it is a read, not a draw)", async () => {
    const a = await call({ visitKey: DAY_KEY });
    const b = await call({ visitKey: DAY_KEY, now: new Date(NOW.getTime() + 86400000) });
    expect(b.reused).toBe(true);
    expect(ids(b.children)).toEqual(ids(a.children));
  });

  test('both a visit id and a key: refused, the caller must name one visit', async () => {
    expect(await call({ visitId: 'visit-1', visitKey: CS_KEY })).toEqual({ ok: false, reason: 'ambiguous_visit' });
  });

  test('no identifier at all is still missing_visit', async () => {
    expect(await call({})).toEqual({ ok: false, reason: 'missing_visit' });
    expect(await call({ visitId: null, visitKey: null })).toEqual({ ok: false, reason: 'missing_visit' });
  });

  test('the visitId path is unchanged: rows carry last_listed_visit_id and no key', async () => {
    const r = await call({ visitId: 'visit-1' });
    expect(r.ok).toBe(true);
    for (const d of T().child_test_draws.filter((x) => x.list_slot)) {
      expect(d.last_listed_visit_id).toBe('visit-1');
      expect(d.visit_key == null).toBe(true);
      expect(d.history[0]).toMatchObject({ event: 'listed', visit_id: 'visit-1' });
    }
  });
});

describe('markOutcome and the session carry the key', () => {
  test('absent at a key visit: the first alternate moves up on that visit, the list comes back by key', async () => {
    const r = await call({ visitKey: CS_KEY });
    const gone = r.children[0];
    const firstAlt = r.alternates[0];
    const m = await draw.markOutcome({ drawId: gone.drawId, outcome: 'absent', visitKey: CS_KEY, now: NOW });
    expect(m.ok).toBe(true);
    expect(m.list.children.find((k) => k.drawId === gone.drawId).status).toBe('absent');
    expect(m.list.children.filter((k) => k.status === 'listed').map((k) => k.drawId)).toContain(firstAlt.drawId);
    expect(m.list.alternates).toHaveLength(2);
    const row = T().child_test_draws.find((d) => d.id === gone.drawId);
    expect(row.history[row.history.length - 1]).toMatchObject({ event: 'outcome', visit_key: CS_KEY, outcome: 'absent' });
    for (const d of T().child_test_draws.filter((x) => x.list_slot && x.status === 'listed')) expect(d.visit_key).toBe(CS_KEY);
  });

  test('markOutcome without a visit argument uses the key on the row', async () => {
    const r = await call({ visitKey: DAY_KEY });
    const m = await draw.markOutcome({ drawId: r.children[1].drawId, outcome: 'present', now: NOW });
    expect(m.ok).toBe(true);
    expect(m.list.children.find((k) => k.drawId === r.children[1].drawId).status).toBe('tested');
  });

  test('markOutcome with a different key is not_on_list; a malformed key is refused', async () => {
    const r = await call({ visitKey: CS_KEY });
    expect(await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'present', visitKey: `cs:${CS2}`, now: NOW }))
      .toEqual({ ok: false, reason: 'not_on_list' });
    expect(await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'present', visitKey: 'cs:zzz', now: NOW }))
      .toEqual({ ok: false, reason: 'bad_visit_key' });
    expect(await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'present', visitKey: CS_KEY, visitId: 'visit-1', now: NOW }))
      .toEqual({ ok: false, reason: 'ambiguous_visit' });
  });

  test('a session for a key-visit child stores the key and no visit id; listSessionsForVisit finds it by key', async () => {
    const r = await call({ visitKey: CS_KEY });
    const k = r.children[0];
    await draw.markOutcome({ drawId: k.drawId, outcome: 'present', visitKey: CS_KEY, now: NOW });
    const s = await store.createSession({ drawId: k.drawId, coachUserId: COACH });
    expect(s.ok).toBe(true);
    expect(s.session.visit_key).toBe(CS_KEY);
    expect(s.session.visit_id).toBeNull();
    expect((await store.listSessionsForVisit(CS_KEY)).sessions.map((x) => x.id)).toEqual([s.session.id]);
  });

  test('createSession takes an explicit visitKey; a malformed one or both identifiers are refused', async () => {
    const r = await call({ visitKey: DAY_KEY });
    const k = r.children[0];
    await draw.markOutcome({ drawId: k.drawId, outcome: 'present', now: NOW });
    expect(await store.createSession({ drawId: k.drawId, coachUserId: COACH, visitKey: 'day:nope' })).toEqual({ ok: false, reason: 'bad_visit_key' });
    expect(await store.createSession({ drawId: k.drawId, coachUserId: COACH, visitKey: DAY_KEY, visitId: 'visit-1' })).toEqual({ ok: false, reason: 'ambiguous_visit' });
    const s = await store.createSession({ drawId: k.drawId, coachUserId: COACH, visitKey: DAY_KEY });
    expect(s.session).toMatchObject({ visit_key: DAY_KEY, visit_id: null });
  });

  test('an observe2 session still stores visit_id and no key', async () => {
    const r = await call({ visitId: 'visit-1' });
    await draw.markOutcome({ drawId: r.children[0].drawId, outcome: 'present', now: NOW });
    const s = await store.createSession({ drawId: r.children[0].drawId, coachUserId: COACH });
    expect(s.session.visit_id).toBe('visit-1');
    expect(s.session.visit_key).toBeNull();
  });
});
