'use strict';
/**
 * The child reminder, shaped for the real family phone (web_quiz_push_remind; names behind web_quiz_push_name_children):
 *  - lands 17:30–17:59 PKT on the next school day (children play most at 18:00–19:00), one stable minute per phone;
 *  - ONE notification per phone (device_ref) per evening, however many rows the phone holds;
 *  - class-named from class-link's roundsReadyForPhone (PLAN §3.2), the generic line until it answers;
 *  - children's first names only with the policy switch on (R-rem-1), never otherwise;
 *  - stops after 3 ignored reminders;
 *  - the funnel: push_sent carries reason + body kind, push_delivered from the worker, the day's counts once.
 * Supabase (in-memory), deviceKids, class-link and web-push are the faked boundaries. Invented children only.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));
jest.mock('../../shared/services/quiz/web-quiz-class-link', () => ({ roundsReadyForPhone: jest.fn(async () => []) }));

const crypto = require('crypto');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const { logEvent } = require('../../shared/utils/structured-logger');
const HubDevice = require('../../shared/services/quiz/web-quiz-hub-device');
const ClassLink = require('../../shared/services/quiz/web-quiz-class-link');
const Push = require('../../shared/services/push/web-quiz-push.service');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const DEV_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const DEV_B = 'BBBBBBBBBBBBBBBBBBBBBB';
const KID1 = '11111111-1111-4111-8111-111111111111';
const KID2 = '22222222-2222-4222-8222-222222222222';
const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, expirationTime: null, keys: { p256dh: 'p256-key', auth: 'auth-key' } });
const at = (iso) => Date.parse(iso);
// the phone's minute, worked out here independently of the service
const minuteOf = (d) => Number.parseInt(crypto.createHash('sha256').update(`wqpush|${d}`).digest('hex').slice(0, 8), 16) % 30;
const pktMin = (ms) => Math.floor(((ms + 5 * 3600000) % 86400000) / 60000);

let fake;
function setup(settings = { web_quiz_push_remind: true }, students = []) {
  fake = makeFake({ app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })), web_quiz_push_subscriptions: [], students });
  supabase.from = (t) => fake.from(t);
  Object.assign(process.env, ENV);
  Push.__reset();
}
const rows = () => fake.db.web_quiz_push_subscriptions;
const webpush = () => ({ sendNotification: jest.fn(async () => ({ statusCode: 201 })) });
const sentBodies = (wp) => wp.sendNotification.mock.calls.map((c) => JSON.parse(c[1]));

beforeEach(() => { jest.clearAllMocks(); HubDevice.deviceKids.mockResolvedValue([]); ClassLink.roundsReadyForPhone.mockResolvedValue([]); });

describe('when it lands: 17:30–17:59 PKT, one minute per phone', () => {
  test('Tue 10:00 PKT → Wed 17:30 + the phone\'s minute; the same minute every day', () => {
    const t = Push.nextAt(at('2025-10-21T05:00:00Z'), 'quiz_reminder', DEV_A);
    expect(new Date(t).toISOString().slice(0, 10)).toBe('2025-10-22');
    expect(pktMin(t)).toBe(17 * 60 + 30 + minuteOf(DEV_A));
    const t2 = Push.nextAt(at('2025-10-22T13:00:00Z'), 'quiz_reminder', DEV_A);
    expect(pktMin(t2)).toBe(pktMin(t));
  });
  test('every phone inside 17:30–17:59; no device → 17:30; the teacher plan stays 18:00', () => {
    for (let i = 0; i < 50; i += 1) {
      const d = crypto.randomBytes(16).toString('base64url');
      const m = pktMin(Push.nextAt(at('2025-10-21T05:00:00Z'), 'quiz_reminder', d));
      expect(m).toBeGreaterThanOrEqual(17 * 60 + 30);
      expect(m).toBeLessThanOrEqual(17 * 60 + 59);
    }
    expect(pktMin(Push.nextAt(at('2025-10-21T05:00:00Z'), 'quiz_reminder'))).toBe(17 * 60 + 30);
    expect(pktMin(Push.nextAt(at('2025-10-21T05:00:00Z'), 'evening_plan', DEV_A))).toBe(18 * 60);
  });
  test('subscribe stores the phone\'s slot', async () => {
    setup();
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    expect(pktMin(Date.parse(rows()[0].next_at))).toBe(17 * 60 + 30 + minuteOf(DEV_A));
  });
});

describe('one notification per phone per evening', () => {
  test('two rows of one phone due together: one send, the other moved on (deduped); another phone still hears', async () => {
    setup();
    const t0 = at('2025-10-21T05:00:00Z');
    await Push.subscribe({ sub: sub('a1'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: t0 });
    await Push.subscribe({ sub: sub('a2'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: t0 });
    await Push.subscribe({ sub: sub('b1'), device_ref: DEV_B, code: 'ABC123', lang: 'en' }, { now: t0 });
    const wp = webpush();
    const out = await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(out).toMatchObject({ sent: 2, deduped: 1 });
    expect(wp.sendNotification).toHaveBeenCalledTimes(2);
    for (const r of rows()) expect(Date.parse(r.next_at)).toBeGreaterThan(at('2025-10-23T00:00:00Z'));
  });
  test('three ignored reminders: the fourth is not sent and the row is revoked as unopened', async () => {
    setup();
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    rows()[0].unopened_count = 3;
    const wp = webpush();
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(wp.sendNotification).not.toHaveBeenCalled();
    expect(rows()[0]).toMatchObject({ revoked_by: 'unopened', endpoint_enc: null });
  });
});

describe('what it says', () => {
  const ROUND = { class_link_code: 'K7Q2MX', class_id: 'c1', teacher_ref: 't1', class_label_en: 'Class 3', class_label_ur: 'کلاس ۳', round_code: 'R1', ready_at: '2025-10-22T11:00:00Z' };
  test('class-named from roundsReadyForPhone, opening the standing link; EN and UR', async () => {
    setup();
    ClassLink.roundsReadyForPhone.mockResolvedValue([ROUND]);
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    await Push.subscribe({ sub: sub('b'), device_ref: DEV_B, code: 'ABC123', lang: 'ur' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = webpush();
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(ClassLink.roundsReadyForPhone).toHaveBeenCalledWith(DEV_A, '2025-10-22');
    const [en, ur] = sentBodies(wp).sort((x) => (x.lang === 'en' ? -1 : 1));
    expect(en).toMatchObject({ t: 'Jugnu: Class 3 has a new quiz', b: 'Tap to play ▶', url: '/j/K7Q2MX?from=push' });
    expect(ur).toMatchObject({ t: 'جگنو: کلاس ۳ کا نیا کوئز آ گیا', b: 'کھیلنے کے لیے دبائیں ▶', url: '/j/K7Q2MX?from=push' });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_sent', expect.objectContaining({ n: 2, kind: 'quiz_reminder', reason: 'quiz_reminder', round_n: 2, named_n: 0, generic_n: 0 }));
  });
  test('two classes on one phone: one notification naming both', () => {
    const p = Push.payloadFor({ kind: 'quiz_reminder', lang: 'en', quiz_code: 'ABC123' }, { rounds: [ROUND, { ...ROUND, class_link_code: 'P3W8TT', class_label_en: 'Class 5', class_label_ur: 'کلاس ۵' }] });
    expect(p.t).toBe('Jugnu: new quizzes for Class 3 and Class 5');
  });
  test('no round yet (class-link not answering): the hub\'s own line (never a promised quiz) and the quiz link', async () => {
    setup();
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = webpush();
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(sentBodies(wp)[0]).toMatchObject({ t: 'Jugnu: time to play ▶', b: 'A quiz is waiting for you.', url: '/q/ABC123?from=push' });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_sent', expect.objectContaining({ generic_n: 1 }));
  });
  test('names switch OFF: no child name, the students table is never read', async () => {
    setup({ web_quiz_push_remind: true }, [{ id: KID1, student_name: 'Areeba Khan', student_name_urdu: 'اریبہ خان' }]);
    HubDevice.deviceKids.mockResolvedValue([KID1]);
    const read = jest.spyOn(fake, 'from');
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = webpush();
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(JSON.stringify(sentBodies(wp)[0])).not.toMatch(/Areeba/);
    expect(read.mock.calls.map((c) => c[0])).not.toContain('students');
  });
  test('names switch ON: the children\'s first names on this phone (Urdu names for an Urdu phone)', async () => {
    setup({ web_quiz_push_remind: true, web_quiz_push_name_children: true }, [
      { id: KID1, student_name: 'Areeba Khan', student_name_urdu: 'اریبہ خان' }, { id: KID2, student_name: 'Hamza Ali', student_name_urdu: null }]);
    HubDevice.deviceKids.mockResolvedValue([KID1, KID2]);
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    await Push.subscribe({ sub: sub('b'), device_ref: DEV_B, code: 'ABC123', lang: 'ur' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = webpush();
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    const titles = sentBodies(wp).map((b) => b.t).sort();
    expect(titles).toContain('Areeba, Hamza: quiz time!');
    expect(titles).toContain('اریبہ، Hamza: کوئز تیار ہے');
  });
});

describe('the funnel', () => {
  test('push_delivered from the worker\'s show; an unknown tag is refused', () => {
    expect(Push.delivered({ tag: 'jugnu-remind' })).toEqual({ ok: 1 });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_delivered', { kind: 'quiz_reminder', reason: 'quiz_reminder' });
    expect(Push.delivered({ tag: 'x' })).toEqual({ status: 400, err: 'bad_tag' });
  });
  test('the day\'s counts once after 21:00 PKT, never before', async () => {
    setup();
    await Push.subscribe({ sub: sub('a'), device_ref: DEV_A, code: 'ABC123', lang: 'en' }, { now: at('2025-10-22T04:00:00Z') });
    await Push.subscribe({ sub: sub('b'), device_ref: DEV_B, code: 'ABC123', lang: 'en' }, { now: at('2025-10-20T04:00:00Z') });
    rows()[0].last_sent_at = '2025-10-22T12:40:00.000Z';
    rows()[1].revoked_at = '2025-10-22T13:00:00.000Z'; rows()[1].revoked_by = 'unopened';
    expect(await Push.funnelTick(at('2025-10-22T15:00:00Z'))).toBeNull(); // 20:00 PKT
    const out = await Push.funnelTick(at('2025-10-22T16:30:00Z'));      // 21:30 PKT
    expect(out).toEqual({ day: '2025-10-22', live: 1, subscribed: 1, sent: 1, opened: 0, revoked_unopened: 1, revoked_gone: 0, revoked_stop: 0 });
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_funnel_daily', out);
    expect(await Push.funnelTick(at('2025-10-22T17:30:00Z'))).toBeNull(); // once a day
  });
});

test('the generic line in Urdu is the hub\'s own', () => {
  expect(Push.payloadFor({ kind: 'quiz_reminder', lang: 'ur', quiz_code: 'ABC123' })).toMatchObject({ t: 'جگنو: کھیلنے کا وقت ہے ▶', b: 'ایک کوئز آپ کا انتظار کر رہا ہے۔' });
});
