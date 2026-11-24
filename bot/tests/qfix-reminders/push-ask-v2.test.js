'use strict';
/**
 * The ask's second wording (app_settings web_quiz_push_ask_v2; no row = off): while it is on, GET /key also answers
 * ask_v, the arm this phone sees — 'b' when the phone's device hash (sha256('wqd|' + wq_dv), 16 hex, the same `dh` the
 * portal logs) ends in an odd hex digit, else 'a'; no or a malformed device ref → 'a'. Only where the ask is offered
 * (inside the canary); outside it, and with the switch off, the answer is exactly as before. remind_step keeps ask_v
 * ('a' | 'b') on any step. Supabase (in-memory) is the faked boundary; invented ids.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));

const crypto = require('crypto');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const Push = require('../../shared/services/push/web-quiz-push.service');
const { mountPushRemind, MOUNT_PATH } = require('../../shared/services/first-touch/push-remind.mount');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const S_IN = 'aaaaaaaa-0000-4000-8000-000000000001';
const S_OUT = 'aaaaaaaa-0000-4000-8000-000000000002';
const C_IN = 'cccccccc-0000-4000-8000-000000000001';
const C_OUT = 'cccccccc-0000-4000-8000-000000000002';
const dh = (ref) => crypto.createHash('sha256').update(`wqd|${ref}`).digest('hex').slice(0, 16);
// two well-formed refs (22 chars of [A-Za-z0-9_-]) whose dh ends odd / even
const refWhere = (odd) => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    const ref = `QfixAskVariantRef0000${ch}`;
    if ((parseInt(dh(ref).slice(-1), 16) % 2 === 1) === odd) return ref;
  }
  throw new Error('no ref');
};
const ODD = refWhere(true);
const EVEN = refWhere(false);

function setup(opts = {}) {
  const v2 = 'v2' in opts ? opts.v2 : true; // { v2: undefined } = no row
  const { canary } = opts;
  const settings = [{ key: 'web_quiz_push_remind', value: true }];
  if (v2 !== undefined) settings.push({ key: 'web_quiz_push_ask_v2', value: v2 });
  if (canary !== undefined) settings.push({ key: 'web_quiz_push_canary', value: canary });
  const fake = makeFake({
    app_settings: settings, web_quiz_push_subscriptions: [],
    classes: [{ id: C_IN, school_id: S_IN }, { id: C_OUT, school_id: S_OUT }],
    schools: [{ id: S_IN, region: 'Tarnol' }, { id: S_OUT, region: 'Sihala' }],
    quiz_share_codes: [{ id: 'q1', code: 'INSCH1', class_id: C_IN }, { id: 'q2', code: 'OUTSC1', class_id: C_OUT }],
  });
  supabase.from = (t) => fake.from(t);
  Object.assign(process.env, ENV);
  Push.__reset();
  logEvent.mockClear();
  return fake;
}

describe('keyFor: the arm', () => {
  test('the refs really differ in parity (the test is not vacuous)', () => {
    expect(parseInt(dh(ODD).slice(-1), 16) % 2).toBe(1);
    expect(parseInt(dh(EVEN).slice(-1), 16) % 2).toBe(0);
  });
  test('switch on, no canary row: odd dh → b, even → a, no device → a, malformed → a', async () => {
    setup();
    expect(await Push.keyFor({ code: 'INSCH1', device: ODD })).toEqual({ key: 'BPub', ask: true, ask_v: 'b' });
    expect(await Push.keyFor({ code: 'INSCH1', device: EVEN })).toEqual({ key: 'BPub', ask: true, ask_v: 'a' });
    expect(await Push.keyFor({ code: 'INSCH1' })).toEqual({ key: 'BPub', ask: true, ask_v: 'a' });
    expect(await Push.keyFor({ code: 'INSCH1', device: 'short' })).toEqual({ key: 'BPub', ask: true, ask_v: 'a' });
    expect(await Push.keyFor({ code: 'INSCH1', device: `${ODD};x` })).toEqual({ key: 'BPub', ask: true, ask_v: 'a' });
  });
  test.each([['no row', undefined], ['false', false], ['a string "true"', 'true']])('switch %s: exactly today\'s answer', async (_n, v2) => {
    setup({ v2 });
    expect(await Push.keyFor({ code: 'INSCH1', device: ODD })).toEqual({ key: 'BPub', ask: true });
  });
  test('inside the canary the arm is given; outside it the answer is exactly today\'s', async () => {
    setup({ canary: { school_ids: [S_IN] } });
    expect(await Push.keyFor({ code: 'INSCH1', device: ODD })).toEqual({ key: 'BPub', ask: true, ask_v: 'b' });
    expect(await Push.keyFor({ code: 'OUTSC1', device: ODD })).toEqual({ key: 'BPub', ask: false });
  });
  test('switches() keeps today\'s shape with the switch off', async () => {
    setup({ v2: undefined });
    expect(await Push.switches()).toEqual({ remind: true, test: false, portal: false, names: false });
  });
});

describe('the routes', () => {
  let srv;
  let base;
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
    Object.assign(process.env, ENV);
    const app = express();
    expect(mountPushRemind(app)).toBe(true);
    srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  afterAll(() => srv && srv.close());
  const get = (path, h = {}) => fetch(`${base}${MOUNT_PATH}${path}`, { headers: { 'x-api-key': process.env.INTERNAL_API_KEY, ...h } });
  const step = (b) => fetch(`${base}${MOUNT_PATH}/e`, {
    method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(b),
  });
  const logged = () => logEvent.mock.calls.filter(([e]) => e === 'web_quiz.remind_step').map(([, d]) => d);

  test('GET /key reads the phone from x-wq-device', async () => {
    setup();
    expect(await (await get('/key?code=INSCH1', { 'x-wq-device': ODD })).json()).toEqual({ key: 'BPub', ask: true, ask_v: 'b' });
    expect(await (await get('/key?code=INSCH1', { 'x-wq-device': EVEN })).json()).toEqual({ key: 'BPub', ask: true, ask_v: 'a' });
    expect(await (await get('/key?code=INSCH1')).json()).toEqual({ key: 'BPub', ask: true, ask_v: 'a' });
  });
  test.each(['shown', 'yes', 'later', 'denied', 'subscribed', 'gone', 'escape'])('%s keeps ask_v a | b', async (s) => {
    setup();
    for (const v of ['a', 'b']) {
      logEvent.mockClear();
      expect((await step({ step: s, lang: 'en', src: 'result', ask_v: v })).status).toBe(200);
      expect(logged()).toEqual([{ step: s, lang: 'en', src: 'result', ask_v: v }]);
    }
  });
  test.each([['c', 'c'], ['B', 'B'], ['true', true], ['an object', { v: 'b' }]])('ask_v %s is dropped', async (_n, v) => {
    setup();
    expect((await step({ step: 'shown', lang: 'en', src: 'result', ask_v: v })).status).toBe(200);
    expect(logged()).toEqual([{ step: 'shown', lang: 'en', src: 'result' }]);
  });
});
