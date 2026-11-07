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

async function run(review, on = true, byN) {
  const reviews = [];
  const { d, calls } = makeDeps({ grade: 9, row, levels: variant.cognitive_split.levels, style: variant.scheme_style, reply: (section) => {
    if (!String(section.id).startsWith('review-')) return undefined;
    reviews.push(section);
    return byN ? byN(reviews.length, section.slots[0].generate) : review(reviews.length);
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
  test('round 9b: each review pass is logged with fault counts, and the rewrite is told the faults', async () => {
    const { logs, calls } = await run((k) => (k === 1 ? { items: [{ n: 2, key_given_away: true, why: 'paraphrase of the key' }] } : clean()));
    const seen = logs.filter(([m]) => m === '[assessment] board MCQ review').map(([, o]) => o);
    expect(seen).toEqual([{ pass: 1, reviewed: 4, flagged: 1, by_fault: { key_given_away: 1 } }, { pass: 2, reviewed: 1, flagged: 0, by_fault: {} }]);
    const re = calls.find((c) => /REWRITE/.test(c.user));
    expect(re.user).toMatch(/key given away \(paraphrase of the key\)/);
  });
  test('round 9b: a reviewer that flags every item still leaves a paper; the leftovers are soft notes', async () => {
    const all = (k, n) => ({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, implausible_distractor: true, why: 'weak' })) });
    const { res, logs } = await run(() => undefined, true, all);
    const out = logs.find(([m]) => m === '[assessment] board rewrite outcome')[1];
    expect(out.kept).toBe('rewrite 1');
    expect(res.examJson._meta.checks.record.per_check.review).toEqual({ issues: 4, hard: 0 });
    expect(res.examJson._meta.checks.notes.filter((n) => n.check === 'review')).toHaveLength(4);
    const passes = logs.filter(([m]) => m === '[assessment] board MCQ review').map(([, o]) => o.reviewed);
    expect(passes).toEqual([4, 4]);
  });
  test('round 9b: a review-flagged MCQ whose replacement fails a hard check gets its original back', async () => {
    const bad = { 'A.Q1': [{ main_question: 'Choose the correct option', question: 'A made-up rewrite stem about a lamp?', options: ['A) lamp', 'B) lamp', 'C) lamp', 'D) lamp'], marks: 1, lines: 0, answer: 'A) lamp', tag: { chapter: 1, section: null, code: 'g9.physics.ch1.lo1', page: 11, official_slo: null, blooms: 'K', difficulty: 'easy' } }] };
    let k = 0;
    const { d, calls } = makeDeps({ grade: 9, row, levels: variant.cognitive_split.levels, style: variant.scheme_style, reply: (section) => {
      if (String(section.id).startsWith('review-')) { k += 1; return k === 1 ? { items: [{ n: 2, implausible_distractor: true, why: 'weak' }] } : { items: [] }; }
      return undefined;
    } });
    const logs = [];
    d.logToFile = (m, o) => logs.push([m, o]);
    d.reviewMcqs = true;
    const real = d.writeSection;
    d.writeSection = async (args) => {
      const got = await real(args);
      return /REWRITE/.test(args.messages[1].content) ? { ...got, tree: bad } : got;
    };
    const res = await writeBoardPaper({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', P: fictionalEntry(), variant, requestId: 'r1' }, d);
    const out = logs.find(([m]) => m === '[assessment] board rewrite outcome')[1];
    expect(out.kept).toBe('restore');
    const stems = leavesOf(res.examJson).filter((l) => l.slot === 'A.Q1').map((l) => l.question);
    expect(stems).toHaveLength(4);
    expect(stems).not.toContain('A made-up rewrite stem about a lamp?');
    expect(calls.some((c) => /REWRITE/.test(c.user))).toBe(true);
    expect(res.examJson._meta.checks.notes.filter((x) => x.check === 'review')).toHaveLength(1);
  });
  test('bd-5jmnfj.38.33: a key_given_away flag that persists with no replacement left ships the paper with a paper-level note, not PATTERN_SHORT_SLOT', async () => {
    const every = (k, n) => ({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, key_given_away: true, why: 'stem says the key' })) });
    const { res } = await run(() => undefined, true, every);
    const rec = res.examJson._meta.checks;
    expect(rec.record.hard).toBe(0);
    const notes = rec.notes.filter((n) => n.check === 'review' && n.faults.includes('key_given_away'));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.paper_level === true)).toBe(true);
    expect(leavesOf(res.examJson).filter((l) => l.slot === 'A.Q1')).toHaveLength(4);
  });
});
