/**
 * bd-5jmnfj.38.31 — MCQ key letters on a G6-12 free paper are spread by moving the key, never by
 * changing what an option says (panel A7a: key letters clustered on one letter).
 */
const K = require('../../bot/shared/services/assessment/free-secondary-keys');

const mcq = (key, opts = ['a) Mercury', 'b) Venus', 'c) Earth', 'd) Mars']) => ({
  question: 'Which planet is this?', options: opts.slice(), marks: 1, answer: key,
});
const paper = (items) => ({ unseen: { objective: { 'Multiple Choice Questions': items } } });

describe('keyIndex', () => {
  it('reads the key from a letter, a labelled answer, or the option text', () => {
    const q = mcq('b');
    expect(K.keyIndex(q)).toBe(1);
    expect(K.keyIndex({ ...q, answer: 'c) Earth' })).toBe(2);
    expect(K.keyIndex({ ...q, answer: '(d) Mars' })).toBe(3);
    expect(K.keyIndex({ ...q, answer: 'Mercury' })).toBe(0);
    expect(K.keyIndex({ ...q, answer: 'Pluto' })).toBe(-1);
  });
  it('reads an Urdu label', () => {
    const q = mcq('ج) سورج', ['الف) چاند', 'ب) زمین', 'ج) سورج', 'د) ستارہ']);
    expect(K.keyIndex(q)).toBe(2);
  });
});

describe('balanceKeys', () => {
  it('spreads eight keys that were all "a" across every letter, never three in a row', () => {
    const items = Array.from({ length: 8 }, () => mcq('a) Mercury'));
    const exam = paper(items);
    const moved = K.balanceKeys(exam);
    const letters = items.map((q) => q.answer[0]);
    expect(moved).toBeGreaterThan(0);
    ['a', 'b', 'c', 'd'].forEach((l) => expect(letters.filter((x) => x === l)).toHaveLength(2));
    letters.forEach((l, i) => { if (i >= 2) expect(l === letters[i - 1] && l === letters[i - 2]).toBe(false); });
  });

  it('keeps the key text and the set of options, relabelled in order', () => {
    const q = mcq('a) Mercury');
    K.balanceKeys(paper([q]));
    expect(q.options.map((o) => o.slice(0, 2))).toEqual(['a)', 'b)', 'c)', 'd)']);
    expect(q.options.map((o) => o.slice(3)).sort()).toEqual(['Earth', 'Mars', 'Mercury', 'Venus']);
    const idx = K.keyIndex(q);
    expect(q.options[idx]).toBe(`${q.answer.slice(0, 2)} Mercury`);
    expect(q.answer.endsWith('Mercury')).toBe(true);
  });

  it('keeps Urdu labels and capital labels in their own style', () => {
    const ur = mcq('الف) چاند', ['الف) چاند', 'ب) زمین', 'ج) سورج', 'د) ستارہ']);
    const up = mcq('A', ['A) one', 'B) two', 'C) three', 'D) four']);
    K.balanceKeys(paper([ur, up]));
    expect(ur.options.map((o) => o.split(')')[0])).toEqual(['الف', 'ب', 'ج', 'د']);
    expect(up.options.map((o) => o[0])).toEqual(['A', 'B', 'C', 'D']);
    expect(ur.options[K.keyIndex(ur)]).toContain('چاند');
    expect(up.options[K.keyIndex(up)]).toContain('one');
  });

  it('leaves numeric options, options that name other options, and unreadable keys alone', () => {
    const num = mcq('a) 2', ['a) 2', 'b) 4', 'c) 6', 'd) 8']);
    const both = mcq('a) Venus', ['a) Venus', 'b) Mars', 'c) Both a and b', 'd) Earth']);
    const lost = mcq('Pluto');
    const before = [num, both, lost].map((q) => JSON.stringify(q));
    K.balanceKeys(paper([num, both, lost]));
    expect([num, both, lost].map((q) => JSON.stringify(q))).toEqual(before);
  });

  it('never touches a constructed item', () => {
    const srq = { question: 'Name a planet.', marks: 3, answer: 'Mars' };
    const exam = { unseen: { objective: { MCQ: [mcq('a')] }, subjective: { 'Short Answers': [srq] } } };
    K.balanceKeys(exam);
    expect(srq).toEqual({ question: 'Name a planet.', marks: 3, answer: 'Mars' });
  });
});

describe('balanceKeys with a seed (no fixed letter cycle)', () => {
  const lettersFor = (seed, n = 12) => {
    const items = Array.from({ length: n }, () => mcq('a) Mercury'));
    K.balanceKeys(paper(items), seed);
    return items.map((q) => q.answer[0]).join('');
  };
  it('gives the same letters for the same seed', () => {
    expect(lettersFor('paper-1')).toBe(lettersFor('paper-1'));
  });
  it('gives different spreads for different papers, not one fixed c-a-d-b cycle', () => {
    const spreads = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((s) => lettersFor(s)));
    expect(spreads.size).toBeGreaterThan(3);
    expect(spreads.has('cadbcadbcadb')).toBe(false);
  });
  it('keeps letters balanced and never three in a row, for any seed', () => {
    for (let s = 0; s < 50; s += 1) {
      const l = lettersFor(s, 12);
      ['a', 'b', 'c', 'd'].forEach((x) => expect(l.split(x).length - 1).toBe(3));
      expect(/(.)\1\1/.test(l)).toBe(false);
    }
  });
  it('counts a key it cannot move when it keeps runs to two', () => {
    const both = () => mcq('d) Both a and b', ['a) Venus', 'b) Mars', 'c) Earth', 'd) Both a and b']);
    for (let s = 0; s < 60; s += 1) {
      const items = [
        ...Array.from({ length: 7 }, () => mcq('a) Mercury')), both(), both(),
        ...Array.from({ length: 5 }, () => mcq('a) Mercury')),
      ];
      K.balanceKeys(paper(items), s);
      const l = items.map((q) => q.answer[0]).join('');
      expect(/(.)\1\1/.test(l)).toBe(false);
    }
  });
});


describe('sortNumeric (G8 Q9: number options printed in a jumbled order)', () => {
  const Q9 = () => ({
    question: 'عبدالستار ایدھی کس عمر میں انتقال کر گئے؟', marks: 1,
    options: ['الف) ۷۸ سال کی عمر', 'ب) ۸۸ سال کی عمر', 'ج) ۶۸ سال کی عمر', 'د) ۹۸ سال کی عمر'],
    answer: 'ب) ۸۸ سال کی عمر',
  });

  it('puts the numbers in ascending order and re-letters the key', () => {
    const exam = paper([Q9()]);
    expect(K.sortNumeric(exam)).toBe(1);
    const q = exam.unseen.objective['Multiple Choice Questions'][0];
    expect(q.options).toEqual(['الف) ۶۸ سال کی عمر', 'ب) ۷۸ سال کی عمر', 'ج) ۸۸ سال کی عمر', 'د) ۹۸ سال کی عمر']);
    expect(q.answer).toBe('ج) ۸۸ سال کی عمر');
  });

  it('sorts Western digits and decimals, and leaves an ordered set alone', () => {
    const q = mcq('a) 2.5 kg', ['a) 2.5 kg', 'b) 0.5 kg', 'c) 10 kg', 'd) 1 kg']);
    const done = mcq('b', ['a) 1', 'b) 2', 'c) 3', 'd) 4']);
    const exam = paper([q, done]);
    expect(K.sortNumeric(exam)).toBe(1);
    expect(q.options).toEqual(['a) 0.5 kg', 'b) 1 kg', 'c) 2.5 kg', 'd) 10 kg']);
    expect(K.keyIndex(q)).toBe(2);
    expect(done.answer).toBe('b');
  });

  it('leaves word options, mixed wording and dates with two numbers alone', () => {
    const words = mcq('b');
    const mixed = mcq('a', ['a) 7 days', 'b) 3 weeks', 'c) 1 day', 'd) 9 days']);
    const date = mcq('a', ['a) 8 July 1928', 'b) 1 January 1988', 'c) 8 July 1988', 'd) 1 January 1928']);
    expect(K.sortNumeric(paper([words, mixed, date]))).toBe(0);
    expect(mixed.options[0]).toBe('a) 7 days');
  });

  it('keeps a sorted item where balanceKeys found it', () => {
    const exam = paper([Q9(), ...Array.from({ length: 7 }, () => mcq('c) Earth'))]);
    K.sortNumeric(exam);
    K.balanceKeys(exam, 7);
    const q = exam.unseen.objective['Multiple Choice Questions'][0];
    expect(q.options[0]).toBe('الف) ۶۸ سال کی عمر');
    expect(q.answer).toBe('ج) ۸۸ سال کی عمر');
  });
});
