'use strict';
/**
 * The daily recording cap counts one-voice recordings too (app_settings `web_quiz_audio_cap_one`, default OFF).
 *
 * `web_quiz_audio_daily_cap` counts quizzes stamped `meta.web.audio_day` today. A quiz recorded in the one voice is
 * stamped in its own slot, `meta.web_one.audio_day`, so a busy one-voice day was never counted and had no ceiling.
 * With the switch on, the count is quizzes stamped today in EITHER slot, and a quiz already stamped today in the slot
 * it records into finishes its recording (it is counted already). With the switch off (absent, not JSON true, or a
 * failed read) the count is today's exactly.
 *
 * A capped quiz is not left silent: it has no clips, and with one voice + `web_quiz_voice_gap_phone` the page reads
 * each part in the phone's voice with the mark (web-quiz-voice-gap-phone.test.js).
 *
 * Drives the REAL publish service and the REAL cap (web-quiz-audio-store.js recordingAllowed) over a fake Supabase
 * client that evaluates the cap's count filters on in-memory quizzes. The voice vendor and R2 are mocked.
 */

jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
const mockLogEvent = jest.fn();
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({
  headObject: jest.fn(async () => ({ exists: false })),
  uploadBuffer: jest.fn(async () => true),
  getPresignedUrl: jest.fn(async (u) => u),
}));
jest.mock('../../../shared/services/tts', () => ({
  synthesize: jest.fn(async ({ provider, voice }) => ({ audio: Buffer.from('OggS-fake'), provider, voice, durationSec: 1 })),
}));

const tts = require('../../../shared/services/tts');
const Publish = require('../../../shared/services/quiz/web-quiz-publish.service');
const Store = require('../../../shared/services/quiz/web-quiz-audio-store');
const CapOne = require('../../../shared/services/quiz/web-quiz-audio-cap-one-flag');

const QUIZ = '22222222-2222-4222-8222-222222222222';
const QID = '99999991-9999-4999-8999-999999999999';
const TODAY = Store.pkDay();

const question = () => ({
  id: QID, quiz_id: QUIZ, sort_order: 1, question_text: 'Which part takes in water?',
  option_a: 'Roots', option_b: 'Leaves', option_c: null, option_d: null, correct_option: 'A',
  option_feedback: null, explanation: 'Roots drink water.', media: null,
});

/**
 * quizzes: the quiz being recorded first, then others; settings: app_settings rows by key (settingsError: the
 * switch's read fails). Logs every count the cap asks for, as the filter text, in `counts`.
 */
function fakeDb({ quizzes, settings = {}, settingsError = null }) {
  const counts = [];
  const dayOf = (q, slot) => (q.meta && q.meta[slot] && q.meta[slot].audio_day) || null;
  function from(table) {
    const st = { eq: [], or: null, head: false, patch: null };
    const matches = (q) => st.eq.every(([col, val]) => {
      if (col === 'id') return q.id === val;
      if (col === 'meta->web->>audio_day') return dayOf(q, 'web') === val;
      if (col === 'meta->web_one->>audio_day') return dayOf(q, 'web_one') === val;
      return true;
    }) && (!st.or || st.or.some(([slot, val]) => dayOf(q, slot) === val));
    const api = {
      select(_c, opts) { st.head = Boolean(opts && opts.head); return api; },
      eq(col, val) { st.eq.push([col, val]); return api; },
      in() { return api; },
      or(text) {
        st.or = String(text).split(',').map((f) => {
          const m = /^meta->(web|web_one)->>audio_day\.eq\.(.+)$/.exec(f);
          if (!m) throw new Error(`unexpected or filter ${f}`);
          return [m[1], m[2]];
        });
        st.orText = text;
        return api;
      },
      order() { return api; },
      update(patch) { st.patch = patch; return api; },
      maybeSingle() {
        if (table === 'app_settings') {
          const key = (st.eq.find(([c]) => c === 'key') || [])[1];
          return Promise.resolve({ data: key in settings ? { key, value: settings[key] } : null, error: null });
        }
        if (table === 'quizzes') return Promise.resolve({ data: quizzes.filter(matches)[0] || null, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        if (st.patch) {
          const q = quizzes.filter(matches)[0];
          if (q) Object.assign(q, st.patch);
          return Promise.resolve({ error: null }).then(resolve, reject);
        }
        if (table === 'app_settings') {
          if (settingsError) return Promise.resolve({ data: null, error: settingsError }).then(resolve, reject);
          const key = (st.eq.find(([c]) => c === 'key') || [])[1];
          return Promise.resolve({ data: key in settings ? [{ key, value: settings[key] }] : [], error: null }).then(resolve, reject);
        }
        if (table === 'quiz_questions') return Promise.resolve({ data: [question()], error: null }).then(resolve, reject);
        if (table === 'quizzes' && st.head) {
          counts.push(st.orText || st.eq.map(([c, v]) => `${c}=${v}`).join('&'));
          return Promise.resolve({ count: quizzes.filter(matches).length, data: null, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: quizzes.filter(matches), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from, counts };
}

// The quiz being recorded (in the one voice, so into meta.web_one), one quiz recorded today in the old slot and one
// recorded today in the one voice: two quizzes recorded today, one of them only in web_one.
const world = ({ mine = {} } = {}) => [
  { id: QUIZ, language: 'en', meta: { web: { arm: 'web' }, ...mine } },
  { id: 'old-slot', language: 'en', meta: { web: { audio_day: TODAY } } },
  { id: 'one-slot', language: 'en', meta: { web_one: { audio_day: TODAY } } },
];
const CAP2 = { web_quiz_audio_daily_cap: 2 };

beforeEach(() => {
  tts.synthesize.mockClear();
  mockLogEvent.mockReset();
  Store.resetSettingsCache();
  CapOne._resetCache();
});

describe('switch on: one-voice recordings are counted by the daily cap', () => {
  test('a quiz recorded only in the one voice today counts: at the cap, nothing is recorded', async () => {
    const db = fakeDb({ quizzes: world(), settings: { ...CAP2, web_quiz_audio_cap_one: true } });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: true });
    expect(out).toEqual(expect.objectContaining({ ok: false, reason: 'capped' }));
    expect(tts.synthesize).not.toHaveBeenCalled();
    expect(db.counts).toEqual([`meta->web->>audio_day.eq.${TODAY},meta->web_one->>audio_day.eq.${TODAY}`]);
    expect(mockLogEvent).toHaveBeenCalledWith('web_quiz_audio.capped', expect.objectContaining({ quizId: QUIZ, cap: 2, recordedToday: 2 }));
  });

  test('a recording in the old voice is capped by one-voice recordings too', async () => {
    const db = fakeDb({ quizzes: world(), settings: { ...CAP2, web_quiz_audio_cap_one: true } });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: null });
    expect(out.reason).toBe('capped');
    expect(tts.synthesize).not.toHaveBeenCalled();
  });

  test('under the cap it records and stamps its own slot, so the next count sees it', async () => {
    const quizzes = world();
    const db = fakeDb({ quizzes, settings: { web_quiz_audio_daily_cap: 3, web_quiz_audio_cap_one: true } });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: true });
    expect(out.synthesized).toBeGreaterThan(0);
    expect(quizzes[0].meta.web_one.audio_day).toBe(TODAY);
  });

  test('a quiz already stamped today in its slot finishes its recording at the cap (it is counted already)', async () => {
    const quizzes = world({ mine: { web_one: { audio_day: TODAY, audio: {} } } });
    const db = fakeDb({ quizzes, settings: { ...CAP2, web_quiz_audio_cap_one: true } });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: true });
    expect(out.reason).toBeUndefined();
    expect(out.synthesized).toBeGreaterThan(0);
  });

  test('a quiz stamped today in the OTHER slot is a new recording: still capped', async () => {
    const quizzes = world({ mine: { web: { arm: 'web', audio_day: TODAY } } });
    const db = fakeDb({ quizzes, settings: { ...CAP2, web_quiz_audio_cap_one: true } });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: true });
    expect(out.reason).toBe('capped');
  });

  test('the job: a capped one-voice quiz is not queued again', async () => {
    const db = fakeDb({ quizzes: world(), settings: { ...CAP2, web_quiz_audio_cap_one: true, web_quiz_one_voice: true } });
    const queue = { queueJob: jest.fn() };
    const out = await Publish.runQuizAudioJob({ quizId: QUIZ }, { db, queue, publish: (id, o) => Publish.publishQuizAudio(id, { ...o, db, oneVoice: true }) });
    expect(out.reason).toBe('capped');
    expect(queue.queueJob).not.toHaveBeenCalled();
  });
});

describe('switch off: the count is exactly today\'s', () => {
  test.each([
    ['absent', {}],
    ['false', { web_quiz_audio_cap_one: false }],
    ['the string "true"', { web_quiz_audio_cap_one: 'true' }],
  ])('%s: one-voice recordings are not counted and the old-slot count is the only count', async (_n, flag) => {
    const quizzes = world({ mine: { web_one: { audio_day: TODAY } } });
    const db = fakeDb({ quizzes, settings: { ...CAP2, ...flag } });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: true });
    expect(out.reason).toBeUndefined();
    expect(out.synthesized).toBeGreaterThan(0);
    expect(db.counts).toEqual([`meta->web->>audio_day=${TODAY}`]);
  });

  test('off, at the cap in the old slot: capped exactly as today, even for a quiz stamped today', async () => {
    const quizzes = [...world({ mine: { web_one: { audio_day: TODAY } } }), { id: 'old-2', meta: { web: { audio_day: TODAY } } }];
    const db = fakeDb({ quizzes, settings: CAP2 });
    const out = await Publish.publishQuizAudio(QUIZ, { db, oneVoice: true });
    expect(out.reason).toBe('capped');
    expect(db.counts).toEqual([`meta->web->>audio_day=${TODAY}`]);
  });

  test('a failed read of the switch is off', async () => {
    expect(await CapOne.on({ db: fakeDb({ quizzes: [], settingsError: { message: 'down' } }) })).toBe(false);
  });
});
