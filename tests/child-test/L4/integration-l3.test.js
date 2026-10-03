/**
 * The coach conversation against L3's REAL draw and store (bd-s1oo0.3), on L3's in-memory Supabase.
 * Only the network boundary is replaced (Supabase client, WhatsApp, Redis, R2); scoring, the check
 * Flow and the card renderer are contract fakes. Runs once L3's modules are on the branch; until then
 * it is skipped (L4 REPORT says so), so it can never pass vacuously.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const HAVE_L3 = fs.existsSync(path.join(ROOT, 'bot/shared/services/child-test/draw/index.js'))
  && fs.existsSync(path.join(ROOT, 'tests/child-test/L3/helpers/fake-supabase.js'))
  && fs.existsSync(path.join(ROOT, 'tests/child-test/L3/helpers/roster.js'))
  && !/not_implemented/.test(fs.readFileSync(path.join(ROOT, 'bot/shared/services/child-test/store.js'), 'utf8'));

const { createFakeRedis, createWhatsAppRecorder } = require('./helpers/boundary');
const { createLaneFakes } = require('./helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => ({ uploadBuffer: jest.fn(async (b, key) => `https://r2.example/${key}`) }));
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockDb.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
// L20: the strip's child-number read goes to OpenRouter (network boundary): it reads no number here,
// so strip photos fall back to list order, as these scenarios expect.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"child_no":null,"confidence":0}' } }], usage: { cost: 0 } }) } } })));

const maybe = HAVE_L3 ? describe : describe.skip;
// L26 (bd-s1oo0.46.2): the v2 journey is the default now; these scenarios drive today's (v1) conversation.
const V1_SWITCHES = { CHILD_TEST_BATTERY: 'v1', CHILD_TEST_MATHS_MODE: 'strip', CHILD_TEST_CHECK_MODE: 'per_child' };

maybe('with L3\'s real draw and store', () => {
  const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
  const PHONE = COACH.phone_number;
  let H; let ports; let lanes;
  const SAVED = { ...process.env };
  const T = () => mockDb.__tables;
  const last = (kind) => [...mockWa.__sent].reverse().find((m) => m.kind === kind);
  const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id } });

  beforeAll(() => {
    ports = require('../../../bot/shared/services/child-test/conversation/ports');
    H = require('../../../bot/shared/handlers/child-test.handler');
  });
  beforeEach(() => {
    const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
    const { buildRoster } = require('../L3/helpers/roster');
    const seed = buildRoster({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    seed.users = [COACH, { id: 'teacher-1', role: 'teacher', school_id: 'school-1' }];
    seed.class_teachers = [{ teacher_user_id: 'teacher-1', class_id: 'g3a', is_active: true }];
    seed.observation_field_forms[0] = { ...seed.observation_field_forms[0], teacher_user_id: 'teacher-1', created_at: new Date().toISOString() };
    mockDb = createFakeSupabase(seed, { unique: CHILD_TEST_UNIQUE });
    process.env.CHILD_TEST_ENABLED = 'true';
    Object.assign(process.env, V1_SWITCHES);
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
    process.env.CHILD_TEST_DRAW_SECRET = 'test-secret';
    process.env.RAILWAY_ENVIRONMENT = 'sandbox';
    mockRedis.__data.clear();
    mockWa.__sent.length = 0;
    lanes = createLaneFakes();
    ports.__setForTest({ scoring: lanes.scoring, checkFlow: lanes.checkFlow, render: lanes.render });
  });
  afterEach(() => H.__drain());
  afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

  test('a whole child: list, Present, three notes, the strip, the check — rows written by the real store', async () => {
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    const list = last('list');
    expect(list).toBeTruthy();
    expect(list.header.text).toMatch(/^Grade 3/);
    const rows = list.action.sections[0].rows;
    expect(rows).toHaveLength(5);
    expect(list.action.sections[1].rows).toHaveLength(2);
    const drawId = rows[0].id.split(':')[1];

    await H.handleList(COACH, PHONE, `ctst_child:${drawId}`);
    await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`);
    expect(T().child_test_sessions).toHaveLength(1);
    const sess = T().child_test_sessions[0];
    expect(sess).toMatchObject({ draw_id: drawId, coach_user_id: 'coach-1', visit_id: 'visit-1', channel: 'whatsapp', grade: 3 });

    for (const b of ['u', 'e', 'm']) expect(await H.handleVoice(voice(`int-${b}`), PHONE, COACH)).toBe(true);
    expect(T().child_test_blocks.map((b) => [b.block, b.audio_r2_key])).toEqual([
      ['urdu', `child-test/sandbox/school-1/${sess.id}/urdu.ogg`],
      ['english', `child-test/sandbox/school-1/${sess.id}/english.ogg`],
      ['maths', `child-test/sandbox/school-1/${sess.id}/maths.ogg`],
    ]);
    expect(await H.handleImage({ id: 'wamid.p', image: { id: 'strip' } }, PHONE, COACH)).toBe(true);
    await H.__drain();
    const maths = T().child_test_blocks.find((b) => b.block === 'maths');
    expect(maths.photo_r2_key).toBe(`child-test/sandbox/school-1/${sess.id}/maths-strip.jpg`);
    expect(T().child_test_sessions[0].status).toBe('completed');
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toEqual([['sendCheck', sess.id]]);
    const timings = Object.keys(T().child_test_sessions[0].timings);
    for (const k of ['list.opened', 'child.tapped', 'child.present', 'urdu.prompt_sent', 'urdu.voice_received', 'maths.photo_received', 'check.sent']) {
      expect(timings).toContain(k);
    }
  });

  test('absent promotes the first alternate; the same list comes back on /egra', async () => {
    await H.handleText(PHONE, '/egra', COACH);
    const first = last('list');
    const ids = first.action.sections[0].rows.map((r) => r.id);
    const alt = first.action.sections[1].rows[0].id.split(':')[1];
    const absentId = ids[1].split(':')[1];
    await H.handleList(COACH, PHONE, `ctst_child:${absentId}`);
    await H.handleButton(COACH, PHONE, `ctst_pres:${absentId}:a`);
    const afterRows = last('list').action.sections[0].rows;
    const after = afterRows.map((r) => r.id);
    expect(after).toContain(`ctst_child:${alt}`);
    expect(after[after.length - 1]).toBe(`ctst_child:${absentId}`);   // still shown, last, marked
    expect(afterRows[afterRows.length - 1].description).toMatch(/Absent/);
    expect(last('list').body.text).toMatch(/of 5/);
    await H.handleText(PHONE, '/egra', COACH);
    expect(last('list').action.sections[0].rows.map((r) => r.id)).toEqual(after);
    expect(T().child_test_sessions).toHaveLength(0);
  });
});

// bd-s1oo0.11: no observe2 visit today → the list is drawn on a day key, through the REAL draw + store.
maybe('with L3\'s real draw and store, no observe2 visit (visit key)', () => {
  const COACH_ID = '11111111-1111-4111-8111-111111111111';
  const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
  const COACH = { id: COACH_ID, role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000002' };
  const PHONE = COACH.phone_number;
  let H; let ports; let lanes;
  const SAVED = { ...process.env };
  const T = () => mockDb.__tables;
  const last = (kind) => [...mockWa.__sent].reverse().find((m) => m.kind === kind);

  beforeAll(() => {
    ports = require('../../../bot/shared/services/child-test/conversation/ports');
    H = require('../../../bot/shared/handlers/child-test.handler');
  });
  beforeEach(() => {
    const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
    const { buildRoster } = require('../L3/helpers/roster');
    const seed = buildRoster({ schoolId: SCHOOL_ID, coachId: COACH_ID, classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    seed.users = [COACH];
    seed.observation_field_forms = [];
    seed.leader_schools = seed.leader_schools.map((r) => ({ ...r, school_name: 'SIM — Test School' }));
    mockDb = createFakeSupabase(seed, { unique: CHILD_TEST_UNIQUE });
    process.env.CHILD_TEST_ENABLED = 'true';
    Object.assign(process.env, V1_SWITCHES);
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
    process.env.CHILD_TEST_DRAW_SECRET = 'test-secret';
    process.env.RAILWAY_ENVIRONMENT = 'sandbox';
    mockRedis.__data.clear();
    mockWa.__sent.length = 0;
    lanes = createLaneFakes();
    ports.__setForTest({ scoring: lanes.scoring, checkFlow: lanes.checkFlow, render: lanes.render });
  });
  afterEach(() => H.__drain());
  afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

  test('/egra draws on day:<coach>:<school>:<date>; Present writes a session under the key; /egra again is the same list', async () => {
    const { pktDate } = require('../../../bot/shared/services/child-test/draw/visit-key');
    const key = `day:${COACH_ID}:${SCHOOL_ID}:${pktDate(new Date())}`;
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    const list = last('list');
    expect(list).toBeTruthy();
    const rows = list.action.sections[0].rows.map((r) => r.id);
    expect(rows).toHaveLength(5);
    expect(T().child_test_draws.filter((d) => d.visit_key === key).length).toBeGreaterThanOrEqual(5);
    const drawId = rows[0].split(':')[1];
    await H.handleList(COACH, PHONE, `ctst_child:${drawId}`);
    await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`);
    expect(T().child_test_sessions).toHaveLength(1);
    expect(T().child_test_sessions[0]).toMatchObject({ draw_id: drawId, visit_id: null, visit_key: key });
    await H.handleText(PHONE, '/egra', COACH);
    expect(last('list').action.sections[0].rows.map((r) => r.id)).toEqual(rows);
  });
});

test('this suite knows whether L3 is on the branch', () => {
  expect(typeof HAVE_L3).toBe('boolean');
});
