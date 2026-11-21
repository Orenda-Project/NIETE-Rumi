/**
 * Is the WHOLE message just a greeting? (utils/greeting.js, pure)
 *
 * Sandbox, operator's own phone, 2026-10-19: a brand-new person who said "hi" got TWO greetings —
 * the general AI reply ("Aoa, I can make your lesson plan, observation…") and then the
 * registration invite ("Welcome to NIETE"). For a greeting and nothing else, the invite is the
 * reply. Anything with a real request in it is not greeting-only and is answered as usual.
 */
const { isGreetingOnly } = require('../../bot/shared/utils/greeting');

describe('isGreetingOnly — greetings', () => {
  test.each([
    'hi', 'Hi!', 'HIIII', 'hii', 'hello', 'Hellooo 👋', 'hey', 'hey!!', 'Hi 😊',
    'salam', 'Salaam!', 'slam', 'aoa', 'AOA', 'A.O.A', 'Aoa!!',
    'Assalam o alaikum', 'Assalam-o-Alaikum!!', 'assalamualaikum', 'Asalam o alikum sir',
    'Assalamu alaikum wa rahmatullah', 'walaikum assalam',
    'السلام علیکم', 'السلام عليكم', 'السلام علیکم ورحمۃ اللہ', 'السلام علیکم ورحمۃ اللہ وبرکاتہ',
    'اسلام علیکم', 'سلام', 'ہیلو', 'وعلیکم السلام',
    'aoa sir', 'salam ji', 'hello everyone', 'Good morning', 'good morning madam',
    'hello, how are you?', 'aoa kaise hain',
  ])('%j is greeting-only', (body) => {
    expect(isGreetingOnly(body)).toBe(true);
  });
});

describe('isGreetingOnly — not greeting-only', () => {
  test.each([
    'aoa lesson plan chahiye',
    'hi, I need a lesson plan',
    'hello can you make a quiz for class 5',
    'salam mujhe register karna hai',
    'السلام علیکم مجھے سبق کا منصوبہ چاہیے',
    'hi /menu',
    'Hello class 5 science',
    'hiring', 'history', 'high',
    'thanks', 'ok', 'Register',
    '👋',
    '',
    '   ',
    null,
    undefined,
  ])('%j is not greeting-only', (body) => {
    expect(isGreetingOnly(body)).toBe(false);
  });
});
