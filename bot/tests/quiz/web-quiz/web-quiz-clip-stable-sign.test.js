'use strict';
/**
 * Read-aloud clip links that stay the same for the hour (app_settings `web_quiz_clip_stable_sign`, default OFF, JSON
 * true only). Today every clip link is signed at the moment of the page answer, so it is new each time: a page that
 * asks for its late clips (audio_pending) swaps every question's links for new ones, and the clips it had already
 * warmed are fetched again on play (on sandbox a never-started option and starts of 2–4 s). On: a clip is signed as
 * at the top of the hour, for 7 h (never less than the 6 h the page lives), with a signed Cache-Control (the key names
 * the clip's bytes): the same clip gives the same link all hour, and the browser's copy is used.
 * The switch rides the page's one identity settings read: on adds no read. Off: today's links.
 *
 * Boundaries faked: supabase (in-memory), the loggers, the clock. The signer runs for real with dummy keys.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
process.env.R2_ACCESS_KEY_ID = 'AKIDEXAMPLE';
process.env.R2_SECRET_ACCESS_KEY = 'secret-example';
process.env.R2_BUCKET_NAME = 'clips-bucket';
process.env.INTERNAL_API_KEY = 'test-key';
delete process.env.WEB_QUIZ_TOKEN_SECRET;
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Media = require('../../../shared/services/quiz/web-quiz-media');
const WQ = require('../../../shared/services/quiz/web-quiz.service');
const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
const IdRoster = require('../../../shared/services/quiz/web-quiz-identity-roster');

const QID = '99999991-9999-4999-8999-999999999999';
const KEY = (p) => `quiz-audio/sandbox/z/ur/${QID}/${p}-sx-reyna-68567f-941dafb1.ogg`;
const META = { web: { audio: { [QID]: { q: KEY('q'), opts: [KEY('a'), KEY('b'), null], why: KEY('why'), fbs: [null, KEY('xb')] } } } };
const links = (out) => { const e = out[QID]; return [e.q, ...e.opts, e.why, ...(e.fbs || [])].filter(Boolean); };
const at = (iso) => jest.setSystemTime(new Date(iso));

afterEach(() => jest.useRealTimers());

describe('presignAudio({ stable: true }): one link per clip for the hour', () => {
  test('two answers inside one hour give byte-identical links, signed as at the hour, valid 7 h, with a signed Cache-Control', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    at('2026-10-20T10:05:13Z');
    const a = links(await Media.presignAudio(META, { expiresIn: 6 * 3600, stable: true }));
    at('2026-10-20T10:59:58Z');
    const b = links(await Media.presignAudio(META, { expiresIn: 6 * 3600, stable: true }));
    expect(a).toHaveLength(5);
    expect(b).toEqual(a);
    const u = new URL(a[0]);
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261020T100000Z');
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(7 * 3600));
    expect(u.searchParams.get('response-cache-control')).toBe('private, max-age=21600, immutable');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // a different clip is a different link
    expect(new Set(a).size).toBe(5);
    // the next hour: new links (still never less than 6 h to live)
    at('2026-10-20T11:00:01Z');
    const c = links(await Media.presignAudio(META, { expiresIn: 6 * 3600, stable: true }));
    expect(c[0]).not.toBe(a[0]);
    expect(new URL(c[0]).searchParams.get('X-Amz-Date')).toBe('20261020T110000Z');
  });
  test('off (no stable): today, a new link each answer, no Cache-Control, 6 h', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    at('2026-10-20T10:05:13Z');
    const a = links(await Media.presignAudio(META, { expiresIn: 6 * 3600 }));
    at('2026-10-20T10:05:14Z');
    const b = links(await Media.presignAudio(META, { expiresIn: 6 * 3600 }));
    expect(b[0]).not.toBe(a[0]);
    const u = new URL(a[0]);
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261020T100513Z');
    expect(u.searchParams.get('X-Amz-Expires')).toBe(String(6 * 3600));
    expect(u.searchParams.has('response-cache-control')).toBe(false);
  });
});

describe('the switch rides the page\'s identity settings read', () => {
  const TEACHER = '11111111-1111-4111-8111-111111111111';
  const QUIZ = '22222222-2222-4222-8222-222222222222';
  const future = new Date(Date.now() + 86400000 * 10).toISOString();
  function seed(stable) {
    const fake = makeFake({
      quiz_share_codes: [{ id: '33333333-3333-4333-8333-333333333333', code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example',
        topic: 'Months', language: null, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0, created_at: new Date().toISOString() }],
      quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: null, meta: {}, quiz_source: 'video' }],
      quiz_questions: [{ id: QID, quiz_id: QUIZ, sort_order: 1, question_text: 'Which month comes after January?', option_a: 'February', option_b: 'May', option_c: 'March', option_d: 'June', correct_option: 'A', explanation: 'February is next.', media: {} }],
      quiz_sessions: [], students: [], quiz_answers: [],
      app_settings: [{ key: 'web_quiz_one_voice', value: true }, ...(stable === undefined ? [] : [{ key: 'web_quiz_clip_stable_sign', value: stable }])],
    });
    Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  }
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
  async function page(stable) {
    WQ._resetQuizCache(); OneVoice.reset(); IdRoster._resetCache();
    seed(stable);
    const n = counting();
    const spy = jest.spyOn(Media, 'presignAudio').mockResolvedValue({});
    try { await WQ.getQuiz('AB12CD'); return { n, opts: spy.mock.calls.map((c) => c[1]) }; } finally { spy.mockRestore(); }
  }
  test('on (JSON true): the page signs stable, read in the same query as one voice, no more reads than off', async () => {
    await page(undefined);                                     // the page's other caches warm, as in a running bot
    const off = await page(undefined);
    const on = await page(true);
    expect(on.opts.some((o) => o && o.stable === true)).toBe(true);
    expect(off.opts.every((o) => !o || !o.stable)).toBe(true);
    expect(on.n.keys.some((k) => k.includes('web_quiz_one_voice') && k.includes('web_quiz_clip_stable_sign'))).toBe(true);
    expect(on.n.reads).toBe(off.n.reads);
  });
  test.each([[false], ['true'], [1], [{ on: true }]])('off (%p): today\'s links', async (v) => {
    const { opts } = await page(v);
    expect(opts.every((o) => !o || !o.stable)).toBe(true);
  });
});
