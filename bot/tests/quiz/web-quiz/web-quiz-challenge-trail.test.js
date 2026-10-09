'use strict';
/**
 * The trail and "Missing number" (web-quiz-challenge.js), behind web_quiz_challenge_trail / _missing, each effective
 * only with web_quiz_challenge_record. Faked boundaries only (Supabase, R2, speech, the LLM client); the service, the
 * tokens, the item bank and the stop rule run for real.
 *
 * (The record rules, for reference: three switches (web-quiz-challenge.js):
 *   web_quiz_challenge_record      the first scored attempt is the record; the clock is the server's; a reading
 *                                  the child ended early is not a words-per-minute; nothing on the menu is a number
 *   web_quiz_challenge_read_guard  the page's read screen: a local microphone check, no Done, "too hard" only
 *                                  after the first line's window, how the reading ended
 *   web_quiz_challenge_items       per-item verdicts and timings (numbers only) on every row
 * Every switch off ⇒ today's rows, byte for byte. Faked boundaries only (Supabase, R2, speech, the LLM client);
 * the service, the tokens, the item bank and the story scorer run for real.
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

const KID = '44444444-4444-4444-8444-444444444444';
const KID2 = '55555555-5555-4555-8555-555555555555';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const SESSION = '66666666-6666-4666-8666-666666666666';
const SC = '33333333-3333-4333-8333-333333333333';
const RECORD = { key: 'web_quiz_challenge_record', value: true };
const GUARD = { key: 'web_quiz_challenge_read_guard', value: true };
const ITEMS = { key: 'web_quiz_challenge_items', value: true };
const TRAIL = { key: 'web_quiz_challenge_trail', value: true };
const MISSING = { key: 'web_quiz_challenge_missing', value: true };

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
const read = async ({ secs, n, gap = 1.3, right, tried, body = {}, from = 0 }) => {
  const { ct } = await Ch.exercise(hub(), 'read', { ...D, lang: 'en' });
  const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
  r2.downloadFromR2.mockResolvedValue(clip(secs));
  AudioService.transcribe.mockResolvedValue(heard(n, gap, from));
  llm.__create.mockResolvedValue(marks(verdicts(right, tried)));
  const r = await Ch.submit({ ct, key, ms: secs * 1000, lang: 'en', ...body }, { waitMs: 60000 });
  return { ct, r, row: db.web_quiz_challenge_runs.find((x) => x.exercise === 'read' && x.id === T.verify(ct, 'c').r) };
};


// "Missing number": the G3 form's items; answers right (or as given), one each.
const mspec = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.missing' });
const ans = (i, value, ms = 3000, first = 1200, keys = 2) => ({ i, value: value == null ? null : String(value), ms, first_key_ms: first, keys });
const allRightM = (opts = {}) => mspec().items.map((it, i) => ans(i, it.answer, opts.ms, opts.first));
const missing = async (answers, extra = {}, opts = {}) => {
  const ex = await Ch.exercise(hub(), 'missing', D);
  const r = await Ch.submit({ ct: ex.ct, answers: typeof answers === 'function' ? answers(ex.items) : answers, ms: 40000, ...extra }, opts);
  return { ex, r, row: db.web_quiz_challenge_runs[db.web_quiz_challenge_runs.length - 1] };
};

describe('the switches: off, or on without the record rule, is today', () => {
  test('trail and missing ON but record OFF: the menu has no trail, no missing stop; missing answers 503', async () => {
    on(TRAIL, MISSING);
    const m = await Ch.menu(hub(), D);
    expect(m.trail).toBeUndefined();
    expect(m.trail_copy).toBeUndefined();
    expect(m.exercises.map((e) => e.id)).toEqual(['bigger', 'read']);
    expect(m.exercises.every((e) => e.badge === undefined && e.mic === undefined)).toBe(true);
    await expect(Ch.exercise(hub(), 'missing', D)).rejects.toMatchObject({ status: 503 });
  });

  test('record ON alone: no trail payload and no missing stop', async () => {
    on(RECORD);
    const m = await Ch.menu(hub(), D);
    expect(m.trail).toBeUndefined();
    expect(m.exercises.map((e) => e.id)).not.toContain('missing');
    const ex = await Ch.exercise(hub(), 'bigger', D);
    expect(ex.trail).toBeUndefined();
    expect(ex.practice_round).toBeUndefined();
  });

  test('a missing token minted while on cannot submit once the switch is off', async () => {
    on(RECORD, MISSING);
    const ex = await Ch.exercise(hub(), 'missing', D);
    db.app_settings = db.app_settings.filter((s) => s.key !== MISSING.key);
    Ch.__reset();
    await expect(Ch.submit({ ct: ex.ct, answers: allRightM() })).rejects.toMatchObject({ status: 503 });
    expect(db.web_quiz_challenge_runs).toHaveLength(0);
  });
});

describe('scoreMissing: two scores from one run, the stop applied by the server', () => {
  test('all right with a first key inside 5 s: 10 and 10', () => {
    const { score, rows } = Ch.scoreMissing(mspec().items, allRightM());
    expect(score).toEqual({ correct: 10, correct_5s: 10, n: 10, stopped: false });
    expect(rows[0]).toEqual({ i: 1, ok: true, ok_5s: true, ms: 3000, first_key_ms: 1200, keys: 2, digits: 1 });
  });

  test('a first key after 5 s is right any time but not within 5 s', () => {
    const a = allRightM();
    a[0].first_key_ms = 6200; a[3].first_key_ms = 5001;
    const { score } = Ch.scoreMissing(mspec().items, a);
    expect(score.correct).toBe(10);
    expect(score.correct_5s).toBe(8);
  });

  test('4 wrong in a row stop it: later items count for nothing even when the phone sent them right', () => {
    const items = mspec().items;
    const a = items.map((it, i) => ans(i, i >= 2 && i <= 5 ? it.answer + 1 : it.answer));
    const { score, rows } = Ch.scoreMissing(items, a);
    expect(score).toMatchObject({ correct: 2, stopped: true });
    expect(rows.slice(6).every((r) => r.reached === false && r.ok === null)).toBe(true);
  });

  test('a skip counts toward the stop and is an untouched item, not a wrong one', () => {
    const items = mspec().items;
    const a = items.map((it, i) => (i < 4 ? ans(i, null, 5500, null, 0) : ans(i, it.answer)));
    const { score, rows } = Ch.scoreMissing(items, a);
    expect(score).toMatchObject({ correct: 0, stopped: true });
    expect(rows[0]).toMatchObject({ ok: null, ok_5s: false });
  });

  test('nonsense values are not answers', () => {
    const a = allRightM();
    a[0].value = '8a'; a[1].value = 16; a[2].value = '12345';
    const { score } = Ch.scoreMissing(mspec().items, a);
    expect(score.correct).toBe(7);
  });
});

describe('Missing number, end to end (record + missing on)', () => {
  test('the exercise serves the bank in order with two practice rows, the stop and the 5-s line', async () => {
    on(RECORD, MISSING);
    const ex = await Ch.exercise(hub(), 'missing', D);
    expect(ex.items.map((i) => i.seq)).toEqual(mspec().items.map((i) => i.seq));
    expect(ex.practice).toHaveLength(2);
    expect(ex.stop_after).toBe(4);
    expect(ex.first_key_s).toBe(5);
    expect(ex.clips.intro.text).toMatch(/missing/i);
  });

  test('a submitted run is stored scored with both scores and the record stamps; the event names both', async () => {
    on(RECORD, MISSING);
    const a = allRightM(); a[0].first_key_ms = 7000;
    const { r, row } = await missing(a);
    expect(r.score).toEqual({ correct: 10, correct_5s: 9, n: 10, stopped: false });
    expect(row).toMatchObject({ exercise: 'missing', status: 'scored', score: { correct: 10, correct_5s: 9 } });
    expect(row.meta).toMatchObject({ attempt_no: 1, counted: true, test: true });
    expect(row.meta.items).toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('web_quiz.ch_done', expect.objectContaining({ step: 'missing', count: 10, count_5s: 9 }));
  });

  test('under _items: per-item rows, and rapid only when three are FAST AND WRONG', async () => {
    on(RECORD, MISSING, ITEMS);
    const items = mspec().items;
    // three wrong in 300 ms (1-digit answers: fast < 700 ms), then right
    const fastWrong = items.map((it, i) => (i < 3 ? ans(i, it.answer + 1, 300, 100, 1) : ans(i, it.answer)));
    const one = await missing(fastWrong);
    expect(one.row.meta.items).toHaveLength(10);
    expect(one.row.meta.items[0]).toMatchObject({ ok: false, ms: 300, first_key_ms: 100, keys: 1, digits: 1 });
    expect(one.row.meta.rapid).toBe(true);
    const fastRight = items.map((it, i) => ans(i, it.answer, 300, 100, 1));
    const two = await missing(fastRight);
    expect(two.row.meta.rapid).toBe(false);
    expect(two.row.meta).toMatchObject({ attempt_no: 2, counted: false });
  });

  test('the class results carry the 5-s score for missing', async () => {
    on(RECORD, MISSING);
    const a = allRightM(); a[1].first_key_ms = 9000;
    await missing(a);
    const res = await Ch.listResults({ list: LIST });
    expect(res.find((x) => x.exercise === 'missing')).toMatchObject({ score: 10, of: 10, score_5s: 9 });
  });
});

describe('the trail (record + trail on)', () => {
  test('the menu is a trail: copy, a badge from the first counted run of ANY outcome, mic marked on read', async () => {
    on(RECORD, TRAIL, MISSING);
    // a first bigger run that the stop ended (all wrong): still the badge
    await bigger((items) => items.map((it, i) => ({ i, pick: Math.min(it.a, it.b), ms: 3000 })));
    const m = await Ch.menu(hub(), D);
    expect(m.trail).toBe(true);
    expect(m.trail_copy).toMatchObject({ title: "{name}'s Trail", needsMic: 'needs a microphone', practice: expect.stringMatching(/Practice round/) });
    expect(m.exercises.map((e) => e.id)).toEqual(['bigger', 'missing', 'read']);
    const by = Object.fromEntries(m.exercises.map((e) => [e.id, e]));
    expect(by.bigger).toMatchObject({ badge: true, last: null });
    expect(by.missing).toMatchObject({ badge: false });
    expect(by.read).toMatchObject({ badge: false, mic: true });
    expect(by.bigger.mic).toBeUndefined();
  });

  test('a stopped first missing run earns the badge', async () => {
    on(RECORD, TRAIL, MISSING);
    await missing((items) => items.map((it, i) => ans(i, it.answer + 1)));
    expect(db.web_quiz_challenge_runs[0].score.stopped).toBe(true);
    const m = await Ch.menu(hub(), D);
    expect(m.exercises.find((e) => e.id === 'missing').badge).toBe(true);
  });

  test('a stop played again is a practice round; the first play is not', async () => {
    on(RECORD, TRAIL, MISSING);
    const first = await Ch.exercise(hub(), 'missing', D);
    expect(first.trail).toBe(true);
    expect(first.practice_round).toBeUndefined();
    await Ch.submit({ ct: first.ct, answers: allRightM() });
    const again = await Ch.exercise(hub(), 'missing', D);
    expect(again.practice_round).toBe(true);
    expect(again.trail_copy.practice).toMatch(/Practice round/);
  });

  test('Urdu: the trail copy is Urdu, gender-neutral, and no test word', async () => {
    on(RECORD, TRAIL, MISSING);
    const m = await Ch.menu(hub(), { ...D, lang: 'ur' });
    expect(m.trail_copy.title).toMatch(/راستہ/);
    for (const v of Object.values(m.trail_copy)) expect(v).not.toMatch(/\b(test|exam|assessment)\b|ٹیسٹ|امتحان/i);
  });
});

describe('switch proof: trail + missing ON without the record rule is byte-identical to all OFF', () => {
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'ct' ? undefined : v)));
  test('menu and the bigger exercise payloads are equal', async () => {
    const offMenu = strip(await Ch.menu(hub(), D));
    const offEx = strip(await Ch.exercise(hub(), 'bigger', D));
    Ch.__reset();
    on(TRAIL, MISSING);
    expect(strip(await Ch.menu(hub(), D))).toEqual(offMenu);
    expect(strip(await Ch.exercise(hub(), 'bigger', D))).toEqual(offEx);
    await expect(Ch.exercise(hub(), 'missing', D)).rejects.toMatchObject({ status: 503, body: { error: 'missing_off' } });
  });
});

describe('"On your own, or with help?" and the item clock on the row', () => {
  test('missing: helped as sent (true / false), null when not asked — never a default; clock row_paint', async () => {
    on(RECORD, TRAIL, MISSING);
    const a = await missing(allRightM(), { helped: true });
    expect(a.row.meta).toMatchObject({ helped: true, clock: 'row_paint' });
    const b = await missing(allRightM(), { helped: false });
    expect(b.row.meta.helped).toBe(false);
    const c = await missing(allRightM(), { helped: 'yes' });
    expect(c.row.meta.helped).toBeNull();
  });

  test('bigger on the trail keeps helped; bigger off the trail stores no helped key (today\'s 1a row)', async () => {
    on(RECORD);
    const off = await bigger(allRight, { helped: true });
    expect('helped' in off.row.meta).toBe(false);
    Ch.__reset();
    on(TRAIL);
    const onT = await bigger(allRight, { helped: true });
    expect(onT.row.meta.helped).toBe(true);
  });

  test('read on the trail: helped survives the scorer\'s final write', async () => {
    on(RECORD, TRAIL);
    const { row } = await read({ secs: 60, n: 40, right: 38, tried: 40, body: { helped: false } });
    expect(row.status).toBe('scored');
    expect(row.meta.helped).toBe(false);
  });
});
