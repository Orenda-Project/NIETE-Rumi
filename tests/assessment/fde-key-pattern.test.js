/**
 * bd-5jmnfj.4.50.7: MCQ keys a child can read without the questions (v22 sandbox papers).
 *   G5 Maths Q1 (a): every fourth key is (d), and xiii–xx run a b c d a b c d.
 *   G5 Science Q1 (a): the keys repeat b d a c.
 * Both strips were balanced (5 of 20 per letter), so the count spread left them as they were and
 * only Social Studies was dealt again. Every subject's strip is now dealt until it has no pattern,
 * the same way for the same paper, each item keying the same option text.
 */
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { keyPattern, letterOption } = require('../../bot/shared/services/assessment/fde-key-pattern');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const ALL = Patterns.get('fde_g5_2027').subjects;
const LETTERS = 'abcd';
// The v22 key strips, as printed.
const MATHS_V22 = 'bcadbacdbacdabcdabcd';
const SCIENCE_V22 = 'bdacbdacbdacdbacbdac';

// Twenty MCQs keyed along `strip`, worded options (none in number order, so every item can turn).
function exam(subject, strip) {
  const slot = ALL[subject].sections.flatMap((s) => s.slots).find((s) => s.shape === 'mcq');
  const list = [...strip].map((l, n) => {
    const options = ['river', 'mountain', 'desert', 'forest'].map((w, i) => `${LETTERS[i]}) ${w} ${n + 1}`);
    return { slot: slot.slot, marks: 1, question: `Item ${n + 1}: which one is right?`, options, answer: options[LETTERS.indexOf(l)] };
  });
  return { slot, json: { unseen: { [slot.category]: { [slot.type]: list } } } };
}
function lay(subject, strip) {
  const { slot, json } = exam(subject, strip);
  const out = applyLayout(json, ALL[subject], { kind: 'fde', chapters: null, pages: null }, { reasked: true }).examJson;
  return out.unseen[slot.category][slot.type];
}
const keyOf = (q) => String(q.answer).trim()[0];
const keyText = (q) => q.options[LETTERS.indexOf(keyOf(q))].replace(/^[a-d]\)\s*/, '');

// Read by the test itself, not by the module: p different letters repeating over 2p keys (6 at least), every
// p-th key on one letter, or a strip repeating at p on half its keys, for p = 2..5.
function patterned(seq) {
  for (let p = 2; p <= 5; p += 1) {
    const span = Math.max(2 * p, 6);
    for (let s = 0; s + span <= seq.length; s += 1) {
      const head = seq.slice(s, s + p);
      if (new Set(head).size === p && head.repeat(span).slice(0, span) === seq.slice(s, s + span)) return `cycle ${head} at ${s}`;
    }
    for (let r = 0; r < p; r += 1) {
      const at = [...seq].filter((_, i) => i % p === r);
      if (at.length >= 4 && at.every((x) => x === at[0])) return `every ${p}th from ${r} is ${at[0]}`;
    }
    const same = [...seq].filter((x, i) => i >= p && x === seq[i - p]).length;
    if (same * 2 >= seq.length - p) return `period ${p} on ${same} keys`;
  }
  return null;
}

describe('the v22 strips are patterned', () => {
  test.each([['maths', MATHS_V22], ['science', SCIENCE_V22]])('%s', (_, strip) => {
    expect(patterned(strip)).not.toBeNull();
    expect(keyPattern([...strip].map((l) => LETTERS.indexOf(l)))).toBeGreaterThan(0);
  });
});

describe.each([
  ['maths', MATHS_V22],
  ['science', SCIENCE_V22],
  ['english', 'abcd'.repeat(5)],
])('%s Q1: twenty keys laid out', (subject, strip) => {
  const got = lay(subject, strip);
  const keys = got.map(keyOf).join('');

  test('no cycle, fixed place or fixed period of 2 to 5', () => {
    expect(got).toHaveLength(20);
    expect(patterned(keys)).toBeNull();
  });

  test('letters stay balanced: each holds 3 to 6 of 20', () => {
    for (const l of LETTERS) {
      const n = [...keys].filter((x) => x === l).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  test('every item keys the same option text, its options intact', () => {
    const { json, slot } = exam(subject, strip);
    const before = json.unseen[slot.category][slot.type];
    got.forEach((q, i) => {
      expect(q.question).toBe(before[i].question);
      expect(keyText(q)).toBe(keyText(before[i]));
      expect(q.options.map((o) => o.replace(/^[a-d]\)\s*/, '')).sort()).toEqual(before[i].options.map((o) => o.replace(/^[a-d]\)\s*/, '')).sort());
    });
  });

  test('the same paper deals the same keys', () => {
    expect(lay(subject, strip).map(keyOf).join('')).toBe(keys);
  });
});

describe('keyPattern', () => {
  const idx = (s) => [...s].map((l) => (l === '?' ? -1 : LETTERS.indexOf(l)));
  test('a strip with no tell is clean, and unread keys never make one', () => {
    expect(keyPattern(idx('acbdbcadbdacdbcaadbc'))).toBe(0);
    expect(keyPattern(idx('????????????'))).toBe(0);
  });
  test('each tell is found', () => {
    expect(keyPattern(idx('cadbabcabcdb'))).toBe(3); // a b c a b c
    expect(keyPattern(idx('abcacdbadcbd'))).toBe(0);
    expect(keyPattern(idx('acbdcabdbadd'))).toBe(4); // every fourth (d)
    expect(keyPattern(idx('aabbaabbaabb'))).toBe(4); // period 4 throughout
  });
});

describe('letterOption', () => {
  test('options that are letters themselves («a / an / the») are found; words that start with one are not', () => {
    expect(letterOption(['a', 'an', 'the two', 'some of'])).toBe(true);
    expect(letterOption(['B.', 'cat'])).toBe(true);
    expect(letterOption(['ب', 'گھر'])).toBe(true);
    expect(letterOption(['a cat', 'an owl', 'bat', 'dog'])).toBe(false);
  });
});
