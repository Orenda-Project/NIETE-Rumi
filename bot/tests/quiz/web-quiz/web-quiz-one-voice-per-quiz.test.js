'use strict';
/**
 * One voice per quiz (app_settings `web_quiz_one_voice`, default off).
 *
 * A library (video-bank) quiz spoke in two voices: the bank's recorded people for the question (and, for
 * some questions, the options), and the quiz voice (web-quiz-voice.js) for the why, the wrong-answer lines,
 * the hint, every part the bank did not record and the shared feedback lines. The voice changed inside one
 * question and again between questions. With the switch on, every spoken line of the quiz is the quiz
 * voice: the bank's recorded question, option and explanation clips are neither served nor skipped at
 * publish, a quiz recorded before is recorded again, and the page never speaks with the phone's own voice.
 * Only a listen item's SOUND to identify (`stim`, the question's material) is still the recording.
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
// TODAY = the quiz voice with the switch off; TAG = the one voice with it on (the stories' and passages' voice, #S72/#C61).
const TODAY = Voice.voiceTag('en');
const TAG = Voice.voiceTag('en', { oneVoice: true });
const gen = (qid, tag = TAG) => ({
  q: `quiz-audio/sandbox/${QUIZ}/en/${qid}/q-${tag}-00000001.ogg`,
  opts: ['a', 'b', 'c', 'd'].map((p) => `quiz-audio/sandbox/${QUIZ}/en/${qid}/${p}-${tag}-00000002.ogg`),
  why: `quiz-audio/sandbox/${QUIZ}/en/${qid}/why-${tag}-00000003.ogg`,
  fbs: [null, `quiz-audio/sandbox/${QUIZ}/en/${qid}/xb-${tag}-00000004.ogg`, null, null],
});
const JESSICA = { provider: 'elevenlabs', voice: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', model: 'eleven_v4' };
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
  WQ._resetQuizCache(); OneVoice.reset(); tts.synthesize.mockClear(); queue.queueJob.mockClear();
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

describe('switch on: every spoken line of a library quiz carries ONE provider + voice', () => {
  test('the bank\'s recorded question, options and checked why are not served; every clip is the quiz voice', async () => {
    const out = await page(ROWS(), GENERATED(), { flag: true });
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
    const out = await page([row], { [QID]: gen(QID) }, { flag: true });
    const q = out.quiz.questions[0];
    expect(q.audio.stim).toBe(rec('sound-f'));
    expect(spokenClips(q).filter((u) => BANK.test(u))).toEqual([]);
  });

  test('a quiz not yet recorded in the quiz voice: nothing of the recording is served meanwhile (the words are shown)', async () => {
    const out = await page(ROWS(), {}, { flag: true });
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
    expect(parts(row, { oneVoice: true })).toEqual(expect.arrayContaining(['q', 'a', 'b', 'c', 'd', 'why', 'xb']));
  });

  test('one voice: every clip is made by the quiz voice, every key carries it, and the quiz is stamped with it', async () => {
    const fake = seed(ROWS(), { flag: true, meta: { web: { audio_v: Publish.AUDIO_VERSION, audio_voice: TODAY } } });
    const out = await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(out.ok).toBe(true);
    const calls = tts.synthesize.mock.calls.map(([a]) => `${a.provider}:${a.voice}:${a.model}`);
    expect([...new Set(calls)]).toEqual(['elevenlabs:hpp4J3VqNfWAUOO0d1Us:eleven_v4']);
    expect(tts.synthesize.mock.calls[0][0].voiceSettings).toEqual({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true });
    // the provider's own bytes are stored (no 24 kb/s re-encode: the loss #S72 removed from the stories)
    const r2 = require('../../../shared/storage/r2');
    r2.uploadBuffer.mock.calls.forEach((c) => expect(c[0].toString()).toBe('OggS-fake'));
    const { web: today, web_one: web } = fake.db.quizzes[0].meta;
    expect(today).toEqual({ audio_v: Publish.AUDIO_VERSION, audio_voice: TODAY });   // the switched-off map is never touched
    const keys = Object.values(web.audio).flatMap((e) => [e.q, ...e.opts, e.why, ...e.fbs, e.hint]).filter(Boolean);
    expect(keys.length).toBeGreaterThanOrEqual(14);
    expect([...new Set(keys.map(voiceOf))]).toEqual([TAG]);
    expect(web.audio[CHECKED.id].q).toMatch(new RegExp(`/q-${TAG}-[0-9a-f]{8}\\.ogg$`));
    expect(web.audio_one).toBe(OneVoice.normalize(true).sig);
    expect(Publish.isCurrent(Publish.webOf(fake.db.quizzes[0].meta, { oneVoice: true }), { oneVoice: true })).toBe(true);
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
  });
});

/*
 * The voice choice is DATA: the switch's value names the voice per language and the parts kept from the bank's
 * recordings of people (the operator may keep the human question and options and choose the voice beside them).
 */
describe('the switch value is the voice plan', () => {
  const PLAN = { voices: { en: JESSICA }, bank: ['q', 'opts'] };
  test('normalize: true is the default plan; an object names voices and bank parts; anything else is off', () => {
    expect(OneVoice.normalize(true)).toMatchObject({ voices: { en: Voice.ONE_VOICE.en, ur: Voice.ONE_VOICE.ur }, bank: [] });
    // A string row is OFF, as under every switch reader of the app (the JSON string "true" too); the CLI parses first.
    expect(OneVoice.normalize('true')).toBe(null);
    expect(OneVoice.normalize(JSON.stringify(PLAN))).toBe(null);
    expect(OneVoice.normalize(JSON.parse(JSON.stringify(PLAN)))).toMatchObject({ voices: { en: { voice: JESSICA.voice, model: 'eleven_v4' }, ur: Voice.ONE_VOICE.ur }, bank: ['q', 'opts'] });
    expect(OneVoice.normalize({ voices: { en: { provider: 'nope', voice: 'x' } }, bank: ['q', 'stim', 'x'] })).toMatchObject({ voices: { en: Voice.ONE_VOICE.en }, bank: ['q'] });
    [false, null, 'yes', 1, [], { enabled: false }].forEach((v) => expect(OneVoice.normalize(v)).toBe(null));
  });

  test('served: the kept bank parts are the people\'s recordings, every other line is the plan voice; no shared set for a voice without one', async () => {
    const out = await page(ROWS(), GENERATED('el-jessica'), { flag: PLAN });
    const q1 = out.quiz.questions.find((q) => q.audio && q.audio.q === rec('q1'));
    expect(q1.audio.opts).toEqual([rec('february'), rec('may'), rec('march'), rec('june')]);
    expect(q1.audio.why).toMatch(/why-el-jessica-/);                       // the why is not kept: plan voice
    expect(q1.audio.fbs[1]).toMatch(/xb-el-jessica-/);
    const q2 = out.quiz.questions.find((q) => q !== q1);
    expect([...new Set(spokenClips(q2).map(voiceOf))]).toEqual(['el-jessica']);
    expect(out.voice_sets).toEqual({ ur: { path: 'el-sara', v: Voice.SHARED_SETS['el-sara'] } });
  });

  test('published: the kept parts are not recorded, the rest in the plan voice, stamped with the plan', async () => {
    const fake = seed(ROWS(), { flag: PLAN });
    const plan = OneVoice.normalize(PLAN);
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
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
    expect(lines[0]).toEqual({ qk: expect.any(String), tags: ['el-bella', 'el-jessica'], bank: [] });
    expect(JSON.stringify(lines[0])).not.toContain(QUIZ);
  });

  test('the plan\'s own mix (the people\'s recordings it keeps + its voice) logs nothing', async () => {
    await page(ROWS(), GENERATED('el-jessica'), { flag: PLAN });
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
    expect(OneVoice.normalize({ kbps: 17 }).kbps).toBe(64);
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
    const fake = seed(ROWS(), { flag: { voices: { en: slowEn } } });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake.from } });
    expect(tts.synthesize.mock.calls[0][0].voiceSettings).toMatchObject({ speed: 0.88 });
    const kSlow = fake.db.quizzes[0].meta.web_one.audio[QID2].q;
    tts.synthesize.mockClear(); OneVoice.reset();
    const fake2 = seed(ROWS(), { flag: true });
    await Publish.publishQuizAudio(QUIZ, { db: { from: fake2.from } });
    expect(fake2.db.quizzes[0].meta.web_one.audio[QID2].q).not.toBe(kSlow);
  });
});
