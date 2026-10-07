'use strict';
/**
 * Questions after Read aloud (app_settings `web_quiz_challenge_questions`, off unless true): up to 3 tap questions,
 * only about text the child reached (reach.js, EGRA's rule); the question is the item bank's own, the right option
 * its first "accept" and the two wrong ones its own "reject" entries, in the passage's script. The key never leaves
 * the server: each tap is answered by /ch/qa. Answers are kept as meta.comp (numbers) on the reading's own row.
 * Supabase, R2, the STT call, the LLM and the voice gateway are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/put/${key}?ct=${encodeURIComponent(type)}&ttl=${ttl}&X-Amz-Signature=x`),
  headObject: jest.fn(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })),
  downloadFromR2: jest.fn(),
  getPresignedUrl: jest.fn(async (u) => `${u}?X-Amz-Signature=x`),
  buildR2PublicUrl: jest.fn((k) => `https://r2.test/${k}`),
  uploadBuffer: jest.fn(async () => 'ok'),
  presignKey: jest.fn(async (key, ttl, { bucket } = {}) => `https://signed.test/${key}?b=${bucket}`),
  deleteAudio: jest.fn(async () => true),
  deleteKey: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
// The voice gateway's provider calls are the network boundary for the mascot's clips.
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
// Redis is a boundary: an in-memory SET NX / GET, so the hub's first-device binding (web-quiz-hub deviceTrusted) runs for real.
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
  };
});
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const r2 = require('../../../shared/storage/r2');
const AudioService = require('../../../shared/services/audio.service');
const llm = require('../../../shared/services/llm-client');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST }, { id: KID2, list_id: LIST }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  jest.clearAllMocks();
});

// The family's phone (the first to open the hub link); every hub-token call below comes from it.
const DEV = 'FamilyPhoneDeviceRef_1';
const DEV_B = 'ForwardedToPhoneRef_22';
const D = { device: DEV };
const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const st = () => T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC });
const expectFail = async (p, status, error) => {
  await expect(p).rejects.toMatchObject({ status, body: expect.objectContaining({ error }) });
};

// ── tokens ───────────────────────────────────────────────────────────────────

const QA = { key: 'web_quiz_challenge_questions', value: true };
const enStory = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' });
const urStory = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' });
const isUr = (s) => /[؀-ۿ]/.test(s);
const readCt = async (lang = 'en') => (await Ch.exercise(hub(), 'read', { ...D, lang })).ct;
const runIdOf = (ct) => T.verify(ct, 'c').r;
// a stored, scored reading of this run (what the page has once the result is in)
const scored = (ct, score, extra = {}) => db.web_quiz_challenge_runs.push({ id: runIdOf(ct), student_id: KID, exercise: 'read', lang: extra.lang || 'en', status: 'scored', score, wcpm: 40, meta: extra.meta || {}, created_at: new Date().toISOString() });

describe('the switch', () => {
  test('off (absent): the read says questions_on false and /ch/qs answers 503 questions_off', async () => {
    const x = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    expect(x.questions_on).toBe(false);
    await expectFail(Ch.questions({ ct: x.ct }), 503, 'questions_off');
  });
  test('on: the read says questions_on true; "Which is bigger?" never carries it', async () => {
    db.app_settings.push(QA);
    expect((await Ch.exercise(hub(), 'read', { ...D, lang: 'en' })).questions_on).toBe(true);
    expect((await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' })).questions_on).toBeUndefined();
  });
});

describe('which questions, and their options', () => {
  beforeEach(() => { db.app_settings.push(QA); });

  test('a child who read the whole story gets the first 3 bank questions; 3 options each, in the passage\'s script, and NO answer key', async () => {
    const ct = await readCt('en');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true });
    const out = await Ch.questions({ ct });
    const bank = enStory().questions;
    expect(out.questions.map((q) => q.id)).toEqual(bank.slice(0, 3).map((q) => q.id));
    out.questions.forEach((q, k) => {
      expect(q.prompt).toBe(bank[k].prompt);
      expect(q.options).toHaveLength(3);
      q.options.forEach((o) => expect(isUr(o)).toBe(false));
      expect(q.options).toContain(bank[k].accept.find((a) => !isUr(a)));
      expect(Object.keys(q)).not.toEqual(expect.arrayContaining(['answer']));
    });
    expect(JSON.stringify(out)).not.toMatch(/"(accept|reject|answer|rubric)"/);
    // the same run gets the same order every time (a refresh does not reshuffle)
    expect((await Ch.questions({ ct })).questions).toEqual(out.questions);
  });

  test('no two options say the same thing: a wrong option inside another option ("books" / "his books") is skipped', async () => {
    const ct = await readCt('en');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true });
    const out = await Ch.questions({ ct });
    const norm = (x) => x.toLowerCase().replace(/[^a-z\u0600-\u06ff ]/g, '').trim();
    out.questions.forEach((q) => q.options.forEach((a, i) => q.options.forEach((b, j) => {
      if (i !== j) expect(norm(b).includes(norm(a))).toBe(false);
    })));
    const q3 = out.questions.find((q) => q.id === 'en.story.q3');
    expect(q3.options.filter((o) => /books/i.test(o))).toHaveLength(1);
  });

  test('only questions a person has reviewed as tap questions are asked: the ambiguous Urdu q3 ("what did Bilal see moving?" — the water and the wind also move in the story) never is', async () => {
    const ct = await readCt('ur');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true }, { lang: 'ur' });
    expect((await Ch.questions({ ct })).questions.map((q) => q.id)).toEqual(['ur.story.q1', 'ur.story.q2', 'ur.story.q4']);
    const unreviewed = { ...enStory().questions[0], id: 'en.story.q99' };
    expect(Ch.tapOptions(unreviewed, 'en', 'run-x')).toBeNull();
  });

  test('content review: no wrong option the story supports, no two wrong options that mean the same, no inference-only question', () => {
    const en1 = Ch.tapOptions(enStory().questions.find((q) => q.id === 'en.story.q1'), 'en', 'run-x');
    expect(en1.right).toBe('for school');
    expect(en1.options).not.toContain('to plant trees');   // "Today his class was planting trees."
    const ur1 = Ch.tapOptions(urStory().questions.find((q) => q.id === 'ur.story.q1'), 'ur', 'run-x');
    expect(ur1.options.filter((o) => o === 'امی کے ساتھ' || o === 'والدہ کے ساتھ')).toHaveLength(1);   // both mean "with mother"
    expect(Ch.tapOptions(urStory().questions.find((q) => q.id === 'ur.story.q6'), 'ur', 'run-x')).toBeNull();   // the story never says why
  });

  test('a near-miss the rubric itself discusses ("Water alone is wrong") is never offered as a wrong option, nor is "don\'t know"', () => {
    const bank = enStory().questions.find((q) => q.id === 'en.story.q4');
    const t = Ch.tapOptions(bank, 'en', 'run-x');
    expect(t.right).toBe('the plant');
    expect(t.options).not.toContain('water');
    const ur5 = urStory().questions.find((q) => q.id === 'ur.story.q5');
    const u = Ch.tapOptions(ur5, 'ur', 'run-x');
    if (u) expect(u.options).not.toContain('معلوم نہیں');
  });

  test('Urdu: options in Urdu script only, never a word from the no-test-words list', async () => {
    const ct = await readCt('ur');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true }, { lang: 'ur' });
    const out = await Ch.questions({ ct });
    expect(out.questions).toHaveLength(3);
    out.questions.forEach((q) => q.options.forEach((o) => { expect(isUr(o)).toBe(true); expect(o).not.toMatch(/امتحان|ٹیسٹ|جائزہ/); }));
  });

  test('only questions about text the child reached (EGRA): 8 words of the English story reach line 1 only ⇒ one question', async () => {
    const ct = await readCt('en');
    scored(ct, { correct: 7, attempted: 8, stopped: false, finished_early: false });
    const out = await Ch.questions({ ct });
    expect(out.questions.map((q) => q.id)).toEqual(['en.story.q1']);
  });

  test('a reader stopped by the first-line rule gets no questions', async () => {
    const ct = await readCt('en');
    scored(ct, { correct: 0, attempted: 4, stopped: true });
    expect((await Ch.questions({ ct })).questions).toEqual([]);
  });

  test('before the checked score: the live count stored with the result decides; with nothing stored, the page\'s count (bounded)', async () => {
    const ct = await readCt('en');
    db.web_quiz_challenge_runs.push({ id: runIdOf(ct), student_id: KID, exercise: 'read', lang: 'en', status: 'scoring', meta: { live: { correct: 11, attempted: 12, secs: 20, v: 1 } }, created_at: new Date().toISOString() });
    expect((await Ch.questions({ ct, attempted: 60 })).questions.map((q) => q.id)).toEqual(['en.story.q1', 'en.story.q2']);
    const ct2 = await readCt('en');
    expect((await Ch.questions({ ct: ct2, attempted: 999 })).questions).toHaveLength(3);
    expect((await Ch.questions({ ct: ct2, attempted: 3 })).questions).toEqual([]);
  });
});

describe('answering: the key stays on the server', () => {
  beforeEach(() => { db.app_settings.push(QA); });
  const optionsOf = async (ct) => (await Ch.questions({ ct })).questions;

  test('the right option ⇒ ok; a wrong one ⇒ not ok with the right answer; each question counts once; meta.comp keeps the numbers', async () => {
    const ct = await readCt('en');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true });
    const qs = await optionsOf(ct);
    const bank = enStory().questions;
    const right = (k) => qs[k].options.indexOf(bank[k].accept.find((a) => !isUr(a)));
    const wrong = (k) => [0, 1, 2].find((i) => i !== right(k));
    expect(await Ch.answer({ ct, q: qs[0].id, pick: right(0) })).toEqual({ ok: true, answer: qs[0].options[right(0)] });
    expect(await Ch.answer({ ct, q: qs[1].id, pick: wrong(1) })).toEqual({ ok: false, answer: qs[1].options[right(1)] });
    // a second tap on an answered question changes nothing
    expect(await Ch.answer({ ct, q: qs[1].id, pick: right(1) })).toEqual({ ok: false, answer: qs[1].options[right(1)] });
    const row = db.web_quiz_challenge_runs.find((r) => r.id === runIdOf(ct));
    expect(row.meta.comp).toMatchObject({ asked: 2, correct: 1, v: 1 });
    // the per-question record is question numbers and 0/1 only
    expect(Object.values(row.meta.comp.a || {}).every((x) => x === 0 || x === 1)).toBe(true);
    qs.forEach((q) => q.options.forEach((o) => expect(JSON.stringify(row.meta)).not.toContain(o)));
  });

  test('a question that is not this passage\'s, or a pick outside the 3 options, is refused', async () => {
    const ct = await readCt('en');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true });
    await expectFail(Ch.answer({ ct, q: 'ur.story.q1', pick: 0 }), 400, 'bad_request');
    await expectFail(Ch.answer({ ct, q: 'en.story.q1', pick: 3 }), 400, 'bad_request');
    await expectFail(Ch.answer({ ct: 'x.y', q: 'en.story.q1', pick: 0 }), 401, 'bad_token');
  });

  test('answers given while the reading is still being scored survive the scorer\'s write (meta.comp and meta.live both kept)', async () => {
    db.app_settings.push({ key: 'web_quiz_challenge_realtime', value: true });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ api_key: 'temp:k-test-only', expires_at: 'x' }) }));
    process.env.SONIOX_API_KEY = 'main-test-only';
    const ct = await readCt('en');
    await Ch.liveKey({ ct });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    const FF = require('@ffmpeg-installer/ffmpeg').path;
    const f = path.join(os.tmpdir(), `wqqa-${process.pid}.webm`);
    if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '60', '-c:a', 'libopus', f]);
    r2.downloadFromR2.mockResolvedValue(fs.readFileSync(f));
    const toks = enStory().story.tokens;
    AudioService.transcribe.mockResolvedValue({ text: '', tokens: toks.map((w, k) => ({ text: ` ${w}`, start_ms: k * 500, end_ms: k * 500 + 400, speaker: 1 })) });
    let release;
    const gate = new Promise((r) => { release = r; });
    llm.__create.mockImplementation(async () => { await gate; return { usage: { cost: 0.002 }, choices: [{ message: { content: JSON.stringify({ words: toks.map((w, k) => ({ i: k + 1, w, v: 'correct' })), notes: '' }) } }] }; });
    const first = await Ch.submit({ ct, key, ms: 30000, lang: 'en', live: { correct: 60, attempted: 60, secs: 30 } }, { waitMs: 0 });
    expect(first).toEqual({ pending: true });
    const qs = (await Ch.questions({ ct })).questions;
    await Ch.answer({ ct, q: qs[0].id, pick: 0 });
    release();
    for (let i = 0; i < 50 && (await Ch.poll(ct)).pending; i += 1) await new Promise((r) => setTimeout(r, 20));
    const row = db.web_quiz_challenge_runs.find((r) => r.id === runIdOf(ct));
    expect(row.status).toBe('scored');
    expect(row.meta.live).toEqual({ correct: 60, attempted: 60, secs: 30, v: 1 });
    expect(row.meta.comp).toMatchObject({ asked: 1, v: 1 });
    delete global.fetch;
  });
});

describe('a question is read aloud by the mascot in the quiz voice (recorded once per environment)', () => {
  test('each question carries its prompt clip (absent the first time, recorded in the background)', async () => {
    db.app_settings.push(QA);
    const ct = await readCt('en');
    scored(ct, { correct: 60, attempted: 60, stopped: false, finished_early: true });
    const out = await Ch.questions({ ct });
    out.questions.forEach((q) => expect(q).toHaveProperty('clip'));
  });
});
