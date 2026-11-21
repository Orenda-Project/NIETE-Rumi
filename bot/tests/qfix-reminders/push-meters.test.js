'use strict';
/**
 * The reminder funnel's meters tell the truth (web_quiz_push_remind):
 *  - delivered: the worker says whether the notification was actually SHOWN ({shown: true|false, err}); a rejected
 *    showNotification (permission revoked in Android settings, a bad icon) is delivered-but-not-shown, never "reach";
 *  - the hub's first call names the route that brought the child: POST /api/internal/wq/hub/<t> {src} reaches the hub
 *    as opts.src (only a known route), as the server-rendered GET's ?src= already does.
 * The push routes run whole through their mount; the hub route through the internal router with the hub's own build
 * replaced at its module boundary (it is the thing measured, not the thing under test). Invented values.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
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
const delivered = () => logEvent.mock.calls.filter(([e]) => e === 'web_quiz.push_delivered').map(([, d]) => d);

describe('delivered carries shown', () => {
  beforeEach(() => logEvent.mockClear());
  test('shown: true / shown: false with the error\'s name; an old worker (no shown) says neither', () => {
    expect(Push.delivered({ tag: 'jugnu-remind', shown: true })).toEqual({ ok: 1 });
    expect(Push.delivered({ tag: 'jugnu-remind', shown: false, err: 'TypeError' })).toEqual({ ok: 1 });
    expect(Push.delivered({ tag: 'jugnu-remind' })).toEqual({ ok: 1 });
    expect(delivered()).toEqual([
      { kind: 'quiz_reminder', reason: 'quiz_reminder', shown: true },
      { kind: 'quiz_reminder', reason: 'quiz_reminder', shown: false, err: 'TypeError' },
      { kind: 'quiz_reminder', reason: 'quiz_reminder' },
    ]);
  });
  test('only a real boolean and a plain error name are kept', () => {
    Push.delivered({ tag: 'jugnu-remind', shown: 'yes', err: 'x<script>' });
    Push.delivered({ tag: 'jugnu-remind', shown: false, err: 'A'.repeat(41) });
    expect(delivered()).toEqual([
      { kind: 'quiz_reminder', reason: 'quiz_reminder' },
      { kind: 'quiz_reminder', reason: 'quiz_reminder', shown: false },
    ]);
  });

  describe('through the route', () => {
    let srv; let base;
    beforeAll(async () => {
      Object.assign(process.env, ENV);
      const app = express();
      mountPushRemind(app);
      srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
      base = `http://127.0.0.1:${srv.address().port}`;
    });
    afterAll(() => srv && srv.close());
    test('POST /delivered {tag, shown:false, err} reaches the event', async () => {
      const fake = makeFake({ app_settings: [{ key: 'web_quiz_push_remind', value: true }], web_quiz_push_subscriptions: [] });
      supabase.from = (t) => fake.from(t);
      Push.__reset();
      const r = await fetch(`${base}${MOUNT_PATH}/delivered`, { method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ tag: 'jugnu-remind', shown: false, err: 'TypeError' }) });
      expect(r.status).toBe(200);
      expect(delivered()).toEqual([{ kind: 'quiz_reminder', reason: 'quiz_reminder', shown: false, err: 'TypeError' }]);
    });
  });
});

describe('the hub\'s first call keeps its route (src)', () => {
  const Hub = require('../../shared/services/quiz/web-quiz-hub');
  let srv; let base; let spy;
  beforeAll(async () => {
    spy = jest.spyOn(Hub, 'hub').mockImplementation(async () => ({ lang: 'en', locked: true, kids: [], kid: null }));
    const app = express();
    app.use(express.json());
    app.use('/api/internal/wq', require('../../shared/routes/web-quiz-internal.routes'));
    srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    base = `http://127.0.0.1:${srv.address().port}`;
  });
  afterAll(() => { spy.mockRestore(); if (srv) srv.close(); });
  const post = (b) => fetch(`${base}/api/internal/wq/hub/tok.en`, { method: 'POST', headers: { 'x-api-key': process.env.INTERNAL_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  test('{src:"push"} → opts.src push; an unknown src → none', async () => {
    spy.mockClear();
    await post({ device_ref: 'AAAAAAAAAAAAAAAAAAAAAA', src: 'push' });
    await post({ device_ref: 'AAAAAAAAAAAAAAAAAAAAAA', src: 'evil' });
    await post({ device_ref: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(spy.mock.calls.map(([, o]) => o.src)).toEqual(['push', undefined, undefined]);
    expect(spy.mock.calls[0][1]).toMatchObject({ device: 'AAAAAAAAAAAAAAAAAAAAAA' });
  });
});
