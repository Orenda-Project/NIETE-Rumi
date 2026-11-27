/**
 * Three training-driver failures of mock run 20261126-2322-par (sandbox dc2ab6f259) that were the driver, not the bot.
 *
 * T83  The Urdu lesson quiz's Q2 (earnings Rs 105, investment Rs 40) and Q6 (earnings Rs 120, investment Rs 55)
 *      both answer Rs 65. The spec keeps such look-alikes ("the same question about another number … both
 *      stay"); duplicates() compared word sets only, so the different numbers did not count.
 * T78  Since the class-report change of 21 Nov a teacher's /quiz ask no longer stamps report_sent_at — that stamp
 *      is the automatic report's. The driver built "I already received the class report" from two asks, so the
 *      scheduled run it then fired was the FIRST automatic report and sent (generate returned true). The driver
 *      must deliver the automatic report first, then show the second scheduled run is suppressed.
 * T15  The scenario is tagged @obsolete since 27 Oct (the intent classifier opens the menu row she names); the
 *      driver still asserted the old reply.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const { duplicates } = require('../../.claude/qa/shared/quiz-duplicates.cjs');

const q = (n, text, key) => ({ sort_order: n, question_text: text, option_a: key, option_b: 'Rs $145.00$', option_c: 'Rs $105.00$', correct_option: 'A' });

describe('T83 — duplicates() keeps two questions that differ only in their numbers', () => {
  test('the run\'s Q2 / Q6 pair (same answer, other numbers) is not a repeat', () => {
    const qs = [
      q(2, 'اگر کل earnings Rs $105.00$ ہو اور investment کی رقم Rs $40.00$ ہو تو profit کتنا ہوگا؟', 'Rs $65.00$'),
      q(6, 'اگر آپ نے lemonade بیچ کر Rs $120.00$ کی earnings حاصل کیں اور آپ کی investment کی رقم Rs $55.00$ تھی تو آپ کا profit کتنا ہوگا؟', 'Rs $65.00$'),
    ];
    expect(duplicates(qs)).toEqual([]);
  });
  test('the same question with the same numbers is still a repeat', () => {
    const qs = [
      q(1, 'اگر کل earnings Rs $105.00$ ہو اور investment کی رقم Rs $40.00$ ہو تو profit کتنا ہوگا؟', 'Rs $65.00$'),
      q(4, 'اگر earnings Rs $105.00$ ہو اور investment کی رقم Rs $40.00$ ہو تو profit کتنا ہو گا؟', 'Rs $65.00$'),
    ];
    expect(duplicates(qs)).toHaveLength(1);
  });
  test('a fill-in-the-blank and a question on the same fact still count as one', () => {
    const qs = [
      { sort_order: 1, question_text: 'What is the value of 6 in 61?', option_a: 'sixty', option_b: 'six', correct_option: 'A' },
      { sort_order: 2, question_text: 'The value of 6 in 61 is ____', option_a: 'six', option_b: 'sixty', correct_option: 'B' },
    ];
    expect(duplicates(qs)).toHaveLength(1);
  });
});

describe('T78 — the automatic report goes first, then a second scheduled run must stand down', () => {
  const src = read('.claude/qa/shared/training-quiz-gen.cjs');
  const i = src.indexOf('// T78 —');
  const block = src.slice(i, i + 2600);
  test('two scheduled runs: the first delivers the automatic report, the second is the one judged', () => {
    const runs = block.match(/SC\.job\('run', 'quiz_video_report'/g) || [];
    expect(runs.length).toBe(2);
    expect(block).toMatch(/firstAuto/);
    expect(block).toMatch(/sched\.result === false/);
  });
});

describe('T15 — an @obsolete scenario is recorded SKIP with its reason, not asserted', () => {
  const src = read('.claude/qa/shared/features/training.cjs');
  const i = src.indexOf("if (want('T15'))");
  const block = src.slice(i, i + 1200);
  test('T15 records SKIP and names @obsolete', () => {
    expect(block).toMatch(/'SKIP'/);
    expect(block).toMatch(/@obsolete/);
    expect(block).not.toMatch(/sendWait\('\/teacher training'\)/);
  });
});
