'use strict';
/**
 * Golden: with app_settings `web_quiz_events_v2` off (absent, false, or its parent `web_quiz_hub` off), every
 * existing event name and payload on the paths the events v2 work touches is byte-identical to before it:
 *   - the page relay: cleanEvent over a corpus of page events, and events() over a batch longer than 20
 *   - the server copy of web_quiz.ch_start (web-quiz-challenge.js exercise())
 *   - web_quiz.hub_open, picked and unpicked (web-quiz-hub.js hubPayload())
 * The snapshot was written by this file against the code BEFORE the change (origin/sandbox) and is committed;
 * the change must keep matching it. Supabase, Redis and the logger transport are the faked boundaries.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true), sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true), sendCtaUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Svc = require('../../../shared/services/quiz/web-quiz.service');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// The page events the relay sees today, including the ones the change reads differently with v2 on.
const CORPUS = [
  { n: 'ch_helped', v: 0 }, { n: 'ch_helped', v: 1 }, { n: 'ch_helped', v: 'self' }, { n: 'ch_helped', v: 'helped' },
  { n: 'ch_helped', v: 'not_asked' }, { n: 'ch_helped', v: 'a1' },
  { n: 'invite_ask', v: 'a0', who: 'cousin' }, { n: 'invite_ask', v: 'a1' }, { n: 'invite_ask', v: 'self' },
  { n: 'page_open', code: 'ABCD12', ua: 'Mozilla/5.0 WA4A/2.24', iab: true },
  { n: 'share', path: 'wa', to: 'WXYZ99', cap: 'native', band: 'mid', via: 'card' },
  { n: 'answer', qid: '0f0f0f0f-aaaa', ok: 1, ms: 1234, i: 3, slot: 'B', count: 9 },
  { n: 'error', err: 'TypeError: Cannot read properties of null (reading \'x\') https://x.test/a', src: 'err', file: 'wq.js' },
  { n: 'hub_view', src: 'home', step: 'tile', lang: 'ur', kid: 'f000000000000001', device_ref: DEV, dh: 'abc' },
  { n: 'probe', probe: { ls: true, share: 'yes', nested: { a: 1 } } },
  { n: 'page_start', ps: 'abcdefgh12' }, { n: 'Bad Name' }, null,
];

let db;
function seed() {
  db = {
    app_settings: [{ key: 'web_quiz_hub', value: 'true' }, { key: 'web_quiz_challenge', value: true }],
    students: [
      { id: KID, student_name: 'Sana Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '923001112223' },
      { id: SIB, student_name: 'Bilal Testwala', student_name_urdu: null, self_reported_class: '5', list_id: null, is_active: true, phone: '923001112223' },
    ],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [], quiz_share_codes: [], quiz_sessions: [], student_videos: [], web_quiz_challenge_runs: [],
  };
  Object.assign(supabase, makeFake(db));
}

const events = (name) => logEvent.mock.calls.filter((c) => c[0] === name).map((c) => JSON.parse(JSON.stringify(c[1]).replace(UUID_RX, '<uuid>')));
const allNames = () => logEvent.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'golden-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'k'.repeat(48);
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  Hub._resetCache();
  Ch.__reset();
  require('../../../shared/services/cache/railway-redis.service')._store.clear();
  seed();
});

// Each case runs with the switch absent, false, and true under a parent that is off: all three are "off".
const OFF = [
  ['absent', () => {}],
  ['false', () => db.app_settings.push({ key: 'web_quiz_events_v2', value: false })],
  ['parent off', () => { db.app_settings = db.app_settings.filter((r) => r.key !== 'web_quiz_hub'); db.app_settings.push({ key: 'web_quiz_events_v2', value: true }); }],
];

describe('web_quiz_events_v2 off: the page relay is byte-identical', () => {
  test.each(OFF)('cleanEvent over the corpus (%s)', (_label, setup) => {
    setup();
    expect(CORPUS.map((e) => Svc.cleanEvent(e))).toMatchSnapshot();
  });

  test.each(OFF)('events() with 23 events logs the first 20 and nothing else (%s)', async (_label, setup) => {
    setup();
    await Hub.flags();
    const batch = Array.from({ length: 23 }, (_, i) => ({ n: 'answer', i, ok: i % 2 }));
    expect(Svc.events({ events: batch })).toEqual({ logged: 20 });
    expect(allNames()).toEqual(Array(20).fill('web_quiz.answer'));
    expect(events('web_quiz.answer')).toMatchSnapshot();
  });
});

describe('web_quiz_events_v2 off: the server copies are byte-identical', () => {
  test.each(OFF)('web_quiz.ch_start (%s)', async (_label, setup) => {
    setup();
    await Ch.exercise(T.signHub([KID]), 'bigger', { device: DEV });
    expect(events('web_quiz.ch_start')).toMatchSnapshot();
  });

  test('web_quiz.hub_open, picked and unpicked (switch absent)', async () => {
    await Hub.hub(T.signHub([KID]), { device: DEV });
    await Hub.hub(T.signHub([KID, SIB]), { device: DEV });
    expect(events('web_quiz.hub_open')).toMatchSnapshot();
  });

  test('web_quiz.hub_open, picked and unpicked (switch false)', async () => {
    db.app_settings.push({ key: 'web_quiz_events_v2', value: false });
    await Hub.hub(T.signHub([KID]), { device: DEV });
    await Hub.hub(T.signHub([KID, SIB]), { device: DEV });
    expect(events('web_quiz.hub_open')).toMatchSnapshot();
  });
});
