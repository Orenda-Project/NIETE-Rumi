'use strict';
/**
 * The page relay's door events (door_shown / door_tap, events v2 on) carry the phone's key and the child's key:
 *   - dk from the batch request's device (x-wq-device, forwarded by the edge from the wq_dv cookie); the body's
 *     `dr` only when no device header came;
 *   - kid from the batch's signed hub token (`ht`) and the picked child's chip (`chip`): the token must be a
 *     genuine, unexpired hub token whose ids name that chip; anything else is kid:null, never a refused batch;
 *   - the share code, the session id and the unkeyed device hash never ride a door line;
 *   - the raw hub token and chip are never logged.
 * Every other event name is byte-identical to today's output.
 * Faked boundaries only: Supabase, the logger transport.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const logger = require('../../../shared/utils/logger');
const { logEvent } = require('../../../shared/utils/structured-logger');
const T = require('../../../shared/services/quiz/web-quiz-token');
const K = require('../../../shared/services/quiz/web-quiz-kid');
const Tel = require('../../../shared/services/quiz/web-quiz-telemetry');
const Hub = require('../../../shared/services/quiz/web-quiz-hub-flags');
const Svc = require('../../../shared/services/quiz/web-quiz.service');

const KID = '44444444-4444-4444-8444-000000000001';
const SIB = '44444444-4444-4444-8444-000000000002';
const OTHER = '44444444-4444-4444-8444-000000000009';
const SID = '66666666-6666-4666-8666-000000000001';
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const DR = 'BBBBBBBBBBBBBBBBBBBBBB';
const CODE = 'TSTQ42';

let db;
function seed(v2) {
  db = { app_settings: [{ key: 'web_quiz_hub', value: 'true' }, ...(v2 ? [{ key: 'web_quiz_events_v2', value: true }] : [])] };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}
async function v2(on) {
  seed(on);
  Hub._resetCache();
  await Hub.flags();
}

const lines = () => logEvent.mock.calls.map((c) => ({ name: c[0], props: c[1] }));
const named = (n) => lines().filter((l) => l.name === n).map((l) => l.props);
const chip = (id) => T.chipId('h', id);
const now = () => Math.floor(Date.now() / 1000);

// A batch as the scorecard and the hub send it: a page open, an answer, a card door shown and tapped.
const EVENTS = [
  { n: 'page_open', code: CODE, lang: 'en', ua: 'Mozilla/5.0 (Linux; Android 12) WA4A/2.24' },
  { n: 'answer', code: CODE, i: 3, ok: 1, ms: 1200 },
  { n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1, code: CODE },
  { n: 'door_tap', door: 'hub_first', surface: 'hub', slot: 2, code: CODE },
];
const batch = (extra = {}) => ({ events: EVENTS.map((e) => ({ ...e })), ...extra });

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'door-keys-test-secret';
  process.env.WEB_QUIZ_KID_KEY = 'test-only-kid-key-0123456789abcdef0123456789';
  process.env.WEB_QUIZ_KID_KEY_V = '2026';
  K._reset();
  Tel._set(false);
  await v2(true);
});

describe('door events: dk and kid (events v2 on)', () => {
  test('a genuine hub token + a chip it names + the device header: kid and dk set, no code/sid/dh', () => {
    Tel._set(true); // rich telemetry: the batch's sid / dh would ride every line
    const ht = T.signHub([KID, SIB]);
    const st = T.signSession({ sessionId: SID, deviceRef: DR, shareCodeId: 'sc-1' });
    Svc.events(batch({ ht, chip: chip(KID), st, dr: DR }), { device: DEV });
    const shown = named('web_quiz.door_shown');
    const tap = named('web_quiz.door_tap');
    expect(shown).toHaveLength(1);
    expect(tap).toHaveLength(1);
    for (const d of [...shown, ...tap]) {
      expect(d.kid).toBe(K.kid(KID));
      expect(d.kid).toMatch(/^[0-9a-f]{16}$/);
      expect(d.dk).toBe(K.dk(DEV)); // the header's device, not the body's dr
      expect(d.dk).not.toBe(K.dk(DR));
      expect(d.kid_v).toBe('2026');
      expect(d.ev_v).toBe(2);
      expect(d.w).toBe('p');
      for (const k of ['code', 'sid', 'dh', 'code_h', 'dr', 'ht', 'chip']) expect(d).not.toHaveProperty(k);
    }
    expect(shown[0]).toEqual({ w: 'p', ev_v: 2, kid_v: '2026', kid: K.kid(KID), door: 'card', surface: 'scorecard', slot: 1, dk: K.dk(DEV) });
  });

  test('the second child on the token: that child\'s kid', () => {
    Svc.events(batch({ ht: T.signHub([KID, SIB]), chip: chip(SIB) }), { device: DEV });
    expect(named('web_quiz.door_tap')[0].kid).toBe(K.kid(SIB));
  });

  test('no hub token, no chip (door_shown{card} before a child is picked): kid null, dk from the device', () => {
    Svc.events({ events: [{ n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1, code: CODE }] }, { device: DEV });
    expect(named('web_quiz.door_shown')).toEqual([{ w: 'p', ev_v: 2, kid_v: '2026', kid: null, door: 'card', surface: 'scorecard', slot: 1, dk: K.dk(DEV) }]);
  });

  test('a hub token without a chip: kid null', () => {
    Svc.events(batch({ ht: T.signHub([KID]) }), { device: DEV });
    expect(named('web_quiz.door_shown')[0].kid).toBeNull();
    expect(named('web_quiz.door_shown')[0].dk).toBe(K.dk(DEV));
  });

  test('no device header: dk from the body\'s dr; neither: dk null', () => {
    Svc.events({ events: [{ n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1 }], dr: DR });
    expect(named('web_quiz.door_shown')[0].dk).toBe(K.dk(DR));
    logEvent.mockClear();
    Svc.events({ events: [{ n: 'door_shown', door: 'card', surface: 'scorecard', slot: 1 }] });
    expect(named('web_quiz.door_shown')[0]).toEqual({ w: 'p', ev_v: 2, kid_v: '2026', kid: null, door: 'card', surface: 'scorecard', slot: 1, dk: null });
  });

  test('a forged, expired, card, guest, session or junk token: kid null, the batch still logged', () => {
    const real = T.signHub([KID]);
    const forged = `${real.slice(0, real.indexOf('.'))}.${'A'.repeat(22)}`;
    const expired = T.sign({ k: 'h', ids: [KID], exp: now() - 60 });
    const card = T.sign({ k: 'cd', ids: [KID], exp: now() + 3600 });
    const guest = T.signGuest({ phoneTomb: 'a'.repeat(32) });
    const session = T.signSession({ sessionId: SID, deviceRef: DR, shareCodeId: 'sc-1' });
    for (const ht of [forged, expired, card, guest, session, 'junk', 42, null, { ids: [KID] }]) {
      logEvent.mockClear();
      expect(Svc.events(batch({ ht, chip: chip(KID) }), { device: DEV })).toEqual({ logged: 4 });
      const d = named('web_quiz.door_tap');
      expect(d).toHaveLength(1);
      expect(d[0].kid).toBeNull();
      expect(d[0].dk).toBe(K.dk(DEV));
      expect(d[0]).not.toHaveProperty('code');
    }
  });

  test('a chip the token does not name: kid null', () => {
    for (const c of [chip(OTHER), T.chipId('sc-1', KID), 'not-a-chip', 7]) {
      logEvent.mockClear();
      Svc.events(batch({ ht: T.signHub([KID, SIB]), chip: c }), { device: DEV });
      expect(named('web_quiz.door_shown')[0].kid).toBeNull();
    }
  });

  test('the raw hub token and chip are never logged, on any line or in any log call', () => {
    Tel._set(true);
    const ht = T.signHub([KID, SIB]);
    const c = chip(SIB);
    const ev = [...EVENTS, { n: 'error', err: 'boom' }, { n: 'step', step: 'card_play' }];
    Svc.events({ events: ev, ht, chip: c, st: T.signSession({ sessionId: SID, deviceRef: DR, shareCodeId: 'sc-1' }) }, { device: DEV });
    Svc.events({ events: ev, ht: 'junk', chip: c }, { device: DEV });
    const all = JSON.stringify([logEvent.mock.calls, logger.logToFile.mock.calls, logger.logError.mock.calls, logger.logWarn.mock.calls, logger.logInfo.mock.calls]);
    expect(all).not.toContain(ht);
    expect(all).not.toContain(ht.slice(0, ht.indexOf('.')));
    expect(all).not.toContain(c);
  });
});

describe('golden: every other line is today\'s', () => {
  // Today's output for the non-door events of the batch (events v2 on, rich telemetry off).
  const TODAY = [
    { name: 'web_quiz.page_open', props: { code: CODE, lang: 'en', w: 'p', ua: 'Mozilla/5.0 (Linux; Android 12) WA4A/2.24', ua_app: 'whatsapp', iab: 1, code_h: expect.stringMatching(/^[0-9a-f]{12}$/) } },
    { name: 'web_quiz.answer', props: { code: CODE, w: 'p', ms: 1200, i: 3, ok: true } },
  ];
  const nonDoor = () => lines().filter((l) => !/door_(shown|tap)$/.test(l.name));

  test('no ht/chip and no device: the non-door lines are byte-identical to today\'s', () => {
    Svc.events(batch());
    expect(nonDoor()).toEqual(TODAY);
    expect(JSON.stringify(nonDoor().map((l) => Object.keys(l.props)))).toBe(JSON.stringify(TODAY.map((l) => Object.keys(l.props))));
  });

  test('with ht, chip and a device the non-door lines are the same bytes as without them (rich telemetry on and off)', () => {
    for (const rich of [false, true]) {
      Tel._set(rich);
      const st = T.signSession({ sessionId: SID, deviceRef: DR, shareCodeId: 'sc-1' });
      logEvent.mockClear();
      Svc.events(batch({ st, dr: DR }));
      const before = JSON.stringify(nonDoor());
      logEvent.mockClear();
      Svc.events(batch({ st, dr: DR, ht: T.signHub([KID]), chip: chip(KID) }), { device: DEV });
      expect(JSON.stringify(nonDoor())).toBe(before);
      if (rich) expect(JSON.parse(before)[0].props.sid).toBe(SID); // today's ids still ride the non-door lines
    }
  });

  test('a door line changes only by the envelope keys (kid, dk) and the stripped ids', () => {
    Tel._set(true);
    const st = T.signSession({ sessionId: SID, deviceRef: DR, shareCodeId: 'sc-1' });
    Svc.events(batch({ st, dr: DR, ht: T.signHub([KID]), chip: chip(KID) }), { device: DEV });
    const d = named('web_quiz.door_shown')[0];
    // today's door line: {code, w, door, surface, slot, sid, dh}
    const today = { code: CODE, w: 'p', door: 'card', surface: 'scorecard', slot: 1, sid: SID, dh: Tel.deviceHash(DR) };
    const { ev_v: _ev, kid_v: _kv, kid: _k, dk: _dk, ...rest } = d;
    const { code: _c, sid: _s, dh: _dh, ...todayKept } = today;
    expect(rest).toEqual(todayKept);
  });

  test('events v2 off: door lines are today\'s, untouched by ht/chip/device', async () => {
    await v2(false);
    Svc.events(batch());
    const before = JSON.stringify(lines());
    logEvent.mockClear();
    Svc.events(batch({ ht: T.signHub([KID]), chip: chip(KID) }), { device: DEV });
    expect(JSON.stringify(lines())).toBe(before);
    expect(named('web_quiz.door_shown')[0]).toEqual({ code: CODE }); // today's v2-off door line
  });
});

describe('the internal events route passes the edge\'s device header', () => {
  let server; let base;
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test('POST /e with x-wq-device: the door line carries that phone\'s dk and the picked child\'s kid', async () => {
    const body = { events: [{ n: 'door_tap', door: 'card', surface: 'scorecard', slot: 1, code: CODE }], ht: T.signHub([KID]), chip: chip(KID) };
    const r = await fetch(`${base}/e`, { method: 'POST', headers: { 'x-api-key': 'route-key', 'content-type': 'application/json', 'x-wq-device': DEV }, body: JSON.stringify(body) });
    expect(r.status).toBe(204);
    expect(named('web_quiz.door_tap')).toEqual([{ w: 'p', ev_v: 2, kid_v: '2026', kid: K.kid(KID), door: 'card', surface: 'scorecard', slot: 1, dk: K.dk(DEV) }]);
  });
});
