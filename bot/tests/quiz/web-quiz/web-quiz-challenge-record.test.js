'use strict';
/**
 * The Challenge's record rules behind three switches (web-quiz-challenge.js):
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

let db;
beforeAll(() => { process.env.INTERNAL_API_KEY = 'test-internal-key'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.R2_BUCKET_NAME = 'r2-default'; });
beforeEach(() => {
  db = {
    app_settings: [{ key: 'web_quiz_challenge', value: true }],
    student_lists: [{ id: LIST, class_name: '3', section: 'B', user_id: 't1', is_active: true }],
    students: [{ id: KID, list_id: LIST, name: 'Sana Testwala' }, { id: KID2, list_id: LIST, name: 'Omar Khan' }],
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

describe('every switch off: today, byte for byte', () => {
  test('a bigger run stores only the page ms in meta; the pairs are served in the bank\'s order; the menu keeps its numbers', async () => {
    const { ex, row } = await bigger(allRight);
    expect(ex.items).toEqual(spec3().items.map((i) => ({ a: i.a, b: i.b })));
    expect(ex.record).toBeUndefined();
    expect(row.meta).toEqual({ ms: 25000 });
    const m = await Ch.menu(hub(), D);
    expect(m.exercises.find((e) => e.id === 'bigger')).toMatchObject({ done: true, last: { correct: 10, n: 10 } });
    expect(m.record).toBeUndefined();
  });
});

describe('record: the first scored attempt is the record', () => {
  test('a second bigger run is attempt 2, not counted; the menu is done from the first and shows no number; the result carries no "last time"', async () => {
    on(RECORD);
    const a = await bigger((items) => items.map((it, i) => ({ i, pick: Math.min(it.a, it.b), ms: 3000 })));
    const b = await bigger(allRight);
    expect(a.row.meta).toMatchObject({ attempt_no: 1, exposure_no: 1, counted: true });
    expect(b.row.meta).toMatchObject({ attempt_no: 2, exposure_no: 2, counted: false });
    expect(b.r.previous).toBeNull();
    const m = await Ch.menu(hub(), D);
    expect(m.record).toBe(true);
    expect(m.exercises.find((e) => e.id === 'bigger')).toMatchObject({ done: true, last: null });
  });

  test('the first attempt is found by its own ascending query, even past 50 newer rows', async () => {
    on(RECORD);
    const t0 = Date.now() - 100 * 60 * 1000;
    db.web_quiz_challenge_runs.push({ id: 'first-run', student_id: KID, exercise: 'bigger', grade: 3, status: 'scored', score: { correct: 3, n: 10, stopped: false }, created_at: new Date(t0).toISOString(), meta: { ms: 20000 } });
    for (let k = 1; k <= 55; k += 1) db.web_quiz_challenge_runs.push({ id: `later-${k}`, student_id: KID, exercise: 'bigger', grade: 3, status: 'scored', score: { correct: 10, n: 10, stopped: false }, created_at: new Date(t0 + k * 60 * 1000).toISOString(), meta: { ms: 20000 } });
    const { row } = await bigger(allRight);
    expect(row.meta.attempt_no).toBe(57);
    const res = await Ch.listResults({ list: LIST });
    expect(res.find((x) => x.student_id === KID && x.exercise === 'bigger')).toMatchObject({ score: 3, of: 10 });
  });

  test('a legacy early-stopped reading (no ended, no read_s) is read as incomplete: done on the menu, never a number', async () => {
    on(RECORD);
    db.web_quiz_challenge_runs.push({ id: 'legacy-read', student_id: KID, exercise: 'read', grade: 3, lang: 'en', status: 'scored', wcpm: 35, score: { correct: 35, attempted: 40, stopped: false, finished_early: false, time_left: 0 }, created_at: new Date(Date.now() - 3600 * 1000).toISOString(), meta: { duration_s: 43.3, ms: 43300 } });
    const m = await Ch.menu(hub(), { ...D, lang: 'en' });
    expect(m.exercises.find((e) => e.id === 'read')).toMatchObject({ done: true, last: null });
    const res = await Ch.listResults({ list: LIST });
    expect(res.find((x) => x.exercise === 'read')).toBeUndefined();
  });
});

describe('items: per-item verdicts and timings, numbers only', () => {
  test('ten rows with the answer\'s side and the tap\'s ms; three fast AND wrong taps make the run rapid, three fast right ones do not', async () => {
    on(RECORD, ITEMS);
    const fastWrong = (items) => items.map((it, i) => ({ i, pick: i < 3 ? Math.min(it.a, it.b) : Math.max(it.a, it.b), ms: i < 3 ? 300 : 2500 }));
    const a = await bigger(fastWrong, {}, { now: Date.now() + 40000 });
    expect(a.row.meta.items).toHaveLength(10);
    expect(a.row.meta.items[0]).toEqual({ i: 1, side: expect.stringMatching(/^[ab]$/), ok: false, ms: 300 });
    expect(a.row.meta.items[4]).toMatchObject({ i: 5, ok: true, ms: 2500 });
    expect(a.row.meta).toMatchObject({ rapid: true, none_n: 0, abandoned: false, too_fast: false });
    const fastRight = (items) => items.map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: i < 3 ? 300 : 2500 }));
    const b = await bigger(fastRight, {}, { now: Date.now() + 40000 });
    expect(b.row.meta.rapid).toBe(false);
    expect(JSON.stringify(b.row.meta)).not.toMatch(/Testwala|heard/);
  });

  test('a stop made of untouched items is abandoned, not a 0; a submit faster than its own taps is too fast', async () => {
    on(RECORD, ITEMS);
    const twoThenNothing = (items) => items.slice(0, 2).map((it, i) => ({ i, pick: Math.max(it.a, it.b), ms: 2000 }));
    const { row } = await bigger(twoThenNothing);
    expect(row.score).toMatchObject({ correct: 2, n: 10, stopped: true });
    expect(row.meta).toMatchObject({ none_n: 8, abandoned: true, too_fast: true });
    expect(row.meta.items[2]).toMatchObject({ i: 3, ok: null, ms: null });
  });
});

describe('record: the answer\'s side is balanced and the scoring is by value', () => {
  test('the G3 form serves exactly five pairs with the bigger number second; all right is still 10 / 10', async () => {
    on(RECORD);
    const { ex, r } = await bigger(allRight);
    const second = ex.items.filter((p) => p.b > p.a).length;
    expect(second).toBe(5);
    expect(ex.items.map((p) => [p.a, p.b].sort((x, y) => x - y))).toEqual(spec3().items.map((p) => [p.a, p.b].sort((x, y) => x - y)));
    expect(r.score).toMatchObject({ correct: 10, n: 10, stopped: false });
    const again = await Ch.exercise(hub(), 'bigger', D);
    expect(again.items).toEqual(ex.items);
  });
});

describe('record: a reading the child ended early is not a words-per-minute', () => {
  test('43 s of audio, the story unfinished ⇒ failed / incomplete with the seconds and the words read; the next reading is attempt 1, exposure 2', async () => {
    on(RECORD, GUARD);
    const { r, row } = await read({ secs: 43, n: 40, gap: 1.0, right: 35, tried: 40, body: { ended: 'stuck', read_s: 43, mic_check: 'pass' } });
    expect(r).toEqual({ failed: true, reason: 'incomplete', words: 35 });
    expect(row).toMatchObject({ status: 'failed' });
    expect(row.wcpm == null).toBe(true);
    expect(row.meta).toMatchObject({ reason: 'incomplete', ended: 'stuck', mic_check: 'pass', attempt_no: 1, exposure_no: 1 });
    expect(row.meta.read_s).toBeGreaterThanOrEqual(42);
    const next = await read({ secs: 60, n: 45, right: 42, tried: 45, body: { ended: 'timer', read_s: 60, mic_check: 'pass' } });
    expect(next.r).toMatchObject({ wcpm: 42, previous: null, ended: 'timer' });
    expect(next.row.meta).toMatchObject({ attempt_no: 1, exposure_no: 2, counted: true, clock: 'inferred', ended: 'timer' });
    expect(next.row.meta.flags).toContain('no_begin_line');
    expect(next.row.meta.flags).not.toContain('clock_given');
    expect(next.row.meta).toHaveProperty('begin_at_s');
    expect(next.row.meta).toHaveProperty('story_confidence');
  });

  test('a tap inside the first 15 s is abandoned: no words, exposure only', async () => {
    on(RECORD, GUARD);
    const { r, row } = await read({ secs: 8, n: 6, gap: 1.0, right: 5, tried: 6, body: { ended: 'stuck', read_s: 8, mic_check: 'pass' } });
    expect(r).toMatchObject({ failed: true, reason: 'abandoned' });
    expect(row.meta).toMatchObject({ reason: 'abandoned', exposure_no: 1 });
    expect(row.meta.attempt_no).toBeUndefined();
  });

  test('silence after a passed microphone check is a stopped reading (0), never "unheard"; without the check it is unheard as today', async () => {
    on(RECORD, GUARD);
    const a = await read({ secs: 12, n: 0, right: 0, tried: 0, body: { ended: 'silent', read_s: 12, mic_check: 'pass' } });
    expect(a.r).toMatchObject({ score: { correct: 0, attempted: 0, stopped: true }, wcpm: 0, ended: 'silent' });
    expect(a.row).toMatchObject({ status: 'scored', wcpm: 0 });
    expect(a.row.meta).toMatchObject({ ended: 'silent', mic_check: 'pass' });
    const b = await read({ secs: 12, n: 0, right: 0, tried: 0, body: { ended: 'silent', read_s: 12, mic_check: 'none' } });
    expect(b.r).toMatchObject({ failed: true, reason: 'unheard' });
  });

  test('with items on, the read row keeps the scorer\'s per-word verdicts and doubt, never what was heard', async () => {
    on(RECORD, ITEMS);
    const { row } = await read({ secs: 60, n: 45, right: 42, tried: 45, body: { ended: 'timer', read_s: 60 } });
    expect(row.meta.items).toHaveLength(enTokens().length);
    expect(row.meta.items[0]).toEqual({ i: 1, v: 'correct' });
    expect(JSON.stringify(row.meta.items)).not.toMatch(/heard|ref/);
    expect(row.meta).toHaveProperty('count_flag');
  });
});

describe('record: where the grade came from, and who is a test child', () => {
  test('grade_source names the branch (list / self / session / quiz); a "… Testwala" child is marked test, another is not', async () => {
    on(RECORD);
    const { row } = await bigger(allRight);
    expect(row.meta).toMatchObject({ grade_source: 'list', test: true, sequence_n: 1 });
    db.students = [{ id: KID2, self_reported_class: '4', name: 'Omar Khan' }];
    const ex = await Ch.exercise(hub([KID2]), 'bigger', D);
    await Ch.submit({ ct: ex.ct, taps: allRight(ex.items), ms: 25000 });
    const r2row = db.web_quiz_challenge_runs.find((x) => x.student_id === KID2);
    expect(r2row.meta).toMatchObject({ grade_source: 'self', test: false });
    db.students = [{ id: KID2, name: 'Omar Khan' }];
    db.quiz_sessions.push({ id: 'sess-2', student_id: KID2, share_code_id: SC, quiz_id: 'q1', student_class: '5', created_at: new Date().toISOString() });
    Ch.__reset();
    const ex2 = await Ch.exercise(hub([KID2]), 'bigger', D);
    await Ch.submit({ ct: ex2.ct, taps: allRight(ex2.items), ms: 25000 });
    expect(db.web_quiz_challenge_runs[db.web_quiz_challenge_runs.length - 1].meta.grade_source).toBe('session');
  });
});

describe('events carry the run', () => {
  test('ch_start and ch_done name the same opaque run id, never a child', async () => {
    on(RECORD);
    const { ex } = await bigger(allRight);
    const runId = T.verify(ex.ct, 'c').r;
    const starts = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.ch_start').map((c) => c[1]);
    const dones = logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.ch_done').map((c) => c[1]);
    expect(starts[0]).toMatchObject({ step: 'bigger', run: runId });
    expect(dones[0]).toMatchObject({ step: 'bigger', run: runId });
    expect(JSON.stringify([starts, dones])).not.toContain(KID);
  });
});

describe('the orphan sweeper: a recording whose result never came is deleted', () => {
  test('keys older than 10 minutes under this env\'s child-voice prefix are deleted, newer ones kept, counts logged', async () => {
    const now = Date.now();
    const old = `child-voice/sandbox/run-a/read-${now - 11 * 60 * 1000}.webm`;
    const fresh = `child-voice/sandbox/run-b/read-${now - 2 * 60 * 1000}.webm`;
    const odd = 'child-voice/sandbox/run-c/notes.txt';
    r2.listKeys.mockResolvedValue([old, fresh, odd]);
    const out = await Ch.sweepOrphans({ now });
    expect(r2.listKeys).toHaveBeenCalledWith('child-voice/sandbox/', { bucket: 'r2-default' });
    expect(r2.deleteKey).toHaveBeenCalledTimes(1);
    expect(r2.deleteKey).toHaveBeenCalledWith(old, { bucket: 'r2-default' });
    expect(out).toEqual({ listed: 3, deleted: 1, failed: 0 });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.ch_voice_swept', { listed: 3, deleted: 1, failed: 0 });
  });
});
