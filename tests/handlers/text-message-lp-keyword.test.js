/**
 * Pakistan LP keyword trigger (FEAT-059) — asserts the `lp` / `lesson plan`
 * / `لیسن پلان` regex in text-message.handler.js matches teacher-typed
 * variants without false-triggering on ordinary lesson-plan requests
 * (e.g. "make me a lesson plan for maths").
 *
 * Follows the same source-extraction pattern as tests/training/training-
 * trigger-no-slash.test.js — keeps the test glued to the actual condition
 * without booting the ~40-service handler.
 */

const fs = require('fs');
const path = require('path');

const HANDLER_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'bot',
  'shared',
  'handlers',
  'text-message.handler.js'
);

function loadLpKeywordRegex() {
  const source = fs.readFileSync(HANDLER_PATH, 'utf8');
  const anchor = source.indexOf('PAKISTAN LP KEYWORD');
  if (anchor < 0) {
    throw new Error(
      'Could not find PAKISTAN LP KEYWORD anchor in text-message.handler.js — ' +
      'the handler may have been restructured.'
    );
  }
  // Grab the line assigning `lpKeyword = /.../`.
  const line = source.slice(anchor).split('\n').find(l => l.includes('lpKeyword ='));
  if (!line) throw new Error('lpKeyword assignment not found');
  const m = line.match(/lpKeyword\s*=\s*(\/[^;]+\/[gimsuy]*)\s*\.test/);
  if (!m) throw new Error(`Could not extract regex from: ${line}`);
  // eslint-disable-next-line no-eval
  const regex = eval(m[1]);
  return (trimmed) => regex.test(trimmed);
}

describe('LP keyword trigger — text-message.handler.js', () => {
  let fires;
  beforeAll(() => { fires = loadLpKeywordRegex(); });

  // Positive cases: teacher-typed variants that MUST open the LP Flow.
  test.each([
    ['lp'],
    ['LP'],
    ['Lp'],
    ['lesson plan'],
    ['Lesson Plan'],
    ['LESSON PLAN'],
    ['lesson-plan'],
    ['lessonplan'], // no space
    ['/lp'],
    ['لیسن پلان'],  // Urdu
    ['لیسنپلان'],   // Urdu, no space
  ])('fires on %p', (input) => {
    expect(fires(input)).toBe(true);
  });

  // Negative cases: LP requests with topic must NOT match — they belong to
  // the existing curriculum-LP topic intercept, not the Flow trigger.
  test.each([
    ['lesson plan for grade 3 math'],
    ['I need a lesson plan on photosynthesis'],
    ['plan lesson - create pdf lesson plans instantly'],
    ['make me an lp on adjectives'],
    ['lps'],
    ['train'],
    [''],
    ['hi'],
    ['lesson'],
    ['plan'],
  ])('does NOT fire on %p', (input) => {
    expect(fires(input)).toBe(false);
  });
});
