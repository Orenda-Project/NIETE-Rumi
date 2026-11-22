'use strict';
/**
 * The reminder's canary (app_settings web_quiz_push_canary = {school_ids?, class_ids?}; no row = every class): while it
 * is set, only a quiz played on a canary class (its share code's class, or that class's school) offers the ask, and only
 * there may a phone subscribe. GET /key answers {key, ask}; outside the canary ask:false (the page draws nothing and
 * keeps any worker it has). Supabase (in-memory) and deviceKids are the faked boundaries; invented ids.
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
const Push = require('../../shared/services/push/web-quiz-push.service');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const S_IN = 'aaaaaaaa-0000-4000-8000-000000000001';
const S_OUT = 'aaaaaaaa-0000-4000-8000-000000000002';
const C_IN = 'cccccccc-0000-4000-8000-000000000001';
const C_OUT = 'cccccccc-0000-4000-8000-000000000002';
const C_PICKED = 'cccccccc-0000-4000-8000-000000000003';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };

function setup(canary) {
  const settings = [{ key: 'web_quiz_push_remind', value: true }];
  if (canary !== undefined) settings.push({ key: 'web_quiz_push_canary', value: canary });
  const fake = makeFake({
    app_settings: settings, web_quiz_push_subscriptions: [],
    classes: [{ id: C_IN, school_id: S_IN }, { id: C_OUT, school_id: S_OUT }, { id: C_PICKED, school_id: S_OUT }],
    schools: [{ id: S_IN, region: 'Tarnol' }, { id: S_OUT, region: 'Sihala' }],
    quiz_share_codes: [{ id: 'q1', code: 'INSCH1', class_id: C_IN }, { id: 'q2', code: 'OUTSC1', class_id: C_OUT }, { id: 'q3', code: 'PICKD1', class_id: C_PICKED }, { id: 'q4', code: 'NOCLS1', class_id: null }],
  });
  supabase.from = (t) => fake.from(t);
  Object.assign(process.env, ENV);
  Push.__reset();
  return fake;
}

describe('keyFor: the ask only on canary classes while the canary is set', () => {
  test('no canary row: every quiz asks', async () => {
    setup();
    expect(await Push.keyFor({ code: 'OUTSC1' })).toEqual({ key: 'BPub', ask: true });
    expect(await Push.keyFor({})).toEqual({ key: 'BPub', ask: true });
  });
  test('school canary: in-school asks, others do not, a code with no class does not, no code does not', async () => {
    setup({ school_ids: [S_IN] });
    expect(await Push.keyFor({ code: 'INSCH1' })).toEqual({ key: 'BPub', ask: true });
    expect(await Push.keyFor({ code: 'OUTSC1' })).toEqual({ key: 'BPub', ask: false });
    expect(await Push.keyFor({ code: 'NOCLS1' })).toEqual({ key: 'BPub', ask: false });
    expect(await Push.keyFor({ code: 'ZZZZZ9' })).toEqual({ key: 'BPub', ask: false });
    expect(await Push.keyFor({})).toEqual({ key: 'BPub', ask: false });
  });
  test('class canary: a listed class asks even in another school', async () => {
    setup({ class_ids: [C_PICKED] });
    expect((await Push.keyFor({ code: 'PICKD1' })).ask).toBe(true);
    expect((await Push.keyFor({ code: 'OUTSC1' })).ask).toBe(false);
  });
  test('sector canary ({regions}: schools.region, the ICT sector): a class of a school in that sector asks', async () => {
    setup({ regions: ['Tarnol'] });
    expect((await Push.keyFor({ code: 'INSCH1' })).ask).toBe(true);
    expect((await Push.keyFor({ code: 'OUTSC1' })).ask).toBe(false);
    expect((await Push.keyFor({ code: 'NOCLS1' })).ask).toBe(false);
  });
  test('a malformed canary value (not an object of id lists) counts as no canary', async () => {
    setup(true);
    expect((await Push.keyFor({ code: 'OUTSC1' })).ask).toBe(true);
  });
});

describe('subscribe honours the canary too', () => {
  test('outside the canary: 409 canary, no row', async () => {
    const fake = setup({ school_ids: [S_IN] });
    expect(await Push.subscribe({ sub: SUB, device_ref: 'AAAAAAAAAAAAAAAAAAAAAA', code: 'OUTSC1', lang: 'en' })).toEqual({ status: 409, err: 'canary' });
    expect(fake.db.web_quiz_push_subscriptions).toHaveLength(0);
    expect(await Push.subscribe({ sub: SUB, device_ref: 'AAAAAAAAAAAAAAAAAAAAAA', code: 'INSCH1', lang: 'en' })).toEqual({ ok: 1 });
  });
});

describe('GET /key carries ask', () => {
  test('the route answers {key, ask} for ?code=', async () => {
    setup({ school_ids: [S_IN] });
    const { mountPushRemind, MOUNT_PATH } = require('../../shared/services/first-touch/push-remind.mount');
    const app = express();
    mountPushRemind(app);
    const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
    try {
      const get = async (q) => (await fetch(`http://127.0.0.1:${srv.address().port}${MOUNT_PATH}/key${q}`, { headers: { 'x-api-key': process.env.INTERNAL_API_KEY } })).json();
      expect(await get('?code=INSCH1')).toEqual({ key: 'BPub', ask: true });
      expect(await get('?code=OUTSC1')).toEqual({ key: 'BPub', ask: false });
    } finally { await new Promise((r) => srv.close(r)); }
  });
});
