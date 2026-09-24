'use strict';
/**
 * An Urdu stem's equation written with a Latin "x" is typeset as ONE
 * left-to-right expression on the card and the teacher PDF — the real KaTeX.
 *
 * Replay (grade 3 Urdu): «تصویر میں 7 x 4 = 28 کی نمائندگی…» was laid out
 * "x 4 = 28 7": the "7" and the Latin run "x 4 = 28" were two bidi runs and the
 * right-to-left paragraph put them in the wrong order. The run order is fixed
 * when the whole equation sits in one `.qm` span (an LTR isolate, mathCss) with
 * its numbers in the order written — asserted here on the rendered markup.
 *
 *   cd bot && NODE_OPTIONS=--no-experimental-webstorage npx jest tests/quiz/quiz-equation-runs-katex.test.js
 */
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));

const Card = require('../../shared/services/quiz/transcript-quiz-card');
const renderTeacherHtml = require('../../shared/templates/transcript-quiz-teacher.template');

const STEM = 'تصویر میں 7 x 4 = 28 کی نمائندگی کے لیے counters کا استعمال کیا گیا ہے۔ یہاں 7 کس چیز کی نمائندگی کرتا ہے؟';
const bodyOf = (html) => html.slice(html.indexOf('<body'));
/** The words a reader sees: the body with every tag (and so every data URI) removed. */
const visibleText = (html) => bodyOf(html).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
/**
 * Each typeset expression as the glyphs KaTeX lays out, in document order —
 * everything inside one `.qm` isolate, with the markup stripped.
 */
function expressions(html) {
  const body = bodyOf(html);
  const out = [];
  const open = /<span class="qm[^"]*">/g;
  let m;
  while ((m = open.exec(body))) {
    const tag = /<\/?span\b[^>]*>/g;
    tag.lastIndex = open.lastIndex;
    let depth = 1;
    let t;
    while (depth && (t = tag.exec(body))) depth += t[0][1] === '/' ? -1 : 1;
    out.push(body.slice(open.lastIndex, t.index).replace(/<[^>]+>/g, '').replace(/\s+/g, ''));
  }
  return out;
}

test('the card: the equation is one expression, 7 × 4 = 28 in the order written', () => {
  const html = Card.renderQuestionCardHtml({
    stem: STEM, options: ['ہر group میں items کی تعداد', 'product', 'groups کی تعداد'], displayOrder: [0, 1, 2], language: 'ur', questionNumber: 6, total: 8,
  });
  expect(expressions(html)).toEqual(['7×4=28']);
  expect(visibleText(html)).not.toMatch(/\d\s*x\s*\d/);
  expect(bodyOf(html)).not.toMatch(/katex-error/);
});

test('the teacher PDF: the same one expression', () => {
  const html = renderTeacherHtml({
    topic: 'Multiply by 6, 7, 8 and 9', teacherName: '', grade: '3', date: '24 Sep 2026', link: 'https://wa.me/0',
    digest: { subject: 'maths', slos: [{ id: 'S1', statement: 'multiply', taught_level: 'apply' }] },
    questions: [{
      question_text: STEM, option_a: 'product', option_b: 'groups کی تعداد', option_c: 'ہر group میں items کی تعداد', correct_option: 'B',
      external_id: 'tq:x:S1:1', media: { display_order: [0, 1, 2] }, difficulty_level: 3,
    }],
    lessonSummary: 'آج کے سبق میں 6، 7، 8 اور 9 سے ضرب سکھائی گئی۔', language: 'ur', contentLanguage: 'ur',
  });
  expect(expressions(html)).toEqual(expect.arrayContaining(['7×4=28']));
  expect(visibleText(html)).not.toMatch(/\d\s*x\s*\d/);
});
