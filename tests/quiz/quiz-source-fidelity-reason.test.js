'use strict';
/**
 * AN INVENTED REASON — the answer to a "why" question the lesson never gives
 * (quiz_author_gates_v2's source check).
 *
 * The red team's blind re-score (5 Oct 2026) marked a grade 8 item BLOCKING:
 * "A chameleon changes its skin colour to match its surroundings. Why is this an
 * effective adaptation?" keyed "It helps the chameleon hide from predators and
 * ambush prey". The plan says chameleons use camouflage and names predators; it
 * never says hide or ambush or prey. The quote the author chose was real and
 * shared a word with the key, so every check passed.
 *
 * For a why/how question with an English answer, the source check now also asks
 * whether the answer's own content words are in the lesson at all: when half or
 * more of them (two at least, beyond the stem's words) never appear, the item is
 * refused as SOURCE_QUOTE_NO_REASON and goes through the source check's repair
 * like any other refused item (rewrite on the lesson's moments, else drop within
 * the floor, else a replacement). Pure function: no I/O.
 */
const SF = require('../../bot/shared/services/quiz/transcript-quiz-source-fidelity');

const LESSON = [
  'Teacher: An adaptation is a feature that helps a living thing survive where it lives.',
  'Teacher: Chameleons use camouflage: their skin changes colour so predators find them hard to see.',
  'Teacher: A desert fox has large ears that let body heat escape.',
].join('\n');
const q = (question, key, quote) => ({
  question, options: [key, 'It makes the animal heavier.', 'It helps the animal sleep.'], correct_index: 0,
  explanation: '', source_quote: quote,
});
const codes = (item) => SF.questionFaults(item, LESSON, { gradeBand: '6-8' }).map((f) => f.code);

test('the chameleon item: an answer whose words the lesson never says is refused', () => {
  expect(codes(q('A chameleon changes its skin colour to match its surroundings. Why is this an effective adaptation?',
    'It helps the chameleon hide from predators and ambush prey.',
    'Chameleons use camouflage: their skin changes colour so predators find them hard to see'))).toContain('SOURCE_QUOTE_NO_REASON');
});

test('the same question answered in the lesson\'s own words passes', () => {
  expect(codes(q('A chameleon changes its skin colour to match its surroundings. Why is this an effective adaptation?',
    'Predators find a chameleon hard to see.',
    'Chameleons use camouflage: their skin changes colour so predators find them hard to see'))).toEqual([]);
});

test('only why/how answers are held to it: a "which" question with the same key is the other checks\' business', () => {
  expect(codes(q('Which of these is true about a chameleon?',
    'It helps the chameleon hide from predators and ambush prey.',
    'Chameleons use camouflage: their skin changes colour so predators find them hard to see'))).not.toContain('SOURCE_QUOTE_NO_REASON');
});

test('an Urdu answer is not word-matched against the lesson (code-switched transcripts paraphrase)', () => {
  expect(codes(q('گرگٹ اپنا رنگ کیوں بدلتا ہے؟', 'تاکہ شکاری اسے دیکھ نہ سکیں',
    'Chameleons use camouflage: their skin changes colour so predators find them hard to see'))).not.toContain('SOURCE_QUOTE_NO_REASON');
});

test('one unsupported word in a short answer is not enough', () => {
  expect(codes(q('Why does a desert fox have large ears?', 'To let body heat escape quickly.',
    'A desert fox has large ears that let body heat escape'))).toEqual([]);
});
