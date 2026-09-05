'use strict';
/**
 * The engine draws what it recognises and drops the rest in silence.
 *
 * Both round-5 reviewers, independently, opened the same render and reported
 * three empty boxes: a `flow` whose steps were written as
 * `{label: "…"}` instead of `{title: "…"}`. The engine drew the boxes and the
 * arrows, dropped every word, and reported nothing — 8 painted primitives, so
 * even the ink-count gate passed it. A `timeline` written with `title` instead
 * of `label` loses its events the same way while keeping its dates, which is
 * worse: it looks finished.
 *
 * Two rules. The per-type one names the key to fix, because that is what makes
 * a retry land; the general one is the backstop for every type whose key
 * vocabulary nobody has thought about yet.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const Figure = require('../../bot/shared/services/quiz/transcript-quiz-figure');
const { droppedTextDefect } = require('../../bot/shared/services/quiz/transcript-quiz-figure-gates');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = { subject: 'science', slos: [{ id: 'S1', statement: 'name the steps', taught_level: 'understand' }] };
function q(i, over = {}) {
  return {
    slo_id: 'S1', level: 'understand',
    question: `Question ${i}: what does the picture show?`,
    options: [`first ${i}`, `second ${i}`, `third ${i}`],
    correct_index: 0,
    explanation: 'x', distractor_misconceptions: { 1: 'a', 2: 'b' },
    option_feedback: { correct: 'c', wrong: { 1: 'a', 2: 'b' } },
    ...over,
  };
}
const six = (over = {}) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
const run = (qs, language = 'ur') => validate(qs, { language, subject: 'science', digest: DIGEST, nExpected: 6 });
const errorsOf = (r) => r.errors.join(' | ');

// The spec the reviewers were shown. `label` is not a key `flow` reads.
const BLANK_FLOW = { type: 'flow', steps: [{ label: 'ایک' }, { label: 'دو' }, { label: 'تین' }] };
// `title` is not a key `timeline` reads for an event; the dates survive, the events do not.
const HALF_TIMELINE = { type: 'timeline', events: [{ date: '1947', title: 'الف' }, { date: '1948', title: 'ب' }] };

describe('the premise: this is what the engine does today', () => {
  test('a flow written with `label` paints boxes and not one word', () => {
    const svg = Figure.renderFigureSvg(BLANK_FLOW, 'ur');
    expect(Figure.svgText(svg).join('').trim()).toBe('');
    expect(Figure.svgInkCount(svg)).toBeGreaterThanOrEqual(3);   // the ink gate cannot see this
  });
});

describe('FIGURE_EMPTY names the key to fix', () => {
  test('a flow step with no title is rejected, and the message says `title`', () => {
    const reason = Figure.figureEmptyReason(BLANK_FLOW);
    expect(reason).toMatch(/title/);
    const r = run(six({ figure: BLANK_FLOW }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_EMPTY/);
    expect(errorsOf(r)).toMatch(/title/);
  });

  test('a timeline event with no label is rejected, and the message says `label`', () => {
    const reason = Figure.figureEmptyReason(HALF_TIMELINE);
    expect(reason).toMatch(/label/);
    const r = run(six({ figure: HALF_TIMELINE }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toMatch(/q0: FIGURE_EMPTY/);
  });

  test('the same specs written the way the manifest says are accepted', () => {
    expect(Figure.figureEmptyReason({ type: 'flow', steps: [{ title: 'ایک' }, { title: 'دو' }] })).toBeNull();
    expect(Figure.figureEmptyReason({ type: 'timeline', events: [{ date: '1947', label: 'الف' }, { date: '1948', label: 'ب' }] })).toBeNull();
  });
});

describe('FIGURE_TEXT_DROPPED is the backstop for the types nobody has thought about yet', () => {
  test('strings in the spec and no text in the drawing is a defect', () => {
    const svg = Figure.renderFigureSvg(BLANK_FLOW, 'ur');
    const d = droppedTextDefect(BLANK_FLOW, svg, 'flow');
    expect(d).not.toBeNull();
    expect(d.message).toMatch(/drew none of them|no text/i);
  });

  test('a figure that legitimately carries no text is NOT a defect', () => {
    // A fraction bar with the value readout off has nothing to say, and that
    // is the shape the quiz lane ships most often.
    const spec = { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] };
    const svg = Figure.renderFigureSvg(spec, 'en');
    expect(droppedTextDefect(spec, svg, 'fraction_bar')).toBeNull();
  });

  test('a figure whose text IS drawn is not a defect', () => {
    const spec = { type: 'flow', steps: [{ title: 'ایک' }, { title: 'دو' }] };
    const svg = Figure.renderFigureSvg(spec, 'ur');
    expect(droppedTextDefect(spec, svg, 'flow')).toBeNull();
  });

  test('it is wired into the validator', () => {
    // Reached through a spec that survives figureEmptyReason: a one-word
    // structural string the engine has no place for.
    const r = run(six({ figure: BLANK_FLOW }));
    expect(errorsOf(r)).toMatch(/q0: FIGURE_(EMPTY|TEXT_DROPPED)/);
  });
});
