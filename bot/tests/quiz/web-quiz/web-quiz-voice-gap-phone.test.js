'use strict';
/**
 * A quiz line with no recorded clip, while one voice is on (app_settings `web_quiz_voice_gap_phone`, default off, JSON
 * true only): the quiz answer says `voice_gap_phone: true`, so the page reads that line with the phone's own voice
 * instead of leaving it silent. The key rides the page's one settings read that carries `web_quiz_one_voice`
 * (web-quiz-identity-roster.js): on adds no read. Off (absent, false, the string "true", 1, an object): no field, the
 * answer is today's key for key.
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
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async ({ provider, voice }) => ({ audio: Buffer.from('OggS-fake'), provider, voice, durationSec: 2 })),
}));

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const Voice = require('../../../shared/services/quiz/web-quiz-voice');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');
const tts = require('../../../shared/services/tts');
const queue = require('../../../shared/services/queue/sqs-queue.service');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const QID = '99999991-9999-4999-8999-999999999999';
const QID2 = '99999992-9999-4999-8999-999999999999';
// The checked recorded explanation (web-quiz-recorded-why.json): today it is served as the why.
const CHECKED = { id: '5c432bf6-d600-4108-8c2d-0745c26b18ed', why: 'https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/quiz-audio-opus/Grade1EnglishAlphabetsRevisionGroupThreeQuestion1ExplanationAudio.ogg' };
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const rec = (name) => `https://clips.example/bank/${name}.ogg`;
const BANK = /clips\.example\/bank|r2\.dev\/quiz-audio-opus/;
const ALL_OPTS = [{ index: 0, url: rec('february') }, { index: 1, url: rec('may') }, { index: 2, url: rec('march') }, { index: 3, url: rec('june') }];

function bankRow(id, media, extra = {}) {
  return {
    id, quiz_id: QUIZ, external_id: `vb:${id}`, sort_order: id === QID2 ? 2 : 1, question_text: 'Which month comes after January?',
    option_a: 'February', option_b: 'May', option_c: 'March', option_d: 'June', correct_option: 'A',
    explanation: 'February is the second month.', option_feedback: { wrong: { 1: 'May is the fifth month.' } }, media, render_pattern: 'P6a', ...extra,
  };
}
// Question 1 recorded end to end by a person (question, every option, a checked explanation); question 2 by nobody.
const ROWS = () => [
  bankRow(CHECKED.id, { question_audio: [rec('q1')], option_audio: ALL_OPTS, explanation_audio: CHECKED.why }, { explanation: 'This is the sound of F' }),
  bankRow(QID2, {}),
];
// The quiz voice's clips for every part of both questions, as the publish step names them (the voice tag is in the key):
// TODAY = the quiz voice with the switch off; TAG = the one voice with it on (the stories' and passages' voice).
const TODAY = Voice.voiceTag('en');
const TAG = Voice.voiceTag('en', { oneVoice: true });
const gen = (qid, tag = TAG) => ({
  q: `quiz-audio/sandbox/${QUIZ}/en/${qid}/q-${tag}-00000001.ogg`,
  opts: ['a', 'b', 'c', 'd'].map((p) => `quiz-audio/sandbox/${QUIZ}/en/${qid}/${p}-${tag}-00000002.ogg`),
  why: `quiz-audio/sandbox/${QUIZ}/en/${qid}/why-${tag}-00000003.ogg`,
  fbs: [null, `quiz-audio/sandbox/${QUIZ}/en/${qid}/xb-${tag}-00000004.ogg`, null, null],
});
const JESSICA = { provider: 'elevenlabs', voice: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', model: 'eleven_v4' };
// A plan that voices every line, the recorded question and options too (only an explicit empty `bank` does that).
const ALL_AI = { bank: [] };
const GENERATED = (tag = TAG) => ({ [CHECKED.id]: gen(CHECKED.id, tag), [QID2]: gen(QID2, tag) });

function seed(rows, { flag, gap, slow, meta = {} } = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Months', language: null, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: null, meta, quiz_source: 'video' }],
    quiz_questions: rows, quiz_sessions: [], students: [], quiz_answers: [],
    app_settings: [...(flag === undefined ? [] : [{ key: 'web_quiz_one_voice', value: flag }]), ...(gap === undefined ? [] : [{ key: 'web_quiz_voice_gap_phone', value: gap }]),
      ...(slow === undefined ? [] : [{ key: 'web_quiz_voice_gap_slow', value: slow }])],
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return fake;
}

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET;
  // The page reads the switch in its own settings read (web-quiz-identity-roster.js): each test starts with neither cached.
  WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache(); tts.synthesize.mockClear(); queue.queueJob.mockClear();
});
afterAll(() => { process.env = SAVED; });

async function page(rows, generated, opts) {
  seed(rows, opts);
  const helpers = require('../../../shared/services/quiz/web-quiz-media');
  const spy = jest.spyOn(helpers, 'presignAudio').mockResolvedValue(generated);
  try { return await WQ.getQuiz('AB12CD'); } finally { spy.mockRestore(); }
}

/** Every clip URL the page would play for a question's spoken lines (not the sound to identify). */
const spokenClips = ({ audio: a = {} }) => [a.q, ...(a.opts || []), a.why, ...(a.fbs || []), a.hint].filter(Boolean);
const voiceOf = (url) => { const m = /-(sx|el|oa)-([a-z0-9]+)-[0-9a-f]{8}\.ogg$/.exec(url); return m ? `${m[1]}-${m[2]}` : `not-the-quiz-voice:${url}`; };


const GAP = 'web_quiz_voice_gap_phone';
// app_settings reads during one page answer, counted at the boundary
function counting() {
  const n = { reads: 0, keys: [] }, from = supabase.from;
  supabase.from = (t) => {
    const q = from(t);
    if (t !== 'app_settings') return q;
    n.reads += 1;
    const sel = q.select.bind(q);
    q.select = (...a) => { const s = sel(...a); const inn = s.in && s.in.bind(s); if (inn) s.in = (k, keys) => { n.keys.push(keys); return inn(k, keys); }; return s; };
    return q;
  };
  return n;
}
async function pageCounted(opts) {
  seed(ROWS(), opts);
  const n = counting();
  const helpers = require('../../../shared/services/quiz/web-quiz-media');
  const spy = jest.spyOn(helpers, 'presignAudio').mockResolvedValue(GENERATED());
  try { return { out: await WQ.getQuiz('AB12CD'), n }; } finally { spy.mockRestore(); }
}

describe('web_quiz_voice_gap_phone: a line with no clip is read by the phone, said to the page', () => {
  test('on (JSON true) with one voice on: voice_gap_phone: true, read in the same settings query as one voice; otherwise the same answer', async () => {
    const again = () => { WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache(); };
    await pageCounted({ flag: true }); again();                      // the page's other caches warm, as in a running bot
    const off = await pageCounted({ flag: true }); again();
    const on = await pageCounted({ flag: true, gap: true });
    expect(off.out).not.toHaveProperty('voice_gap_phone');
    expect(on.out.voice_gap_phone).toBe(true);
    expect(on.out.one_voice).toBe(true);
    // the key is asked for in the very query that asks for one voice, and the page reads no more than without it
    expect(on.n.keys.some((k) => k.includes('web_quiz_one_voice') && k.includes(GAP))).toBe(true);
    expect(on.n.reads).toBe(off.n.reads);
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v)));
    const a = strip(on.out); delete a.voice_gap_phone;
    expect(a).toEqual(strip(off.out));
  });
  test.each([[false], ['true'], [1], [{ on: true }], [null]])('off (%p): no voice_gap_phone field', async (gap) => {
    const { out } = await pageCounted({ flag: true, gap });
    expect([gap, 'voice_gap_phone' in out]).toEqual([gap, false]);
  });
  test('one voice off: no field, whatever the gap switch says (the phone already reads a missing line)', async () => {
    const { out } = await pageCounted({ gap: true });
    expect('one_voice' in out).toBe(false);
    expect('voice_gap_phone' in out).toBe(false);
  });
});

// web_quiz_voice_gap_slow (default off, JSON true only, only beside the gap switch): a clip that is there but will not
// play (its play() aborts, or it has not started at 8 s) is read by the phone's voice too (wq.js GAP_SLOW). It rides the
// same settings read; off, the answer is today's key for key.
describe('web_quiz_voice_gap_slow: a clip that will not play is read by the phone, said to the page', () => {
  const SLOW = 'web_quiz_voice_gap_slow';
  test('on with the gap switch on: voice_gap_slow: true, in the same query as one voice, no extra read; otherwise the same answer', async () => {
    const again = () => { WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache(); };
    await pageCounted({ flag: true, gap: true }); again();
    const off = await pageCounted({ flag: true, gap: true }); again();
    const on = await pageCounted({ flag: true, gap: true, slow: true });
    expect(off.out).not.toHaveProperty('voice_gap_slow');
    expect(on.out.voice_gap_slow).toBe(true);
    expect(on.n.keys.some((k) => k.includes('web_quiz_one_voice') && k.includes(SLOW))).toBe(true);
    expect(on.n.reads).toBe(off.n.reads);
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v)));
    const a = strip(on.out); delete a.voice_gap_slow;
    expect(a).toEqual(strip(off.out));
  });
  test.each([[false], ['true'], [1], [null]])('off (%p): no voice_gap_slow field', async (slow) => {
    const { out } = await pageCounted({ flag: true, gap: true, slow });
    expect([slow, 'voice_gap_slow' in out]).toEqual([slow, false]);
  });
  test('the gap switch off (or one voice off): no field, whatever this switch says', async () => {
    const a = await pageCounted({ flag: true, slow: true });
    expect('voice_gap_slow' in a.out).toBe(false);
    WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache();
    const b = await pageCounted({ gap: true, slow: true });
    expect('voice_gap_slow' in b.out).toBe(false);
  });
});
