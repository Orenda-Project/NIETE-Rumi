'use strict';
/**
 * Urdu prose a CHILD reads carries Urdu digits (language-protocol §9.4): the message the class gets ("about 5 minutes").
 * A teacher's offer keeps Western digits inside Urdu, as the coaching offer, the lesson-plan offer and the quiz PDF do
 * (the 25 Sep numerals decision, LP_QUIZ_OFFER_NATIVE_DIGITS): the class line a report or offer template carries stays
 * «جماعت 4». Real builders, no mocks beyond the network boundary.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => ({})); // a chemistry renderer the generator loads; never reached by these builders

const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');
const ShareSend = require('../../shared/services/share-send.service');
const { digitsFor } = require('../../shared/config/ux-strings');

describe('Urdu digits in Urdu prose', () => {
  test.each([[true], [false]])('the class message (web %s): Urdu says ۵ منٹ, English keeps 5 minutes', (web) => {
    const ur = Gen.studentMessage({ teacherName: 'Sana', topic: 'Plants', date: '۲۱ نومبر', link: 'https://x.test/q/AB12CD', language: 'ur', web });
    expect(ur).toMatch(/۵ منٹ/);
    expect(ur).not.toMatch(/[0-9] منٹ/);
    const en = Gen.studentMessage({ teacherName: 'Sana', topic: 'Plants', date: '21 Nov', link: 'https://x.test/q/AB12CD', language: 'en', web });
    expect(en).toMatch(/about 5 minutes/);
  });

  test("a teacher template's class line keeps Western digits: جماعت 4 in Urdu, Grade 4 in English", () => {
    const body = (lang) => ShareSend.componentsFor({ kind: 'quiz', grade: 4, subject: 'Science', title: 'Plants' }, { lang })
      .find((c) => c.type === 'body').parameters[1].text;
    expect(body('ur')).toMatch(/جماعت 4/);
    expect(body('ur')).not.toMatch(/[۰-۹]/);
    expect(body('en')).toMatch(/Grade 4/);
  });

  test('digitsFor: ur → ۰–۹, en untouched, never throws on null', () => {
    expect(digitsFor(2025, 'ur')).toBe('۲۰۲۵');
    expect(digitsFor('5-B', 'ur')).toBe('۵-B');
    expect(digitsFor(12, 'en')).toBe('12');
    expect(digitsFor(null, 'ur')).toBe('');
  });
});
