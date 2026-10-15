'use strict';
/**
 * The canonical fold (switch web_quiz_identity_canon, parent web_quiz_hub):
 *   - canonicalStudentIds follows students.merged_into ONE hop for a merged id (never further);
 *   - the hub folds the token's children through it, so a merged loose child's chip is the roster child
 *     (the token keeps raw ids);
 *   - identity v2 reuses a loose child across one teacher's codes on one device instead of a second record.
 * Switch off → today's outputs (goldens). Supabase and Redis are the faked boundaries; the roster fold,
 * the hub and the session endpoint run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
    get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => store.delete(k)),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(), sendCtaUrl: jest.fn(),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const F = require('./web-quiz-identity-fixture');
const supabase = require('../../../shared/config/supabase');
const redis = require('../../../shared/services/cache/railway-redis.service');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const Roster = require('../../../shared/services/quiz/web-quiz-roster');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const Reuse = require('../../../shared/services/quiz/child-identity-reuse');

const ON = [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_identity_canon', value: 'true' }];
const OFF = [{ key: 'web_quiz_hub', value: 'true' }];
// Loose children (list_id NULL) merged into others: L1 → roster kid 1; L2 → L3 → roster kid 2 (a chain: one hop only).
const L1 = 'd0000000-0000-4000-8000-000000000001';
const L2 = 'd0000000-0000-4000-8000-000000000002';
const L3 = 'd0000000-0000-4000-8000-000000000003';
const SC2 = '33333333-3333-4333-8333-3333333333c2';
const SC_OTHER = '33333333-3333-4333-8333-3333333333c3';
const OTHER_TEACHER = '11111111-1111-4111-8111-1111111111ff';
const future = new Date(Date.now() + 86400000 * 10).toISOString();

let fake;
function seed(settings, extra = {}) {
  const base = F.db();
  base.app_settings = [...base.app_settings, ...settings];
  base.students.push(
    { id: L1, student_name: 'Ayesha Testwala', list_id: null, is_active: true, status: 'merged', merged_into: F.kid(1), created_at: '2026-10-02T00:00:00Z' },
    { id: L2, student_name: 'Ali Testwala', list_id: null, is_active: true, status: 'merged', merged_into: L3, created_at: '2026-10-02T00:00:00Z' },
    { id: L3, student_name: 'Ali Testwala', list_id: null, is_active: true, status: 'merged', merged_into: F.kid(2), created_at: '2026-10-03T00:00:00Z' },
  );
  base.quiz_share_codes.push(
    { ...base.quiz_share_codes[0], id: SC2, code: 'XY34ZW', created_at: F.ago(3) },
    { ...base.quiz_share_codes[0], id: SC_OTHER, code: 'OT56HR', teacher_user_id: OTHER_TEACHER, class_id: null, created_at: F.ago(3), expires_at: future },
  );
  Object.assign(base, extra);
  fake = makeFake(base);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  IdRoster._resetCache();
  Roster._resetCache();
  IdFlags._resetCache();
  Hub._resetCache();
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key', WEB_QUIZ_TOKEN_SECRET: 'fold-test-secret', PORTAL_URL: 'https://portal.example.test' };
  jest.clearAllMocks();
  redis._store.clear();
  seed(OFF);
});
afterAll(() => { process.env = SAVED; });

const asObj = (m) => Object.fromEntries([...m.entries()]);
const ev = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('canonicalStudentIds: merged_into, one hop', () => {
  const IDS = [F.kid(9), L1, F.kid(1), L2, F.TYPED];

  test('switch off: the Map is today\'s (aliases folded, merged ids kept as given) — golden', async () => {
    const got = asObj(await IdRoster.canonicalStudentIds(IDS));
    // Recorded from the original function on this fixture: Bilal's second import folds to the first; nothing else moves.
    expect(got).toEqual({ [F.kid(9)]: F.kid(8), [L1]: L1, [F.kid(1)]: F.kid(1), [L2]: L2, [F.TYPED]: F.TYPED });
  });

  test('switch on: an alias folds to its roster id; a merged loose id maps to its merged_into target', async () => {
    seed(ON);
    const got = await IdRoster.canonicalStudentIds(IDS);
    expect(got.get(F.kid(9))).toBe(F.kid(8));
    expect(got.get(L1)).toBe(F.kid(1));
    expect(got.get(F.TYPED)).toBe(F.TYPED);
  });

  test('switch on: a target that is itself merged is NOT followed further', async () => {
    seed(ON);
    expect((await IdRoster.canonicalStudentIds([L2])).get(L2)).toBe(L3);
  });

  test('parent off (hub off) with the canon key on: today\'s Map', async () => {
    seed([{ key: 'web_quiz_identity_canon', value: 'true' }]);
    expect((await IdRoster.canonicalStudentIds([L1])).get(L1)).toBe(L1);
  });
});

describe('the hub folds the token\'s children', () => {
  const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
  const chip = (id) => T.chipId('h', id);
  const THREE = () => T.signHub([F.kid(3), L1, F.kid(6)]);

  test('switch off: a three-child hub payload is byte-identical to today\'s — golden', async () => {
    const out = await Hub.hub(THREE(), { device: DEV });
    expect(JSON.stringify(out)).toMatchSnapshot();
    expect(out.kids.map((k) => k.chip)).toEqual([chip(F.kid(3)), chip(L1), chip(F.kid(6))]);
  });

  test('switch on: the merged loose child\'s chip is the roster child', async () => {
    seed(ON);
    const out = await Hub.hub(THREE(), { device: DEV });
    expect(out.kids.map((k) => k.chip)).toEqual([chip(F.kid(3)), chip(F.kid(1)), chip(F.kid(6))]);
  });

  test('switch on: a token naming a roster child and its merged loose record shows one chip', async () => {
    seed(ON);
    const out = await Hub.hub(T.signHub([L1, F.kid(1)]), { device: DEV });
    expect(out.kids.map((k) => k.chip)).toEqual([chip(F.kid(1))]);
    expect(out.kid).toBe(chip(F.kid(1)));
  });

  test('switch on, three children, one chip picked: again / recs / last / teacher are that child\'s only', async () => {
    const S = (id, sc, student, h) => F.done(id, student, 'x', 4, h, { share_code_id: sc });
    seed([...ON, { key: 'web_quiz_child_quiz_home', value: 'true' }], {});
    fake.db.quiz_sessions.push(S('s-3a', F.SC, F.kid(3), 5), S('s-6a', SC_OTHER, F.kid(6), 2));
    const out = await Hub.hub(THREE(), { device: DEV, kid: chip(F.kid(3)) });
    expect(out.kid).toBe(chip(F.kid(3)));
    const codes = JSON.stringify([out.again, out.recs, out.last, out.teacher]);
    expect(codes).not.toMatch(/OT56HR/);
    expect(JSON.stringify(out.again)).not.toMatch(/OT56HR/);
    expect(out.last && out.last.code).toBe('AB12CD');
  });
});

describe('kidFromHub: the library and challenge links name the folded child', () => {
  const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
  const chip = (id) => T.chipId('h', id);

  test('switch on: a token with the merged id and the chip of the folded id → the folded child', async () => {
    seed(ON);
    const token = T.signHub([L1, F.kid(6)]);
    const got = await Hub.kidFromHub(token, chip(F.kid(1)), DEV);
    expect(got && got.studentId).toBe(F.kid(1));
    // The raw chips the token names still resolve as today.
    expect(Hub.kidOf(token, chip(F.kid(6)))).toBe(F.kid(6));
    expect((await Hub.kidFromHub(token, chip(F.kid(6)), DEV)).studentId).toBe(F.kid(6));
  });

  test('switch on: a chip the token does not name, folded or raw, is nobody; another phone is nobody', async () => {
    seed(ON);
    const token = T.signHub([L1, F.kid(6)]);
    await Hub.kidFromHub(token, chip(F.kid(6)), DEV); // the first phone claims the link
    expect(await Hub.kidFromHub(token, chip(F.kid(2)), DEV)).toBeNull();
    expect(await Hub.kidFromHub(token, chip(F.kid(1)), 'BBBBBBBBBBBBBBBBBBBBBB')).toBeNull();
  });

  test('switch off: the chip of the folded id is nobody, as today; kidOf is unchanged', async () => {
    const token = T.signHub([L1, F.kid(6)]);
    expect(await Hub.kidFromHub(token, chip(F.kid(1)), DEV)).toBeNull();
    expect(Hub.kidOf(token, chip(F.kid(1)))).toBeNull();
    expect(Hub.kidOf(token, chip(L1))).toBe(L1);
    expect((await Hub.kidFromHub(token, chip(L1), DEV)).studentId).toBe(L1);
  });
});

describe('a loose child reused across one teacher\'s codes on one device', () => {
  async function play(code, body) {
    try { return await WQ.startSession({ code, ...body }); } catch (e) { if (e instanceof WQ.WqError) return e; throw e; }
  }
  const sid = () => fake.db.quiz_sessions[fake.db.quiz_sessions.length - 1].student_id;
  const studentInserts = () => fake.calls.filter((c) => c.table === 'students' && c.op === 'insert').map((c) => c.payload);

  test('switch on: same device + same name + the same teacher\'s second code → the same student id', async () => {
    seed(ON);
    const D = T.newDeviceRef();
    await play('AB12CD', { new: { name: 'Usman Testwala', force: true }, device_ref: D });
    const first = sid();
    await play('XY34ZW', { new: { name: 'usman  testwala', force: true }, device_ref: D });
    expect(sid()).toBe(first);
    expect(studentInserts()).toHaveLength(1);
    expect(ev('web_quiz.identity_reused')).toEqual([{ w: 's', via: 'device_name' }]);
  });

  test('switch on: a different device → a new id', async () => {
    seed(ON);
    await play('AB12CD', { new: { name: 'Usman Testwala', force: true }, device_ref: T.newDeviceRef() });
    const first = sid();
    await play('XY34ZW', { new: { name: 'Usman Testwala', force: true }, device_ref: T.newDeviceRef() });
    expect(sid()).not.toBe(first);
    expect(ev('web_quiz.identity_reused')).toEqual([]);
  });

  test('switch off: a new record as today — golden on the insert call args', async () => {
    const D = T.newDeviceRef();
    await play('AB12CD', { new: { name: 'Usman Testwala', force: true }, device_ref: D });
    const first = sid();
    await play('XY34ZW', { new: { name: 'Usman Testwala', force: true }, device_ref: D });
    expect(sid()).not.toBe(first);
    const row = { student_name: 'Usman Testwala', self_reported_class: '4-A', enrolled_by_user_id: F.TEACHER, phone: null, list_id: null };
    expect(studentInserts()).toEqual([[row], [row]]);
    expect(ev('web_quiz.identity_reused')).toEqual([]);
  });

  test('another teacher\'s code, or two matching loose children, is never a reuse', async () => {
    seed(ON);
    const D = T.newDeviceRef();
    fake.db.students.push({ id: 'loose-a', student_name: 'Hamid Testwala', list_id: null, is_active: true, status: 'active' });
    fake.db.quiz_sessions.push({ id: 'qs-o', share_code_id: SC_OTHER, student_id: 'loose-a', student_name: 'Hamid Testwala', device_ref: D, user_id: null });
    expect(await Reuse.looseOnDevice({ teacherUserId: F.TEACHER, deviceRef: D, name: 'Hamid Testwala' })).toBeNull();
    expect(await Reuse.looseOnDevice({ teacherUserId: OTHER_TEACHER, deviceRef: D, name: 'Hamid Testwala' })).toMatchObject({ id: 'loose-a' });
    fake.db.students.push({ id: 'loose-b', student_name: 'Hamid Testwala', list_id: null, is_active: true, status: 'active' });
    fake.db.quiz_sessions.push({ id: 'qs-p', share_code_id: SC_OTHER, student_id: 'loose-b', student_name: 'Hamid Testwala', device_ref: D, user_id: null });
    expect(await Reuse.looseOnDevice({ teacherUserId: OTHER_TEACHER, deviceRef: D, name: 'Hamid Testwala' })).toBeNull();
  });
});
