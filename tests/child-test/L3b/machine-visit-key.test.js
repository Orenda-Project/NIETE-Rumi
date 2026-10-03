/**
 * L4's conversation names the visit with a key when there is no observe2 field form (bd-s1oo0.11,
 * CONTRACT v0.7 §12 CR-1): /egra with no visit today → day:<coach>:<school>:<YYYY-MM-DD PKT>;
 * Yes on the offer after classic /observe → cs:<coaching_session_id>. With a field form the call
 * is unchanged (visitId). Mocked at the network boundary only; the other lanes are the L4 fakes.
 */
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
const mockR2 = { uploadBuffer: jest.fn(async (buf, key) => `https://r2.example/${key}`) };
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => mockR2);
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));

const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');
const { pktDate } = require('../../../bot/shared/services/child-test/draw/visit-key');

const COACH_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const TEACHER_ID = '33333333-3333-4333-8333-333333333333';
const CS_ID = '44444444-4444-4444-8444-444444444444';
const COACH = { id: COACH_ID, role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const PHONE = COACH.phone_number;
const SAVED = { ...process.env };
let lanes;

function seedDb({ fieldForm = false } = {}) {
  mockDb = createFakeSupabase({
    users: [COACH, { id: TEACHER_ID, role: 'teacher', school_id: SCHOOL_ID }],
    observation_field_forms: fieldForm ? [{ id: 'form-1', observer_user_id: COACH_ID, teacher_user_id: TEACHER_ID,
      visit_context: {}, created_at: new Date().toISOString() }] : [],
    coaching_sessions: [{ id: CS_ID, user_id: TEACHER_ID, observer_user_id: COACH_ID }],
    class_teachers: [{ teacher_user_id: TEACHER_ID, class_id: 'class-3a', is_active: true }],
    classes: [{ id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: SCHOOL_ID, is_active: true }],
    leader_schools: [{ leader_user_id: COACH_ID, school_id: SCHOOL_ID, school_name: 'SIM — School', emis: '111' }],
  });
}

const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const callsOf = (name) => lanes.calls.filter((c) => c[0] === name).map((c) => c[1]);
const dayKey = () => `day:${COACH_ID}:${SCHOOL_ID}:${pktDate(new Date())}`;

// L26 (bd-s1oo0.46.2): the v2 journey is the default now; these scenarios drive today's (v1) conversation.
const V1_SWITCHES = { CHILD_TEST_BATTERY: 'v1', CHILD_TEST_MATHS_MODE: 'strip', CHILD_TEST_CHECK_MODE: 'per_child' };
beforeAll(() => { Object.assign(process.env, V1_SWITCHES); });
afterAll(() => { for (const k of Object.keys(V1_SWITCHES)) delete process.env[k]; });

beforeEach(() => {
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
  seedDb();
  lanes = createLaneFakes();
  ports.__setForTest(lanes);
});
afterEach(() => H.__drain());
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

describe('/egra with no observe2 visit today', () => {
  test('the list is drawn on the day key, not refused for a missing visit', async () => {
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    const [tl] = callsOf('todaysList');
    expect(tl).toMatchObject({ coachUserId: COACH_ID, schoolId: SCHOOL_ID, visitKey: dayKey() });
    expect(tl.visitId == null).toBe(true);
    expect(last('list')).toBeTruthy();
    expect(sent().some((m) => m.kind === 'text' && /after an \/observe2 visit/.test(m.text))).toBe(false);
  });
  test('idempotent: a second /egra the same day asks for the same key and shows the same children', async () => {
    await H.handleText(PHONE, '/egra', COACH);
    const first = last('list').action.sections[0].rows.map((r) => r.id);
    await H.handleText(PHONE, '/egra', COACH);
    expect(last('list').action.sections[0].rows.map((r) => r.id)).toEqual(first);
    expect(callsOf('todaysList').map((a) => a.visitKey)).toEqual([dayKey(), dayKey()]);
  });
  test('Present: markOutcome and createSession carry the key', async () => {
    await H.handleText(PHONE, '/egra', COACH);
    expect(await H.handleList(COACH, PHONE, 'ctst_child:d1')).toBe(true);
    expect(await H.handleButton(COACH, PHONE, 'ctst_pres:d1:p')).toBe(true);
    const [mo] = callsOf('markOutcome');
    expect(mo).toMatchObject({ drawId: 'd1', outcome: 'present', visitKey: dayKey() });
    expect(mo.visitId == null).toBe(true);
    const [cs] = callsOf('createSession');
    expect(cs).toMatchObject({ drawId: 'd1', coachUserId: COACH_ID, visitKey: dayKey() });
    expect(cs.visitId == null).toBe(true);
  });
  test('the list shows a child mid-test from the sessions under that key', async () => {
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d1');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d1:p');
    await H.handleText(PHONE, '/egra', COACH);
    const row = last('list').action.sections[0].rows.find((r) => r.id === 'ctst_child:d1');
    expect(row.description).toMatch(/in progress/i);
  });
});

describe('the offer after classic /observe', () => {
  test('Yes draws the list on cs:<coaching session id>', async () => {
    expect(await H.handleButton(COACH, PHONE, `ctst_offer:s:${CS_ID}`)).toBe(true);
    const [tl] = callsOf('todaysList');
    expect(tl).toMatchObject({ coachUserId: COACH_ID, schoolId: SCHOOL_ID, visitKey: `cs:${CS_ID}`, observedGrade: 3 });
    expect(tl.visitId == null).toBe(true);
    expect(last('list')).toBeTruthy();
  });
});

describe('with an observe2 visit', () => {
  test('the call is unchanged: visitId, no key', async () => {
    seedDb({ fieldForm: true });
    await H.handleText(PHONE, '/egra', COACH);
    const [tl] = callsOf('todaysList');
    expect(tl).toMatchObject({ visitId: 'form-1' });
    expect(tl.visitKey == null).toBe(true);
  });
});

describe('a day key is only today\'s', () => {
  test('/egra after an earlier day\'s list draws on today\'s key, not the old one', async () => {
    const S = require('../../../bot/shared/services/child-test/conversation/state');
    const old = `day:${COACH_ID}:${SCHOOL_ID}:2026-01-05`;
    await S.set(COACH_ID, { ctx: { visitId: null, schoolId: SCHOOL_ID, observedGrade: null, observedClassId: null, visitKey: old }, step: 'list', current: null });
    await H.handleText(PHONE, '/egra', COACH);
    expect(callsOf('todaysList').map((a) => a.visitKey)).toEqual([dayKey()]);
  });
  test('mid-test, the child keeps the list it belongs to', async () => {
    const S = require('../../../bot/shared/services/child-test/conversation/state');
    await H.handleText(PHONE, '/egra', COACH);
    await H.handleList(COACH, PHONE, 'ctst_child:d1');
    const st = await S.get(COACH_ID);
    expect(st.step).toBe('presence');
    await S.set(COACH_ID, { ...st, ctx: { ...st.ctx, visitKey: `day:${COACH_ID}:${SCHOOL_ID}:2026-01-05` } });
    await H.handleText(PHONE, '/egra', COACH);
    expect(callsOf('todaysList').pop().visitKey).toBe(`day:${COACH_ID}:${SCHOOL_ID}:2026-01-05`);
  });
});

describe('kept separate from observe2 (CHILD_TEST_OBSERVE_LINK unset, the default)', () => {
  afterEach(() => { delete process.env.CHILD_TEST_OBSERVE_LINK; });
  test('/egra on a day with an observe2 visit does not use the visit: it draws on the day key', async () => {
    delete process.env.CHILD_TEST_OBSERVE_LINK;
    seedDb({ fieldForm: true });
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    const [tl] = callsOf('todaysList');
    expect(tl).toMatchObject({ coachUserId: COACH_ID, schoolId: SCHOOL_ID, visitKey: dayKey() });
    expect(tl.visitId == null).toBe(true);
  });
  test('with CHILD_TEST_OBSERVE_LINK=true the visit is used, as before', async () => {
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';
    seedDb({ fieldForm: true });
    await H.handleText(PHONE, '/egra', COACH);
    const [tl] = callsOf('todaysList');
    expect(tl).toMatchObject({ visitId: 'form-1' });
  });
});
