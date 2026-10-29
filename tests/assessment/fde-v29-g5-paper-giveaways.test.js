/** The v29 whole-paper give-away checks, as one list (bd-5jmnfj.4.58.4). */
const { paperGiveaways } = require('../../bot/shared/services/assessment/fde-g5-paper-giveaways');

test.each([['science'], ['maths']])('%s paper: the list holds every check\'s flags', (s) => {
  const p = require(`./fixtures/fde-v29-g5-${s}.json`);
  const slots = paperGiveaways(p).map((f) => f.slot);
  expect(slots.length).toBeGreaterThan(0);
  if (s === 'maths') expect(slots).toEqual(['maths.A.Q1a']);
  else expect(slots).toEqual(expect.arrayContaining(['science.A.Q1a', 'science.C.Q3b']));
});

test('no paper', () => { expect(paperGiveaways(null)).toEqual([]); });
