/**
 * Urdu board-pattern papers, two gaps the sandbox papers showed.
 *
 * 1. Section A gives a Q4 answer away when Q4's key sits in its accepted answers, not in its
 *    `answer`, and Q4 asks about a word list the Q1 stem prints in another order. Q1 «’’گھٹائیں،
 *    بادل، بجلی، موسلادھار بارش‘‘ ان گروہی الفاظ سے کس لفظ کا خیال آتا ہے؟» keyed «برسات» beside
 *    Q4 «گروہی الفاظ کے لیے درست لفظ منتخب کریں: بادل، بجلی، بارش، گھٹائیں۔ …» keyed «موسمِ برسات»,
 *    accepting «برسات». The Q1 item is held: its key is one of Q4's accepted answers, or the Q1
 *    stem carries three or more of Q4's listed words, in any order. Q4 is never touched.
 *
 * 2. The comprehension questions (Q2 الف) print no marking chip when the model writes the
 *    passage's scheme as lump rows on the item and leaves each question's `scheme` null. Each
 *    such question gets one Accuracy point worth its part marks, on its own answer, and is
 *    counted among the rows code wrote (the before-the-exam box line).
 *
 * The recorded papers are sandbox replies (content only, no person in them).
 */

const fs = require('fs');
const path = require('path');

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout, takenNote } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { renderMarkingScheme } = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const U = Patterns.get('fde_g5_2027').subjects.urdu;
const FDE = { kind: 'fde', chapters: null, pages: null };
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', name), 'utf8'));
// Q3/Q5's words and Q6's verse are held against Q1 too (fde-r13-urdu.test.js); this file proves the
// Q4 rule alone, so the paper here carries no Q3, Q5 or Q6.
const q4Only = (exam) => {
  for (const types of Object.values(exam.unseen || {})) {
    for (const [k, list] of Object.entries(types || {})) types[k] = list.filter((q) => !['urdu.C.Q3', 'urdu.C.Q5', 'urdu.C.Q6'].includes(q && q.slot));
  }
  return exam;
};
const ch2 = q4Only(read('r12-urdu-sandbox-chapters_2.json'));
const full1 = read('r12-urdu-sandbox-full_1.json');
const full2 = read('r12-urdu-sandbox-full_2.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

function items(exam, slot) {
  const out = [];
  for (const types of Object.values((exam && exam.unseen) || {})) for (const list of Object.values(types || {})) out.push(...list.filter((q) => q && q.slot === slot));
  return out;
}
const TWIN = '’’گھٹائیں، بادل، بجلی، موسلادھار بارش‘‘ ان گروہی الفاظ سے کس لفظ کا خیال آتا ہے؟';
const q1Count = (exam) => items(exam, 'urdu.A.Q1').length;

describe('urdu Q1 ↔ Q4: a key in Q4\'s accepted answers, or Q4\'s word list reordered', () => {
  test('chapters_2: Q1 ۱۷ (the reordered group-words list, keyed «برسات») is held before the re-ask', () => {
    const before = q1Count(ch2);
    const { examJson } = applyLayout(clone(ch2), U, { kind: 'chapters', chapters: null, pages: null }, { reasked: false });
    const q1 = items(examJson, 'urdu.A.Q1');
    expect(q1.map((q) => q.question)).not.toContain(TWIN);
    expect(q1).toHaveLength(before - 1);
  });

  test('Q4 is untouched: all four items, Q4 ۱ with its list and key', () => {
    const { examJson } = applyLayout(clone(ch2), U, FDE, { reasked: false });
    const q4 = items(examJson, 'urdu.C.Q4');
    expect(q4).toHaveLength(4);
    expect(q4.map((q) => q.answer)).toContain('الف) موسمِ برسات');
  });

  test('every other Q1 item of chapters_2 stays', () => {
    const { examJson } = applyLayout(clone(ch2), U, FDE, { reasked: false });
    const before = items(ch2, 'urdu.A.Q1').map((q) => q.question).filter((s) => s !== TWIN);
    expect(items(examJson, 'urdu.A.Q1').map((q) => q.question).sort()).toEqual(before.sort());
  });

  test('the accepted-answer key alone holds it (a stem with none of Q4\'s list words)', () => {
    const exam = clone(ch2);
    const q1 = items(exam, 'urdu.A.Q1').find((q) => q.question === TWIN);
    q1.question = 'کس موسم میں کسان خوش ہوتے ہیں؟';
    const { examJson } = applyLayout(exam, U, FDE, { reasked: false });
    expect(items(examJson, 'urdu.A.Q1').map((q) => q.question)).not.toContain(q1.question);
  });

  test('the reordered list alone holds it (a key Q4 does not accept)', () => {
    const exam = clone(ch2);
    const q1 = items(exam, 'urdu.A.Q1').find((q) => q.question === TWIN);
    q1.options = ['الف) سردی', 'ب) بادلوں کا موسم', 'ج) گرمی', 'د) خزاں'];
    q1.answer = 'ب) بادلوں کا موسم';
    const { examJson } = applyLayout(exam, U, FDE, { reasked: false });
    expect(items(examJson, 'urdu.A.Q1').map((q) => q.question)).not.toContain(TWIN);
  });

  test('two shared list words are not a twin', () => {
    const exam = clone(ch2);
    const q1 = items(exam, 'urdu.A.Q1').find((q) => q.question === TWIN);
    q1.question = '’’بادل، بجلی، کھیت، کسان‘‘ ان الفاظ میں سے کون سا لفظ آسمان سے تعلق نہیں رکھتا؟';
    q1.options = ['الف) بادل', 'ب) بجلی', 'ج) کھیت', 'د) سورج'];
    q1.answer = 'ج) کھیت';
    const before = q1Count(exam);
    const { examJson } = applyLayout(exam, U, FDE, { reasked: false });
    expect(q1Count(examJson)).toBe(before);
  });

  test('after the one re-ask a held Section C give-away still stays out (the engine tops Section A up again instead)', () => {
    const held = q1Count(applyLayout(clone(ch2), U, FDE, { reasked: false }).examJson);
    const { examJson } = applyLayout(clone(ch2), U, FDE, { reasked: true });
    expect(q1Count(examJson)).toBe(held);
  });
});

function q2(exam) {
  return items(exam, 'urdu.B.Q2')[0];
}
const questionsPart = (q) => q.parts.find((p) => p.key === 'questions');

describe('urdu Q2 (الف): questions left with no scheme get a chip from their own marks', () => {
  test.each([['full_1', full1], ['full_2', full2]])('%s: every Q2 (الف) question carries one A2 point on its own answer', (_, paper) => {
    const { examJson } = normaliseScheme(clone(paper));
    const subs = questionsPart(q2(examJson)).questions;
    expect(subs).toHaveLength(5);
    subs.forEach((sub) => {
      expect(sub.scheme.points).toEqual([{ kind: 'A', marks: 2, text: sub.answer.trim() }]);
    });
  });

  test('full_1: the five filled rows are listed for the box line, one per question', () => {
    const { examJson } = normaliseScheme(clone(full1));
    const rows = (examJson._layout.scheme_shortfall || []).filter((e) => e.slot === 'urdu.B.Q2');
    expect(rows).toHaveLength(5);
    rows.forEach((e) => expect(e.filled_by).toBe('code'));
    expect(new Set(rows.map((e) => e.part)).size).toBe(5);
  });

  test('full_1: the printed scheme puts an A2 chip on every (الف) row and the box counts them', () => {
    const { examJson } = normaliseScheme(clone(full1));
    const html = renderMarkingScheme({ examJson, grade: 5, subject: 'urdu' });
    const rows = html.split('<tr').filter((r) => r.includes('data-row="urdu.B.Q2"') && r.includes('الف:'));
    expect(rows).toHaveLength(5);
    rows.forEach((r) => expect(r).toMatch(/<span class="chip">A2<\/span>/));
    expect(html).not.toContain('سطریں جواب سے بنائی گئی ہیں'); // the process note is not printed on the key (bd-5jmnfj.4.58.9.1)
  });

  test('a question with its own points is left as it is (chapters_1 shape)', () => {
    const paper = clone(full1);
    const sub = questionsPart(q2(paper)).questions[0];
    sub.scheme = { points: [{ kind: 'K', marks: 2, text: 'درست جواب' }], accept: ['امی'] };
    const { examJson } = normaliseScheme(paper);
    expect(questionsPart(q2(examJson)).questions[0].scheme.points).toEqual([{ kind: 'K', marks: 2, text: 'درست جواب' }]);
    expect((examJson._layout.scheme_shortfall || []).filter((e) => e.slot === 'urdu.B.Q2')).toHaveLength(4);
  });

  test('a question with no answer either is not filled', () => {
    const paper = clone(full1);
    delete questionsPart(q2(paper)).questions[2].answer;
    const { examJson } = normaliseScheme(paper);
    expect(questionsPart(q2(examJson)).questions[2].scheme).toBeUndefined();
    expect((examJson._layout.scheme_shortfall || []).filter((e) => e.slot === 'urdu.B.Q2')).toHaveLength(4);
  });

  test('English comprehension questions with no points are left as they are (English is live)', () => {
    const E = Patterns.get('fde_g5_2027').subjects.english;
    const paper = clone(full1);
    paper._layout = { ...paper._layout, subject: 'english', sections: E.sections };
    paper.unseen = { subjective: { 'Comprehension Passage': [{
      slot: 'english.B.Q2', marks: 20, passage: 'Ali walked to school.',
      parts: [{ key: 'questions', questions: [{ question: 'Where did Ali walk?', marks: 2, answer: 'To school.', scheme: null }] }],
    }] } };
    const { examJson } = normaliseScheme(paper);
    const sub = examJson.unseen.subjective['Comprehension Passage'][0].parts[0].questions[0];
    expect(sub.scheme).toBeUndefined();
    expect(examJson._layout.scheme_shortfall).toBeUndefined();
  });
});

describe('urdu Q1 ↔ Q4: a quoted Q4 list is read the same way', () => {
  test('Q4 «کتاب، قلم، کاپی، بستہ، استاد» holds a Q1 stem listing three of them in another order', () => {
    const exam = clone(ch2);
    const q4 = items(exam, 'urdu.C.Q4')[0];
    q4.question = 'درست گروہی لفظ منتخب کریں: یہ الفاظ کس لفظ کے متلازم ہیں؟ «کتاب، قلم، کاپی، بستہ، استاد»';
    q4.scheme.accept = ['اسکول'];
    q4.answer = 'ب) اسکول';
    const q1 = items(exam, 'urdu.A.Q1').find((q) => q.question === TWIN);
    q1.question = '’’قلم، کتاب، تختی، بستہ‘‘ ان گروہی الفاظ سے کون سا لفظ ذہن میں آتا ہے؟';
    q1.answer = 'ج) تعلیم';
    q1.options = ['الف) کھیل', 'ب) سفر', 'ج) تعلیم', 'د) بازار'];
    const { examJson } = applyLayout(exam, U, FDE, { reasked: false });
    expect(items(examJson, 'urdu.A.Q1').map((q) => q.question)).not.toContain(q1.question);
  });
});

describe('urdu re-ask note: Q4\'s accepted answers are named too', () => {
  test('chapters_2: the Section A re-ask is told «برسات» as well as «موسمِ برسات»', () => {
    const note = takenNote(U, U.sections.find((s) => s.id === 'A'), ch2);
    expect(note).toContain('→ موسمِ برسات');
    expect(note).toContain('برسات');
    expect(note.split('\n').find((l) => l.includes('بادل'))).toMatch(/برسات.*برسات/);
  });

  test('an accepted answer the same as the answer is not repeated', () => {
    const note = takenNote(U, U.sections.find((s) => s.id === 'A'), ch2);
    const tense = note.split('\n').find((l) => l.includes('فاختہ اڑاتی'));
    expect(tense.endsWith('→ سدرہ باغ میں فاختہ اڑائے گی۔')).toBe(true);
  });
});

