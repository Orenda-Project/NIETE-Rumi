'use strict';
// bd-5jmnfj.38.30 round 10: an item that repeats a book worked example or a book statement is Knowledge.
// Fictional book text and items.
const BL = require('../../../bot/shared/services/assessment/board-6-12/book-level');

const BOOK = 'Motion is all around us. A body is said to be at rest if it does not change its position with respect to its surroundings. '
  + 'Example 2.3 A bus covers 150 km in 3 h. Find its average speed. Solution: average speed = 150 km / 3 h = 50 km/h. '
  + 'Speed is a scalar quantity.';
const tag = (b) => ({ blooms: b });
const tree = (...items) => ({ unseen: { objective: { MCQs: items } } });

describe('book-level', () => {
  test('a stem carrying a run of 8 book words is K', () => {
    expect(BL.isBook({ question: 'Which body does not change its position with respect to its surroundings?' }, BOOK)).toBe(true);
  });
  test('an item carrying the numbers of one book worked example is K', () => {
    expect(BL.isBook({ question: 'A bus travels 150 km in 3 h. What is its average speed?' }, BOOK)).toBe(true);
  });
  test('a new situation or new numbers is not', () => {
    expect(BL.isBook({ question: 'A train travels 240 km in 4 h. What is its average speed?' }, BOOK)).toBe(false);
    expect(BL.isBook({ question: 'Why is a parked car at rest while the Earth turns?' }, BOOK)).toBe(false);
  });
  test('relevel sets tag.blooms K on book items (OR branches and groups too), returns the count, leaves others', () => {
    const t = tree(
      { question: 'A bus travels 150 km in 3 h. Its average speed is:', tag: tag('A') },
      { question: 'A train travels 240 km in 4 h. Its average speed is:', tag: tag('A') },
      { slot: 'S', stimulus: { text: 'x', items: [{ question: 'Speed is a scalar quantity because it does not change its position with respect to its surroundings', tag: tag('U') }] } },
    );
    expect(BL.relevel(t, BOOK)).toBe(2);
    const [a, b, g] = t.unseen.objective.MCQs;
    expect([a.tag.blooms, b.tag.blooms, g.stimulus.items[0].tag.blooms]).toEqual(['K', 'A', 'K']);
  });
  test('no book text: nothing changes', () => {
    const t = tree({ question: 'A bus travels 150 km in 3 h.', tag: tag('A') });
    expect(BL.relevel(t, '')).toBe(0);
  });
});

describe('book-level inside the board writer', () => {
  jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({ applyLayout: () => { throw new Error('no'); } }));
  const { writeBoardPaper } = require('../../../bot/shared/services/assessment/board-writer');
  const { leavesOf } = require('../../../bot/shared/services/assessment/board-6-12/tree');
  const { makeDeps } = require('./helpers/fake-deps');
  const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');
  const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 }, board_mode: 'board' };
  test('an item carrying a book worked example\'s numbers is tagged K before the checks', async () => {
    const variant = fictionalVariant();
    const { d } = makeDeps({ grade: 9, row, levels: variant.cognitive_split.levels, style: variant.scheme_style });
    d.loadPatternContent = async () => ({ content: 'MADE-UP BOOK TEXT. Example 9.9 uses 6, 19 and 44 lamps.', pageReference: 'pp 1-9' });
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P: fictionalEntry(), variant, requestId: 'r1' }, d).catch((e) => e.examJson ? { examJson: e.examJson } : Promise.reject(e));
    const hit = leavesOf(res.examJson).filter((l) => /case 6, step 19, part 44\b/.test(l.question));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((l) => l.tag.blooms === 'K')).toBe(true);
  });
});
