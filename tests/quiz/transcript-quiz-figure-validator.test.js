'use strict';
/**
 * The validator's FIGURE checks.
 *
 * Five distinct error strings, because the retry prompt quotes them straight
 * back to the model: a single "bad figure" would send it re-rolling blind.
 * The validator also RENDERS each figure once and hands the SVG back on the
 * question, so generate and the teacher PDF never draw the same figure twice.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = {
  subject: 'maths',
  slos: [{ id: 'S1', statement: 'read a number line', taught_level: 'understand' }],
};

const FRACTION = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] };
const NUMBERLINE = {
  type: 'numberline', from: -5, to: 5, step: 1, labelFormat: 'integer',
  points: [{ at: -3, style: 'dot', label: 'A' }, { at: 1, style: 'dot', label: 'B' }, { at: 4, style: 'dot', label: 'C' }],
};

function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: what fraction of the bar is shaded?`,
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

describe('a clean quiz with no figures is unaffected', () => {
  test('still passes', () => {
    const r = run(six());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.questions[0].figureSvg).toBeUndefined();
  });
});

describe('FIGURE_TYPE', () => {
  test('a type off the allowlist is rejected by name', () => {
    const r = run(six({ figure: { type: 'mindmap', centre: { label: 'Fractions' }, branches: [] } }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_TYPE/);
    expect(errorsOf(r)).toMatch(/mindmap/);
  });

  test('a figure that is not an object is a FIGURE_TYPE error, not a crash', () => {
    const r = run(six({ figure: 'a picture of a fraction bar' }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_TYPE/);
  });
});

describe('FIGURE_RENDER', () => {
  test('a spec whose labels collide is rejected', () => {
    const r = run(six({ figure: { type: 'numberline', from: -50, to: 50, step: 1, labelFormat: 'integer' } }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_RENDER/);
  });
});

describe('FIGURE_LEAK', () => {
  test('a label that names only the correct option leaks', () => {
    const r = run(six({
      question: 'Which point is at −3?',
      options: ['A', 'B', 'C'], correct_index: 0,
      distractor_misconceptions: { 1: 'counted from the right', 2: 'counted the ticks' },
      option_feedback: {
        correct: 'Yes — A sits three steps left of zero.',
        wrong: { 1: 'B is at 1; count left from zero.', 2: 'C is at 4; −3 is on the left side.' },
      },
      // only the correct point is named, so the picture answers the question
      figure: { type: 'numberline', from: -5, to: 5, step: 1, labelFormat: 'integer', points: [{ at: -3, style: 'dot', label: 'A' }] },
    }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_LEAK/);
  });

  test('a label the ENGINE draws leaks too, not just one in the spec', () => {
    // showLabels re-enables the computed "3/4" beside the bar — which is the
    // answer, and appears nowhere in the spec.
    const qs = [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? {
      options: ['1/2', '3/4', '2/3'], correct_index: 1,
      distractor_misconceptions: { 0: 'counted two parts', 2: 'counted three of three' },
      option_feedback: {
        correct: 'Yes — three of four parts.',
        wrong: { 0: 'That is two of four.', 2: 'That would be three of three.' },
      },
      figure: { type: 'fraction_bar', showLabels: true, bars: [{ parts: 4, shaded: 3 }] },
    } : {}));
    expect(errorsOf(run(qs))).toMatch(/q0: FIGURE_LEAK/);
  });

  test('a figure that labels every option is legal', () => {
    const r = run(six({
      question: 'Which point is at −3?',
      options: ['A', 'B', 'C'], correct_index: 0,
      distractor_misconceptions: { 1: 'counted from the right', 2: 'counted the ticks' },
      option_feedback: {
        correct: 'Yes — A sits three steps left of zero.',
        wrong: { 1: 'B is at 1; count left from zero.', 2: 'C is at 4; −3 is on the left side.' },
      },
      figure: NUMBERLINE,
    }));
    expect(errorsOf(r)).not.toMatch(/FIGURE_LEAK/);
  });
});

describe('FIGURE_SHARE', () => {
  test('more than half the questions carrying a figure is rejected once, for the quiz', () => {
    const qs = six().map((x, i) => (i < 4 ? { ...x, figure: FRACTION } : x));
    const r = run(qs);
    expect(r.ok).toBe(false);
    const hits = r.errors.filter((e) => /FIGURE_SHARE/.test(e));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/4\/6/);
  });

  test('exactly half is allowed', () => {
    const qs = six().map((x, i) => (i < 3 ? { ...x, figure: FRACTION } : x));
    expect(errorsOf(run(qs))).not.toMatch(/FIGURE_SHARE/);
  });
});

describe('FIGURE_MISSING', () => {
  test('an English stem that promises a picture must carry one', () => {
    const r = run(six({ question: 'How many parts in the picture are shaded?' }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_MISSING/);
  });

  test('an Urdu stem that promises a picture must carry one', () => {
    const qs = six({ question: 'تصویر میں کتنے حصے رنگے ہوئے ہیں؟' });
    const r = validate(qs, { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 6 });
    expect(errorsOf(r)).toMatch(/q0: FIGURE_MISSING/);
  });

  test('the same stem WITH a figure is fine', () => {
    const r = run(six({ question: 'How many parts in the picture are shaded?', figure: FRACTION }));
    expect(errorsOf(r)).not.toMatch(/FIGURE_MISSING/);
  });
});

describe('the rendered SVG rides back on the question', () => {
  test('so generate and the teacher PDF never render it twice', () => {
    const r = run(six({ figure: FRACTION }));
    expect(r.ok).toBe(true);
    expect(r.questions[0].figureSvg).toMatch(/^<svg/);
    expect(r.questions[1].figureSvg).toBeUndefined();
  });

  test('an Urdu quiz renders its figure in Urdu', () => {
    const qs = [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0
      ? { figure: { ...FRACTION, title: 'کسر کی پٹی' } } : {}));
    const r = validate(qs, { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 6 });
    expect(r.questions[0].figureSvg).toMatch(/<foreignObject/);
  });
});
