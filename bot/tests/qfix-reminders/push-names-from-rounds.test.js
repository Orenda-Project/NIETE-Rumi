'use strict';
/**
 * With the naming switch on (web_quiz_push_name_children), the reminder's title named EVERY child the phone holds
 * (namesFor -> deviceKids), not the children whose quiz is waiting: a phone with Ali (Class 3, round tonight) and Sana
 * (already finished it at 17:10) read "Ali, Sana: quiz time!", and Sana's tap found nothing new.
 * When class-link answers with rounds, the names come from rounds[].kids (only the children still waiting; `first_ur`
 * on an Urdu phone, else `first`), one per child, at most 3. namesFor stays for a plain reminder with no round.
 * Switch off: class-link is asked without kids (as before) and a name it sends anyway is never shown.
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
const DEV = 'CCCCCCCCCCCCCCCCCCCCCC';
const ALI = '55555555-5555-4555-8555-555555555555';
const SANA = '66666666-6666-4666-8666-666666666666';
const BILAL = '77777777-7777-4777-8777-777777777777';
const R3 = { class_link_code: 'K7Q2MX', class_label_en: 'Class 3', class_label_ur: 'کلاس ۳' };
const R5 = { class_link_code: 'P3W8TT', class_label_en: 'Class 5', class_label_ur: 'کلاس ۵' };
const HUB = '/h/tok.en?from=push';
const at = (iso) => Date.parse(iso);
const row = (lang) => ({ kind: 'quiz_reminder', lang, quiz_code: 'ABC123', device_ref: DEV });
const kid = (student_id, first, first_ur = null) => ({ student_id, first, first_ur });

describe('payloadFor: names come from the rounds when there are rounds', () => {
  test('Ali waiting, Sana finished: only Ali, even when the phone\'s names list both', () => {
    const p = Push.payloadFor(row('en'), { rounds: [{ ...R3, kids: [kid(ALI, 'Ali', 'علی')] }], names: ['Ali', 'Sana'] });
    expect(p).toMatchObject({ t: 'Ali: quiz time!', b: 'Tap to play ▶', url: '/j/K7Q2MX?from=push' });
  });
  test('Urdu phone: first_ur, else the English first name', () => {
    const p = Push.payloadFor(row('ur'), { rounds: [{ ...R3, kids: [kid(ALI, 'Ali', 'علی'), kid(BILAL, 'Bilal')] }] });
    expect(p.t).toBe('علی، Bilal: کوئز تیار ہے');
  });
  test('two classes: every waiting child once (a child in both rounds counted once), the first class for the tap', () => {
    const p = Push.payloadFor(row('en'), {
      rounds: [{ ...R3, kids: [kid(ALI, 'Ali')] }, { ...R5, kids: [kid(BILAL, 'Bilal'), kid(ALI, 'Ali')] }], hub: HUB,
    });
    expect(p).toMatchObject({ t: 'Ali, Bilal: quiz time!', url: '/j/K7Q2MX?from=push' });
  });
  test('at most three names', () => {
    const many = ['Ali', 'Bilal', 'Dua', 'Eman'].map((n, i) => kid(`8888888${i}-8888-4888-8888-888888888888`, n));
    expect(Push.payloadFor(row('en'), { rounds: [{ ...R3, kids: many }] }).t).toBe('Ali, Bilal, Dua: quiz time!');
  });
  test('rounds whose kids carry no names (switch off at the source): the class line, never the phone\'s names', () => {
    const p = Push.payloadFor(row('en'), { rounds: [{ ...R3, kids: [{ student_id: ALI }] }], names: ['Sana'] });
    expect(p).toMatchObject({ t: 'Jugnu: Class 3 has a new quiz', url: '/j/K7Q2MX?from=push' });
  });
  test('no round: the phone\'s names, as before (a plain reminder)', () => {
    expect(Push.payloadFor(row('en'), { names: ['Ali', 'Sana'] }).t).toBe('Ali, Sana: quiz time!');
  });
});

describe('dueTick: the waiting children, read from class-link', () => {
  let fake;
  function setup(settings) {
    fake = makeFake({
      app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
      web_quiz_push_subscriptions: [],
      students: [{ id: ALI, student_name: 'Ali Raza', student_name_urdu: 'علی رضا' }, { id: SANA, student_name: 'Sana Iqbal', student_name_urdu: 'ثنا اقبال' }],
    });
    supabase.from = (t) => fake.from(t);
    Object.assign(process.env, ENV);
    Push.__reset();
  }
  async function tick(lang) {
    HubDevice.deviceKids.mockResolvedValue([ALI, SANA]);
    await Push.subscribe({ sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/n', keys: { p256dh: 'p', auth: 'a' } }, device_ref: DEV, code: 'ABC123', lang }, { now: at('2025-10-21T05:00:00Z') });
    const wp = { sendNotification: jest.fn(async () => ({ statusCode: 201 })) };
    await Push.dueTick(at('2025-10-22T13:05:00Z'), { webpush: wp });
    expect(wp.sendNotification).toHaveBeenCalledTimes(1);
    return JSON.parse(wp.sendNotification.mock.calls[0][1]);
  }
  beforeEach(() => { jest.clearAllMocks(); ClassLink.roundsReadyForPhone.mockResolvedValue([]); });

  test.each([['en', 'Ali: quiz time!'], ['ur', 'علی: کوئز تیار ہے']])('names ON (%s), Ali waiting and Sana finished: "%s", Class 3\'s link', async (lang, title) => {
    setup({ web_quiz_push_remind: true, web_quiz_push_name_children: true });
    ClassLink.roundsReadyForPhone.mockResolvedValue([{ ...R3, kids: [kid(ALI, 'Ali', 'علی')] }]);
    const read = jest.spyOn(fake, 'from');
    const body = await tick(lang);
    expect(ClassLink.roundsReadyForPhone).toHaveBeenCalledWith(DEV, '2025-10-22', { withKids: true });
    expect(body).toMatchObject({ t: title, url: '/j/K7Q2MX?from=push' });
    expect(JSON.stringify(body)).not.toMatch(/Sana|ثنا/);
    // the phone's own names list is not read when class-link answered: no students read from the push service
    expect(read.mock.calls.map((c) => c[0])).not.toContain('students');
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_sent', expect.objectContaining({ named_n: 1, round_n: 0, generic_n: 0 }));
  });

  test('names ON, no round tonight: the phone\'s names (plain reminder, unchanged)', async () => {
    setup({ web_quiz_push_remind: true, web_quiz_push_name_children: true });
    const body = await tick('en');
    expect(body.t).toBe('Ali, Sana: quiz time!');
  });

  test('names OFF: class-link is asked without kids, and a name in its answer is never shown', async () => {
    setup({ web_quiz_push_remind: true });
    ClassLink.roundsReadyForPhone.mockResolvedValue([{ ...R3, kids: [kid(ALI, 'Ali', 'علی')] }]);
    const body = await tick('en');
    expect(ClassLink.roundsReadyForPhone).toHaveBeenCalledWith(DEV, '2025-10-22');
    expect(body).toMatchObject({ t: 'Jugnu: Class 3 has a new quiz', url: '/j/K7Q2MX?from=push' });
    expect(JSON.stringify(body)).not.toMatch(/Ali|علی/);
    expect(logEvent).toHaveBeenCalledWith('web_quiz.push_sent', expect.objectContaining({ named_n: 0, round_n: 1 }));
  });
});
