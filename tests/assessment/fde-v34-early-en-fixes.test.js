/**
 * v29 Grade 1-2 English keys and schemes (bd-5jmnfj.4.58.4, round 4), fixed in code by fde-early-english-fixes-2
 * and the MCQ response line in patterns/early/chrome.js. Fixtures are the real v29 papers, pictures stripped.
 */

const { earlyEnglishFixes2 } = require('../../bot/shared/services/assessment/fde-early-english-fixes-2');
const { makeSlot } = require('../../bot/shared/services/assessment/patterns/early/chrome');

const G1 = require('./fixtures/fde-v34-g1-english.json');
const G2 = require('./fixtures/fde-v34-g2-english.json');

const itemsOf = (ex) => Object.values(ex.unseen).flatMap((byType) => Object.values(byType).flat());
const of = (ex, slot) => itemsOf(ex).filter((q) => q.slot === slot);
const sum = (q) => q.scheme.points.reduce((n, p) => n + p.marks, 0);

describe('G1 Q8 accepts the base verb', () => {
  const out = earlyEnglishFixes2(G1).examJson;
  test('every item accepts the plain verb and drops the base-verb error', () => {
    const items = of(out, 'g1.english.B.Q8');
    expect(items.length).toBe(4);
    items.forEach((q) => {
      const base = q.answer.trim().toLowerCase().replace(/ing$/, '');
      expect(q.scheme.accept.map((a) => a.toLowerCase().replace(/ing$/, '')).some((a) => a === base || a === `${base}n` || base.startsWith(a))).toBe(true);
      expect(String(q.scheme.common_error || '')).not.toMatch(/plain|without -ing|base/i);
    });
  });
  test('Running accepts run (doubled n)', () => {
    const q = of(out, 'g1.english.B.Q8').find((x) => /^running$/i.test(x.answer));
    if (q) expect(q.scheme.accept.map((a) => a.toLowerCase())).toContain('run');
  });
});

describe('G1 Q14 counts the capitals', () => {
  const out = earlyEnglishFixes2(G1).examJson;
  test('a sentence needing two capitals says so in its mark point', () => {
    const q = of(out, 'g1.english.C.Q14').find((x) => /^dani/.test(x.question));
    expect(q.scheme.points[0].text).toMatch(/both|two|2/i);
    expect(sum(q)).toBe(q.marks);
  });
  test('a one-capital sentence keeps a single-capital point', () => {
    const q = of(out, 'g1.english.C.Q14').find((x) => /^we sing/.test(x.question));
    expect(q.scheme.points[0].text).not.toMatch(/both|two/i);
  });
});

describe('G1 Q12 pays naming and spelling, not copying the printed frame', () => {
  const out = earlyEnglishFixes2(G1).examJson;
  test('no point pays the capital letter and full stop of the printed frame', () => {
    of(out, 'g1.english.C.Q12').forEach((q) => {
      expect(q.scheme.points.map((p) => p.text).join(' ')).not.toMatch(/capital|full stop|sentence/i);
      expect(sum(q)).toBe(q.marks);
      expect(q.scheme.points.length).toBe(2);
    });
  });
});

describe('G2 Q12 paper paragraph', () => {
  const out = earlyEnglishFixes2(G2).examJson;
  const q = of(out, 'g2.english.C.Q12')[0];
  test('no mark pays describing words and capitals/full stops mechanics', () => {
    const all = q.scheme.points.map((p) => p.text).join(' ');
    expect(all).not.toMatch(/describing|capital|full stop/i);
    expect(sum(q)).toBe(q.marks);
  });
});

describe('G2 Q16 story order marks each sentence by what it follows', () => {
  const out = earlyEnglishFixes2(G2).examJson;
  const q = of(out, 'g2.english.C.Q16')[0];
  test('one misplacement does not zero the others', () => {
    const t = q.scheme.points.map((p) => p.text).join(' ');
    expect(t).toMatch(/straight after|directly after|follows/i);
    expect(sum(q)).toBe(q.marks);
    expect(q.scheme.points.length).toBe(6);
  });
});

describe('G2 Q1 one answer is not split into two marks', () => {
  const out = earlyEnglishFixes2(G2).examJson;
  const q1 = of(out, 'g2.english.A.Q1')[0];
  test('a why question with one idea pays a single 2-mark point', () => {
    const why = q1.questions.find((x) => /^Why did Zara wrap/.test(x.question));
    expect(why.scheme.points).toHaveLength(1);
    expect(why.scheme.points[0].marks).toBe(2);
  });
  test('a question asking for two things keeps two points', () => {
    const two = q1.questions.find((x) => /eat and drink/.test(x.question));
    expect(two.scheme.points).toHaveLength(2);
  });
  test('the marks of every question are unchanged', () => {
    q1.questions.forEach((x) => expect(x.scheme.points.reduce((n, p) => n + p.marks, 0)).toBe(x.marks));
  });
});

describe('rhyme items print the word and keep a common error that follows', () => {
  const out = earlyEnglishFixes2(G2).examJson;
  test('G2 Q3 names the picture word in the stem and rewrites a common error that names a non-rhyme', () => {
    of(out, 'g2.english.B.Q3').forEach((q) => {
      expect(q.question).toContain(q.picture.name);
      expect(String(q.scheme.common_error)).not.toMatch(/\btry\b|like near sounds/i);
    });
  });
});

describe('MCQ slots say how to answer', () => {
  const mk = (instruction_en) => makeSlot({ slot: 'x.Q1', label_en: 'Q1.', type: 'T', generate: 3, marks_each: 1, shape: 'mcq', instruction_en });
  test('Choose is, am or are gets a circle instruction', () => {
    expect(mk('Choose is, am or are.').instruction_en).toMatch(/circle/i);
  });
  test('an instruction that already says circle, write or tick is left as it was', () => {
    ['Circle the small letter.', 'Write the letter.', 'Tick the box.'].forEach((i) => expect(mk(i).instruction_en).toBe(i));
  });
});
