'use strict';
/**
 * c2 (app_settings web_quiz_install_android; no row = off): while it is on, GET /key also answers install_android: true,
 * inside the canary or outside it (the install offer is not the reminder's canary), so the finish screen may offer the
 * Android install once the reminder ask is settled. Off: the answer is exactly as before. Supabase (in-memory) is the
 * faked boundary; invented ids.
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
  const v2 = opts.v2; // undefined = no row
  const inst = 'inst' in opts ? opts.inst : true; // { inst: undefined } = no row
  const { canary } = opts;
  const settings = [{ key: 'web_quiz_push_remind', value: true }];
  if (v2 !== undefined) settings.push({ key: 'web_quiz_push_ask_v2', value: v2 });
  if (inst !== undefined) settings.push({ key: 'web_quiz_install_android', value: inst });
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

describe('keyFor: install_android', () => {
  test('switch on, inside the canary: the field', async () => {
    setup();
    expect(await Push.keyFor({ code: 'INSCH1', device: EVEN })).toEqual({ key: 'BPub', ask: true, install_android: true });
  });
  test('switch on, outside the canary: ask false and still the field', async () => {
    setup({ canary: { regions: ['Tarnol'] } });
    expect(await Push.keyFor({ code: 'OUTSC1', device: EVEN })).toEqual({ key: 'BPub', ask: false, install_android: true });
  });
  test('with ask v2 on too: both', async () => {
    setup({ v2: true });
    expect(await Push.keyFor({ code: 'INSCH1', device: ODD })).toEqual({ key: 'BPub', ask: true, ask_v: 'b', install_android: true });
  });
  test.each([[undefined], [false], ['true']])('row %j: no field (today exactly)', async (inst) => {
    setup({ inst });
    expect(await Push.keyFor({ code: 'INSCH1', device: EVEN })).toEqual({ key: 'BPub', ask: true });
  });
});
