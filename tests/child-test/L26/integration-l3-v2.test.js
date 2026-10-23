/**
 * L26 (bd-s1oo0.46.2): the v2 coach journey against L3's REAL draw and store, on L3's in-memory
 * Supabase. Only the network boundary is replaced (Supabase client, WhatsApp, Redis, R2); scoring, the
 * check Flow and the review are contract fakes. The list is whatever the real draw returns today
 * (before L25's class fields land the stand-in list in steps.js builds it).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const HAVE_L3 = fs.existsSync(path.join(ROOT, 'bot/shared/services/child-test/draw/index.js'))
  && fs.existsSync(path.join(ROOT, 'tests/child-test/L3/helpers/fake-supabase.js'))
  && fs.existsSync(path.join(ROOT, 'tests/child-test/L3/helpers/roster.js'))
  && !/not_implemented/.test(fs.readFileSync(path.join(ROOT, 'bot/shared/services/child-test/store.js'), 'utf8'));

const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

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


mockWa.sendImageBufferWithButtons = jest.fn(async (to, buf, body, buttons) => { mockWa.__sent.push({ kind: 'imageButtons', to, body, buttons }); return true; });
const maybe = HAVE_L3 ? describe : describe.skip;

maybe('v2 with L3\'s real draw and store', () => {
  const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
  const PHONE = COACH.phone_number;
  let H; let ports; let lanes; let nudge; let review;
  const SAVED = { ...process.env };
  const T = () => mockDb.__tables;
  const sent = () => mockWa.__sent;
  const last = () => sent()[sent().length - 1];
  const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id } });

  beforeAll(() => {
    ports = require('../../../bot/shared/services/child-test/conversation/ports');
    H = require('../../../bot/shared/handlers/child-test.handler');
    nudge = require('../../../bot/shared/services/child-test/conversation/nudge');
  });
  beforeEach(() => {
    const { createFakeSupabase, CHILD_TEST_UNIQUE } = require('../L3/helpers/fake-supabase');
    const { buildRoster } = require('../L3/helpers/roster');
    const seed = buildRoster({ classes: [{ id: 'g3a', grade: 3, section: 'A', size: 25 }, { id: 'g5a', grade: 5, section: 'A', size: 25 }] });
    // A reachable, named class teacher (L25's draw names a room's teacher only when reachable: a phone, not deleted).
    seed.users = [COACH, { id: 'teacher-1', role: 'teacher', school_id: 'school-1', name: 'Test Teacher', phone_number: '923009990399' }];
    seed.class_teachers = [{ teacher_user_id: 'teacher-1', class_id: 'g3a', is_active: true, is_class_teacher: true }];
    seed.observation_field_forms[0] = { ...seed.observation_field_forms[0], teacher_user_id: 'teacher-1', created_at: new Date().toISOString() };
    mockDb = createFakeSupabase(seed, { unique: CHILD_TEST_UNIQUE });
    for (const k of ['CHILD_TEST_BATTERY', 'CHILD_TEST_MATHS_MODE', 'CHILD_TEST_CHECK_MODE', 'CHILD_TEST_STEP_NUDGE_MS']) delete process.env[k];
    process.env.CHILD_TEST_ENABLED = 'true';
    process.env.CHILD_TEST_OBSERVE_LINK = 'true';
    process.env.CHILD_TEST_DRAW_SECRET = 'test-secret';
    process.env.RAILWAY_ENVIRONMENT = 'sandbox';
    process.env.CHILD_TEST_SETUP_PICTURE_DIR = '/nonexistent-l26';
    mockRedis.__data.clear();
    sent().length = 0;
    lanes = createLaneFakes();
    review = { visitSummary: jest.fn(async () => 'summary'), sendReview: jest.fn(async () => ({ ok: true, items: 0 })) };
    ports.__setForTest({ scoring: lanes.scoring, checkFlow: lanes.checkFlow, render: lanes.render, review });
  });
  afterEach(() => H.__drain());
  afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

  test('one child end to end: real rows, no roll on screen, maths scored once, the next child follows; the nudge reads real open sessions', async () => {
    expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
    const list = last();
    expect(list.kind).toBe('buttons');
    expect(list.buttons.map((b) => b.id)).toEqual(['ctst_start', 'ctst_send_teachers']);
    expect(list.body).toMatch(/Grade 3 · 5 children/);
    await H.handleButton(COACH, PHONE, 'ctst_start');      // no picture on disk: caption + button as text
    expect(last().buttons[0].id).toBe('ctst_go');
    await H.handleButton(COACH, PHONE, 'ctst_go');
    const pres = last();
    expect(pres.body).toMatch(/^\*Child 1 of 5 · /);
    const drawId = pres.buttons[0].id.split(':')[1];
    await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`);
    expect(T().child_test_sessions).toHaveLength(1);
    expect(last().kind).toBe('text');
    expect(last().text).toMatch(/^\*1\/3 Urdu story · /);

    // the real store's open-session read drives the nudge
    const due = new Date(Date.now() + 241 * 1000);
    expect((await nudge.sweepOnce({ now: due })).sent).toBe(1);
    expect(last().text).toMatch(/Did the recording stop/);

    for (const b of ['u', 'e', 'm']) expect(await H.handleVoice(voice(`v2-${b}`), PHONE, COACH)).toBe(true);
    await H.__drain();
    expect(T().child_test_sessions[0].status).toBe('completed');
    expect(lanes.calls.filter((c) => c[0] === 'scoreBlock' && c[1].block === 'maths')).toHaveLength(1);
    expect(lanes.calls.filter((c) => c[0] === 'sendCheck')).toHaveLength(0);
    expect(last().body).toMatch(/done\. Thank the child\.\n\n\*Child 2 of 5 · /);
    const timings = Object.keys(T().child_test_sessions[0].timings);
    for (const k of ['urdu.prompt_sent', 'urdu.nudged', 'english.prompt_sent', 'maths.prompt_sent', 'child.done']) expect(timings).toContain(k);
    const all = sent().map((m) => [m.text, m.body, ...(m.buttons || []).map((x) => x.title)].join('\n')).join('\n');
    expect(all).not.toMatch(/roll|Child no\.|\bForm\b|strip/i);
    expect((await nudge.sweepOnce({ now: new Date(Date.now() + 3600 * 1000) })).sent).toBe(0);
  });
});
