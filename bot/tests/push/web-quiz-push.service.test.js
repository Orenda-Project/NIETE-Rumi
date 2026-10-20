'use strict';
/**
 * The reminder push service (web_quiz_push_remind, web_quiz_push_test; all OFF by default): switches, the stored
 * subscription (hash + ciphertext, never the raw endpoint), the class-phone refusal, the next school day, the payload
 * (no name), the send and its 404/410 revoke, the due tick, the expiry tick. Supabase (in-memory, filters applied),
 * Redis-backed deviceKids and the web-push library are the faked boundaries.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));

const crypto = require('crypto');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const HubDevice = require('../../shared/services/quiz/web-quiz-hub-device');
const Push = require('../../shared/services/push/web-quiz-push.service');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub',
  WQ_PUSH_VAPID_PRIVATE: 'priv',
  WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'),
  WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const SUB = { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p256-key', auth: 'auth-key' } };
// PKT = UTC+5: Tue 21 Oct 2025 10:00 PKT = 05:00Z
const at = (iso) => Date.parse(iso);

let fake;
function setup({ settings = { web_quiz_push_remind: true }, env = ENV } = {}) {
  fake = makeFake({ app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })), web_quiz_push_subscriptions: [] });
  supabase.from = (t) => fake.from(t);
  for (const k of Object.keys(ENV)) delete process.env[k];
  Object.assign(process.env, env);
  Push.__reset();
}
const rows = () => fake.db.web_quiz_push_subscriptions;

beforeEach(() => { jest.clearAllMocks(); HubDevice.deviceKids.mockResolvedValue([]); });

describe('switches', () => {
  test('off without the row', async () => {
    setup({ settings: {} });
    expect(await Push.switches()).toEqual({ remind: false, test: false, portal: false });
  });
  test('off when any env is missing, even with the rows on', async () => {
    const env = { ...ENV };
    delete env.WQ_PUSH_HASH_SALT;
    setup({ settings: { web_quiz_push_remind: true, web_quiz_push_test: true }, env });
    expect(await Push.switches()).toEqual({ remind: false, test: false, portal: false });
  });
  test('on with the row and every env; test only under remind', async () => {
    setup({ settings: { web_quiz_push_remind: true, web_quiz_push_test: true } });
    expect(await Push.switches()).toEqual({ remind: true, test: true, portal: false });
    setup({ settings: { web_quiz_push_test: true } });
    expect(await Push.switches()).toEqual({ remind: false, test: false, portal: false });
  });
  test('a string "true" is off (JSON true only)', async () => {
    setup({ settings: { web_quiz_push_remind: 'yes' } });
    expect((await Push.switches()).remind).toBe(false);
  });
});

describe('nextAt (school days, PKT)', () => {
  test('Tue 10:00 PKT → Wed 16:00 PKT', () => {
    expect(new Date(Push.nextAt(at('2025-10-21T05:00:00Z'), 'quiz_reminder')).toISOString()).toBe('2025-10-22T11:00:00.000Z');
  });
  test('Fri 17:00 PKT → Mon 16:00 PKT; Sat and Sun → Mon', () => {
    expect(new Date(Push.nextAt(at('2025-10-24T12:00:00Z'), 'quiz_reminder')).toISOString()).toBe('2025-10-27T11:00:00.000Z');
    expect(new Date(Push.nextAt(at('2025-10-25T06:00:00Z'), 'quiz_reminder')).toISOString()).toBe('2025-10-27T11:00:00.000Z');
    expect(new Date(Push.nextAt(at('2025-10-26T06:00:00Z'), 'quiz_reminder')).toISOString()).toBe('2025-10-27T11:00:00.000Z');
  });
  test('teacher evening_plan at 18:00 PKT', () => {
    expect(new Date(Push.nextAt(at('2025-10-21T05:00:00Z'), 'evening_plan')).toISOString()).toBe('2025-10-22T13:00:00.000Z');
  });
});

describe('subscribe', () => {
  test('stores the hash and ciphertext only, never the raw endpoint; decrypt round-trips', async () => {
    setup();
    const out = await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'ur', chips_n: 1, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' }, { now: at('2025-10-21T05:00:00Z') });
    expect(out).toEqual({ ok: 1 });
    expect(rows()).toHaveLength(1);
    const r = rows()[0];
    expect(JSON.stringify(r)).not.toContain('fcm.googleapis.com');
    expect(JSON.stringify(r)).not.toContain('auth-key');
    expect(r.endpoint_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Push.decrypt(r.endpoint_enc)).toBe(ENDPOINT);
    expect(JSON.parse(Push.decrypt(r.keys_enc))).toEqual(SUB.keys);
    expect(r).toMatchObject({ kind: 'quiz_reminder', via: 'family_phone', device_ref: DEVICE, user_id: null, quiz_code: 'ABC123', lang: 'ur', ua_class: 'chrome_android', chips_n: 1, student_id: null });
    expect(r.next_at).toBe('2025-10-22T11:00:00.000Z');
    expect(r.expires_at).toBe(new Date(at('2025-10-21T05:00:00Z') + 90 * 864e5).toISOString());
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_subscribed', { kind: 'quiz_reminder', via: 'family_phone', ua_class: 'chrome_android', chips_n: 1 });
  });
  test('refuses a class phone (≥4 chips on the page or on the device)', async () => {
    setup();
    expect(await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en', chips_n: 4 })).toEqual({ status: 409, err: 'class_phone' });
    HubDevice.deviceKids.mockResolvedValue(['a', 'b', 'c', 'd']);
    expect(await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en', chips_n: 0 })).toEqual({ status: 409, err: 'class_phone' });
    expect(rows()).toHaveLength(0);
  });
  test('refuses a bad subscription (http, no keys, too long)', async () => {
    setup();
    expect((await Push.subscribe({ sub: { ...SUB, endpoint: 'http://x' }, device_ref: DEVICE })).err).toBe('bad_sub');
    expect((await Push.subscribe({ sub: { endpoint: ENDPOINT }, device_ref: DEVICE })).err).toBe('bad_sub');
    expect((await Push.subscribe({ sub: { ...SUB, endpoint: `https://x/${'a'.repeat(2100)}` }, device_ref: DEVICE })).err).toBe('bad_sub');
  });
  test('student_id only when the device holds exactly that one chip', async () => {
    setup();
    const kid = 'e0000000-0000-4000-8000-000000000001';
    HubDevice.deviceKids.mockResolvedValue([kid]);
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en', chips_n: 1, chip: kid });
    expect(rows()[0].student_id).toBe(kid);
  });
  test('the same endpoint again updates its row; rotate_from revokes the old row and links it', async () => {
    setup();
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' });
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'XYZ999', lang: 'ur' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ quiz_code: 'XYZ999', lang: 'ur' });
    const next = { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/new' };
    await Push.subscribe({ sub: next, device_ref: DEVICE, code: 'XYZ999', lang: 'ur', rotate_from: ENDPOINT });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toMatchObject({ revoked_by: 'rotated', endpoint_enc: null, keys_enc: null });
    expect(rows()[1].rebind_of).toBe(rows()[0].id);
  });
  test('a device with no wq_dv cookie gets a server-random ref', async () => {
    setup();
    await Push.subscribe({ sub: SUB, code: 'ABC123', lang: 'en' });
    expect(rows()[0].device_ref).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  test('re-consent after a revoke writes a new row linked to the old one', async () => {
    setup();
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' });
    await Push.unsubscribe({ endpoint: ENDPOINT, by: 'page' });
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' });
    expect(rows()).toHaveLength(2);
    expect(rows()[1].rebind_of).toBe(rows()[0].id);
    expect(rows()[1].revoked_at).toBeNull();
  });
});

describe('unsubscribe / opened', () => {
  test('unsubscribe revokes with its door and nulls the ciphertext', async () => {
    setup();
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' });
    expect(await Push.unsubscribe({ endpoint: ENDPOINT, by: 'notification' })).toEqual({ ok: 1 });
    expect(rows()[0]).toMatchObject({ revoked_by: 'notification', endpoint_enc: null, keys_enc: null, next_at: null });
    expect(rows()[0].revoked_at).toBeTruthy();
  });
  test('opened resets unopened and renews the expiry', async () => {
    setup();
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' }, { now: at('2025-10-01T05:00:00Z') });
    rows()[0].unopened_count = 3;
    await Push.markOpened({ endpoint: ENDPOINT }, { now: at('2025-10-21T05:00:00Z') });
    expect(rows()[0].unopened_count).toBe(0);
    expect(rows()[0].expires_at).toBe(new Date(at('2025-10-21T05:00:00Z') + 90 * 864e5).toISOString());
  });
});

describe('payloadFor', () => {
  test('child payload: Urdu, no name, opens the quiz', () => {
    const p = Push.payloadFor({ kind: 'quiz_reminder', lang: 'ur', quiz_code: 'ABC123', student_id: 'x' });
    expect(p).toEqual({ t: 'جگنو', b: 'آج کا کوئز تیار ہے۔ کھیلنے کے لیے دبائیں۔', url: '/q/ABC123?from=push', tag: 'jugnu-remind', lang: 'ur', test: false });
  });
  test('test payload in English; teacher payload opens the portal home', () => {
    expect(Push.payloadFor({ kind: 'quiz_reminder', lang: 'en', quiz_code: 'ABC123' }, { test: true })).toMatchObject({ t: 'Jugnu', b: 'Test: reminders are on.', test: true });
    expect(Push.payloadFor({ kind: 'evening_plan', lang: 'en' })).toMatchObject({ t: 'NIETE', b: 'Your plan for tomorrow is ready.', url: '/' });
  });
  test('a malformed code never reaches the url', () => {
    expect(Push.payloadFor({ kind: 'quiz_reminder', lang: 'en', quiz_code: '../x?p=1' }).url).toBe('/');
  });
});

describe('sendOne / dueTick / expireTick', () => {
  const webpush = () => ({ sendNotification: jest.fn(async () => ({ statusCode: 201 })) });

  test('sendOne decrypts, sends with VAPID and TTL; a 410 revokes as gone', async () => {
    setup();
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' });
    const wp = webpush();
    expect(await Push.sendOne(rows()[0], { t: 'x' }, { webpush: wp })).toEqual({ sent: 1, status: 201 });
    const [target, body, opts] = wp.sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: ENDPOINT, keys: SUB.keys });
    expect(JSON.parse(body)).toEqual({ t: 'x' });
    expect(opts).toMatchObject({ TTL: 86400, urgency: 'normal', vapidDetails: { subject: ENV.WQ_PUSH_VAPID_SUBJECT, publicKey: 'BPub', privateKey: 'priv' } });
    wp.sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    expect(await Push.sendOne(rows()[0], { t: 'x' }, { webpush: wp })).toEqual({ sent: 0, status: 410 });
    expect(rows()[0]).toMatchObject({ revoked_by: 'gone', endpoint_enc: null });
  });

  test('dueTick sends due rows only, counts, reschedules; revokes at 5 unopened', async () => {
    setup();
    const t0 = at('2025-10-21T05:00:00Z');
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' }, { now: t0 });
    await Push.subscribe({ sub: { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/two' }, device_ref: DEVICE, code: 'ABC123', lang: 'en' }, { now: t0 });
    await Push.subscribe({ sub: { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/three' }, device_ref: DEVICE, code: 'ABC123', lang: 'en' }, { now: t0 });
    rows()[1].next_at = '2025-10-30T11:00:00.000Z'; // not due
    rows()[2].unopened_count = 5;
    const wp = webpush();
    const out = await Push.dueTick(at('2025-10-22T11:00:30Z'), { webpush: wp });
    expect(out).toMatchObject({ sent: 1 });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({ sent_count: 1, unopened_count: 1, last_sent_at: '2025-10-22T11:00:30.000Z', next_at: '2025-10-23T11:00:00.000Z' });
    expect(rows()[2]).toMatchObject({ revoked_by: 'unopened', endpoint_enc: null });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_sent', { n: 1, kind: 'quiz_reminder' });
  });

  test('dueTick does nothing while the switch is off; a stale slot is rescheduled, not sent', async () => {
    setup();
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = webpush();
    fake.db.app_settings.length = 0;
    Push.__reset();
    expect(await Push.dueTick(at('2025-10-22T11:00:30Z'), { webpush: wp })).toMatchObject({ sent: 0, off: true });
    fake.db.app_settings.push({ key: 'web_quiz_push_remind', value: true });
    Push.__reset();
    await Push.dueTick(at('2025-10-23T03:00:00Z'), { webpush: wp }); // 16 h late
    expect(wp.sendNotification).not.toHaveBeenCalled();
    expect(rows()[0].next_at).toBe('2025-10-24T11:00:00.000Z');
  });

  test('expireTick runs with the switch off: expires, nulls the secrets, deletes after 13 months', async () => {
    setup({ settings: {} });
    process.env.WQ_PUSH_HASH_SALT = ENV.WQ_PUSH_HASH_SALT;
    fake.db.web_quiz_push_subscriptions.push(
      { id: 'r1', revoked_at: null, expires_at: '2025-10-01T00:00:00.000Z', endpoint_enc: 'x', keys_enc: 'y', next_at: '2025-10-02T11:00:00.000Z' },
      { id: 'r2', revoked_at: '2024-08-01T00:00:00.000Z', revoked_by: 'page', expires_at: '2024-10-01T00:00:00.000Z', endpoint_enc: null, keys_enc: null },
      { id: 'r3', revoked_at: null, expires_at: '2026-01-01T00:00:00.000Z', endpoint_enc: 'x', keys_enc: 'y' },
    );
    const out = await Push.expireTick(at('2025-10-21T05:00:00Z'));
    expect(out).toEqual({ expired: 1, deleted: 1 });
    expect(rows().map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(rows()[0]).toMatchObject({ revoked_by: 'expiry', endpoint_enc: null, keys_enc: null, next_at: null });
  });
});

describe('sendTest', () => {
  test('only with web_quiz_push_test on; sends the test payload to that one row', async () => {
    setup({ settings: { web_quiz_push_remind: true } });
    await Push.subscribe({ sub: SUB, device_ref: DEVICE, code: 'ABC123', lang: 'en' });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    expect(await Push.sendTest({ endpoint: ENDPOINT }, { webpush: wp })).toEqual({ status: 404, err: 'off' });
    fake.db.app_settings.push({ key: 'web_quiz_push_test', value: true });
    Push.__reset();
    expect(await Push.sendTest({ endpoint: ENDPOINT }, { webpush: wp })).toEqual({ ok: 1, sent: 1, status: 201 });
    expect(JSON.parse(wp.sendNotification.mock.calls[0][1])).toMatchObject({ b: 'Test: reminders are on.', test: true });
  });
});
