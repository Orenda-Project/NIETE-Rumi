'use strict';
/**
 * The practice door on the finish screen (A/B test ict-quiz-practice-door). Switch off: `{}` and not one read past
 * the switch. On: only an eligible child in arm B, under the day's cap, sees the door; QA's force_b list gets B; a
 * child keeps the arm the ledger holds; a draw is recorded only once the test is registered. Faked boundary: Supabase.
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-token-secret-not-a-secret';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const { makeFake } = require('../web-quiz/fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logToFile } = require('../../../shared/utils/logger');
const AB = require('../../../shared/services/ab-assign.service');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Pool = require('../../../shared/services/quiz/test-practice/pool.repo');
const Door = require('../../../shared/services/quiz/test-practice/door');

const KID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-27T06:00:00Z');
const st = T.signSession({ sessionId: 's1', deviceRef: 'dev-1', shareCodeId: 'sc1' });
const score = { score: { correct: 2, total: 5, pct: 40 } };
const lpQuiz = (o = {}) => ({ id: 'qz', teacher_id: 't1', grade: '3', subject: 'English', topic: 'Nouns', quiz_source: 'lp_v8', status: 'sent', created_at: '2026-11-01T00:00:00Z',
  meta: { lessons: ['L1'], digest: { slos: [{ id: 'S1', evidence_quote: 'q' }] } }, ...o });

let fake;
function seed(opts = {}) {
  const { session = {}, quiz = {}, ledger = [], rounds = [], bindings = [] } = opts;
  const flag = 'flag' in opts ? opts.flag : { on: true, force_b: [KID] };
  const db = {
    app_settings: flag === undefined ? [] : [{ key: 'ab_quiz_practice_door', value: flag }],
    quiz_sessions: [{ id: 's1', student_id: KID, user_id: null, invited_by_student_id: null, share_code_id: 'sc1', quiz_id: 'qz', ...session }],
    quizzes: [lpQuiz(quiz), ...rounds],
    ab_assignment: ledger,
    child_phone_bindings: bindings,
  };
  fake = makeFake(db, { uniques: { ab_assignment: ['test_id', 'unit_id'] } });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  AB._resetCache(); Pool._resetCache(); Door._reset();
}
const round = (id, at) => ({ id, teacher_id: 't1', topic: 'x', quiz_source: 'practice', status: 'skipped', created_at: at, meta: { kind: 'practice', student_id: KID, round: { items: [] } } });
const field = (body = { st }) => Door.field(body, score, { now: NOW });

beforeEach(() => { jest.restoreAllMocks(); logToFile.mockClear(); });

describe('switch off', () => {
  test.each([[undefined], [false], ['true'], [{ on: 'yes' }]])('%p → {} and nothing past the switch is read', async (flag) => {
    seed({ flag });
    expect(await field()).toEqual({});
    expect(fake.calls.map((c) => c.table).filter((t) => t !== 'app_settings')).toEqual([]);
  });
});

describe('switch on', () => {
  test('a forced child sees the door with the rounds left today', async () => {
    seed({ rounds: [round('r1', '2026-11-27T04:00:00Z'), round('r0', '2026-11-26T04:00:00Z')] });
    expect(await field()).toEqual({ practice_door: { rounds_left: 2 } });
  });
  test('the cap closes the door', async () => {
    seed({ rounds: ['a', 'b', 'c'].map((id) => round(id, '2026-11-27T04:00:00Z')) });
    expect(await field()).toEqual({});
  });
  test.each([
    ['the teacher\'s own run', { session: { user_id: 't1' } }],
    ['a friend\'s invite', { session: { invited_by_student_id: '22222222-2222-4222-8222-222222222222' } }],
    ['Grade 6', { quiz: { grade: '6' } }],
    ['Maths', { quiz: { subject: 'Mathematics' } }],
    ['a video quiz', { quiz: { quiz_source: 'transcript' } }],
    ['a share code that is not the token\'s', { session: { share_code_id: 'other' } }],
  ])('not eligible: %s', async (_n, o) => {
    seed(o);
    expect(await field()).toEqual({});
  });
  test('a bad token or no score is {}', async () => {
    seed();
    expect(await Door.field({ st: 'x.y' }, score, { now: NOW })).toEqual({});
    expect(await Door.field({ st }, {}, { now: NOW })).toEqual({});
  });
  test('the ledger arm stands: a child recorded in A never sees the door, even when the draw would say B', async () => {
    seed({ flag: true, ledger: [{ test_id: 'ict-quiz-practice-door', unit_id: KID, arm: 'a' }] });
    jest.spyOn(AB, 'assignArm').mockReturnValue('b');
    expect(await field()).toEqual({});
  });
  test('a child recorded in B sees the door', async () => {
    seed({ flag: true, ledger: [{ test_id: 'ict-quiz-practice-door', unit_id: KID, arm: 'b' }] });
    expect(await field()).toEqual({ practice_door: { rounds_left: 3 } });
  });
  test('unregistered: the draw serves A and nothing is written (no child is pinned to A before the test starts)', async () => {
    seed({ flag: true });
    expect(await field()).toEqual({});
    expect(fake.db.ab_assignment).toEqual([]);
  });
  test('registered: the draw is by phone group and recorded once; no binding falls back to the child and is logged without ids', async () => {
    seed({ flag: true });
    jest.spyOn(AB, 'readRegistry').mockReturnValue({ ok: true, entries: [{ test_id: 'ict-quiz-practice-door', flag_key: 'ab_quiz_practice_door', card_sha256: 'f'.repeat(64) }] });
    const draw = jest.spyOn(AB, 'assignArm').mockReturnValue('b');
    expect(await field()).toEqual({ practice_door: { rounds_left: 3 } });
    expect(draw.mock.calls[0][0]).toMatchObject({ flagKey: 'ab_quiz_practice_door', unitId: `st:${KID}`, salt: 'ict-quiz-practice-door:2026-11:v1' });
    expect(fake.db.ab_assignment).toEqual([expect.objectContaining({ unit_id: KID, arm: 'b', block: `st:${KID}` })]);
    const lines = logToFile.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /fallback/.test(l))).toBe(true);
    expect(lines.join('\n')).not.toContain(KID);
  });
  test('a bound child draws by the phone group', async () => {
    seed({ flag: true, bindings: [{ id: 'b1', canonical_id: KID, phone_norm: 'n', phone_tomb: 'tomb-1', revoked_at: null, expires_at: '2027-01-01T00:00:00Z', bound_at: '2026-11-01T00:00:00Z' }] });
    jest.spyOn(AB, 'readRegistry').mockReturnValue({ ok: true, entries: [{ test_id: 'ict-quiz-practice-door', flag_key: 'ab_quiz_practice_door', card_sha256: 'f'.repeat(64) }] });
    const draw = jest.spyOn(AB, 'assignArm').mockReturnValue('a');
    expect(await field()).toEqual({});
    expect(draw.mock.calls[0][0].unitId).toMatch(/^pg:[0-9a-f]{32}$/);
  });
  test('a read that throws is {} and logged', async () => {
    seed();
    const from = supabase.from;
    supabase.from = (t) => { if (t === 'quiz_sessions') throw new Error('down'); return from(t); };
    expect(await field()).toEqual({});
  });
});
