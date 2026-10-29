/**
 * G5 Urdu Q6 is only the lesson-7 verses (bd-5jmnfj.4.51.11).
 *
 * The paper used to offer "central idea of the Naat" OR "explain these lines".
 * The book prints no central idea for the Naat, so the key could only say
 * "check the book", and religious text is never authored here. The book also
 * tells teachers to give non-Muslim students another lesson in its place.
 * Amena, 29 Oct: drop the Naat; Q6 is the «ندی کی فریاد» verses alone.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const ID = 'fde_g5_2027';
const URDU = Patterns.get(ID).subjects.urdu;
const NOW = '2026-10-29T07:00:00.000Z';

const items = (n, slot, make) => Array.from({ length: n }, (_, i) => ({ slot, ...make(i) }));

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
}

function urduExam() {
  const raw = { unseen: {
    objective: { MCQs: items(20, 'urdu.A.Q1', (i) => ({ question: `سوال ${i + 1}؟`, options: ['ایک', 'دو', 'تین', 'چار'], answer: 'ب' })) },
    subjective: {
      'Comprehension Passage': items(1, 'urdu.B.Q2', () => ({ passage: 'ایک دن', answer: 'جواب' })),
      'Word Meanings': items(1, 'urdu.C.Q3', () => ({ words: ['سانحہ', 'شاطر'], answer: 'معنی' })),
      'Rewrite Sentences': items(4, 'urdu.C.Q4', (i) => ({ question: `ہدایت ${i + 1}`, answer: 'جواب' })),
      'Word Sentences': items(1, 'urdu.C.Q5', () => ({ words: ['باغ', 'پانی'], answer: 'جملے' })),
      'Poem Explanation': items(1, 'urdu.C.Q6', () => ({ question: 'درج ذیل اشعار کا مفہوم واضح کریں۔', passage: 'سطر ایک\nسطر دو\nسطر تین\nسطر چار', answer: 'مفہوم' })),
      'Picture Description': items(1, 'urdu.C.Q7', () => ({ question: 'باغ کی سیر', words: ['باغ'], answer: 'تصویر' })),
      'Paragraph Writing': items(2, 'urdu.C.Q8', () => ({ question: 'میرا وطن', answer: 'خاکہ' })),
      'Story Writing': items(2, 'urdu.C.Q9', () => ({ question: 'کہانی', answer: 'کہانی' })),
      'Letter Writing': items(2, 'urdu.C.Q10', () => ({ question: 'خط لکھیں۔', answer: 'خط' })),
    } } };
  return applyLayout(raw, URDU, { kind: 'fde' }, { now: NOW }).examJson;
}

describe('G5 Urdu Q6 has no Naat option', () => {
  const q6 = URDU.sections.flatMap((s) => s.slots).find((s) => s.slot === 'urdu.C.Q6');

  it('the pattern offers only the lesson-7 verses', () => {
    expect((q6.alternatives || []).some((a) => a.kind === 'fixed')).toBe(false);
    expect(JSON.stringify(q6)).not.toContain('نعت');
    expect(JSON.stringify(q6)).not.toMatch(/naat/i);
  });

  it('no supply line asks the teacher for the Naat', () => {
    const exam = urduExam();
    expect(exam._layout.supplies.map((s) => s.kind)).not.toContain('naat');
  });

  it('the paper prints no نعت and no یا in Q6, and the cover offers no either/or', () => {
    const text = visible(R.renderPaper({ examJson: urduExam(), grade: 5, subject: 'urdu', answerLines: true }));
    expect(text).not.toContain('نعت');
    expect(text).toContain('درج ذیل اشعار کا مفہوم واضح کریں۔');
    expect(text).not.toContain('دو میں سے ایک');
    expect(text).not.toMatch(/واضح کریں۔ یا /);
  });

  it('the key has no Naat row', () => {
    const text = visible(R.renderMarkingScheme({ examJson: urduExam(), grade: 5, subject: 'urdu' }));
    expect(text).not.toContain('نعت');
  });
});
