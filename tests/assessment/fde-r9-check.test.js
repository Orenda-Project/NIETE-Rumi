/**
 * Board-pattern checks, round 9 (Maths train): two things code can settle for certain.
 *
 * 1. Maths place-value MCQs ("Which place is the digit 9 in 2,395,140?") are
 *    checked: the place, or the value, of the digit is computed and the key must
 *    name it. A wrong key is held like any two-key MCQ (not placed, slot short).
 *    A digit that appears twice in the number cannot be read: unchecked.
 * 2. The before-the-exam box says what code did in plain words: «N marking rows
 *    were written from the answer. Check them before marking.»
 *
 * Red fixtures are recorded local papers, copied verbatim (fictional text, no
 * names). Chain: applyLayout (as the generator runs it) and renderMarkingScheme.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { mcqPropertyVerdict } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
const clone = (o) => JSON.parse(JSON.stringify(o));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/\s+/g, ' ');
}

// ── 1. Maths place value ───────────────────────────────────────────────────

// Maths chapters_1 Q1(a) iv (round-4 local), verbatim: 9 in 2,395,140 is in the ten thousands place.
const PLACE_IV = { question: 'Which place is the digit 9 in 2,395,140?', options: ['a) Thousands', 'b) Ten thousands', 'c) Hundred thousands', 'd) Hundreds'], answer: 'a) Thousands' };
// Q1(a) i and iii of the same paper: right keys.
const PLACE_I = { question: 'What is the place value of the digit 4 in 3,418,562?', options: ['a) Ten thousands', 'b) Hundred thousands', 'c) Thousands', 'd) Millions'], answer: 'b) Hundred thousands' };
const VALUE_III = { question: 'What is the value of the digit 8 in 8,204,631?', options: ['a) 800,000', 'b) 80,000', 'c) 8,000,000', 'd) 8,000'], answer: 'c) 8,000,000' };

function mathsMcqsWith(item) {
  const list = Array.from({ length: 20 }, (_, i) => (i === 3 ? item : {
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

describe('1. maths place-value MCQ oracle', () => {
  it('chapters_1 Q1(a) iv: 9 in 2,395,140 keyed Thousands → held, slot short', () => {
    expect(mcqPropertyVerdict(PLACE_IV)).toEqual({ ok: false, passing: ['b'] });
    expect(laidMaths(PLACE_IV)).toEqual({ gone: true, short: { slot: 'maths.A.Q1a', missing: 1 } });
  });

  it('the same item keyed Ten thousands → kept', () => {
    const right = { ...PLACE_IV, answer: 'b) Ten thousands' };
    expect(mcqPropertyVerdict(right)).toEqual({ ok: true });
    expect(laidMaths(right)).toEqual({ gone: false, short: undefined });
  });

  it('right keys on the same paper stay placed (place value names, value as a number)', () => {
    for (const item of [PLACE_I, VALUE_III]) {
      expect([item.question, mcqPropertyVerdict(item)]).toEqual([item.question, { ok: true }]);
      expect(laidMaths(item).gone).toBe(false);
    }
  });

  it('the other wordings are read', () => {
    const cases = [
      [{ question: 'In which place is the digit 6 in 46,215?', options: ['a) Tens', 'b) Hundreds', 'c) Thousands', 'd) Ten thousands'], answer: 'c) Thousands' }, { ok: true }],
      [{ question: 'In which place is the digit 6 in 46,215?', options: ['a) Tens', 'b) Hundreds', 'c) Thousands', 'd) Ten thousands'], answer: 'd) Ten thousands' }, { ok: false, passing: ['c'] }],
      [{ question: 'What is the place value of 7 in 573,018?', options: ['a) 7,000', 'b) 70,000', 'c) 700', 'd) 700,000'], answer: 'b) 70,000' }, { ok: true }],
      [{ question: 'What is the place value of 7 in 573,018?', options: ['a) 7,000', 'b) 70,000', 'c) 700', 'd) 700,000'], answer: 'a) 7,000' }, { ok: false, passing: ['b'] }],
      [{ question: 'Find the value of the digit 3 in 1,234,567.', options: ['a) 30,000', 'b) 3,000', 'c) 300,000', 'd) 300'], answer: 'a) 30,000' }, { ok: true }],
      [{ question: 'Which place does the digit 5 have in 2,583,016?', options: ['a) Millions', 'b) Hundred thousands', 'c) Ten thousands', 'd) Thousands'], answer: 'b) Hundred thousands' }, { ok: true }],
      [{ question: 'Which place is the digit 9 in 2,395,140?', options: ['a) Thousands place', 'b) Ten thousands place', 'c) Hundred thousands place', 'd) Hundreds place'], answer: 'b) Ten thousands place' }, { ok: true }],
    ];
    for (const [item, want] of cases) expect([item.question, item.answer, mcqPropertyVerdict(item)]).toEqual([item.question, item.answer, want]);
  });

  it('a digit that appears twice → unchecked, never held', () => {
    const twice = { question: 'Which place is the digit 4 in 4,415,230?', options: ['a) Millions', 'b) Hundred thousands', 'c) Ten thousands', 'd) Thousands'], answer: 'a) Millions' };
    expect(mcqPropertyVerdict(twice)).toEqual({ ok: null });
    expect(mcqPropertyVerdict({ ...twice, question: 'What is the value of the digit 4 in 4,415,230?', options: ['a) 4,000,000', 'b) 400,000', 'c) 40,000', 'd) 4,000'] })).toEqual({ ok: null });
    expect(laidMaths(twice).gone).toBe(false);
  });

  it('a "which place" stem with number options, or a stem about a method, is unchecked', () => {
    expect(mcqPropertyVerdict({ question: 'Which place is the digit 9 in 2,395,140?', options: ['a) 9,000', 'b) 90,000', 'c) 900', 'd) 900,000'], answer: 'b) 90,000' })).toEqual({ ok: null });
    expect(mcqPropertyVerdict({ question: 'Which place is next to the thousands place?', options: ['a) Hundreds', 'b) Ten thousands', 'c) Tens', 'd) Ones'], answer: 'b) Ten thousands' })).toEqual({ ok: null });
  });
});

// ── 2. The scheme box line ─────────────────────────────────────────────────

describe('2. the before-the-exam box says what code wrote, in plain words', () => {
  const box = (html) => {
    const at = html.indexOf('<div class="box before">');
    return visible(html.slice(at, html.indexOf('</ol>', at)));
  };
  function sst(shortfall, medium = 'en') {
    const exam = clone(fixture('r7-sst-item-text'));
    exam._layout.medium = medium;
    if (shortfall !== undefined) exam._layout.scheme_shortfall = shortfall;
    return exam;
  }
  const schemeOf = (exam) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'social_studies' });
  const row = (item, part = null) => ({ slot: 'social_studies.A.Q1', item, part, filled_by: 'code' });

  it('two rows (EN)', () => {
    const text = box(schemeOf(sst([row(0), row(1)])));
    expect(text).toContain('2 marking rows were written from the answer. Check them before marking.');
    expect(text).not.toMatch(/filled by code/);
  });

  it('one row (EN)', () => {
    const text = box(schemeOf(sst([row(0)])));
    expect(text).toContain('1 marking row was written from the answer. Check it before marking.');
    expect(text).not.toMatch(/filled by code/);
  });

  it('Urdu, Urdu digits', () => {
    expect(box(schemeOf(sst([row(0)], 'ur')))).toContain('۱ مارکنگ قطار جواب سے لکھی گئی۔ نمبر دینے سے پہلے اسے جانچ لیں۔');
    expect(box(schemeOf(sst([row(0), row(1, 'a')], 'ur')))).toContain('۲ مارکنگ قطاریں جواب سے لکھی گئیں۔ نمبر دینے سے پہلے انہیں جانچ لیں۔');
  });

  it('no shortfall: the box carries no such line', () => {
    expect(box(schemeOf(sst(undefined)))).not.toMatch(/written from the answer|filled by code/);
  });
});
