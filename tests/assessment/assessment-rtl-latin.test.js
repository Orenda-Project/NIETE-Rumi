/**
 * An Urdu paper is printed dir="rtl", and the bidi algorithm reorders every
 * Latin run inside it that is not isolated AND given its own direction.
 *
 * What the teacher received on 5 Sep (prod, G1 General Knowledge): the marking
 * header columns mirrored so "Student Name" sat on the right of its own value,
 * "[1 mark]" printed as "[mark 1]", and every instruction lost its full stop to
 * the front of the line — ".Read all questions carefully before answering.1".
 * The Urdu itself was correct throughout. It was the ENGLISH that was jumbled.
 *
 * `unicode-bidi: isolate` alone is not enough: it stops a run from reordering
 * its NEIGHBOURS, but the run still inherits the paragraph's RTL direction, so
 * its own words and trailing punctuation still lay out right-to-left. The pair
 * that actually works is `direction: ltr` + `unicode-bidi: isolate`.
 */
const { renderPaper } = require('../../bot/shared/services/assessment/assessment-paper.renderer');

const URDU_EXAM = {
  unseen: {
    objective: {
      MCQs: [{
        question: 'سب سے تیز رفتار سواری کون سی ہے؟',
        options: ['سائیکل', 'ہوائی جہاز', 'کار', 'تانگہ'],
        answer: 'ہوائی جہاز',
        marks: 1,
      }],
    },
  },
};

function renderUrdu() {
  return renderPaper({
    examJson: URDU_EXAM, grade: 1, subject: 'general_knowledge', answerLines: true,
  });
}

describe('an Urdu paper does not let RTL reorder its English', () => {
  test('the document really is RTL — otherwise this suite proves nothing', () => {
    expect(renderUrdu()).toContain('dir="rtl"');
  });

  test('every Latin-bearing class is given a direction, not just isolation', () => {
    const css = renderUrdu();
    // The bug: `unicode-bidi: isolate` with no `direction`.
    for (const cls of ['.marks', '.instructions', 'table.marks-header', '.type']) {
      const rule = new RegExp(
        `${cls.replace('.', '\\.')}[^{}]*\\{[^}]*direction:\\s*ltr[^}]*\\}`,
      );
      expect(css).toMatch(rule);
    }
  });

  test('the marking header and instructions are left-aligned, not mirrored', () => {
    const css = renderUrdu();
    expect(css).toMatch(/table\.marks-header[^{}]*\{[^}]*text-align:\s*left/);
    expect(css).toMatch(/\.instructions[^{}]*\{[^}]*text-align:\s*left/);
  });
});
