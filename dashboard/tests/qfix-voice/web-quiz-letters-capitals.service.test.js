/**
 * The page rewrites an option letter in a why or feedback line to the child's own option order (wq.js letters(),
 * called by the feedback screen). Bug (Nov 2026): the rule matched case-blind, so a lowercase word after "answer",
 * "option", "choice" or "(" was taken for a letter: "(a lot of water)" showed as "(A lot of water)", or as
 * "(C lot of water)" when the order moved A; "The answer a farmer gives" showed "The answer A farmer gives".
 * 10 of 13,114 questions children sat 8-21 Nov carried such a line (144 of 132,289 question-sittings).
 * A letter is a capital A-D, the same rule the recorded clip uses (web-quiz-publish.service.js spoken()), so the
 * screen and the voice agree on what a letter is.
 */
const WQI = require('../../public/wq/wq.js');

const moved = { options: [{ slot: 'C', text: 'x' }, { slot: 'A', text: 'y' }, { slot: 'B', text: 'z' }] };
const asStored = { options: [{ slot: 'A', text: 'x' }, { slot: 'B', text: 'y' }, { slot: 'C', text: 'z' }] };

describe('letters(): only a capital A-D after answer/option/choice or "(" is an option letter', () => {
  test.each([
    ['a bracket that opens a word', 'Plants need (a lot of water).'],
    ['"answer" before an article', 'The answer a farmer gives is rain.'],
    ['"option" before a lowercase word', 'One option a child has is to wait.'],
    ['"choice" before a lowercase word', 'The choice a teacher makes matters.'],
  ])('%s is left as written, whatever the order on screen', (_, line) => {
    expect(WQI.letters(moved, line)).toBe(line);
    expect(WQI.letters(asStored, line)).toBe(line);
  });

  test('a capital letter is still remapped to the shown order, in every form the page knew', () => {
    expect(WQI.letters(moved, 'The answer is A, not option C. A plant needs (B).')).toBe('The answer is B, not option A. A plant needs (C).');
    expect(WQI.letters(moved, 'Option B is wrong. Choice A is right. Answer C.')).toBe('Option C is wrong. Choice B is right. Answer A.');
    expect(WQI.letters(moved, 'OPTION B and CHOICE A')).toBe('OPTION C and CHOICE B');
    expect(WQI.letters(moved, 'درست جواب A ہے، آپشن C نہیں')).toBe('درست جواب B ہے، آپشن A نہیں');
  });

  test('a lowercase letter alone after "option" is not an option letter (the clip keeps it too)', () => {
    expect(WQI.letters(moved, 'see option b')).toBe('see option b');
  });
});
