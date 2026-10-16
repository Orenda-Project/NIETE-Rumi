/**
 * Every way a teacher asks to register opens the registration Flow — and only those.
 *
 * The bodies below are the real ones from niete-logs, production, 16 Sep – 16 Oct 2026
 * (names and numbers removed). Before this, only the exact text "/register" opened the
 * Flow: 25 bare "Register", 3 "Register me", "i need to register" and 16 slash
 * near-misses ("/registered", "/ register", "Type/register" …) were answered by the old
 * keyword branch or the AI chat, and none of them got a form.
 *
 * The false positives are real too: "register" is also the attendance register, and a
 * substring match sent those to registration.
 */
const { isRegistrationIntent } = require('../../bot/shared/utils/registration-intent');

describe('isRegistrationIntent — the live requests open the Flow', () => {
  test.each([
    '/register',
    '/Register',
    '/register ',
    ' /register\n',
    '/registered',
    '/registration',
    '/ register',
    '/ Register',
    '/ Registration',
    '/ registered',
    'Type/register',
    'type /register',
    '/registere',
    'register/',
    'Register',
    'register',
    'Register.',
    'Register me',
    'register me please',
    'i need to register',
    'I want to register',
    'get registered',
    'register krna k lye',
    'Registration',
    'how to register',
    'i have to register my account on niete portal',
    'sign up',
    'رجسٹر',
    'رجسٹریشن',
    'مجھے رجسٹر کرنا ہے',
    'رجسٹر کریں',
    '⁦/register⁩',
  ])('%j → opens the Flow', (body) => {
    expect(isRegistrationIntent(body)).toBe(true);
  });
});

describe('isRegistrationIntent — what is NOT a registration request', () => {
  test.each([
    'attendance register',
    'attendence register grade 5b',
    'daily attendence register',
    'Mera registration number kia hai',
    'حاضری رجسٹر',
    'class register photo',
    'Kindly register 03001234567',
    'unregister',
    'I registered my class yesterday and the quiz link did not open for the children, please check',
    'Dear parents, registration for the new session is open till Friday. Please visit the school office with B-form.',
    '/registered students list',
    '/menu',
    'hello',
    '',
    null,
    undefined,
    42,
  ])('%j → not a registration request', (body) => {
    expect(isRegistrationIntent(body)).toBe(false);
  });
});
