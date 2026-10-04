/**
 * v3 integration seam (bd-s1oo0.50): the review (L39) reading what scoring (L37) actually writes.
 * L37 numbers items 1-based (items[].i = k + 1) and names story questions in review[] as "q:<id>".
 * L39 had assumed 0-based positions and bare ids, so the coach would have been shown the NEXT item
 * ("which is bigger: 11 or 24" for the 7/5 pair, numbered 2) and story questions never reached review.
 * The input here is built by L37's own row builders against the committed bank: no hand-made marks.
 */
const C = require('../../../bot/shared/services/child-test/scoring/tasks/common');
const V3 = require('../../../bot/shared/services/child-test/check-flow/review-v3');
const IB = require('../../../bot/shared/services/child-test/item-bank');

const specOf = (task) => IB.getTaskSpec({ grade: 3, set: 'A', task });
const entryWith = (task, aiMarks) => ({ session: { id: 's1', child_name: 'Test Child' }, blocks: { [task]: { block: task, ai_marks: aiMarks } } });

describe('v3 review reads L37 ai-marks as written', () => {
  it('an unsettled first pair is shown as the first pair, numbered 1', () => {
    const spec = specOf('ma.discrimination');
    const refs = spec.items.map((x) => `${x.a} ${x.b}`);
    const items = C.untimedRows(spec.items.map((_, k) => (k === 0 ? { v: 'n' } : { v: 'c' })), refs);
    const review = C.reviewItems('discrimination', 'ai_review', items);
    expect(review).toEqual([1]);
    const cands = V3.candidates(entryWith('ma.discrimination', { version: 'ai-marks-v3', task: 'ma.discrimination', quality: 'ai_review', items, review }), () => spec);
    expect(cands).toHaveLength(1);
    expect(cands[0].number).toBe(1);
    const text = V3.itemText('en', cands[0]);
    expect(text).toContain(String(spec.items[0].a));
    expect(text).toContain(String(spec.items[0].b));
    expect(text).not.toContain(String(spec.items[1].b));
  });

  it('the last item of a task is shown as itself', () => {
    const spec = specOf('ma.add2');
    const n = spec.items.length;
    const items = C.untimedRows(spec.items.map((_, k) => (k === n - 1 ? { v: 'n' } : { v: 'c' })), spec.items.map((x) => `${x.a}+${x.b}`));
    const review = C.reviewItems('add2', 'ai_review', items);
    const cands = V3.candidates(entryWith('ma.add2', { version: 'ai-marks-v3', task: 'ma.add2', quality: 'ai_review', items, review }), () => spec);
    expect(cands.map((c) => c.number)).toEqual([n]);
    expect(V3.itemText('en', cands[0])).toContain(`${spec.items[n - 1].a}`);
  });

  it('a story question L37 sends to review as "q:<id>" reaches the review', () => {
    const spec = specOf('ur.story');
    const q = spec.questions[1];
    const comprehension = spec.questions.map((x) => ({ id: x.id, verdict: x.id === q.id ? 'none' : 'correct', heard: '', confidence: 0.95, reached: true, asked: true }));
    const cands = V3.candidates(entryWith('ur.story', { version: 'ai-marks-v3', task: 'ur.story', quality: 'ai_review', items: [], comprehension, review: [`q:${q.id}`] }), () => spec);
    expect(cands).toHaveLength(1);
    expect(cands[0].field).toBe('comprehension');
    expect(cands[0].number).toBe(2);
    expect(V3.itemText('ur', cands[0])).toContain(q.prompt.slice(0, 8));
  });
});
