/**
 * The five training mock-lane failures that rode every branch since 24 Nov (bd-ke5dtg; run 20261125-164735-b68134a-mock).
 * Each was read in that run's evidence, not guessed:
 *
 * T15  the scenario is @obsolete since 27 Oct (bd-1r3k2h): the intent classifier opens Teacher Training for
 *      "/teacher training" by design (bd-xw56ed). The lane still asserted the retired behaviour.
 * T78  since fcda95623a (21 Nov) a teacher's /quiz ask never stamps report_sent_at, so the first scheduled run after
 *      the asks IS the one automatic report and arrives. The lane expected it suppressed.
 * T81  the sheet prints "WHAT YOU TAUGHT" letter-spaced; extracted text reads "W H AT Y O U TA U G H T".
 * T83  "105 − 40" and "120 − 55" both answer 65 — different numbers, so different questions (the spec keeps them).
 * T54  is a product fix: tests/quiz/quiz-author-gates-figures.test.js.
 *
 * Red-first: every assertion failed on the branch before the change.
 */
const fs = require('fs');
const path = require('path');
const { describeWithEngine } = require('./engine');
const REPO = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

describe('T15 — an @obsolete scenario is not driven', () => {
  test('training.cjs records no T15 verdict', () => {
    const src = read('.claude/qa/shared/features/training.cjs');
    expect(src).not.toMatch(/rec\('T15'/);
    expect(src).not.toMatch(/want\('T15'\)/);
  });
  test('the spec still carries T15, tagged @obsolete', () => {
    expect(read('tests/features/whatsapp/niete/training.feature')).toMatch(/@T15 @obsolete/);
  });
});

describe('T78 — the one automatic report lands first, the late child\'s scheduled run is suppressed', () => {
  const src = read('.claude/qa/shared/training-quiz-gen.cjs');
  const block = src.slice(src.indexOf('// T78 —'), src.indexOf("done('T78'") + 200);
  test('two scheduled runs: the first must arrive, the second (after the late child) must not', () => {
    expect((block.match(/SC\.job\('run', 'quiz_video_report'/g) || []).length).toBe(2);
    expect(block.indexOf('const first = await SC.job')).toBeLessThan(block.indexOf('childRunKeyed(k22'));
    expect(block.indexOf('childRunKeyed(k22')).toBeLessThan(block.indexOf('const sched = await SC.job'));
    expect(block).toMatch(/V\(firstAuto\.ok && sched\.result === false && !auto\.ok/);
  });
});

describe('T81 — the sheet headings are matched through letter-spacing', () => {
  const src = read('.claude/qa/shared/training-quiz-gen.cjs');
  test('the heading match removes spaces before comparing', () => {
    expect(src).toMatch(/heading\(l\)\.includes\('whatyoutaught'\)/);
    expect(src).toMatch(/heading\(l\)\.includes\('whatthisquizchecks'\)/);
  });
  test('the letter-spaced extract of the 25 Nov sheet reads as both headings', () => {
    const heading = (l) => String(l).replace(/\s+/g, '').toLowerCase();
    expect(heading('W H AT Y O U TA U G H T')).toBe('whatyoutaught');
    expect(heading('W H AT T H I S Q U I Z C H E C K S')).toBe('whatthisquizchecks');
  });
});

describeWithEngine('T83 — same answer about different numbers is not a repeat', () => {
  const q = (i, stem, key) => ({ sort_order: i, question_text: stem, option_a: key, option_b: 'x', correct_option: 'A' });
  const load = () => require(path.join(REPO, '.claude/qa/shared/training-quiz-gen.cjs'))._test;
  test('the 25 Nov Urdu pair (105 − 40, 120 − 55) is two questions', () => {
    const { duplicates } = load();
    expect(duplicates([
      q(2, 'اگر کل earnings Rs $105.00$ ہو اور investment کی رقم Rs $40.00$ ہو تو منافع کتنا ہوگا؟', 'Rs $65.00$'),
      q(6, 'اگر کل earnings Rs $120.00$ ہو اور investment کی رقم Rs $55.00$ ہو تو منافع کتنا ہوگا؟', 'Rs $65.00$'),
    ])).toEqual([]);
  });
  test('the same stem about the same numbers is still a repeat', () => {
    const { duplicates } = load();
    expect(duplicates([q(1, 'What is 3/4 of 8?', '6'), q(2, 'What is 3/4 of 8 ?', '6')])).toHaveLength(1);
  });
  test('numbersOf folds Urdu digits and trailing zeros', () => {
    const { numbersOf } = load();
    expect(numbersOf('۱۰۵ اور 40.00')).toBe(numbersOf('105 and 40'));
  });
});
