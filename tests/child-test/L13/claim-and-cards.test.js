/**
 * L13 (bd-s1oo0.17), two bugs the simulation found (lanes/L12/REPORT.md):
 *
 *   bd-s1oo0.14  a voice note that arrives before the previous one is stored was filed under the SAME
 *                block and overwrote its audio. Now each note claims its block (Redis setNX) before
 *                any ack, download or upload, so N quick notes fill N distinct blocks in arrival order.
 *   bd-s1oo0.15  8–9 card images per block queued the prompt and the ack behind Meta's pair rate
 *                (35–60 s a block). The printed card is the stimulus (CONTRACT §11): no card images by
 *                default; CHILD_TEST_INCHAT_CARDS=on sends the prompt first, then ≤ 3 images; the card
 *                button sends a block's cards on demand, ≤ 3 per tap.
 *
 * The real machine through the L4 handler; mocked at the network boundary only (WhatsApp, Redis, R2,
 * Supabase). Downloads are slowed so concurrent notes really overlap the store.
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

const { logError } = require('../../../bot/shared/utils/logger');
const ports = require('../../../bot/shared/services/child-test/conversation/ports');
const H = require('../../../bot/shared/handlers/child-test.handler');
const { t } = require('../../../bot/shared/services/child-test/conversation/copy');
const getString = (key, lang, params) => t(lang, key, params);

const COACH = { id: 'coach-1', role: 'coach', region: 'niete', preferred_language: 'en', phone_number: '923000000001' };
const PHONE = COACH.phone_number;
const SAVED = { ...process.env };
let lanes;

const sent = () => mockWa.__sent;
const last = (kind) => [...sent()].reverse().find((m) => !kind || m.kind === kind);
const calls = (name) => lanes.calls.filter((c) => c[0] === name);
const audioAttaches = () => calls('attachBlockMedia').map((c) => c[1]).filter((a) => a.audioR2Key);
const voice = (id, ts = Math.floor(Date.now() / 1000) + 5) => ({ id: `wamid.${id}`, timestamp: String(ts), audio: { id, mime_type: 'audio/ogg' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedDb() {
  mockDb = createFakeSupabase({
    users: [COACH],
    observation_field_forms: [{ id: 'form-1', observer_user_id: 'coach-1', teacher_user_id: 'teacher-1',
      visit_context: { school_ext_id: 'niete:111' }, created_at: new Date().toISOString() }],
    class_teachers: [{ teacher_user_id: 'teacher-1', class_id: 'class-3a', is_active: true }],
    classes: [{ id: 'class-3a', grade_code: 'grade_3', section: 'A', school_id: 'school-1', is_active: true }],
    leader_schools: [{ leader_user_id: 'coach-1', school_id: 'school-1', school_name: 'SIM — School', emis: '111' }],
  });
}

/** A block's main cards as L2 renders them: a G3 Urdu block is 9 images (CONTRACT §11 item 6). */
function nineCards(variant) {
  const n = variant === 'fallback' ? 2 : 9;
  return Array.from({ length: n }, (_, i) => ({
    part: variant === 'fallback' ? 'fallback_letters' : (i < 3 ? 'story' : 'nonwords'),
    index: i + 1, png: Buffer.from(`${variant}-${i + 1}`), text: `${variant} card ${i + 1}`,
  }));
}

beforeEach(() => {
  process.env = { ...SAVED };
  process.env.CHILD_TEST_ENABLED = 'true';
  process.env.CHILD_TEST_OBSERVE_LINK = 'true';   // these scenarios open the list through the observe2 visit
  process.env.DEFAULT_REGION = 'niete-sandbox';
  process.env.RAILWAY_ENVIRONMENT = 'sandbox';
  delete process.env.CHILD_TEST_INCHAT_CARDS;
  mockRedis.__data.clear();
  mockWa.__sent.length = 0;
  Object.assign(mockWa.__ok, { text: true, buttons: true, list: true, image: true });
  jest.clearAllMocks();
  // The download takes real time, so a second note arrives while the first is still being stored.
  mockWa.downloadMedia.mockImplementation(async (id) => { await sleep(15); return Buffer.from(`media:${id}`); });
  mockR2.uploadBuffer.mockImplementation(async (buf, key) => { await sleep(5); return `https://r2.example/${key}`; });
  seedDb();
  lanes = createLaneFakes();
  ports.__setForTest(lanes);
});
afterEach(() => H.__drain());
afterAll(() => { process.env = SAVED; ports.__setForTest(null); });

async function startChild(drawId = 'd1') {
  expect(await H.handleText(PHONE, '/egra', COACH)).toBe(true);
  expect(await H.handleList(COACH, PHONE, `ctst_child:${drawId}`)).toBe(true);
  expect(await H.handleButton(COACH, PHONE, `ctst_pres:${drawId}:p`)).toBe(true);
}

// ------------------------------------------------------------------ bd-s1oo0.14

describe('claim before store (bd-s1oo0.14)', () => {
  test('three notes fired together fill three distinct blocks, three R2 keys, one attach each; the child ends at the strip photo', async () => {
    await startChild('d1');
    const res = await Promise.all(['n1', 'n2', 'n3'].map((id) => H.handleVoice(voice(id), PHONE, COACH)));
    expect(res).toEqual([true, true, true]);
    await H.__drain();

    const att = audioAttaches();
    expect(att.map((a) => a.block).sort()).toEqual(['english', 'maths', 'urdu']);
    expect(new Set(att.map((a) => a.audioR2Key)).size).toBe(3);
    for (const b of ['urdu', 'english', 'maths']) expect(att.filter((a) => a.block === b)).toHaveLength(1);
    expect(mockR2.uploadBuffer.mock.calls.map((c) => c[1]).sort()).toEqual([
      'child-test/sandbox/school-1/sess-1/english.ogg',
      'child-test/sandbox/school-1/sess-1/maths.ogg',
      'child-test/sandbox/school-1/sess-1/urdu.ogg',
    ]);
    // in arrival order: n1 → urdu, n2 → english, n3 → maths
    const byKey = Object.fromEntries(mockWa.downloadMedia.mock.calls.map((c, i) => [c[0], i]));
    expect(Object.keys(byKey).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(lanes.blocks['sess-1:urdu'].audio_r2_key).toMatch(/urdu\.ogg$/);
    expect(lanes.blocks['sess-1:english'].audio_r2_key).toMatch(/english\.ogg$/);
    expect(lanes.blocks['sess-1:maths'].audio_r2_key).toMatch(/maths\.ogg$/);

    // Each ack names its own block; the maths branch (photo ask) ran exactly once.
    const acks = sent().filter((m) => m.kind === 'text' && /^🎧 Got it/.test(m.text)).map((m) => m.text).sort();
    expect(acks).toEqual(['🎧 Got it · English', '🎧 Got it · Maths', '🎧 Got it · Urdu']);
    expect(sent().filter((m) => m.kind === 'buttons' && /Roll 1's strip: send its photo/.test(m.body))).toHaveLength(1);
    const state = JSON.parse(mockRedis.__data.get('ctst:state:coach-1'));
    expect(state.step).toBe('list');
    expect(state.pendingPhotos.map((p) => p.sessionId)).toEqual(['sess-1']);
    expect(calls('scoreBlock').map((c) => c[1].block).sort()).toEqual(['english', 'urdu']);
  });

  test('a prompt for a block another note already claimed is not sent (the ack waited on the pacer)', async () => {
    await startChild('d1');
    // The Urdu ack takes a while (the pacer); the English note lands meanwhile and takes English.
    const orig = mockWa.sendMessage.getMockImplementation();
    let release;
    const gate = new Promise((r) => { release = r; });
    mockWa.sendMessage.mockImplementationOnce(async (to, text) => { await gate; mockWa.__sent.push({ kind: 'text', to, text }); return true; });
    const first = H.handleVoice(voice('p1'), PHONE, COACH);
    await sleep(5);
    const second = H.handleVoice(voice('p2'), PHONE, COACH);
    await sleep(5);
    release();
    await Promise.all([first, second]);
    await H.__drain();
    mockWa.sendMessage.mockImplementation(orig);
    const englishPrompts = sent().filter((m) => m.kind === 'buttons' && /English 2\/3/.test(m.body));
    expect(englishPrompts).toHaveLength(0);
    expect(sent().filter((m) => m.kind === 'buttons' && /Maths 3\/3/.test(m.body))).toHaveLength(1);
  });

  test('a fourth note while the three are in: the coach is told the notes are already in, nothing is stored', async () => {
    await startChild('d1');
    await Promise.all(['f1', 'f2', 'f3', 'f4'].map((id) => H.handleVoice(voice(id), PHONE, COACH)));
    await H.__drain();
    expect(audioAttaches()).toHaveLength(3);
    expect(mockR2.uploadBuffer).toHaveBeenCalledTimes(3);
    expect(sent().filter((m) => m.kind === 'text' && /Roll 1's three voice notes are already in/.test(m.text))).toHaveLength(1);
  });

  test('an English upload failure releases the claim, tells the coach, and the next note lands as English', async () => {
    let failEnglish = true;
    mockR2.uploadBuffer.mockImplementation(async (buf, key) => {
      await sleep(5);
      if (failEnglish && key.endsWith('/english.ogg')) { failEnglish = false; throw new Error('R2 down'); }
      return `https://r2.example/${key}`;
    });
    await startChild('d1');
    await Promise.all(['e1', 'e2', 'e3'].map((id) => H.handleVoice(voice(id), PHONE, COACH)));
    await H.__drain();
    expect(sent().some((m) => m.kind === 'text' && /The English voice note did not save/.test(m.text))).toBe(true);
    expect(logError).toHaveBeenCalledWith('child_test.audio_save_failed', expect.objectContaining({ block: 'english' }));
    expect(audioAttaches().map((a) => a.block).sort()).toEqual(['maths', 'urdu']);
    // Not finished while English is missing: no photo ask yet, still taking a note.
    expect(sent().some((m) => m.kind === 'buttons' && /strip: send its photo/.test(m.body))).toBe(false);
    expect(mockRedis.__data.has('ctst:block:sess-1:english')).toBe(false);

    expect(await H.handleVoice(voice('e2-again'), PHONE, COACH)).toBe(true);
    await H.__drain();
    expect(audioAttaches().filter((a) => a.block === 'english')).toHaveLength(1);
    expect(lanes.blocks['sess-1:english'].audio_r2_key).toMatch(/english\.ogg$/);
    expect(sent().filter((m) => m.kind === 'buttons' && /Roll 1's strip: send its photo/.test(m.body))).toHaveLength(1);
  });

  test('resume after a restart: the first block with no audio is where both the prompt and the next note go', async () => {
    await startChild('d1');
    await Promise.all(['r1', 'r2'].map((id) => H.handleVoice(voice(id), PHONE, COACH)));
    await H.__drain();
    expect(audioAttaches().map((a) => a.block).sort()).toEqual(['english', 'urdu']);
    // A third note claimed maths and the process died before the upload: the claim is held, no audio.
    await mockRedis.setNX('ctst:block:sess-1:maths', JSON.stringify({ audioId: 'lost', at: new Date().toISOString() }));
    await H.handleText(PHONE, '/cancel', COACH);
    expect(await H.handleList(COACH, PHONE, 'ctst_child:d1')).toBe(true);
    expect(last('buttons').body).toMatch(/Maths 3\/3/);
    expect(await H.handleVoice(voice('r3'), PHONE, COACH)).toBe(true);
    await H.__drain();
    expect(audioAttaches().map((a) => a.block).sort()).toEqual(['english', 'maths', 'urdu']);
    expect(sent().some((m) => m.kind === 'text' && /already in/.test(m.text))).toBe(false);
  });

  test('an unexpected throw after the claim gives the block back: the coach is told and the same note saves next time', async () => {
    await startChild('d1');
    mockRedis.setexWithCeiling = jest.fn()
      .mockImplementationOnce(async () => { throw new Error('redis blip'); })
      .mockImplementation(async (k, _ttl, v) => mockRedis.set(k, v));
    expect(await H.handleVoice(voice('t1'), PHONE, COACH)).toBe(true);
    expect(logError).toHaveBeenCalledWith('child_test.voice_failed', expect.objectContaining({ sessionId: 'sess-1' }));
    expect(sent().some((m) => m.kind === 'text' && /Urdu voice note did not save/.test(m.text))).toBe(true);
    expect(mockRedis.__data.has('ctst:block:sess-1:urdu')).toBe(false);
    expect(await H.handleVoice(voice('t1'), PHONE, COACH)).toBe(true);
    expect(audioAttaches().map((a) => a.block)).toEqual(['urdu']);
    mockRedis.setexWithCeiling = async (k, _ttl, v) => mockRedis.set(k, v);
  });

  test('a stale redelivery older than the previous block\'s note is still refused as early', async () => {
    await startChild('d1');
    await H.handleVoice(voice('u1'), PHONE, COACH);
    const early = voice('u1-dup', Math.floor(Date.now() / 1000) - 60);
    expect(await H.handleVoice(early, PHONE, COACH)).toBe(true);
    expect(last('text').text).toMatch(/sent before the English card/);
    expect(audioAttaches()).toHaveLength(1);
    // the refused note did not keep English: the next real note lands there
    await H.handleVoice(voice('e1'), PHONE, COACH);
    expect(audioAttaches().map((a) => a.block)).toEqual(['urdu', 'english']);
  });
});

// ------------------------------------------------------------------ bd-s1oo0.15

describe('printed card by default (bd-s1oo0.15)', () => {
  test('cards off: Present → only the Urdu prompt; Urdu note → English prompt is 2 sends (ack + prompt), no images', async () => {
    lanes.render.renderInlineCards = async (a) => nineCards(a.variant);
    await startChild('d1');
    expect(sent().filter((m) => m.kind === 'image')).toHaveLength(0);
    expect(last('buttons').body).toMatch(/Urdu 1\/3/);

    const before = sent().length;
    await H.handleVoice(voice('b-u'), PHONE, COACH);
    const step = sent().slice(before);
    expect(step).toHaveLength(2);
    expect(step[0]).toMatchObject({ kind: 'text', text: '🎧 Got it · Urdu' });
    expect(step[1].kind).toBe('buttons');
    expect(step[1].body).toMatch(/English 2\/3/);

    const before2 = sent().length;
    await H.handleVoice(voice('b-e'), PHONE, COACH);
    const step2 = sent().slice(before2);
    expect(step2).toHaveLength(2);
    expect(step2[1].body).toMatch(/Maths 3\/3/);
  });

  test('cards on: the prompt goes first, then at most 3 images', async () => {
    process.env.CHILD_TEST_INCHAT_CARDS = 'on';
    lanes.render.renderInlineCards = async (a) => nineCards(a.variant);
    await startChild('d1');
    const iPrompt = sent().findIndex((m) => m.kind === 'buttons' && /Urdu 1\/3/.test(m.body));
    expect(iPrompt).toBeGreaterThan(-1);
    const after = sent().slice(iPrompt + 1);
    expect(after.filter((m) => m.kind === 'image')).toHaveLength(3);
    expect(sent().slice(0, iPrompt).some((m) => m.kind === 'image')).toBe(false);
  });

  test('the card button sends the block\'s cards on demand, ≤ 3 images per tap, never 4 back to back', async () => {
    lanes.render.renderInlineCards = async (a) => nineCards(a.variant);
    await startChild('d1');
    const btn = last('buttons').buttons.find((b) => b.id === 'ctst_fb');
    expect(btn.title).toBe(getString('childTestCardsButton', 'en'));
    for (let tap = 0; tap < 4; tap += 1) {
      const before = sent().length;
      expect(await H.handleButton(COACH, PHONE, 'ctst_fb')).toBe(true);
      const imgs = sent().slice(before).filter((m) => m.kind === 'image');
      expect(imgs.length).toBeGreaterThan(0);
      expect(imgs.length).toBeLessThanOrEqual(3);
    }
    // never 4 images in a row across the whole chat
    let run = 0; let maxRun = 0;
    for (const m of sent()) { run = m.kind === 'image' ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    expect(maxRun).toBeLessThanOrEqual(3);
  });

  test('the card button label fits WhatsApp\'s 20 code points in both languages', () => {
    for (const lang of ['en', 'ur']) {
      const s = getString('childTestCardsButton', lang);
      expect(typeof s).toBe('string');
      expect(s).not.toMatch(/childTest/);
      expect([...s].length).toBeLessThanOrEqual(20);
    }
    for (const lang of ['en', 'ur']) expect(getString('childTestVoiceAllIn', lang, { roll: '12' })).toMatch(/12|۱۲/);
  });
});
