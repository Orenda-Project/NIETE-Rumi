'use strict';
/**
 * The permission primer (app_settings web_quiz_push_primer; no row = off): while it is on, GET /key answers
 * primer: true where the ask is offered, and the page puts one "your phone will ask next" screen between our Yes and
 * the browser's prompt. remind_step keeps the primer's steps (primer_shown / primer_go / primer_back) and, on granted
 * and denied, prompt_ms (how long the browser's permission step took; whole ms, at most 10 min). Off: exactly as before.
 * Supabase (in-memory) is the faked boundary; invented ids.
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
  const primer = 'primer' in opts ? opts.primer : true; // { primer: undefined } = no row
  const { canary } = opts;
  const settings = [{ key: 'web_quiz_push_remind', value: true }];
  if (v2 !== undefined) settings.push({ key: 'web_quiz_push_ask_v2', value: v2 });
  if (primer !== undefined) settings.push({ key: 'web_quiz_push_primer', value: primer });
  if (opts.remind === false) settings[0].value = false;
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

const relayed = () => logEvent.mock.calls.filter(([n]) => n === 'web_quiz.remind_step').map(([, p]) => p);

describe('keyFor: primer', () => {
  test('switch on: primer true where the ask is offered', async () => {
    setup();
    expect(await Push.keyFor({ code: 'INSCH1', device: EVEN })).toEqual({ key: 'BPub', ask: true, primer: true });
  });
  test('switch on with ask v2 on too: both fields', async () => {
    setup({ v2: true });
    expect(await Push.keyFor({ code: 'INSCH1', device: ODD })).toEqual({ key: 'BPub', ask: true, ask_v: 'b', primer: true });
  });
  test.each([[undefined], [false], ['true']])('row %j: no primer field (today exactly)', async (primer) => {
    setup({ primer });
    expect(await Push.keyFor({ code: 'INSCH1', device: EVEN })).toEqual({ key: 'BPub', ask: true });
  });
  test('outside the canary: ask false and no primer', async () => {
    setup({ canary: { regions: ['Tarnol'] } });
    expect(await Push.keyFor({ code: 'OUTSC1', device: EVEN })).toEqual({ key: 'BPub', ask: false });
  });
  test('web_quiz_push_remind off: no primer', async () => {
    setup({ remind: false });
    expect((await Push.keyFor({ code: 'INSCH1', device: EVEN })).primer).toBeUndefined();
  });
});

describe('stepEvent: the primer steps and prompt_ms', () => {
  test.each(['primer_shown', 'primer_go', 'primer_back'])('%s is a step', (step) => {
    setup();
    expect(Push.stepEvent({ step, src: 'result' })).toEqual({ ok: 1 });
    expect(relayed()[0]).toMatchObject({ step, src: 'result' });
  });
  test.each(['granted', 'denied'])('%s keeps a whole prompt_ms', (step) => {
    setup();
    Push.stepEvent({ step, prompt_ms: 2350, perm: 'default' });
    expect(relayed()[0].prompt_ms).toBe(2350);
  });
  test.each([[-1], [1.5], [600001], ['300']])('prompt_ms %j is dropped, the step stays', (ms) => {
    setup();
    Push.stepEvent({ step: 'granted', prompt_ms: ms });
    expect(relayed()[0]).toMatchObject({ step: 'granted' });
    expect(relayed()[0].prompt_ms).toBeUndefined();
  });
  test('prompt_ms on any other step is dropped', () => {
    setup();
    Push.stepEvent({ step: 'yes', prompt_ms: 100, dwell_ms: 900 });
    expect(relayed()[0].prompt_ms).toBeUndefined();
    expect(relayed()[0].dwell_ms).toBe(900);
  });
});
