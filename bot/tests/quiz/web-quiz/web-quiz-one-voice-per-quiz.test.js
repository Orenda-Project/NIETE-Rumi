'use strict';
/**
 * One voice per quiz (app_settings `web_quiz_one_voice`, default off).
 *
 * A library (video-bank) quiz spoke in two voices: the bank's recorded people for the question (and, for
 * some questions, the options), and the quiz voice (web-quiz-voice.js) for the why, the wrong-answer lines,
 * the hint, every part the bank did not record and the shared feedback lines. The voice changed inside one
 * question and again between questions. With the switch on (`true`), the bank's recorded question and options
 * stay, and every line the quiz makes is ONE voice per language, matched to them. A plan that says `bank: []`
 * also voices the recorded question and options again (ALL_AI below): they are then neither served nor skipped
 * at publish. Either way a quiz recorded before is recorded again, and the page never speaks with the phone's
 * own voice. A listen item's SOUND to identify (`stim`, the question's material) is always the recording.
 *
 * Off, everything is today's: the payload, the clips served and the parts recorded.
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

function seed(rows, { flag, meta = {} } = {}) {
  const fake = makeFake({
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
      topic: 'Months', language: null, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null,
      uses_count: 0, created_at: new Date().toISOString() }],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: null, meta, quiz_source: 'video' }],
    quiz_questions: rows, quiz_sessions: [], students: [], quiz_answers: [],
    app_settings: flag === undefined ? [] : [{ key: 'web_quiz_one_voice', value: flag }],
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

describe('switch on with `bank: []`: every spoken line of a library quiz carries ONE provider + voice', () => {
  test('the bank\'s recorded question, options and checked why are not served; every clip is the quiz voice', async () => {
    const out = await page(ROWS(), GENERATED(), { flag: ALL_AI });
    const clips = out.quiz.questions.flatMap(spokenClips);
    expect(clips.length).toBeGreaterThanOrEqual(14);
    expect(clips.filter((u) => BANK.test(u))).toEqual([]);
    expect([...new Set(clips.map(voiceOf))]).toEqual([TAG]);
    // and that voice is the picked one (ElevenLabs), the one the shared lines are recorded in for this switch
    expect(TAG).not.toBe(TODAY);
    expect(Voice.quizVoice('en', { oneVoice: true })).toMatchObject({ provider: 'elevenlabs', voice: 'hpp4J3VqNfWAUOO0d1Us', model: 'eleven_v4' });
    expect(Voice.quizVoice('ur', { oneVoice: true })).toMatchObject({ provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', model: 'eleven_v4' });
    for (const lang of ['en', 'ur']) {
      const tag = Voice.voiceTag(lang, { oneVoice: true });
      const manifest = require(`../../../../dashboard/public/wq/voice/one/${tag}/manifest.json`);
      expect(Voice.tagOf(manifest.voice)).toBe(tag);
    }
  });

  test('the page is told (one_voice), so it never reads a missing line with the phone\'s voice', async () => {
    const out = await page(ROWS(), GENERATED(), { flag: true });
    expect(out.one_voice).toBe(true);
    // and plays Jugnu's shared lines from the set recorded in that voice, for both languages
    expect(out.voice_sets).toEqual({ en: { path: TAG, v: Voice.SHARED_SETS[TAG] }, ur: { path: 'el-sara', v: Voice.SHARED_SETS['el-sara'] } });
  });

  test('a listen item still plays its SOUND to identify (the question\'s material), and nothing else of the recording', async () => {
    const row = bankRow(QID, { question_audio: [rec('q')], option_audio: ALL_OPTS, stimulus_audio: rec('sound-f') }, { question_text: 'Listen and tap the word that sounds like:' });
    const out = await page([row], { [QID]: gen(QID) }, { flag: ALL_AI });
    const q = out.quiz.questions[0];
    expect(q.audio.stim).toBe(rec('sound-f'));
    expect(spokenClips(q).filter((u) => BANK.test(u))).toEqual([]);
  });

  test('a quiz not yet recorded in the quiz voice: nothing of the recording is served meanwhile (the words are shown)', async () => {
    const out = await page(ROWS(), {}, { flag: ALL_AI });
    expect(out.quiz.questions.flatMap(spokenClips)).toEqual([]);
  });
});

describe('switch off (absent, false, or not a real true): today\'s page, unchanged', () => {
  test.each([[undefined], [false], ['yes'], [1]])('flag %p: the recorded clips win as before and the payload carries no one_voice', async (flag) => {
    const out = await page(ROWS(), GENERATED(TODAY), { flag });
    const q1 = out.quiz.questions.find((q) => q.audio && q.audio.q === rec('q1'));
    expect(q1).toBeTruthy();
    expect(q1.audio.opts).toEqual([rec('february'), rec('may'), rec('march'), rec('june')]);
    expect(q1.audio.why).toBe(CHECKED.why);
    expect('one_voice' in out).toBe(false);
  });

  test.each([[{ enabled: true }], [{}], [{ foo: 1 }]])('flag %p names no plan: off, the payload byte-identical to no switch row', async (flag) => {
    const strip = (o) => JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v));
    const none = strip(await page(ROWS(), GENERATED(TODAY), {}));
    WQ._resetQuizCache(); OneVoice.reset();
    const out = await page(ROWS(), GENERATED(TODAY), { flag });
    expect('one_voice' in out).toBe(false);
    expect(out.quiz.questions.find((q) => q.audio && q.audio.q === rec('q1'))).toBeTruthy();   // the recording is served
    expect(strip(out)).toBe(none);
  });

  test('golden: the whole payload with the switch off is byte-identical to the payload with no switch row', async () => {
    const strip = (o) => JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v));
    const none = strip(await page(ROWS(), GENERATED(TODAY), {}));
    WQ._resetQuizCache(); OneVoice.reset();
    const off = strip(await page(ROWS(), GENERATED(TODAY), { flag: false }));
    expect(off).toBe(none);
    const golden = path.join(__dirname, '__golden__', 'one-voice-off.json');
    expect(JSON.parse(none)).toEqual(JSON.parse(fs.readFileSync(golden, 'utf8')));
  });
});

describe('the publish step', () => {
  const parts = (row, o) => Publish.partsFor(row, o).map((p) => p.part);

  test('one voice: a part the bank recorded is recorded in the quiz voice too', () => {
    const row = ROWS()[0];
    expect(parts(row)).not.toContain('q');                       // off: today's
    expect(parts(row, { oneVoice: OneVoice.normalize(ALL_AI) })).toEqual(expect.arrayContaining(['q', 'a', 'b', 'c', 'd', 'why', 'xb']));
    expect(parts(row, { oneVoice: true })).toEqual(expect.not.arrayContaining(['q', 'a', 'b', 'c', 'd']));   // true keeps them
  });

  test('one voice: every clip is made by the quiz voice, every key carries it, and the quiz is stamped with it', async () => {
    const fake = seed(ROWS(), { flag: ALL_AI, meta: { web: { audio_v: Publish.AUDIO_VERSION, audio_voice: TODAY } } });
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(out.ok).toBe(true);
    const calls = tts.synthesize.mock.calls.map(([a]) => `${a.provider}:${a.voice}:${a.model}`);
    expect([...new Set(calls)]).toEqual(['elevenlabs:hpp4J3VqNfWAUOO0d1Us:eleven_v4']);
    expect(tts.synthesize.mock.calls[0][0].voiceSettings).toEqual({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true });
    // the provider's own bytes are stored (no 24 kb/s re-encode: the loss the stories' voice already dropped)
    const r2 = require('../../../shared/storage/r2');
    r2.uploadBuffer.mock.calls.forEach((c) => expect(c[0].toString()).toBe('OggS-fake'));
    const { web: today, web_one: web } = fake.db.quizzes[0].meta;
    expect(today).toEqual({ audio_v: Publish.AUDIO_VERSION, audio_voice: TODAY });   // the switched-off map is never touched
    const keys = Object.values(web.audio).flatMap((e) => [e.q, ...e.opts, e.why, ...e.fbs, e.hint]).filter(Boolean);
    expect(keys.length).toBeGreaterThanOrEqual(14);
    expect([...new Set(keys.map(voiceOf))]).toEqual([TAG]);
    expect(web.audio[CHECKED.id].q).toMatch(new RegExp(`/q-${TAG}-[0-9a-f]{8}\\.ogg$`));
    expect(web.audio_one).toBe(OneVoice.normalize(ALL_AI).sig);
    expect(Publish.isCurrent(Publish.webOf(fake.db.quizzes[0].meta, { oneVoice: true }), { oneVoice: OneVoice.normalize(ALL_AI) })).toBe(true);
  });

  test('off: the bank\'s recorded parts are skipped and no stamp is written (today)', async () => {
    const fake = seed(ROWS(), { flag: false });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const { web, web_one: one } = fake.db.quizzes[0].meta;
    expect(one).toBeUndefined();
    expect(web.audio[CHECKED.id].q).toBe(null);
    expect('audio_one' in web).toBe(false);
  });
});

describe('a quiz recorded before the switch is recorded again (once)', () => {
  const recorded = { audio_v: Publish.AUDIO_VERSION, audio_voice: TODAY };
  test('isCurrent: off as today; on, current only when stamped with a voice of today\'s quiz-voice table', () => {
    expect(Publish.isCurrent(recorded)).toBe(true);
    expect(Publish.isCurrent(recorded, { oneVoice: true })).toBe(false);
    const sig = OneVoice.normalize(true).sig;
    expect(Publish.isCurrent({ ...recorded, audio_one: sig }, { oneVoice: true })).toBe(true);
    expect(Publish.isCurrent({ ...recorded, audio_one: OneVoice.normalize({ voices: { en: JESSICA } }).sig }, { oneVoice: true })).toBe(false);   // another plan
    expect(Publish.isCurrent({ ...recorded, audio_one: sig }, { oneVoice: OneVoice.normalize({ bank: ['q'] }) })).toBe(false);
  });

  test('the page open asks for it in one voice', async () => {
    const spy = jest.spyOn(Publish, 'requestQuizAudio').mockResolvedValue({ queued: true });
    try {
      const out = await page(ROWS(), GENERATED(), { flag: true, meta: { web: recorded } });
      expect(spy).toHaveBeenCalledWith(QUIZ, expect.objectContaining({ oneVoice: expect.objectContaining({ sig: OneVoice.normalize(true).sig }) }));
      expect(out.quiz.audio_pending).toBe(true);
    } finally { spy.mockRestore(); }
  });

  test('asked just before the switch went on, it is asked again, under its own job id (the queue would drop a repeat)', async () => {
    const q = { queueJob: jest.fn(async () => ({})) };
    await Publish.requestQuizAudio('quiz-one-1', { meta: {}, queue: q });
    await Publish.requestQuizAudio('quiz-one-1', { meta: { web: recorded }, queue: q, oneVoice: true });
    await Publish.requestQuizAudio('quiz-one-1', { meta: { web: recorded }, queue: q, oneVoice: true });
    expect(q.queueJob.mock.calls.map((c) => c[3].deduplicationId)).toEqual([
      `quiz-one-1-quiz_web_audio-v${Publish.AUDIO_VERSION}`, `quiz-one-1-quiz_web_audio-v${Publish.AUDIO_VERSION}-one-${OneVoice.normalize(true).sig}`,
    ]);
  });

  test('the worker\'s job reads the switch and records it again', async () => {
    const fake = seed(ROWS(), { flag: true, meta: { web: recorded } });
    const publish = jest.fn(async () => ({ ok: true, failed: 0 }));
    await Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1].oneVoice.sig).toBe(OneVoice.normalize(true).sig);
  });
});

describe('the page never speaks a quiz line with the phone\'s voice when the quiz has one voice', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'dashboard', 'public', 'wq', 'wq.js'), 'utf8');
  const START = SRC.indexOf('  var player = null;');
  const END = SRC.indexOf('  /* ---------------- tiny DOM helpers');
  function harness(oneVoice) {
    const spoken = []; const classes = []; const timers = [];
    const ctx = {
      LANG: 'en', VLANG: 'en', SOUND: true, ONE_VOICE: oneVoice,
      ROOT: { classList: { add: (c) => classes.push(c), remove() {} } },
      speakable: (t) => /[A-Za-z0-9؀-ۿ]/.test(String(t || '')),
      ev: () => {}, document: { createElement: () => ({ canPlayType: () => 'probably' }) },
      Audio: function Audio() {},
      SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) { this.text = text; },
      speechSynthesis: { speak: (u) => spoken.push(u.text), cancel: () => {}, getVoices: () => [] },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(`${SRC.slice(START, END)}\nthis.speak = speak;`, ctx);
    return { ctx, spoken, classes, timers };
  }
  test('a line with no clip: the words are shown big and the line ends; the phone stays silent', () => {
    const h = harness(true);
    let done = 0;
    h.ctx.speak('Which month comes after January?', null, () => { done += 1; }, { qid: QID, part: 'q' });
    expect(h.spoken).toEqual([]);
    expect(h.classes).toContain('wq-novoice');
    h.timers.forEach((t) => t.fn());
    expect(done).toBe(1);
  });
  test('off: the phone reads it, as today', () => {
    const h = harness(false);
    h.ctx.speak('Which month comes after January?', null, null, { qid: QID, part: 'q' });
    expect(h.spoken).toEqual(['Which month comes after January?']);
  });
});

describe('Jugnu\'s challenge lines (the passages, the listening story, the door labels) are the one voice too', () => {
  const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
  test('switch read on: the clip\'s key names the one voice and the clip is recorded in it; off: today\'s key and voice', async () => {
    seed([], { flag: true });
    await OneVoice.on();
    const key = Ch.clipKey('listen', 'story', 'ur', 'ایک دن بارش ہوئی۔');
    expect(key).toContain(`-${Voice.voiceTag('ur', { oneVoice: true })}-`);
    expect(await Ch.warmClip(key, 'ایک دن بارش ہوئی۔', 'ur')).toBe('recorded');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'elevenlabs', voice: '9cI5mhBtM4WtQ9Fo6jWQ', model: 'eleven_v4' });

    OneVoice.reset(); seed([], { flag: false }); await OneVoice.on(); tts.synthesize.mockClear();
    const today = Ch.clipKey('listen', 'story', 'ur', 'ایک دن بارش ہوئی۔');
    expect(today).toContain(`-${Voice.voiceTag('ur')}-`);
    await Ch.warmClip(today, 'ایک دن بارش ہوئی۔', 'ur');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'soniox', voice: 'Ishita' });
    expect(tts.synthesize.mock.calls[0][0].model).toBeUndefined();
    expect(tts.synthesize.mock.calls[0][0].outputFormat).toBeUndefined();
  });

  test('a plan at 32 kb/s: a missing challenge clip is asked of the voice at that rate', async () => {
    seed([], { flag: { kbps: 32 } });
    await OneVoice.on();
    const key = Ch.clipKey('listen', 'story', 'en', 'One day it rained.');
    await Ch.warmClip(key, 'One day it rained.', 'en');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ voice: Voice.ONE_VOICE.en.voice, outputFormat: 'opus_48000_32' });
  });

  test('the rate is in the key when it is not 64: a clip at another rate is another clip (never served as this one)', async () => {
    seed([], { flag: { kbps: 32 } });
    await OneVoice.on();
    const k32 = Ch.clipKey('listen', 'story', 'en', 'The rain came down.');
    expect(k32).toMatch(/\/story-el-bella-k32-[0-9a-f]{8}\.ogg$/);
    await Ch.warmClip(k32, 'The rain came down.', 'en');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'elevenlabs', voice: Voice.ONE_VOICE.en.voice, outputFormat: 'opus_48000_32' });

    // 64 (the default): no rate in the key, the same key as the plain `true` plan
    OneVoice.reset(); seed([], { flag: { kbps: 64 } }); await OneVoice.on();
    const k64 = Ch.clipKey('listen', 'story', 'en', 'The rain came down.');
    OneVoice.reset(); seed([], { flag: true }); await OneVoice.on();
    expect(Ch.clipKey('listen', 'story', 'en', 'The rain came down.')).toBe(k64);
    expect(k64).toMatch(/\/story-el-bella-[0-9a-f]{8}\.ogg$/);
    expect(k64).not.toBe(k32);
  });

  test('a clip is recorded at the rate its key names, even when the plan\'s rate changed after the key was made', async () => {
    seed([], { flag: { kbps: 32 } });
    await OneVoice.on();
    const k32 = Ch.clipKey('listen', 'story', 'en', 'The wind came up.');
    expect(k32).toMatch(/-k32-[0-9a-f]{8}\.ogg$/);
    // the plan now reads 64; the 32 kb/s key is still recorded at 32, never at the plan's new rate
    OneVoice.reset(); seed([], { flag: { kbps: 64 } }); await OneVoice.on();
    expect(OneVoice.currentPlan().kbps).toBe(64);
    await Ch.warmClip(k32, 'The wind came up.', 'en');
    expect(tts.synthesize).toHaveBeenCalledTimes(1);
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ provider: 'elevenlabs', voice: Voice.ONE_VOICE.en.voice, outputFormat: 'opus_48000_32' });
  });
});

/*
 * The voice choice is DATA: the switch's value names the voice per language and the parts kept from the bank's
 * recordings of people (the operator may keep the human question and options and choose the voice beside them).
 */
describe('the switch value is the voice plan', () => {
  const PLAN = { voices: { en: JESSICA }, bank: ['q', 'opts'] };
  test('normalize: true is the default plan; an object names voices and bank parts; anything else is off', () => {
    expect(OneVoice.normalize(true)).toMatchObject({ voices: { en: Voice.ONE_VOICE.en, ur: Voice.ONE_VOICE.ur }, bank: ['q', 'opts'] });
    // A string row is OFF, as under every switch reader of the app (the JSON string "true" too); the CLI parses first.
    expect(OneVoice.normalize('true')).toBe(null);
    expect(OneVoice.normalize(JSON.stringify(PLAN))).toBe(null);
    // a language the plan's voices leave out keeps today's voice (null)
    expect(OneVoice.normalize(JSON.parse(JSON.stringify(PLAN)))).toMatchObject({ voices: { en: { voice: JESSICA.voice, model: 'eleven_v4' }, ur: null }, bank: ['q', 'opts'] });
    expect(OneVoice.normalize({ voices: { en: { provider: 'nope', voice: 'x' } }, bank: ['q', 'stim', 'x'] })).toMatchObject({ voices: { en: Voice.ONE_VOICE.en }, bank: ['q'] });
    [false, null, 'yes', 1, [], { enabled: false }].forEach((v) => expect(OneVoice.normalize(v)).toBe(null));
    // An object is a plan only when it names a valid voices, bank or kbps: a stray or malformed row is off.
    [{ enabled: true }, {}, { foo: 1 }, { voices: 'x' }, { voices: [] }, { voices: {} }, { voices: { en: { provider: 'nope', voice: 'x' } } }, { bank: 'q' }, { kbps: 17 }, { kbps: '128' }]
      .forEach((v) => expect(OneVoice.normalize(v)).toBe(null));
    expect(OneVoice.normalize({ enabled: true, bank: [] })).toMatchObject({ bank: [], kbps: 64 });
  });

  test('served: the kept bank parts are the people\'s recordings, every other line is the plan voice and its shared set', async () => {
    const V2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.9 } };
    const out = await page(ROWS(), GENERATED('el-bella-cff2e4'), { flag: { voices: { en: V2 }, bank: ['q', 'opts'] } });
    const q1 = out.quiz.questions.find((q) => q.audio && q.audio.q === rec('q1'));
    expect(q1.audio.opts).toEqual([rec('february'), rec('may'), rec('march'), rec('june')]);
    expect(q1.audio.why).toMatch(/why-el-bella-cff2e4-/);                  // the why is not kept: plan voice
    expect(q1.audio.fbs[1]).toMatch(/xb-el-bella-cff2e4-/);
    const q2 = out.quiz.questions.find((q) => q !== q1);
    expect(q2.audio.q).toMatch(/q-el-bella-cff2e4-/);
    // Urdu is left out of this plan: today's lines, so no Urdu set
    expect(out.voice_sets).toEqual({ en: { path: 'el-bella-cff2e4', v: Voice.SHARED_SETS['el-bella-cff2e4'] } });
  });

  test('published: the kept parts are not recorded, the rest in the plan voice, stamped with the plan', async () => {
    // given the plan directly, as the backfill's --plan is (the switch refuses a voice with no shared-line set yet)
    const fake = seed(ROWS(), {});
    const plan = OneVoice.normalize(PLAN);
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: plan });
    expect([...new Set(tts.synthesize.mock.calls.map(([a]) => a.voice))]).toEqual([JESSICA.voice]);
    const web = fake.db.quizzes[0].meta.web_one;
    expect(web.audio[CHECKED.id].q).toBe(null);
    expect(web.audio[CHECKED.id].opts).toEqual([null, null, null, null]);
    expect(web.audio[CHECKED.id].why).toMatch(/why-el-jessica-/);
    expect(web.audio[QID2].q).toMatch(/q-el-jessica-/);
    expect(web.audio_one).toBe(plan.sig);
    expect(Publish.isCurrent(web, { oneVoice: plan })).toBe(true);
  });
});

describe('the voice-mix alarm: web_quiz.voice_mix when a served page carries more than one voice', () => {
  const { logEvent } = require('../../../shared/utils/structured-logger');
  const mixLines = () => logEvent.mock.calls.filter(([name]) => name === 'web_quiz.voice_mix').map(([, f]) => f);
  const PLAN = { voices: { en: JESSICA }, bank: ['q', 'opts'] };
  beforeEach(() => { logEvent.mockClear(); process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(32); });

  test('a page whose clips are in two voices logs once: the quiz key (never its id), the tags, the kept bank parts', async () => {
    const mixed = { [CHECKED.id]: gen(CHECKED.id, TAG), [QID2]: gen(QID2, 'el-jessica') };
    await page(ROWS(), mixed, { flag: true });
    const lines = mixLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ qk: expect.any(String), tags: ['el-bella', 'el-jessica'], bank: ['q', 'opts'] });
    expect(JSON.stringify(lines[0])).not.toContain(QUIZ);
  });

  test('the plan\'s own mix (the people\'s recordings it keeps + its voice) logs nothing', async () => {
    const V2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.9 } };
    const out = await page(ROWS(), GENERATED('el-bella-cff2e4'), { flag: { voices: { en: V2 }, bank: ['q', 'opts'] } });
    expect(out.one_voice).toBe(true);
    expect(mixLines()).toEqual([]);
  });

  test('one voice everywhere (clips + shared lines) logs nothing', async () => {
    await page(ROWS(), GENERATED(), { flag: true });
    expect(mixLines()).toEqual([]);
  });

  test('switch off: nothing, whatever the clips', async () => {
    await page(ROWS(), { [CHECKED.id]: gen(CHECKED.id, TODAY), [QID2]: gen(QID2, 'el-jessica') }, { flag: false });
    expect(mixLines()).toEqual([]);
  });
});

describe('the plan names the clip\'s rate and the voice\'s delivery; a change of either records the quiz again', () => {
  test('normalize: kbps 32 or 64 (default 64); each rate and each delivery is its own stamp', () => {
    const p64 = OneVoice.normalize(true);
    const p32 = OneVoice.normalize({ kbps: 32 });
    const slow = OneVoice.normalize({ voices: { en: { ...Voice.ONE_VOICE.en, settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.88 } } } });
    expect(p64.kbps).toBe(64);
    expect(p32.kbps).toBe(32);
    expect(OneVoice.normalize({ bank: [], kbps: 17 }).kbps).toBe(64);
    expect(new Set([p64.sig, p32.sig, slow.sig]).size).toBe(3);
  });

  test('published at 32 kb/s: the provider is asked for it, the bytes are kept, and the keys are not the 64 kb/s clips\' keys', async () => {
    const fake = seed(ROWS(), { flag: { kbps: 32 } });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect([...new Set(tts.synthesize.mock.calls.map(([a]) => a.outputFormat))]).toEqual(['opus_48000_32']);
    const k32 = fake.db.quizzes[0].meta.web_one.audio[QID2].q;
    tts.synthesize.mockClear(); OneVoice.reset();
    const fake64 = seed(ROWS(), { flag: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake64.from } });
    expect([...new Set(tts.synthesize.mock.calls.map(([a]) => a.outputFormat))]).toEqual(['opus_48000_64']);
    expect(fake64.db.quizzes[0].meta.web_one.audio[QID2].q).not.toBe(k32);
  });

  test('a slower delivery (the voice\'s own speed) is sent to the voice and gets its own keys', async () => {
    const slowEn = { ...Voice.ONE_VOICE.en, settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.88 } };
    const fake = seed(ROWS(), {});
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: OneVoice.normalize({ voices: { en: slowEn } }) });
    expect(tts.synthesize.mock.calls[0][0].voiceSettings).toMatchObject({ speed: 0.88 });
    const kSlow = fake.db.quizzes[0].meta.web_one.audio[QID2].q;
    tts.synthesize.mockClear(); OneVoice.reset();
    const fake2 = seed(ROWS(), { flag: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake2.from } });
    expect(fake2.db.quizzes[0].meta.web_one.audio[QID2].q).not.toBe(kSlow);
  });
});

describe('Jugnu\'s shared lines are the set of the plan voice\'s exact rendering (same voice id on another model is another set)', () => {
  test('the default rendering keeps its folder name; another model or settings names its own set, and the switch stays off until it exists', async () => {
    expect(Voice.setIdOf(Voice.ONE_VOICE.en)).toBe('el-bella');
    const v2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.95 } };
    expect(Voice.setIdOf(v2)).toMatch(/^el-bella-[0-9a-f]{6}$/);
    expect(Voice.voiceTag('en', { oneVoice: OneVoice.normalize({ voices: { en: v2 } }) })).toBe('el-bella');
    const out = await page(ROWS(), GENERATED(), { flag: { voices: { en: v2 } } });
    expect('one_voice' in out).toBe(false);                  // the v4 Bella set is NOT played beside v2 Bella's lines: refused
    expect(Voice.sharedSets(OneVoice.normalize({ voices: { en: v2 } })).en).toBeUndefined();
  });

  test('a rendering with its own set (Bella, v2, speed 0.9) plays that set, and the alarm reads it as the same voice', async () => {
    const { logEvent } = require('../../../shared/utils/structured-logger');
    logEvent.mockClear(); process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(32);
    const v2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.9 } };
    const out = await page(ROWS(), GENERATED('el-bella-cff2e4'), { flag: { voices: { en: v2 } } });
    expect(out.voice_sets.en).toEqual({ path: 'el-bella-cff2e4', v: Voice.SHARED_SETS['el-bella-cff2e4'] });
    expect(logEvent.mock.calls.filter(([n]) => n === 'web_quiz.voice_mix')).toEqual([]);
  });
});

describe('one voice is one RENDER: the voice tag, its model and its settings', () => {
  const v2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.9 } };
  test('published under another rendering of the same voice: every key names that rendering, the default plan\'s keys are unchanged', async () => {
    const fake = seed(ROWS(), { flag: { voices: { en: v2 } } });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const web = fake.db.quizzes[0].meta.web_one;
    expect(web.audio[QID2].q).toMatch(/\/q-el-bella-cff2e4-[0-9a-f]{8}\.ogg$/);
    expect(web.audio_voice).toBe('el-bella-cff2e4');
    expect(Voice.setIdOf(Voice.ONE_VOICE.en)).toBe('el-bella');
  });

  test('the alarm: the same tag in another model fires; the plan\'s own rendering does not', async () => {
    const { logEvent } = require('../../../shared/utils/structured-logger');
    process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(32);
    logEvent.mockClear();
    await page(ROWS(), GENERATED('el-bella'), { flag: { voices: { en: v2 } } });   // v4 Bella clips beside the v2 Bella set
    const lines = logEvent.mock.calls.filter(([n]) => n === 'web_quiz.voice_mix').map(([, f]) => f);
    expect(lines).toHaveLength(1);
    expect(lines[0].tags).toEqual(['el-bella', 'el-bella-cff2e4']);
  });

  test('a challenge clip under that plan: its key names the rendering and it is recorded in it', async () => {
    const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
    seed([], { flag: { voices: { en: v2 } } });
    await OneVoice.on();
    const key = Ch.clipKey('listen', 'story', 'en', 'One day it rained.');
    expect(key).toContain('-el-bella-cff2e4-');
    await Ch.warmClip(key, 'One day it rained.', 'en');
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ voice: v2.voice, model: 'eleven_multilingual_v2', voiceSettings: { speed: 0.9 } });
  });
});

/*
 * The human recordings stay: the switch's plain value (`true`, or a plan that names no `bank`) keeps the bank's own
 * recordings of people for the question and the options (and a listen item's sound); only the lines the quiz makes
 * (the why, the wrong-answer lines, the hint, a part nobody recorded, Jugnu's shared lines) are the one voice.
 */
describe('the plain switch value keeps the human question and option recordings', () => {
  const V2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.9 } };
  test('normalize: true and a plan without `bank` keep q + opts; only an explicit `bank: []` replaces them', () => {
    expect(OneVoice.normalize(true).bank).toEqual(['q', 'opts']);
    expect(OneVoice.normalize({ voices: { en: V2 } }).bank).toEqual(['q', 'opts']);
    expect(OneVoice.normalize({ kbps: 32 }).bank).toEqual(['q', 'opts']);
    expect(OneVoice.normalize({ bank: [] }).bank).toEqual([]);
  });

  test('served with true: the person\'s question and options play; the why and wrong-answer lines are the one voice', async () => {
    const out = await page(ROWS(), GENERATED(), { flag: true });
    const q1 = out.quiz.questions.find((q) => q.audio && q.audio.q === rec('q1'));
    expect(q1).toBeTruthy();
    expect(q1.audio.opts).toEqual([rec('february'), rec('may'), rec('march'), rec('june')]);
    expect(q1.audio.why).toMatch(new RegExp(`/why-${TAG}-`));
    expect(q1.audio.fbs[1]).toMatch(new RegExp(`/xb-${TAG}-`));
    const q2 = out.quiz.questions.find((q) => q !== q1);
    expect([...new Set(spokenClips(q2).map(voiceOf))]).toEqual([TAG]);
  });

  test('published with true: the recorded question and options are not voiced again; the rest is', async () => {
    const fake = seed(ROWS(), { flag: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const web = fake.db.quizzes[0].meta.web_one;
    expect(web.audio[CHECKED.id].q).toBe(null);
    expect(web.audio[CHECKED.id].opts).toEqual([null, null, null, null]);
    expect(web.audio[CHECKED.id].why).toMatch(new RegExp(`/why-${TAG}-`));
    expect(web.audio[QID2].q).toMatch(new RegExp(`/q-${TAG}-`));
  });
});

describe('a plan whose voice has no recorded set of Jugnu\'s shared lines is refused: the switch reads off, and it is logged', () => {
  const { logToFile } = require('../../../shared/utils/logger');
  const refusals = () => logToFile.mock.calls.filter(([m]) => /no recorded set of Jugnu/.test(String(m)));
  beforeEach(() => logToFile.mockClear());
  const V2 = { ...Voice.ONE_VOICE.en, model: 'eleven_multilingual_v2', settings: { ...Voice.ONE_VOICE.en.settings, speed: 0.9 } };

  test.each([
    ['an English voice with no set', { voices: { en: JESSICA } }],
    ['an Urdu voice with no set', { voices: { ur: { ...JESSICA, name: 'Jessica' } } }],
    ['a known voice in a rendering with no set', { voices: { en: { ...V2, settings: { ...V2.settings, speed: 0.95 } } } }],
  ])('%s: the page is today\'s, byte for byte, and the refusal is logged', async (_, flag) => {
    const strip = (o) => JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v));
    const none = strip(await page(ROWS(), GENERATED(TODAY), {}));
    WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache();
    const out = await page(ROWS(), GENERATED(TODAY), { flag });
    expect('one_voice' in out).toBe(false);
    expect(strip(out)).toBe(none);
    expect(refusals().length).toBeGreaterThanOrEqual(1);
  });

  test('the worker\'s reading is off too (plan(), take()), so no quiz is recorded under it', async () => {
    seed([], { flag: { voices: { en: JESSICA } } });
    expect(await OneVoice.plan()).toBe(null);
    OneVoice.reset();
    expect(OneVoice.take({ voices: { en: JESSICA } })).toBe(null);
    expect(refusals().length).toBeGreaterThanOrEqual(1);
  });

  test('a plan whose voices each have a set is on (any voice id, model and settings that set was recorded in)', async () => {
    const out = await page(ROWS(), GENERATED('el-bella-cff2e4'), { flag: { voices: { en: V2 } } });
    expect(out.one_voice).toBe(true);
    expect(out.voice_sets.en).toEqual({ path: 'el-bella-cff2e4', v: Voice.SHARED_SETS['el-bella-cff2e4'] });
    expect(refusals()).toEqual([]);
  });

  // The Urdu voice matched to the bank's recordings of people (option A): Reva, eleven_v4.
  const MATCHED_SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
  const REVA = { provider: 'elevenlabs', voice: 'o85TqPN3F4P7dWae2paA', name: 'Reva', model: 'eleven_v4', settings: MATCHED_SETTINGS };
  test('the matched Urdu voice (Reva) has its set: a plan naming it, keeping the human question and options, is on', () => {
    const plan = { voices: { ur: REVA }, bank: ['q', 'opts'] };
    expect(Voice.setIdOf(REVA)).toBe('el-reva-cc0c3b');
    expect(OneVoice.take(plan)).toMatchObject({ bank: ['q', 'opts'] });
    expect(Voice.sharedSets(OneVoice.normalize(plan)).ur).toEqual({ path: 'el-reva-cc0c3b', v: Voice.SHARED_SETS['el-reva-cc0c3b'] });
    expect(refusals()).toEqual([]);
  });

  // The English voice matched to the bank's recordings of people (option A): Shanaya, eleven_v4, the steadier stability.
  const SHANAYA = { provider: 'elevenlabs', voice: 'ZeK6O9RfGNGj0cJT2HoJ', name: 'Shanaya', model: 'eleven_v4',
    settings: { ...MATCHED_SETTINGS, stability: 0.75 } };
  test('the matched English voice (Shanaya) has its set: a plan naming it with Reva, keeping the human question and options, is on', () => {
    const plan = { voices: { en: SHANAYA, ur: REVA }, bank: ['q', 'opts'], loudness_lufs: -21 };
    expect(Voice.setIdOf(SHANAYA)).toBe('el-shanaya-e228e6');
    expect(OneVoice.take(plan)).toMatchObject({ bank: ['q', 'opts'], loudness_lufs: -21 });
    const sets = Voice.sharedSets(OneVoice.normalize(plan));
    expect(sets.en).toEqual({ path: 'el-shanaya-e228e6', v: Voice.SHARED_SETS['el-shanaya-e228e6'] });
    expect(sets.ur).toEqual({ path: 'el-reva-cc0c3b', v: Voice.SHARED_SETS['el-reva-cc0c3b'] });
    expect(refusals()).toEqual([]);
  });

  test('a quiz can be mapped to the English set by its name alone', () => {
    const p = OneVoice.take({ voices: { ur: REVA }, quiz_voices: { [QUIZ]: 'el-shanaya-e228e6' } });
    expect(OneVoice.forQuiz(p, QUIZ, 'en').voices.en).toMatchObject({ voice: SHANAYA.voice, model: 'eleven_v4', settings: SHANAYA.settings });
    expect(refusals()).toEqual([]);
  });

  // A second English voice for the quizzes whose recordings are nearer it: Anjura, same rendering as Shanaya.
  const ANJURA = { ...SHANAYA, voice: 'a6XidOEnTywSiWFoBUhm', name: 'Anjura' };
  test('the second English voice (Anjura) has its set: a quiz mapped to it is voiced in it, the plan stays on', () => {
    expect(Voice.setIdOf(ANJURA)).toBe('el-anjura-e228e6');
    const other = '33333333-3333-4333-8333-333333333333';
    const p = OneVoice.take({ voices: { en: SHANAYA, ur: REVA }, bank: ['q', 'opts'], quiz_voices: { [QUIZ]: 'el-anjura-e228e6', [other]: 'keep' } });
    expect(OneVoice.forQuiz(p, QUIZ, 'en').voices.en).toMatchObject({ voice: ANJURA.voice, model: 'eleven_v4', settings: ANJURA.settings });
    expect(OneVoice.forQuiz(p, other, 'en')).toBe(null);
    expect(Voice.sharedSets(OneVoice.forQuiz(p, QUIZ, 'en')).en).toEqual({ path: 'el-anjura-e228e6', v: Voice.SHARED_SETS['el-anjura-e228e6'] });
    expect(refusals()).toEqual([]);
  });

  test('a tool given the plan directly (backfill --plan, before its set exists) still records in that voice', async () => {
    const fake = seed(ROWS(), {});
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: OneVoice.normalize({ voices: { en: JESSICA } }) });
    expect([...new Set(tts.synthesize.mock.calls.map(([a]) => a.voice))]).toEqual([JESSICA.voice]);
  });
});

describe('the signed-media cache follows the slot the page is served from', () => {
  test('on: new one-voice clips landing in meta.web_one are served at once, not after the 5-minute cache', async () => {
    const first = { [QID2]: gen(QID2) };
    const meta1 = { web_one: { audio_v: Publish.AUDIO_VERSION, audio: { [QID2]: { q: 'k1' } } } };
    await page([bankRow(QID2, {})], first, { flag: true, meta: meta1 });
    const meta2 = { web_one: { audio_v: Publish.AUDIO_VERSION, audio: { [QID2]: { q: 'k2' } } } };
    const second = { [QID2]: { ...gen(QID2), q: `quiz-audio/sandbox/${QUIZ}/en/${QID2}/q-${TAG}-0000000f.ogg` } };
    const out = await page([bankRow(QID2, {})], second, { flag: true, meta: meta2 });
    expect(out.quiz.questions[0].audio.q).toBe(second[QID2].q);
  });
});

/*
 * A plan's `loudness_lufs` (option A): every clip the plan records is levelled to that loudness, so the AI lines sit at
 * the loudness of the bank's recordings of people. Only a plan that names it is levelled; every other plan (and off)
 * stores the provider's own bytes under the same keys and stamp as before.
 */
describe('a plan\'s loudness: the AI lines are levelled to the plan\'s LUFS', () => {
  const { execFileSync, spawnSync } = require('child_process');
  const os = require('os');
  const ffmpeg = (() => { try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; } })();
  const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
  const MATCHED = { voices: { en: { provider: 'elevenlabs', voice: 'aQLnnbQ6J7JYyvxnNgjx', name: 'Eman', model: 'eleven_v4', settings: SETTINGS },
    ur: { provider: 'elevenlabs', voice: 'o85TqPN3F4P7dWae2paA', name: 'Reva', model: 'eleven_v4', settings: SETTINGS } }, bank: ['q', 'opts'] };
  const tmp = (ext) => path.join(os.tmpdir(), `wq-loud-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  // A quiet Ogg Opus clip, as a provider might return it (about -33 LUFS).
  const quietClip = () => {
    const f = tmp('ogg');
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-af', 'volume=-30dB',
      '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', f]);
    const b = fs.readFileSync(f); fs.unlinkSync(f); return b;
  };
  // The clip's integrated loudness, as ffmpeg's loudnorm measures it (on stderr).
  const lufsOf = (buf) => {
    const f = tmp('ogg'); fs.writeFileSync(f, buf);
    const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', f, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
    fs.unlinkSync(f);
    return Number(JSON.parse(r.stderr.match(/\{[^{}]*\}/g).pop()).input_i);
  };

  test('normalize: `loudness_lufs` is kept and is part of the stamp; a plan without it keeps its stamp; an odd value is ignored', () => {
    expect(OneVoice.normalize(MATCHED).sig).toBe('c7150102c2');                  // the stamp before the field existed
    expect(OneVoice.normalize(true).sig).toBe('c4abc76e5f');
    expect('loudness_lufs' in OneVoice.normalize(MATCHED)).toBe(false);
    const loud = OneVoice.normalize({ ...MATCHED, loudness_lufs: -21 });
    expect(loud.loudness_lufs).toBe(-21);
    expect(loud.sig).not.toBe('c7150102c2');
    ['-21', null, -5, -60, 'loud'].forEach((v) => expect('loudness_lufs' in OneVoice.normalize({ ...MATCHED, loudness_lufs: v })).toBe(false));
  });

  test('published under a plan with loudness_lufs -21: every clip is Ogg Opus at about -21 LUFS, under keys of its own', async () => {
    const r2 = require('../../../shared/storage/r2');
    const quiet = quietClip();
    expect(lufsOf(quiet)).toBeLessThan(-28);
    tts.synthesize.mockImplementation(async ({ provider, voice }) => ({ audio: quiet, provider, voice, durationSec: 4 }));
    const plain = seed(ROWS(), {});
    await Publish.publishQuizAudio(QUIZ, { db: { from: plain.from }, oneVoice: OneVoice.normalize(MATCHED) });
    const plainKeys = r2.uploadBuffer.mock.calls.map((c) => c[1]);
    r2.uploadBuffer.mock.calls.forEach((c) => expect(c[0]).toBe(quiet));    // without it: the provider's own bytes
    r2.uploadBuffer.mockClear();
    const fake = seed(ROWS(), {});
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from }, oneVoice: OneVoice.normalize({ ...MATCHED, loudness_lufs: -21 }) });
    const calls = r2.uploadBuffer.mock.calls;
    expect(calls.length).toBe(plainKeys.length);
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((c) => {
      expect(c[0].slice(0, 4).toString()).toBe('OggS');
      expect(Math.abs(lufsOf(c[0]) + 21)).toBeLessThan(1.5);
      expect(plainKeys).not.toContain(c[1]);
    });
  }, 60000);
});

/*
 * A plan that names `voices` for some languages only: a quiz in a language it leaves out keeps today's quiz voice and
 * today's lines (the switch is off for it): its page, its recording, its job and Jugnu's challenge lines in that
 * language. A plan with no `voices` (true, a bank or rate only) is the one voice in both languages, as before.
 */
describe('a plan that leaves a language out: that language keeps today\'s voice', () => {
  const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
  const REVA = { provider: 'elevenlabs', voice: 'o85TqPN3F4P7dWae2paA', name: 'Reva', model: 'eleven_v4', settings: SETTINGS };
  const UR_ONLY = { voices: { ur: REVA }, bank: ['q', 'opts'] };
  const strip = (o) => JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v));
  const today = async () => { const none = strip(await page(ROWS(), GENERATED(TODAY), {})); WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache(); return none; };

  test('normalize: the left-out language is today\'s voice, with no shared-line set; the plan is live on the other\'s set', () => {
    const p = OneVoice.normalize(UR_ONLY);
    expect(p.voices.en).toBe(null);
    expect(Voice.setIdOf(p.voices.ur)).toBe('el-reva-cc0c3b');
    expect(Voice.quizVoice('en', { oneVoice: p })).toEqual(Voice.QUIZ_VOICE.en);
    expect(Voice.sharedSets(p)).toEqual({ ur: { path: 'el-reva-cc0c3b', v: Voice.SHARED_SETS['el-reva-cc0c3b'] } });
    expect(OneVoice.take(UR_ONLY)).toEqual(p);
    expect(OneVoice.forQuiz(p, QUIZ, 'en')).toBe(null);
    expect(OneVoice.forQuiz(p, QUIZ, 'en-US')).toBe(null);
    expect(OneVoice.forQuiz(p, QUIZ, 'ur')).toBe(p);
    expect(OneVoice.forQuiz(p, QUIZ)).toBe(p);
    expect(OneVoice.normalize({ bank: [] }).voices).toEqual({ en: Voice.ONE_VOICE.en, ur: Voice.ONE_VOICE.ur });
  });

  test('an English quiz under an Urdu-only plan: the page is today\'s, byte for byte', async () => {
    const none = await today();
    const out = await page(ROWS(), GENERATED(TODAY), { flag: UR_ONLY });
    expect('one_voice' in out).toBe(false);
    expect(strip(out)).toBe(none);
  });

  test('an English quiz under an Urdu-only plan is published as today: today\'s voice, meta.web, no one-voice slot', async () => {
    const fake = seed(ROWS(), { flag: UR_ONLY });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(fake.db.quizzes[0].meta.web_one).toBeUndefined();
    expect([...new Set(tts.synthesize.mock.calls.map(([a]) => a.voice))]).toEqual([Voice.QUIZ_VOICE.en.voice]);
  });

  test('the worker\'s job for an English quiz under an Urdu-only plan asks no one-voice recording', async () => {
    const fake = seed(ROWS(), { flag: UR_ONLY });
    fake.db.quizzes[0].language = 'en';
    const publish = jest.fn(async () => ({ ok: true, failed: 0 }));
    await Publish.runQuizAudioJob({ quizId: QUIZ }, { db: { from: fake.from }, publish, queue });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1].oneVoice).toBeUndefined();
  });

  test('Jugnu\'s challenge lines: English keeps today\'s key and voice, Urdu is the plan\'s voice', async () => {
    const Ch = require('../../../shared/services/quiz/web-quiz-challenge');
    seed([], { flag: UR_ONLY });
    await OneVoice.on();
    expect(Ch.clipKey('listen', 'story', 'en', 'One day it rained.')).toContain(`-${Voice.voiceTag('en')}-`);
    expect(Ch.clipKey('listen', 'story', 'ur', 'ایک دن بارش ہوئی۔')).toContain('-el-reva-cc0c3b-');
    OneVoice.reset(); seed([], {}); await OneVoice.on();
    const off = Ch.clipKey('listen', 'story', 'en', 'One day it rained.');
    OneVoice.reset(); seed([], { flag: UR_ONLY }); await OneVoice.on();
    expect(Ch.clipKey('listen', 'story', 'en', 'One day it rained.')).toBe(off);
  });
});

/*
 * Quiz by quiz: `quiz_voices: { "<quizId>": "<set>" | "keep" }`. A quiz mapped to a recorded set is served and recorded
 * in that set's voice; "keep" keeps today's voice; a quiz the map does not name takes its language's voice (and a
 * language the plan leaves out keeps today's). A map naming a set that is not recorded, or whose voice is not known,
 * turns the whole plan off (refused and logged). A plan without the map keeps its stamp.
 */
describe('a plan\'s quiz_voices: the AI voice follows each quiz', () => {
  const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
  const REVA = { provider: 'elevenlabs', voice: 'o85TqPN3F4P7dWae2paA', name: 'Reva', model: 'eleven_v4', settings: SETTINGS };
  const strip = (o) => JSON.stringify(o, (k, v) => (/token|expires|_at$|^t$|nonce|sig/i.test(k) ? undefined : v));
  const today = async () => { const none = strip(await page(ROWS(), GENERATED(TODAY), {})); WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache(); return none; };
  const fresh = () => { WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache(); };

  test('normalize: the map keeps valid entries only and is part of the stamp; a plan without it keeps its stamp', () => {
    const p = OneVoice.normalize({ quiz_voices: { [QUIZ]: 'el-bella-cff2e4', other: 'keep', bad: 'Not A Tag', '': 'el-bella' } });
    expect(p.quiz_voices).toEqual({ [QUIZ]: 'el-bella-cff2e4', other: 'keep' });
    expect(p.sig).not.toBe(OneVoice.normalize(true).sig);
    expect('quiz_voices' in OneVoice.normalize(true)).toBe(false);
    expect(OneVoice.normalize({ bank: ['q', 'opts'] }).sig).toBe(OneVoice.normalize(true).sig);
    [{ quiz_voices: [] }, { quiz_voices: {} }, { quiz_voices: { bad: 'Not A Tag' } }].forEach((v) => expect(OneVoice.normalize(v)).toBe(null));
  });

  test('forQuiz: a mapped quiz takes the set\'s voice, "keep" today\'s, an unmapped quiz its language\'s', () => {
    const p = OneVoice.normalize({ voices: { ur: REVA }, quiz_voices: { a: 'el-bella-cff2e4', b: 'keep', c: 'el-reva-cc0c3b' } });
    expect(Voice.setIdOf(OneVoice.forQuiz(p, 'a', 'en').voices.en)).toBe('el-bella-cff2e4');
    expect(Voice.setIdOf(OneVoice.forQuiz(p, 'c', 'en').voices.en)).toBe('el-reva-cc0c3b');
    expect(OneVoice.forQuiz(p, 'a', 'en').sig).toBe(p.sig);
    expect(OneVoice.forQuiz(p, 'b', 'ur')).toBe(null);
    expect(OneVoice.forQuiz(p, 'z', 'en')).toBe(null);   // not mapped, English left out: today's
    expect(OneVoice.forQuiz(p, 'z', 'ur')).toBe(p);      // not mapped, Urdu: the plan's Urdu voice
  });

  test('a quiz mapped to a recorded set: served and published in that set\'s voice', async () => {
    const plan = { voices: { ur: REVA }, quiz_voices: { [QUIZ]: 'el-bella-cff2e4' } };
    const out = await page(ROWS(), GENERATED('el-bella-cff2e4'), { flag: plan });
    expect(out.one_voice).toBe(true);
    expect(out.voice_sets.en).toEqual({ path: 'el-bella-cff2e4', v: Voice.SHARED_SETS['el-bella-cff2e4'] });
    fresh(); tts.synthesize.mockClear();
    const fake = seed(ROWS(), { flag: plan });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    const calls = tts.synthesize.mock.calls.map(([a]) => `${a.voice}:${a.model}:${a.voiceSettings && a.voiceSettings.speed}`);
    expect([...new Set(calls)]).toEqual([`${Voice.ONE_VOICE.en.voice}:eleven_multilingual_v2:0.9`]);
    expect(fake.db.quizzes[0].meta.web_one.audio_one).toBe(OneVoice.normalize(plan).sig);
  });

  test.each([
    ['"keep"', { voices: { ur: REVA }, quiz_voices: { [QUIZ]: 'keep' } }],
    ['not named, in a language the plan leaves out', { voices: { ur: REVA }, quiz_voices: { 'another-quiz': 'el-bella-cff2e4' } }],
  ])('a quiz %s keeps today\'s voice: the page is today\'s, byte for byte', async (_, plan) => {
    const none = await today();
    const out = await page(ROWS(), GENERATED(TODAY), { flag: plan });
    expect('one_voice' in out).toBe(false);
    expect(strip(out)).toBe(none);
  });

  test('a quiz not named, in a language the plan voices: its language\'s voice', async () => {
    const out = await page(ROWS(), GENERATED(TAG), { flag: { quiz_voices: { 'another-quiz': 'el-reva-cc0c3b' } } });
    expect(out.one_voice).toBe(true);
    expect(out.voice_sets.en).toEqual({ path: TAG, v: Voice.SHARED_SETS[TAG] });
  });

  test.each([['el-nobody'], ['el-sana'], ['el-reva']])('a quiz mapped to %s (no recorded set of a known voice): the plan is off, refused and logged', (set) => {
    const { logToFile } = require('../../../shared/utils/logger');
    logToFile.mockClear();
    expect(OneVoice.take({ voices: { ur: REVA }, quiz_voices: { [QUIZ]: set } })).toBe(null);
    expect(logToFile.mock.calls.some(([m, f]) => /no recorded set of Jugnu/.test(String(m)) && f.missing.includes(set))).toBe(true);
  });

  test('every set a quiz can be mapped to names its voice, as its recorded manifest does', () => {
    Object.entries(Voice.SET_VOICES).forEach(([tag, v]) => {
      expect(Voice.setIdOf(v)).toBe(tag);
      expect(Voice.SHARED_SETS[tag]).toBeTruthy();
      expect(Voice.voiceOfTag(tag)).toEqual(v);
      const m = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../../dashboard/public/wq/voice/one/${tag}/manifest.json`), 'utf8'));
      expect(Voice.setIdOf(m.voice)).toBe(tag);
    });
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../dashboard/public/wq/voice/one/el-reva-cc0c3b/manifest.json'), 'utf8'));
    expect(Voice.SET_VOICES['el-reva-cc0c3b']).toEqual(m.voice);
  });
});
