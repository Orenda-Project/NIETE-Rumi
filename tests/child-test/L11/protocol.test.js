/**
 * The five-minute protocol in the coach's conversation (bd-s1oo0.12, lane L11):
 *   1. the class teacher sends the children (a list line; "Send to teacher" only for the class teacher)
 *   2. one short cue line per block (progress + cue + card page), the full script lives on the coach sheet
 *   3. the waiting child writes the strip; strip photos any time, or as a batch at the end, in list order
 *   4. one locked voice note per block, a 4-minute note included
 *   5. quick sums: one setting (bank maths.quick_sums_seconds, sandbox-only env override)
 * Mocked at the network boundary only (WhatsApp, Redis, R2, Supabase); other lanes are contract fakes.
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
// L20: the strip's child-number read goes to OpenRouter (network boundary): it reads no number here,
// so strip photos fall back to list order, as these scenarios expect.
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"child_no":null,"confidence":0}' } }], usage: { cost: 0 } }) } } })));

const { logError } = require('../../../bot/shared/utils/logger');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');
const itemBank = require('../../../bot/shared/services/child-test/item-bank');

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const TEACHER = { id: 'teacher-1', role: 'teacher', preferred_language: 'en', phone_number: '923000000099', school_id: 'school-1' };
const PHONE = COACH.phone_number;
let lanes;
const SAVED = { ...process.env };

function seedDb({ classTeacherOf = 'class-3a' } = {}) {
  mockDb = createFakeSupabase({
    users: [COACH, TEACHER],
    observation_field_forms: [{ id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1',
      visit_context: {}, created_at: new Date().toISOString() }],
    class_teachers: [{ teacher_user_id: 'teacher-1', class_id: classTeacherOf, is_active: true }],
    classes: [
      { id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: 'school-1', is_active: true },
      { id: 'class-4a', grade_code: 'grade_4', section: 'A', school_id: 'school-1', is_active: true },
    ],
    leader_schools: [{ leader_user_id: 'coach-1', school_id: 'school-1', school_name: 'SIM — School', emis: '111' }],
  });
}

const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const prompts = () => sent().filter((m) => m.kind === 'buttons' && /^\*Child \d of \d · /.test(m.body));
const voice = (id, extra = {}) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id, mime_type: 'audio/ogg', ...extra } });
const image = (id) => ({ id: `wamid.${id}`, image: { id, mime_type: 'image/jpeg' } });
const calls = (name) => lanes.calls.filter((c) => c[0] === name);

// L26 (bd-s1oo0.46.2): the v2 journey is the default now; these scenarios drive today's (v1) conversation.
const V1_SWITCHES = { CHILD_TEST_BATTERY: 'v1', CHILD_TEST_MATHS_MODE: 'strip', CHILD_TEST_CHECK_MODE: 'per_child' };
beforeAll(() => { Object.assign(process.env, V1_SWITCHES); });
afterAll(() => { for (const k of Object.keys(V1_SWITCHES)) delete process.env[k]; });

beforeEach(() => {
  process.env = { ...SAVED, ...V1_SWITCHES };
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  delete process.env.CHILD_TEST_QUICK_SUMS_SECONDS;
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

const openList = async () => expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
async function startChild(drawId) {
  expect(await H.handleList(COACH, PHONE, `ctst_child:${drawId}`)).toBe(true);
  expect(await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`)).toBe(true);
}
async function threeNotes(tag) {
  for (const b of ['u', 'e', 'm']) expect(await H.handleVoice(voice(`${tag}-${b}`), PHONE, COACH)).toBe(true);
}

// ------------------------------------------------------------------ 1. the class teacher sends the children

describe('the class teacher sends the children', () => {
  test('the list tells the coach which children to ask the class teacher for, name first, in order', async () => {
    await openList();
    expect(last('list').body.text).toMatch(/class teacher.*in this order: Child 3A-01 · roll 1, Child 3A-02 · roll 2, Child 3A-03 · roll 3, Child 3A-04 · roll 4, Child 3A-05 · roll 5/s);
  });

  test('Urdu list line: Urdu digits, list order', async () => {
    const UR = { ...COACH, preferred_language: 'ur' };
    await H.handleText(PHONE, '/egra', UR);
    expect(last('list').body.text).toMatch(/کلاس ٹیچر.*Child 3A-01.* · رول ۱، .*Child 3A-02.* · رول ۲، .*رول ۳، .*رول ۴، .*رول ۵/s);
  });

  test('the line drops a child already tested and shows the promoted alternate in order', async () => {
    await openList(); await startChild('d1'); await threeNotes('a');
    await H.handleList(COACH, PHONE, 'ctst_child:d2');
    await H.handleButton(COACH, PHONE, 'ctst_pres:d2:a');
    expect(last('list').body.text).toMatch(/in this order[^\n]*: Child 3A-03 · roll 3, Child 3A-04 · roll 4, Child 3A-06 · roll 6, Child 3A-05 · roll 5/);
  });

  test('observed teacher is the class teacher of the drawn class: one "Send to teacher" button, once per visit', async () => {
    await openList();
    const offers = sent().filter((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id === 'ctst_tsend'));
    expect(offers).toHaveLength(1);
    for (const b of offers[0].buttons) expect([...b.title].length).toBeLessThanOrEqual(20);
    await openList();
    expect(sent().filter((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id === 'ctst_tsend'))).toHaveLength(1);
  });

  test('observed teacher teaches another class: no button', async () => {
    seedDb({ classTeacherOf: 'class-4a' });
    await openList();
    expect(sent().some((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id === 'ctst_tsend'))).toBe(false);
    expect(last('list').body.text).toMatch(/class teacher/);
  });

  test('"Send to teacher" sends the teacher ONE message with the children in order, name first, to nobody else', async () => {
    await openList();
    const before = sent().length;
    expect(await H.handleButton(COACH, PHONE, 'ctst_tsend')).toBe(true);
    const out = sent().slice(before);
    const toTeacher = out.filter((m) => m.to === TEACHER.phone_number);
    expect(toTeacher).toHaveLength(1);
    expect(toTeacher[0].kind).toBe('text');
    expect(toTeacher[0].text).toMatch(/Child 3A-01 · roll 1, Child 3A-02 · roll 2, Child 3A-03 · roll 3, Child 3A-04 · roll 4, Child 3A-05 · roll 5\./);
    expect(out.every((m) => m.to === TEACHER.phone_number || m.to === PHONE)).toBe(true);
    expect(out.find((m) => m.to === PHONE).text).toMatch(/Sent the order to the class teacher/);
  });

  test('the gate is re-checked at the tap: no longer the class teacher → nothing sent to the teacher', async () => {
    await openList();
    mockDb.__tables.class_teachers[0].is_active = false;
    const before = sent().length;
    await H.handleButton(COACH, PHONE, 'ctst_tsend');
    expect(sent().slice(before).some((m) => m.to === TEACHER.phone_number)).toBe(false);
  });

  test('a failed send to the teacher is told to the coach and logged at error', async () => {
    await openList();
    mockWa.__ok.text = false;
    await H.handleButton(COACH, PHONE, 'ctst_tsend');
    expect(logError).toHaveBeenCalledWith('child_test.teacher_send_failed', expect.objectContaining({ visitId: 'form-1' }));
    expect(sent().filter((m) => m.to === PHONE).pop().text).toMatch(/couldn't reach the class teacher/);
  });
});

// ------------------------------------------------------------------ 2. short cue lines

describe('one short cue line per block', () => {
  test('each block prompt is one line: progress, the card page, the exact cue, the locked note', async () => {
    await openList(); await startChild('d5');   // last on the list: no strip hand-over line
    for (const b of ['u', 'e']) await H.handleVoice(voice(`s-${b}`), PHONE, COACH);
    const [u, e, m] = prompts();
    for (const p of [u, e, m]) expect(p.body.split('\n')).toHaveLength(1);
    expect(u.body).toMatch(/^\*Child 5 of 5 · Child 3A-05 · roll 5 · Urdu 1\/3\* · Form B card, Urdu page · Say «شروع» · /);
    expect(e.body).toMatch(/English page · Say «start»/);
    expect(u.body).toMatch(/locked/i);
    expect(u.buttons.map((b) => b.id)).toEqual(['ctst_fb', 'ctst_stop', 'ctst_menu']);
    expect(e.buttons.map((b) => b.id)).toContain('ctst_fb');
  });

  test('maths names the numbers cue, then the quick-sums cue with its seconds', async () => {
    await openList(); await startChild('d5');
    for (const b of ['u', 'e']) await H.handleVoice(voice(`m-${b}`), PHONE, COACH);
    const m = prompts().pop().body;
    const iNum = m.indexOf('«اب یہ نمبر باری باری پڑھیں»');
    const iQs = m.indexOf('«اب سوال شروع کریں»');
    expect(iNum).toBeGreaterThan(-1);
    expect(iQs).toBeGreaterThan(iNum);
    expect(m).toMatch(/60 s of quick sums/);
  });
});

// ------------------------------------------------------------------ 3. the waiting child writes the strip

describe('the waiting child writes the strip; photos any time or batched', () => {
  test('Present for child N tells the coach to hand the strip to the next child on the list', async () => {
    await openList(); await startChild('d1');
    const u = prompts().pop().body.split('\n');
    expect(u).toHaveLength(2);
    expect(u[1]).toBe('While waiting, give Child 3A-02 · roll 2 the maths strip: write 2 in its Child no. box first.');   // L20
  });

  test('a strip photo sent mid-visit is claimed for the oldest child whose strip is missing; held until that child starts', async () => {
    await openList(); await startChild('d1');
    // child 1 is on Urdu; two photos arrive: the first is child 1's, the second child 2's (handed over)
    expect(await H.handleImage(image('p1'), PHONE, COACH)).toBe(true);
    expect(calls('attachBlockMedia').pop()[1]).toEqual({ sessionId: 'sess-1', block: 'maths', photoR2Key: 'child-test/sandbox/school-1/sess-1/maths-strip.jpg' });
    expect(last('text').text).toMatch(/saved for the next in order: Child 3A-01 · roll 1 \(no\. 1\)/);   // L20: no number read → list order
    expect(await H.handleImage(image('p2'), PHONE, COACH)).toBe(true);
    expect(mockR2.uploadBuffer).toHaveBeenLastCalledWith(expect.any(Buffer), 'child-test/sandbox/school-1/held/d2/maths-strip.jpg', 'image/jpeg');
    expect(last('text').text).toMatch(/saved for the next in order: Child 3A-02 · roll 2 \(no\. 2\)/);
    // a third photo: nobody else has a strip (child 3 has not been handed one) → not the child test's
    expect(await H.handleImage(image('p3'), PHONE, COACH)).toBe(false);

    // child 1's maths note: the photo is already in, so the child finishes at once (scored once, with force)
    await threeNotes('c1');
    await H.__drain();
    expect(calls('scoreBlock').map((c) => c[1].block)).toEqual(['urdu', 'english', 'maths']);
    expect(sent().some((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id === 'ctst_nophoto:sess-1'))).toBe(false);
    expect(calls('sendCheck')).toEqual([['sendCheck', 'sess-1']]);

    // child 2 starts: the held strip is attached to the new session
    await startChild('d2');
    expect(calls('attachBlockMedia').pop()[1]).toEqual({ sessionId: 'sess-2', block: 'maths', photoR2Key: 'child-test/sandbox/school-1/held/d2/maths-strip.jpg' });
    expect(lanes.sessions['sess-2'].timings['maths.photo_received']).toBeTruthy();
  });

  test('the coach moves on without waiting; at the end, a batch of photos is claimed in list order', async () => {
    await openList();
    for (const [i, d] of ['d1', 'd2', 'd3', 'd4', 'd5'].entries()) { await startChild(d); await threeNotes(`b${i}`); }
    const batch = sent().filter((m) => /Send the strip photos now, one per child, in any order/.test(m.body || m.text || '')).pop();
    expect(batch).toBeTruthy();
    expect(batch.body || batch.text).toMatch(/Child 3A-01 · roll 1 \(no\. 1\), Child 3A-02 · roll 2 \(no\. 2\), Child 3A-03 · roll 3 \(no\. 3\), Child 3A-04 · roll 4 \(no\. 4\), Child 3A-05 · roll 5 \(no\. 5\)/);
    expect(calls('sendCheck')).toHaveLength(0);
    for (let i = 1; i <= 5; i++) expect(await H.handleImage(image(`end-${i}`), PHONE, COACH)).toBe(true);
    await H.__drain();
    const photos = calls('attachBlockMedia').filter((c) => c[1].photoR2Key).map((c) => c[1].sessionId);
    expect(photos).toEqual(['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5']);
    expect(calls('sendCheck').map((c) => c[1])).toEqual(['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5']);
    expect(calls('scoreBlock').filter((c) => c[1].block === 'maths').every((c) => c[1].force === true)).toBe(true);
  });

  test('"No strip photo" still finishes a child whose strip never came', async () => {
    await openList(); await startChild('d5'); await threeNotes('n');
    expect(await H.handleButton(COACH, PHONE, 'ctst_nophoto:sess-1')).toBe(true);
    await H.__drain();
    expect(calls('sendCheck')).toEqual([['sendCheck', 'sess-1']]);
  });

  test('before any child is present, a photo is not the child test\'s', async () => {
    await openList();
    expect(await H.handleImage(image('early'), PHONE, COACH)).toBe(false);
  });
});

// ------------------------------------------------------------------ 4. one locked note through card flips

describe('a long locked voice note', () => {
  test('a 4-minute, 2 MB block note is claimed and stored like any other', async () => {
    mockWa.downloadMedia.mockImplementationOnce(async () => Buffer.alloc(2 * 1024 * 1024, 1));
    await openList(); await startChild('d5');
    expect(await H.handleVoice(voice('long', { duration: 240 }), PHONE, COACH)).toBe(true);
    expect(mockR2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'child-test/sandbox/school-1/sess-1/urdu.ogg', 'audio/ogg');
    expect(mockR2.uploadBuffer.mock.calls[0][0].length).toBe(2 * 1024 * 1024);
    expect(calls('attachBlockMedia')[0][1]).toMatchObject({ block: 'urdu' });
  });
});

// ------------------------------------------------------------------ 5. quick sums, one setting

describe('quick-sums seconds: one setting', () => {
  test('the bank says 60 for every grade and form, and the accessor reads it', () => {
    for (const g of [3, 5]) for (const f of ['A', 'B']) {
      expect(itemBank.getBlock(g, f, 'maths').quick_sums_seconds).toBe(60);
      expect(itemBank.quickSumsSeconds(g, f)).toBe(60);
    }
  });

  test('CHILD_TEST_QUICK_SUMS_SECONDS=30 is honoured on sandbox', () => {
    process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '30';
    expect(itemBank.quickSumsSeconds(3, 'A')).toBe(30);
  });

  test('the override is ignored outside sandbox', () => {
    process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '30';
    process.env.RAILWAY_ENVIRONMENT = 'production';
    process.env.DEFAULT_REGION = 'niete';
    delete process.env.CHILD_TEST_R2_ENV;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    expect(itemBank.quickSumsSeconds(3, 'A')).toBe(60);
  });

  test('a value other than 30 or 60 is ignored and logged', () => {
    process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '45';
    expect(itemBank.quickSumsSeconds(5, 'B')).toBe(60);
    expect(logError).toHaveBeenCalledWith('child_test.quick_sums_override_invalid', expect.objectContaining({ value: '45' }));
  });

  test('the maths prompt reads the same accessor (30 under the override)', async () => {
    process.env.CHILD_TEST_QUICK_SUMS_SECONDS = '30';
    await openList(); await startChild('d5');
    for (const b of ['u', 'e']) await H.handleVoice(voice(`q-${b}`), PHONE, COACH);
    expect(prompts().pop().body).toMatch(/30 s of quick sums/);
  });

  test('the coach sheet prints the quick-sums seconds it is given; the story stays 60', () => {
    const html = require('../../../bot/shared/services/child-test/render/html');
    const form = itemBank.getForm(3, 'A');
    const out30 = html.buildCoachSheetHtml({ grade: 3, formCode: 'A', form, lang: 'en', cue: itemBank.cue, quickSumsSeconds: 30 });
    expect(out30).toMatch(/Quick sums \(30 seconds\)/);
    expect(out30).toMatch(/After 30 seconds, say/);
    expect(out30).toMatch(/After 60 seconds, say/);   // the story's stop line
    const out60 = html.buildCoachSheetHtml({ grade: 3, formCode: 'A', form, lang: 'ur', cue: itemBank.cue });
    expect(out60).toMatch(/فوری جمع تفریق \(60 سیکنڈ\)/);
  });
});
