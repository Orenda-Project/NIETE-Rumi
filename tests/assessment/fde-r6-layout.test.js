/**
 * The layout pass and the scheme, round 6: what a second set of board-pattern papers showed.
 *
 *   B. MCQ keys are spread with as few turns as possible: a letter may hold
 *      ceil(n/4) + 1 keys (6 of 20); only items on a letter above that are
 *      turned, each to the emptiest letter, and a balanced paper is left alone.
 *      True/False, Yes/No (and درست/غلط, ہاں/نہیں) are never turned; numbers in
 *      order are never turned whatever word follows them ("degrees", «درجے»).
 *   A. An MCQ with two options of the same value (2/5 and 6/15, 0.5 and 50%)
 *      has two right answers: it is not placed, and its slot reports short.
 *   C. Science Q2(b): a parent scheme whose points cannot be split into the
 *      2.5-mark parts (A2 + A3) is dropped; accept and common error stay, and
 *      each part still prints its own 2.5 chip.
 *
 * Every test goes through applyLayout (→ normaliseScheme) and the real renderer.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const englishMcqs = require('./fixtures/fde/r5w2-mcq-english.json');
const situations = require('./fixtures/fde/r5-science-q2b.json');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
const clone = (o) => JSON.parse(JSON.stringify(o));
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const mcqsOf = (examJson) => examJson.unseen.objective.MCQs;

function stripLetters(scheme, slot) {
  const row = new RegExp(`<div class="strip" data-row="${slot.replace(/\./g, '\\.')}">(.*?)</div>`).exec(scheme);
  if (!row) throw new Error(`no answer strip for ${slot}`);
  const cells = row[1].split('<span class="sc">').slice(1).map((c) => c.replace(/<[^>]+>/g, ''));
  return cells.map((c) => c.replace(/[·،]\s*$/, '').trim().split(/\s+/).pop());
}

function tally(list) {
  const out = {};
  list.forEach((k) => { out[k] = (out[k] || 0) + 1; });
  return out;
}

function mcqExam(slot, make, length = 20) {
  return { unseen: { objective: { MCQs: Array.from({ length }, (_, i) => ({ slot, ...make(i), marks: 1, blooms: 'Remember' })) } } };
}

const turnedCount = (before, after) => after.filter((q, i) => JSON.stringify(q.options) !== JSON.stringify(before[i].options)).length;

describe('B. keys are spread with the fewest turns', () => {
  it('all keys on b → at most 6 on any letter (14 turned, the fewest possible)', () => {
    // 20 keys on (b): no letter may end above 6, and only the 14 needed to get (b) down to 6 move.
    const laid = applyLayout(englishMcqs, P.english, FDE, { now: NOW }).examJson;
    const scheme = R.renderMarkingScheme({ examJson: laid, grade: 5, subject: 'english', allowShort: true });
    const counts = tally(stripLetters(scheme, 'english.A.Q1a'));
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(6);
    expect(counts.b).toBe(6);
    expect(turnedCount(mcqsOf(englishMcqs), mcqsOf(laid))).toBe(14);
    // Deterministic, and a second pass turns nothing more.
    expect(applyLayout(englishMcqs, P.english, FDE, { now: NOW }).examJson).toEqual(laid);
    const again = applyLayout(laid, P.english, FDE, { now: NOW }).examJson;
    expect(mcqsOf(again).map((q) => q.options)).toEqual(mcqsOf(laid).map((q) => q.options));
  });

  it('a balanced paper is untouched', () => {
    const words = ['river', 'mountain', 'desert', 'forest'];
    // 6 / 5 / 5 / 4 across a–d: nothing above the cap of 6.
    const at = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 0];
    const raw = mcqExam('english.A.Q1a', (i) => ({
      question: `Which place is number ${i + 1}?`,
      options: words.map((w, k) => `${'abcd'[k]}) ${w} ${i + 1}`),
      answer: `${'abcd'[at[i]]}) ${words[at[i]]} ${i + 1}`,
    }));
    const laid = mcqsOf(applyLayout(raw, P.english, FDE, { now: NOW }).examJson);
    laid.forEach((q, i) => {
      expect(q.options).toEqual(mcqsOf(raw)[i].options);
      expect(q.answer).toBe(mcqsOf(raw)[i].answer);
    });
  });

  it('True/False never turned', () => {
    const pairs = [['True', 'False'], ['False', 'True'], ['yes', 'no'], ['a) TRUE', 'b) FALSE']];
    const en = mcqExam('english.A.Q1a', (i) => ({ question: `Statement ${i + 1} is a sentence.`, options: pairs[i % 4], answer: 'a' }));
    mcqsOf(applyLayout(en, P.english, FDE, { now: NOW }).examJson).forEach((q, i) => {
      expect(q.options).toEqual(pairs[i % 4]);
      expect(q.answer).toBe('a');
    });
    const urPairs = [['درست', 'غلط'], ['غلط', 'درست'], ['ہاں', 'نہیں'], ['نہیں', 'ہاں']];
    const ur = mcqExam('urdu.A.Q1', (i) => ({ question: `جملہ ${i + 1} درست ہے؟`, options: urPairs[i % 4], answer: 'الف' }));
    mcqsOf(applyLayout(ur, P.urdu, FDE, { now: NOW }).examJson).forEach((q, i) => {
      expect(q.options).toEqual(urPairs[i % 4]);
      expect(q.answer).toBe('الف');
    });
  });

  it('in-order degrees / Urdu units never turned', () => {
    const en = mcqExam('english.A.Q1a', (i) => ({ question: `Angle ${i + 1}?`, options: ['a) 0 degrees', 'b) 90 degrees', 'c) 180 degrees', 'd) 360 degrees'], answer: 'b) 90 degrees' }));
    mcqsOf(applyLayout(en, P.english, FDE, { now: NOW }).examJson).forEach((q) => {
      expect(q.options).toEqual(['a) 0 degrees', 'b) 90 degrees', 'c) 180 degrees', 'd) 360 degrees']);
    });
    const units = ['درجے', 'کلو', 'روپے'];
    const ur = mcqExam('social_studies.A.Q1', (i) => ({
      question: `زاویہ ${i + 1}؟`,
      options: i % 2 ? ['0 درجے', '90 درجے', '180 درجے', '360 درجے'] : ['۵ ' + units[i % 3], '۱۰ ' + units[i % 3], '۱۵ ' + units[i % 3], '۲۰ ' + units[i % 3]],
      answer: 'ب',
    }));
    mcqsOf(applyLayout(ur, P.social_studies, FDE, { now: NOW }).examJson).forEach((q, i) => {
      expect(q.options).toEqual(mcqsOf(ur)[i].options);
    });
  });
});

describe('A. an MCQ with two options of the same value', () => {
  const maths = (bad) => mcqExam('maths.A.Q1a', (i) => (i === 7 ? bad : {
    question: `What is ${i + 3} × 4?`,
    options: [`a) ${(i + 3) * 4 + 1}`, `b) ${(i + 3) * 4}`, `c) ${(i + 3) * 4 - 2}`, `d) ${(i + 3) * 4 + 5}`],
    answer: `b) ${(i + 3) * 4}`,
  }));

  it('two options equal in value → item dropped, slot short', () => {
    for (const options of [['a) 2/5', 'b) 6/15', 'c) 3/4', 'd) 1/3'], ['a) 0.5', 'b) 1/3', 'c) 50%', 'd) 0.25'], ['a) 1/2 kg', 'b) 2 kg', 'c) 0.5 kg', 'd) 3 kg'], ['a) Rs. 50', 'b) 50 rupees', 'c) Rs. 5', 'd) Rs. 500'], ['a) 2 minutes', 'b) 2 min', 'c) 20 min', 'd) 12 min']]) {
      const raw = maths({ question: 'Which fraction is the shaded part?', options, answer: 'a) 2/5' });
      const out = applyLayout(raw, P.maths, FDE, { now: NOW });
      expect(out.placed).toBe(19);
      expect(mcqsOf(out.examJson)).toHaveLength(19);
      expect(mcqsOf(out.examJson).some((q) => q.question === 'Which fraction is the shaded part?')).toBe(false);
      expect(out.shortfall).toContainEqual({ slot: 'maths.A.Q1a', missing: 1 });
      const paper = R.renderPaper({ examJson: out.examJson, grade: 5, subject: 'maths', allowShort: true });
      expect(visible(paper)).not.toContain('Which fraction is the shaded part?');
    }
  });

  it('options that differ in value (2/5, 3/5, 4/5, 1) or in unit (5 kg, 5 g) are kept', () => {
    for (const options of [['a) 2/5', 'b) 3/5', 'c) 4/5', 'd) 1'], ['a) 5 kg', 'b) 5 g', 'c) 50 g', 'd) 500 g'], ['a) red', 'b) blue', 'c) green', 'd) pink']]) {
      const raw = maths({ question: 'Which one is right?', options, answer: 'b) ' + options[1].slice(3) });
      const out = applyLayout(raw, P.maths, FDE, { now: NOW });
      expect(mcqsOf(out.examJson)).toHaveLength(20);
      expect(mcqsOf(out.examJson).some((q) => q.question === 'Which one is right?')).toBe(true);
      expect(out.shortfall.find((s) => s.slot === 'maths.A.Q1a')).toBeUndefined();
    }
  });
});

describe('C. Science Q2(b): the parent scheme splits into its parts or is dropped', () => {
  const chain = (edit) => {
    const raw = clone(situations);
    edit(raw.unseen.subjective['Logical Reasoning']);
    const laid = applyLayout(raw, P.science, FDE, { now: NOW });
    const ns = normaliseScheme(laid.examJson);
    const scheme = R.renderMarkingScheme({ examJson: ns.examJson, grade: 5, subject: 'science', allowShort: true });
    const list = Object.values(ns.examJson.unseen.subjective).flat().filter((q) => q.slot === 'science.B.Q2b');
    return { ns, scheme, list };
  };

  it('science Q2(b) parent A2+A3 is dropped, chips 2.5 ×2 print', () => {
    const { ns, scheme, list } = chain((items) => {
      items[0].scheme.points = [
        { text: 'explains the spread by contact', marks: 2, kind: 'A' },
        { text: 'explains why washing helps', marks: 3, kind: 'A' },
      ];
    });
    const q = list[0];
    expect(q.scheme.points).toBeUndefined();
    expect(q.scheme.accept).toEqual(['any two of the three sub-answers with a reason about contact']);
    expect(q.scheme.common_error).toBe('saying handwashing removes every germ, or not linking touch to spread');
    expect(ns.log.join('\n')).toMatch(/science\.B\.Q2b.*2\.5/);
    // The other situations keep their 2.5 + 2.5 split.
    list.slice(1).forEach((other) => expect(other.scheme.points.map((p) => p.marks)).toEqual([2.5, 2.5]));
    const text = visible(scheme);
    expect(text).not.toContain('explains the spread by contact');
    expect(text).not.toMatch(/\bA2 |\bA3 /);
    // The first situation's three parts each print a 2.5 chip.
    const rows = scheme.match(/<tr data-row="science\.B\.Q2b">[\s\S]*?<\/tr>/g) || [];
    const firstThree = rows.slice(0, 3);
    firstThree.forEach((r) => expect(r).toContain('<span class="chip">2.5</span>'));
    expect(text).toContain('saying handwashing removes every germ');
  });

  it('control: a parent split 2.5 + 2.5 (or 1 + 1.5 + 2.5) is kept', () => {
    const { list } = chain((items) => {
      items[0].scheme.points = [
        { text: 'names the cause', marks: 1, kind: 'A' },
        { text: 'gives the reason', marks: 1.5, kind: 'A' },
        { text: 'a correct second answer', marks: 2.5, kind: 'A' },
      ];
    });
    expect(list[0].scheme.points.map((p) => p.marks)).toEqual([1, 1.5, 2.5]);
    expect(list[1].scheme.points.map((p) => p.marks)).toEqual([2.5, 2.5]);
  });
});

describe('the scope word the paper prints, for other screens to reuse', () => {
  const { unitWord } = require('../../bot/shared/services/assessment/fde-layout');
  it('unitWord gives each subject its own word, singular for one', () => {
    expect(unitWord('urdu', 3)).toEqual({ en: 'Lessons', ur: 'اسباق' });
    expect(unitWord('urdu', 1)).toEqual({ en: 'Lesson', ur: 'سبق' });
    expect(unitWord('science', 2)).toEqual({ en: 'Chapters', ur: 'ابواب' });
    expect(unitWord('english', 1)).toEqual({ en: 'Unit', ur: 'یونٹ' });
    expect(unitWord('nonsense', 2)).toEqual({ en: 'Units', ur: 'ابواب' });
  });
});
