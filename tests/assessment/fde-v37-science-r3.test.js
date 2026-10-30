/**
 * G5 Science v37 review, third pass (bd-5jmnfj.4.58): a Section A MCQ (or a B/C stem) that prints another item's
 * answer is taken off the paper; a key that splits one idea across marks is re-asked; prompt rules for equal demand,
 * one level of choice in Q2 (b), whole-mark parts, and keys that pay only what the stem asks.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { scienceGivers, dropScienceGivers, scienceGiverFlags } = require('../../bot/shared/services/assessment/fde-science-giveaway-drop');
const { repeatedPoints, repeatedPointsNote } = require('../../bot/shared/services/assessment/fde-science-key-points');

const P = Patterns.get('fde_g5_2027').subjects.science;
const rule = (slot) => P.sections.flatMap((s) => s.slots).find((s) => s.slot === slot).prompt_rule;

const mcq = (question, options, answer) => ({ slot: 'science.A.Q1a', question, options, answer, marks: 1 });
const pts = (...t) => ({ points: t.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] });
const layout = () => ({ sections: [{ slots: [
  { slot: 'science.A.Q1a', attempt: 20, generate: 20 }, { slot: 'science.B.Q2b', attempt: 2, generate: 3 },
  { slot: 'science.C.Q3a', attempt: 8, generate: 10 }, { slot: 'science.C.Q3b', attempt: 2, generate: 5 }] }] });

const filler = (n) => Array.from({ length: n }, (_, i) => mcq(`Which organ is number ${i} in the plan?`, ['a) lens', 'b) fin', 'c) stalk', 'd) hinge'], 'b) fin'));
const q3a = (question, answer, scheme) => ({ slot: 'science.C.Q3a', question, answer, marks: 5, scheme });
const build = (a, c, extra = {}) => ({ _layout: layout(), unseen: { objective: { MCQs: a }, subjective: { 'Brief Answers': c, ...extra } } });

describe('1. a Section A MCQ that prints a B/C answer', () => {
  const giver = mcq('Which gas does coal release that traps the Sun\'s heat in the atmosphere?', ['a) carbon dioxide', 'b) helium', 'c) neon', 'd) argon'], 'a) carbon dioxide');
  const c = q3a('Name the gas fossil fuels release that traps heat.', 'Carbon dioxide traps heat in the atmosphere.', pts('Carbon dioxide', 'Traps the Sun\'s heat in the atmosphere'));

  it('finds the giver and what it gives away', () => {
    const exam = build([giver, ...filler(19)], [c]);
    const found = scienceGivers(exam);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ slot: 'science.A.Q1a' });
    expect(found[0].with).toContain('science.C.Q3a');
  });

  it('finds none on a clean paper', () => {
    expect(scienceGivers(build(filler(20), [c]))).toEqual([]);
  });

  it('keeps a giver the slot cannot spare (20 of 20, no spare): never short, never changed', () => {
    const exam = build([giver, ...filler(19)], [c]);
    const out = dropScienceGivers(exam, {});
    expect(out.dropped).toEqual([]);
    expect(out.kept).toEqual([expect.objectContaining({ slot: 'science.A.Q1a', question: giver.question })]);
    expect(out.short).toBeUndefined();
    expect(out.examJson.unseen.objective.MCQs).toHaveLength(20);
    expect(exam.unseen.objective.MCQs).toHaveLength(20); // the input is never changed
  });

  it('turns each giver into a giveaway flag the re-ask reads', () => {
    const flags = scienceGiverFlags(build([giver, ...filler(19)], [c]));
    expect(flags).toEqual([expect.objectContaining({ slot: 'science.A.Q1a', reason: 'giveaway', printed: true, with: ['science.C.Q3a'] })]);
    expect(flags[0].words).toContain('carbon');
    expect(flags[0].text[0]).toMatch(/coal release/);
    expect(scienceGiverFlags(build(filler(20), [c]))).toEqual([]);
  });

  it('swaps in a spare that gives nothing away, never one that does', () => {
    const exam = build([giver, ...filler(19)], [c]);
    const clean = mcq('Which part of a flower makes seeds?', ['a) pistil', 'b) root', 'c) leaf', 'd) bud'], 'a) pistil');
    const out = dropScienceGivers(exam, { spares: [giver, clean] });
    expect(out.kept).toEqual([]);
    const list = out.examJson.unseen.objective.MCQs;
    expect(list).toHaveLength(20);
    expect(list.some((q) => q.question === clean.question)).toBe(true);
    expect(list.some((q) => q.question === giver.question)).toBe(false);
    expect(scienceGivers(out.examJson)).toEqual([]);
  });

  it('drops a B/C item with spare places ("any eight of ten") and keeps the count at or above the attempt', () => {
    const many = Array.from({ length: 9 }, (_, i) => q3a(`Explain topic number ${i} of the unit.`, `Plain answer ${i}.`, pts(`Idea ${i}`)));
    const exam = build(filler(20), [q3a('Is carbon dioxide released into the atmosphere when coal burns?', 'Yes.', pts('Yes')), ...many, c]);
    // 11 items, attempt 8: the stem that prints the answer of another slot goes
    const g = scienceGivers(exam);
    expect(g.map((x) => x.slot)).toContain('science.C.Q3a');
    const out = dropScienceGivers(exam, {});
    expect(out.kept).toEqual([]);
    expect(out.examJson.unseen.subjective['Brief Answers'].length).toBeGreaterThanOrEqual(8);
  });

  it('a C stem that prints another C item\'s keyed answer is a give-away too', () => {
    const long = { slot: 'science.C.Q3b', question: 'Explain why fossil fuels are burnt for energy.', marks: 9, answer: 'Petrol, diesel and coal burn to give energy.', scheme: pts('Petrol, diesel and coal are fossil fuels', 'They burn to release energy') };
    const stemmed = q3a('Name two fossil fuels such as petrol, diesel or coal that homes use.', 'Petrol, diesel.', pts('Names two fuels'));
    const exam = build(filler(20), [stemmed], { 'Long Question': [long] });
    const found = scienceGivers(exam);
    expect(found).toEqual([expect.objectContaining({ slot: 'science.C.Q3a', with: ['science.C.Q3b'] })]);
  });

  it('an item that shares only one everyday word is no give-away', () => {
    const a = mcq('Which of these animals lives in water?', ['a) fish', 'b) goat', 'c) hen', 'd) cow'], 'a) fish');
    const cc = q3a('Why do plants need water?', 'Water helps plants make food.', pts('Water helps plants make food'));
    expect(scienceGivers(build([a, ...filler(19)], [cc]))).toEqual([]);
  });
});

describe('2. a key whose points repeat one idea', () => {
  const item = (points) => q3a('Why is the Sun important to life on Earth?', 'x', { points: points.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] });

  it('flags two points that repeat the same content words', () => {
    const rows = repeatedPoints(build(filler(20), [item(['Plants use sunlight to make food', 'Sunlight is used by plants to make their food', 'Gives warmth'])]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slot: 'science.C.Q3a', reason: 'answer' });
    expect(rows[0].items[0]).toMatch(/one idea/);
    expect(repeatedPointsNote(rows)).toMatch(/one distinct point/);
  });

  it('passes points that are distinct, and non-science items', () => {
    expect(repeatedPoints(build(filler(20), [item(['Plants use sunlight to make food', 'Gives warmth to the Earth'])]))).toEqual([]);
    const other = { ...item(['Plants use sunlight to make food', 'Plants use sunlight to make food']), slot: 'maths.C.Q3' };
    expect(repeatedPoints({ unseen: { subjective: { x: [other] } } })).toEqual([]);
  });

  it('reads the points of a Q2 (b) sub-question', () => {
    const sub = { question: 'Why?', answer: 'a', scheme: { points: [{ text: 'Bacteria change the milk into yoghurt', marks: 1 }, { text: 'The milk is changed into yoghurt by bacteria', marks: 1.5 }] } };
    const exam = build(filler(20), [], { 'Logical Reasoning': [{ slot: 'science.B.Q2b', question: 'Milk.', questions: [sub] }] });
    expect(repeatedPoints(exam)).toHaveLength(1);
  });
});

describe('the give-away and repeated-point checks stay quiet on look-alikes (bd-5jmnfj.4.58)', () => {
  it('a key found only in another item\'s answer line is no give-away when that item has marking points', () => {
    const a = mcq('Which unit measures loudness?', ['a) metre', 'b) decibels', 'c) litre', 'd) gram'], 'b) decibels');
    const c = q3a('Name the jobs of the skeletal system.', 'Loudness is measured with a sound meter that reads decibels.', pts('Gives the body shape and support', 'Helps the body move'));
    expect(scienceGivers(build([a, ...filler(19)], [c]))).toEqual([]);
  });

  it('a word printed by three items or more is the paper\'s topic, not a key', () => {
    const topic = ['Which part of a plant takes in water?', 'Which plant part holds the plant up?', 'Which plant part makes seeds?'].map((q) => mcq(q, ['a) root', 'b) stem', 'c) seed', 'd) leaf'], 'a) root'));
    const c = q3a('Describe a plant.', 'Plants make food in leaves from sunlight and water.', pts('Plants make food in leaves', 'Sunlight and water are used'));
    expect(scienceGivers(build([...topic, ...filler(17)], [c]))).toEqual([]);
  });

  it('contrast points opening with different labels are two points, not one idea paid twice', () => {
    const item = (points) => q3a('How does a shadow change?', 'x', { points: points.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] });
    const c = item(['morning: Sun low in the east, shadow long and pointing west', 'evening: Sun low in the west, shadow long and pointing east']);
    expect(repeatedPoints(build(filler(20), [c]))).toEqual([]);
  });
});

describe('slot rules (prompt) for the third science pass', () => {
  it('Q1 (a): no stem or option names a word that is the answer to a Section B or C item', () => {
    expect(rule('science.A.Q1a')).toMatch(/no stem or option names a word that is the answer to a Section B or Section C item/);
  });

  it('Q3 (a) and Q3 (b): each mark is one distinct point the question asks for, and one fact is paid once', () => {
    ['science.C.Q3a', 'science.C.Q3b'].forEach((s) => {
      expect(rule(s)).toMatch(/each mark is one distinct point the question asks for/);
      expect(rule(s)).toMatch(/pays one fact once/);
      expect(rule(s)).toMatch(/pays only what the stem asks/);
    });
  });

  it('equal demand in every any-N-of-M set', () => {
    ['science.B.Q2b', 'science.C.Q3a', 'science.C.Q3b'].forEach((s) => {
      expect(rule(s)).toMatch(/every item in an "any N of M" set asks for the same kind and amount of work at the same marks/i);
    });
  });

  it('Q3 stems never print another item\'s keyed answer', () => {
    ['science.C.Q3a', 'science.C.Q3b'].forEach((s) => expect(rule(s)).toMatch(/never prints the keyed answer of another Section B or Section C item/));
  });

  it('Q2 (b): one level of choice, whole marks per part, accept line and common error fit their part', () => {
    const r = rule('science.B.Q2b');
    expect(r).toMatch(/one level of choice/);
    expect(r).toMatch(/whole marks per part/);
    expect(r).toMatch(/accept line belongs to the part it names/);
    expect(r).toMatch(/common_error fits its own part/);
  });

  it('never uses the word likely', () => {
    P.sections.flatMap((s) => s.slots).forEach((s) => expect(s.prompt_rule || '').not.toMatch(/likely/i));
  });
});
