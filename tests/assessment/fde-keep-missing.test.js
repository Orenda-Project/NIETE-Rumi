'use strict';
const { keepMissing } = require('../../bot/shared/services/assessment/fde-keep-missing');

// v37 loop 4 G2 English: Section C re-asked whole for a Q11 pronoun key came back without its Q16 story order,
// and the paper failed PATTERN_SHORT_SLOT though the first reply had a good Q16 (bd-5jmnfj.4.58.9.1).
const item = (slot, n) => ({ slot, question: `${slot} item ${n}`, answer: 'x' });
const tree = (lists) => ({ unseen: { subjective: lists } });

describe('keepMissing', () => {
  test('a slot the re-asked reply left out keeps the first reply\'s items', () => {
    const kept = tree({ Pronouns: [item('C.Q11', 1)], 'Story Order': [item('C.Q16', 1)] });
    const fresh = tree({ Pronouns: [item('C.Q11', 2)] });
    const out = keepMissing(fresh, kept, ['C.Q11', 'C.Q16']);
    expect(out.unseen.subjective.Pronouns).toEqual([item('C.Q11', 2)]);
    expect(out.unseen.subjective['Story Order']).toEqual([item('C.Q16', 1)]);
  });
  test('a slot the reply wrote short takes the first reply\'s full set instead', () => {
    const kept = tree({ Questions: [item('C.Q13', 1), item('C.Q13', 2), item('C.Q13', 3)] });
    const fresh = tree({ Questions: [item('C.Q13', 9)] });
    expect(keepMissing(fresh, kept, ['C.Q13']).unseen.subjective.Questions).toEqual(kept.unseen.subjective.Questions);
  });
  test('a slot the reply wrote in full keeps the reply, and a slot outside the list is never touched', () => {
    const kept = tree({ Pronouns: [item('C.Q11', 1)], Other: [item('C.Q12', 1)] });
    const fresh = tree({ Pronouns: [item('C.Q11', 2)] });
    const out = keepMissing(fresh, kept, ['C.Q11']);
    expect(out).toEqual(fresh);
    expect(out).not.toBe(fresh);
  });
  test('never throws on junk, and returns the reply as it came', () => {
    expect(keepMissing(null, null, null)).toBe(null);
    const fresh = tree({});
    expect(keepMissing(fresh, { seen: 3 }, ['a'])).toEqual(fresh);
  });
});
