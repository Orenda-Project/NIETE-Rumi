'use strict';
// bd-5jmnfj.38.30 r9 step 4: one review call per section, MCQs only; any yes sends the item to the targeted rewrite.
// Fictional paper and replies.
const MR = require('../../../bot/shared/services/assessment/board-6-12/mcq-review');
const { mcq, srq, row, paper } = require('../board-checks/paper-builder');

const two = () => {
  const ex = paper({
    sections: [
      { id: 'A', marks: 3, slots: [row('A.Q1', { attempt: 3, printed: 3, generate: 3 })] },
      { id: 'B', marks: 4, slots: [row('B.Q2', { type: 'srq', attempt: 2, printed: 2, generate: 2, marks_each: 2 })] },
    ],
    items: [mcq('A.Q1#1', 'A.Q1', 'B) 2'), mcq('A.Q1#2', 'A.Q1', 'A) 1'), mcq('A.Q1#3', 'A.Q1', 'C) 3'), srq('B.Q2#1', 'B.Q2', 2), srq('B.Q2#2', 'B.Q2', 2)],
  });
  return ex;
};

describe('sectionsOf', () => {
  test('MCQs only, by section, numbered from 1, with key, level and options; `only` narrows to the fresh ids', () => {
    const s = MR.sectionsOf(two());
    expect(s.map((x) => [x.id, x.items.length])).toEqual([['A', 3]]);
    expect(s[0].items[0]).toMatchObject({ n: 1, id: 'A.Q1#1', slot: 'A.Q1', answer: 'B) 2', level: 'U' });
    expect(MR.sectionsOf(two(), new Set(['A.Q1#2']))[0].items.map((i) => i.id)).toEqual(['A.Q1#2']);
    expect(MR.sectionsOf(two(), new Set(['B.Q2#1']))).toEqual([]);
  });
});

describe('reviewPrompt', () => {
  test('asks the five questions, gives the paraphrase example and the worked-example rule, JSON only', () => {
    const p = MR.reviewPrompt(MR.sectionsOf(two())[0], 9);
    expect(p.system).toMatch(/exactly one option/i);
    expect(p.system).toMatch(/paraphrase/i);
    expect(p.system).toMatch(/always.*never.*only/);
    expect(p.system).toMatch(/implausible/i);
    expect(p.system).toMatch(/worked example.*Knowledge/i);
    expect(p.user).toMatch(/1\. Question A\.Q1#1\?/);
    expect(p.user).toMatch(/key: B\) 2/);
    expect(p.user).toMatch(/level: U/);
  });
});

describe('flagsFrom', () => {
  const sec = () => MR.sectionsOf(two())[0];
  test('any yes flags the item with every fault named; all no or an unknown n flags nothing', () => {
    const reply = { items: [
      { n: 2, two_defensible: false, key_given_away: true, key_stands_out: false, implausible_distractor: true, level_wrong: false, why: 'stem says inner shell' },
      { n: 1, two_defensible: false, key_given_away: false, key_stands_out: false, implausible_distractor: false, level_wrong: false },
      { n: 9, two_defensible: true },
    ] };
    const f = MR.flagsFrom(reply, sec());
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: 'A.Q1#2', slot: 'A.Q1' });
    expect(f[0].faults).toEqual(['key_given_away', 'implausible_distractor']);
    expect(f[0].why).toBe('stem says inner shell');
  });
  test('a reply that is not the asked shape flags nothing', () => {
    expect(MR.flagsFrom(null, sec())).toEqual([]);
    expect(MR.flagsFrom({ items: 'x' }, sec())).toEqual([]);
  });
});

describe('applyFlags', () => {
  test('flags match items by their text (ids are positional and a replacement takes the old id): a match becomes hard', () => {
    const ex = two();
    const secs = MR.sectionsOf(ex)[0];
    const f2 = MR.flagsFrom({ items: [{ n: 2, two_defensible: true }, { n: 3, level_wrong: true }] }, secs);
    const checks = { shortfall: [{ slot: 'A.Q1', reason: 'D17', items: ['A.Q1#3'], item_refs: ['A.Q1#3'], hard: true, why: { 'A.Q1#3': 'D17' } }], notes: [], record: { hard: 1, per_check: {} } };
    MR.applyFlags(checks, f2.concat([{ id: 'gone', slot: 'C.Q9', sig: 'x', faults: ['x'] }]), ex);
    expect(checks.shortfall[0].items).toEqual(['A.Q1#3', 'A.Q1#2']);
    expect(checks.shortfall[0].why['A.Q1#2']).toBe('review');
    expect(checks.shortfall[0].why['A.Q1#3']).toBe('D17');
    expect(checks.record.per_check.review).toEqual({ issues: 2, hard: 2 });
    expect(checks.record.hard).toBe(3);
  });
  test('a replacement that took a flagged id is not flagged', () => {
    const ex = two();
    const f = MR.flagsFrom({ items: [{ n: 2, two_defensible: true }] }, MR.sectionsOf(ex)[0]);
    ex.unseen.objective.mcq[1].question = 'A new made-up stem?';
    const checks = { shortfall: [], notes: [], record: { hard: 0, per_check: {} } };
    MR.applyFlags(checks, f, ex);
    expect(checks.shortfall).toEqual([]);
    expect(checks.record.hard).toBe(0);
  });
});

describe('reviewPaper', () => {
  test('one call per section with MCQs; a call that throws costs nothing and flags nothing', async () => {
    const seen = [];
    const call = async ({ id, n }) => { seen.push([id, n]); return { items: [{ n: 3, two_defensible: true }] }; };
    const f = await MR.reviewPaper({ examJson: two(), grade: 9, call });
    expect(seen).toEqual([['review-A', 3]]);
    expect(f.map((x) => x.id)).toEqual(['A.Q1#3']);
    const errs = [];
    const none = await MR.reviewPaper({ examJson: two(), grade: 9, call: async () => { throw new Error('down'); }, onError: (e) => errs.push(e.message) });
    expect(none).toEqual([]);
    expect(errs).toEqual(['down']);
  });
});
