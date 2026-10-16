/**
 * Second-round probes on the unit-conversion guard in maths-check `checkWorking`. Pure chain: applyLayout → normaliseScheme → mathsCheck.
 * Fictional fixtures only.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');

const P = Patterns.get('fde_g5_2027').subjects;
const NOW = '2026-10-20T07:12:00.000Z';
const FDE = { kind: 'fde', chapters: null, pages: null };
let n = 0;

// Up to six keys per run: the slot takes only so many word problems.
function checked(keys) {
  const items = keys.map((answer) => ({ slot: 'maths.B.Q2', question: `Shop problem ${(n += 1)}: how much?`, answer, blooms: 'Apply' }));
  const raw = { unseen: { subjective: { 'Word Problems': items } } };
  const laid = applyLayout(raw, P.maths, FDE, { now: NOW });
  const mc = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' });
  const out = Object.values(mc.examJson.unseen.subjective).flat();
  return items.map((it) => out.find((q) => q.question === it.question));
}
function untouched(keys) {
  const out = checked(keys);
  out.forEach((q, i) => {
    expect([keys[i], q && q.answer]).toEqual([keys[i], keys[i]]);
    expect([keys[i], q.scheme.checked]).not.toEqual([keys[i], 'replaced']);
  });
  return out;
}

describe('maths-check: the conversion guard', () => {
  it('a conversion after a bare restated stage is never rewritten: grouping, label, stop, case, glued unit, brackets', () => {
    untouched(['4 × 250 = 1,000 = 1 kg', 'Total: 4 × 250 = 1000 = 1 kg', '4 × 250 = 1000 = 1 kg.', '4 × 250 = 1000 = 1 Kg', '4 × 250 = 1000 = 1kg', '(4 × 250) = 1000 = 1 kg']);
  });

  it('a two-step conversion and a result in a second unit are never rewritten', () => {
    untouched(['3.5 × 2 = 7 = 7 days = 1 week', '4 × 250 = 1000 = 1 kg = 1000 g', '500 × 2 = 1000 = 1 kg = 1000 g', '2 × 1.5 = 3 = 3000 m', '15 × 4 = 60 = 1 hour 0 minutes', '150 ÷ 60 = 2.5 = 2 hours 30 minutes']);
  });

  it('a restated stage whose result repeats it with a unit is ok; a sum stage with the unit is still checked', () => {
    const [a, b, c, d] = checked(['60 ÷ 12 = 5 = 5 hours', '1000 ÷ 4 = 250 = 250 g', '2 × 3 = 6 = 6 m', '7 × 8 = 54 pencils']);
    expect([a.scheme.checked, b.scheme.checked, c.scheme.checked]).toEqual(['ok', 'ok', 'ok']);
    expect([d.scheme.checked, d.answer]).toEqual(['replaced', '7 × 8 = 56 pencils']);
  });

  it('a wrong conversion is left as written, never "corrected" to the pre-conversion number', () => {
    const out = untouched(['4 × 250 = 1000 = 10 kg', '45 + 15 = 60 = 2 hours', '2 × 3 = 7 = 7 m', '2 × 3 = 6 = 7 m']);
    out.forEach((q) => expect(q.scheme.checked).toBe(null));
  });

  it('Urdu-digit working is never read as a sum', () => {
    untouched(['۴ × ۲۵۰ = ۱۰۰۰ = ۱ کلوگرام', '4 × 250 = 1000 = 1 کلوگرام']);
  });

  // A second pass keeps the first verdict, so the "corrected by code" mark survives a re-check.
  it('a second mathsCheck pass changes nothing (idempotent on ok, replaced and null)', () => {
    const keys = ['7 × 8 = 54 pencils', '4 × 250 = 1000 = 1 kg', '52.8 ÷ 1.2 = 44'];
    const items = keys.map((answer) => ({ slot: 'maths.B.Q2', question: `Shop problem ${(n += 1)}: how much?`, answer, blooms: 'Apply' }));
    const laid = applyLayout({ unseen: { subjective: { 'Word Problems': items } } }, P.maths, FDE, { now: NOW });
    const once = mathsCheck(normaliseScheme(laid.examJson).examJson, { subject: 'maths' }).examJson;
    const twice = mathsCheck(JSON.parse(JSON.stringify(once)), { subject: 'maths' }).examJson;
    expect(twice).toEqual(once);
  });

  // A bare restated stage followed by a different number is a conversion, whatever word follows.
  it('a conversion into a unit the checker does not list is never rewritten either', () => {
    untouched(['3 × 12 = 36 = 3 dozen', '4 × 250 = 1000 = 1 tonne', '2 × 500 = 1000 = 1 mg', '3 × 90 = 270 = 3 right angles', '5 × 2 = 10 = 1 decade', '4 × 250 = 1000 = 1 thousand']);
  });
});
