'use strict';
/**
 * The three lesson-plan lint gates, wired into the quiz validator (PLAN_R4 D7c).
 *
 * transcript-quiz-figure-gates.test.js proves the measurements. This file
 * proves the VALIDATOR calls them — that a figure which renders, paints ink
 * and leaks nothing is still rejected when its labels are too small to read on
 * the phone, when the engine draws two of them on top of each other, or when
 * the shape it draws has no area to read.
 *
 * Each defect keeps its own code because the retry prompt quotes the error
 * strings back to the model verbatim, and each is a `q<i>: FIGURE_` string so
 * salvageWithoutBadFigures can drop the question instead of the quiz.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { renderFigureSvg, FigureError } = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const { labelFloorDefect } = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');

const DIGEST = { subject: 'maths', slos: [{ id: 'S1', statement: 'read a number line', taught_level: 'understand' }] };

function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: what does the picture show?`,
    options: [`one half ${i}`, `two thirds ${i}`, `three quarters ${i}`],
    correct_index: 2,
    explanation: 'Three of the four equal parts are shaded.',
    distractor_misconceptions: { 0: 'counted the unshaded parts', 1: 'counted the lines' },
    option_feedback: {
      correct: 'Yes — three of the four equal parts are shaded.',
      wrong: { 0: 'That counts the parts left over.', 1: 'That counts the dividing lines, not the parts.' },
    },
    ...over,
  };
}
const six = (over = {}) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
const run = (qs) => validate(qs, { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 6 });
const errorsOf = (r) => r.errors.join(' | ');

// A timeline the engine draws happily and a child cannot read: the manifest
// says four to six events, and past that the spine crowds its own labels below
// the 13.5px floor. Nothing before round 4 objected.
const CROWDED_TIMELINE = {
  type: 'timeline',
  events: Array.from({ length: 20 }, (_, k) => ({ date: String(1900 + k), label: `Event number ${k + 1} in the sequence` })),
};

describe('FIGURE_LABEL_SMALL', () => {
  test('a figure whose smallest label falls under the phone floor is rejected, and the error names both sizes', () => {
    const svg = renderFigureSvg(CROWDED_TIMELINE, 'en');
    const defect = labelFloorDefect(svg, 'timeline');
    expect(defect).not.toBeNull();          // the premise: it really is too small
    expect(defect.renderedPx).toBeLessThan(13.5);

    const r = run(six({ figure: CROWDED_TIMELINE, question: 'Question 0: which event is shown first in the picture?' }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_LABEL_SMALL/);
    expect(errorsOf(r)).toMatch(/on the child's phone/);
  });

  test('the figures that ship today are NOT reddened by the floor', () => {
    // Measured on this canvas: fraction_bar 20.6px, numberline 20.6px,
    // grid 47.1px. A gate that fires on these would be wrong.
    [
      { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] },
      { type: 'numberline', from: -5, to: 5, step: 1, points: [{ at: -3, style: 'dot', label: 'A' }, { at: 1, style: 'dot', label: 'B' }, { at: 4, style: 'dot', label: 'C' }] },
      { type: 'grid', rows: 4, cols: 5, shaded: 12 },
    ].forEach((figure) => {
      ['en', 'ur'].forEach((language) => {
        const r = validate(six({ figure, question: 'Question 0: what does the picture show?' }),
          { language, subject: 'maths', digest: DIGEST, nExpected: 6 });
        expect(r.errors.join(' | ')).not.toMatch(/FIGURE_LABEL_SMALL/);
      });
    });
  });
});

describe('FIGURE_OVERLAP', () => {
  test('a collision is its own code, not a generic render failure — the model is told what to fix', () => {
    // A 300x1 "quadrilateral": the auto-fitter stretches it across the canvas
    // and the four vertex labels land on each other's plates.
    const crowded = {
      type: 'geometry',
      shapes: [{ kind: 'polygon', points: [[0, 0], [300, 0], [300, 1], [0, 1]], labels: ['A', 'B', 'C', 'D'] }],
    };
    let code = null;
    try { renderFigureSvg(crowded, 'en'); } catch (err) { code = err instanceof FigureError ? err.code : 'OTHER'; }
    expect(code).toBe('FIGURE_OVERLAP');

    const r = run(six({ figure: crowded, question: 'Question 0: which side of the shape is longest in the picture?' }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_OVERLAP/);
  });
});

describe('FIGURE_DEGENERATE', () => {
  test('a shape drawn with no area to read is rejected by name', () => {
    // Geometrically faithful, pedagogically useless: the sliver checkDegenerate
    // was written for. It renders, it paints ink, it leaks nothing.
    const sliver = {
      type: 'geometry',
      shapes: [{
        kind: 'triangle', points: [[0, 0], [200, 0], [100, 2]],
        labels: ['P', 'Q', 'R'], sides: ['12 cm', '7 cm', '7 cm'],
      }],
    };
    // The premise: it renders, with no collision — only the degeneracy gate sees it.
    const svg = renderFigureSvg(sliver, 'en');
    expect(svg.startsWith('<svg')).toBe(true);

    const r = run(six({ figure: sliver, question: 'Question 0: which corner of the shape is marked R in the picture?' }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_DEGENERATE/);
    expect(errorsOf(r)).toMatch(/sliver/);
  });
});

describe('the gate errors participate in salvage', () => {
  test('every gate error is a q-prefixed FIGURE_ string, which is what salvageWithoutBadFigures matches on', () => {
    const r = run(six({ figure: CROWDED_TIMELINE, question: 'Question 0: which event is shown first in the picture?' }));
    const gateErrors = r.errors.filter((e) => /FIGURE_(LABEL_SMALL|OVERLAP|DEGENERATE)/.test(e));
    expect(gateErrors.length).toBeGreaterThan(0);
    gateErrors.forEach((e) => expect(e).toMatch(/^q\d+: FIGURE_/));
  });
});
