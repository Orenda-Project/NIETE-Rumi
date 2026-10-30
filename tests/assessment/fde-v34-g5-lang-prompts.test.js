/** v34 G5 language prompt rules: one grammatical question with one true option, no length mark, tense cap, no unasked result. */
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027');
const rule = (subject, id) => P.subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id).prompt_rule;

describe('MCQ rules', () => {
  test('Urdu Q1: one grammatical question, one true option, key not longest, no Q3 word in a stem', () => {
    const r = rule('urdu', 'urdu.A.Q1');
    expect(r).toMatch(/one grammatical question with exactly one true option/);
    expect(r).toMatch(/outside a house/);
    expect(r).toMatch(/never repeats a word of its stem/);
    expect(r).toMatch(/Q3/);
  });

  test('English Q1(a): same rule, and the tense cap of two', () => {
    const r = rule('english', 'english.A.Q1a');
    expect(r).toMatch(/one grammatical question with exactly one true option/);
    expect(r).toMatch(/never the longest option/);
    expect(r).toMatch(/at most twice on the whole paper/);
  });
});

describe('other rules', () => {
  test('English Q1(b) caps tense changes at two', () => expect(rule('english', 'english.A.Q1b')).toMatch(/At most two of the five/));
  test('English Q7 and Q8 award no length mark', () => {
    expect(rule('english', 'english.C.Q7')).toMatch(/awards no mark for length/);
    expect(rule('english', 'english.C.Q8')).toMatch(/awards no mark for length/);
  });
  test('Urdu Q8 dialogue has no concluding result and keeps دس سے بارہ جملے', () => {
    const r = rule('urdu', 'urdu.C.Q8');
    expect(r).toMatch(/no concluding result/);
    expect(r).toMatch(/دس سے بارہ جملے/);
    expect(r).toMatch(/never «آٹھ باتیں»/);
  });
});
