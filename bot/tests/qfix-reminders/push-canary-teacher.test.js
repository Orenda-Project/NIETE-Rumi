'use strict';
/**
 * The reminder's canary names one sector ({regions}) or schools ({school_ids}). A quiz's school was found only through
 * its share code's class, and about 4 in 10 sittings are on a code that carries no class, so those children never saw
 * the ask even inside the canary sector: the canary measured class-linked teachers, not the sector. When the code
 * names no class (or its class has no school), the code's teacher's school decides. A class's own school still wins,
 * and a class list ({class_ids}) still matches only a class.
 * Supabase (in-memory) and deviceKids are the faked boundaries; invented ids.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/web-quiz-hub-device', () => ({ deviceKids: jest.fn(async () => []) }));

const crypto = require('crypto');
const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const Push = require('../../shared/services/push/web-quiz-push.service');

const ENV = {
  WQ_PUSH_VAPID_PUBLIC: 'BPub', WQ_PUSH_VAPID_PRIVATE: 'priv', WQ_PUSH_VAPID_SUBJECT: 'mailto:test@example.org',
  WQ_PUSH_ENC_KEY: crypto.randomBytes(32).toString('base64'), WQ_PUSH_HASH_SALT: 'salt-for-tests',
};
const S_IN = 'aaaaaaaa-0000-4000-8000-000000000011';
const S_OUT = 'aaaaaaaa-0000-4000-8000-000000000012';
const C_OUT = 'cccccccc-0000-4000-8000-000000000012';
const C_NOSCH = 'cccccccc-0000-4000-8000-000000000013';
const T_IN = 'dddddddd-0000-4000-8000-000000000011';
const T_OUT = 'dddddddd-0000-4000-8000-000000000012';
const T_NOSCH = 'dddddddd-0000-4000-8000-000000000013';
const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/y', keys: { p256dh: 'p', auth: 'a' } };

function setup(canary) {
  const fake = makeFake({
    app_settings: [{ key: 'web_quiz_push_remind', value: true }, { key: 'web_quiz_push_canary', value: canary }],
    web_quiz_push_subscriptions: [],
    schools: [{ id: S_IN, region: 'Tarnol' }, { id: S_OUT, region: 'Sihala' }],
    classes: [{ id: C_OUT, school_id: S_OUT }, { id: C_NOSCH, school_id: null }],
    users: [{ id: T_IN, school_id: S_IN }, { id: T_OUT, school_id: S_OUT }, { id: T_NOSCH, school_id: null }],
    quiz_share_codes: [
      { id: 'q1', code: 'NOCLIN', class_id: null, teacher_user_id: T_IN },
      { id: 'q2', code: 'NOCLOT', class_id: null, teacher_user_id: T_OUT },
      { id: 'q3', code: 'NOCLNS', class_id: null, teacher_user_id: T_NOSCH },
      { id: 'q4', code: 'NOCLNT', class_id: null, teacher_user_id: null },
      { id: 'q5', code: 'CLOUTT', class_id: C_OUT, teacher_user_id: T_IN },
      { id: 'q6', code: 'CLNOSC', class_id: C_NOSCH, teacher_user_id: T_IN },
    ],
  });
  supabase.from = (t) => fake.from(t);
  Object.assign(process.env, ENV);
  Push.__reset();
  return fake;
}
const ask = async (code) => (await Push.keyFor({ code })).ask;

describe('a code with no class: the teacher\'s school decides', () => {
  test('sector canary: the teacher\'s school in the sector asks; another sector, no school, no teacher do not', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask('NOCLIN')).toBe(true);
    expect(await ask('NOCLOT')).toBe(false);
    expect(await ask('NOCLNS')).toBe(false);
    expect(await ask('NOCLNT')).toBe(false);
  });
  test('school canary: the teacher\'s school listed asks', async () => {
    setup({ school_ids: [S_IN] });
    expect(await ask('NOCLIN')).toBe(true);
    expect(await ask('NOCLOT')).toBe(false);
  });
  test('a class without a school: the teacher\'s school', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask('CLNOSC')).toBe(true);
  });
  test('the class\'s own school wins over the teacher\'s', async () => {
    setup({ regions: ['Tarnol'] });
    expect(await ask('CLOUTT')).toBe(false);
  });
  test('a class list never matches a code without a class', async () => {
    setup({ class_ids: [C_OUT] });
    expect(await ask('NOCLIN')).toBe(false);
    expect(await ask('CLOUTT')).toBe(true);
  });
  test('subscribe follows the same answer', async () => {
    const fake = setup({ regions: ['Tarnol'] });
    expect(await Push.subscribe({ sub: SUB, device_ref: 'CCCCCCCCCCCCCCCCCCCCCC', code: 'NOCLOT', lang: 'en' })).toEqual({ status: 409, err: 'canary' });
    expect(await Push.subscribe({ sub: SUB, device_ref: 'CCCCCCCCCCCCCCCCCCCCCC', code: 'NOCLIN', lang: 'en' })).toEqual({ ok: 1 });
    expect(fake.db.web_quiz_push_subscriptions).toHaveLength(1);
  });
});
