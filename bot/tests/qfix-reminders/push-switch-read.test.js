'use strict';
/**
 * A FAILED read of the reminder switch is not OFF. OFF is destructive on the phone: /key 404 {off:true} makes the page
 * unregister the reminder worker. So a read error keeps the last good answer; with no good answer yet the switch is
 * "unread": every route answers 503 (the page keeps whatever worker it has) and the worker sends nothing. Only a real
 * read of off answers 404 {off:true}. Each failed read is one counted event, so the path shows in the logs.
 * Supabase (in-memory, or a failing app_settings read) and web-push are the faked boundaries; invented values.
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

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const DOWN = { data: null, error: { message: 'connection refused' } };
const at = (iso) => Date.parse(iso);
const T0 = at('2025-10-22T13:05:00Z');

// app_settings answers from the fake while `up`, else every read fails (the DB down, as on staging 22 Nov 13:33–14:41Z)
function setup({ remind = true } = {}) {
  const fake = makeFake({ app_settings: remind ? [{ key: 'web_quiz_push_remind', value: true }] : [], web_quiz_push_subscriptions: [] });
  const db = { up: true };
  const failing = { select: () => ({ in: async () => DOWN, eq: async () => DOWN }) };
  supabase.from = (t) => (t === 'app_settings' && !db.up ? failing : fake.from(t));
  Object.assign(process.env, ENV);
  Push.__reset();
  jest.clearAllMocks();
  return { fake, db };
}
const readEvents = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.push_switch_read').map(([, d]) => d);

describe('switches(): a failed read keeps the last good answer', () => {
  test('on, then the read fails: still on, and the failure is one counted event', async () => {
    const { db } = setup();
    expect((await Push.switches(T0)).remind).toBe(true);
    db.up = false;
    const s = await Push.switches(T0 + 31000);
    expect(s.remind).toBe(true);
    expect(s.unread).toBeUndefined();
    expect(readEvents()).toEqual([{ ok: false, kept: 'last' }]);
  });
  test('off (a real read), then the read fails: still off, not unread', async () => {
    const { db } = setup({ remind: false });
    expect((await Push.switches(T0)).remind).toBe(false);
    db.up = false;
    const s = await Push.switches(T0 + 31000);
    expect(s.remind).toBe(false);
    expect(s.unread).toBeUndefined();
  });
  test('the first read fails: unread, nothing on', async () => {
    const { db } = setup();
    db.up = false;
    const s = await Push.switches(T0);
    expect(s).toMatchObject({ remind: false, unread: true });
    expect(readEvents()).toEqual([{ ok: false, kept: 'none' }]);
  });
  test('the DB comes back: the next read is fresh', async () => {
    const { db } = setup();
    db.up = false;
    expect((await Push.switches(T0)).unread).toBe(true);
    db.up = true;
    const s = await Push.switches(T0 + 31000);
    expect(s.remind).toBe(true);
    expect(s.unread).toBeUndefined();
  });
});

describe('the routes: 503 while unread, 404 {off:true} only on a real off', () => {
  async function get(path) {
    const { mountPushRemind, MOUNT_PATH } = require('../../shared/services/first-touch/push-remind.mount');
    const app = express();
    mountPushRemind(app);
    const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}${MOUNT_PATH}${path}`, { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } });
      return { status: r.status, body: await r.json() };
    } finally { await new Promise((r) => srv.close(r)); }
  }
  test('the first read fails: /key answers 503, never 404 {off:true}', async () => {
    const { db } = setup();
    db.up = false;
    expect(await get('/key?code=ABC123')).toEqual({ status: 503, body: { err: 'unavailable' } });
  });
  test('a real read of off: /key answers 404 {off:true}', async () => {
    setup({ remind: false });
    expect(await get('/key?code=ABC123')).toEqual({ status: 404, body: { off: true } });
  });
  test('on, then the read fails: /key still answers the key', async () => {
    const { db } = setup();
    await Push.switches(Date.now() - 31000); // a good read, already stale: the route's own read happens and fails
    db.up = false;
    expect((await get('/key?code=ABC123')).status).toBe(200);
  });
});

describe('dueTick sends nothing while the switch is unread', () => {
  test('the first read fails: no send, no row touched', async () => {
    const { db, fake } = setup();
    await Push.subscribe({ sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/z', keys: { p256dh: 'p', auth: 'a' } }, device_ref: 'DDDDDDDDDDDDDDDDDDDDDD', code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const before = JSON.stringify(fake.db.web_quiz_push_subscriptions);
    Push.__reset();
    db.up = false;
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    await Push.dueTick(T0, { webpush: wp });
    expect(wp.sendNotification).not.toHaveBeenCalled();
    expect(JSON.stringify(fake.db.web_quiz_push_subscriptions)).toBe(before);
  });
});
