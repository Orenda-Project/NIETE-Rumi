/**
 * L20 (bd-s1oo0.38) — each strip carries the child's number and goes to that child.
 *
 * The coach writes the child's number (their place on today's list) in the strip's box; when a photo
 * arrives the bot reads that number (one quick vision call, bounded) and attaches the photo to that
 * child if their strip is outstanding. Otherwise it falls back to list order and says so. The ack
 * always names the child it was saved for. Every strip line names the child, name first.
 *
 * Mocked at the network boundary only: WhatsApp, Redis, R2, Supabase, OpenRouter (the openai SDK).
 * The other lanes are their contract fakes (L4 helpers), as in the L4/L11 suites.
 */
const { createFakeRedis, createWhatsAppRecorder } = require('../L4/helpers/boundary');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');
const { createLaneFakes } = require('../L4/helpers/lane-fakes');

const mockRedis = createFakeRedis();
const mockWa = createWhatsAppRecorder();
const mockR2 = { uploadBuffer: jest.fn(async (buf, key) => `https://r2.example/${key}`) };
const mockCreate = jest.fn();
let mockDb;
jest.mock('../../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../../bot/shared/services/whatsapp.service', () => mockWa);
jest.mock('../../../bot/shared/storage/r2', () => mockR2);
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.from(t) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/services/menu.service', () => ({ sendMenu: jest.fn(async () => true) }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } })));

const { logToFile } = require('../../../bot/shared/utils/logger');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const UR = { ...COACH, preferred_language: 'ur' };
const PHONE = COACH.phone_number;
let lanes;
const SAVED = { ...process.env };

// What the model "reads" on each photo: media id → { child_no, confidence, ms }.
let READS = {};
mockCreate.mockImplementation(async (req) => {
  const url = req.messages[0].content[1].image_url.url;
  const id = Buffer.from(url.split(',')[1], 'base64').toString().replace(/^media:/, '');
  const r = READS[id] || { child_no: null, confidence: 0 };
  await new Promise((res) => setTimeout(res, r.ms || 1));
  if (r.fail) throw new Error('502');
  return { choices: [{ message: { content: JSON.stringify({ child_no: r.child_no, confidence: r.confidence }) } }], usage: { cost: 0.002 } };
});

const sent = () => mockWa.__sent;
const texts = () => sent().map((m) => m.text || (typeof m.body === 'string' ? m.body : (m.body && m.body.text)) || '');
const voice = (id) => ({ id: `wamid.${id}`, timestamp: String(Math.floor(Date.now() / 1000) + 5), audio: { id, mime_type: 'audio/ogg' } });
const image = (id) => ({ id: `wamid.${id}`, image: { id, mime_type: 'image/jpeg' } });
const calls = (name) => lanes.calls.filter((c) => c[0] === name);
const photoAttaches = () => calls('attachBlockMedia').filter((c) => c[1].photoR2Key).map((c) => [c[1].sessionId, c[1].photoR2Key]);
const name = (n) => `Child 3A-${String(n).padStart(2, '0')}`;

beforeEach(() => {
  process.env = { ...SAVED };
  Object.assign(process.env, { CHILD_TEST_ENABLED: 'true', CHILD_TEST_OBSERVE_LINK: 'true', DEFAULT_REGION: 'niete-sandbox', RAILWAY_ENVIRONMENT: 'sandbox', OPENROUTER_API_KEY: 'k' });
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
  READS = {};
  mockDb = createFakeSupabase({
    users: [COACH],
    observation_field_forms: [{ id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1', visit_context: {}, created_at: new Date().toISOString() }],
    class_teachers: [],
    classes: [{ id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: 'school-1', is_active: true }],
    leader_schools: [{ leader_user_id: 'coach-1', school_id: 'school-1', school_name: 'SIM — School', emis: '111' }],
  });
  lanes = createLaneFakes();
  ports.__setForTest(lanes);
});
afterEach(() => H.__drain());
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

const openList = async (u = COACH) => expect(await H.handleText(PHONE, '/egra', u)).toBe(true);
async function startChild(drawId, u = COACH) {
  expect(await H.handleList(u, PHONE, `ctst_child:${drawId}`)).toBe(true);
  expect(await H.handleButton(u, PHONE, `ctst_pres:${drawId}:p`)).toBe(true);
}
async function threeNotes(tag, u = COACH) {
  for (const b of ['u', 'e', 'm']) expect(await H.handleVoice(voice(`${tag}-${b}`), PHONE, u)).toBe(true);
}
async function testAll(u = COACH) {
  await openList(u);
  for (const [i, d] of ['d1', 'd2', 'd3', 'd4', 'd5'].entries()) { await startChild(d, u); await threeNotes(`t${i}`, u); }
}

describe('a strip goes to the child whose number it carries', () => {
  test('a batch sent out of order, arriving together, lands on the right children', async () => {
    await testAll();
    const order = [3, 1, 5, 2, 4];
    order.forEach((n, i) => { READS[`s${n}`] = { child_no: n, confidence: 0.97, ms: 40 - i * 8 }; });
    const r = await Promise.all(order.map((n) => H.handleImage(image(`s${n}`), PHONE, COACH)));
    expect(r.every(Boolean)).toBe(true);
    await H.__drain();
    const attached = Object.fromEntries(photoAttaches().map(([s, k]) => [s, k]));
    for (const n of [1, 2, 3, 4, 5]) expect(attached[`sess-${n}`]).toBe(`child-test/sandbox/school-1/sess-${n}/maths-strip.jpg`);
    expect(photoAttaches()).toHaveLength(5);
    // each ack names the child it was saved for, name first, with the number
    for (const n of [1, 2, 3, 4, 5]) expect(texts().some((t) => t.includes(`Strip no. ${n} saved for ${name(n)}`))).toBe(true);
    expect(calls('sendCheck').map((c) => c[1]).sort()).toEqual(['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5']);
    // no name in what went to the model
    for (const [req] of mockCreate.mock.calls) expect(JSON.stringify(req.messages[0].content[0])).not.toMatch(/Child 3A/);
  });

  test('a strip for a child still waiting (handed the strip) is held under that child, not the oldest', async () => {
    await openList(); await startChild('d1');
    READS.h2 = { child_no: 2, confidence: 0.95 };
    expect(await H.handleImage(image('h2'), PHONE, COACH)).toBe(true);
    expect(mockR2.uploadBuffer).toHaveBeenLastCalledWith(expect.any(Buffer), 'child-test/sandbox/school-1/held/d2/maths-strip.jpg', 'image/jpeg');
    expect(photoAttaches()).toHaveLength(0);
    expect(texts().pop()).toMatch(`Strip no. 2 saved for ${name(2)}`);
  });

  test('an unreadable number falls back to list order and says so', async () => {
    await testAll();
    READS.u1 = { child_no: null, confidence: 0 };
    expect(await H.handleImage(image('u1'), PHONE, COACH)).toBe(true);
    expect(photoAttaches()).toEqual([['sess-1', 'child-test/sandbox/school-1/sess-1/maths-strip.jpg']]);
    expect(texts().find((t) => /couldn't read a child number/.test(t))).toMatch(name(1));
    expect(logToFile).toHaveBeenCalledWith('child_test.strip_matched', expect.objectContaining({ by: 'order', reason: 'unread' }));
  });

  test('a low-confidence read, a model error and a number not on the list all fall back to order', async () => {
    await testAll();
    READS.a = { child_no: 4, confidence: 0.5 };
    READS.b = { fail: true };
    READS.c = { child_no: 9, confidence: 0.99 };
    for (const id of ['a', 'b', 'c']) expect(await H.handleImage(image(id), PHONE, COACH)).toBe(true);
    expect(photoAttaches().map((p) => p[0])).toEqual(['sess-1', 'sess-2', 'sess-3']);
    expect(texts().some((t) => /Child no\. 9 is not waiting for a strip/.test(t) && t.includes(name(3)))).toBe(true);
  });

  test('a number for a child whose strip is already in is not overwritten', async () => {
    await testAll();
    READS.first = { child_no: 2, confidence: 0.98 };
    READS.again = { child_no: 2, confidence: 0.98 };
    expect(await H.handleImage(image('first'), PHONE, COACH)).toBe(true);
    expect(await H.handleImage(image('again'), PHONE, COACH)).toBe(true);
    expect(photoAttaches()).toEqual([['sess-2', 'child-test/sandbox/school-1/sess-2/maths-strip.jpg']]);
    expect(mockR2.uploadBuffer.mock.calls.filter((c) => /maths-strip/.test(c[1]))).toHaveLength(1);
    expect(texts().pop()).toMatch(new RegExp(`${name(2)}.*already in, so this photo was not used`));
  });

  test('a number for a child whose photo was declined is not overwritten either', async () => {
    await openList(); await startChild('d1'); await threeNotes('x');
    expect(await H.handleButton(COACH, PHONE, 'ctst_nophoto:sess-1')).toBe(true);
    await startChild('d2');
    READS.late = { child_no: 1, confidence: 0.99 };
    expect(await H.handleImage(image('late'), PHONE, COACH)).toBe(true);
    expect(photoAttaches()).toHaveLength(0);
    expect(texts().pop()).toMatch(/already in, so this photo was not used|not waiting/);
  });
});

describe('every strip line names the child, name first', () => {
  test('the hand-over line names the next child and the number to write', async () => {
    await openList(); await startChild('d1');
    const prompt = sent().filter((m) => m.kind === 'buttons' && /^\*Child 1 of 5/.test(m.body)).pop().body;
    expect(prompt.split('\n')[1]).toBe(`While waiting, give ${name(2)} the maths strip: write 2 in its Child no. box first.`);
  });

  test('the strip ask, the batch line, "saved" and "three parts" name the child', async () => {
    await testAll();
    expect(texts().some((t) => t.startsWith(`${name(1)}'s strip (Child no. 1)`))).toBe(true);
    const batch = texts().filter((t) => /Send the strip photos now/.test(t)).pop();
    expect(batch).toMatch(`${name(1)} (no. 1), ${name(2)} (no. 2)`);
    expect(batch).toMatch(/in any order/);
    READS.p = { child_no: 3, confidence: 0.9 };
    await H.handleImage(image('p'), PHONE, COACH);
    expect(texts()).toContain(`✅ All three parts for ${name(3)} are in. The marks are being worked out; a Check button follows.`);
  });

  test('Urdu: the hand-over line, with Urdu digits', async () => {
    await openList(UR); await startChild('d1', UR);
    const prompt = sent().filter((m) => m.kind === 'buttons' && /بچہ ۱ از ۵/.test(m.body)).pop().body;
    expect(prompt.split('\n')[1]).toMatch(/«بچہ نمبر» کے خانے میں ۲ لکھیں/);
    expect(prompt.split('\n')[1]).toMatch(name(2));
  });

  test('a child without a roll is named alone, never "null"', async () => {
    await openList();
    lanes.lists['form-1'].children[1].rollNumber = null;
    await startChild('d1');
    const line = sent().filter((m) => m.kind === 'buttons' && /^\*Child 1 of 5/.test(m.body)).pop().body.split('\n')[1];
    expect(line).toBe(`While waiting, give ${name(2)} the maths strip: write 2 in its Child no. box first.`);
  });
});
