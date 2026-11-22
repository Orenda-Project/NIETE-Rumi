'use strict';
/**
 * A phone with quizzes ready in TWO classes gets one notification naming both ("Jugnu: new quizzes for Class 3 and
 * Class 5"). Its tap must not open only the first class's standing link: that page's chips are Class 3's children, so
 * the Class 5 child the title just promised a quiz to lands somewhere their name is not. The tap opens the phone's own
 * hub (/h/<token>?from=push), which carries every child on the phone; with no child known on the phone, the first
 * class's link stays the fallback. One class (even two children in it) keeps its standing link.
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
const DEV = 'BBBBBBBBBBBBBBBBBBBBBB';
const KID1 = '33333333-3333-4333-8333-333333333333';
const KID2 = '44444444-4444-4444-8444-444444444444';
const R3 = { class_link_code: 'K7Q2MX', class_label_en: 'Class 3', class_label_ur: 'کلاس ۳' };
const R5 = { class_link_code: 'P3W8TT', class_label_en: 'Class 5', class_label_ur: 'کلاس ۵' };
const HUB = '/h/tok.en?from=push';
const at = (iso) => Date.parse(iso);
const row = (lang) => ({ kind: 'quiz_reminder', lang, quiz_code: 'ABC123', device_ref: DEV });

describe('payloadFor: where the tap goes', () => {
  test.each(['en', 'ur'])('two classes (%s): the phone\'s own hub, not the first class', (lang) => {
    expect(Push.payloadFor(row(lang), { rounds: [R3, R5], hub: HUB }).url).toBe(HUB);
  });
  test('two classes and no child known on the phone: the first class\'s standing link', () => {
    expect(Push.payloadFor(row('en'), { rounds: [R3, R5] }).url).toBe('/j/K7Q2MX?from=push');
  });
  test('one class, two children in it (two rounds, one code): that class\'s standing link', () => {
    expect(Push.payloadFor(row('en'), { rounds: [R3, { ...R3 }], hub: HUB }).url).toBe('/j/K7Q2MX?from=push');
  });
  test('one class: its standing link even when a hub is known', () => {
    expect(Push.payloadFor(row('en'), { rounds: [R3], hub: HUB }).url).toBe('/j/K7Q2MX?from=push');
  });
  test('names (policy switch) with two classes: the hub too', () => {
    expect(Push.payloadFor(row('en'), { names: ['Areeba', 'Hamza'], rounds: [R3, R5], hub: HUB }).url).toBe(HUB);
  });
});

describe('dueTick: a two-class phone\'s notification opens its hub', () => {
  function setup() {
    const fake = makeFake({ app_settings: [{ key: 'web_quiz_push_remind', value: true }], web_quiz_push_subscriptions: [] });
    supabase.from = (t) => fake.from(t);
    Object.assign(process.env, ENV);
    Push.__reset();
  }
  async function sendFor(rounds) {
    setup();
    HubDevice.deviceKids.mockResolvedValue([KID1, KID2]);
    ClassLink.roundsReadyForPhone.mockResolvedValue(rounds);
    await Push.subscribe({ sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/c', keys: { p256dh: 'p', auth: 'a' } }, device_ref: DEV, code: 'ABC123', lang: 'en' }, { now: at('2025-10-21T05:00:00Z') });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    return JSON.parse(wp.sendNotification.mock.calls[0][1]);
  }
  beforeEach(() => { jest.clearAllMocks(); });
  test('Class 3 and Class 5 ready: both named, the tap opens a hub token for every child on the phone', async () => {
    const body = await sendFor([R3, R5]);
    expect(body.t).toBe('Jugnu: new quizzes for Class 3 and Class 5');
    const m = /^\/h\/([A-Za-z0-9._-]+)\?from=push$/.exec(body.url);
    expect(m).not.toBeNull();
    expect(T.verify(m[1], 'h').ids.sort()).toEqual([KID1, KID2]);
  });
  test('Class 3 only: its standing link, as before', async () => {
    const body = await sendFor([R3]);
    expect(body.t).toBe('Jugnu: Class 3 has a new quiz');
    expect(body.url).toBe('/j/K7Q2MX?from=push');
  });
});
