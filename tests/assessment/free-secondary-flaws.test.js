/**
 * bd-5jmnfj.38.35 — G6-8 free papers leaked answers (panel 2026-11-06, G8 Urdu ch4 and G7 General Science ch1):
 * the key is systematically the longest option (A7a), a stem points at a word list the paper never prints
 * (A5a), and marking bands that overlap (A7c). Each is a code check that sends the item back for a rewrite.
 */
const F = require('../../bot/shared/services/assessment/free-secondary-flaws');
const C = require('../../bot/shared/services/assessment/free-secondary-checks');
const R = require('../../bot/shared/services/assessment/free-secondary-rewrite');

const mcq = (key, others, extra = {}) => ({ question: 'Which one?', options: [`a) ${key}`, ...others.map((o, i) => `${'bcd'[i]}) ${o}`)], answer: `a) ${key}`, marks: 1, ...extra });
const entry = (item, n = 1) => ({ n, item, isMcq: Array.isArray(item.options) });
const SCHEME = { accept: 'x', reject: 'y' };
const written = (extra) => ({ question: 'Why?', answer: 'Because.', marks: 2, marking_points: [{ point: 'p', marks: 2 }], ...SCHEME, ...extra });
const BANDS = [{ marks: '2', descriptor: 'full' }, { marks: '1', descriptor: 'partial' }, { marks: '0', descriptor: 'none' }];

describe('keySkew: the key is the longest option in many MCQs of a paper', () => {
  const LONG = (i) => mcq(`the longer key number ${i}`, ['short one', 'short two', 'short three']);
  const FAIR = mcq('mid', ['a much longer distractor', 'tiny', 'another long distractor']);
  it('flags every MCQ whose key is the longest once 3+ MCQs and over 40% have it', () => {
    const all = [LONG(1), FAIR, LONG(2), FAIR, LONG(3)].map((it, i) => entry(it, i + 1));
    const out = F.keySkewIssues(all);
    expect(out.map((o) => o.n)).toEqual([1, 3, 5]);
    expect(out[0]).toMatchObject({ check: 'longest-key' });
    expect(out[0].text).toMatch(/3 of 5/);
  });
  it('counts a tie for longest', () => {
    const tie = mcq('abcd', ['abcd', 'ab', 'abc']);
    expect(F.keySkewIssues([tie, tie, tie].map((it, i) => entry(it, i + 1)))).toHaveLength(3);
  });
  it('leaves a paper alone when only one or two keys are longest, or the share is low', () => {
    expect(F.keySkewIssues([LONG(1), LONG(2), FAIR, FAIR, FAIR].map((it, i) => entry(it, i + 1)))).toEqual([]);
    const six = [LONG(1), LONG(2), LONG(3), FAIR, FAIR, FAIR, FAIR, FAIR].map((it, i) => entry(it, i + 1));
    expect(F.keySkewIssues(six)).toEqual([]);
  });
  it('ignores written items and numeric options', () => {
    const num = mcq('1000', ['1', '22', '3']);
    expect(F.keySkewIssues([num, num, num, entry(written({}), 4)].map((e, i) => (e.item ? e : entry(e, i + 1))))).toEqual([]);
  });
  it('is wired into paperIssues', () => {
    const near = mcq('abcdefgh', ['abcdefg', 'abcdef', 'abcde']);
    const exam = { unseen: { objective: { M: [near, near, near, FAIR] }, subjective: {} } };
    expect(C.paperIssues(exam, { grade: 8 }).filter((i) => i.check === 'longest-key').map((i) => i.n)).toEqual([1, 2, 3]);
  });
});

describe('unprintedReference: the stem points at a list, table or figure the paper does not print', () => {
  const ref = (q, extra = {}) => F.unprintedReferenceIssue(entry(written({ question: q, ...extra })));
  it('flags the G8 Urdu Q15 wording (a word from the lesson list)', () => {
    expect(ref('صفتِ ذاتی کی تعریف لکھیں۔ سبق کی فہرست میں سے ایک لفظ لکھیں۔')).toMatch(/not printed/);
  });
  it('flags English references to a list, table, diagram or word box that is not on the paper', () => {
    expect(ref('Write one word from the list in the lesson.')).toMatch(/not printed/);
    expect(ref('Using the table above, name the heaviest planet.')).toMatch(/not printed/);
    expect(ref('Label the diagram shown below.')).toMatch(/not printed/);
    expect(ref('Choose a word from the word box.')).toMatch(/not printed/);
  });
  it('passes when the words are printed in the stem or in a list field', () => {
    expect(ref('Pick a word from the list: happy, sad, angry, tired.')).toBeNull();
    expect(ref('Pick a word from the list.', { words: ['happy', 'sad'] })).toBeNull();
    expect(ref('سبق کی فہرست میں سے چنیں: سخی، کنجوس، بہادر، نیک')).toBeNull();
  });
  it('passes ordinary stems, including a periodic table or a made-up diagram', () => {
    expect(ref('Why does ice float?')).toBeNull();
    expect(ref('Draw a diagram of a leaf and label two parts.')).toBeNull();
    expect(ref('Name one element in the periodic table that is a gas.')).toBeNull();
  });
  it('is wired into paperIssues as unprinted-ref', () => {
    const exam = { unseen: { objective: {}, subjective: { S: [written({ question: 'Write a word from the list in the lesson.' })] } } };
    expect(C.paperIssues(exam, { grade: 8 })).toEqual(expect.arrayContaining([expect.objectContaining({ n: 1, check: 'unprinted-ref' })]));
  });
});

describe('bandIssue: marking bands must not overlap', () => {
  const issue = (bands, marks = 3) => F.bandIssue(entry(written({ marks, mark_bands: bands })));
  it('passes full / partial / none that tile 0..marks', () => {
    expect(issue(BANDS, 2)).toBeNull();
    expect(issue([{ marks: '3', descriptor: 'a' }, { marks: '1-2', descriptor: 'b' }, { marks: '0', descriptor: 'c' }])).toBeNull();
  });
  it('flags bands whose marks overlap, repeat, or do not reach the item marks', () => {
    expect(issue([{ marks: '2-3', descriptor: 'a' }, { marks: '1-2', descriptor: 'b' }, { marks: '0', descriptor: 'c' }])).toMatch(/overlap/);
    expect(issue([{ marks: '3', descriptor: 'a' }, { marks: '3', descriptor: 'b' }, { marks: '0', descriptor: 'c' }])).toMatch(/overlap/);
    expect(issue([{ marks: '2', descriptor: 'a' }, { marks: '0', descriptor: 'c' }])).toMatch(/3 marks/);
  });
  it('flags two bands with the same descriptor, and leaves MCQs and one-mark items alone', () => {
    expect(issue([{ marks: '3', descriptor: 'Full.' }, { marks: '1-2', descriptor: 'full' }, { marks: '0', descriptor: 'c' }])).toMatch(/same/);
    expect(F.bandIssue(entry(mcq('k', ['a', 'b', 'c'])))).toBeNull();
    expect(F.bandIssue(entry(written({ marks: 1, mark_bands: [] })))).toBeNull();
  });
  it('flags two bands that both penalise the same missing element (G7 Science a8b Q17: clean 2 / 1 / 0 marks)', () => {
    const q17 = [{ marks: '2', descriptor: 'full: correct prediction with correct reasoning' },
      { marks: '1', descriptor: 'partial: correct prediction but weak/missing reasoning' },
      { marks: '0', descriptor: 'none: incorrect prediction or no reasoning' }];
    expect(issue(q17, 2)).toMatch(/both|same condition|overlap/);
    expect(issue([{ marks: '2', descriptor: 'دونوں نکات درست' }, { marks: '1', descriptor: 'جواب درست مگر دلیل کمزور' },
      { marks: '0', descriptor: 'غلط جواب یا کوئی دلیل نہیں' }], 2)).toMatch(/both|same condition|overlap/);
  });
  it('leaves bands that separate by different conditions alone', () => {
    expect(issue([{ marks: '2', descriptor: 'full: prediction and reasoning' }, { marks: '1', descriptor: 'partial: prediction only, no reasoning' },
      { marks: '0', descriptor: 'none: no prediction' }], 2)).toBeNull();
  });
  it('is wired into paperIssues as band-overlap', () => {
    const bad = written({ mark_bands: [{ marks: '2', descriptor: 'a' }, { marks: '1-2', descriptor: 'b' }, { marks: '0', descriptor: 'c' }] });
    const exam = { unseen: { objective: {}, subjective: { S: [bad] } } };
    expect(C.paperIssues(exam, { grade: 8 })).toEqual(expect.arrayContaining([expect.objectContaining({ n: 1, check: 'band-overlap' })]));
  });
});

describe('the targeted rewrite takes the new checks', () => {
  it('targets longest-key, unprinted-ref and band-overlap issues', () => {
    ['longest-key', 'unprinted-ref', 'band-overlap'].forEach((check) => {
      expect(R.targets([{ n: 2, check, text: 't' }])).toHaveLength(1);
    });
  });
  it('keeps a round that clears a cross-leak even when it adds another issue (same count)', async () => {
    const exam = { unseen: { objective: { M: [mcq('k', ['x', 'y', 'z'])] }, subjective: {} } };
    const leak = { n: 1, check: 'cross-leak', text: 'leak', avoid: [] };
    let calls = 0;
    const out = await R.rounds({
      examJson: exam, issues: [leak], max: 2,
      ask: async () => ({ items: [{ n: 1, question: 'New stem?', options: ['a) k', 'b) x', 'c) y', 'd) z'], answer: 'a) k' }] }),
      check: () => { calls += 1; return [{ n: 1, check: 'long-stem', text: 'long' }]; },
    });
    expect(out.rewritten).toEqual([1]);
    expect(out.issues[0].check).toBe('long-stem');
    expect(calls).toBeGreaterThan(0);
  });
});
