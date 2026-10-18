'use strict';
/**
 * The one order of a child's language (child-language-of.js): pure functions over what the caller holds, no read,
 * no switch. ladder() is the order; classLanguage() / childLanguage() read a child's quiz history. The quiz service and
 * the child language module both require this file and still export the same functions under the same names.
 */
// The two services are loaded only to compare what they hand out: their transport and loggers are faked.
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({}));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const fs = require('fs');
const path = require('path');

const QUIZ = path.join(__dirname, '../../../shared/services/quiz');
// Loaded inside each test, so a missing file is a failed test, not a suite that did not run.
const Order = {
  ladder: (...a) => require('../../../shared/services/quiz/child-language-of').ladder(...a),
  classLanguage: (...a) => require('../../../shared/services/quiz/child-language-of').classLanguage(...a),
  childLanguage: (...a) => require('../../../shared/services/quiz/child-language-of').childLanguage(...a),
};
const own = () => require('../../../shared/services/quiz/child-language-of');
// The modules a file requires, top-level or inside a function, by their path as written.
const requiresOf = (file) => [...fs.readFileSync(path.join(QUIZ, file), 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);

const cls = (language) => ({ language, lessonCode: false });
const lesson = (language) => ({ language, lessonCode: true });
const chosen = (language) => ({ language, source: 'chosen' });
const joined = (language) => ({ language, source: 'join' });

describe('classLanguage / childLanguage over a quiz history (newest first)', () => {
  test.each([
    ['none', null, null, null],
    ['empty', [], null, null],
    ['one class quiz', [cls('ur')], 'ur', 'ur'],
    ['a library lesson before a class quiz', [lesson('ur'), cls('en')], 'en', 'en'],
    ['library lessons only', [lesson('ur'), lesson('en')], null, 'ur'],
    ['an unknown language', [cls('fr')], 'en', 'en'],
  ])('%s → class %p, child %p', (_, history, klass, child) => {
    expect(Order.classLanguage(history)).toBe(klass);
    expect(Order.childLanguage(history)).toBe(child);
  });
});

describe('ladder(): chosen → asked → class quiz → linked → joined → library lesson → null', () => {
  test.each([
    ['nothing', {}, null],
    ['no argument', undefined, null],
    ['a choice beats everything', { own: chosen('ur'), asked: 'en', history: [cls('en')], linked: 'en' }, 'ur'],
    ['asked beats the class quiz', { asked: 'ur', history: [cls('en')], linked: 'en' }, 'ur'],
    ['the class quiz beats the link', { history: [cls('ur')], linked: 'en', own: joined('en') }, 'ur'],
    ['the link beats the join', { history: [lesson('en')], linked: 'ur', own: joined('en') }, 'ur'],
    ['the join beats a library lesson', { history: [lesson('en')], own: joined('ur') }, 'ur'],
    ['a library lesson last', { history: [lesson('ur')] }, 'ur'],
    ['lessons: false stops before a library lesson', { history: [lesson('ur')], lessons: false }, null],
    ['lessons: false still takes the join', { history: [lesson('en')], own: joined('ur'), lessons: false }, 'ur'],
    ['a join row is not a choice', { own: joined('ur'), asked: 'en' }, 'en'],
  ])('%s → %p', (_, args, want) => {
    expect(Order.ladder(args)).toBe(want);
  });
});

describe('one home, same names', () => {
  test('the quiz service and the child language module hand out these very functions', () => {
    const SQ = require('../../../shared/services/quiz/student-quiz.service');
    const CL = require('../../../shared/services/quiz/web-quiz-child-lang');
    expect(SQ.classLanguage).toBe(own().classLanguage);
    expect(SQ.childLanguage).toBe(own().childLanguage);
    expect(CL.ladder).toBe(own().ladder);
  });

  test('it requires nothing but the language clamp, so either side can load it at the top', () => {
    expect(fs.existsSync(path.join(QUIZ, 'child-language-of.js'))).toBe(true);
    expect(requiresOf('child-language-of.js')).toEqual(['../../config/ux-strings']);
  });

  test('the quiz service no longer requires the child language module for the order', () => {
    expect(requiresOf('student-quiz.service.js')).not.toContain('./web-quiz-child-lang');
    expect(requiresOf('student-quiz.service.js')).toContain('./child-language-of');
    expect(requiresOf('web-quiz-child-lang.js')).toContain('./child-language-of');
  });
});
