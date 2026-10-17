'use strict';
/**
 * One voice per quiz (app_settings `web_quiz_one_voice`): the quiz page (getQuiz) pays no settings read for it.
 *
 * The switch rides the page's own settings read (web-quiz-identity-roster.js, with `web_quiz_identity` and the watch
 * root). With the switch off, every page kind reads `app_settings` exactly as many times as before one voice existed:
 * the constants below were recorded on the page before the switch, cold (the first page after a start) and warm (the
 * next page within the 30 s caches). On, the page reads no more than off. A failed read that names the switch reads the
 * page's own two switches again alone: identity and the watch root stay as today, and one voice is off.
 *
 * Boundaries faked: supabase (in-memory, every `from` counted per table), R2 + the voice gateway, the loggers.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({
  setNX: jest.fn(async () => true), get: jest.fn(async () => null), set: jest.fn(async () => true), delete: jest.fn(async () => true),
}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })), uploadBuffer: jest.fn(async () => true), getPresignedUrl: jest.fn(async (u) => u),
}));
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async ({ provider, voice }) => ({ audio: Buffer.from('OggS-fake'), provider, voice, durationSec: 2 })),
}));

const { makeFake } = require('./fake-supabase');

const KEY = 'web_quiz_one_voice';
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const CLASS = '66666666-6666-4666-8666-666666666666';
const KID = (n) => `44444444-4444-4444-8444-44444444444${n}`;
const future = new Date(Date.now() + 864e6).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

// app_settings reads of one page, recorded on the page before the switch existed (cold = first page after a start).
const OFF_READS = {
  library: { cold: 13, warm: 0 },
  teacher: { cold: 13, warm: 0 },
  classLink: { cold: 13, warm: 0 },
};
// Rows a key of this change may add with it ON (none: the switch rides the page's own read).
const NAMED_ON = [];

const question = (n, media) => ({
  id: `9999999${n}-9999-4999-8999-999999999999`, quiz_id: QUIZ, external_id: media ? `vb:${n}` : `q${n}`, sort_order: n,
  question_text: 'Which month comes after January?', option_a: 'February', option_b: 'May', option_c: 'March', option_d: 'June',
  correct_option: 'A', explanation: 'February is the second month.', option_feedback: {}, media: media || {}, render_pattern: media ? 'P6a' : null,
});
const code = (extra = {}) => ({
  id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example', topic: 'Months',
  language: null, active: true, expires_at: future, invited_by_student_id: null, parent_share_code_id: null, uses_count: 0,
  created_at: ago(2), ...extra,
});
const played = (n) => ({
  id: `55555555-5555-4555-8555-55555555555${n}`, share_code_id: SC, quiz_id: QUIZ, student_id: KID(n), student_name: `Child ${n}`,
  user_id: null, status: 'completed', source: 'share_link', invited_by_student_id: null, student_class: '3-A',
  completed_at: ago(1), created_at: ago(1),
});

// The three pages a child opens: a library (video-bank) quiz with the bank's recordings, a quiz the teacher made and
// sent, and the teacher's class code a class has played.
const KINDS = {
  library: () => ({
    quiz_share_codes: [code()],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '1', subject: 'English', language: null, meta: {}, quiz_source: 'video' }],
    quiz_questions: [question(1, { question_audio: ['https://clips.example/bank/q1.ogg'] })], quiz_sessions: [],
  }),
  teacher: () => ({
    quiz_share_codes: [code({ language: 'en' })],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '3', subject: 'English', language: 'en', meta: {}, video_id: null, list_id: null }],
    quiz_questions: [question(1), question(2)], quiz_sessions: [played(1), played(2)],
  }),
  classLink: () => ({
    quiz_share_codes: [code({ language: 'en', class_id: CLASS })],
    quizzes: [{ id: QUIZ, topic: 'Months', grade: '3', subject: 'English', language: 'en', meta: {}, video_id: null, list_id: null }],
    quiz_questions: [question(1), question(2)], quiz_sessions: [played(1), played(2), played(3)],
    classes: [{ id: CLASS, grade_code: 'G3', section: 'A', shift_code: null, is_active: true }],
  }),
};

// Every value that is off, and two that are on (the default plan, and a plan object).
const OFF = [['absent', undefined], ['false', false], ['"true"', 'true'], ['{}', {}], ['{"enabled":true}', { enabled: true }],
  ['{"foo":1}', { foo: 1 }], ['{"enabled":false}', { enabled: false }], ['{"enabled":"false","kbps":32}', { enabled: 'false', kbps: 32 }]];
const ON = [['true', true], ['{"kbps":32}', { kbps: 32 }]];

const SAVED = { ...process.env };
beforeEach(() => { process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' }; delete process.env.WEB_QUIZ_TOKEN_SECRET; });
afterAll(() => { process.env = SAVED; });

/**
 * A fresh process (cold caches) on `kind` with the switch at `flag` (undefined = no row). → { page() → { out, settings } }
 * `failKey`: a read of app_settings that names the switch answers an error, as a failed read does.
 */
function boot(kind, flag, { failKey = false, extra = [] } = {}) {
  jest.resetModules();
  const supabase = require('../../../shared/config/supabase');
  const fake = makeFake({
    students: [], quiz_answers: [], ...KINDS[kind](),
    app_settings: [...(flag === undefined ? [] : [{ key: KEY, value: flag }]), ...extra],
  });
  let settings = 0;
  const from = (t) => {
    if (t === 'app_settings') settings += 1;
    const b = fake.from(t);
    if (t !== 'app_settings' || !failKey) return b;
    const failed = { data: null, error: { message: 'read failed' } };
    const fail = () => ({ ...b, then: (res, rej) => Promise.resolve(failed).then(res, rej), maybeSingle: () => Promise.resolve(failed) });
    const { eq, in: inn } = b;
    b.eq = (c, v) => (c === 'key' && v === KEY ? fail() : eq(c, v));
    b.in = (c, vs) => (c === 'key' && (vs || []).includes(KEY) ? fail() : inn(c, vs));
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  jest.spyOn(require('../../../shared/services/quiz/web-quiz-media'), 'presignAudio').mockResolvedValue({});
  const WQ = require('../../../shared/services/quiz/web-quiz.service');
  return {
    WQ,
    reads: () => settings,
    async page() {
      const before = settings;
      const out = await WQ.getQuiz('AB12CD');
      await new Promise((r) => setImmediate(r));   // the background refreshes a page starts are its reads too
      return { out, settings: settings - before };
    },
  };
}

describe.each(Object.keys(KINDS))('%s page: app_settings reads', (kind) => {
  test.each(OFF)('switch %s (off): cold and warm reads are the page\'s own, and the payload names no one voice', async (_, flag) => {
    const p = boot(kind, flag);
    const cold = await p.page();
    const warm = await p.page();
    expect(cold.out.one_voice).toBeUndefined();
    expect({ cold: cold.settings, warm: warm.settings }).toEqual(OFF_READS[kind]);
  });

  test.each(ON)('switch %s (on): no more reads than off, cold and warm, and the page has one voice', async (_, flag) => {
    const p = boot(kind, flag);
    const cold = await p.page();
    const warm = await p.page();
    expect(cold.out.one_voice).toBe(true);
    expect(cold.settings).toBeLessThanOrEqual(OFF_READS[kind].cold + NAMED_ON.length);
    expect(warm.settings).toBeLessThanOrEqual(OFF_READS[kind].warm + NAMED_ON.length);
    // The switch's own module holds the page's reading: its other readers (the publish step, the challenge's keys) ask no read.
    const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
    const before = p.reads();
    expect(await OneVoice.plan()).toMatchObject({ sig: expect.any(String) });
    expect(OneVoice.currentPlan()).toMatchObject({ sig: expect.any(String) });
    expect(p.reads() - before).toBe(0);
  });
});

// RULING #C81: the switch rides the identity read (the host). Another caller in the process (the hub, a second page)
// keeps the host warm while the switch's own reading is cold (forgotten) or never taken: the page must still read as
// often as today, because its plan comes from the host's row, never from a read of the switch alone. The base is
// measured in the same run (#C72): the same page after the same host read, with no switch row and nothing forgotten.
// HOST_WARM_READS is that base recorded on the page before the switch existed (#C72 AMENDED (1)).
const HOST_WARM_READS = { library: 12, teacher: 12, classLink: 12 };

describe.each(Object.keys(KINDS))('%s page, identity read warm and the switch\'s own reading cold (#C81)', (kind) => {
  async function hostWarmRiderCold(flag) {
    const p = boot(kind, flag);
    // The host's own read, as another caller would make it (it also hands the switch its row).
    await require('../../../shared/services/quiz/web-quiz-identity-roster').identityMode();
    // Only the switch's own reading is forgotten (cold, or past its 30 s); the identity read stays cached.
    require('../../../shared/services/quiz/web-quiz-one-voice-flag').reset();
    return p.page();
  }
  async function base() {
    const p = boot(kind, undefined);
    await require('../../../shared/services/quiz/web-quiz-identity-roster').identityMode();
    return p.page();
  }

  test.each(OFF)('switch %s (off): exactly the same-run base\'s reads', async (_, flag) => {
    const b = await base();
    expect(b.settings).toBe(HOST_WARM_READS[kind]);
    const r = await hostWarmRiderCold(flag);
    expect(r.out.one_voice).toBeUndefined();
    expect(r.settings).toBe(b.settings);
  });

  test.each(ON)('switch %s (on): no more than the base + the named rows, and the page has one voice from the host\'s row', async (_, flag) => {
    const b = await base();
    const r = await hostWarmRiderCold(flag);
    expect(r.out.one_voice).toBe(true);
    expect(r.settings).toBeLessThanOrEqual(b.settings + NAMED_ON.length);
  });
});

describe('a tool\'s pinned plan', () => {
  test('wins over the page\'s read: pinned off, the page has no one voice whatever the switch says', async () => {
    const p = boot('library', true);
    require('../../../shared/services/quiz/web-quiz-one-voice-flag').pin(null);
    const { out } = await p.page();
    expect(out.one_voice).toBeUndefined();
  });
});

describe('a failed read that names the switch', () => {
  test('the page\'s own switches are read again alone and stay as today; one voice is off; one read more, cold only', async () => {
    const V2 = [{ key: 'web_quiz_identity', value: 'v2' }];
    const base = boot('teacher', undefined, { extra: V2 });
    const baseCold = await base.page();
    const baseWarm = await base.page();
    const p = boot('teacher', true, { failKey: true, extra: V2 });
    const cold = await p.page();
    const warm = await p.page();
    expect(cold.out.one_voice).toBeUndefined();
    expect(await require('../../../shared/services/quiz/web-quiz-identity-roster').identityMode()).toBe('v2');
    expect(JSON.stringify(cold.out.cls)).toBe(JSON.stringify(baseCold.out.cls));
    expect(cold.settings).toBe(baseCold.settings + 1);
    expect(warm.settings).toBe(baseWarm.settings);
  });

  test('the same read that answers: identity as set, one voice on', async () => {
    const p = boot('teacher', true, { extra: [{ key: 'web_quiz_identity', value: 'v2' }] });
    const cold = await p.page();
    expect(cold.out.one_voice).toBe(true);
    expect(await require('../../../shared/services/quiz/web-quiz-identity-roster').identityMode()).toBe('v2');
  });
});

describe('the plan\'s `enabled` is the JSON true only', () => {
  test.each([['"false"', 'false'], ['0', 0], ['null', null], ['"true"', 'true']])('enabled %s with a rate: off', (_, enabled) => {
    jest.resetModules();
    const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
    expect(OneVoice.normalize({ enabled, kbps: 32 })).toBe(null);
  });

  test('enabled true, or no `enabled`, with a rate: the plan', () => {
    jest.resetModules();
    const OneVoice = require('../../../shared/services/quiz/web-quiz-one-voice-flag');
    expect(OneVoice.normalize({ enabled: true, kbps: 32 })).toMatchObject({ kbps: 32 });
    expect(OneVoice.normalize({ kbps: 32 })).toMatchObject({ kbps: 32 });
  });
});
