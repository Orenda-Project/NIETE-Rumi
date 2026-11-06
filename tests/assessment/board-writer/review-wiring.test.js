'use strict';
/** bd-5jmnfj.38.30 r9 step 4: the per-section MCQ review inside writeBoardPaper. Fictional cell, fake model. */
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const { leavesOf } = require(`${A}board-6-12/tree`);
const { makeDeps } = require('./helpers/fake-deps');
const { fictionalVariant, fictionalEntry } = require('./helpers/fictional-cell');

const row = { code: 'physics', grade: 9, band: '9_10', medium: 'en', rtl: false, prompt_key: 'eg.ict.physics.9_10.system', tos_default: { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 }, board_mode: 'board' };
const variant = fictionalVariant();

async function run(review, on = true) {
  const reviews = [];
  const { d, calls } = makeDeps({ grade: 9, row, levels: variant.cognitive_split.levels, style: variant.scheme_style, reply: (section) => {
    if (!String(section.id).startsWith('review-')) return undefined;
    reviews.push(section);
    return review(reviews.length);
  } });
  const logs = [];
  d.logToFile = (m, o) => logs.push([m, o]);
  if (on) d.reviewMcqs = true;
  const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P: fictionalEntry(), variant, requestId: 'r1' }, d);
  return { res, calls, reviews, logs };
}
const clean = () => ({ items: [] });

describe('per-section MCQ review in the board writer', () => {
  test('off (no d.reviewMcqs): no review call', async () => {
    const { reviews } = await run(clean, false);
    expect(reviews).toEqual([]);
  });
  test('clean review: one call for the MCQ section only, the paper is kept, no rewrite', async () => {
    const { reviews, calls, res } = await run(clean);
    expect(reviews.map((s) => [s.id, s.slots[0].generate])).toEqual([['review-A', 4]]);
    expect(calls.filter((c) => /REWRITE|rewrite/i.test(c.user)).length).toBe(0);
    expect(leavesOf(res.examJson).filter((l) => l.slot === 'A.Q1')).toHaveLength(4);
  });
  test('a flagged MCQ is dropped and rewritten; the rewrite alone is reviewed again; by_check names review', async () => {
    let first;
    const { reviews, res, logs, calls } = await run((k) => (k === 1 ? { items: [{ n: 2, key_given_away: true, why: 'paraphrase of the key' }] } : clean()));
    expect(reviews.map((s) => [s.id, s.slots[0].generate])).toEqual([['review-A', 4], ['review-A', 1]]);
    const out = logs.find(([m]) => m === '[assessment] board rewrite outcome')[1];
    expect(out.tries[0]).toMatchObject({ name: 'rewrite 1', hard: 0 });
    expect(out.kept).toBe('rewrite 1');
    const before = calls.find((c) => c.section === 'review-A');
    first = /2\. (.*)\n/.exec(before.user)[1];
    expect(leavesOf(res.examJson).map((l) => l.question)).not.toContain(first);
    expect(leavesOf(res.examJson).filter((l) => l.slot === 'A.Q1')).toHaveLength(4);
  });
});
