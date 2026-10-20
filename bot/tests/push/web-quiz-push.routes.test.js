'use strict';
/**
 * The reminder push's internal router at /api/internal/wqpush (portal → bot, x-api-key): every route 404 {off:true}
 * while web_quiz_push_remind is off; the mount line in first-touch/mounts.js; the finish field; the worker's tick.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Push = require('../../shared/services/push/web-quiz-push.service');
const { mountPushRemind, MOUNT_PATH } = require('../../shared/services/first-touch/push-remind.mount');
const { pushField } = require('../../shared/services/push/web-quiz-push-field');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPubKey', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt',
};
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } };
let fake;
let srv;
let base;
function settings(s) {
  fake = makeFake({ app_settings: Object.entries(s).map(([key, value]) => ({ key, value })), web_quiz_push_subscriptions: [] });
  supabase.from = (t) => fake.from(t);
  Push.__reset();
}
const call = (method, p, body, headers = {}) => fetch(`${base}${MOUNT_PATH}${p}`, {
  method, headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
});

beforeAll(async () => {
  Object.assign(process.env, ENV);
  const app = express();
  expect(mountPushRemind(app, () => { throw new Error('broken at load'); })).toBe(false);
  expect(mountPushRemind(app)).toBe(true);
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());

test('the mount is a line in the first-touch list, at /api/internal/wqpush', () => {
  expect(MOUNT_PATH).toBe('/api/internal/wqpush');
  expect(require('../../shared/services/first-touch/mounts').some(([n, f, m]) => n === 'push-remind' && f === 'push-remind.mount' && m === 'mountPushRemind')).toBe(true);
});

test('off: every route answers 404 {off:true}', async () => {
  settings({});
  for (const [m, p] of [['GET', '/state'], ['GET', '/key'], ['POST', '/subscribe'], ['POST', '/unsubscribe'], ['POST', '/opened'], ['POST', '/test'], ['POST', '/e']]) {
    const r = await call(m, p, m === 'POST' ? {} : null);
    expect([p, r.status]).toEqual([p, 404]);
    expect(await r.json()).toEqual({ off: true });
  }
});

test('without the internal key: 401', async () => {
  settings({ web_quiz_push_remind: true });
  const r = await fetch(`${base}${MOUNT_PATH}/state`);
  expect(r.status).toBe(401);
});

test('on: state, key, subscribe (device from x-wq-device), test off, unsubscribe, e', async () => {
  settings({ web_quiz_push_remind: true });
  expect(await (await call('GET', '/state')).json()).toEqual({ remind: true, test: false, portal: false });
  expect(await (await call('GET', '/key')).json()).toEqual({ key: 'BPubKey' });
  const s = await call('POST', '/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1 }, { 'x-wq-device': 'AAAAAAAAAAAAAAAAAAAAAA', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130' });
  expect([s.status, await s.json()]).toEqual([200, { ok: 1 }]);
  expect(fake.db.web_quiz_push_subscriptions[0]).toMatchObject({ device_ref: 'AAAAAAAAAAAAAAAAAAAAAA', ua_class: 'chrome_android', quiz_code: 'ABC123' });
  expect((await call('POST', '/subscribe', { sub: SUB, chips: 5 })).status).toBe(409);
  expect((await call('POST', '/subscribe', { sub: { endpoint: 'http://x' } })).status).toBe(400);
  expect((await call('POST', '/test', { endpoint: SUB.endpoint })).status).toBe(404);
  // with the test switch on, a sent test answers 200 and the service's body (its push status is data, not the HTTP code)
  settings({ web_quiz_push_remind: true, web_quiz_push_test: true });
  await call('POST', '/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1 }, { 'x-wq-device': 'AAAAAAAAAAAAAAAAAAAAAA' });
  const webpush = require('web-push');
  const spy = jest.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201 });
  const t = await call('POST', '/test', { endpoint: SUB.endpoint });
  expect([t.status, await t.json()]).toEqual([200, { ok: 1, sent: 1, status: 201 }]);
  spy.mockRestore();
  settings({ web_quiz_push_remind: true });
  await call('POST', '/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1 }, { 'x-wq-device': 'AAAAAAAAAAAAAAAAAAAAAA' });
  expect(await (await call('POST', '/opened', { endpoint: SUB.endpoint })).json()).toEqual({ ok: 1 });
  expect(await (await call('POST', '/unsubscribe', { endpoint: SUB.endpoint, by: 'page' })).json()).toEqual({ ok: 1 });
  expect(fake.db.web_quiz_push_subscriptions[0].revoked_by).toBe('page');
  expect((await call('POST', '/e', { step: 'shown' })).status).toBe(200);
  expect((await call('POST', '/e', { step: 'nope' })).status).toBe(400);
});

test('state says portal:true only while portal_push_remind is on too; /portal/* 404 without it', async () => {
  settings({ web_quiz_push_remind: true, portal_push_remind: true, web_quiz_push_test: true });
  expect(await (await call('GET', '/state')).json()).toEqual({ remind: true, test: true, portal: true });
  settings({ web_quiz_push_remind: true, web_quiz_push_test: true });
  expect(await (await call('GET', '/state')).json()).toEqual({ remind: true, test: true, portal: false });
  expect((await call('POST', '/portal/subscribe', { sub: SUB, lang: 'en' })).status).toBe(404);
});

test('the finish field rides the hub switches\' cache: {} cold, off, or without env; {push_remind:true} on', async () => {
  const HubFlags = require('../../shared/services/quiz/web-quiz-hub-flags');
  settings({ web_quiz_push_remind: true });
  HubFlags._resetCache();
  expect(pushField()).toEqual({}); // cold cache: no read of its own, no card
  const before = fake.calls.length;
  await HubFlags.flags(Date.now() + 10 * 60 * 1000);
  expect(fake.calls.length).toBe(before + 1); // the hub's one read (the page boot makes it)
  expect(pushField()).toEqual({ push_remind: true });
  expect(fake.calls.length).toBe(before + 1); // the field itself never reads
  const salt = process.env.WQ_PUSH_HASH_SALT;
  delete process.env.WQ_PUSH_HASH_SALT;
  expect(pushField()).toEqual({});
  process.env.WQ_PUSH_HASH_SALT = salt;
  settings({});
  await HubFlags.flags(Date.now() + 20 * 60 * 1000);
  expect(pushField()).toEqual({});
});

test('the worker schedules the due tick behind WEB_QUIZ_PUSH_SEND_ENABLED and the expiry tick ungated', async () => {
  const { schedulePushTicks } = require('../../workers/push-ticks');
  const intervals = [];
  const timeouts = [];
  const due = jest.fn(async () => ({}));
  const expire = jest.fn(async () => ({}));
  let env = true;
  schedulePushTicks({ setIntervalFn: (fn, ms) => intervals.push([fn, ms]), setTimeoutFn: (fn, ms) => { timeouts.push([fn, ms]); }, dueTick: due, expireTick: expire, envReady: () => env });
  for (const [fn] of timeouts) await fn();
  delete process.env.WEB_QUIZ_PUSH_SEND_ENABLED;
  for (const [fn] of intervals) await fn();
  expect(due).not.toHaveBeenCalled();
  expect(expire).toHaveBeenCalled();
  process.env.WEB_QUIZ_PUSH_SEND_ENABLED = '1';
  for (const [fn] of intervals) await fn();
  expect(due).toHaveBeenCalled();
  expect(intervals.map(([, ms]) => ms).sort((a, b) => a - b)).toEqual([60 * 1000, 6 * 60 * 60 * 1000]);
  // a tier without the push env (and so without the table) is inert: the expiry tick does nothing
  env = false;
  expire.mockClear();
  for (const [fn] of intervals) await fn();
  expect(expire).not.toHaveBeenCalled();
  const src = fs.readFileSync(path.join(__dirname, '../../workers/sqs-worker.js'), 'utf8');
  expect(src).toMatch(/require\('\.\/push-ticks'\)\.schedulePushTicks\(/);
});
