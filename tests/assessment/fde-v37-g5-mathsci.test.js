/**
 * Round 6 (v37) G5 Maths, G5 Science and G1 Maths, from the v34/v35 expert panels (bd-5jmnfj.4.58):
 *   - science keys that teach a wrong fact (compass poles, malaria and cholera as contagious, polio protection without the
 *     vaccine, a key paying three differences for an ask of one, a bulb fault no child meets);
 *   - the same maths skill asked twice (unit cost, change, triangle area, perimeter);
 *   - biodegradable asked in three places, and an MCQ key that names an example a written item's accept line names;
 *   - prompt rules for the rubric/marks mismatches and for G1 story sums read by 6-year-olds.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { scienceKeys } = require('../../bot/shared/services/assessment/fde-science-keys');
const { mathsSkillTwice } = require('../../bot/shared/services/assessment/fde-maths-skill-twice');
const { scienceRepeats } = require('../../bot/shared/services/assessment/fde-science-repeats');
const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');

const G5 = Patterns.get('fde_g5_2027');
const G1 = Patterns.get('fde_g1_2026');
const slotOf = (P, subject, id) => P.subjects[subject].sections.flatMap((s) => s.slots).find((s) => s.slot === id);
const rule = (P, subject, id) => slotOf(P, subject, id).prompt_rule;

const paper = (list) => ({ unseen: { x: { y: list } }, _layout: { sections: [{ slots: [...new Set(list.map((q) => q.slot))].map((slot) => ({ slot, type: 'y' })) }] } });
const mcq = (slot, question, options, answer) => ({ slot, question, options, answer });
const w = (slot, question, answer, extra = {}) => ({ slot, question, answer, ...extra });
const pt = (text, marks) => ({ text, marks, kind: 'K' });
const total = (q) => q.scheme.points.reduce((s, p) => s + p.marks, 0);

describe('G5 Science keys', () => {
  const compass = () => ({
    slot: 'science.C.Q3b', question: 'Explain why the needle of a compass always points north.',
    answer: 'The needle is a magnet. The Earth itself acts like a giant magnet with a north and a south pole. Earth\'s magnetic north attracts the north end of the needle and the south attracts its south end, so the needle lines up with Earth\'s magnetic poles. This helps hikers.',
    scheme: { points: [pt('The compass needle is a magnet', 2), pt('The Earth acts like a giant magnet with two poles', 3), pt('Earth\'s magnetic force attracts the needle\'s ends so it lines up north-south', 2), pt('This helps people find directions', 2)], accept: [] },
  });

  test('compass: the key no longer says that a north pole attracts the needle\'s north end', () => {
    const notes = [];
    const out = scienceKeys(compass(), notes);
    expect(out.answer).not.toMatch(/magnetic north attracts the north end/i);
    expect(out.answer).toMatch(/north-seeking end/i);
    expect(out.answer).toMatch(/unlike poles attract/i);
    expect(out.scheme.points.map((p) => p.text).join(' ')).not.toMatch(/attracts the needle's ends/);
    expect(total(out)).toBe(total(compass()));
    expect(notes.length).toBeGreaterThan(0);
  });

  const contagious = () => ({
    slot: 'science.C.Q3a', question: 'What is a contagious disease? Give two examples.',
    answer: 'A contagious disease spreads from one person to another. Examples: chickenpox and measles.',
    scheme: { points: [pt('Spreads from one person to another', 3), pt('Two correct examples', 2)], accept: ['Common cold, flu, cholera, malaria, chickenpox, measles, COVID-19, polio (any two)'] },
  });

  test('contagious: malaria and cholera leave the accept line, the person-to-person examples stay', () => {
    const out = scienceKeys(contagious(), []);
    const a = out.scheme.accept.join(' ');
    expect(a).not.toMatch(/malaria|cholera/i);
    expect(a).toMatch(/chickenpox/);
    expect(a).toMatch(/measles/);
  });

  const polio = () => ({
    slot: 'science.C.Q3b', question: 'Explain how COVID-19 and polio spread from person to person, and how people can protect themselves from each disease.',
    answer: 'COVID-19 spreads by droplets. Polio spreads through contaminated water. Masks protect against COVID-19, and clean water and sanitation protect against polio.',
    scheme: { points: [pt('COVID-19 spreads by droplets', 2), pt('Wearing masks protects against COVID-19', 2), pt('Clean water and proper sanitation protect against polio', 1), pt('Washing hands thoroughly with soap and water', 1)], accept: ['Using sanitisers instead of handwashing'] },
  });

  test('polio: the vaccine (polio drops) is the protection the key pays; clean water is the second way', () => {
    const out = scienceKeys(polio(), []);
    const t = out.scheme.points.map((p) => p.text).join(' | ');
    expect(t).toMatch(/polio vaccine|polio drops/i);
    expect(out.answer).toMatch(/vaccin/i);
    expect(out.scheme.accept.join(' ')).toMatch(/polio drops|vaccine/i);
    expect(total(out)).toBe(total(polio()));
  });

  const compare = () => ({
    slot: 'science.C.Q3a', question: 'Compare bacteria and viruses. Write one way in which they are different and one way in which they are alike.',
    answer: 'Viruses are much smaller than bacteria. Viruses must live inside cells, but bacteria are single-celled. Both are microorganisms.',
    scheme: { points: [pt('Viruses are much smaller than bacteria', 1), pt('Viruses must live inside cells of other living things to grow', 2), pt('Bacteria are single-celled and found in soil', 1), pt('Alike: both are microorganisms that can cause diseases', 1)], accept: ['Alike: both are too small to see without a microscope'] },
  });

  test('one difference and one likeness: the key pays one difference point and one likeness point, marks hold', () => {
    const out = scienceKeys(compare(), []);
    expect(out.scheme.points).toHaveLength(2);
    expect(out.scheme.points[0].text).toMatch(/difference/i);
    expect(out.scheme.points[1].text).toMatch(/^Alike/);
    expect(total(out)).toBe(5);
    expect(out.scheme.accept.join(' ')).toMatch(/smaller than bacteria/);
    expect(out.scheme.accept.join(' ')).toMatch(/inside cells/);
  });

  test('a compare item that asks two differences is left alone', () => {
    const q = { ...compare(), question: 'Compare bacteria and viruses. Write two ways they are different and one way they are alike.' };
    expect(scienceKeys(q, []).scheme.points).toHaveLength(4);
  });

  const bulb = () => ({
    slot: 'science.C.Q3b', question: 'Jojo joins a battery, a bulb and two wires, but the bulb does not glow. Explain what could be wrong and how he can fix each problem.',
    answer: 'The circuit may not be a complete loop, so he must join everything. The battery may be dead, so he should replace it. The wires may not be conductors, for example if they are plastic or wood, so he should use copper wires.',
    scheme: { points: [pt('The loop may be incomplete (open circuit / loose joining)', 2), pt('Fix: join all parts to form a closed loop', 1), pt('The battery may be dead / used up', 2), pt('Fix: use a working battery', 1), pt('The wire may not be a conductor', 2), pt('Fix: use a conductor such as copper wire', 1)], accept: ['A wire without its insulation removed at the ends does not touch the battery; strip the ends'] },
  });

  test('bulb that does not glow: the third cause is a fused or loose bulb, never wires of plastic or wood', () => {
    const out = scienceKeys(bulb(), []);
    const t = out.scheme.points.map((p) => p.text).join(' | ');
    expect(t).toMatch(/bulb (?:may be )?(?:fused|loose)|fused/i);
    expect(t).not.toMatch(/not a conductor|copper wire/i);
    expect(out.answer).not.toMatch(/plastic or wood/);
    expect(out.answer).toMatch(/fused/);
    expect(out.scheme.accept.join(' ')).toMatch(/fused/i);
    expect(total(out)).toBe(total(bulb()));
  });

  test('items it does not know pass through', () => {
    const q = w('science.C.Q3a', 'Name the organs of digestion.', 'x', { scheme: { points: [], accept: [] } });
    expect(scienceKeys(q, [])).toBe(q);
  });
});

describe('maths skill asked twice', () => {
  const a = mcq('maths.A.Q1a', 'Taha bought 8 pencils for Rs. 96. What is the cost of 1 pencil in rupees?', ['a) 10', 'b) 12'], 'b) 12');
  const b = w('maths.B.Q2', '8 pencils cost Rs. 144. Sara buys one pencil and gives the shopkeeper Rs. 50. How much change does she get?', '32');
  const c = w('maths.B.Q2', 'A school pays the shopkeeper Rs. 20,000 for 40 chairs. How much change in rupees does the school get back?', '2,000');
  const tri1 = mcq('maths.A.Q1a', 'What is the area of a triangle with base 10 cm and height 4 cm?', ['a) 20 cm2', 'b) 40 cm2'], 'a) 20 cm2');
  const tri2 = w('maths.C.Q4-8', 'A triangular flower bed has a base of 12 cm and a height of 9 cm. Find its area.', '54 cm2');

  test('unit cost twice: the later item is flagged', () => {
    const f = mathsSkillTwice(paper([a, b]));
    expect(f.map((x) => x.slot)).toEqual(['maths.B.Q2']);
    expect(f[0].with).toEqual(['maths.A.Q1a']);
    expect(f[0].words).toEqual(['unit cost']);
  });

  test('change from a payment twice: the later item is flagged, even in one slot', () => {
    const f = mathsSkillTwice(paper([b, c]));
    expect(f.map((x) => x.slot)).toEqual(['maths.B.Q2']);
    expect(f[0].words).toEqual(['change from a payment']);
  });

  test('triangle area twice, MCQ then Section C', () => {
    const f = mathsSkillTwice(paper([tri1, tri2]));
    expect(f.map((x) => x.slot)).toEqual(['maths.C.Q4-8']);
    expect(f[0].words).toEqual(['the area of a triangle']);
  });

  test('perimeter twice', () => {
    const f = mathsSkillTwice(paper([mcq('maths.A.Q1a', 'What is the perimeter of a square of side 6 cm?', ['a) 24 cm', 'b) 36 cm'], 'a) 24 cm'), w('maths.C.Q4-8', 'Find the perimeter of a rectangular garden 14 m long and 8 m wide.', '44 m')]));
    expect(f.map((x) => x.slot)).toEqual(['maths.C.Q4-8']);
  });

  test('every skill once: nothing flagged', () => {
    expect(mathsSkillTwice(paper([a, tri2, w('maths.B.Q2', 'Write 4,206,350 in words.', 'x')]))).toEqual([]);
  });

  test('flags carry the shape fde-answer-repeats reads, and paperGiveaways includes them', () => {
    const f = mathsSkillTwice(paper([a, b]));
    expect(f[0]).toEqual({ slot: expect.any(String), reason: 'giveaway', words: expect.any(Array), with: expect.any(Array), text: expect.any(Array), printed: true });
    expect(paperGiveaways(paper([a, b])).some((x) => x.words.includes('unit cost'))).toBe(true);
  });

  test('not maths, no paper', () => {
    expect(mathsSkillTwice(null)).toEqual([]);
    expect(mathsSkillTwice(paper([mcq('science.A.Q1a', 'Area of a triangle?', ['a', 'b'], 'a'), w('science.C.Q3a', 'Area of a triangle?', 'x')]))).toEqual([]);
  });
});

describe('science repeats', () => {
  const bio = (slot, text) => w(slot, text, `It is non-biodegradable. ${text}`);

  test('biodegradable asked in three places: the third ask is flagged', () => {
    const list = [
      mcq('science.A.Q1a', 'Which of these is non-biodegradable?', ['a) Plastic bag', 'b) Banana peel'], 'a) Plastic bag'),
      w('science.B.Q2b', 'A banana peel and a plastic bag are buried.', 'x', { questions: [w('', 'Which one is biodegradable?', 'The peel'), w('', 'Why does the plastic stay for years?', 'It does not rot')] }),
      bio('science.C.Q3a', 'Is a plastic bottle biodegradable or non-biodegradable?'),
    ];
    const f = scienceRepeats(paper(list));
    expect(f.map((x) => x.slot)).toEqual(['science.C.Q3a']);
    expect(f[0].words).toEqual(['biodegradable and non-biodegradable']);
  });

  test('two asks are within the cap', () => {
    const list = [mcq('science.A.Q1a', 'Which is non-biodegradable?', ['a) Plastic bag', 'b) Peel'], 'a) Plastic bag'), bio('science.C.Q3a', 'Is a plastic bottle biodegradable?')];
    expect(scienceRepeats(paper(list))).toEqual([]);
  });

  test('an MCQ whose key is the example a written item\'s accept line names is flagged', () => {
    const list = [
      mcq('science.A.Q1a', 'Which of these produces its own light?', ['a) Moon', 'b) Candle flame', 'c) Mirror', 'd) Planet'], 'b) Candle flame'),
      w('science.C.Q3a', 'Explain why the Moon is non-luminous, and name one luminous object.', 'The Sun.', { scheme: { points: [], accept: ['Luminous: a star, a candle, an electric bulb'] } }),
    ];
    const f = scienceRepeats(paper(list));
    expect(f.map((x) => x.slot)).toEqual(['science.A.Q1a']);
    expect(f[0].with).toEqual(['science.C.Q3a']);
    expect(f[0].words).toContain('candle');
  });

  test('a written item that does not ask for an example does not hand its accept line to an MCQ', () => {
    const list = [
      mcq('science.A.Q1a', 'Which of these produces its own light?', ['a) Moon', 'b) Candle flame'], 'b) Candle flame'),
      w('science.C.Q3a', 'Explain why the Moon shines.', 'It reflects the Sun.', { scheme: { points: [], accept: ['A candle gives its own light'] } }),
    ];
    expect(scienceRepeats(paper(list))).toEqual([]);
  });

  test('flags are in the shared shape and paperGiveaways includes them; not science, no paper', () => {
    const list = [mcq('science.A.Q1a', 'Which produces its own light?', ['a) Moon', 'b) Candle flame'], 'b) Candle flame'),
      w('science.C.Q3a', 'Name one luminous object.', 'The Sun.', { scheme: { points: [], accept: ['A candle'] } })];
    expect(paperGiveaways(paper(list)).some((x) => x.words.includes('candle'))).toBe(true);
    expect(scienceRepeats(null)).toEqual([]);
    expect(scienceRepeats(paper([bio('maths.A.Q1a', 'biodegradable'), bio('maths.A.Q1a', 'biodegradable'), bio('maths.A.Q1a', 'biodegradable')]))).toEqual([]);
  });
});

describe('prompt rules', () => {
  test('Maths Q4-8: each angle names what is drawn, supplementary needs two angles, a straight angle one line, equal pay per angle', () => {
    const r = rule(G5, 'maths', 'maths.C.Q4-8');
    expect(r).toMatch(/Supplementary = TWO angles/);
    expect(r).toMatch(/Straight = one straight line marked 180/);
    expect(r).toMatch(/never says .first angle. or .second angle./);
    expect(r).toMatch(/at least two working steps/);
    expect(r).toMatch(/no skill .* appears in both Section A and Section C/i);
  });

  test('Maths Q2: no bare read-aloud item, equal demand, one change problem, one unit-cost problem on the whole paper', () => {
    const r = rule(G5, 'maths', 'maths.B.Q2');
    expect(r).toMatch(/never a bare .write in words./);
    expect(r).toMatch(/3 to 5 scoring steps/);
    expect(r).toMatch(/only one item on the whole paper asks for change/);
    expect(r).toMatch(/Q1 \(b\) skill/);
  });

  test('Maths Q1 (a): no unit cost, change or triangle area', () => {
    const r = rule(G5, 'maths', 'maths.A.Q1a');
    expect(r).toMatch(/No MCQ asks the cost of one item from a total, the change from a payment or the area of a triangle/);
    expect(slotOf(G5, 'maths', 'maths.A.Q1a').grain.kind).not.toMatch(/unitary cost, area/);
  });

  test('Science Section A: own objects, no Section B or C example, biodegradable at most twice', () => {
    const r = rule(G5, 'science', 'science.A.Q1a');
    expect(r).toMatch(/own objects and settings/);
    expect(r).toMatch(/ceramic mug/);
    expect(r).toMatch(/Biodegradable and non-biodegradable is asked in at most two items of the whole paper/);
  });

  test('Science Q3 (a): one difference, one likeness; malaria and cholera not contagious; polio protection is the vaccine', () => {
    const r = rule(G5, 'science', 'science.C.Q3a');
    expect(r).toMatch(/exactly one difference point and one likeness point/);
    expect(r).toMatch(/malaria is carried by a mosquito and cholera by contaminated water/);
    expect(r).toMatch(/polio is prevented by the vaccine/);
  });

  test('Science Q3 (b): compass poles, bulb faults, marks follow demand', () => {
    const r = rule(G5, 'science', 'science.C.Q3b');
    expect(r).toMatch(/north-seeking end/);
    expect(r).toMatch(/never that Earth.s magnetic north attracts the needle.s north end/);
    expect(r).toMatch(/fused or loose bulb/);
    expect(r).toMatch(/never wires made of plastic or wood/);
    expect(r).toMatch(/cholera spreads by contaminated water/);
  });

  test('Science Q2 (b): biodegradable cap', () => {
    expect(rule(G5, 'science', 'science.B.Q2b')).toMatch(/at most two items of the whole paper/);
  });

  test.each(['g1.maths.B.Q5', 'g1.maths.B.Q6'])('G1 Maths %s: stories short enough for a 6-year-old, read aloud by the teacher', (id) => {
    const r = rule(G1, 'maths', id);
    expect(r).toMatch(/one sentence of at most 10 words/);
    expect(r).toMatch(/teacher reads each story aloud/);
    expect(r).toMatch(/never two-part stories/);
  });
});
