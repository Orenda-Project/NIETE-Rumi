'use strict';
/**
 * The notification as the lead ruled it (take A, class-named; amendments 2 and 3):
 *  - one class:  title "Jugnu: Class 3 has a new quiz" / «جگنو: کلاس ۳ کا نیا کوئز آ گیا», body "Tap to play ▶";
 *    the tap opens that class's standing link;
 *  - two or more: "Jugnu: new quizzes for Class 3 and Class 5" when it fits 60 code points, else
 *    "Jugnu: new quizzes are ready";
 *  - no class known: "Jugnu: time to play ▶", and the tap lands on the hub of the children this phone is trusted with
 *    (/h/<token>?from=push), never on the finished quiz's code; with no child known, the quiz link stays the fallback;
 *  - children's names (policy switch only): "<names>: quiz time!".
 * Supabase (in-memory), deviceKids, class-link and web-push are the faked boundaries. Invented children only.
 */
process.env.WEB_QUIZ_TOKEN_SECRET = 'unit-token-secret-not-a-secret-0123456789';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));
jest.mock('../../shared/services/quiz/web-quiz-class-link', () => ({ roundsReadyForPhone: jest.fn(async () => []) }));

const crypto = require('crypto');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const HubDevice = require('../../shared/services/quiz/web-quiz-hub-device');
const ClassLink = require('../../shared/services/quiz/web-quiz-class-link');
const T = require('../../shared/services/quiz/web-quiz-token');
const Push = require('../../shared/services/push/web-quiz-push.service');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const DEV = 'AAAAAAAAAAAAAAAAAAAAAA';
const KID1 = '11111111-1111-4111-8111-111111111111';
const KID2 = '22222222-2222-4222-8222-222222222222';
const R3 = { class_link_code: 'K7Q2MX', class_label_en: 'Class 3', class_label_ur: 'کلاس ۳' };
const R5 = { class_link_code: 'P3W8TT', class_label_en: 'Class 5', class_label_ur: 'کلاس ۵' };
const at = (iso) => Date.parse(iso);
const cp = (s) => [...s].length;
const row = (lang) => ({ kind: 'quiz_reminder', lang, quiz_code: 'ABC123', device_ref: DEV });

describe('payloadFor: take A', () => {
  test.each([
    ['en', 'Jugnu: Class 3 has a new quiz', 'Tap to play ▶'],
    ['ur', 'جگنو: کلاس ۳ کا نیا کوئز آ گیا', 'کھیلنے کے لیے دبائیں ▶'],
  ])('one class (%s): class-named title, Tap to play, the standing link', (lang, t, b) => {
    expect(Push.payloadFor(row(lang), { rounds: [R3] })).toMatchObject({ t, b, url: '/j/K7Q2MX?from=push' });
  });
  test.each([
    ['en', 'Jugnu: new quizzes for Class 3 and Class 5'],
    ['ur', 'جگنو: کلاس ۳ اور کلاس ۵ کے نئے کوئز'],
  ])('two classes (%s): both named when it fits 60 code points', (lang, t) => {
    const p = Push.payloadFor(row(lang), { rounds: [R3, R5] });
    expect(p.t).toBe(t);
    expect(cp(p.t)).toBeLessThanOrEqual(60);
    expect(p.url).toBe('/j/K7Q2MX?from=push');
  });
  test('many long class labels: the short line', () => {
    const long = ['A', 'B', 'C', 'D'].map((x) => ({ class_link_code: `CL${x}234`, class_label_en: `Class 3 Section ${x}`, class_label_ur: `کلاس ۳ سیکشن ${x}` }));
    expect(Push.payloadFor(row('en'), { rounds: long }).t).toBe('Jugnu: new quizzes are ready');
    expect(Push.payloadFor(row('ur'), { rounds: long }).t).toBe('جگنو: نئے کوئز تیار ہیں');
  });
  test.each([
    ['en', 'Jugnu: time to play ▶', 'A game is waiting for you.'],
    ['ur', 'جگنو: کھیلنے کا وقت ہے ▶', 'ایک کھیل آپ کا انتظار کر رہا ہے۔'],
  ])('no class known (%s): time to play, opening the given hub', (lang, t, b) => {
    expect(Push.payloadFor(row(lang), { hub: '/h/tok.en?from=push' })).toMatchObject({ t, b, url: '/h/tok.en?from=push' });
  });
  test('no class and no hub: the quiz link is the last fallback', () => {
    expect(Push.payloadFor(row('en'), {}).url).toBe('/q/ABC123?from=push');
  });
  test('names (policy switch): "<names>: quiz time!"', () => {
    expect(Push.payloadFor(row('en'), { names: ['Areeba', 'Hamza'], rounds: [R3] }).t).toBe('Areeba, Hamza: quiz time!');
    expect(Push.payloadFor(row('ur'), { names: ['اریبہ', 'حمزہ'], rounds: [R3] }).t).toBe('اریبہ، حمزہ: کوئز تیار ہے');
  });
  test('every title fits 60 code points', () => {
    for (const lang of ['en', 'ur']) {
      for (const opt of [{ rounds: [R3] }, { rounds: [R3, R5] }, {}, { names: ['Areeba', 'Hamza', 'Zainab'] }]) {
        expect(cp(Push.payloadFor(row(lang), opt).t)).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe('dueTick: the generic reminder opens the phone\'s own hub', () => {
  function setup() {
    const fake = makeFake({ app_settings: [{ key: 'web_quiz_push_remind', value: true }], web_quiz_push_subscriptions: [] });
    supabase.from = (t) => fake.from(t);
    Object.assign(process.env, ENV);
    Push.__reset();
  }
  beforeEach(() => { jest.clearAllMocks(); ClassLink.roundsReadyForPhone.mockResolvedValue([]); });
  test('the children this phone may play as: a hub token for them, ?from=push; never the finished quiz', async () => {
    setup();
    HubDevice.deviceKids.mockResolvedValue([KID1, KID2]);
    await Push.subscribe({ sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: 'p', auth: 'a' } }, device_ref: DEV, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    const body = JSON.parse(wp.sendNotification.mock.calls[0][1]);
    expect(body.t).toBe('Jugnu: time to play ▶');
    const m = /^\/h\/([A-Za-z0-9._-]+)\?from=push$/.exec(body.url);
    expect(m).not.toBeNull();
    expect(T.verify(m[1], 'h').ids.sort()).toEqual([KID1, KID2]);
  });
  test('no child known on the phone (or the lookup down): the quiz link', async () => {
    setup();
    HubDevice.deviceKids.mockResolvedValue([]);
    await Push.subscribe({ sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/b', keys: { p256dh: 'p', auth: 'a' } }, device_ref: DEV, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(JSON.parse(wp.sendNotification.mock.calls[0][1]).url).toBe('/q/ABC123?from=push');
  });
});
