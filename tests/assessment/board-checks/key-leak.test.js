const m = require('../../../bot/shared/services/assessment/board-checks/key-leak');

const paper = (...items) => ({ unseen: { objective: { M: items } } });
const FREE = { mode: 'free' };
const srq = (question, answer, extra = {}) => ({ type: 'srq', question, answer, ...extra });
const hard = (r) => r.issues.filter((i) => i.hard);

describe('N18/N19 key-leak', () => {
  test('member interface and pinned limits', () => {
    expect(m.id).toBe('N18/N19');
    expect(m.hard).toBe(true);
    expect(m.modes).toEqual(['free', 'board']);
    expect(m.LIMITS).toEqual({ minTokens: 2, minLetters: 5, minDigits: 3 });
  });
  test('(1) Q7 repeating Q3 key (3 tokens) is a hard leak on Q7', () => {
    const r = m.run(paper(
      srq('What does a leaf do with light?', 'Light energy to chemical energy'),
      srq('A leaf turns light energy to chemical energy. Why does it need water?', 'Because water is split'),
    ), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0]).toMatchObject({ check: 'N18', code: 'KEY_IN_STEM', item_ref: 'srq#2', hard: true });
    expect(r.ok).toBe(false);
  });
  test('(2) a key inside its own options is not a leak', () => {
    const r = m.run(paper({ type: 'mcq', question: 'Photosynthesis changes', options: ['A) light energy to chemical energy', 'B) heat to sound', 'C) x y', 'D) z w'], answer: 'A) light energy to chemical energy' }), FREE);
    expect(r.issues).toEqual([]);
  });
  test('a key repeated in its own stem is a leak', () => {
    const r = m.run(paper(srq('Light energy to chemical energy: name the change.', 'light energy to chemical energy')), FREE);
    expect(hard(r)[0].item_ref).toBe('srq#1');
  });
  test('(3) a one-token short key is not searched', () => {
    const r = m.run(paper({ type: 'fill_blank', question: 'تعداد؟', answer: 'پانچ' }, srq('پانچ ارکان کون سے ہیں؟', 'x y z')), FREE);
    expect(r.issues).toEqual([]);
  });
  test('one long token and a 3-digit number are searched', () => {
    expect(hard(m.run(paper(srq('q', 'Mitochondria'), srq('Where is mitochondria found?', 'a b')), FREE))).toHaveLength(1);
    expect(hard(m.run(paper(srq('q', '180'), srq('He paid 180 rupees.', 'a b')), FREE))).toHaveLength(1);
    expect(hard(m.run(paper(srq('q', '18'), srq('He paid 18 rupees.', 'a b')), FREE))).toHaveLength(0);
  });
  test('true/false style keys are not searched', () => {
    const r = m.run(paper({ type: 'true_false_correct', question: 'Water boils at 90 C. True or false?', answer: 'False' }, srq('Is it false that ice floats?', 'a b')), FREE);
    expect(r.issues).toEqual([]);
  });
  test('(4) words box counts only with print_words', () => {
    const key = srq('q', 'gravitational potential energy');
    const fill = (extra) => ({ type: 'fill_blank', question: 'Fill in the blank', answer: 'zeta', words: ['gravitational potential energy', 'omega'], ...extra });
    expect(m.run(paper(key, fill({})), FREE).issues).toEqual([]);
    const r = m.run(paper(key, fill({ print_words: true })), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0].item_ref).toBe('fill_blank#1');
    const slotted = { _layout: { sections: [{ id: 'A', slots: [{ slot: 's.A', print_words: true }] }] }, unseen: { objective: { M: [{ ...key }, fill({ slot: 's.A' })] } } };
    expect(hard(m.run(slotted, { mode: 'board' }))).toHaveLength(1);
  });
  const match = (colB, answer) => ({ type: 'match', question: 'Match', column_a: ['Apple', 'Boy', 'Cat'], column_b: colB, answer });
  test('(5) N19: column_b in key order is hard, shuffled is ok', () => {
    const lines = 'A → x1\nB → y1\nC → z1';
    const r = m.run(paper(match(['x1', 'y1', 'z1', 'w1'], lines)), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0]).toMatchObject({ check: 'N19', code: 'COLUMN_B_ORDER' });
    expect(hard(m.run(paper(match(['y1', 'z1', 'x1', 'w1'], lines)), FREE))).toHaveLength(0);
  });
  test('(6) arrow, dash, colon and label key forms all parse', () => {
    const ordered = ['x1', 'y1', 'z1'];
    ['A → x1; B → y1; C → z1', 'A - x1\nB - y1\nC - z1', 'A: x1\nB: y1\nC: z1', 'A -> x1, B -> y1, C -> z1'].forEach((a) => {
      expect(hard(m.run(paper(match(ordered, a)), FREE))).toHaveLength(1);
    });
    const labelled = ['a) w', 'b) x', 'c) y'];
    expect(hard(m.run(paper(match(labelled, '1-a, 2-b, 3-c')), FREE))).toHaveLength(1);
    expect(hard(m.run(paper(match(labelled, '1-c, 2-a, 3-b')), FREE))).toHaveLength(0);
    expect(hard(m.run(paper(match(['x1', 'y1', 'z1'], 'gibberish')), FREE))).toHaveLength(0);
  });
  test('fewer than 3 rows is never an order leak; column_b without a spare is a soft note', () => {
    const two = { type: 'match', question: 'm', column_a: ['A', 'B'], column_b: ['x1', 'y1'], answer: 'A → x1\nB → y1' };
    expect(hard(m.run(paper(two), FREE))).toHaveLength(0);
    const r = m.run(paper(match(['y1', 'z1', 'x1'], 'A → x1\nB → y1\nC → z1')), FREE);
    expect(r.issues.find((i) => i.code === 'COLUMN_B_EXTRA')).toMatchObject({ hard: false, check: 'N19' });
    expect(r.ok).toBe(true);
  });
  test('(7) a stimulus text that contains the key of its own MCQ is hard', () => {
    const grp = { type: 'scenario', stimulus: { text: 'The mitochondria generates ATP energy here.', items: [{ type: 'mcq', question: 'Which organelle?', options: ['A) nucleus', 'B) mitochondria generates ATP energy', 'C) vacuole', 'D) wall'], answer: 'B' }] } };
    const r = m.run(paper(grp), FREE);
    expect(hard(r)).toHaveLength(1);
    expect(hard(r)[0].item_ref).toBe('scenario#1@s1');
  });
  test('(8) free mode runs; items without answers or ids are skipped quietly', () => {
    expect(m.run(paper({ type: 'srq', question: 'q' }), FREE).ok).toBe(true);
    expect(m.run({}, FREE)).toEqual({ ok: true, issues: [] });
  });
  test('answer, scheme and tag never count as child-visible', () => {
    const r = m.run(paper(srq('q', 'light energy to chemical energy'), srq('r', 'a b', { scheme: { points: [{ text: 'light energy to chemical energy' }] }, tag: { x: 'light energy to chemical energy' } })), FREE);
    expect(r.issues).toEqual([]);
  });
});

// Board ruling (bd-5jmnfj.38.30): in a 40-80 MCQ board paper an MCQ key that shows up only among ANOTHER MCQ's
// options is ordinary distractor reuse. A leak is a stem, passage or stimulus that gives another item's answer away.
describe('N18 in a board paper', () => {
  const BOARD = { mode: 'board' };
  const mc = (question, key, options) => ({ type: 'mcq', question, options, answer: key });
  test('an MCQ key that appears only among another MCQ options is not a leak', () => {
    const r = m.run(paper(
      mc('Which quantity has direction?', 'B', ['A) speed', 'B) displacement vector', 'C) mass', 'D) time']),
      mc('Which is a scalar?', 'A', ['A) speed', 'B) displacement vector', 'C) force', 'D) momentum']),
    ), BOARD);
    expect(hard(r)).toEqual([]);
  });
  test('an MCQ key written into a short-question stem is still a hard leak', () => {
    const r = m.run(paper(
      mc('Which quantity has direction?', 'B', ['A) speed', 'B) displacement vector', 'C) mass', 'D) time']),
      srq('The displacement vector of a car is 5 m east. State its magnitude.', 'five metres'),
    ), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('a short-question key offered as an MCQ option is still a hard leak', () => {
    const r = m.run(paper(
      srq('Name the quantity that has both size and direction.', 'displacement vector'),
      mc('Which is a scalar?', 'A', ['A) speed', 'B) displacement vector', 'C) force', 'D) momentum']),
    ), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('free mode still counts another item options as a leak', () => {
    const r = m.run(paper(
      mc('Which quantity has direction?', 'B', ['A) speed', 'B) displacement vector', 'C) mass', 'D) time']),
      mc('Which is a scalar?', 'A', ['A) speed', 'B) displacement vector', 'C) force', 'D) momentum']),
    ), FREE);
    expect(hard(r).length).toBeGreaterThan(0);
  });
});

// Board ruling part 2 (bd-5jmnfj.38.30): a single-word MCQ key (articles and bare units aside) in ANOTHER item's
// stem or stimulus is chapter vocabulary, so it is soft. Numbers, multi-word keys, non-MCQ keys and an MCQ key in
// its own stem or stimulus stay hard.
describe('N18 in a board paper: chapter vocabulary', () => {
  const BOARD = { mode: 'board' };
  const mc = (question, key, options, extra = {}) => ({ type: 'mcq', question, options, answer: key, ...extra });
  const soft = (r) => r.issues.filter((i) => !i.hard && i.code === 'KEY_IN_STEM');
  test('a one-word MCQ key in another MCQ stem is soft, not hard', () => {
    const r = m.run(paper(
      mc('Which quantity is measured by an odometer?', 'B', ['A) speed', 'B) distance', 'C) mass', 'D) time']),
      mc('A runner covers a distance of a lap. Which unit is used?', 'A', ['A) metre', 'B) kelvin', 'C) ampere', 'D) mole']),
    ), BOARD);
    expect(hard(r)).toEqual([]);
    expect(soft(r)).toHaveLength(1);
  });
  test('an article and a bare unit do not make a key multi-word', () => {
    const r = m.run(paper(
      mc('How does the mass of a body change on the Moon?', 'C', ['A) it doubles', 'B) it halves', 'C) the same', 'D) zero']),
      mc('Two trolleys have the same speed. Which has more momentum?', 'A', ['A) heavier', 'B) lighter', 'C) neither', 'D) both']),
      mc('Which is the SI unit of speed?', 'B', ['A) km', 'B) m/s', 'C) kg', 'D) hour']),
      srq('A bus moves at 12 m/s for one minute. Find the distance travelled.', 'seven hundred and twenty metres'),
    ), BOARD);
    expect(hard(r)).toEqual([]);
    expect(soft(r)).toEqual([]); // round 5: a bare unit ("m/s") is no issue; round 6: "the same" -> "same", under the 5-letter search floor
  });
  test('a numeric MCQ key with units in another item stimulus is soft (round 5: given data)', () => {
    const r = m.run(paper(
      mc('What is the value of g near the Earth?', 'D', ['A) 1.6 m/s^2', 'B) 3.7 m/s^2', 'C) 8.9 m/s^2', 'D) 9.8 m/s^2']),
      srq('Explain why the ball speeds up.', 'gravity pulls it', { stimulus: 'A ball falls with g = 9.8 m/s^2 from a roof.' }),
    ), BOARD);
    expect(hard(r)).toEqual([]);
    expect(soft(r)).toHaveLength(1);
  });
  test('a multi-word MCQ key in another MCQ stem stays hard', () => {
    const r = m.run(paper(
      mc('Which quantity has direction?', 'B', ['A) speed', 'B) displacement vector', 'C) mass', 'D) time']),
      mc('A displacement vector points east. Which is its unit?', 'A', ['A) metre', 'B) kelvin', 'C) ampere', 'D) mole']),
    ), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('a one-word short-question key in another stem stays hard', () => {
    const r = m.run(paper(
      srq('Name the quantity an odometer measures.', 'distance'),
      mc('A runner covers a distance of a lap. Which unit is used?', 'A', ['A) metre', 'B) kelvin', 'C) ampere', 'D) mole']),
    ), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('a one-word MCQ key in its own stem or own stimulus stays hard', () => {
    const own = m.run(paper(
      mc('The distance a car moves is shown. Which quantity is shown?', 'B', ['A) speed', 'B) distance', 'C) mass', 'D) time']),
    ), BOARD);
    expect(hard(own)).toHaveLength(1);
    const stim = m.run(paper(
      mc('Which quantity is shown on the dial?', 'B', ['A) speed', 'B) distance', 'C) mass', 'D) time'], { stimulus: 'The dial shows the distance in km.' }),
    ), BOARD);
    expect(hard(stim)).toHaveLength(1);
  });
});

// The repair round (bd-5jmnfj.38.30): the keys already in the paper go to the repair ask, and a replacement whose key
// lands in an old item's stem is the one blamed, so the old item is not thrown away.
describe('N18 and the repair round', () => {
  const BOARD = { mode: 'board' };
  const mc = (id, question, key, options) => ({ id, type: 'mcq', question, options, answer: key });
  const OLD = { id: 'old', type: 'srq', question: 'A displacement vector of 5 m points east. State its size.', answer: 'five metres' };
  const NEW = mc('new', 'Which quantity has direction?', 'B', ['A) speed', 'B) displacement vector', 'C) mass', 'D) time']);
  test('usedKeys lists numeric and multi-word keys, not one-word vocabulary', () => {
    const used = m.usedKeys(paper(
      mc('a', 'What is g near the Earth?', 'D', ['A) 1.6 m/s^2', 'B) 3.7 m/s^2', 'C) 8.9 m/s^2', 'D) 9.8 m/s^2']),
      mc('b', 'Which does an odometer measure?', 'B', ['A) speed', 'B) distance', 'C) mass', 'D) time']),
      srq('Name the quantity with size and direction.', 'displacement vector'),
    ));
    expect(used).toEqual(['9.8 m/s^2', 'displacement vector']);
  });
  test('without fresh ids the stem holder is blamed', () => {
    expect(hard(m.run(paper(OLD, NEW), BOARD)).map((i) => i.item_ref)).toEqual(['srq#1']);
  });
  test('round 5: a fresh replacement whose key sits in an old stem still blames the stem holder', () => {
    const r = m.run(paper(OLD, NEW), { ...BOARD, fresh: new Set(['new']) });
    expect(hard(r).map((i) => i.item_ref)).toEqual(['srq#1']);
  });
});

// bd-5jmnfj.38.30 round 4 (p4 a5, G11 Chemistry ch2): a key that is only a number and a unit, already in its own
// calculation stem, is the given data, not a leak (soft). A unit asked for by name stays hard. A sign is part of a
// number: "-1/2" is not in a stem that prints only "+1/2".
describe('N18 own stem: units, numbers and signs', () => {
  const BOARD = { mode: 'board' };
  const mc = (question, key, options, extra = {}) => ({ type: 'mcq', question, options, answer: key, ...extra });
  const n18 = (r) => r.issues.filter((i) => i.code === 'KEY_IN_STEM');
  test('"Calculate ... in kJ/mol" with key "-1312 kJ/mol" is soft', () => {
    const r = m.run(paper(
      mc('Calculate the energy of the electron in the first orbit of hydrogen (E = -1312 kJ/mol x Z^2/n^2, Z = 1, n = 1), in kJ/mol.', 'B',
        ['A) -328 kJ/mol', 'B) -1312 kJ/mol', 'C) -146 kJ/mol', 'D) -82 kJ/mol']),
    ), BOARD);
    expect(hard(r)).toEqual([]);
    expect(n18(r)).toHaveLength(1);
  });
  test('a unit key in its own stimulus, asked for by name, stays hard', () => {
    const r = m.run(paper(
      mc('Ionization energies are measured in which unit?', 'A', ['A) kJ/mol', 'B) g/mol', 'C) mol/L', 'D) kg/m3'],
        { stimulus: 'Sara records successive ionization energies (kJ/mol) of an element: 900, 1750, 14800.' }),
    ), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
  test('key "-1/2" is not found in a stem that prints "+1/2"', () => {
    const r = m.run(paper(
      mc('If a second electron were added to a 2px orbital whose first electron has s = +1/2, its spin must be:', 'D',
        ['A) +1', 'B) +1/2', 'C) 0', 'D) -1/2']),
    ), BOARD);
    expect(n18(r)).toEqual([]);
  });
});

// bd-5jmnfj.38.30 round 5 (a7 p3 G9 Physics ch2, p4 G11 Chemistry ch2): cross-item rulings. A unit alone is never a
// leak; a number or quantity key in another item's stem is soft (board papers give g as data); a concept phrase in
// another stem stays hard and is blamed on the item whose stem carries it; an own-stem multi-word key stays hard.
describe('N18 cross-item in a board paper (round 5)', () => {
  const BOARD = { mode: 'board' };
  const mc = (question, key, options) => ({ type: 'mcq', question, options, answer: key });
  const n18 = (r) => r.issues.filter((i) => i.code === 'KEY_IN_STEM');
  test('a unit key ("m/s^2") in another stem is no issue at all', () => {
    const r = m.run(paper(
      mc('Which is the SI unit of acceleration?', 'B', ['A) m/s', 'B) m/s^2', 'C) kg m/s', 'D) N/kg']),
      mc('A made-up cart speeds up at 3 m/s^2 for 4 s from rest. Find its final speed.', 'A', ['A) 12 m/s', 'B) 7 m/s', 'C) 1 m/s', 'D) 0.75 m/s']),
    ), BOARD);
    expect(n18(r)).toEqual([]);
  });
  test('quantity keys ("20 m/s", "9.8 m/s^2") in another stem are soft', () => {
    const r = m.run(paper(
      mc('A made-up scooter covers 100 m in 5 s. What is its speed?', 'C', ['A) 5 m/s', 'B) 500 m/s', 'C) 20 m/s', 'D) 0.05 m/s']),
      mc('What is g near the Earth?', 'D', ['A) 1.6 m/s^2', 'B) 3.7 m/s^2', 'C) 8.9 m/s^2', 'D) 9.8 m/s^2']),
      srq('A made-up stone falls with g = 9.8 m/s^2. A kite moves at 20 m/s. Find the stone speed after 2 s.', 'nineteen point six metres per second'),
    ), BOARD);
    expect(hard(r)).toEqual([]);
    expect(n18(r)).toHaveLength(2);
    n18(r).forEach((i) => expect(i.item_ref).toBe('srq#1'));
  });
  test('concept-phrase keys in another stem stay hard, blamed on the stem holder', () => {
    const r = m.run(paper(
      mc('A made-up train keeps the same speed every second. Its motion is at:', 'A', ['A) constant speed', 'B) rest', 'C) variable speed', 'D) zero speed']),
      mc('A nucleus holds:', 'B', ['A) electrons only', 'B) protons and neutrons', 'C) photons', 'D) ions']),
      mc('A made-up bus moves at constant speed on a road. What is its acceleration?', 'C', ['A) 1', 'B) 2', 'C) zero', 'D) 9']),
      srq('The protons and neutrons of a made-up atom number 12. What is its mass number?', 'twelve'),
    ), BOARD);
    expect(hard(r).map((i) => i.item_ref).sort()).toEqual(['mcq#3', 'srq#1']);
  });
  test('an own-stem multi-word key ("Negative plate") stays hard', () => {
    const r = m.run(paper(
      mc('In a made-up cathode-ray tube the rays leave the negative plate. Which plate do they leave?', 'A', ['A) Negative plate', 'B) Positive plate', 'C) Screen', 'D) Grid']),
    ), BOARD);
    expect(hard(r)).toHaveLength(1);
  });
});
