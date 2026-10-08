'use strict';
/**
 * Library quizzes keep their OWN recorded voices.
 *
 * The video bank was recorded by people: a clip for the question and, for many questions, one per
 * option. The page played none of the option clips (it read media.question_audio, stimulus_audio and
 * explanation_audio only) and let a generated clip replace the recorded question. Now the recorded
 * question and option clips come first, each option's clip stays on that option's stored slot (the
 * page shuffles the options, so a position would pair a clip with another option), and the publish
 * step records only what is missing.
 *
 * Boundaries faked: supabase (in-memory), R2 + the voice gateway (publish), the loggers. The services
 * under test run for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const Render = require('../../../shared/services/quiz/video-quiz-render.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const QID = '99999991-9999-4999-8999-999999999999';
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const rec = (name) => `https://clips.example/bank/${name}.ogg`;

function bankRow(media, extra = {}) {
  return {
    id: QID, quiz_id: QUIZ, external_id: 'vb:1', sort_order: 1, question_text: 'Which month comes after January?',
    option_a: 'February', option_b: 'May', option_c: 'March', option_d: 'June', correct_option: 'A',
    explanation: 'February is the second month.', option_feedback: null, media, render_pattern: 'P6a', ...extra,
  };
}
const ALL_OPTS = [{ index: 0, url: rec('february') }, { index: 1, url: rec('may') }, { index: 2, url: rec('march') }, { index: 3, url: rec('june') }];

function seed(rows, meta = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Months', language: null, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: null, meta, quiz_source: 'video' }],
    quiz_questions: rows, quiz_sessions: [], students: [], quiz_answers: [],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; WQ._resetQuizCache(); });
afterAll(() => { process.env = SAVED; });

async function served(rows, generated) {
  seed(rows);
  const helpers = require('../../../shared/services/quiz/web-quiz-media');
  const spy = jest.spyOn(helpers, 'presignAudio').mockResolvedValue(generated || {});
  try { return (await WQ.getQuiz('AB12CD')).quiz.questions[0]; } finally { spy.mockRestore(); }
}

describe('the page gets the bank\'s recorded option clips, each on its own option', () => {
  test('every option shown carries the clip recorded for THAT option, whatever order the page shows them in', async () => {
    const row = bankRow({ question_audio: [rec('q')], option_audio: ALL_OPTS });
    const q = await served([row]);
    expect(Render.displayOrder(row, Render.optionLabels(row))).not.toEqual([0, 1, 2, 3]); // the page really shuffles this one
    q.options.forEach((o) => {
      const clip = q.audio.opts['ABCD'.indexOf(o.slot)];
      expect(clip).toBe(rec(o.text.toLowerCase()));
    });
  });

  test('recorded options replace generated ones; the recorded question wins; the generated why stays', async () => {
    const gen = { [QID]: { q: 'gen-q', opts: ['gen-a', 'gen-b', 'gen-c', 'gen-d'], why: 'gen-why', fbs: ['x', null, null, null] } };
    const q = await served([bankRow({ question_audio: [rec('q')], option_audio: ALL_OPTS, explanation_audio: rec('why') })], gen);
    expect(q.audio.q).toBe(rec('q'));
    expect(q.audio.opts).toEqual([rec('february'), rec('may'), rec('march'), rec('june')]);
    expect(q.audio.why).toBe('gen-why');
    expect(q.audio.fbs).toEqual(['x', null, null, null]);
  });

  test('a question with clips for only SOME options keeps the generated ones for all (one voice across its options)', async () => {
    const gen = { [QID]: { q: 'gen-q', opts: ['gen-a', 'gen-b', 'gen-c', 'gen-d'], why: null } };
    const q = await served([bankRow({ option_audio: ALL_OPTS.slice(0, 2) })], gen);
    expect(q.audio.opts).toEqual(['gen-a', 'gen-b', 'gen-c', 'gen-d']);
    expect(q.audio.q).toBe('gen-q');
  });

  test('no recorded question clip: the generated one plays', async () => {
    const q = await served([bankRow({ question_audio: [], option_audio: ALL_OPTS })], { [QID]: { q: 'gen-q', opts: [], why: null } });
    expect(q.audio.q).toBe('gen-q');
    expect(q.audio.opts).toEqual([rec('february'), rec('may'), rec('march'), rec('june')]);
  });
});

describe('the publish step records only what the bank does not already voice', () => {
  const parts = (row) => Publish.partsFor(row).map((p) => p.part);
  test('recorded question + every option: neither is recorded again; the why and the wrong-answer lines still are', () => {
    const row = bankRow({ question_audio: [rec('q')], option_audio: ALL_OPTS }, { option_feedback: { wrong: { 1: 'May is the fifth month.' } } });
    const p = parts(row);
    expect(p).not.toEqual(expect.arrayContaining(['q']));
    ['a', 'b', 'c', 'd'].forEach((x) => expect(p).not.toContain(x));
    expect(p).toEqual(expect.arrayContaining(['why', 'xb']));
  });
  test('clips for only some options: every option is recorded (one voice across them)', () => {
    expect(parts(bankRow({ option_audio: ALL_OPTS.slice(0, 3) }))).toEqual(expect.arrayContaining(['q', 'a', 'b', 'c', 'd']));
  });
  test('a row with no recorded voices is recorded in full, as before', () => {
    expect(parts(bankRow({}))).toEqual(['q', 'a', 'b', 'c', 'd', 'why']);
  });
});

describe('what the voice reads for the items a voice gets wrong (the page still shows the text)', () => {
  const said = (row) => Object.fromEntries(Publish.partsFor(row).map((p) => [p.part, p.text]));
  test('a blank in the stem is a pause, not "underscore" or "dash"', () => {
    const t = said(bankRow({}, { question_text: 'The rabbit was eating _.' })).q;
    expect(t).not.toMatch(/_|dash|underscore/i);
    expect(t).toMatch(/eating … \./);
  });
  test('a lone English letter is read by its name; a lone Urdu letter by its Urdu name; words are untouched', () => {
    const en = said(bankRow({}, { question_text: 'Complete the word: s _ n g e r', option_a: 'i', option_b: 'o', option_c: 'n', option_d: 'a' }));
    expect([en.a, en.b, en.c, en.d]).toEqual(['letter i', 'letter o', 'letter n', 'letter a']);
    const ur = said(bankRow({}, { question_text: 'ان میں سے بھاری حرف کون سا ہے؟', option_a: 'کھ', option_b: 'ع', option_c: 'ہ', option_d: 'بَن' }));
    expect([ur.a, ur.b, ur.c, ur.d]).toEqual(['کھ', 'عین', 'چھوٹی ہے', 'بَن']);
  });
});

/*
 * The bank's recorded EXPLANATION, as the why, for a question already recorded end to end (question + every option):
 * one human voice through the whole question. Only a clip that a transcript check proved says THIS row's explanation,
 * names no option letter (the page re-letters options) and does not announce the answer (the page has just said it)
 * is served: web-quiz-recorded-why.json holds those, each bound to its clip's URL.
 */
describe('a checked recorded explanation is the why, for a question recorded end to end', () => {
  const CHECKED = { id: '5c432bf6-d600-4108-8c2d-0745c26b18ed', url: 'https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/quiz-audio-opus/Grade1EnglishAlphabetsRevisionGroupThreeQuestion1ExplanationAudio.ogg' };
  const gen = () => ({ [CHECKED.id]: { q: 'gen-q', opts: ['gen-a', 'gen-b', 'gen-c', 'gen-d'], why: 'gen-why', fbs: [null, null, null, null] } });
  const row = (media) => bankRow(media, { id: CHECKED.id, explanation: 'This is the sound of F' });

  test('the checked clip replaces the generated why', async () => {
    const q = await served([row({ question_audio: [rec('q')], option_audio: ALL_OPTS, explanation_audio: CHECKED.url })], gen());
    expect(q.audio.q).toBe(rec('q'));
    expect(q.audio.why).toBe(CHECKED.url);
  });
  test('a different clip on the same question (not the one checked) leaves the generated why', async () => {
    const q = await served([row({ question_audio: [rec('q')], option_audio: ALL_OPTS, explanation_audio: rec('other-why') })], gen());
    expect(q.audio.why).toBe('gen-why');
  });
  test('not recorded end to end (no question clip, or some options generated): the generated why stays', async () => {
    let q = await served([row({ question_audio: [], option_audio: ALL_OPTS, explanation_audio: CHECKED.url })], gen());
    expect(q.audio.why).toBe('gen-why');
    q = await served([row({ question_audio: [rec('q')], option_audio: ALL_OPTS.slice(0, 2), explanation_audio: CHECKED.url })], gen());
    expect(q.audio.why).toBe('gen-why');
  });
  test('an unchecked question keeps the generated why even when recorded end to end', async () => {
    const q = await served([bankRow({ question_audio: [rec('q')], option_audio: ALL_OPTS, explanation_audio: CHECKED.url })], { [QID]: { q: 'gen-q', opts: [], why: 'gen-why' } });
    expect(q.audio.why).toBe('gen-why');
  });
});

/*
 * An UNCHECKED recorded explanation is never the why. It used to be served wherever no generated why existed yet
 * (the first opens of a library quiz): of 818 such rows on the bank, 13 clips name a stored option LETTER the page
 * has shuffled ("D is the correct option…"), 36 announce the answer and 65 read option words or other words. Until
 * the generated why is recorded the page reads the written why with the phone's voice, as for any part with no clip.
 */
describe('an unchecked recorded explanation is never served as the why', () => {
  test('a "D is the correct option" clip on a question with no generated why yet: no why clip', async () => {
    const q = await served([bankRow({ question_audio: [rec('q')], explanation_audio: rec('d-is-the-correct-option') })], { [QID]: { q: null, opts: [], why: null } });
    expect(q.audio.q).toBe(rec('q'));
    expect(q.audio.why == null).toBe(true);
  });
  test('the checked clip is still served even before a generated why exists', async () => {
    const id = '5c432bf6-d600-4108-8c2d-0745c26b18ed';
    const url = 'https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/quiz-audio-opus/Grade1EnglishAlphabetsRevisionGroupThreeQuestion1ExplanationAudio.ogg';
    const q = await served([bankRow({ question_audio: [rec('q')], option_audio: ALL_OPTS, explanation_audio: url }, { id })], {});
    expect(q.audio.why).toBe(url);
  });
});
