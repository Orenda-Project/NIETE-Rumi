/**
 * Red-team probes for the board-pattern property oracle (mcqPropertyVerdict) and
 * its wiring in fde-layout#printable. Written by the train-5 sweeper; the
 * manager may add this file to the PR.
 *
 * Group A: a legitimate stem must never be dropped (a false drop costs a
 * section re-ask and, when the re-ask trips the same class, the whole paper).
 * Group B: blast radius — other subjects, other slot shapes, the equality drop.
 * Group C: parsing edges (letters, numbers as numbers, Urdu, trailing marks).
 * Group D: the oracle's verdict against the keyed answer (what ok:true does NOT say).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { mcqPropertyVerdict } = require('../../bot/shared/services/assessment/maths-check');

const SUBJECTS = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
const v = (question, options) => mcqPropertyVerdict({ question, options });

// The MCQ slot of a subject, and a paper whose MCQ list is twenty plain items with item 7 swapped.
function mcqSlot(P) {
  return P.sections.flatMap((s) => s.slots).find((s) => s.shape === 'mcq');
}
function paperWith(P, item) {
  const slot = mcqSlot(P);
  const list = Array.from({ length: slot.generate }, (_, i) => (i === 7 ? item : {
    question: `What is ${i + 3} × 4?`,
    options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
    answer: `b) ${(i + 3) * 4}`,
  })).map((q) => ({ slot: slot.slot, marks: 1, ...q }));
  return { slot, examJson: { unseen: { objective: { MCQs: list } } } };
}
function laidOut(P, item) {
  const { slot, examJson } = paperWith(P, item);
  const out = applyLayout(examJson, P, FDE, { now: NOW });
  const list = out.examJson.unseen.objective.MCQs || [];
  return { kept: list.some((q) => q.question === item.question), short: out.shortfall.find((s) => s.slot === slot.slot), out };
}

describe('A. a legitimate stem is never dropped', () => {
  // The regex reads the FIRST number after "divisible by"; a second condition is not read.
  it('divisible by two numbers (and / comma) stays unchecked', () => {
    expect(v('Which number is divisible by 2 and 3?', ['a) 12', 'b) 9', 'c) 8', 'd) 15'])).toEqual({ ok: null });
    expect(v('Which number is divisible by 2, 3 and 5?', ['a) 30', 'b) 20', 'c) 12', 'd) 15'])).toEqual({ ok: null });
    expect(v('Which of these is a multiple of 3 and 4?', ['a) 12', 'b) 9', 'c) 8', 'd) 16'])).toEqual({ ok: null });
    expect(v('Which number is divisible by 5 and 10?', ['a) 100', 'b) 25', 'c) 15', 'd) 35'])).toEqual({ ok: null });
  });

  it('a stem that asks which number ROUNDS TO a value stays unchecked', () => {
    expect(v('Which number rounds to 5,000 when rounded to the nearest thousand?', ['a) 4,499', 'b) 4,501', 'c) 5,501', 'd) 5,600'])).toEqual({ ok: null });
    expect(v('Which number, when rounded to the nearest 100, gives 4,300?', ['a) 4,251', 'b) 4,349', 'c) 4,350', 'd) 4,249'])).toEqual({ ok: null });
  });

  it('a two-condition stem is placed through the layout', () => {
    const item = { question: 'Which number is divisible by 2 and 3?', options: ['a) 12', 'b) 9', 'c) 8', 'd) 15'], answer: 'a) 12' };
    const r = laidOut(SUBJECTS.maths, item);
    expect(r.kept).toBe(true);
    expect(r.short).toBeUndefined();
  });

  it('a one-key item with a trailing full stop or a unit on every option is at least not dropped', () => {
    expect(v('Which number is divisible by 11?', ['a) 2,314.', 'b) 3,527.', 'c) 4,215.', 'd) 5,148.']).ok).not.toBe(false);
    expect(v('Which number is divisible by 11?', ['a) 2,314 kg', 'b) 3,527 kg', 'c) 4,215 kg', 'd) 5,148 kg']).ok).not.toBe(false);
  });
});

describe('B. blast radius: other subjects, other shapes, the equality drop', () => {
  it('a Science / SST / English / Urdu MCQ with a property-looking stem is unchecked and placed', () => {
    const cases = {
      science: { question: 'Which of the following is a factor of soil erosion?', options: ['a) Wind', 'b) Roots', 'c) Terracing', 'd) Mulch'], answer: 'a) Wind' },
      social_studies: { question: 'In which year did Pakistan become an even-numbered member of the UN?', options: ['a) 1947', 'b) 1948', 'c) 1956', 'd) 1971'], answer: 'a) 1947' },
      english: { question: 'Which word is the odd one out?', options: ['a) cat', 'b) dog', 'c) 12', 'd) cow'], answer: 'c) 12' },
      urdu: { question: 'کون سا لفظ مفرد ہے؟', options: ['الف) کتابیں', 'ب) کتاب', 'ج) قلم', 'د) دروازے'], answer: 'ب) کتاب' },
    };
    for (const [subject, item] of Object.entries(cases)) {
      const P = SUBJECTS[subject];
      if (!P) continue;
      expect(v(item.question, item.options)).toEqual({ ok: null });
      const r = laidOut(P, item);
      expect(r.kept).toBe(true);
      expect(r.short).toBeUndefined();
    }
  });

  it('a non-MCQ Maths slot never consults the oracle', () => {
    const P = SUBJECTS.maths;
    const slot = P.sections.flatMap((s) => s.slots).find((s) => s.shape !== 'mcq');
    const item = { slot: slot.slot, question: 'Which number is divisible by 11?', options: ['a) 2,314', 'b) 3,527', 'c) 4,213', 'd) 5,148'], answer: 'd) 5,148' };
    const out = applyLayout({ unseen: { objective: { MCQs: [item] } } }, P, FDE, { now: NOW });
    expect(out.unplaced).toBe(0);
    expect(out.shortfall.find((s) => s.slot === slot.slot)).toEqual({ slot: slot.slot, missing: slot.generate - 1 });
  });

  it('the R5 equality drop still drops 0.2 / 0.20 (the oracle does not rescue it)', () => {
    const item = { question: 'Which decimal equals one fifth?', options: ['a) 0.2', 'b) 0.20', 'c) 0.5', 'd) 0.02'], answer: 'a) 0.2' };
    expect(v(item.question, item.options)).toEqual({ ok: null });
    const r = laidOut(SUBJECTS.maths, item);
    expect(r.kept).toBe(false);
    expect(r.short).toEqual({ slot: mcqSlot(SUBJECTS.maths).slot, missing: 1 });
  });

  it('a dropped property item counts as unplaced and placed is 19', () => {
    const item = { question: 'Which number is divisible by 11?', options: ['a) 2,314', 'b) 3,527', 'c) 4,213', 'd) 5,148'], answer: 'd) 5,148' };
    const r = laidOut(SUBJECTS.maths, item);
    expect(r.kept).toBe(false);
    expect(r.out.unplaced).toBe(1);
    expect(r.out.placed).toBe(19);
  });
});

describe('C. parsing edges', () => {
  it('options as numbers, bracketed letters, capital letters, Urdu letters', () => {
    expect(v('Which number is divisible by 11?', [2314, 3527, 4215, 5148])).toEqual({ ok: true });
    expect(v('Which number is divisible by 11?', ['(a) 2,314', '(b) 3,527', '(c) 4,213', '(d) 5,148'])).toEqual({ ok: false, passing: ['c', 'd'] });
    expect(v('Which number is divisible by 11?', ['A. 2,314', 'B. 3,527', 'C. 4,213', 'D. 5,148'])).toEqual({ ok: false, passing: ['c', 'd'] });
    // Urdu option letters (الف/ب/ج/د) are not read: the item is unchecked, never dropped (recorded, not a defect: Maths is English-medium).
    expect(v('کون سا عدد ۱۱ سے پورا تقسیم ہوتا ہے؟', ['الف) ۲۳۱۴', 'ب) ۳۵۲۷', 'ج) ۴۲۱۳', 'د) ۵۱۴۸'])).toEqual({ ok: null });
    expect(v('کون سا عدد ۱۱ سے پورا تقسیم ہوتا ہے؟', ['a) ۲۳۱۴', 'b) ۳۵۲۷', 'c) ۴۲۱۳', 'd) ۵۱۴۸'])).toEqual({ ok: false, passing: ['c', 'd'] });
  });

  it('Urdu even / odd / prime with Urdu-Indic digits', () => {
    expect(v('کون سا عدد جفت ہے؟', ['a) ۱۳', 'b) ۲۵', 'c) ۳۸', 'd) ۴۱'])).toEqual({ ok: true });
    expect(v('کون سا عدد طاق ہے؟', ['a) ۱۳', 'b) ۲۶', 'c) ۳۸', 'd) ۴۱'])).toEqual({ ok: false, passing: ['a', 'd'] });
    expect(v('کون سا عدد مفرد ہے؟', ['a) ۵۱', 'b) ۳۹', 'c) ۴۷', 'd) ۵۷'])).toEqual({ ok: true });
    expect(v('کون سا عدد ۳ سے تقسیم نہیں ہوتا؟', ['a) ۱۲', 'b) ۱۵', 'c) ۱۶', 'd) ۱۸'])).toEqual({ ok: null });
    expect(v('کون سا عدد جفت ہے؟', ['الف) ۱۳', 'ب) ۲۵', 'ج) ۳۸', 'د) ۴۱'])).toEqual({ ok: null });
  });

  it('rounding and place value with Urdu-Indic digits in the stem', () => {
    expect(v('Round ۳۴۶,۸۲۰ to the nearest thousand.', ['a) 346,000', 'b) 347,000', 'c) 340,000', 'd) 350,000'])).toEqual({ ok: true });
    expect(v('What is the value of the digit ۴ in ۳,۱۴۲,۷۸۵?', ['a) 4,000', 'b) 40,000', 'c) 400,000', 'd) 400'])).toEqual({ ok: true });
  });

  it('a decimal stem number in a rounding question is unchecked; a huge number is still a verdict', () => {
    expect(v('Round 3.456 to the nearest hundredth.', ['a) 3.45', 'b) 3.46', 'c) 3.5', 'd) 3.4'])).toEqual({ ok: null });
    expect(v('Round 3.456 to the nearest ten.', ['a) 0', 'b) 10', 'c) 3', 'd) 4'])).toEqual({ ok: null });
    expect(v('Which number is a prime number?', ['a) 999,999,937', 'b) 1,000,000', 'c) 999,999,936', 'd) 999,999,938'])).toEqual({ ok: true });
  });
});

describe('D. the keyed letter against the one right option', () => {
  // qa-retest-r2 app paper 259f5624 (and its v2 75b88273), verbatim: the digit 4 in 3,845,126 is in the
  // ten thousands place; the key says d) Hundred thousands. The oracle sees a) is the only right option.
  const A1 = { question: 'What is the place value of the digit 4 in 3,845,126?', options: ['a) Ten thousands', 'b) Thousands', 'c) Hundreds', 'd) Hundred thousands'], answer: 'd) Hundred thousands' };

  it('a single right option that is not the keyed letter → dropped (wrong key never prints)', () => {
    expect(mcqPropertyVerdict(A1)).toEqual({ ok: false, passing: ['a'] });
    const r = laidOut(SUBJECTS.maths, A1);
    expect(r.kept).toBe(false);
    expect(r.short).toEqual({ slot: mcqSlot(SUBJECTS.maths).slot, missing: 1 });
    const item = { question: 'Which number is divisible by 11?', options: ['a) 2,314', 'b) 3,527', 'c) 4,215', 'd) 5,148'], answer: 'a) 2,314' };
    expect(mcqPropertyVerdict(item)).toEqual({ ok: false, passing: ['d'] });
  });

  it('the keyed letter in its other spellings; an answer without a letter is not compared', () => {
    const base = { question: 'Which number is divisible by 11?', options: ['a) 2,314', 'b) 3,527', 'c) 4,215', 'd) 5,148'] };
    for (const answer of ['d', 'D', '(d)', 'd)', 'd) 5,148', 'D. 5,148']) expect(mcqPropertyVerdict({ ...base, answer })).toEqual({ ok: true });
    for (const answer of ['5,148', undefined, null, 5148]) expect(mcqPropertyVerdict({ ...base, answer })).toEqual({ ok: true });
    expect(mcqPropertyVerdict({ ...base, answer: 'b' })).toEqual({ ok: false, passing: ['d'] });
  });
});
