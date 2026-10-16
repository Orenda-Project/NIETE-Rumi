'use strict';
/**
 * Which words are a quiz request under the one door, and which source they carry (the quiz_cmd event's src):
 * the class message's line prefills exactly `quiz` (class_msg), the shared card's `quiz please` / «کوئز دکھائیں»
 * and `jugnu` / «جگنو» (card_share); `/quiz` is typed. A JUGNU- or QUIZ- code and STOP are
 * NEVER quiz-shaped, so they keep their own handlers and never reach the resolver.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const { isQuizMenuRequest } = require('../../shared/services/quiz/quiz-menu-request');
const OneDoor = require('../../shared/services/first-touch/one-door.service');

const quizShaped = (t) => isQuizMenuRequest(t) || OneDoor.isReturnWord(t);

test.each([
  ['/quiz', 'text', 'typed'], ['/Quiz fractions', 'text', 'typed'], ['quiz', 'text', 'class_msg'], ['Quiz', 'text', 'class_msg'],
  ['quiz please', 'text', 'card_share'], ['کوئز دکھائیں', 'text', 'card_share'], ['jugnu', 'text', 'card_share'], ['جگنو', 'text', 'card_share'],
  ['mera quiz', 'text', 'typed'], ['کوئز', 'text', 'typed'], ['', 'menu', 'menu'], ['', 'home', 'home'],
])('%s via %s → src %s', (body, door, src) => {
  expect(OneDoor.srcOf(body, door)).toBe(src);
});

test.each(['JUGNU-7KQ2', 'jugnu-abcd', 'QUIZ-AB12CD', 'quiz-ab12', 'STOP', 'stop', 'jugnu what is a noun', 'jugnu jugnu'])('%s is not quiz-shaped (its own handler keeps it)', (t) => {
  expect(quizShaped(t)).toBe(false);
});

test.each(['jugnu', 'Jugnu', 'JUGNU!', ' jugnu ', 'جگنو', 'جگنو۔'])('%s is the return word', (t) => {
  expect(OneDoor.isReturnWord(t)).toBe(true);
});

test('the reply body per side and script: teacher / unknown in Urdu or both; buttons ≤ 20 code points', () => {
  for (const side of ['teacher', 'unknown']) {
    for (const lang of ['ur', 'bi']) {
      const m = OneDoor.messageFor(side, lang);
      expect(m.body.length).toBeGreaterThan(20);
      expect(m.body.length).toBeLessThanOrEqual(1024);
      expect([...m.button].length).toBeLessThanOrEqual(20);
      expect(m.body).not.toMatch(/https?:\/\//);   // the body carries no URL (IAB §2.6): the button does
    }
  }
  expect(OneDoor.messageFor('teacher', 'ur')).toEqual({ body: expect.stringContaining('آپ کا کوئز ہوم'), button: 'کوئز ہوم کھولیں' });
});
