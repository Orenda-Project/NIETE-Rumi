'use strict';
/**
 * A QA walk marks its own reminder events on the server: when the phone's user agent (relayed by the portal on every
 * call) carries "QFIXQA", remind_step, push_subscribed, push_opened and push_delivered hold `qa: true`, so a funnel read
 * drops walks exactly, on every page that mounts the ask (the class link and the stop landing load no telemetry, so
 * they have no page session to join). Any other user agent, or none → the props are exactly what they were before.
 * Through the internal router (portal → bot) with a fake database. Invented values.
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
  WQ_PUSH_VAPID_PUBLIC: 'BPubKey', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt',
};
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/qa-test', keys: { p256dh: 'p', auth: 'a' } };
const UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130';
const QA_UA = `${UA} QFIXQA`;
// a phone, no header, a lookalike in lower case, a near miss: never a walk
const NOT_QA = [['a phone', UA], ['no user agent', undefined], ['lower case', `${UA} qfixqa`], ['a near miss', `${UA} QFIX QA`]];
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';

let fake;
let srv;
let base;
const call = (p, body, ua) => fetch(`${base}${MOUNT_PATH}${p}`, {
  method: 'POST',
  headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json', 'x-wq-device': DEVICE, ...(ua === undefined ? {} : { 'user-agent': ua }) },
  body: JSON.stringify(body),
});
const logged = (name) => logEvent.mock.calls.filter(([e]) => e === name).map(([, d]) => d);

beforeAll(async () => {
  Object.assign(process.env, ENV);
  const app = express();
  expect(mountPushRemind(app)).toBe(true);
  srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
afterAll(() => srv && srv.close());
beforeEach(() => {
  fake = makeFake({ app_settings: [{ key: 'web_quiz_push_remind', value: true }], web_quiz_push_subscriptions: [] });
  supabase.from = (t) => fake.from(t);
  Push.__reset();
  logEvent.mockClear();
});

describe('remind_step (the result screen, the class link, the stop landing)', () => {
  test.each(['result', 'class_link', 'landing'])('src %s from a walk: today\'s props plus qa', async (src) => {
    const STEP = { step: 'shown', lang: 'en', src };
    expect((await call('/e', STEP, QA_UA)).status).toBe(200);
    expect(logged('web_quiz.remind_step')).toEqual([{ ...STEP, qa: true }]);
  });
  test.each(NOT_QA)('%s: exactly today\'s props', async (_n, ua) => {
    const STEP = { step: 'shown', lang: 'en', src: 'class_link' };
    await call('/e', STEP, ua);
    expect(logged('web_quiz.remind_step')).toEqual([STEP]);
  });
  test('a bad step from a walk is still refused, and logs nothing', async () => {
    expect((await call('/e', { step: 'nope' }, QA_UA)).status).toBe(400);
    expect(logged('web_quiz.remind_step')).toEqual([]);
  });
});

describe('push_subscribed', () => {
  const subscribe = (ua) => call('/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1 }, ua);
  test('from a walk: today\'s props plus qa', async () => {
    expect((await subscribe(QA_UA)).status).toBe(200);
    expect(logged('web_quiz.push_subscribed')).toEqual([{ kind: 'quiz_reminder', via: 'family_phone', ua_class: 'chrome_android', chips_n: 1, qa: true }]);
  });
  test.each(NOT_QA.filter(([n]) => n !== 'no user agent'))('%s: exactly today\'s props', async (_n, ua) => {
    await subscribe(ua);
    expect(logged('web_quiz.push_subscribed')).toEqual([{ kind: 'quiz_reminder', via: 'family_phone', ua_class: 'chrome_android', chips_n: 1 }]);
  });
  test('the row stores no walk mark (the mark lives only in the log line)', async () => {
    await subscribe(QA_UA);
    expect(fake.db.web_quiz_push_subscriptions).toHaveLength(1);
    expect(JSON.stringify(fake.db.web_quiz_push_subscriptions[0])).not.toMatch(/"qa"/);
  });
});

describe('push_opened (the worker\'s fetch carries the phone\'s user agent)', () => {
  beforeEach(async () => {
    await call('/subscribe', { sub: SUB, code: 'ABC123', lang: 'en', chips: 1 }, UA);
    logEvent.mockClear();
  });
  test('from a walk: {kind, qa}', async () => {
    expect(await (await call('/opened', { endpoint: SUB.endpoint }, QA_UA)).json()).toEqual({ ok: 1 });
    expect(logged('web_quiz.push_opened')).toEqual([{ kind: 'quiz_reminder', qa: true }]);
  });
  test.each(NOT_QA)('%s: exactly {kind}', async (_n, ua) => {
    await call('/opened', { endpoint: SUB.endpoint }, ua);
    expect(logged('web_quiz.push_opened')).toEqual([{ kind: 'quiz_reminder' }]);
  });
});

describe('push_delivered', () => {
  test('from a walk: today\'s props plus qa', async () => {
    expect(await (await call('/delivered', { tag: 'jugnu-remind', shown: true }, QA_UA)).json()).toEqual({ ok: 1 });
    expect(logged('web_quiz.push_delivered')).toEqual([{ kind: 'quiz_reminder', reason: 'quiz_reminder', shown: true, qa: true }]);
  });
  test.each(NOT_QA)('%s: exactly today\'s props', async (_n, ua) => {
    await call('/delivered', { tag: 'jugnu-remind', shown: true }, ua);
    expect(logged('web_quiz.push_delivered')).toEqual([{ kind: 'quiz_reminder', reason: 'quiz_reminder', shown: true }]);
  });
});
