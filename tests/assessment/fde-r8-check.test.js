/**
 * Board-pattern keys, round 8: two keys code must never get wrong.
 *
 * A. Maths: a written item that asks for an estimate ("Estimate the difference …
 *    by first rounding each number to the nearest thousand") is keyed with the
 *    estimate, never the exact value. The checker used to read the stem as a plain
 *    subtraction and rewrite 531,000 to 530,865. An estimate / round / nearest /
 *    approximately / about stem is now left unchecked and its key untouched.
 * B. English: an MCQ that asks to rearrange the letters of a quoted word (or names
 *    an anagram of it) is placed only when exactly one option is an anagram of that
 *    word and the key names it. Otherwise it is held like any two-key MCQ: not
 *    placed, its slot reports short, the section is re-asked.
 *
 * Red fixtures are recorded round-3 local papers, copied verbatim (fictional text,
 * no names). Chain: applyLayout → normaliseScheme → mathsCheck, as the generator runs it.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck, mcqPropertyVerdict } = require('../../bot/shared/services/assessment/maths-check');
const { anagramVerdict } = require('../../bot/shared/services/assessment/english-check');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };

// ── A. Maths estimates ─────────────────────────────────────────────────────

// Maths chapters_1 Short Questions[9], as the model wrote it (before the checker).
const ESTIMATE_ITEM = {
  slot: 'maths.A.Q1b',
  question: 'Estimate the difference between 654,321 and 123,456 by first rounding each number to the nearest thousand.',
  marks: 2,
  answer: '654,000 - 123,000 = 531,000',
  blooms: 'Apply',
  scheme: { points: [{ kind: 'A', marks: 2, text: '654,000 - 123,000 = 531,000' }] },
};

// Ten Q1(b) items: nine plain computations and the item under test at index 4.
function q1bWith(item) {
  const items = Array.from({ length: 10 }, (_, i) => (i === 4 ? item : {
    slot: 'maths.A.Q1b',
    question: `Multiply: ${12345 + i} × 3`,
    answer: `${(12345 + i) * 3}`,
    blooms: 'Understand',
  }));
  return { unseen: { subjective: { 'Short Questions': items } } };
}

function throughChecker(item) {
  const laid = applyLayout(q1bWith(item), P.maths, FDE, { now: NOW });
  const mc = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' });
  const out = Object.values(mc.examJson.unseen.subjective).flat();
  return { item: out.find((q) => q.question === item.question), notes: mc.examJson._layout.notes || [], mc };
}

describe('A. maths estimate guard: an estimate key is never rewritten', () => {
  it('chapters_1 Short Questions[9]: 531,000 stays 531,000, unchecked, no note', () => {
    const { item, notes } = throughChecker(ESTIMATE_ITEM);
    expect(item.answer).toBe('654,000 - 123,000 = 531,000');
    expect(item.scheme.points.find((p) => p.kind === 'A').text).toBe('654,000 - 123,000 = 531,000');
    expect(item.scheme.checked).toBe(null);
    expect(notes).toEqual([]);
  });

  it('every guard word leaves the key as written', () => {
    const stems = [
      ['Estimate the sum of 4,872 and 3,219.', '5,000 + 3,000 = 8,000'],
      ['Give an estimation of the product of 38 and 52.', '40 × 50 = 2,000'],
      ['Round 678 and 212 to the nearest hundred, then find the difference between 678 and 212.', '700 - 200 = 500'],
      ['Find the sum of 1,960 and 3,040 rounded to the nearest thousand.', '2,000 + 3,000 = 5,000'],
      ['Add 2,987 and 4,012 to the nearest thousand.', '3,000 + 4,000 = 7,000'],
      ['What is approximately 49 × 21?', '50 × 20 = 1,000'],
      ['About how much is 398 + 205?', '400 + 200 = 600'],
      ['398 + 205 is about 600. Find the sum of 398 and 205 to the nearest hundred.', '400 + 200 = 600'],
      ['Multiply 49 by 21 and give an approximate answer.', '50 × 20 = 1,000'],
    ];
    for (const [question, answer] of stems) {
      const { item } = throughChecker({ slot: 'maths.A.Q1b', question, answer, blooms: 'Apply' });
      expect([question, item.answer, item.scheme.checked]).toEqual([question, answer, null]);
    }
  });

  it('a plain computation is still checked and corrected (no other verdict changes)', () => {
    const { item, notes } = throughChecker({ slot: 'maths.A.Q1b', question: 'Find the difference between 654,321 and 123,456.', answer: '654,321 - 123,456 = 531,000', blooms: 'Understand' });
    expect(item.scheme.checked).toBe('replaced');
    expect(item.answer).toBe('654,321 - 123,456 = 530,865');
    expect(notes).toHaveLength(1);
    const ok = throughChecker({ slot: 'maths.A.Q1b', question: 'Multiply: 2,345 × 7', answer: '16,415', blooms: 'Understand' });
    expect(ok.item.scheme.checked).toBe('ok');
  });

  it('a word that only contains a guard word, or "about" not as an amount, is not a guard', () => {
    for (const question of ['A path goes around a park. How long is it in all?', 'A word problem about a shop: how far?']) {
      const { item } = throughChecker({ slot: 'maths.A.Q1b', question, answer: '2,345 × 7 = 16,405 m', blooms: 'Apply' });
      expect([question, item.scheme.checked, item.answer]).toEqual([question, 'replaced', '2,345 × 7 = 16,415 m']);
    }
  });

  it('a plain paper (no board pattern) keeps today\'s behaviour', () => {
    const plain = { unseen: { subjective: { short: [{ question: 'Estimate the difference between 654,321 and 123,456.', answer: '531,000' }] } } };
    const before = JSON.stringify(mathsCheck(plain, { subject: 'maths' }).examJson);
    expect(JSON.parse(before).unseen.subjective.short[0].scheme.checked).toBe('replaced');
  });
});

// ── B. English anagrams ────────────────────────────────────────────────────

// English chapters_1 MCQ xviii (round-3 local), verbatim.
const TASR = { question: "Which word can be made by rearranging the letters of 'tasr'?", options: ['a) tars', 'b) rest', 'c) rats', 'd) sort'], answer: 'd) sort' };
// English full_1 (round-3 local): one anagram, keyed.
const SILENT = { question: "Which word is an anagram of 'silent'?", options: ['a) tinsel', 'b) stolen', 'c) litter', 'd) sling'], answer: 'a) tinsel' };

function englishWith(item) {
  const list = Array.from({ length: 20 }, (_, i) => (i === 7 ? item : {
    question: `Which word is a noun? (${i + 1})`,
    options: ['a) run', `b) table${i}`, 'c) quickly', 'd) blue'],
    answer: `b) table${i}`,
  })).map((q) => ({ slot: 'english.A.Q1a', marks: 1, ...q }));
  return { unseen: { objective: { MCQs: list } } };
}

function laidEnglish(item) {
  const out = applyLayout(englishWith(item), P.english, FDE, { now: NOW });
  return {
    gone: !out.examJson.unseen.objective.MCQs.some((q) => q.question === item.question),
    short: out.shortfall.find((s) => s.slot === 'english.A.Q1a'),
    out,
  };
}

describe('B. english anagram guard: placed only with one anagram, keyed', () => {
  it("chapters_1 MCQ xviii «tasr» keyed «sort» → held, slot short", () => {
    const r = laidEnglish(TASR);
    expect(r.gone).toBe(true);
    expect(r.short).toEqual({ slot: 'english.A.Q1a', missing: 1 });
    expect(anagramVerdict(TASR)).toEqual({ ok: false, passing: ['a', 'c'] });
  });

  it('one anagram, keyed → kept', () => {
    const r = laidEnglish(SILENT);
    expect(r.gone).toBe(false);
    expect(r.short).toBeUndefined();
    expect(anagramVerdict(SILENT)).toEqual({ ok: true });
  });

  it('the one anagram not keyed → held', () => {
    expect(anagramVerdict({ ...SILENT, answer: 'b) stolen' })).toEqual({ ok: false, passing: ['a'] });
    expect(laidEnglish({ ...SILENT, answer: 'b) stolen' }).gone).toBe(true);
  });

  it('two or more anagrams, or none → held (recorded items)', () => {
    const held = [
      { question: "Which word can be made by rearranging the letters of 'listen'?", options: ['a) silent', 'b) lister', 'c) tinsel', 'd) stolen'], answer: 'a) silent' },
      { question: "Which of these words is an anagram of 'heart'?", options: ['a) earth', 'b) heard', 'c) hater', 'd) tears'], answer: 'a) earth' },
      { question: "Which word is an anagram of 'listen'?", options: ['a) silent', 'b) enlist', 'c) tinsel', 'd) all of these'], answer: 'd) all of these' },
      { question: "Rearrange the letters 'netivn' to form a correct word.", options: ['a) invent', 'b) vintne', 'c) evntin', 'd) intven'], answer: 'a) invent' },
      { question: "Rearrange the anagram to form a word: 'ETVO'", options: ['a) EVOT', 'b) VOTE', 'c) TOVE', 'd) OVET'], answer: 'b) VOTE' },
      { question: "Unscramble the letters “dlo” to make a word.", options: ['a) cold', 'b) dog', 'c) lad', 'd) load'], answer: 'a) cold' },
    ];
    for (const item of held) {
      expect([item.question, anagramVerdict(item).ok]).toEqual([item.question, false]);
      expect([item.question, laidEnglish(item).gone]).toEqual([item.question, true]);
    }
  });

  it('one anagram among near-misses (an extra letter, an apostrophe) → kept', () => {
    const kept = [
      { question: "Which word is made by rearranging the letters of 'listen'?", options: ['a) silent', "b) tinsel's", 'c) lines', 'd) stolen'], answer: 'a) silent' },
      { question: "Which word is an anagram of 'stale'?", options: ['a) tales', 'b) steel', "c) slate's", 'd) stall'], answer: 'a) tales' },
      { question: 'Which word is an anagram of "night"?', options: ['A. thing', 'B. knight', 'C. might', 'D. sight'], answer: 'thing' },
    ];
    for (const item of kept) {
      expect([item.question, anagramVerdict(item)]).toEqual([item.question, { ok: true }]);
      expect(laidEnglish(item).gone).toBe(false);
    }
  });

  it('the word itself is not a rearrangement of it', () => {
    expect(anagramVerdict({ question: "Which word is an anagram of 'save'?", options: ['a) vase', 'b) save', 'c) seat', 'd) vast'], answer: 'a) vase' })).toEqual({ ok: true });
  });

  it('an anagram-class stem with no single quoted word cannot be verified → held', () => {
    const item = { question: 'Which word is an anagram of a word for a hot drink?', options: ['a) tea', 'b) eat', 'c) milk', 'd) cup'], answer: 'b) eat' };
    expect(anagramVerdict(item)).toEqual({ ok: false, passing: [] });
    expect(laidEnglish(item).gone).toBe(true);
  });

  it('other stems are unchecked: word order, letters in other senses, Urdu, non-MCQs', () => {
    for (const item of [
      { question: 'Rearrange the words to make a sentence: "school / to / go / I"', options: ['a) I go to school', 'b) School go I to', 'c) To I go school', 'd) Go school to I'], answer: 'a) I go to school' },
      { question: 'Which word has silent letters?', options: ['a) knife', 'b) cat', 'c) dog', 'd) pen'], answer: 'a) knife' },
      { question: 'Who wrote the letters?', options: ['a) Ali', 'b) a friend', 'c) the teacher', 'd) a cousin'], answer: 'b) a friend' },
      { question: 'حروف کو ترتیب دے کر لفظ بنائیں: «ل ق م»', options: ['a) قلم', 'b) قمل', 'c) ملق', 'd) لقم'], answer: 'a) قلم' },
      { question: "Rearrange the letters of 'tasr'.", answer: 'star' },
      null,
    ]) {
      expect(anagramVerdict(item)).toEqual({ ok: null });
    }
    expect(laidEnglish({ question: 'Which word has silent letters?', options: ['a) knife', 'b) cat', 'c) dog', 'd) pen'], answer: 'a) knife' }).gone).toBe(false);
  });
});

// ── C. Maths MCQs rounded to decimal places ────────────────────────────────

// Maths full_3 Q1(a) xi (round-3 local), verbatim: 7.846 to the nearest tenth is 7.8, keyed 7.9.
const FULL_3_XI = { question: 'What is 7.846 rounded to the nearest tenth?', options: ['a) 7.9', 'b) 7.8', 'c) 8.0', 'd) 7.85'], answer: 'a) 7.9' };

function mathsMcqsWith(item) {
  const list = Array.from({ length: 20 }, (_, i) => (i === 7 ? item : {
    question: `What is ${i + 3} × 4?`,
    options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
    answer: `b) ${(i + 3) * 4}`,
  })).map((q) => ({ slot: 'maths.A.Q1a', marks: 1, ...q }));
  return { unseen: { objective: { MCQs: list } } };
}
function laidMaths(item) {
  const out = applyLayout(mathsMcqsWith(item), P.maths, FDE, { now: NOW });
  return { gone: !out.examJson.unseen.objective.MCQs.some((q) => q.question === item.question), short: out.shortfall.find((s) => s.slot === 'maths.A.Q1a') };
}

describe('C. maths rounding to the nearest tenth / hundredth / thousandth / whole number', () => {
  it('full_3 xi: 7.846 to the nearest tenth keyed 7.9 → dropped, slot short', () => {
    expect(mcqPropertyVerdict(FULL_3_XI)).toEqual({ ok: false, passing: ['b'] });
    expect(laidMaths(FULL_3_XI)).toEqual({ gone: true, short: { slot: 'maths.A.Q1a', missing: 1 } });
  });

  it('a right key at each place → kept', () => {
    for (const item of [
      { question: 'What is 6.478 rounded to the nearest tenth?', options: ['a) 6.4', 'b) 6.5', 'c) 6.48', 'd) 7.0'], answer: 'b) 6.5' },
      { question: 'Round 3.456 to the nearest hundredth.', options: ['a) 3.45', 'b) 3.46', 'c) 3.5', 'd) 3.4'], answer: 'b) 3.46' },
      { question: 'What is 5.678 rounded to the nearest hundredth?', options: ['A) 5.67', 'B) 5.68', 'C) 5.7', 'D) 5.6'], answer: 'B) 5.68' },
      { question: 'Round 2.4615 to the nearest thousandth.', options: ['a) 2.461', 'b) 2.462', 'c) 2.46', 'd) 2.5'], answer: 'b) 2.462' },
      { question: 'Round 7.85 to the nearest tenth.', options: ['a) 7.8', 'b) 7.9', 'c) 8', 'd) 7.85'], answer: 'b) 7.9' },
      { question: 'What is 12.5 rounded to the nearest whole number?', options: ['a) 12', 'b) 13', 'c) 12.5', 'd) 10'], answer: 'b) 13' },
    ]) {
      expect([item.question, mcqPropertyVerdict(item)]).toEqual([item.question, { ok: true }]);
      expect(laidMaths(item).gone).toBe(false);
    }
  });

  it('two options equal to the rounded value, or none → not ok', () => {
    expect(mcqPropertyVerdict({ question: 'What is 4.36 rounded to the nearest tenth?', options: ['a) 4.3', 'b) 4.5', 'c) 4.2', 'd) 4.0'], answer: 'a) 4.3' })).toEqual({ ok: false, passing: [] });
  });

  it('a stem with two numbers, or options that are not numbers, stays unchecked', () => {
    expect(mcqPropertyVerdict({ question: 'Round 3.46 and 2.71 to the nearest tenth: which sum is it?', options: ['a) 6.2', 'b) 6.1', 'c) 6.0', 'd) 6.3'], answer: 'a) 6.2' })).toEqual({ ok: null });
    expect(mcqPropertyVerdict({ question: 'To round 7.846 to the nearest tenth, which digit do we look at?', options: ['a) 7', 'b) 8', 'c) 4', 'd) 6'], answer: 'c) 4' }).ok).not.toBe(false);
  });
});

// ── D. A quotient-and-remainder key written with "/" ───────────────────────

// Maths full_1 Q2 iv (round-4 local), as the model wrote it: right, remainder 0.
const DIVIDE_SLASH = {
  slot: 'maths.B.Q2',
  question: 'Divide 48,672 by 36. Write the quotient and the remainder.',
  answer: '48,672 / 36 = 1,352 remainder 0. Quotient 1,352, remainder 0.',
  blooms: 'Understand',
};

function q2Checked(item) {
  const laid = applyLayout({ unseen: { subjective: { 'Word Problems': [item] } } }, P.maths, FDE, { now: NOW });
  const mc = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' });
  return Object.values(mc.examJson.unseen.subjective).flat().find((q) => q.question === item.question);
}

describe('D. a remainder key is never rewritten to the quotient', () => {
  it('full_1 Q2 iv: «48,672 / 36 = 1,352 remainder 0» stays, ok', () => {
    const q = q2Checked(DIVIDE_SLASH);
    expect(q.answer).toBe(DIVIDE_SLASH.answer);
    expect(q.scheme.checked).toBe('ok');
  });

  it('a wrong remainder after "/" is corrected; "÷" still works', () => {
    const q = q2Checked({ ...DIVIDE_SLASH, question: 'Divide 4,573 by 12. Write the quotient and the remainder.', answer: '4,573 / 12 = 381 remainder 5' });
    expect([q.scheme.checked, q.answer]).toEqual(['replaced', '4,573 / 12 = 381 remainder 1']);
    const r = q2Checked({ ...DIVIDE_SLASH, question: 'Divide 4,573 by 12. Write the quotient and the remainder.', answer: '4,573 ÷ 12 = 381 remainder 1' });
    expect(r.scheme.checked).toBe('ok');
    const w = q2Checked({ ...DIVIDE_SLASH, answer: '48,672 / 36 = 1,352 with remainder 0. Quotient 1,352, remainder 0.' });
    expect([w.scheme.checked, w.answer]).toEqual(['ok', '48,672 / 36 = 1,352 with remainder 0. Quotient 1,352, remainder 0.']);
  });

  it('an exact division keyed with a remainder in some other shape is left unchecked, never rewritten', () => {
    const answer = 'Quotient = 1,352 and remainder = 0';
    const q = q2Checked({ ...DIVIDE_SLASH, answer });
    expect([q.scheme.checked, q.answer]).toEqual([null, answer]);
  });
});
