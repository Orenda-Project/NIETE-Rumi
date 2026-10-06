/**
 * Web quiz audio: ONE voice per language, one configurable bucket, keys a human can read,
 * and a kill switch + daily cap on recording.
 *
 * A child heard two voices in one breath: the shared "Not yet. The answer is" line was
 * recorded in one provider's voice and the quiz's own clip (the answer) in another. And a
 * clip recorded by a fallback provider during a blip was kept for ever, because its key
 * named only the words.
 *
 * Drives the REAL publish service, the REAL voice gateway, the REAL Soniox provider and the
 * REAL R2 helper. The network is mocked at its edge only: axios (the voice vendors), the S3
 * SDK's send (R2) and a fake Supabase client passed in as `db`. Presigning is local maths.
 */

const fs = require('fs');
const path = require('path');

process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'default-bucket';
process.env.ELEVENLABS_API_KEY = 'test-only';
process.env.SONIOX_API_KEY = 'test-only';
process.env.OPENAI_API_KEY = 'test-only';
delete process.env.E2E_CASSETTE;

const OGG = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'tts', 'libopus-sine-1s.ogg'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'dashboard', 'public', 'wq', 'voice', 'manifest.json'), 'utf8'));

jest.mock('axios');
// The service module reads the real Supabase config at load; the tests pass their own fake `db`.
jest.mock('../../../shared/config/supabase', () => ({}));
const mockLogError = jest.fn();
jest.mock('../../../shared/utils/logger', () => ({
  logToFile: jest.fn(), logError: (...a) => mockLogError(...a), logWarn: jest.fn(), logInfo: jest.fn(),
}));
const mockLogEvent = jest.fn();
jest.mock('../../../shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => null,
}));
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation((cfg) => {
      const real = new actual.S3Client(cfg);
      real.send = (...a) => mockS3Send(...a);
      return real;
    }),
  };
});

const axios = require('axios');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const { presignAudio } = require('../../../shared/services/quiz/web-quiz-media');
const Voice = require('../../../shared/services/quiz/web-quiz-voice');
const { cleanEvent } = require('../../../shared/services/quiz/web-quiz.service');

const QUIZ_ID = '22222222-2222-4222-8222-222222222222';
const Q1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const SONIOX = 'https://tts-rt.soniox.com/tts';

/** A Supabase-shaped client over in-memory rows: quizzes, quiz_questions, app_settings. */
function fakeDb({ quiz, questions, settings = {}, recordedToday = 0, settingsError = null }) {
  function from(table) {
    const st = { filters: {}, patch: null, head: false };
    const rows = () => {
      if (table === 'quizzes') return [quiz].filter((r) => !st.filters.id || r.id === st.filters.id);
      if (table === 'quiz_questions') return questions;
      if (table === 'app_settings') return Object.entries(settings).filter(([k]) => k === st.filters.key).map(([key, value]) => ({ key, value }));
      return [];
    };
    const api = {
      select(_c, opts) { st.head = !!(opts && opts.head); return api; },
      eq(col, val) { st.filters[col] = val; return api; },
      order() { return api; },
      update(patch) { st.patch = patch; return api; },
      maybeSingle() {
        if (table === 'app_settings' && settingsError) return Promise.resolve({ data: null, error: settingsError });
        return Promise.resolve({ data: rows()[0] || null, error: null });
      },
      then(resolve, reject) {
        if (st.patch) { if (table === 'quizzes') Object.assign(quiz, st.patch); return Promise.resolve({ error: null }).then(resolve, reject); }
        if (st.head) return Promise.resolve({ count: recordedToday, data: null, error: null }).then(resolve, reject);
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from };
}

function quizOf(lang) {
  const en = lang === 'en';
  return {
    quiz: { id: QUIZ_ID, language: lang, meta: { web: { arm: 'web' } } },
    questions: [{
      id: Q1, quiz_id: QUIZ_ID, sort_order: 1, question_text: en ? 'Which part takes in water?' : 'کون سا حصہ پانی لیتا ہے؟',
      option_a: en ? 'Roots' : 'جڑ', option_b: en ? 'Leaves' : 'پتے', option_c: null, option_d: null, correct_option: 'A',
      option_feedback: null, explanation: en ? 'Roots drink water.' : 'جڑیں پانی پیتی ہیں۔',
      media: { web: {
        v: 2, stem: en ? 'Which part takes in water?' : 'کون سا حصہ پانی لیتا ہے؟',
        options: [{ slot: 'A', text: en ? 'Roots' : 'جڑ' }, { slot: 'B', text: en ? 'Leaves' : 'پتے', fb: en ? 'Leaves make food.' : 'پتے کھانا بناتے ہیں۔' }],
        why: en ? 'Roots drink water.' : 'جڑیں پانی پیتی ہیں۔',
        hint: { text: en ? 'Think about what is under the soil.' : 'سوچیں، مٹی کے نیچے کیا ہے؟' },
      } },
    }],
  };
}

const nothingInR2 = async (cmd) => {
  if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; }
  return {};
};
const cmds = (name) => mockS3Send.mock.calls.map(([c]) => c).filter((c) => c.constructor.name === name);

beforeEach(() => {
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: OGG });
  mockS3Send.mockReset();
  mockS3Send.mockImplementation(nothingInR2);
  mockLogEvent.mockReset();
  mockLogError.mockReset();
  delete process.env.TTS_PROVIDER;
  delete process.env.TTS_FALLBACK;
  delete process.env.WEB_QUIZ_AUDIO_BUCKET;
  delete process.env.SONIOX_TTS_VOICE_EN;
  delete process.env.SONIOX_TTS_VOICE_UR;
  process.env.RAILWAY_ENVIRONMENT_NAME = 'sandbox';
});

describe.each(['en', 'ur'])('one voice (%s): the shared lines and every per-quiz clip', (lang) => {
  test('the shipped shared-line library was recorded in the quiz voice', () => {
    expect(MANIFEST.voices && MANIFEST.voices[lang]).toEqual(Voice.QUIZ_VOICE[lang]);
  });

  test('every per-quiz part (q, options, why, wrong-option feedback, hint) is recorded in that same voice', async () => {
    // The gateway's own setting names another provider for every other voice note: the quiz ignores it.
    process.env.TTS_PROVIDER = 'elevenlabs';
    process.env[`SONIOX_TTS_VOICE_${lang.toUpperCase()}`] = 'SomeOtherVoice';
    const rows = quizOf(lang);
    const out = await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(out.ok).toBe(true);
    const calls = axios.post.mock.calls;
    expect(calls.length).toBe(6); // q, a, b, why, xb, hint
    for (const [url, body] of calls) {
      expect(url).toBe(SONIOX);
      expect(body.voice).toBe(Voice.QUIZ_VOICE[lang].voice);
    }
    const entry = rows.quiz.meta.web.audio[Q1];
    expect(entry.hint).toMatch(/\/hint-/);
    expect(rows.quiz.meta.web.audio_voice).toBe(Voice.voiceTag(lang));
  });
});

describe('no second voice: a failed clip stays missing, it is never recorded by another provider', () => {
  test('Soniox refuses → no ElevenLabs or OpenAI call, the clip is counted failed and the quiz is not stamped', async () => {
    axios.post.mockImplementation(async (url) => {
      if (url === SONIOX) { const e = new Error('bad'); e.response = { status: 400, data: 'no' }; throw e; }
      return { data: OGG };
    });
    const rows = quizOf('en');
    const out = await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    expect(axios.post.mock.calls.every(([url]) => url === SONIOX)).toBe(true);
    expect(out.failed).toBe(6);
    expect(out.synthesized).toBe(0);
    expect(rows.quiz.meta.web.audio_v).toBeUndefined();
  });
});

describe('key scheme: quiz-audio/<env>/<quiz>/<lang>/<qid>/<part>-<voice>-<hash8>.ogg', () => {
  test('every stored key names the env, quiz, language, question, part and voice', async () => {
    await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb(quizOf('ur')) });
    const keys = cmds('PutObjectCommand').map((c) => c.input.Key);
    expect(keys.length).toBe(6);
    keys.forEach((k) => expect(k).toMatch(new RegExp(`^quiz-audio/sandbox/${QUIZ_ID}/ur/${Q1}/(q|a|b|why|xb|hint)-sx-ishita-[0-9a-f]{8}\\.ogg$`)));
  });

  test('a new voice or new words make a new key (no stale CDN or browser copy); the same ones the same key', () => {
    const k = (text, voice) => Publish.clipKey({ env: 'production', quizId: QUIZ_ID, lang: 'en', qid: Q1, part: 'q', voice, text });
    expect(k('Roots', 'sx-grace')).toBe(k('Roots', 'sx-grace'));
    expect(k('Roots', 'sx-grace')).not.toBe(k('Roots', 'el-alice'));
    expect(k('Roots', 'sx-grace')).not.toBe(k('Roots.', 'sx-grace'));
    expect(k('Roots', 'sx-grace')).toMatch(/^quiz-audio\/production\//);
  });

  test('the voice version is bumped so already-published quizzes re-record into the one voice', () => {
    expect(Publish.AUDIO_VERSION).toBeGreaterThanOrEqual(4);
  });
});

describe('the bucket: ONE config point (WEB_QUIZ_AUDIO_BUCKET, default R2_BUCKET_NAME), stored with the quiz', () => {
  test('set: every HEAD and PUT goes to it, and the quiz remembers it', async () => {
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio-test';
    const rows = quizOf('en');
    await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    const puts = cmds('PutObjectCommand');
    expect(puts.length).toBe(6);
    puts.forEach((c) => expect(c.input.Bucket).toBe('quiz-audio-test'));
    cmds('HeadObjectCommand').forEach((c) => expect(c.input.Bucket).toBe('quiz-audio-test'));
    expect(rows.quiz.meta.web.audio_bucket).toBe('quiz-audio-test');
  });

  test('unset: exactly today — the default bucket', async () => {
    const rows = quizOf('en');
    await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb(rows) });
    cmds('PutObjectCommand').forEach((c) => expect(c.input.Bucket).toBe('default-bucket'));
    expect(rows.quiz.meta.web.audio_bucket).toBe('default-bucket');
  });

  test('the page link is signed for the bucket the quiz was recorded in; an old quiz keeps playing from the old bucket', async () => {
    process.env.WEB_QUIZ_AUDIO_BUCKET = 'quiz-audio-new';
    const meta = { web: { audio_bucket: 'quiz-audio-test', audio: {
      [Q1]: { q: `quiz-audio/sandbox/${QUIZ_ID}/en/${Q1}/q-sx-grace-0123abcd.ogg`, opts: [null], why: null, hint: `quiz-audio/sandbox/${QUIZ_ID}/en/${Q1}/hint-sx-grace-0123abcd.ogg` },
      legacy: { q: `web-quiz/audio/${QUIZ_ID}/legacy/q-0123456789ab.ogg`, opts: [], why: null },
    } } };
    const out = await presignAudio(meta, { expiresIn: 600 });
    // The SDK signs bucket-in-host links (https://<bucket>.<account endpoint>/<key>), which R2 serves.
    expect(out[Q1].q).toMatch(/^https:\/\/quiz-audio-test\.acct\.r2\.example\.com\/quiz-audio\/sandbox\/.*X-Amz-Signature=/);
    expect(out[Q1].hint).toMatch(/^https:\/\/quiz-audio-test\..*hint-sx-grace/);
    expect(out.legacy.q).toMatch(/^https:\/\/default-bucket\.acct\.r2\.example\.com\/web-quiz\/audio\//);
  });
});

describe('kill switch + daily cap (app_settings), failing OPEN on a settings error', () => {
  test('web_quiz_audio_enabled=false: nothing is recorded, and the job does not retry', async () => {
    const rows = quizOf('en');
    const db = fakeDb({ ...rows, settings: { web_quiz_audio_enabled: false } });
    const out = await Publish.publishQuizAudio(QUIZ_ID, { db });
    expect(axios.post).not.toHaveBeenCalled();
    expect(out).toEqual(expect.objectContaining({ ok: false, reason: 'disabled' }));
    const queue = { queueJob: jest.fn() };
    const job = await Publish.runQuizAudioJob({ quizId: QUIZ_ID }, { db, queue });
    expect(job.reason).toBe('disabled');
    expect(queue.queueJob).not.toHaveBeenCalled();
  });

  test('over the daily cap: nothing is recorded and web_quiz_audio.capped is logged', async () => {
    const rows = quizOf('en');
    const out = await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb({ ...rows, settings: { web_quiz_audio_daily_cap: 2 }, recordedToday: 2 }) });
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.reason).toBe('capped');
    expect(mockLogEvent).toHaveBeenCalledWith('web_quiz_audio.capped', expect.objectContaining({ quizId: QUIZ_ID, cap: 2, recordedToday: 2 }));
  });

  test('under the cap: records, and stamps the day so the next count sees it', async () => {
    const rows = quizOf('en');
    const out = await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb({ ...rows, settings: { web_quiz_audio_daily_cap: 5 }, recordedToday: 4 }) });
    expect(out.synthesized).toBe(6);
    expect(rows.quiz.meta.web.audio_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a settings read error records anyway and says so at error level', async () => {
    const rows = quizOf('en');
    const out = await Publish.publishQuizAudio(QUIZ_ID, { db: fakeDb({ ...rows, settingsError: { message: 'down' } }) });
    expect(out.synthesized).toBe(6);
    expect(mockLogError).toHaveBeenCalledWith('web_quiz_audio.settings_failed', expect.any(Object));
  });
});

describe('page events: which part of a quiz had no clip is kept', () => {
  test('audio_missing keeps its part', () => {
    expect(cleanEvent({ n: 'audio_missing', qid: Q1, part: 'why' }).props.part).toBe('why');
    expect(cleanEvent({ n: 'audio_missing', qid: Q1, part: 'Not a part!' }).props.part).toBeUndefined();
  });
});

describe('the voice gateway: a pinned call speaks with that provider and voice only', () => {
  const { createTtsGateway } = require('../../../shared/services/tts');
  const fake = (name, impl) => ({ name, supports: () => true, isConfigured: () => true, voiceFor: () => `${name}-default`, synthesize: jest.fn(impl) });
  test('the asked voice reaches the provider; a failure there never reaches the configured fallback', async () => {
    const soniox = fake('soniox', async () => { throw Object.assign(new Error('down'), { code: 'http_error' }); });
    const elevenlabs = fake('elevenlabs', async () => ({ audio: OGG }));
    const openai = fake('openai', async () => ({ audio: OGG }));
    const gw = createTtsGateway({ providers: { soniox, elevenlabs, openai }, env: { TTS_PROVIDER: 'elevenlabs' }, cassette: () => ({ mode: () => 'off' }) });
    await expect(gw.synthesize({ text: 'Roots', language: 'en', useCase: 'reading', site: 'web_quiz_read_aloud', provider: 'soniox', voice: 'Grace' })).rejects.toThrow();
    expect(soniox.synthesize).toHaveBeenCalledWith(expect.objectContaining({ voice: 'Grace' }));
    expect(elevenlabs.synthesize).not.toHaveBeenCalled();
    expect(openai.synthesize).not.toHaveBeenCalled();
  });
  test('without a pin, nothing changes for every other caller: configured primary, then the fallback', async () => {
    const soniox = fake('soniox', async () => ({ audio: OGG }));
    const elevenlabs = fake('elevenlabs', async () => { throw new Error('down'); });
    const openai = fake('openai', async () => ({ audio: OGG }));
    const gw = createTtsGateway({ providers: { soniox, elevenlabs, openai }, env: { TTS_PROVIDER: 'elevenlabs' }, cassette: () => ({ mode: () => 'off' }) });
    const out = await gw.synthesize({ text: 'Roots', language: 'en', useCase: 'conversation', site: 'voice_reply' });
    expect(out.provider).toBe('openai');
    expect(elevenlabs.synthesize.mock.calls[0][0].voice).toBeUndefined();
  });
});
