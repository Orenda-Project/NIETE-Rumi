'use strict';
/**
 * "Listen and answer" (app_settings `web_quiz_challenge_listen`, off unless true): the bank's listening story is played
 * twice in the quiz voice (the text is never sent to the page), then up to 3 tap questions on the same server-checked
 * calls as the questions after Read aloud. The tile appears only once the story's clip exists. The run row is
 * exercise 'listen': scoring when the questions are served, scored {correct, n} after the last answer.
 * Supabase, R2 and the voice gateway are the faked boundaries.
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

const LISTEN = { key: 'web_quiz_challenge_listen', value: true };
const spec = (lang) => Bank.getTaskSpec({ grade: 3, set: 'A', task: `${lang}.listening` });
const isUr = (s) => /[؀-ۿ]/.test(s);
const tts = require('../../../shared/services/tts');
const clipsExist = () => r2.headObject.mockImplementation(async () => ({ exists: true, sizeBytes: 1000 }));
const clipsMissing = () => r2.headObject.mockImplementation(async () => ({ exists: false }));
afterEach(() => { r2.headObject.mockImplementation(async () => ({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' })); });

describe('the tile', () => {
  test('switch off (absent): no "Listen and answer" tile, and the exercise answers 503 listen_off', async () => {
    clipsExist();
    expect((await Ch.menu(hub(), { ...D, lang: 'en' })).exercises.map((e) => e.id)).toEqual(['bigger', 'read']);
    await expectFail(Ch.exercise(hub(), 'listen', { ...D, lang: 'en' }), 503, 'listen_off');
  });

  test('switch on and the story recorded: the tile, named in the child\'s language', async () => {
    db.app_settings.push(LISTEN);
    clipsExist();
    const en = await Ch.menu(hub(), { ...D, lang: 'en' });
    expect(en.exercises.map((e) => e.id)).toEqual(['bigger', 'read', 'listen']);
    expect(en.exercises[2].name).toBe('Listen and answer');
    Ch.__reset();
    const ur = await Ch.menu(hub(), { ...D, lang: 'ur' });
    expect(ur.exercises[2].name).toBe('سنیں اور جواب دیں');
  });

  test('the story not recorded yet: no tile this time, and the recording starts in the quiz voice', async () => {
    db.app_settings.push(LISTEN);
    clipsMissing();
    expect((await Ch.menu(hub(), { ...D, lang: 'en' })).exercises.map((e) => e.id)).toEqual(['bigger', 'read']);
    await new Promise((r) => setTimeout(r, 30));
    expect(tts.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: spec('en').story.text, language: 'en' }));
  });
});

describe('the exercise', () => {
  beforeEach(() => { db.app_settings.push(LISTEN); clipsExist(); });

  test('the story clip and how many times to play it — never the story\'s text', async () => {
    const x = await Ch.exercise(hub(), 'listen', { ...D, lang: 'en' });
    expect(x.ex).toBe('listen');
    expect(x.story_clip.url).toMatch(/^https:\/\/signed\.test\//);
    expect(x.read_times).toBe(2);
    expect(JSON.stringify(x)).not.toContain(spec('en').story.text.slice(0, 30));
    expect(x.story).toBeUndefined();
  });

  test('the questions: reviewed listening questions only (EN q5 never), 3 options, no key; the run is written as scoring', async () => {
    const { ct } = await Ch.exercise(hub(), 'listen', { ...D, lang: 'en' });
    const out = await Ch.questions({ ct });
    expect(out.questions.map((q) => q.id)).toEqual(['en.listening.q1', 'en.listening.q2', 'en.listening.q3']);
    out.questions.forEach((q) => { expect(q.options).toHaveLength(3); q.options.forEach((o) => expect(isUr(o)).toBe(false)); });
    expect(JSON.stringify(out)).not.toMatch(/"(accept|reject|answer|rubric)"/);
    const row = db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ct, 'c').r);
    expect(row).toMatchObject({ exercise: 'listen', status: 'scoring', lang: 'en' });
    expect(Ch.tapOptions(spec('en').questions.find((q) => q.id === 'en.listening.q5'), 'en', 'r')).toBeNull();
  });

  test('Urdu content review: «کلاس» is never a wrong option for "what did Ayesha clean?"; q4 and q5 are never asked', async () => {
    const qs = spec('ur').questions;
    const q2 = Ch.tapOptions(qs.find((q) => q.id === 'ur.listening.q2'), 'ur', 'r');
    expect(q2.right).toBe('میزیں');
    expect(q2.options).not.toContain('کلاس');
    expect(Ch.tapOptions(qs.find((q) => q.id === 'ur.listening.q4'), 'ur', 'r')).toBeNull();
    expect(Ch.tapOptions(qs.find((q) => q.id === 'ur.listening.q5'), 'ur', 'r')).toBeNull();
  });

  test('after the last answer the run is scored {correct, n}; the menu shows it and the class results list it', async () => {
    const { ct } = await Ch.exercise(hub(), 'listen', { ...D, lang: 'en' });
    const qs = (await Ch.questions({ ct })).questions;
    const bank = spec('en').questions;
    const rightIdx = (k) => qs[k].options.indexOf(bank.find((b) => b.id === qs[k].id).accept[0]);
    await Ch.answer({ ct, q: qs[0].id, pick: rightIdx(0) });
    await Ch.answer({ ct, q: qs[1].id, pick: rightIdx(1) });
    const row = () => db.web_quiz_challenge_runs.find((r) => r.id === T.verify(ct, 'c').r);
    expect(row().status).toBe('scoring');
    await Ch.answer({ ct, q: qs[2].id, pick: (rightIdx(2) + 1) % 3 });
    expect(row()).toMatchObject({ status: 'scored', score: { correct: 2, n: 3 } });
    const m = await Ch.menu(hub(), { ...D, lang: 'en' });
    expect(m.exercises.find((e) => e.id === 'listen')).toMatchObject({ done: true, last: { correct: 2, n: 3 } });
    const res = await Ch.listResults({ list: LIST });
    expect(res).toContainEqual(expect.objectContaining({ student_id: KID, exercise: 'listen', score: 2, of: 3 }));
  });
});
