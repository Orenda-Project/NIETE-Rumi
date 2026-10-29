/**
 * bd-5jmnfj.4.51.6 (oral part) — v23 G1 Maths oral item 4 printed a leftover
 * writer note: "... How many cats are left on the wall? (Note: the book says 9 cats in
 * all, so use 9 cats on the wall.)". Stripping would leave a story whose numbers
 * disagree with its answer (8 - 3 != 6), so a task whose script, ask or answer carries
 * a bracketed writer note is returned as missing and re-asked (oralContent -> reaskOral).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const oral = () => Patterns.get('fde_g1_2026').subjects.maths.oral;
const items = (...asks) => asks.map((ask, i) => ({ ask, answer: String(i + 1) }));
const reply = (its, script) => ({ oral: [{ id: 'oral_maths', ...(script ? { script } : {}), items: its }] });

const OK = items(
  'Bunty saw 5 flowers. Count on from 5. What are the next three numbers?',
  'Bunty is on stair number 6. What is one more than 6? What is one less than 6?',
  'Bunty had 4 cookies. Babloo gave her 3 more. How many cookies does Bunty have now?',
  'Nine cats sat on a wall. Then 3 cats jumped down. How many cats are left on the wall?',
  'Which number is bigger, 5 or 7?',
);
const V23_NOTE = 'Mano and 8 cats sat on a wall. Then 3 cats jumped down. How many cats are left on the wall? (Note: the book says 9 cats in all, so use 9 cats on the wall.)';

test('a clean oral reply is whole', () => {
  const r = Prompt.oralContent(reply(OK), oral());
  expect(r.missing).toEqual([]);
  expect(r.content[0].items).toHaveLength(5);
});

test('the v23 bracketed note makes the task missing, so it is re-asked', () => {
  const bad = OK.slice();
  bad[3] = { ask: V23_NOTE, answer: '6' };
  const r = Prompt.oralContent(reply(bad), oral());
  expect(r.missing).toEqual(['oral_maths']);
  expect(JSON.stringify(r.content)).not.toMatch(/Note:/);
});

test.each([
  ['(Note: use 9)'], ['(NB: check the book)'], ['[Note: x]'], ['(note to teacher: change this)'], ['(writer: fix)'], ['(نوٹ: کتاب میں 9 ہیں)'],
])('%s in an ask is a writer note', (note) => {
  const bad = OK.slice();
  bad[0] = { ask: `${OK[0].ask} ${note}`, answer: '6, 7, 8' };
  expect(Prompt.oralContent(reply(bad), oral()).missing).toEqual(['oral_maths']);
});

test('a note in the answer or the script counts too', () => {
  const badAnswer = OK.slice();
  badAnswer[1] = { ask: OK[1].ask, answer: 'One more is 7 (Note: or 5)' };
  expect(Prompt.oralContent(reply(badAnswer), oral()).missing).toEqual(['oral_maths']);
});

test('an ordinary bracket a child hears is not a note', () => {
  const fine = OK.slice();
  fine[4] = { ask: 'Which number is bigger, 5 (five) or 7 (seven)?', answer: '7' };
  expect(Prompt.oralContent(reply(fine), oral()).missing).toEqual([]);
});

test('the oral prompt tells the writer not to leave notes', () => {
  const text = Prompt.oralPrompt({ oral: oral(), grade: 1, P: Patterns.get('fde_g1_2026').subjects.maths, pageContent: 'BOOK' });
  expect(text).toMatch(/no (bracketed )?notes|never .*note/i);
});
