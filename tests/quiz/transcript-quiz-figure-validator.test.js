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
    const r = run(six({ figure: { type: 'numberline', from: -50, to: 50, step: 1, labelFormat: 'integer', points: [{ at: 3 }] } }));
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

describe('FIGURE_EMPTY — a picture with nothing to read off', () => {
  // A real generation drew a 3x1 "grid" with no shaded cell to show "rows of
  // numbers": three empty boxes that ran over a whole PDF page and told the
  // child nothing. A figure must carry information before it earns a slot.
  test('a grid with no shaded cell, or a single column, is rejected', () => {
    const r1 = run(six({ figure: { type: 'grid', rows: 3, cols: 1 }, question: 'Look at the picture. Which row is right?' }));
    expect(errorsOf(r1)).toMatch(/q0: FIGURE_EMPTY/);
    const r2 = run(six({ figure: { type: 'grid', rows: 4, cols: 5 }, question: 'In the picture, how many cells are shaded?' }));
    expect(errorsOf(r2)).toMatch(/q0: FIGURE_EMPTY/);
    const ok = run(six({ figure: { type: 'grid', rows: 4, cols: 5, shaded: 12 }, question: 'In the picture, how many cells are shaded?' }));
    expect(errorsOf(ok)).not.toMatch(/FIGURE_EMPTY/);
  });
  test('a fraction bar with one part, a number line with no point, a timeline with one event are rejected', () => {
    expect(errorsOf(run(six({ figure: { type: 'fraction_bar', bars: [{ parts: 1, shaded: 1 }] }, question: 'In the picture, what part is shaded?' })))).toMatch(/FIGURE_EMPTY/);
    expect(errorsOf(run(six({ figure: { type: 'numberline', from: 0, to: 10, step: 1 }, question: 'In the picture, which point is at 3?' })))).toMatch(/FIGURE_EMPTY/);
    expect(errorsOf(run(six({ figure: { type: 'timeline', events: [{ date: '1947', label: 'Independence' }] }, question: 'In the picture, what came first?' })))).toMatch(/FIGURE_EMPTY/);
  });
});

describe('calibration round 2 — what the corpus run drew wrong', () => {
  test('geometry used as a picture of things (shapes with no labels, sides or angles) is FIGURE_EMPTY', () => {
    // A real generation drew "farmers drying cocoa beans" as a sand rectangle
    // and brown circles with page tokens the engine does not define — a blank.
    const scene = { type: 'geometry', shapes: [
      { kind: 'rectangle', points: [[0, 0], [100, 0], [100, 50], [0, 50]], fill: 'var(--sand)' },
      { kind: 'circle', center: [15, 15], radius: 5, fill: 'var(--brown)' },
    ] };
    const r = run(six({ figure: scene, question: 'Look at the picture. What are the farmers doing?' }));
    // Round 4 rejects the undefined colour tokens even earlier; either way the scene never ships.
    expect(errorsOf(r)).toMatch(/q0: FIGURE_(EMPTY|TYPE)/);
    const sceneNoColour = { type: 'geometry', shapes: [{ kind: 'polygon', points: [[0, 0], [100, 0], [100, 50], [0, 50]] }, { kind: 'circle', c: [15, 15], r: 5 }] };
    expect(errorsOf(run(six({ figure: sceneNoColour, question: 'Look at the picture. What are the farmers doing?' })))).toMatch(/q0: FIGURE_EMPTY/);
    const maths = { type: 'geometry', shapes: [{ kind: 'triangle', points: [[0, 0], [4, 0], [0, 3]], labels: ['A', 'B', 'C'], sides: ['4 cm', '5 cm', '3 cm'] }] };
    expect(errorsOf(run(six({ figure: maths, question: 'In the picture, which side is the longest?' })))).not.toMatch(/FIGURE_EMPTY/);
  });
  test('a number-line jump arc that lands on the correct answer is FIGURE_LEAK', () => {
    const jump = { type: 'numberline', from: 0, to: 10, step: 1, points: [{ at: 3, style: 'dot' }], arcs: [{ from: 3, to: 7, label: '+ 4' }] };
    const r = run(six({ figure: jump, question: 'On the number line in the picture, what is 3 + 4?', options: ['7', '4', '3'], correct_index: 0,
      option_feedback: { correct: 'Yes, three and four more is seven.', wrong: { 1: 'Four is how far we jumped, not where we land.', 2: 'Three is where we started.' } } }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_LEAK/);
    const ask = { type: 'numberline', from: 0, to: 10, step: 1, points: [{ at: 3, style: 'dot' }] };
    expect(errorsOf(run(six({ figure: ask, question: 'Start at the dot in the picture and jump 4 to the right. Where do you land?', options: ['7', '4', '3'], correct_index: 0,
      option_feedback: { correct: 'Yes.', wrong: { 1: 'no', 2: 'no' } } })))).not.toMatch(/FIGURE_LEAK/);
  });
});

describe('calibration round 3 — what two reviewers found in the 12 corpus figures (3/12 clean)', () => {
  const FB = { correct: 'Yes.', wrong: { 1: 'no', 2: 'no' } };
  test('FIGURE_BLANK: a drawing with fewer than three visible primitives is rejected even when the engine did not throw', () => {
    // A geometry "scene" of text nodes and unknown kinds rendered as a 100%-white PNG with svg_ok=true.
    const r = run(six({ figure: { type: 'geometry', shapes: [{ kind: 'text', at: [0, 0], label: 'x', labels: ['x'] }] }, question: 'In the picture, what is drawn?' }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_(EMPTY|BLANK)/);
  });
  test('an unknown geometry shape kind is a hard error, never a silently skipped shape', () => {
    const r = run(six({ figure: { type: 'geometry', shapes: [{ kind: 'rocket', points: [[0, 0], [1, 1]], labels: ['A', 'B'] }] }, question: 'In the picture, which point is higher?' }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_EMPTY[^|]*kind/);
  });
  test('FIGURE_LEAK: the "every option appears" exemption is only for letter handles, not for options filed inside the drawing', () => {
    // A flow chart printed the correct option under one heading and both distractors under the other.
    const flow = { type: 'flow', direction: 'lr', steps: [{ title: 'سست رفتار', lines: ['تانگا'] }, { title: 'تیز رفتار', lines: ['کار', 'جہاز'] }] };
    const r = run(six({ figure: flow, question: 'تصویر میں سست رفتار سواری کون سی ہے؟', options: ['تانگا', 'کار', 'جہاز'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_LEAK/);
    const nl = { type: 'numberline', from: -5, to: 5, step: 1, points: [{ at: -3, label: 'A' }, { at: 1, label: 'B' }, { at: 4, label: 'C' }] };
    expect(errorsOf(run(six({ figure: nl, question: 'Which point is at −3?', options: ['A', 'B', 'C'], correct_index: 0, option_feedback: FB })))).not.toMatch(/FIGURE_LEAK/);
  });
  test('FIGURE_LEAK: a grid whose rows or columns equal the answer pre-partitions a sharing problem', () => {
    const grid = { type: 'grid', rows: 3, cols: 4, shaded: 12 };
    const r = run(six({ figure: grid, question: 'Share 12 flowers equally among 3 vases. How many in each?', options: ['4', '3', '12'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_LEAK/);
  });
  test('FIGURE_REDUNDANT: a stem that already states the numbers the picture shows does not need the picture', () => {
    const bar = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 1 }] };
    const r = run(six({ figure: bar, question: 'A bar has 4 equal parts and 1 is shaded. Look at the picture. Which fraction is shaded?', options: ['1/4', '3/4', '4/1'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_REDUNDANT/);
    const ok = run(six({ figure: bar, question: 'In the picture, which fraction of the bar is shaded?', options: ['1/4', '3/4', '4/1'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(ok)).not.toMatch(/FIGURE_REDUNDANT/);
    const arc = { type: 'numberline', from: 0, to: 10, step: 1, points: [{ at: 3 }], arcs: [{ from: 3, to: 7, label: '+ 4' }] };
    expect(errorsOf(run(six({ figure: arc, question: 'Start at 3 and add 4. What is 3 + 4?', options: ['8', '4', '9'], correct_index: 0, option_feedback: FB })))).toMatch(/FIGURE_REDUNDANT/);
  });
});

describe('calibration round 4 — reviewer regrade of v3', () => {
  const FB = { correct: 'Yes.', wrong: { 1: 'no', 2: 'no' } };
  test('a geometry shape missing the keys its kind needs is FIGURE_EMPTY (the engine drops it silently)', () => {
    const r = run(six({ figure: { type: 'geometry', shapes: [{ kind: 'circle', center: [0, 0], radius: 3, label: 'wheel' }, { kind: 'line', points: [[0, 0], [1, 1]], label: 'x' }] }, question: 'In the picture, which is bigger?' }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_EMPTY[^|]*(keys|needs)/);
    const ok = run(six({ figure: { type: 'geometry', shapes: [{ kind: 'circle', c: [0, 0], r: 3, label: 'O' }, { kind: 'segment', from: [0, 0], to: [3, 0], label: 'r' }] }, question: 'In the picture, what is the segment from O called?' }));
    expect(errorsOf(ok)).not.toMatch(/FIGURE_EMPTY/);
  });
  test('a colour token the page never defines is rejected instead of painting grey', () => {
    const r = run(six({ figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3, color: 'var(--brown)' }] }, question: 'In the picture, what part is shaded?' }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_(EMPTY|TYPE)[^|]*token/);
  });
  test('FIGURE_MISMATCH: the picture must be able to produce the correct option', () => {
    // "12 shared into 3 parts" (answer 4) drawn as three bars each 1/3 shaded — no reading yields 4.
    const bars = { type: 'fraction_bar', bars: [{ parts: 3, shaded: 1 }, { parts: 3, shaded: 1 }, { parts: 3, shaded: 1 }] };
    const r = run(six({ figure: bars, question: 'In the picture, how many in each part?', options: ['4', '3', '12'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_MISMATCH/);
    const good = run(six({ figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] }, question: 'In the picture, what fraction is shaded?', options: ['3/4', '1/4', '4/3'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(good)).not.toMatch(/FIGURE_MISMATCH/);
    const grid = run(six({ figure: { type: 'grid', rows: 4, cols: 5, shaded: 12 }, question: 'In the picture, how many cells are shaded?', options: ['12', '8', '20'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(grid)).not.toMatch(/FIGURE_MISMATCH/);
    const gridBad = run(six({ figure: { type: 'grid', rows: 4, cols: 5, shaded: 12 }, question: 'In the picture, how many cells are shaded?', options: ['7', '8', '20'], correct_index: 0, option_feedback: FB }));
    expect(errorsOf(gridBad)).toMatch(/q0: FIGURE_MISMATCH/);
  });
  test('geometry is not offered outside mathematics', () => {
    const sci = validate(six({ figure: { type: 'geometry', shapes: [{ kind: 'triangle', points: [[0, 0], [4, 0], [0, 3]], labels: ['A', 'B', 'C'] }] }, question: 'In the picture, which side is longest?' }),
      { language: 'en', subject: 'science', digest: DIGEST, nExpected: 6 });
    expect(sci.errors.join(' | ')).toMatch(/q0: FIGURE_TYPE[^|]*mathematics/);
  });
});

describe('figure labels get the transliteration fixer too (a live bar was labelled سرکل)', () => {
  test('an Urdu quiz figure label written as a transliteration is rewritten in English letters', () => {
    const qs = six({ figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 1, label: 'سرکل' }] }, question: 'تصویر میں کتنا حصہ رنگا ہوا ہے؟' });
    const r = validate(qs, { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 6 });
    expect(JSON.stringify(r.questions[0].figure)).toMatch(/circle/);
    expect(JSON.stringify(r.questions[0].figure)).not.toMatch(/سرکل/);
  });
});
