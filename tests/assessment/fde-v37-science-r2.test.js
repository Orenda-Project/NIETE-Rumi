/**
 * G5 Science v37 review, second pass (bd-5jmnfj.4.58.4x): fixes 1-9 of the science panel.
 * Pure helpers (fde-science-r2, fde-science-shared-facts) plus the science slot rules in patterns/fde-g5-2027.js.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { scienceKeys } = require('../../bot/shared/services/assessment/fde-science-keys');
const { circuitPicture } = require('../../bot/shared/services/assessment/fde-circuit-frame');
const { splitIdeaPoints, dropPaidCommonError } = require('../../bot/shared/services/assessment/fde-science-r2');
const { sharedKeyFacts } = require('../../bot/shared/services/assessment/fde-science-shared-facts');
const { scienceRepeats } = require('../../bot/shared/services/assessment/fde-science-repeats');

const P = Patterns.get('fde_g5_2027').subjects.science;
const rule = (slot) => P.sections.flatMap((s) => s.slots).find((s) => s.slot === slot).prompt_rule;
const sum = (points) => points.reduce((t, p) => t + p.marks, 0);

describe('5. a row filled from the answer is split into per-idea points', () => {
  it('cuts a one-sentence answer at ", because" into two points that add to the item marks', () => {
    const pts = splitIdeaPoints('It will turn into yoghurt, because the good bacteria from the yoghurt change the milk.', 2.5);
    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.marks)).toEqual([1.5, 1]);
    expect(sum(pts)).toBe(2.5);
    expect(pts.every((p) => p.kind === 'A' && p.text.length > 0)).toBe(true);
  });

  it('cuts a two-sentence answer at the sentence end', () => {
    const pts = splitIdeaPoints('The salt has dissolved in the water. It is still there as tiny particles.', 2.5);
    expect(pts.map((p) => p.text)).toEqual(['The salt has dissolved in the water.', 'It is still there as tiny particles.']);
    expect(sum(pts)).toBe(2.5);
  });

  it('never makes more points than whole marks, and joins the rest into the last one', () => {
    const pts = splitIdeaPoints('One. Two. Three. Four.', 2.5);
    expect(pts).toHaveLength(2);
    expect(pts[1].text).toBe('Two. Three. Four.');
    expect(sum(pts)).toBe(2.5);
  });

  it('keeps one point for a one-idea answer or a one-mark row', () => {
    expect(splitIdeaPoints('Skin.', 2.5)).toEqual([{ kind: 'A', marks: 2.5, text: 'Skin.' }]);
    expect(splitIdeaPoints('It rots, because it is biodegradable.', 1)).toHaveLength(1);
  });

  it('normaliseScheme gives a Science Q2 (b) part with no points two points, and lists the row', () => {
    const sub = (question, answer) => ({ question, answer, scheme: { accept: ['x'], common_error: 'y', checked: null } });
    const item = {
      slot: 'science.B.Q2b', question: 'A child mixes yoghurt into warm milk.', marks: 5, lines: 0, blooms: 'Apply',
      answer: 'a) Yoghurt. b) No bacteria. c) Mould grows.',
      questions: [
        sub('What will the milk turn into?', 'It will turn into yoghurt, because the good bacteria change the milk.'),
        sub('Why does the second jar stay unchanged?', 'It has no yoghurt bacteria. Nothing changes the milk.'),
        sub('What shows on the bread?', 'Mould.'),
      ],
      scheme: { accept: ['Any two'], checked: null },
    };
    const laid = applyLayout({ unseen: { subjective: { 'Logical Reasoning': [item] } } }, P, { kind: 'fde' }, { now: '2026-10-30T07:00:00.000Z' }).examJson;
    const out = normaliseScheme(laid);
    const parts = out.examJson.unseen.subjective['Logical Reasoning'][0].questions;
    expect(parts[0].scheme.points.length).toBe(2);
    expect(sum(parts[0].scheme.points)).toBe(2.5);
    expect(parts[1].scheme.points.length).toBe(2);
    expect(sum(parts[1].scheme.points)).toBe(2.5);
    expect(parts[2].scheme.points).toHaveLength(1);
    expect(out.examJson._layout.scheme_shortfall).toHaveLength(3);
  });
});

describe('7. a common error that matches a paid point is dropped', () => {
  const compass = () => ({
    slot: 'science.C.Q3b', question: "Rani's homemade compass settles in one direction. Explain why.", marks: 9,
    scheme: {
      points: [
        { text: 'The Earth acts like a giant magnet', marks: 2, kind: 'K' },
        { text: "The north-seeking end of the needle is attracted towards Earth's magnetic north", marks: 2, kind: 'K' },
      ],
      accept: ['a'],
      common_error: "Saying Earth's magnetic north attracts the needle's north end, or that the needle points to north because of wind or water.",
    },
  });

  it('drops the clause that restates a paid point and keeps the other clause', () => {
    const notes = [];
    const q = dropPaidCommonError(compass(), notes);
    expect(q.scheme.common_error).toBe('Saying that the needle points to north because of wind or water.');
    expect(notes).toHaveLength(1);
  });

  it('removes the line when every clause restates a paid point', () => {
    const q = compass();
    q.scheme.common_error = "Saying Earth's magnetic north attracts the needle's north end.";
    expect(dropPaidCommonError(q, []).scheme.common_error).toBeUndefined();
  });

  it('leaves a common error that matches no paid point as written', () => {
    const q = compass();
    q.scheme.common_error = 'Saying the needle floats because of the wind.';
    expect(dropPaidCommonError(q, [])).toBe(q);
  });

  it('runs inside scienceKeys, and only for science items', () => {
    expect(scienceKeys(compass(), []).scheme.common_error).toMatch(/wind or water/);
    expect(scienceKeys(compass(), []).scheme.common_error).not.toMatch(/magnetic north attracts/);
    const other = { ...compass(), slot: 'maths.C.Q3' };
    expect(scienceKeys(other, []).scheme.common_error).toMatch(/magnetic north attracts/);
  });
});

describe('9. two items never share a key fact', () => {
  const item = (slot, question, extra) => ({ slot, question, marks: 5, ...extra });
  const pts = (...t) => ({ points: t.map((text) => ({ text, marks: 1, kind: 'K' })), accept: [] });

  it('flags the later item that pays the same key fact as an earlier one', () => {
    const exam = { unseen: { subjective: {
      'Logical Reasoning': [item('science.B.Q2b', 'A child mixes yoghurt into warm milk.', { questions: [
        { question: 'What will the milk turn into?', answer: 'It will turn into yoghurt, because the good bacteria from the yoghurt change the milk.', scheme: pts('Yoghurt, because the good bacteria change the milk') },
      ] })],
      'Brief Answers': [item('science.C.Q3a', 'Explain how microorganisms are useful in food.', { answer: 'Bacteria change milk into yoghurt.', scheme: pts('One food example with its microorganism (e.g. bacteria change milk into yoghurt or cheese)') })],
    } } };
    const flags = sharedKeyFacts(exam);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ slot: 'science.C.Q3a', reason: 'giveaway', printed: false });
    expect(flags[0].with).toEqual(['science.B.Q2b']);
    expect(scienceRepeats(exam).some((f) => f.slot === 'science.C.Q3a')).toBe(true);
  });

  it('flags fungi breaking down dead matter paid in two places', () => {
    const exam = { unseen: { subjective: {
      'Logical Reasoning': [item('science.B.Q2b', 'Bread in a damp jar.', { questions: [
        { question: 'What does this show about fungi?', answer: 'Fungi break down the bread, which is dead organic matter.', scheme: pts('Explains that fungi break down (decompose) the bread') },
      ] })],
      'Brief Answers': [item('science.C.Q3a', 'How do fungi help in nature?', { answer: 'They break down dead plants and animals.', scheme: pts('They break down (decompose) dead plants and animals') })],
    } } };
    expect(sharedKeyFacts(exam)).toHaveLength(1);
  });

  it('does not flag two items on one topic with different facts, nor items of one slot', () => {
    const exam = { unseen: { subjective: {
      'Brief Answers': [
        item('science.C.Q3a', 'Name the sense organs.', { answer: 'Eyes, ears, nose, tongue, skin.', scheme: pts('Eyes', 'Ears', 'Nose') }),
        item('science.C.Q3a', 'How does the skin help?', { answer: 'The skin feels heat and touch.', scheme: pts('The skin senses heat') }),
      ],
      'Long Question': [item('science.C.Q3b', 'How does a compass work?', { answer: 'The needle is a magnet.', scheme: pts('The needle is a small magnet') })],
    } } };
    expect(sharedKeyFacts(exam)).toEqual([]);
  });
});

describe('slot rules (prompt) for findings 1, 2, 3, 4, 5, 6, 8, 9', () => {
  it('1. Q1 (b) is the five circuit symbols the engine draws, never a picture the teacher must supply', () => {
    const r = rule('science.A.Q1b');
    expect(r).toMatch(/wire, cell, closed switch, open switch and lamp/);
    expect(r).toMatch(/the paper draws/i);
    expect(r).not.toMatch(/teacher draws or pastes/);
    const key = '1. Wire, 2. Cell, 3. Closed switch, 4. Open switch, 5. Lamp';
    expect(circuitPicture({ answer: key })).not.toBeNull();
  });

  it('2. labels are the Grade 5 book terms: crust, mantle, outer core, inner core', () => {
    const r = rule('science.B.Q2a');
    expect(r).toMatch(/crust, mantle, outer core and inner core/);
    expect(r).toMatch(/never continental or oceanic plate/);
  });

  it('3. an MCQ never states another item\'s answer, including the term a stem or option prints', () => {
    const r = rule('science.A.Q1a');
    expect(r).toMatch(/Round 7 \(v37\)/);
    expect(r).toMatch(/frosted/);
    expect(r).toMatch(/lowest crests|tallest crests/);
  });

  it('4. every stem states only true science', () => {
    expect(rule('science.B.Q2b')).toMatch(/states only true science/);
  });

  it('5. every sub-question writes its points, one per idea, adding to 2.5', () => {
    expect(rule('science.B.Q2b')).toMatch(/never leave `points` empty/);
  });

  it('6. a how-do-you-know or why key accepts each reasonable idea', () => {
    expect(rule('science.B.Q2b')).toMatch(/accepts each reasonable idea/);
  });

  it('8. a classification the paper extends is never asked with a fixed count', () => {
    const r = rule('science.C.Q3a');
    expect(r).toMatch(/noise/);
    expect(r).toMatch(/any three/);
  });

  it('9. two items never pay the same key fact', () => {
    expect(rule('science.B.Q2b')).toMatch(/same key fact/);
    expect(rule('science.C.Q3a')).toMatch(/same key fact/);
  });

  it('never uses the word likely in the science rules', () => {
    P.sections.flatMap((s) => s.slots).forEach((s) => expect(s.prompt_rule).not.toMatch(/likely/i));
  });
});
