/**
 * v37 round 7 maths panel findings (bd-5jmnfj.4.58): one no-working rule for G1 and G5, method restrictions the paper
 * never states, mixed number / improper fraction forms.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { mathsMarking } = require('../../bot/shared/services/assessment/fde-maths-marking');
const { mathsKeys } = require('../../bot/shared/services/assessment/fde-maths-keys');
const { earlyKeyFixes } = require('../../bot/shared/services/assessment/fde-early-key-fixes');

const slotOf = (pid, slot) => Patterns.subjectOf(pid, 'maths').sections.flatMap((s) => s.slots).find((s) => s.slot === slot);
const item = (extra) => ({ slot: 'maths.B.Q2', main_question: 'Solve.', question: 'Solve.', answer: '6', ...extra, scheme: { points: [], accept: [], ...(extra.scheme || {}) } });
const texts = (q) => q.scheme.points.map((p) => p.text);

describe('one no-working rule: a correct answer earns the answer mark, the working mark is for shown steps', () => {
  const m = item({ scheme: { points: [{ text: 'Sets up a correct method', marks: 1, kind: 'M' }, { text: 'Correct answer 6', marks: 1, kind: 'A' }] } });
  test('a scheme with a method mark gets the explicit line in accept', () => {
    const notes = [];
    const out = mathsMarking(m, notes);
    expect(out.scheme.accept).toContain('A correct answer with no working still earns the answer mark(s); the working mark is only for steps shown.');
    expect(notes).toHaveLength(1);
  });
  test('G1 story that says "Show your working" with one answer point gets the single-mark line', () => {
    const q = { slot: 'g1.maths.B.Q5', main_question: 'Solve the following. Show your working.', question: 'Ali has 6. He gets 7 more. How many now?', answer: '13', scheme: { points: [{ text: 'Correct sum 13, however it is worked out', marks: 1, kind: 'A' }], accept: ['6 + 7 = 13'] } };
    const out = mathsMarking(q, []);
    expect(out.scheme.accept).toContain('A correct answer with no working still earns the mark.');
    expect(out.scheme.accept).toContain('6 + 7 = 13');
  });
  test('runs inside earlyKeyFixes on a G1 word problem', () => {
    const exam = { _layout: { sections: [{ slots: [{ slot: 'g1.maths.B.Q6', type: 'Subtraction Word Problems' }] }] }, seen: {}, unseen: { subjective: { 'Subtraction Word Problems': [{ slot: 'g1.maths.B.Q6', main_question: 'Show your working.', question: 'Sara has 9 pens. She gives away 4. How many are left?', answer: '5', scheme: { points: [{ text: 'Correct difference 5', marks: 1, kind: 'A' }], accept: [] } }] } } };
    const out = earlyKeyFixes(exam).examJson.unseen.subjective['Subtraction Word Problems'][0];
    expect(out.scheme.accept.join(' ')).toMatch(/no working still earns/);
  });
  test('runs inside mathsKeys on a G5 item', () => {
    expect(mathsKeys(m, []).scheme.accept.join(' ')).toMatch(/no working still earns/);
  });
  test('idempotent; a scheme that pays no working, and other subjects, are untouched', () => {
    const once = mathsMarking(m, []);
    expect(mathsMarking(once, []).scheme.accept).toHaveLength(once.scheme.accept.length);
    const plain = item({ question: 'Write 5 in words.', scheme: { points: [{ text: 'five', marks: 1, kind: 'A' }] } });
    expect(mathsMarking(plain, [])).toBe(plain);
    const other = { ...m, slot: 'science.B.Q2' };
    expect(mathsMarking(other, [])).toBe(other);
  });
});

describe('named-method restrictions the stem never states become "any correct method"', () => {
  const pt = (text) => ({ text, marks: 1, kind: 'M' });
  test.each([
    ['Uses the vertical method correctly', /any correct method/],
    ['Subtracts by regrouping', /any correct method/],
    ['Carries out the long division steps correctly', /steps of any correct method/],
    ['Applies long multiplication correctly', /any correct method/],
    ['Unitary method only', /any correct method/i],
  ])('%s', (text, want) => {
    const out = mathsMarking(item({ question: 'Find the answer.', scheme: { points: [pt(text)] } }), []);
    expect(texts(out)[0]).toMatch(want);
    expect(texts(out)[0]).toMatch(/^[A-Z]/);
    expect(texts(out)[0]).not.toMatch(/vertical|regroup|long division|long multiplication|unitary/i);
  });
  test('a stem that names the method keeps it', () => {
    const q = item({ question: 'Find 4,305 - 1,879 using the vertical method.', scheme: { points: [pt('Uses the vertical method correctly')] } });
    expect(texts(mathsMarking(q, []))[0]).toBe('Uses the vertical method correctly');
  });
  test('an accept line that restricts ("only") is widened; an accept list of alternatives is kept', () => {
    const q = item({ question: 'Find the cost of 7.', scheme: { points: [pt('A correct method')], accept: ['Unitary method only', 'Division method'] } });
    const out = mathsMarking(q, []);
    expect(out.scheme.accept).toContain('Any correct method');
    expect(out.scheme.accept).toContain('Division method');
    expect(out.scheme.accept).not.toContain('Unitary method only');
  });
  test('mathsKeys applies it', () => {
    const q = item({ question: 'Find the answer.', scheme: { points: [pt('Uses the vertical method correctly')] } });
    expect(texts(mathsKeys(q, []))[0]).toMatch(/any correct method/);
  });
});

describe('mixed number and improper fraction forms', () => {
  const a1 = (text) => [{ text, marks: 1, kind: 'A' }];
  test('a mixed-number key accepts the improper form, and the A1 line stops demanding the form', () => {
    const q = item({ question: 'Ria uses 3/4 kg and 2/3 kg. How much in all?', answer: '1 5/12 kg', scheme: { points: a1('Writes the answer as 1 5/12 kg') } });
    const out = mathsMarking(q, []);
    expect(out.scheme.accept).toContain('17/12 kg');
    expect(texts(out)[0]).toBe('Correct answer 1 5/12 kg (the equal improper fraction or mixed number is also accepted)');
  });
  test('an improper-fraction key accepts the mixed form', () => {
    const q = item({ question: 'Add 5/6 and 2/3.', answer: '9/6', scheme: { points: a1('Correct answer 9/6') } });
    const out = mathsMarking(q, []);
    expect(out.scheme.accept).toEqual(expect.arrayContaining(['1 3/6', '3/2', '1 1/2']));
  });
  test('the form demanded by the stem is kept', () => {
    const q = item({ question: 'Add 3/4 and 2/3. Write the answer as a mixed number.', answer: '1 5/12', scheme: { points: a1('Writes the answer as the mixed number 1 5/12') } });
    expect(mathsMarking(q, [])).toBe(q);
  });
  test('a proper fraction or whole number key is untouched', () => {
    const q = item({ question: 'Add 1/4 and 1/2.', answer: '3/4', scheme: { points: a1('Correct answer 3/4') } });
    expect(mathsMarking(q, [])).toBe(q);
  });
});

describe('prompt rules', () => {
  test('G1 Q5 and Q6 state the no-working rule', () => {
    ['g1.maths.B.Q5', 'g1.maths.B.Q6'].forEach((s) => expect(slotOf('fde_g1_2026', s).prompt_rule).toMatch(/no working still earns/));
  });
  test('G5 Q2 pays any correct method and names no method unless the stem does', () => {
    const r = slotOf('fde_g5_2027', 'maths.B.Q2').prompt_rule;
    expect(r).toMatch(/any correct method/);
    expect(r).toMatch(/names a method only where the stem names it/);
    expect(r).toMatch(/mixed number or an improper fraction/);
  });
});
