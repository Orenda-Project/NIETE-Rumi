'use strict';
/**
 * The Trail page v2 (web-quiz-trail-page.js): the switch bits on the menu and exercise payloads (v2 off ⇒ today's
 * payloads, deep-equal to the base's), and the grown-up's "keep this reading?" answer
 * (`web_quiz_challenge_audio_consent`, parent `web_quiz_challenge_v2`): a reading is kept ONLY with `kept_ok`;
 * `kept_no` and no answer (`not_asked`) are scored and deleted; the run row carries the answer; one event per run.
 * Faked boundaries only (Supabase, R2, speech, the LLM client); the service, tokens, bank and scorer run for real.
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
  listKeys: jest.fn(async () => []),
}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn(async () => ({ audio: Buffer.from('OggS'), provider: 'soniox', voice: 'Grace', durationSec: 2 })) }));
jest.mock('../../../shared/services/llm-client', () => {
  const create = jest.fn();
  return { __create: create, getClient: () => ({ chat: { completions: { create } } }) };
});
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
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Bank = require('../../../shared/services/child-test/item-bank');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
let TP = null;
try { TP = require('../../../shared/services/quiz/web-quiz-trail-page'); } catch (e) { TP = null; }

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';
const RECORD = { key: 'web_quiz_challenge_record', value: true };
const GUARD = { key: 'web_quiz_challenge_read_guard', value: true };
const ITEMS = { key: 'web_quiz_challenge_items', value: true };
const KEEP = { key: 'web_quiz_challenge_keep_audio', value: true };

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, student_name: 'Sana Testwala' }, { id: KID2, list_id: LIST, student_name: 'Omar Khan' }],
    quiz_share_codes: [{ id: SC, language: 'en' }],
    quiz_sessions: [{ id: SESSION, student_id: KID, share_code_id: SC, quiz_id: 'q1' }],
    web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
  Ch.__reset();
  if (TP) TP._reset();
  jest.clearAllMocks();
});

const DEV = 'FamilyPhoneDeviceRef_1';
const D = { device: DEV };
const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const on = (...flags) => flags.forEach((f) => db.app_settings.push(f));

// "Which is bigger?": the served pairs answered right (or a given way), one tap each.
const spec3 = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' });
const allRight = (items, ms = 2500) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms }));
const bigger = async (taps, extra = {}, opts = {}) => {
  const ex = await Ch.exercise(hub(), 'bigger', D);
  const r = await Ch.submit({ ct: ex.ct, taps: typeof taps === 'function' ? taps(ex.items) : taps, ms: 25000, ...extra }, opts);
  return { ex, r, row: db.web_quiz_challenge_runs[db.web_quiz_challenge_runs.length - 1] };
};

// Read aloud: a silent clip of `secs` seconds, Soniox heard `n` words, the LLM marked `verdicts`.
const FF = require('@ffmpeg-installer/ffmpeg').path;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqrec-'));
const clip = (secs) => {
  const f = path.join(dir, `s${secs}.webm`);
  if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
  return fs.readFileSync(f);
};
const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
const heard = (n, gap, from = 0) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round((from + k * gap) * 1000), end_ms: Math.round((from + k * gap + gap * 0.8) * 1000), speaker: 1 })) });
const marks = (verdicts) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
  words: verdicts.map((v, k) => ({ i: k + 1, w: enTokens()[k], v })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
const verdicts = (right, tried) => enTokens().map((_, k) => (k < right ? 'correct' : k < tried ? 'wrong' : 'skipped'));
const read = async ({ secs, n, gap = 1.3, right, tried, body = {}, presignBody = {}, from = 0 }) => {
  const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
  const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000, ...presignBody });
  r2.downloadFromR2.mockResolvedValue(clip(secs));
  AudioService.transcribe.mockResolvedValue(heard(n, gap, from));
  llm.__create.mockResolvedValue(marks(verdicts(right, tried)));
  const r = await Ch.submit({ ct, key, ms: secs * 1000, lang: 'en', ...body }, { waitMs: 60000 });
  return { ct, r, row: db.web_quiz_challenge_runs.find((x) => x.exercise === 'read' && x.id === T.verify(ct, 'c').r) };
};



const KEPT_RX = (run) => new RegExp(`^child-voice/sandbox/kept/\\d{4}-\\d{2}-\\d{2}/${run}/read-\\d{13}\\.webm$`);
const PLAIN_RX = (run) => new RegExp(`^child-voice/sandbox/${run}/read-\\d{13}\\.webm$`);
const runOf = (ct) => T.verify(ct, 'c').r;
const upKey = () => r2.getPresignedUploadUrl.mock.calls[0][0];
const deleted = () => r2.deleteKey.mock.calls.map((c) => c[0]);
const V2 = { key: 'web_quiz_challenge_v2', value: true };
const CONSENT = { key: 'web_quiz_challenge_audio_consent', value: true };
const POOL = { key: 'web_quiz_challenge_pool', value: true };
const STORY = { key: 'web_quiz_challenge_story', value: true };
const consentEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.ch_audio_consent').map((c) => c[1]);

// The payloads with their per-call randomness (the challenge token) taken out.
const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ct' ? '<ct>' : v)));
const GOLDEN = path.join(__dirname, 'fixtures', 'trail-page-v2-off.golden.json');
const payloads = async () => {
  const out = {};
  out.menu = norm(await Ch.menu(hub(), { ...D, lang: 'en' }));
  for (const ex of ['bigger', 'read']) out[ex] = norm(await Ch.exercise(hub(), ex, { ...D, lang: 'en' }));
  on(RECORD, { key: 'web_quiz_challenge_trail', value: true });
  Ch.__reset();
  out.trailMenu = norm(await Ch.menu(hub(), { ...D, lang: 'ur' }));
  out.trailRead = norm(await Ch.exercise(hub(), 'read', { ...D, lang: 'ur' }));
  return out;
};

describe('golden: with v2 off the menu and exercise payloads are the base\'s', () => {
  test('v2 off (and its children on, which need it) → deep-equal to the payloads captured on the base', async () => {
    on(POOL, STORY, CONSENT, KEEP);
    const now = await payloads();
    expect(now).toEqual(JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
  });
});

describe('v2 on: the payloads say which v2 screens the page may show', () => {
  test('menu and exercise carry v2 {pool, story, consent}; consent needs the keep switch too', async () => {
    on(V2, POOL, CONSENT);
    const m = await Ch.menu(hub(), { ...D, lang: 'en' });
    expect(m.v2).toEqual({ pool: true, story: false, consent: false });
    on(KEEP);
    TP._reset(); Ch.__reset();
    // 'bigger' needs no released passage: with the draw on, a read with none is served as on its way (no screen flags)
    const e = await Ch.exercise(hub(), 'bigger', { ...D, lang: 'en' });
    expect(e.v2).toEqual({ pool: true, story: false, consent: true });
  });

  test('a failed settings read is v2 off (fail closed): bits() is {}, consentFor() is null', async () => {
    on(V2, CONSENT, KEEP);
    const real = supabase.from;
    supabase.from = () => { throw new Error('down'); };
    try {
      expect(await TP.bits()).toEqual({});
      expect(await TP.consentFor({ audio_consent: 'kept_ok' })).toBeNull();
    } finally { supabase.from = real; }
  });
});

describe('audio consent: a reading is kept ONLY when the grown-up said yes', () => {
  const presign = async (consent) => {
    const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
    const u = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000, ...(consent ? { audio_consent: consent } : {}) });
    return { ct, key: u.key };
  };

  test('kept_no → a plain (deleted) key, nothing under kept/; the row says kept_no by the grown-up\'s tap; one event', async () => {
    on(KEEP, V2, CONSENT);
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40, body: { audio_consent: 'kept_no' }, presignBody: { audio_consent: 'kept_no' } });
    const key = upKey();
    expect(key).toMatch(PLAIN_RX(runOf(ct)));
    expect(r2.getPresignedUploadUrl.mock.calls.filter((c) => c[0].includes('/kept/'))).toEqual([]);
    expect(deleted()).toContain(key);
    expect(row.meta).not.toHaveProperty('audio_key');
    expect(row.audio_consent).toBe('kept_no');
    expect(row.audio_consent_by).toBe('grownup_tap');
    expect(Date.parse(row.audio_consent_at)).toBeGreaterThan(0);
    expect(consentEvents()).toEqual([{ run: runOf(ct), v: 'kept_no' }]);
  });

  test('no answer (the screen was not shown) → not_asked, a plain key, nothing kept', async () => {
    on(KEEP, V2, CONSENT);
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40 });
    expect(upKey()).toMatch(PLAIN_RX(runOf(ct)));
    expect(deleted()).toContain(upKey());
    expect(row.audio_consent).toBe('not_asked');
    expect(consentEvents()).toEqual([{ run: runOf(ct), v: 'not_asked' }]);
  });

  test('a made-up answer is not_asked, never kept', async () => {
    on(KEEP, V2, CONSENT);
    const { ct, key } = await presign('yes');
    expect(key).toMatch(PLAIN_RX(runOf(ct)));
  });

  test('kept_ok → the kept key, the reading stays, the row says kept_ok', async () => {
    on(KEEP, V2, CONSENT);
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40, body: { audio_consent: 'kept_ok' }, presignBody: { audio_consent: 'kept_ok' } });
    const key = upKey();
    expect(key).toMatch(KEPT_RX(runOf(ct)));
    expect(deleted()).not.toContain(key);
    expect(row.meta.audio_key).toBe(key);
    expect(row.audio_consent).toBe('kept_ok');
    expect(consentEvents()).toEqual([{ run: runOf(ct), v: 'kept_ok' }]);
  });

  test('the consent columns cannot fail the row: a table without them (42703) still ends scored, kept by consent; the miss is logged', async () => {
    on(KEEP, V2, CONSENT);
    const real = supabase.from;
    // a chain whose every step answers the table's "no such column" (as PostgREST does before M1)
    const missing = () => { const r = { data: null, error: { code: '42703', message: 'column "audio_consent" does not exist' } }; const c = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(r) : () => c) }); return c; };
    supabase.from = (t) => {
      const b = real(t);
      if (t !== 'web_quiz_challenge_runs') return b;
      const up = b.update;
      b.update = (patch) => (patch && Object.prototype.hasOwnProperty.call(patch, 'audio_consent')
        ? missing() : up.call(b, patch));
      const ins = b.insert;
      b.insert = (row) => ((Array.isArray(row) ? row : [row]).some((r) => r && 'audio_consent' in r)
        ? missing() : ins.call(b, row));
      return b;
    };
    try {
      const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40, body: { audio_consent: 'kept_ok' }, presignBody: { audio_consent: 'kept_ok' } });
      expect(row.status).toBe('scored');
      expect(row.wcpm).toBeGreaterThan(0);
      expect(upKey()).toMatch(KEPT_RX(runOf(ct)));
      expect(row.meta.audio_key).toBe(upKey());
      expect(row).not.toHaveProperty('audio_consent');
      const { logError } = require('../../../shared/utils/logger');
      expect(logError.mock.calls.map((c) => c[0])).toContain('web_quiz.ch_audio_consent_write_failed');
    } finally { supabase.from = real; }
  });

  test('consent switch off (v2 on) → today: the keep switch alone keeps it; no consent column, no event', async () => {
    on(KEEP, V2);
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40, body: { audio_consent: 'kept_no' }, presignBody: { audio_consent: 'kept_no' } });
    expect(upKey()).toMatch(KEPT_RX(runOf(ct)));
    expect(row).not.toHaveProperty('audio_consent');
    expect(consentEvents()).toEqual([]);
  });

  test('consent switch on but v2 off (its parent) → today\'s behaviour', async () => {
    on(KEEP, CONSENT);
    const { ct, row } = await read({ secs: 60, n: 40, right: 38, tried: 40 });
    expect(upKey()).toMatch(KEPT_RX(runOf(ct)));
    expect(row).not.toHaveProperty('audio_consent');
    expect(consentEvents()).toEqual([]);
  });
});
