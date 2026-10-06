'use strict';
/**
 * The kid's Challenge on the web quiz: "Which is bigger?" (tap) and "Read aloud" (mic → words per minute).
 *
 * Faked boundaries only: Supabase (in-memory, filters applied), R2 (presign / head / download), Soniox
 * transcription (audio.service) and the LLM client. The challenge service, the tokens, the child-test item
 * bank and the child-test story scorer (with real ffmpeg on a real audio file) all run for real.
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

const hub = (ids = [KID]) => T.sign({ k: 'h', ids, exp: Math.floor(Date.now() / 1000) + 3600 });
const st = () => T.signSession({ sessionId: SESSION, deviceRef: 'd'.repeat(22), shareCodeId: SC });
const expectFail = async (p, status, error) => {
  await expect(p).rejects.toMatchObject({ status, body: expect.objectContaining({ error }) });
};

// ── tokens ───────────────────────────────────────────────────────────────────
describe('challenge token (kind c)', () => {
  test('signChallenge is a kind-c token for one student and one exercise, alive 2 hours', () => {
    const ct = T.signChallenge({ studentId: KID, ex: 'read', runId: 'r1' });
    const p = T.verify(ct, 'c');
    expect(p).toMatchObject({ k: 'c', sid: KID, ex: 'read', r: 'r1' });
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(2 * 3600 - 5);
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(2 * 3600);
    expect(T.verify(ct, 's')).toBeNull();
    expect(T.CHALLENGE_TTL_S).toBe(7200);
  });

  test('the menu opens from a hub token (kind h) and from a quiz session token; a preview token is refused', async () => {
    const a = await Ch.menu(hub());
    expect(a.exercises.map((e) => e.id)).toEqual(['bigger', 'read']);
    const b = await Ch.menu(st());
    expect(b.exercises.map((e) => e.id)).toEqual(['bigger', 'read']);
    const p = T.signPreview({ shareCodeId: SC, teacherUserId: 't1' });
    await expectFail(Ch.menu(p), 401, 'bad_token');
  });

  test('the kid chip is the hub page\'s own: T.chipId(\'h\', studentId)', () => {
    expect(Ch.kidChip(KID)).toBe(T.chipId('h', KID));
  });

  test('a hub token with two children needs the kid chip, and only a chip of ITS children works', async () => {
    const two = hub([KID, KID2]);
    await expectFail(Ch.menu(two), 400, 'pick_kid');
    const m = await Ch.menu(two, { kid: Ch.kidChip(KID2) });
    expect(m.exercises).toHaveLength(2);
    await expectFail(Ch.menu(hub([KID]), { kid: Ch.kidChip(KID2) }), 401, 'bad_token');
  });

  test('a loose child (no class list, as most quiz children are) gets a grade from their own class or their newest quiz', async () => {
    db.students[0].list_id = null;
    db.students[0].self_reported_class = '4B';
    expect((await Ch.menu(hub())).form).toBe('G5');
    db.students[0].self_reported_class = null;
    db.quiz_sessions[0].student_class = null;
    db.quiz_sessions[0].created_at = '2026-10-06T08:00:00Z';
    db.quizzes = [{ id: 'q1', grade: '3' }];
    expect((await Ch.menu(hub())).form).toBe('G3');
  });

  test('a band ("3-5") is not a grade: never its first digit', async () => {
    db.students[0].list_id = null;
    db.students[0].self_reported_class = '3-5';
    db.quizzes = [{ id: 'q1', grade: '3-5' }];
    await expectFail(Ch.menu(hub()), 403, 'not_eligible');
  });

  test('the class the child is enrolled in wins over the old list and the child\'s own answer', async () => {
    db.classes = [{ id: 'c5', grade_code: 'grade_5', is_active: true }];
    db.class_enrollments = [{ id: 'e1', class_id: 'c5', student_id: KID, is_active: true }];
    db.students[0].self_reported_class = '2';
    expect((await Ch.menu(hub())).form).toBe('G5');
  });

  test('switch off ⇒ 503; a grade outside 2-5 ⇒ not eligible', async () => {
    db.app_settings[0].value = false;
    await expectFail(Ch.menu(hub()), 503, 'challenge_off');
    Ch.__reset();
    db.app_settings[0].value = true;
    db.student_lists[0].class_name = '7';
    await expectFail(Ch.menu(hub()), 403, 'not_eligible');
  });
});

// ── the menu + one exercise ───────────────────────────────────────────────────
describe('menu and exercise payloads', () => {
  test('menu: two exercises with names in the kid\'s language, the G3 form, done/last from stored runs', async () => {
    db.web_quiz_challenge_runs.push({ id: 'x1', student_id: KID, exercise: 'bigger', status: 'scored', score: { correct: 7, n: 10 }, created_at: '2026-10-06T10:00:00Z' });
    const m = await Ch.menu(hub(), { lang: 'ur' });
    expect(m.form).toBe('G3');
    expect(m.lang).toBe('ur');
    expect(m.exercises[0]).toMatchObject({ id: 'bigger', name: 'کون سا بڑا ہے؟', mins: 2, done: true, last: { correct: 7, n: 10 } });
    expect(m.exercises[1]).toMatchObject({ id: 'read', done: false, last: null });
  });

  test('a quiz-token entry takes the quiz language when the page names none', async () => {
    db.quiz_share_codes[0].language = 'ur';
    expect((await Ch.menu(st())).lang).toBe('ur');
  });

  test('bigger: the grade form\'s 10 pairs and 2 practice pairs from the item bank, without the answers', async () => {
    const x = await Ch.exercise(hub(), 'bigger');
    const bank = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' });
    expect(x.items.map((i) => [i.a, i.b])).toEqual(bank.items.map((i) => [i.a, i.b]));
    expect(x.items.some((i) => 'answer' in i)).toBe(false);
    expect(x.practice).toEqual(bank.practice.map((i) => ({ a: i.a, b: i.b, answer: i.answer })));
    expect(x.per_item_s).toBe(10);
    expect(T.verify(x.ct, 'c')).toMatchObject({ sid: KID, ex: 'bigger' });
    db.student_lists[0].class_name = '5';
    const g5 = await Ch.exercise(hub(), 'bigger');
    expect(g5.items[6]).toEqual({ a: 0.6, b: 0.8 });
  });

  test('read: the story of the page\'s language with its lines, 60 seconds', async () => {
    const x = await Ch.exercise(hub(), 'read', { lang: 'ur' });
    const bank = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ur.story' });
    expect(x.story.tokens).toEqual(bank.story.tokens);
    expect(x.story.lines[0]).toEqual({ n: 1, from: 0, to: 10 });
    expect(x.story.dir).toBe('rtl');
    expect(x.secs).toBe(60);
    expect(x.clips.intro.text).toBeTruthy();
    expect(Object.keys(x.clips)).toEqual(['intro', 'start', 'stop', 'done']);
  });

  test('a missing mascot clip is recorded once in the quiz voice (provider pinned) into the quiz-audio bucket', async () => {
    const tts = require('../../../shared/services/tts');
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio-test';
    process.env.RAILWAY_ENVIRONMENT_NAME = 'sandbox';
    r2.headObject.mockResolvedValue({ exists: false });
    try {
      const x = await Ch.exercise(hub(), 'read', { lang: 'en' });
      expect(x.clips.intro.url).toBeNull();
      for (let k = 0; k < 20 && r2.uploadBuffer.mock.calls.length < 4; k += 1) await new Promise((r) => setTimeout(r, 5));
      expect(tts.synthesize).toHaveBeenCalledWith(expect.objectContaining({ language: 'en', provider: 'soniox', voice: 'Grace' }));
      const [, key, type, opts] = r2.uploadBuffer.mock.calls[0];
      expect(key).toMatch(/^quiz-audio\/sandbox\/challenge\/en\/read\/(intro|start|stop|done)-sx-grace-[0-9a-f]{8}\.ogg$/);
      expect(type).toBe('audio/ogg');
      expect(opts).toEqual({ bucket: 'quiz-audio-test' });
      expect(r2.headObject).toHaveBeenCalledWith(expect.stringMatching(/^quiz-audio\/sandbox\/challenge\//), { bucket: 'quiz-audio-test' });
      tts.synthesize.mockClear();
      await Ch.exercise(hub(), 'read', { lang: 'en' });
      expect(tts.synthesize).not.toHaveBeenCalled();
    } finally {
      delete process.env.WEB_QUIZ_AUDIO_BUCKET;
      delete process.env.RAILWAY_ENVIRONMENT_NAME;
      r2.headObject.mockResolvedValue({ exists: true, sizeBytes: 400000, contentType: 'audio/webm' });
    }
  });

  test('an existing clip is signed from the quiz-audio bucket', async () => {
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio-test';
    try {
      const x = await Ch.exercise(hub(), 'bigger', { lang: 'ur' });
      expect(x.clips.start.url).toMatch(/^https:\/\/signed\.test\/quiz-audio\/.+\/challenge\/ur\/bigger\/start-sx-ishita-[0-9a-f]{8}\.ogg\?b=quiz-audio-test$/);
    } finally { delete process.env.WEB_QUIZ_AUDIO_BUCKET; }
  });

  test('an exercise that is not built yet is not offered', async () => {
    await expectFail(Ch.exercise(hub(), 'sums'), 404, 'not_found');
  });
});

// ── "Which is bigger?" scored on the server ──────────────────────────────────
describe('bigger: the server re-scores and re-applies the 4-in-a-row stop', () => {
  const bank = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' }).items;
  const taps = (picks, ms = 2000) => picks.map((pick, i) => ({ i, pick, ms }));

  test('all right ⇒ 10 / 10, stored once', async () => {
    const { ct } = await Ch.exercise(hub(), 'bigger');
    const r = await Ch.submit({ ct, taps: taps(bank().map((i) => i.answer)), ms: 30000 });
    expect(r).toEqual({ score: { correct: 10, n: 10, stopped: false }, previous: null });
    expect(db.web_quiz_challenge_runs).toHaveLength(1);
    expect(db.web_quiz_challenge_runs[0]).toMatchObject({ student_id: KID, exercise: 'bigger', status: 'scored', grade: 3 });
    await expectFail(Ch.submit({ ct, taps: [], ms: 1 }), 409, 'already_done');
  });

  test('4 wrong in a row stops it: answers the phone sent after the stop are not counted', async () => {
    const { ct } = await Ch.exercise(hub(), 'bigger');
    const items = bank();
    const wrong = (i) => (items[i].answer === items[i].a ? items[i].b : items[i].a);
    const picks = items.map((it, i) => ((i >= 2 && i <= 5) ? wrong(i) : it.answer));
    const r = await Ch.submit({ ct, taps: taps(picks), ms: 30000 });
    expect(r.score).toEqual({ correct: 2, n: 10, stopped: true });
  });

  test('a tap slower than 10 s is a miss; a missing tap is a miss; a number that is not on the card is a miss', async () => {
    const { ct } = await Ch.exercise(hub(), 'bigger');
    const items = bank();
    const t = taps(items.map((i) => i.answer));
    t[0].ms = 10500;
    t[1].pick = 999;
    t.splice(2, 1);
    const r = await Ch.submit({ ct, taps: t, ms: 30000 });
    expect(r.score).toEqual({ correct: 7, n: 10, stopped: false });
  });

  test('a challenge token for another exercise, or a forged one, is refused', async () => {
    const { ct } = await Ch.exercise(hub(), 'read');
    await expectFail(Ch.submit({ ct, taps: taps([1]), ms: 1 }), 400, 'no_audio');
    await expectFail(Ch.submit({ ct: `${ct}x`, taps: [], ms: 1 }), 401, 'bad_token');
  });
});

// ── the words-per-minute formula ─────────────────────────────────────────────
describe('wcpm = correct / (60 − time_left) × 60', () => {
  test('the full minute', () => expect(Ch.wcpm(42, 0)).toBe(42));
  test('an early finish counts only the time used', () => expect(Ch.wcpm(60, 15)).toBe(80));
  test('nothing correct is 0, and time_left never divides by zero', () => {
    expect(Ch.wcpm(0, 0)).toBe(0);
    expect(Ch.wcpm(5, 60)).toBe(0);
  });
});

// ── upload presign ───────────────────────────────────────────────────────────
describe('upload: presigned PUT straight to R2', () => {
  test('key = child-voice/<env>/<run>/read-<ts>.<ext> (the private prefix), content type signed, 15 minutes', async () => {
    const { ct } = await Ch.exercise(hub(), 'read');
    const run = T.verify(ct, 'c').r;
    const u = await Ch.presignUpload({ ct, type: 'audio/webm;codecs=opus', size: 600000 });
    expect(u.key).toMatch(new RegExp(`^child-voice/sandbox/${run}/read-\\d{13}\\.webm$`));
    expect(u.content_type).toBe('audio/webm');
    expect(r2.getPresignedUploadUrl).toHaveBeenCalledWith(u.key, 'audio/webm', 900, { bucket: 'r2-default' });
    expect(u.put_url).toContain(encodeURIComponent('audio/webm'));
    expect(u.max_bytes).toBe(3 * 1024 * 1024);
    const mp4 = await Ch.presignUpload({ ct, type: 'audio/mp4', size: 1000 });
    expect(mp4.key).toMatch(/\.m4a$/);
  });

  test('the child\'s voice goes to CHILD_VOICE_BUCKET, else the quiz-audio bucket — never a default that is prod\'s on staging', async () => {
    const { ct } = await Ch.exercise(hub(), 'read');
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio-staging';
    try {
      await Ch.presignUpload({ ct, type: 'audio/webm', size: 10 });
      expect(r2.getPresignedUploadUrl).toHaveBeenLastCalledWith(expect.any(String), 'audio/webm', 900, { bucket: 'quiz-audio-staging' });
      process.env.CHILD_VOICE_BUCKET = 'child-voice-private';
      await Ch.presignUpload({ ct, type: 'audio/webm', size: 10 });
      expect(r2.getPresignedUploadUrl).toHaveBeenLastCalledWith(expect.any(String), 'audio/webm', 900, { bucket: 'child-voice-private' });
    } finally { delete process.env.WEB_QUIZ_AUDIO_BUCKET; delete process.env.CHILD_VOICE_BUCKET; }
  });

  test('over 3 MB, a non-audio type, or the "bigger" exercise ⇒ refused before any URL is made', async () => {
    const { ct } = await Ch.exercise(hub(), 'read');
    await expectFail(Ch.presignUpload({ ct, type: 'audio/webm', size: 3 * 1024 * 1024 + 1 }), 413, 'too_large');
    await expectFail(Ch.presignUpload({ ct, type: 'text/html', size: 10 }), 400, 'wrong_type');
    const b = await Ch.exercise(hub(), 'bigger');
    await expectFail(Ch.presignUpload({ ct: b.ct, type: 'audio/webm', size: 10 }), 400, 'no_audio');
    expect(r2.getPresignedUploadUrl).not.toHaveBeenCalled();
  });
});

// ── read aloud: the story scorer, end to end ─────────────────────────────────
describe('read aloud: scored by the child-test story scorer', () => {
  const FF = require('@ffmpeg-installer/ffmpeg').path;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqch-'));
  const clip = (secs) => {
    const f = path.join(dir, `s${secs}.webm`);
    if (!fs.existsSync(f)) execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', String(secs), '-c:a', 'libopus', f]);
    return fs.readFileSync(f);
  };
  const enTokens = () => Bank.getTaskSpec({ grade: 3, set: 'A', task: 'en.story' }).story.tokens;
  // Soniox heard the first `n` words, one every `gap` seconds.
  const heard = (n, gap) => ({ text: '', tokens: enTokens().slice(0, n).map((w, k) => ({ text: ` ${w}`, start_ms: Math.round(k * gap * 1000), end_ms: Math.round((k * gap + gap * 0.8) * 1000), speaker: 1 })) });
  const marks = (verdicts) => ({ usage: { cost: 0.0021 }, choices: [{ message: { content: JSON.stringify({
    words: verdicts.map((v, k) => ({ i: k + 1, w: enTokens()[k], v })), words_correct: 0, words_attempted: 0, notes: '' }) } }] });
  const start = async () => {
    const { ct } = await Ch.exercise(hub(), 'read', { lang: 'en' });
    const { key } = await Ch.presignUpload({ ct, type: 'audio/webm', size: 500000 });
    return { ct, key };
  };

  test('42 words right in the full minute ⇒ wcpm 42; only numbers are stored and the recording is deleted', async () => {
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(45, 1.3));
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 42 ? 'correct' : k < 45 ? 'wrong' : 'skipped'))));
    const r = await Ch.submit({ ct, key, ms: 60000 }, { waitMs: 60000 });
    expect(r).toMatchObject({ score: { correct: 42, attempted: 45, stopped: false }, wcpm: 42 });
    const row = db.web_quiz_challenge_runs[0];
    expect(row).toMatchObject({ exercise: 'read', status: 'scored', lang: 'en' });
    expect(row.wcpm).toBe(42);
    expect(row.meta.cost_usd).toBeGreaterThan(0);
    expect(row.meta.duration_s).toBeGreaterThan(59);
    expect(JSON.stringify(row)).not.toContain(key);
    expect(r2.downloadFromR2).toHaveBeenCalledWith(key, { bucket: 'r2-default' });
    expect(r2.headObject).toHaveBeenCalledWith(key, { bucket: 'r2-default' });
    expect(r2.deleteKey).toHaveBeenCalledWith(key, { bucket: 'r2-default' });
  });

  test('the result carries the child\'s previous scored run (the growth line), null the first time', async () => {
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(45, 1.3));
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 42 ? 'correct' : 'skipped'))));
    const first = await Ch.submit({ ct, key, ms: 60000 }, { waitMs: 60000 });
    expect(first.previous).toBeNull();
    const again = await start();
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 45 ? 'correct' : 'skipped'))));
    const second = await Ch.submit({ ct: again.ct, key: again.key, ms: 60000 }, { waitMs: 60000 });
    expect(second.wcpm).toBe(45);
    expect(second.previous).toMatchObject({ wcpm: 42 });
    const b1 = await Ch.exercise(hub(), 'bigger');
    const items = Bank.getTaskSpec({ grade: 3, set: 'A', task: 'ma.discrimination' }).items;
    await Ch.submit({ ct: b1.ct, taps: items.map((it, i) => ({ i, pick: it.answer, ms: 1000 })), ms: 1 });
    const b2 = await Ch.exercise(hub(), 'bigger');
    const r = await Ch.submit({ ct: b2.ct, taps: [], ms: 1 });
    expect(r.previous).toMatchObject({ correct: 10, n: 10 });
  });

  test('the whole story read in 30 s ⇒ the early finish counts only the 30 s used', async () => {
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(32));
    AudioService.transcribe.mockResolvedValue(heard(60, 0.5));
    llm.__create.mockResolvedValue(marks(enTokens().map(() => 'correct')));
    const r = await Ch.submit({ ct, key, ms: 32000 }, { waitMs: 60000 });
    expect(r.score.finished_early).toBe(true);
    expect(r.wcpm).toBeGreaterThan(110);
    expect(r.wcpm).toBe(Ch.wcpm(60, r.score.time_left));
  });

  test('nothing right in line 1 ⇒ auto-stopped, wcpm 0', async () => {
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(20));
    AudioService.transcribe.mockResolvedValue(heard(6, 2));
    llm.__create.mockResolvedValue(marks(enTokens().map((_, k) => (k < 6 ? 'wrong' : 'skipped'))));
    const r = await Ch.submit({ ct, key, ms: 20000 }, { waitMs: 60000 });
    expect(r).toMatchObject({ score: { correct: 0, stopped: true }, wcpm: 0 });
  });

  test('scoring slower than the wait ⇒ {pending}, and the poll returns the score when it lands', async () => {
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(60));
    AudioService.transcribe.mockResolvedValue(heard(45, 1.3));
    let release;
    llm.__create.mockImplementation(() => new Promise((res) => { release = () => res(marks(enTokens().map((_, k) => (k < 30 ? 'correct' : 'skipped')))); }));
    const r = await Ch.submit({ ct, key, ms: 60000 }, { waitMs: 0 });
    expect(r).toEqual({ pending: true });
    expect(await Ch.poll(ct)).toEqual({ pending: true });
    for (let k = 0; k < 100 && !release; k += 1) await new Promise((s) => setTimeout(s, 20));
    release();
    let p = { pending: true };
    for (let k = 0; k < 200 && p.pending; k += 1) { await new Promise((s) => setTimeout(s, 20)); p = await Ch.poll(ct); }
    expect(p).toMatchObject({ score: { correct: 30 }, wcpm: 30 });
  });

  test('a key that is not this run\'s upload, or an upload over 3 MB, is refused', async () => {
    const { ct } = await start();
    await expectFail(Ch.submit({ ct, key: 'child-voice/sandbox/someone-else/read-1234567890123.webm', ms: 1 }), 403, 'not_your_upload');
    const { ct: ct2, key: key2 } = await start();
    r2.headObject.mockResolvedValueOnce({ exists: true, sizeBytes: 3 * 1024 * 1024 + 5 });
    await expectFail(Ch.submit({ ct: ct2, key: key2, ms: 1 }), 413, 'too_large');
    expect(r2.deleteKey).toHaveBeenCalledWith(key2, { bucket: 'r2-default' });
  });

  test('every refusal after the upload deletes it: over the day\'s limit, a malformed key under the run\'s own prefix', async () => {
    for (let k = 0; k < 10; k += 1) db.web_quiz_challenge_runs.push({ id: `old${k}`, student_id: KID, exercise: 'read', status: 'scored', created_at: new Date().toISOString() });
    const { ct, key } = await start();
    await expectFail(Ch.submit({ ct, key, ms: 1 }), 429, 'enough_for_today');
    expect(r2.deleteKey).toHaveBeenCalledWith(key, { bucket: 'r2-default' });
    r2.deleteKey.mockClear();
    const own = `${key.slice(0, key.lastIndexOf('/') + 1)}read-x.html`;
    await expectFail(Ch.submit({ ct, key: own, ms: 1 }), 403, 'not_your_upload');
    expect(r2.deleteKey).toHaveBeenCalledWith(own, { bucket: 'r2-default' });
    r2.deleteKey.mockClear();
    await expectFail(Ch.submit({ ct, key: 'child-voice/sandbox/another-run/read-1234567890123.webm', ms: 1 }), 403, 'not_your_upload');
    expect(r2.deleteKey).not.toHaveBeenCalled();
  });

  test('a scorer failure is a distinct failed status, never a 0', async () => {
    const { ct, key } = await start();
    r2.downloadFromR2.mockResolvedValue(clip(10));
    AudioService.transcribe.mockRejectedValue(new Error('soniox down'));
    const r = await Ch.submit({ ct, key, ms: 10000 }, { waitMs: 60000 });
    expect(r).toEqual({ failed: true, reason: 'stt_failed' });
    expect(db.web_quiz_challenge_runs[0]).toMatchObject({ status: 'failed' });
    expect(r2.deleteKey).toHaveBeenCalledWith(key, { bucket: 'r2-default' });
  });
});

// ── results for the teacher report (M3) ──────────────────────────────────────
describe('results for a class', () => {
  test('class=<classes.id>: the children enrolled in it (loose rows included); list= maps through student_lists.class_id', async () => {
    const LOOSE = '77777777-7777-4777-8777-777777777777';
    const C3 = 'c3c3c3c3-0000-4000-8000-000000000003';
    db.students.push({ id: LOOSE, list_id: null });
    db.class_enrollments = [{ id: 'e1', class_id: C3, student_id: LOOSE, is_active: true }, { id: 'e2', class_id: C3, student_id: KID2, is_active: false }];
    db.student_lists[0].class_id = C3;
    db.web_quiz_challenge_runs.push(
      { id: 'a', student_id: LOOSE, exercise: 'read', status: 'scored', score: { correct: 30 }, wcpm: 30, created_at: '2026-10-06T10:00:00Z', scored_at: '2026-10-06T10:00:40Z' },
      { id: 'b', student_id: KID2, exercise: 'read', status: 'scored', score: { correct: 9 }, wcpm: 9, created_at: '2026-10-06T10:00:00Z', scored_at: '2026-10-06T10:00:40Z' },
    );
    const byClass = await Ch.listResults({ cls: C3 });
    expect(byClass.map((r) => r.student_id)).toEqual([LOOSE]);
    const byList = await Ch.listResults({ list: LIST });
    expect(byList.map((r) => r.student_id).sort()).toEqual([KID2, LOOSE].sort());
  });
});

describe('results for a class list', () => {
  test('latest scored run per child and exercise, only children of that list', async () => {
    db.students.push({ id: 'other', list_id: 'another-list' });
    db.web_quiz_challenge_runs.push(
      { id: 'a', student_id: KID, exercise: 'read', status: 'scored', score: { correct: 30 }, wcpm: 30, created_at: '2026-10-06T10:00:00Z', scored_at: '2026-10-06T10:00:40Z' },
      { id: 'b', student_id: KID, exercise: 'read', status: 'scored', score: { correct: 40 }, wcpm: 40, created_at: '2026-10-06T11:00:00Z', scored_at: '2026-10-06T11:00:40Z' },
      { id: 'c', student_id: KID2, exercise: 'bigger', status: 'scored', score: { correct: 8, n: 10 }, created_at: '2026-10-06T09:00:00Z', scored_at: '2026-10-06T09:00:00Z' },
      { id: 'd', student_id: KID2, exercise: 'read', status: 'failed', score: null, created_at: '2026-10-06T09:30:00Z' },
      { id: 'e', student_id: 'other', exercise: 'bigger', status: 'scored', score: { correct: 9, n: 10 }, created_at: '2026-10-06T09:00:00Z' },
    );
    const out = await Ch.listResults({ list: LIST });
    expect(out).toEqual(expect.arrayContaining([
      { student_id: KID, exercise: 'read', score: 40, wcpm: 40, at: '2026-10-06T11:00:40Z' },
      { student_id: KID2, exercise: 'bigger', score: 8, of: 10, at: '2026-10-06T09:00:00Z' },
    ]));
    expect(out).toHaveLength(2);
  });
});

// ── over HTTP: the internal routes ───────────────────────────────────────────
describe('internal routes /api/internal/wq/ch/*', () => {
  test('menu, the poll route (not taken for an exercise), and service errors keep their status', async () => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${srv.address().port}/api/internal/wq`;
    const H = { 'x-api-key': 'test-internal-key', 'content-type': 'application/json' };
    try {
      const m = await fetch(`${base}/ch/${hub()}?lang=en`, { headers: H });
      expect(m.status).toBe(200);
      expect((await m.json()).exercises.map((e) => e.id)).toEqual(['bigger', 'read']);
      const x = await (await fetch(`${base}/ch/${hub()}/bigger`, { headers: H })).json();
      const poll = await fetch(`${base}/ch/result/${x.ct}`, { headers: H });
      expect(poll.status).toBe(404);
      expect(await poll.json()).toEqual({ error: 'not_found' });
      const up = await fetch(`${base}/ch/upload`, { method: 'POST', headers: H, body: JSON.stringify({ ct: 'forged', type: 'audio/webm', size: 1 }) });
      expect(up.status).toBe(401);
      const res = await fetch(`${base}/challenge/results?list=${LIST}`, { headers: H });
      expect(await res.json()).toEqual([]);
    } finally { srv.close(); }
  });
});
