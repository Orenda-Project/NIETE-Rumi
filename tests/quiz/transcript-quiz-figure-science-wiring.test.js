'use strict';
/**
 * The science-accuracy gate, wired into the quiz validator (PLAN_R4 D7e/D7f).
 *
 * transcript-quiz-figure-science.test.js proves the four defect functions
 * against the live renderer. This file proves the VALIDATOR runs them — that a
 * spec the engine draws happily and which teaches something false about the
 * world is rejected before a single row is stored, and that `molecule` is back
 * on the allowlist behind its dictionary and nowhere else.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const { MOLECULE_DICTIONARY } = require('../../bot/shared/services/quiz/transcript-quiz-figure-science');

const DIGEST = { subject: 'science', slos: [{ id: 'S1', statement: 'name the parts of a cell', taught_level: 'understand' }] };

function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: what does the picture show about the lesson?`,
    options: [`the first idea ${i}`, `the second idea ${i}`, `the third idea ${i}`],
    correct_index: 2,
    explanation: 'The third option matches what the class saw.',
    distractor_misconceptions: { 0: 'muddled it with the opposite', 1: 'named the container, not the part' },
    option_feedback: {
      correct: 'Yes — that is the one the class looked at.',
      wrong: { 0: 'That is the opposite of what happened.', 1: 'That names the whole thing, not the part.' },
    },
    ...over,
  };
}
const six = (over = {}) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
const run = (qs, subject = 'science') => validate(qs, { language: 'en', subject, digest: DIGEST, nExpected: 6 });
const errorsOf = (r) => r.errors.join(' | ');

describe('FIGURE_CHEM — an equation that does not balance is not a fact', () => {
  test('the unbalanced equation is rejected and the error names the element', () => {
    const r = run(six({ figure: { type: 'chem_equation', equation: 'H2 + O2 -> H2O' } }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_CHEM/);
    expect(errorsOf(r)).toMatch(/O is 2 on the left and 1 on the right/);
  });

  test('the balanced one passes', () => {
    const r = run(six({ figure: { type: 'chem_equation', equation: '2H2 + O2 -> 2H2O' } }));
    expect(errorsOf(r)).not.toMatch(/FIGURE_CHEM/);
  });

  test('an equation the child is asked to balance is allowed when the author says so', () => {
    const r = run(six({ figure: { type: 'chem_equation', equation: 'H2 + O2 -> H2O', balanced: false } }));
    expect(errorsOf(r)).not.toMatch(/FIGURE_CHEM/);
  });
});

describe('FIGURE_ATOM — an off-table element draws a different atom wearing the label', () => {
  test('xenon with no Z is rejected', () => {
    const r = run(six({ figure: { type: 'atom', element: 'Xe' } }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_ATOM/);
    expect(errorsOf(r)).toMatch(/DIFFERENT element/);
  });

  test('sodium passes, and so does xenon once the spec gives Z and its shells', () => {
    expect(errorsOf(run(six({ figure: { type: 'atom', element: 'Na' } })))).not.toMatch(/FIGURE_ATOM/);
    expect(errorsOf(run(six({ figure: { type: 'atom', element: 'Xe', Z: 54, shells: [2, 8, 18, 18, 8] } }))))
      .not.toMatch(/FIGURE_ATOM/);
  });
});

describe('FIGURE_CELL — a part the chosen cell has not got is silently dropped by the engine', () => {
  test('a chloroplast on an animal cell is rejected, and the error says why', () => {
    const r = run(six({ figure: { type: 'cell', kind: 'animal', parts: ['chloroplast', 'nucleus'] } }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_CELL/);
    expect(errorsOf(r)).toMatch(/an animal cell has no chloroplast/);
  });

  test('the same parts on a plant cell pass', () => {
    expect(errorsOf(run(six({ figure: { type: 'cell', kind: 'plant', parts: ['chloroplast', 'nucleus'] } }))))
      .not.toMatch(/FIGURE_CELL/);
  });
});

describe('FIGURE_MOLECULE — molecule is back on the allowlist, behind the dictionary', () => {
  test('molecule is an allowed type again', () => {
    expect(Figure.ALLOWED_TYPES).toContain('molecule');
    expect(Figure.canonicalType('molecule')).toBe('molecule');
  });

  test('a formula in the dictionary draws', () => {
    const r = run(six({ figure: { type: 'molecule', formula: 'H2O' } }));
    expect(errorsOf(r)).not.toMatch(/FIGURE_MOLECULE/);
  });

  test('a formula outside the dictionary is rejected, and the error lists what is drawable', () => {
    const r = run(six({ figure: { type: 'molecule', formula: 'C6H12O6', smiles: 'OCC1OC(O)C(O)C(O)C1O' } }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_MOLECULE/);
    expect(errorsOf(r)).toMatch(/H2O/);
  });

  test("the dictionary overwrites the model's SMILES rather than trusting it", () => {
    // The author agreed with the dictionary's formula but wrote no SMILES at
    // all: the drawing must still be the real structure, from code.
    const r = run(six({ figure: { type: 'molecule', formula: 'CO2' } }));
    expect(r.questions[0].figure.smiles).toBe(MOLECULE_DICTIONARY.CO2.smiles);
    expect(r.questions[0].figure.name).toBe(MOLECULE_DICTIONARY.CO2.name);
  });

  test('an ionic compound is drawn as a lattice, not as a molecule', () => {
    const r = run(six({ figure: { type: 'molecule', formula: 'NaCl' } }));
    expect(r.questions[0].figure.ionic).toBe(true);
    expect(errorsOf(r)).not.toMatch(/FIGURE_MOLECULE/);
  });
});

describe('the science errors participate in salvage', () => {
  test('each is a q-prefixed FIGURE_ string', () => {
    const r = run(six({ figure: { type: 'atom', element: 'Xe' } }));
    const sci = r.errors.filter((e) => /FIGURE_(CHEM|ATOM|CELL|MOLECULE)/.test(e));
    expect(sci.length).toBeGreaterThan(0);
    sci.forEach((e) => expect(e).toMatch(/^q\d+: FIGURE_/));
  });
});

describe('the author is told the molecule rule', () => {
  test('the prompt names the fixed dictionary and generates its formula list from the code', () => {
    const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
    const p = buildAuthorPrompt({
      digest: { topic: 'Bonding', subject: 'science', grade_band: '6-8', slos: [] },
      excerpts: '…', language: 'en', n: 8, gradeBand: '6-8',
    });
    Object.keys(MOLECULE_DICTIONARY).forEach((f) => expect(p).toContain(f));
    expect(p).toMatch(/molecule[^\n]*only[^\n]*formulas/i);
  });
});
