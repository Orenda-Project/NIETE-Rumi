/**
 * v29 Grade 1-2 English cross-section giveaways (bd-5jmnfj.4.58.4, round 4): an answer printed in another
 * item's text. G1 Q14 iv printed «sing» (Q6 iii accepts it); Q14 printed the names and the day Q9 and Q15
 * print; G2 Q14 iii «apples» handed Q6 ii and Q16 «mangoes» handed Q8 i.
 */

const { earlyGiveaways } = require('../../bot/shared/services/assessment/fde-early-giveaways');

const G1 = require('./fixtures/fde-v34-g1-english.json');
const G2 = require('./fixtures/fde-v34-g2-english.json');

const slotsFlagged = (flags) => flags.map((f) => f.slot);

describe('G1 English', () => {
  const flags = earlyGiveaways(G1);
  test('Q14 «we sing in the park» is flagged against Q6 «sing» (accept list)', () => {
    const f = flags.find((x) => x.slot === 'g1.english.C.Q14' && x.words.includes('sing'));
    expect(f).toBeDefined();
    expect(f.reason).toBe('giveaway');
    expect(f.with.some((w) => /Q6/.test(w))).toBe(true); // a list, as fde-answer-repeats reads it
  });
  test('flags carry the printed text, one per slot they clash with (the fde-mcq-giveaway shape)', () => {
    flags.forEach((f) => { expect(f.text).toHaveLength(f.with.length); f.text.forEach((t) => expect(typeof t).toBe('string')); });
  });
  test('Q6 itself is never the item flagged for a Q14 word', () => {
    expect(slotsFlagged(flags)).not.toContain('g1.english.B.Q6');
  });
});

describe('G2 English', () => {
  const flags = earlyGiveaways(G2);
  test('mangoes (Q16) hands Q8 and apples (Q14) hands Q6, by plural or singular', () => {
    expect(flags.some((f) => f.slot === 'g2.english.C.Q16' && f.words.some((w) => /mango/.test(w)))).toBe(true);
    expect(flags.some((f) => f.slot === 'g2.english.C.Q14' && f.words.some((w) => /apple/.test(w)))).toBe(true);
  });
});

describe('capital-letter targets', () => {
  const mk = (extra) => ({ unseen: { subjective: { 'Capital Letters': [{ slot: 'g1.english.C.Q14', question: 'dani helps dadi.', answer: 'Dani helps Dadi.', scheme: { points: [], accept: [] } }], 'Complete the Sentences': extra } } });
  test('a name Q14 asks for, printed by another item, is flagged', () => {
    const f = earlyGiveaways(mk([{ slot: 'g1.english.B.Q9', question: 'Dadi ____ a story.', answer: 'tells', scheme: { points: [], accept: [] } }]));
    expect(f.some((x) => x.slot === 'g1.english.C.Q14' && x.words.includes('Dadi'))).toBe(true);
  });
  test('an unrelated paper gives no flags and never throws', () => {
    expect(earlyGiveaways(mk([]))).toEqual([]);
    expect(earlyGiveaways(null)).toEqual([]);
    expect(earlyGiveaways({})).toEqual([]);
  });
});
