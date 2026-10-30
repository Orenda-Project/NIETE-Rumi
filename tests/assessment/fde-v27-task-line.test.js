/**
 * Urdu Q4 prints each item's task (bd-5jmnfj.4.58.2, v26 finding 1 b+c).
 *
 * v26 g5-urdu-exam.json: the Q4 items carry the task in `main_question` («دیے گئے الفاظ کے لیے
 * گروہی لفظ منتخب کریں:») and only the words in `question`; the renderer printed «ہدایات کے مطابق
 * حل کریں» and then four bare items. An item whose task cannot be told is never printed bare.
 */

const fs = require('fs');
const path = require('path');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { taskLine, q4TaskKnown } = require('../../bot/shared/services/assessment/fde-task-line');

const exam = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v26', 'g5-urdu-trimmed.json'), 'utf8'));
const q4 = () => exam.unseen.subjective['Rewrite Sentences'];
const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const clone = (x) => JSON.parse(JSON.stringify(x));

describe('Q4 prints each item task from main_question', () => {
  const html = R.renderPaper({ examJson: exam, grade: 5, subject: 'urdu' });
  test.each([
    'دیے گئے الفاظ کے لیے گروہی لفظ منتخب کریں',
    'درست حرفِ شرط و جزا کا انتخاب کریں',
    'فعلِ حال کو فعلِ مستقبل میں تبدیل کریں',
    'درج ذیل الفاظ کے ارکان الگ کریں',
  ])('the paper prints «%s»', (task) => {
    const q4html = html.slice(html.indexOf('data-slot="urdu.C.Q4"'), html.indexOf('data-slot="urdu.C.Q4"') + 6000);
    expect(q4html).toContain(task);
  });

  test('Q1 and the other slots do not print their main_question', () => {
    const q1 = exam.unseen.objective.MCQs[0];
    expect(q1.main_question).toBeTruthy();
    expect(html.split(q1.main_question).length).toBe(1);
  });
});

describe('taskLine', () => {
  const slot = { slot: 'urdu.C.Q4', type: 'Rewrite Sentences', kinds: ['group_words'] };
  test('is the main_question when the question lacks it', () => {
    expect(taskLine({ question: 'پتا، بوٹا', main_question: 'گروہی لفظ منتخب کریں:' }, slot)).toBe('گروہی لفظ منتخب کریں:');
  });
  test('is empty when the question already holds it, or on another slot', () => {
    expect(taskLine({ question: 'گروہی لفظ منتخب کریں: پتا', main_question: 'گروہی لفظ منتخب کریں:' }, slot)).toBe('');
    expect(taskLine({ question: 'x', main_question: 'یہ لکھیں' }, { slot: 'urdu.A.Q1', type: 'MCQs' })).toBe('');
  });
  test('q4TaskKnown reads the kind from main_question or question', () => {
    expect(q4TaskKnown({ question: 'پتا', main_question: 'گروہی لفظ منتخب کریں:' })).toBe(true);
    expect(q4TaskKnown({ question: 'کتاب پڑھنا', main_question: ' ' })).toBe(false);
  });
});

describe('a Q4 item with no recognisable task is held, never printed bare', () => {
  test('the layout leaves it out and reports Q4 short', () => {
    const bare = { slot: 'urdu.C.Q4', lines: 0, marks: 1.25, answer: 'کتاب', blooms: 'Understand', question: 'کتاب پڑھنا', main_question: '' };
    const raw = { unseen: { subjective: { 'Rewrite Sentences': [bare, ...clone(q4()).slice(1)] } } };
    const out = applyLayout(raw, U, FDE, {});
    const placed = out.examJson.unseen.subjective['Rewrite Sentences'].map((q) => q.question);
    expect(placed).not.toContain('کتاب پڑھنا');
    expect(out.shortfall).toContainEqual({ slot: 'urdu.C.Q4', missing: 1 });
  });
});
