/**
 * The marking scheme, round 5: what a recorded set of board-pattern papers showed.
 *
 *   2. A maths word problem is not one of the forms maths-check recognises, so
 *      its key was never checked. When the key carries its own working
 *      («85000 - 24567 = Rs. 60,433»), that working is evaluated exactly and the
 *      result it states is checked against it (and corrected when wrong).
 *      Only on a board-pattern paper; a plain paper is unchanged.
 *   3. Accept lines, points and common errors were cut with «…» at 80/160 code
 *      points. A cut accept line is a wrong marking instruction: a normal line
 *      (up to 240 code points) now prints whole.
 *   5. Pick words: when the model lists more words of a kind than the part
 *      needs, the valid ones are kept up to the number needed, in the order
 *      written, and the rest dropped, so asking for spares makes the slot robust.
 *
 * Every test goes through applyLayout → normaliseScheme (→ mathsCheck) → the
 * real marking-scheme renderer.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const wordProblems = require('./fixtures/fde/r5w2-maths-word.json');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };

function chain(raw, subject) {
  const laid = applyLayout(raw, P[subject], FDE, { now: NOW });
  const ns = normaliseScheme(laid.examJson);
  const mc = mathsCheck(ns.examJson, { subject });
  const scheme = R.renderMarkingScheme({ examJson: mc.examJson, grade: 5, subject, allowShort: true });
  return { laid, ns, mc, exam: mc.examJson, scheme };
}

const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

describe('a maths key that carries its own working is checked against it (item 2)', () => {
  const run = chain(wordProblems, 'maths');
  const items = Object.values(run.exam.unseen.subjective).flat();
  const byStart = (s) => items.find((q) => q.question.startsWith(s));

  it('marks a key whose working agrees "ok"', () => {
    for (const s of ['A school has', 'A bakery', 'One string', 'A village fund', 'A jug held', 'A runner', 'Lights flash', '45 out of', 'Three apples']) {
      expect([s, byStart(s).scheme.checked]).toEqual([s, 'ok']);
    }
  });

  it('corrects a key whose stated result disagrees with its own working, and the scheme prints the right number', () => {
    const q = byStart('A printer');
    expect(q.scheme.checked).toBe('replaced');
    expect(q.answer).toBe('34567 x 89 = Rs. 3,076,463.');
    expect(run.exam._layout.notes).toContainEqual(expect.objectContaining({ slot: 'maths.B.Q2', computed: '3,076,463', model: '3,076,000' }));
    expect(visible(run.scheme)).toContain('3,076,463');
    expect(visible(run.scheme)).toContain('34567 x 89 = Rs. 3,076,463.');
    expect(visible(run.scheme)).not.toContain('= Rs. 3,076,000');
  });

  it('leaves a key it cannot read as one sum unchecked', () => {
    expect(byStart('A library').scheme.checked).toBeNull();
    expect(byStart('Write Rs.').scheme.checked).toBeNull();
    expect({ checked: run.mc.checked, replaced: run.mc.replaced, unparsed: run.mc.unparsed }).toEqual({ checked: 9, replaced: 1, unparsed: 3 });
  });

  it('never reads across a sentence: "= 280. Average = 280 divided by 5 = 56" is not corrected to 280', () => {
    const q = byStart('Five children');
    expect(q.scheme.checked).toBeNull();
    expect(q.answer).toBe('Sum = 45 + 60 + 55 + 70 + 50 = 280. Average = 280 divided by 5 = 56.');
  });

  it('changes nothing on a paper with no board pattern', () => {
    const plain = { unseen: { subjective: { 'Word Problems': wordProblems.unseen.subjective['Word Problems'].map((q) => ({ ...q })) } } };
    const out = mathsCheck(plain, { subject: 'maths' });
    const list = out.examJson.unseen.subjective['Word Problems'];
    expect(list.every((q) => q.scheme.checked === null)).toBe(true);
    expect(list.find((q) => q.question.startsWith('A printer')).answer).toBe('34567 x 89 = Rs. 3,076,000.');
  });
});

describe('scheme lines print whole (item 3)', () => {
  const longAccept = 'Any correct explanation that links rusting to iron reacting with oxygen and water, and says that salt water speeds it up because it carries the charge more easily; accept rust or iron oxide.';
  const longPoint = 'Names the reaction of iron with oxygen and water as rusting, says it forms a new substance (iron oxide) and that the change cannot be reversed by simple means at home.';
  const longError = 'Children often say that rusting is a physical change because the nail keeps its shape, or confuse the orange colour of rust with paint or dirt on the surface of the iron.';
  const raw = {
    unseen: {
      subjective: {
        'Short Questions': [{
          slot: 'science.C.Q3a',
          question: 'Why does an iron nail rust faster in salt water?',
          answer: 'Salt water helps iron react with oxygen and water.',
          blooms: 'Understand',
          scheme: { points: [{ text: longPoint, marks: 5, kind: 'K' }], accept: [longAccept], common_error: longError },
        }],
      },
    },
  };

  it('keeps an accept line, a point and a common error of up to 240 code points, with no «…»', () => {
    expect([...longAccept].length).toBeGreaterThan(160);
    expect([...longPoint].length).toBeGreaterThan(160);
    expect([...longError].length).toBeGreaterThan(160);
    const run = chain(raw, 'science');
    const q = run.exam.unseen.subjective[Object.keys(run.exam.unseen.subjective).find((k) => run.exam.unseen.subjective[k].length)][0];
    expect(q.scheme.accept).toEqual([longAccept]);
    expect(q.scheme.points[0].text).toBe(longPoint);
    expect(q.scheme.common_error).toBe(longError);
    const text = visible(run.scheme);
    expect(text).toContain(longAccept);
    expect(text).not.toContain('…');
  });

  it('still caps a runaway line', () => {
    const runaway = JSON.parse(JSON.stringify(raw));
    runaway.unseen.subjective['Short Questions'][0].scheme.accept = ['x'.repeat(600)];
    const run = chain(runaway, 'science');
    const q = run.exam.unseen.subjective[Object.keys(run.exam.unseen.subjective).find((k) => run.exam.unseen.subjective[k].length)][0];
    expect([...q.scheme.accept[0]]).toHaveLength(240);
    expect(q.scheme.accept[0].endsWith('…')).toBe(true);
  });

  it('a paper with no board pattern comes back unchanged', () => {
    const plain = { unseen: { subjective: { 'Short Questions': [{ question: 'Q', answer: 'A', scheme: { accept: ['y'.repeat(300)] } }] } } };
    expect(normaliseScheme(plain).examJson).toEqual(plain);
  });
});

describe('spare pick words are kept up to the number needed (item 5)', () => {
  const PASSAGE = 'The farmer walked to the river. He carried a basket and sang a song. A small dog followed him home and barked at a goat.';
  const comprehension = (pick) => ({
    unseen: {
      subjective: {
        Comprehension: [{
          slot: 'english.B.Q2',
          question: 'Read the following passage and answer the questions given at the end.',
          passage: PASSAGE,
          blooms: 'Understand',
          parts: [
            { key: 'questions', questions: [{ question: 'Where did the farmer go?', answer: 'To the river.' }] },
            { key: 'do_as_directed', questions: [] },
            { key: 'pick', pick },
          ],
        }],
      },
    },
  });
  const pickOf = (run) => {
    const lists = Object.values(run.exam.unseen.subjective).find((l) => l.length && l[0].slot === 'english.B.Q2');
    return lists[0].parts.find((p) => p.key === 'pick').pick;
  };

  it('five verbs (one written in a form the passage does not use) and five nouns: three of each kept, no shortfall', () => {
    const run = chain(comprehension({
      Nouns: ['farmer', 'river', 'basket', 'song', 'goat'],
      Verbs: ['walked', 'carry', 'sang', 'followed', 'barked'],
    }), 'english');
    expect(run.ns.shortfall).toEqual([]);
    expect(pickOf(run)).toEqual({ Nouns: ['farmer', 'river', 'basket'], Verbs: ['walked', 'sang', 'followed'] });
    const text = visible(run.scheme);
    expect(text).toContain('followed');
    expect(text).not.toMatch(/\bbarked\b/);
    expect(text).not.toMatch(/\bgoat\b/);
  });

  it('only two valid verbs of five is still a shortfall', () => {
    const run = chain(comprehension({
      Nouns: ['farmer', 'river', 'basket'],
      Verbs: ['walked', 'carry', 'sings', 'jump', 'barked'],
    }), 'english');
    expect(run.ns.shortfall).toEqual([{ slot: 'english.B.Q2', kind: 'Verbs', have: 2, need: 3 }]);
  });
});

describe('round 2: a key is never "corrected" across a unit change or a rounding', () => {
  // Keys written as a board-pattern paper writes them, checked through the real chain.
  const paperOf = (answers) => ({
    unseen: {
      subjective: {
        'Word Problems': answers.map((answer, i) => ({
          slot: 'maths.B.Q2', question: `Word problem number ${i + 1} about a shop.`, answer, blooms: 'Apply',
        })),
      },
    },
  });
  const verdicts = (answers) => {
    const run = chain(paperOf(answers), 'maths');
    return run.exam.unseen.subjective['Word Problems'].map((q) => [q.answer, q.scheme.checked]);
  };

  it('a unit conversion in the working leaves a correct key as written (null, never replaced)', () => {
    expect(verdicts([
      '500 g + 250 g = 750 g = 0.75 kg',
      '4 x 25 = 100 cm = 1 m',
      '2 x 30 = 60 minutes = 1 hour',
    ])).toEqual([
      ['500 g + 250 g = 750 g = 0.75 kg', null],
      ['4 x 25 = 100 cm = 1 m', null],
      ['2 x 30 = 60 minutes = 1 hour', null],
    ]);
  });

  it('the same unit on both sides is still checked, and a wrong key still corrected', () => {
    expect(verdicts(['Rs. 500 - Rs. 120 = Rs. 380', '3 x 4 litres = 12 litres', '3 x 4 litres = 13 litres'])).toEqual([
      ['Rs. 500 - Rs. 120 = Rs. 380', 'ok'],
      ['3 x 4 litres = 12 litres', 'ok'],
      ['3 x 4 litres = 12 litres', 'replaced'],
    ]);
  });

  it('a rounded result: recurring and correctly rounded is ok; terminating but rounded is left alone; a wrong rounding is corrected', () => {
    expect(verdicts(['10 ÷ 3 = 3.3', '10 ÷ 3 = 3.33', '7 ÷ 8 = 0.88', '10 ÷ 3 = 3.4'])).toEqual([
      ['10 ÷ 3 = 3.3', 'ok'],
      ['10 ÷ 3 = 3.33', 'ok'],
      ['7 ÷ 8 = 0.88', null],
      ['10 ÷ 3 = 3.3', 'replaced'],
    ]);
  });
});
