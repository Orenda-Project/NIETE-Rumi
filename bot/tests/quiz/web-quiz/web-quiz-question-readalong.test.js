'use strict';
/**
 * Jugnu's read-along on a quiz QUESTION, for a quiz with one voice (app_settings web_quiz_one_voice).
 *
 * A · Publish: the question's clip is asked of the voice WITH its characters' times (the same generation, no extra
 *     characters). When the words spoken are the words printed, the question gets its word times: inline on the clip
 *     map (meta.web_one.audio[qid].q_ra, compact) and as a READALONG v1 file beside the clip (<clip>.json).
 * B · Serve: behind app_settings web_quiz_question_readalong (default off, JSON true only), the page is told
 *     (question_readalong) and each timed question carries audio.ra for the shared player (wq-readalong.js).
 *
 * Off (either switch), everything is today's: the parts asked, the files written, the payload.
 *
 * Boundaries faked: supabase (in-memory), R2 + the voice gateway, the loggers. The services run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  getPresignedUrl: jest.fn(async (u) => u),
}));
// 40 ms a character; the clip is 2 s. The voice is given `text`, and reports the times of exactly those characters.
const align = (text) => ({
  characters: [...text], character_start_times_seconds: [...text].map((_, k) => k * 0.04),
  character_end_times_seconds: [...text].map((_, k) => (k + 1) * 0.04),
});
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async ({ provider, voice, text, timestamps }) => ({
    audio: Buffer.from('OggS-fake'), provider, voice, durationSec: 2, ...(timestamps ? { alignment: align(text) } : {}),
  })),
}));

const crypto = require('crypto');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const QRA = require('../../../shared/services/quiz/web-quiz-question-readalong');
const tts = require('../../../shared/services/tts');
const r2 = require('../../../shared/storage/r2');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const QID = '99999991-9999-4999-8999-999999999999';
const QID2 = '99999992-9999-4999-8999-999999999999';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const TEXT = 'Which month comes after January?';

function row(id, extra = {}) {
  return {
    id, quiz_id: QUIZ, external_id: `vb:${id}`, sort_order: id === QID2 ? 2 : 1, question_text: TEXT,
    option_a: 'February', option_b: 'May', option_c: 'March', option_d: 'June', correct_option: 'A',
    explanation: 'February is the second month.', option_feedback: {}, media: {}, render_pattern: 'P6a', ...extra,
  };
}
// Question 2's printed words are not what the voice says (a TeX fraction is said in words): no timings for it.
const ROWS = () => [row(QID), row(QID2, { question_text: 'What is $\\frac{1}{2}$ of 10?' })];

function seed(rows, { one, ra, meta = {} } = {}) {
  const settings = [];
  if (one !== undefined) settings.push({ key: 'web_quiz_one_voice', value: one });
  if (ra !== undefined) settings.push({ key: 'web_quiz_question_readalong', value: ra });
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Months', language: 'en', active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: 'en', meta, quiz_source: 'video' }],
    quiz_questions: rows, quiz_sessions: [], students: [], quiz_answers: [], app_settings: settings,
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return fake;
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET;
  WQ._resetQuizCache(); OneVoice.reset(); QRA.reset();
  tts.synthesize.mockClear(); r2.uploadBuffer.mockClear(); r2.headObject.mockClear();
  r2.headObject.mockImplementation(async () => ({ exists: false }));
});
afterAll(() => { process.env = SAVED; });

const jsonUploads = () => r2.uploadBuffer.mock.calls.filter((c) => c[2] === 'application/json');

describe('A · the question\'s clip is recorded with its word times', () => {
  test('one voice: only the question part asks for times; the times are kept inline and as a v1 file beside the clip', async () => {
    const fake = seed(ROWS(), { one: true });
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(out.ok).toBe(true);
    const asked = tts.synthesize.mock.calls.map(([a]) => a);
    expect(asked.filter((a) => a.timestamps).map((a) => a.text)).toEqual([TEXT, expect.any(String)]);   // the q of each question
    asked.filter((a) => a.timestamps).forEach((a) => expect(a.provider).toBe('elevenlabs'));
    expect(asked.filter((a) => a.text === 'February')[0].timestamps).toBeUndefined();

    const entry = fake.db.quizzes[0].meta.web_one.audio[QID];
    // 'Which' = chars 0..4 → 0..200 ms; 'month' = chars 6..10 → 240..440 ms …
    expect(entry.q_ra).toEqual({ ms: 2000, w: [[0, 200], [240, 440], [480, 680], [720, 920], [960, 1280]] });
    const files = jsonUploads();
    expect(files).toHaveLength(1);
    expect(files[0][1]).toBe(entry.q.replace(/\.ogg$/, '.json'));
    const file = JSON.parse(files[0][0].toString());
    const words = TEXT.split(' ');
    expect(file).toEqual({
      v: 1, id: `q/${QID}`, lang: 'en', dir: 'ltr',
      audio: { url: entry.q.split('/').pop(), ms: 2000, mime: 'audio/ogg; codecs=opus' },
      words: words.map((t, i) => ({ i, t, s_ms: entry.q_ra.w[i][0], e_ms: entry.q_ra.w[i][1] })),
      voice: { provider: 'elevenlabs', voice: 'hpp4J3VqNfWAUOO0d1Us', model: 'eleven_v4' },
      timing_src: 'tts_align',
      text_hash: `sha256:${crypto.createHash('sha256').update(words.join(' ')).digest('hex').slice(0, 8)}`,
    });
    // the rules the player checks: in order, no gaps, inside the clip
    file.words.forEach((w, k) => {
      expect(w.i).toBe(k);
      expect(w.s_ms).toBeLessThan(w.e_ms);
      expect(w.e_ms).toBeLessThanOrEqual(file.audio.ms);
      if (k) expect(w.s_ms).toBeGreaterThanOrEqual(file.words[k - 1].s_ms);
    });
  });

  test('words spoken are not the words printed: no timings for that question (the page reads it as today)', async () => {
    const fake = seed(ROWS(), { one: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const entry = fake.db.quizzes[0].meta.web_one.audio[QID2];
    expect(entry.q).toBeTruthy();
    expect('q_ra' in entry).toBe(false);
    expect(jsonUploads().map((c) => c[1])).not.toContain(entry.q.replace(/\.ogg$/, '.json'));
  });

  test('punctuation and case do not matter in the comparison; one pair per PRINTED word', () => {
    const spoken = 'which month, comes after january';
    const r = QRA.timings({ printed: TEXT, alignment: align(spoken), ms: 2000 });
    expect(r.w).toHaveLength(5);
    expect(QRA.timings({ printed: TEXT, alignment: align('Which month comes before January?'), ms: 2000 })).toBe(null);
    expect(QRA.timings({ printed: TEXT, alignment: null, ms: 2000 })).toBe(null);
  });

  test('a time past the clip\'s end is held to the end; a word that cannot be timed drops the whole question', () => {
    const r = QRA.timings({ printed: 'Go now', alignment: align('Go now'), ms: 220 });
    expect(r).toEqual({ ms: 220, w: [[0, 80], [120, 220]] });
    expect(QRA.timings({ printed: 'Go now', alignment: align('Go now'), ms: 100 })).toBe(null);
  });

  test('a stem with maths in it ($…$) gets no times, even when its maths is said as the same words; a plain stem does', async () => {
    const MATHS = 'What is $5$ more than 7?';
    expect(QRA.timings({ printed: MATHS, alignment: align('What is 5 more than 7?'), ms: 2000 })).toBe(null);
    expect(QRA.timings({ printed: 'What is 5 more than 7?', alignment: align('What is 5 more than 7?'), ms: 2000 }).w).toHaveLength(6);
    const fake = seed([row(QID, { question_text: MATHS }), row(QID2)], { one: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const audio = fake.db.quizzes[0].meta.web_one.audio;
    expect(audio[QID].q).toBeTruthy();
    expect('q_ra' in audio[QID]).toBe(false);   // the page draws its maths as today
    expect(audio[QID2].q_ra).toBeTruthy();       // the plain stem is timed
    expect(jsonUploads().map((c) => c[1])).toEqual([audio[QID2].q.replace(/\.ogg$/, '.json')]);
  });

  test('a clip already recorded is not recorded again just for its times', async () => {
    r2.headObject.mockImplementation(async () => ({ exists: true }));
    const fake = seed(ROWS(), { one: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(jsonUploads()).toEqual([]);
    expect('q_ra' in fake.db.quizzes[0].meta.web_one.audio[QID]).toBe(false);
  });

  test('a clip kept from an earlier run keeps the word times it was recorded with', async () => {
    const fake = seed(ROWS(), { one: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const first = fake.db.quizzes[0].meta.web_one.audio[QID].q_ra;
    expect(first).toBeTruthy();
    r2.headObject.mockImplementation(async () => ({ exists: true }));
    tts.synthesize.mockClear();
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(fake.db.quizzes[0].meta.web_one.audio[QID].q_ra).toEqual(first);
  });

  test.each([[undefined], [false]])('one voice off (%p): no times asked, no file, no q_ra (today)', async (one) => {
    const fake = seed(ROWS(), { one });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(tts.synthesize.mock.calls.some(([a]) => 'timestamps' in a)).toBe(false);
    expect(jsonUploads()).toEqual([]);
    Object.values(fake.db.quizzes[0].meta.web.audio).forEach((e) => expect('q_ra' in e).toBe(false));
  });
});

describe('B · the page is told, behind web_quiz_question_readalong', () => {
  const qKey = (qid) => `quiz-audio/sandbox/${QUIZ}/en/${qid}/q-el-bella-0000000${qid === QID ? 1 : 2}.ogg`;
  const Q_RA = { ms: 2000, w: [[0, 200], [240, 440], [480, 680], [720, 920], [960, 1280]] };
  const META = () => ({
    web_one: { audio: {
      [QID]: { q: qKey(QID), opts: [null, null, null, null], why: null, fbs: [null, null, null, null], q_ra: Q_RA },
      [QID2]: { q: qKey(QID2), opts: [null, null, null, null], why: null, fbs: [null, null, null, null] },
    } },
  });
  // the signed map as presignAudio makes it (q_ra is not a link: it is joined from the meta map)
  const SIGNED = () => ({
    [QID]: { q: `https://r2.example/${qKey(QID)}?X-Amz-Signature=x`, opts: [null, null, null, null], why: null },
    [QID2]: { q: `https://r2.example/${qKey(QID2)}?X-Amz-Signature=x`, opts: [null, null, null, null], why: null },
  });
  async function page(opts) {
    seed(ROWS(), { meta: META(), ...opts });
    const helpers = require('../../../shared/services/quiz/web-quiz-media');
    const spy = jest.spyOn(helpers, 'presignAudio').mockResolvedValue(SIGNED());
    try { return await WQ.getQuiz('AB12CD'); } finally { spy.mockRestore(); }
  }
  const strip = (o) => JSON.stringify(o, (k, v) => (/token|expires|_at$|nonce|sig/i.test(k) ? undefined : v));

  test('both on: question_readalong and, on a timed question, audio.ra with the printed words', async () => {
    const out = await page({ one: true, ra: true });
    expect(out.question_readalong).toBe(true);
    const [q1, q2] = out.quiz.questions;
    expect(q1.audio.q).toBe(SIGNED()[QID].q);
    expect(q1.audio.ra).toEqual({
      v: 1, lang: 'en', dir: 'ltr', ms: 2000,
      words: TEXT.split(' ').map((t, i) => ({ i, t, s_ms: Q_RA.w[i][0], e_ms: Q_RA.w[i][1] })),
    });
    expect('ra' in q2.audio).toBe(false);
    expect(JSON.stringify(out)).not.toContain('q_ra');
  });

  test('a stem with maths in it ($…$) is never served word times, even with times stored for its clip', () => {
    const entry = { q: qKey(QID), q_ra: { ms: 2000, w: [[0, 100], [120, 200], [220, 300], [320, 400], [420, 500], [520, 600]] } };
    const url = `https://r2.example/${qKey(QID)}?X-Amz-Signature=x`;
    expect(QRA.raFor({ entry, url, printed: 'What is $5$ more than 7?', lang: 'en' })).toBe(null);
    expect(QRA.raFor({ entry, url, printed: 'What is 5 more than 7?', lang: 'en' }).words).toHaveLength(6);
  });

  test('a question edited after its times were made (another word count) gets none', async () => {
    seed([row(QID, { question_text: 'Which month comes after June then?' }), row(QID2)], { meta: META(), one: true, ra: true });
    const helpers = require('../../../shared/services/quiz/web-quiz-media');
    const spy = jest.spyOn(helpers, 'presignAudio').mockResolvedValue(SIGNED());
    let out;
    try { out = await WQ.getQuiz('AB12CD'); } finally { spy.mockRestore(); }
    expect(out.quiz.questions.some((q) => q.audio && q.audio.ra)).toBe(false);
  });

  test.each([[undefined], [false], ['true'], [1], [{ enabled: true }]])('one voice on, this switch %p: no ra and no question_readalong', async (ra) => {
    const out = await page({ one: true, ra });
    expect('question_readalong' in out).toBe(false);
    out.quiz.questions.forEach((q) => expect(q.audio && 'ra' in q.audio).toBe(false));
  });

  test('golden: one voice on, the payload with this switch\'s row absent deep-equals the payload with it false', async () => {
    const none = JSON.parse(strip(await page({ one: true })));
    WQ._resetQuizCache(); OneVoice.reset(); QRA.reset();
    const off = JSON.parse(strip(await page({ one: true, ra: false })));
    expect(off).toEqual(none);
  });

  test('this switch on but one voice off: today\'s payload (no ra, no question_readalong)', async () => {
    const none = JSON.parse(strip(await page({})));
    WQ._resetQuizCache(); OneVoice.reset(); QRA.reset();
    const on = JSON.parse(strip(await page({ ra: true })));
    expect(on).toEqual(none);
    expect('question_readalong' in on).toBe(false);
  });

  test('the reader: JSON true only, fails off, 30 s cache', async () => {
    const reads = [];
    const db = (value, fail) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { reads.push(1); return fail ? { error: { message: 'x' } } : { data: value === undefined ? null : { value } }; } }) }) }) });
    expect(await QRA.on({ db: db(true), now: 1 })).toBe(true);
    expect(await QRA.on({ db: db(false), now: 2 })).toBe(true);           // cached
    QRA.reset();
    expect(await QRA.on({ db: db('true'), now: 1 })).toBe(false);
    QRA.reset();
    expect(await QRA.on({ db: db(true, true), now: 1 })).toBe(false);
    QRA.reset();
    expect(await QRA.on({ db: db(undefined), now: 1 })).toBe(false);
    expect(QRA.KEY).toBe('web_quiz_question_readalong');
  });
});
