/**
 * bd-5jmnfj.22: a question that contradicts itself reached a staging Science paper:
 * «Why can the student see the torch light but the torch is luminous while the mug is not?»
 * (Q2 (b), the torch/mug situation, sub-question c). The stem check reads every printed question
 * beside its own answer, names the ones that do not make sense, and rewords a named one so it asks
 * what its answer answers. The answer and the marking points are never touched.
 */

const SC = require('../../bot/shared/services/assessment/fde-stem-check');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects.science;

const BAD = 'Why can the student see the torch light but the torch is luminous while the mug is not?';
const GOOD = 'Why is the torch luminous while the mug is not?';
const torch = () => ({
  slot: 'science.B.Q2b',
  question: 'A student shines a torch at a wall and puts a ceramic mug, a clear glass and a frosted cup in front of the light.',
  answer: 'See the sub-questions.',
  questions: [
    { question: 'Why does the ceramic mug make a dark, solid shadow?', answer: 'The mug is opaque.', scheme: { accept: ['Light cannot pass through it'] } },
    { question: 'Which object makes the faintest shadow, and why?', answer: 'The clear glass, it is transparent.' },
    { question: BAD, answer: 'The torch makes its own light, so it is luminous; the mug does not, so it is non-luminous.' },
  ],
});
const long = () => ({
  slot: 'science.C.Q3b',
  question: 'A student shines a torch on a plastic sheet, tissue paper and thick cardboard. Explain what they see.',
  answer: 'The plastic sheet is transparent, the tissue paper translucent, the cardboard opaque.',
  scheme: { accept: ['Frosted cup is translucent, glass is transparent, mug is opaque', 'Sheet lets light through'], points: [{ text: 'Plastic sheet is transparent' }] },
});
const paper = () => ({
  unseen: {
    objective: { MCQs: [{ slot: 'science.A.Q1a', question: 'Which organ pumps blood?', options: ['a) Lungs', 'b) Heart'], answer: 'b) Heart' }] },
    subjective: { 'Logical Reasoning': [torch()], 'Long Question': [long()] },
  },
  _layout: {},
});

describe('the stem check prompt (bd-5jmnfj.22)', () => {
  const { prompt, targets } = SC.buildStemCheckPrompt(paper(), P);

  it('labels every printed question and sub-question in paper order', () => {
    expect([...targets.keys()]).toEqual(['Q1a.1', 'Q2b.1', 'Q2b.1.a', 'Q2b.1.b', 'Q2b.1.c', 'Q3b.1']);
  });

  it('prints each question beside its own answer and accept line', () => {
    expect(prompt).toContain(`Q2b.1.c ${BAD}`);
    expect(prompt).toMatch(/Q2b\.1\.c[^\n]*\n\s+answer: The torch makes its own light/);
    expect(prompt).toContain('accept: Frosted cup is translucent, glass is transparent, mug is opaque');
    expect(prompt).toContain('a) Lungs | b) Heart');
  });

  it('asks for a reworded question that keeps its answer, and nothing about style or level', () => {
    expect(prompt).toMatch(/contradicts itself/);
    expect(prompt).toMatch(/same answer/);
    expect(prompt).toMatch(/Do NOT flag/);
    expect(prompt).toMatch(/"flags":\[\]/);
  });

  it('is built only for the English-medium subjects', () => {
    expect(SC.STEM_CHECK_SUBJECTS).toEqual(['english', 'maths', 'science']);
  });
});

describe('reading the reply', () => {
  const { targets } = SC.buildStemCheckPrompt(paper(), P);

  it('keeps a flag on a printed label, once', () => {
    const flags = SC.parseStemFlags({ flags: [
      { label: 'Q2b.1.c', problem: 'two questions run together', question: GOOD },
      { label: 'Q2b.1.c', problem: 'again', question: 'x' },
      { label: 'Q9.1', problem: 'not on the paper' },
    ] }, targets);
    expect(flags).toEqual([{ label: 'Q2b.1.c', problem: 'two questions run together', question: GOOD }]);
  });

  it('a reply with no flags list is a failed read, not a clean one', () => {
    expect(() => SC.parseStemFlags({}, targets)).toThrow(/no flags list/);
    expect(SC.parseStemFlags({ flags: [] }, targets)).toEqual([]);
  });
});

describe('applying the fixes', () => {
  const at = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().find((q) => q.slot === slot);

  it('rewords the flagged sub-question and leaves its answer as it was', () => {
    const before = paper();
    const { examJson, record } = SC.applyStemFixes(before, P, [{ label: 'Q2b.1.c', problem: 'garbled', question: GOOD }]);
    const sub = at(examJson, 'science.B.Q2b').questions[2];
    expect(sub.question).toBe(GOOD);
    expect(sub.answer).toMatch(/^The torch makes its own light/);
    expect(record).toEqual([{ label: 'Q2b.1.c', problem: 'garbled', outcome: 'reworded', was: BAD }]);
    // The paper handed in is not changed.
    expect(at(before, 'science.B.Q2b').questions[2].question).toBe(BAD);
  });

  it('drops an accept line about other objects, only one copied exactly', () => {
    const accept = 'Frosted cup is translucent, glass is transparent, mug is opaque';
    const { examJson, record } = SC.applyStemFixes(paper(), P, [{ label: 'Q3b.1', problem: 'accept is about a mug', drop_accept: [accept, 'not there'] }]);
    expect(at(examJson, 'science.C.Q3b').scheme.accept).toEqual(['Sheet lets light through']);
    expect(record[0]).toMatchObject({ label: 'Q3b.1', outcome: 'accept_dropped', dropped: [accept] });
  });

  it('a fix the paper refuses to print, or one that is no question, is not applied but recorded', () => {
    const refuses = (t) => /forbidden/.test(t);
    const { examJson, record } = SC.applyStemFixes(paper(), P, [
      { label: 'Q2b.1.c', problem: 'garbled', question: 'A forbidden word here?' },
      { label: 'Q2b.1.a', problem: 'odd', question: '(a) Why does the mug make a shadow?' },
      { label: 'Q2b.1.b', problem: 'odd', question: '' },
    ], { refuses });
    expect(at(examJson, 'science.B.Q2b').questions.map((q) => q.question)).toEqual(torch().questions.map((q) => q.question));
    expect(record.map((r) => r.outcome)).toEqual(['refused', 'flagged_only', 'flagged_only']);
  });
});

/**
 * bd-5jmnfj.24: on a staging Maths paper the check (1) flagged «Draw and identify any two of the
 * following angles» as having no list — the list was there, as plain-text parts it never saw — and
 * reworded it so the list printed twice; (2) rightly flagged the gift-bags question («how many bags»,
 * answer H.C.F. 14 = fruits per bag) but could only reword the question, so the key still read
 * «so they can make 14 bags». The check now sees the parts, and a fix may correct the answer line and
 * a marking point as well, each recorded with what it was.
 */
describe('parts printed as plain text (bd-5jmnfj.24)', () => {
  const angles = () => ({
    slot: 'science.C.Q3b',
    question: 'Draw and identify any two of the following angles.',
    answer: 'Obtuse: more than 90°.',
    questions: ['Obtuse angle', 'Supplementary angle', 'Straight angle'],
  });
  const withAngles = () => { const e = paper(); e.unseen.subjective['Long Question'] = [angles()]; return e; };

  it('prints the parts under their question so the check can see the list', () => {
    const { prompt, targets } = SC.buildStemCheckPrompt(withAngles(), P);
    expect(prompt).toContain('parts: i) Obtuse angle | ii) Supplementary angle | iii) Straight angle');
    expect(prompt).toMatch(/parts:.*printed under/);
    // a plain-text part is not itself a target: there is nothing to reword in place
    expect([...targets.keys()]).toContain('Q3b.1');
    expect([...targets.keys()].filter((k) => k.startsWith('Q3b.1.'))).toEqual([]);
  });
});

/**
 * bd-5jmnfj.25: a staging Maths paper printed a table under «Find the average temperature» and under
 * the bar-graph question, but the check never saw it, said «the table is not given» and reworded both
 * so their numbers printed twice. The check now reads the table with its question.
 */
describe('a table printed under its question (bd-5jmnfj.25)', () => {
  const books = () => ({
    slot: 'science.C.Q3b',
    question: 'The table shows the number of books read by five students. Draw a bar graph.',
    answer: 'Bars of heights 15 and 25.',
    table: { headers: ['Student', 'Number of books'], rows: [['Areeba', '15'], ['Bilal', 25]] },
  });
  const withBooks = () => { const e = paper(); e.unseen.subjective['Long Question'] = [books()]; return e; };

  it('prints the table, header row first, so the check can see the data', () => {
    const { prompt } = SC.buildStemCheckPrompt(withBooks(), P);
    expect(prompt).toContain('table: Student | Number of books / Areeba | 15 / Bilal | 25');
    expect(prompt).toMatch(/"table:".*printed under/);
  });

  it('a table with no rows, or no table, prints no table line', () => {
    const e = withBooks();
    e.unseen.subjective['Long Question'][0].table = { headers: ['Student'], rows: 'junk' };
    expect(SC.buildStemCheckPrompt(e, P).prompt).toContain('table: Student\n');
    expect(SC.buildStemCheckPrompt(paper(), P).prompt).not.toMatch(/^\s+table:/m);
  });
});

describe('a fix may correct the answer and marking too (bd-5jmnfj.24)', () => {
  const ASK = 'A shopkeeper has 28 mangoes and 42 oranges. They make identical gift bags, one kind of fruit in each bag. How many bags can they make?';
  const bags = () => ({
    slot: 'science.C.Q3b',
    question: ASK,
    answer: 'H.C.F. of 28 and 42 = 14, so they can make 14 bags',
    scheme: { points: [{ kind: 'M', text: 'A correct method for the H.C.F.', marks: 1 }, { kind: 'A', text: 'Correct answer 14 bags', marks: 1 }] },
  });
  const withBags = () => { const e = paper(); e.unseen.subjective['Long Question'] = [bags()]; return e; };
  const at = (exam) => exam.unseen.subjective['Long Question'][0];

  it('the prompt asks for question, answer and points to agree after the fix', () => {
    const { prompt } = SC.buildStemCheckPrompt(withBags(), P);
    expect(prompt).toMatch(/"answer"/);
    expect(prompt).toMatch(/"points":\[\{"was"/);
    expect(prompt).toMatch(/agree/);
  });

  it('reads an answer and point fixes off the reply', () => {
    const { targets } = SC.buildStemCheckPrompt(withBags(), P);
    const [f] = SC.parseStemFlags({ flags: [{ label: 'Q3b.1', problem: 'bags vs fruits', answer: 'x', points: [{ was: 'a', now: 'b' }, { was: 1 }, 'junk'] }] }, targets);
    expect(f).toEqual({ label: 'Q3b.1', problem: 'bags vs fruits', answer: 'x', points: [{ was: 'a', now: 'b' }] });
  });

  it('corrects the answer line and the named point, keeps the question, records what each was', () => {
    const before = withBags();
    const { examJson, record } = SC.applyStemFixes(before, P, [{
      label: 'Q3b.1', problem: 'bags vs fruits',
      answer: 'H.C.F. of 28 and 42 = 14 fruits in each bag, so 2 + 3 = 5 bags',
      points: [{ was: 'Correct answer 14 bags', now: 'Correct answer 5 bags' }, { was: 'not on the paper', now: 'x' }],
    }]);
    const q = at(examJson);
    expect(q.question).toBe(ASK);
    expect(q.answer).toBe('H.C.F. of 28 and 42 = 14 fruits in each bag, so 2 + 3 = 5 bags');
    expect(q.scheme.points.map((p) => p.text)).toEqual(['A correct method for the H.C.F.', 'Correct answer 5 bags']);
    expect(q.scheme.points[1]).toMatchObject({ kind: 'A', marks: 1 });
    expect(record).toEqual([{
      label: 'Q3b.1', problem: 'bags vs fruits', outcome: 'answer_fixed',
      answer_was: 'H.C.F. of 28 and 42 = 14, so they can make 14 bags',
      points_was: ['Correct answer 14 bags'],
    }]);
    expect(at(before).answer).toMatch(/14 bags$/);
  });

  it('a reworded question and its corrected key go together, recorded as reworded', () => {
    const { examJson, record } = SC.applyStemFixes(withBags(), P, [{
      label: 'Q3b.1', problem: 'bags vs fruits', question: 'How many fruits go in each bag?',
      answer: 'H.C.F. of 28 and 42 = 14 fruits in each bag', points: [{ was: 'Correct answer 14 bags', now: 'Correct answer 14 fruits' }],
    }]);
    expect(at(examJson).question).toBe('How many fruits go in each bag?');
    expect(at(examJson).scheme.points[1].text).toBe('Correct answer 14 fruits');
    expect(record[0]).toMatchObject({ outcome: 'reworded', was: ASK, answer_was: bags().answer, points_was: ['Correct answer 14 bags'] });
  });

  it('a string point is replaced in place; a refused or empty answer is not applied', () => {
    const e = withBags();
    at(e).scheme.points = ['Correct answer 14 bags'];
    const refuses = (t) => /forbidden/.test(t);
    const { examJson, record } = SC.applyStemFixes(e, P, [{
      label: 'Q3b.1', problem: 'p', answer: 'a forbidden answer', points: [{ was: 'Correct answer 14 bags', now: 'Correct answer 5 bags' }],
    }], { refuses });
    expect(at(examJson).answer).toBe(bags().answer);
    expect(at(examJson).scheme.points).toEqual(['Correct answer 5 bags']);
    expect(record[0]).toMatchObject({ outcome: 'answer_fixed', answer_refused: 'a forbidden answer', points_was: ['Correct answer 14 bags'] });
    expect(record[0].answer_was).toBeUndefined();

    const blank = SC.applyStemFixes(withBags(), P, [{ label: 'Q3b.1', problem: 'p', answer: '  ' }]);
    expect(at(blank.examJson).answer).toBe(bags().answer);
    expect(blank.record[0].outcome).toBe('flagged_only');
  });
});
