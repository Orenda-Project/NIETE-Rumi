'use strict';
/**
 * The scorecard card's door lines (door_shown / door_tap with door 'card', events v2 on) carry the child's key from
 * the quiz session. The card's events leave the page before Play, so the batch has no hub token or chip; it does
 * carry the quiz session's signed token (`st`). The relay then:
 *   - verifies `st` with the telemetry's own verifier, reads that ONE session's student (one bounded read per
 *     batch, only when a card door line needs it), folds it to the canonical child (merges followed), and writes
 *     kid = K.kid(canonical) on the card door lines; dk is unchanged;
 *   - a forged, expired or missing `st`, an unknown session, a session with no student, or a failed read: kid null,
 *     dk as today, the batch never refused, nothing thrown;
 *   - a hub token + chip still win; hub door lines and every non-door line are today's bytes;
 *   - events v2 off: every logged event is today's, and nothing is read;
 *   - the share code, the session id and the device hash never ride a door line; the session token, the session id
 *     and the student id are never logged.
 * Faked boundaries only: Supabase, the logger transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const logger = require('../../../shared/utils/logger');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const Tel = require('../../../shared/services/quiz/web-quiz-telemetry');
const Hub = require('../../../shared/services/quiz/web-quiz-hub-flags');
const IdFlags = require('../../../shared/services/quiz/web-quiz-identity-flags');
const Svc = require('../../../shared/services/quiz/web-quiz.service');

const KID = '55555555-5555-4555-8555-000000000001';    // the roster child (canonical)
const LOOSE = '55555555-5555-4555-8555-000000000002';  // a loose record merged into KID
const HUBKID = '55555555-5555-4555-8555-000000000003'; // a child picked on the hub
const SID = '77777777-7777-4777-8777-000000000001';
const SID_LOOSE = '77777777-7777-4777-8777-000000000002';
const SID_NOKID = '77777777-7777-4777-8777-000000000003';
const SID_UNKNOWN = '77777777-7777-4777-8777-000000000009';
const DEV = 'CCCCCCCCCCCCCCCCCCCCCC';
const DR = 'DDDDDDDDDDDDDDDDDDDDDD';
const CODE = 'TSTC42';

let fake;
function seed({ v2 = true, broken = false } = {}) {
  const db = {
    app_settings: [
      { key: 'web_quiz_hub', value: 'true' },
      { key: 'web_quiz_identity_canon', value: 'true' },
      ...(v2 ? [{ key: 'web_quiz_events_v2', value: true }] : []),
    ],
    quiz_sessions: [
      { id: SID, student_id: KID, share_code_id: 'sc-1', device_ref: DR },
      { id: SID_LOOSE, student_id: LOOSE, share_code_id: 'sc-1', device_ref: DR },
      { id: SID_NOKID, student_id: null, share_code_id: 'sc-1', device_ref: DR },
    ],
    students: [
      { id: KID, list_id: null, merged_into: null, status: 'active' },
      { id: LOOSE, list_id: null, merged_into: KID, status: 'merged' },
    ],
    class_enrollments: [],
  };
  fake = makeFake(db);
  const from = broken ? (t) => (t === 'quiz_sessions' ? (() => { throw new Error('db down'); })() : fake.from(t)) : fake.from;
  Object.assign(supabase, { from, rpc: fake.rpc });
}
async function flags(opts) {
  seed(opts);
  Hub._resetCache();
  IdFlags._resetCache();
  await Hub.flags();
}

const lines = () => logEvent.mock.calls.map((c) => ({ name: c[0], props: c[1] }));
const named = (n) => lines().filter((l) => l.name === n).map((l) => l.props);
const sessionReads = () => fake.calls.filter((c) => c.table === 'quiz_sessions').length;
const st = (sessionId) => T.signSession({ sessionId, deviceRef: DR, shareCodeId: 'sc-1' });
const now = () => Math.floor(Date.now() / 1000);
// The relay answers the page at once; the card's door lines follow the session read. Wait for both to be logged.
async function settle(n = 2) {
  for (let i = 0; i < 200; i += 1) {
    if (named('web_quiz.door_shown').length + named('web_quiz.door_tap').length >= n) break;
    await new Promise((r) => setImmediate(r));
  }
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
}

// The scorecard's batch as the page sends it before Play: {dr, events, ps, st}; no hub token, no chip.
const CARD_EVENTS = [
  { n: 'card_view', friend: 0 },
  { n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1, code: CODE },
  { n: 'door_tap', door: 'card', surface: 'scorecard', slot: 1, code: CODE },
];
const cardBatch = (extra = {}) => ({ dr: DR, events: CARD_EVENTS.map((e) => ({ ...e })), ps: 'ps-1', st: st(SID), ...extra });
const doorLine = (kid) => ({ w: 'p', ev_v: 2, kid_v: '2026', kid, door: 'card', surface: 'scorecard', slot: 1, dk: K.dk(DEV) });

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'card-door-kid-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-fedcba9876543210fedcba98765';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  K._reset();
  Tel._set(false);
  await flags();
});

describe('the scorecard card\'s door lines carry the quiz session\'s child (events v2 on)', () => {
  test('the card batch before Play: kid = the session child\'s key on both door lines, dk unchanged', async () => {
    expect(Svc.events(cardBatch(), { device: DEV })).toEqual({ logged: 3 });
    await settle();
    expect(named('web_quiz.door_shown')).toEqual([doorLine(K.kid(KID))]);
    expect(named('web_quiz.door_tap')).toEqual([doorLine(K.kid(KID))]);
    expect(K.kid(KID)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('a session whose student was merged: kid is the canonical child\'s, never the merged record\'s', async () => {
    Svc.events(cardBatch({ st: st(SID_LOOSE) }), { device: DEV });
    await settle();
    for (const d of [...named('web_quiz.door_shown'), ...named('web_quiz.door_tap')]) {
      expect(d.kid).toBe(K.kid(KID));
      expect(d.kid).not.toBe(K.kid(LOOSE));
    }
  });

  test('one session read per batch, by id, whatever the number of card door lines', async () => {
    const ev = [...CARD_EVENTS, { n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1 }, { n: 'door_tap', door: 'card', surface: 'scorecard', slot: 1 }];
    Svc.events(cardBatch({ events: ev }), { device: DEV });
    await settle(4);
    expect(sessionReads()).toBe(1);
    expect([...named('web_quiz.door_shown'), ...named('web_quiz.door_tap')].map((d) => d.kid)).toEqual(Array(4).fill(K.kid(KID)));
  });

  test('no card door line in the batch: nothing is read', async () => {
    Svc.events({ dr: DR, events: [{ n: 'card_view', friend: 0 }, { n: 'door_tap', door: 'hub_first', surface: 'hub', slot: 1 }], st: st(SID) }, { device: DEV });
    await settle(1);
    expect(sessionReads()).toBe(0);
  });
});

describe('golden: what stays today\'s', () => {
  test('events v2 off: every logged line is today\'s and nothing is read', async () => {
    await flags({ v2: false });
    expect(Svc.events(cardBatch(), { device: DEV })).toEqual({ logged: 3 });
    await settle();
    // today's v2-off lines for this batch (the door names carry only what v1 admits)
    expect(JSON.stringify(lines())).toBe(JSON.stringify([
      { name: 'web_quiz.card_view', props: { friend: 0 } },
      { name: 'web_quiz.door_shown', props: { code: CODE } },
      { name: 'web_quiz.door_tap', props: { code: CODE } },
    ]));
    expect(sessionReads()).toBe(0);
  });

  test('a hub token + chip still win: the picked child\'s kid, no session read', async () => {
    Svc.events(cardBatch({ ht: T.signHub([HUBKID]), chip: T.chipId('h', HUBKID) }), { device: DEV });
    expect(named('web_quiz.door_shown')).toEqual([doorLine(K.kid(HUBKID))]);
    expect(named('web_quiz.door_tap')).toEqual([doorLine(K.kid(HUBKID))]);
    await settle();
    expect(sessionReads()).toBe(0);
  });

  test('a forged, expired, wrong-kind or missing session token: kid null, dk as today, at once, nothing read', async () => {
    const real = st(SID);
    const forged = `${real.slice(0, real.indexOf('.'))}.${'A'.repeat(22)}`;
    const expired = T.sign({ k: 's', sid: SID, exp: now() - 60 });
    const hub = T.signHub([KID]);
    for (const tok of [forged, expired, hub, 'junk', 42, null, undefined]) {
      logEvent.mockClear();
      const body = cardBatch({ st: tok });
      if (tok === undefined) delete body.st;
      expect(Svc.events(body, { device: DEV })).toEqual({ logged: 3 });
      // today's bytes, logged in the same call (no read, nothing deferred)
      expect(named('web_quiz.door_shown')).toEqual([doorLine(null)]);
      expect(named('web_quiz.door_tap')).toEqual([doorLine(null)]);
    }
    await settle();
    expect(sessionReads()).toBe(0);
  });

  test('an unknown session, a session with no student, a failed read: kid null, nothing refused, no throw', async () => {
    for (const [sid, broken] of [[SID_UNKNOWN, false], [SID_NOKID, false], [SID, true]]) {
      await flags({ broken });
      logEvent.mockClear();
      expect(Svc.events(cardBatch({ st: st(sid) }), { device: DEV })).toEqual({ logged: 3 });
      await settle();
      expect(named('web_quiz.door_shown')).toEqual([doorLine(null)]);
      expect(named('web_quiz.door_tap')).toEqual([doorLine(null)]);
    }
  });

  test('non-door lines in the card batch are today\'s bytes, logged at once, with no kid', async () => {
    for (const rich of [false, true]) {
      Tel._set(rich);
      logEvent.mockClear();
      Svc.events(cardBatch({ st: undefined }), { device: DEV });
      const before = JSON.stringify(lines().filter((l) => l.name === 'web_quiz.card_view'));
      logEvent.mockClear();
      Svc.events(cardBatch(), { device: DEV });
      const view = lines().filter((l) => l.name === 'web_quiz.card_view');
      if (!rich) expect(JSON.stringify(view)).toBe(before);
      else expect(view[0].props.sid).toBe(SID); // today's rich ids still ride the non-door lines
      expect(view[0].props).not.toHaveProperty('kid');
      await settle();
    }
  });

  test('hub door lines in a batch with a session token are today\'s bytes', async () => {
    const hubTap = { n: 'door_tap', door: 'hub_first', surface: 'hub', slot: 2 };
    Svc.events({ events: [{ ...hubTap }] }, { device: DEV });
    const before = JSON.stringify(named('web_quiz.door_tap'));
    logEvent.mockClear();
    Svc.events(cardBatch({ events: [...CARD_EVENTS, { ...hubTap }] }), { device: DEV });
    await settle(3);
    expect(JSON.stringify(named('web_quiz.door_tap').filter((d) => d.door === 'hub_first'))).toBe(before);
    expect(JSON.parse(before)[0].kid).toBeNull();
  });

  test('code, sid and dh never ride a door line; the session token, session id and student id are never logged', async () => {
    Tel._set(true);
    const tok = st(SID_LOOSE);
    Svc.events(cardBatch({ st: tok }), { device: DEV });
    await settle();
    for (const d of [...named('web_quiz.door_shown'), ...named('web_quiz.door_tap')]) {
      for (const k of ['code', 'code_h', 'sid', 'dh', 'dr', 'st', 'ps', 'ht', 'chip']) expect(d).not.toHaveProperty(k);
      expect(d.kid).toBe(K.kid(KID));
    }
    const doorsOnly = JSON.stringify([...named('web_quiz.door_shown'), ...named('web_quiz.door_tap')]);
    for (const secret of [tok, SID_LOOSE, LOOSE, KID]) expect(doorsOnly).not.toContain(secret);
    const all = JSON.stringify([logEvent.mock.calls, logger.logToFile.mock.calls, logger.logError.mock.calls, logger.logWarn.mock.calls, logger.logInfo.mock.calls]);
    for (const secret of [tok, LOOSE, KID]) expect(all).not.toContain(secret);
  });
});
