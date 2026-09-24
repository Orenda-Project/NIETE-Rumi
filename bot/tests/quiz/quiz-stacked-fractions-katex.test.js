'use strict';
/**
 * A flat `$2/3$` is drawn STACKED with the real KaTeX (`mfrac`) on the card and
 * the teacher PDF — the root suite stubs KaTeX, so only this suite can see it.
 *
 *   cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest tests/quiz/quiz-stacked-fractions-katex.test.js
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const Card = require('../../shared/services/quiz/transcript-quiz-card');
const renderTeacherHtml = require('../../shared/templates/transcript-quiz-teacher.template');

const bodyOf = (html) => html.slice(html.indexOf('<body'));
const fracs = (html) => (bodyOf(html).match(/class="mfrac"/g) || []).length;

describe.each([
  ['en', 'Which is larger, $2/3$ or $3/5$?'],
  ['ur', 'کون سا بڑا ہے، $2/3$ یا $3/5$؟'],
])('the %s card', (language, stem) => {
  test('stacks every fraction in the stem and the options', () => {
    const html = Card.renderQuestionCardHtml({
      stem, options: ['$2/3$', '$3/5$', language === 'ur' ? 'دونوں برابر' : 'equal'], displayOrder: [0, 1, 2], language, questionNumber: 1, total: 8,
    });
    expect(fracs(html)).toBe(4);
    expect(bodyOf(html)).not.toMatch(/katex-error/);
  });
});

test('the teacher PDF stacks them too', () => {
  const html = renderTeacherHtml({
    topic: 'Compare unlike fractions', teacherName: '', grade: '4', date: '24 Sep 2026', link: 'https://wa.me/0',
    digest: { subject: 'maths', slos: [{ id: 'S1', statement: 'compare unlike fractions', taught_level: 'apply' }] },
    questions: [{
      question_text: 'Which is larger, $2/3$ or $3/5$?', option_a: '$2/3$', option_b: '$3/5$', option_c: 'equal', correct_option: 'A',
      external_id: 'tq:x:S1:1', media: { display_order: [0, 1, 2] }, difficulty_level: 3,
    }],
    lessonSummary: 'Today’s lesson plans comparing unlike fractions.', language: 'en', contentLanguage: 'en',
  });
  expect(fracs(html)).toBeGreaterThanOrEqual(4);
});
