'use strict';
/**
 * The reminder ask on the standing class link (/j/<code>) passes the page's code: the round's share code when a round
 * is ready, else the class link's own code. The push service read only quiz_share_codes, so a class link's code was
 * unknown to it: inside the canary the /j/ page never got the ask (key ask:false, subscribe 409), the row never kept
 * its class, and a reminder with no round that night opened /q/<class link code>, the unknown-code page. A code that
 * is not a share code is now looked up as a live class link (not revoked, not expired): its class decides the canary
 * like a share code's class, the row keeps class_id, and the tap opens /j/<code>. A share code is read first and
 * keeps /q/; a code that is neither keeps today's /q/ link.
 * Supabase (in-memory), deviceKids, class-link's rounds and web-push are the faked boundaries; invented ids.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));
jest.mock('../../shared/services/quiz/web-quiz-class-link', () => ({ roundsReadyForPhone: jest.fn(async () => []) }));

const crypto = require('crypto');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Push = require('../../shared/services/push/web-quiz-push.service');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const S_IN = 'aaaaaaaa-0000-4000-8000-000000000021';
const S_OUT = 'aaaaaaaa-0000-4000-8000-000000000022';
const C_IN = 'cccccccc-0000-4000-8000-000000000021';
const C_OUT = 'cccccccc-0000-4000-8000-000000000022';
const C_NOSCH = 'cccccccc-0000-4000-8000-000000000023';
const T_IN = 'dddddddd-0000-4000-8000-000000000021';
const LIVE = '2030-01-01T00:00:00.000Z';
const PAST = '2024-01-01T00:00:00.000Z';
const J_IN = 'JK7Q2MXRTP';
const J_OUT = 'JW3P8TTRKM';
const J_NOSCH = 'JNS4CHRZXV';
const J_REVOKED = 'JRV9KDQ2WE';
const J_EXPIRED = 'JXP5HGT7YB';
const DEV = 'CCCCCCCCCCCCCCCCCCCCCC';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/j', keys: { p256dh: 'p', auth: 'a' } };
const at = (iso) => Date.parse(iso);

function setup(canary) {
  const settings = [{ key: 'web_quiz_push_remind', value: true }, { key: 'web_quiz_push_test', value: true }];
  if (canary) settings.push({ key: 'web_quiz_push_canary', value: canary });
  const fake = makeFake({
    app_settings: settings,
    web_quiz_push_subscriptions: [],
    schools: [{ id: S_IN, region: 'Tarnol' }, { id: S_OUT, region: 'Sihala' }],
    classes: [{ id: C_IN, school_id: S_IN }, { id: C_OUT, school_id: S_OUT }, { id: C_NOSCH, school_id: null }],
    users: [{ id: T_IN, school_id: S_IN }],
    quiz_share_codes: [{ id: 'q1', code: 'QRA22N', class_id: C_IN, teacher_user_id: T_IN }],
    class_links: [
      { code: J_IN, class_id: C_IN, teacher_id: T_IN, expires_at: LIVE, revoked_at: null },
      { code: J_OUT, class_id: C_OUT, teacher_id: T_IN, expires_at: LIVE, revoked_at: null },
      { code: J_NOSCH, class_id: C_NOSCH, teacher_id: T_IN, expires_at: LIVE, revoked_at: null },
      { code: J_REVOKED, class_id: C_IN, teacher_id: T_IN, expires_at: LIVE, revoked_at: '2026-11-01T00:00:00.000Z' },
      { code: J_EXPIRED, class_id: C_IN, teacher_id: T_IN, expires_at: PAST, revoked_at: null },
    ],
  });
  supabase.from = (t) => fake.from(t);
  Object.assign(process.env, ENV);
  Push.__reset();
  return fake;
}
const ask = async (code) => (await Push.keyFor({ code })).ask;

beforeEach(() => { jest.clearAllMocks(); });

describe('a class link code under the canary: its class decides', () => {
  test('sector canary: a live link of a class in the sector asks; another sector does not', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask(J_IN)).toBe(true);
    expect(await ask(J_OUT)).toBe(false);
  });
  test('class canary: the listed class\'s link asks', async () => {
    setup({ class_ids: [C_IN] });
    expect(await ask(J_IN)).toBe(true);
    expect(await ask(J_OUT)).toBe(false);
  });
  test('a link whose class has no school: no ask', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask(J_NOSCH)).toBe(false);
  });
  test('a revoked or expired link is not a class: no ask', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask(J_REVOKED)).toBe(false);
    expect(await ask(J_EXPIRED)).toBe(false);
  });
  test('the round\'s share code still decides by its own class', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask('QRA22N')).toBe(true);
  });
});

describe('subscribe keeps the class the code names', () => {
  test('a class link code inside the sector canary: stored, with its class', async () => {
    const fake = setup({ regions: ['Tarnol'] });
    expect(await Push.subscribe({ sub: SUB, device_ref: DEV, code: J_IN, lang: 'en' })).toEqual({ ok: 1 });
    expect(fake.db.web_quiz_push_subscriptions).toHaveLength(1);
    expect(fake.db.web_quiz_push_subscriptions[0]).toMatchObject({ quiz_code: J_IN, class_id: C_IN });
  });
  test('a share code with a class, no canary: its class', async () => {
    const fake = setup(null);
    expect(await Push.subscribe({ sub: SUB, device_ref: DEV, code: 'QRA22N', lang: 'en' })).toEqual({ ok: 1 });
    expect(fake.db.web_quiz_push_subscriptions[0]).toMatchObject({ quiz_code: 'QRA22N', class_id: C_IN });
  });
  test('a code that names no class, no canary: stored without one', async () => {
    const fake = setup(null);
    expect(await Push.subscribe({ sub: SUB, device_ref: DEV, code: 'ZZZ999', lang: 'en' })).toEqual({ ok: 1 });
    expect(fake.db.web_quiz_push_subscriptions[0].class_id).toBeNull();
  });
});

describe('the tap with no round that evening', () => {
  async function urlFor(code) {
    setup(null);
    await Push.subscribe({ sub: SUB, device_ref: DEV, code, lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    return JSON.parse(wp.sendNotification.mock.calls[0][1]).url;
  }
  test('a class link code opens its standing link, never /q/', async () => {
    expect(await urlFor(J_IN)).toBe(`/j/${J_IN}?from=push`);
  });
  test('a share code keeps its quiz link', async () => {
    expect(await urlFor('QRA22N')).toBe('/q/QRA22N?from=push');
  });
  test('a code that is neither keeps today\'s link', async () => {
    expect(await urlFor('ZZZ999')).toBe('/q/ZZZ999?from=push');
  });
  test('the test push from a class link opens the standing link', async () => {
    setup(null);
    await Push.subscribe({ sub: SUB, device_ref: DEV, code: J_IN, lang: 'en' });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    const out = await Push.sendTest({ endpoint: SUB.endpoint }, { webpush: wp });
    expect(out).toMatchObject({ ok: 1, sent: 1 });
    expect(JSON.parse(wp.sendNotification.mock.calls[0][1]).url).toBe(`/j/${J_IN}?from=push`);
  });
});
