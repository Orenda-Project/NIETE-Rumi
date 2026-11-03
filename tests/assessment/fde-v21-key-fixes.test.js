/**
 * What the v21 sandbox papers (27 Oct 2026) made easy to guess or hard to mark:
 * - G1 GK Q4 Column B was the key shifted one row: no answer beside its stem, but a pattern (bd-5jmnfj.4.47).
 * - G1 English Q6's key gave the rhyme ("mat") and never said the picture was a bat (bd-5jmnfj.4.48).
 * - The Q10 and Q15 answer strips printed above their section's rows, not after Q9 and Q14;
 *   the oral sheet said "1 marks each" (bd-5jmnfj.4.49).
 */

const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { matchOrder } = require('../../bot/shared/services/assessment/fde-match-block');
const { oralSheet } = require('../../bot/shared/services/assessment/fde-oral-sheet');
const english = require('./fixtures/early/g1-english-exam.json');

describe('bd-5jmnfj.4.47 Column B is neither beside its stem nor a shift', () => {
  const rotated = (answers, out) => answers.some((_, k) => k > 0 && out.every((a, i) => a === answers[(i + k) % answers.length]));

  test.each([
    [['a', 'b', 'c', 'd', 'e']],
    [['e', 'd', 'c', 'b', 'a']],
    [['b', 'c', 'd', 'e', 'a']],
    [['جنگل', 'صحرا', 'سمندر', 'گھونسلا', 'جہاز اڑانے والا']],
    [['a', 'b', 'c', 'd']],
  ])('%j', (answers) => {
    const out = matchOrder(answers);
    expect([...out].sort()).toEqual([...answers].sort());
    out.forEach((a, i) => expect(a).not.toBe(answers[i]));
    expect(rotated(answers, out)).toBe(false);
    expect(matchOrder(answers)).toEqual(out);
  });

  // Three pairs have only two mixes with nothing beside its stem, and both are shifts.
  test('three pairs: nothing beside its stem', () => {
    const answers = ['a', 'b', 'c'];
    matchOrder(answers).forEach((a, i) => expect(a).not.toBe(answers[i]));
  });
});

function englishPaper(edit) {
  const exam = JSON.parse(JSON.stringify(english));
  Object.values(exam.unseen).forEach((c) => Object.values(c).forEach((list) => list.forEach(edit)));
  return exam;
}
const scheme = (exam) => R.renderMarkingScheme({ examJson: exam, grade: 1, subject: 'english', allowShort: true });
const section = (html, id) => html.split('<section class="s-sec"').find((s) => s.startsWith(` data-section="${id}"`));

describe('bd-5jmnfj.4.48 the key names the picture a rhyme answers', () => {
  const PICS = { bat: 'mat', jug: 'mug', fan: 'man', bun: 'run' };
  const exam = englishPaper((q) => {
    if (!q.slot.endsWith('B.Q6')) return;
    const [name, answer] = Object.entries(PICS)[['bat', 'fun', 'van', 'tall'].indexOf(q.answer)];
    Object.assign(q, { question: 'Write a word that rhymes with this picture word.', answer, picture: { kind: 'object', name } });
  });
  const rows = section(scheme(exam), 'B').split('<tr').filter((r) => r.includes('data-row="g1.english.B.Q6"'));

  test('each Q6 row says what its picture is', () => {
    expect(rows).toHaveLength(4);
    Object.entries(PICS).forEach(([name, answer], i) => {
      expect(rows[i]).toContain(answer);
      expect(rows[i]).toMatch(new RegExp(`Picture: ${name}\\b`));
    });
  });

  test('a picture whose name is the answer is not named twice', () => {
    const named = englishPaper((q) => {
      if (q.slot.endsWith('B.Q6')) q.picture = { kind: 'object', name: q.answer };
    });
    expect(section(scheme(named), 'B')).not.toContain('Picture:');
  });
});

describe('bd-5jmnfj.4.49 strips print in question order; one mark is singular', () => {
  const html = scheme(JSON.parse(JSON.stringify(english)));

  test.each([['B', 'Q9', 'Q10'], ['C', 'Q14', 'Q15']])('section %s: %s rows come before the %s strip', (id, before, strip) => {
    const sec = section(html, id);
    const lastRow = sec.lastIndexOf(`data-row="g1.english.${id}.${before}"`);
    const at = sec.indexOf(`<div class="strip" data-row="g1.english.${id}.${strip}"`);
    expect(lastRow).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(lastRow);
  });

  const oral = (marks) => ({
    title_en: 'Oral', title_ur: 'زبانی', note_en: '', note_ur: '', marks: 4,
    tasks: [{ id: 't', label_en: 'T', label_ur: 'ٹ', marks: 4, instruction_en: 'Ask.', instruction_ur: 'پوچھیں', scoring: 'each', rubric: [{ marks, en: 'Each right answer', ur: 'ہر درست جواب' }] }],
    content: [{ id: 't', items: [{ ask: 'one?', answer: '1' }] }],
  });
  const text = (s) => String(s);

  test('1 mark each, 2 marks each', () => {
    expect(oralSheet(oral(1), { medium: 'en', text })).toContain('Each right answer: 1 mark each');
    expect(oralSheet(oral(2), { medium: 'en', text })).toContain('Each right answer: 2 marks each');
  });
});
