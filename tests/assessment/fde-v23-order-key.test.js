/**
 * bd-5jmnfj.4.31: G2 English Q16 (put the story sentences in order). The paper letters the
 * sentences (a)-(f); the key gave the order as numbers. The key must use the paper's letters,
 * must print a second valid order when the data carries one, and the slot's prompt must ask for it.
 */
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const english = require('./fixtures/early/g1-english-exam.json');

const SLOT = 'g1.english.C.Q13';
// Real g2-english Q16 shape (v23). Sentences (a)-(f) as printed; order 3,4,1,5,2,6 = c, d, a, e, b, f.
const STORY = {
  slot: SLOT, lines: 3, marks: 6, answer: '3, 4, 1, 5, 2, 6', blooms: 'Understand',
  scheme: { accept: ['3, 4, 1, 5, 2, 6', '3, 4, 1, 5, 6, 2'], checked: null,
    points: [1, 2, 3, 4, 5, 6].map((n) => ({ kind: 'K', text: `Sentence ${n} placed`, marks: 1 })),
    common_error: 'Placing the bird flying away before it is cared for' },
  question: 'Arrange the sentences to make a story.',
  questions: ['Nida gave the bird some water and bread.', 'The bird flew away happily.', 'Nida found a little bird in the garden.',
    'The bird looked weak and thirsty.', 'Soon the bird felt strong again.', 'Nida said goodbye and waved.'],
  main_question: 'Put the sentences in the correct order to make a story. Write the numbers in order',
};

function paper(item) {
  const exam = JSON.parse(JSON.stringify(english));
  exam._layout.sections.forEach((s) => s.slots.forEach((sl) => {
    if (sl.slot === SLOT) Object.assign(sl, { type: 'Story Order', generate: 1, attempt: 1, marks_each: 6, lines: 3 });
  }));
  Object.values(exam.unseen).forEach((c) => Object.keys(c).forEach((k) => {
    if (c[k][0] && c[k][0].slot === SLOT) c[k] = [JSON.parse(JSON.stringify(item))];
  }));
  return exam;
}
const row = (html) => html.split('<tr').find((r) => r.includes(`data-row="${SLOT}"`) && r.includes('class="ans"')) || '';
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('bd-5jmnfj.4.31 the order key speaks the paper\'s letters', () => {
  const html = R.renderMarkingScheme({ examJson: paper(STORY), grade: 2, subject: 'english', allowShort: true });
  const t = text(row(html));

  test('the key names the order as c, d, a, e, b, f, not as numbers', () => {
    expect(t).toContain('c, d, a, e, b, f');
    expect(t).not.toContain('3, 4, 1, 5, 2, 6');
  });

  test('a second valid order the data carries prints as "also accept", lettered too', () => {
    expect(t).toContain('c, d, a, e, f, b');
    expect(t).not.toContain('3, 4, 1, 5, 6, 2');
  });

  test('the slot\'s prompt rule makes the writer list every valid order in scheme.accept', () => {
    const slot = Patterns.subjectOf('fde_g2_2026', 'english').sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.english.C.Q16');
    expect(slot.prompt_rule).toMatch(/accept/i);
    expect(slot.prompt_rule).toMatch(/only one|single|exactly one|every valid order/i);
  });
});
