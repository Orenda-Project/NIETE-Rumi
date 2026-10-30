/**
 * bd-5jmnfj.33.8.1, v42 layout verify: `.slot.short` (break-inside: avoid) keeps a short slot whole.
 * A slot taller than a page cannot be kept whole: G3 GK Q5 (three long answers, 68 mm boxes) jumped
 * to a fresh page, split there anyway, and left pages 4 and 5 mostly empty. A written slot is marked
 * short only when its estimated height fits the page budget.
 * Pure: HTML strings, no browser.
 */
const Fit = require('../../bot/shared/services/assessment/fde-slot-fit');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const gk = require('./fixtures/mid/g3-general_knowledge-ch3-exam.json');

// Calibrated on the v42 sandbox renders: G4 Maths Q3 (four 52 mm boxes) and Q5 (three 68 mm boxes,
// one-line English stems) fit one page; G3 GK Q5 (three 68 mm boxes, two-line Urdu stems) and G4
// Science Q5 (four 68 mm boxes) do not.
const LONG_UR = 'گھر، اسکول، محلے اور بازار میں اختلاف رائے کی ایک مثال ترتیب سے لکھیں، جس میں بتائیں کہ اختلاف کرنے والے دونوں افراد کیا چاہتے تھے۔';
const SHORT_UR = 'مسئلے کے حل کے پانچ قدم ترتیب سے لکھیں۔';
const EN = 'Divide 5,837 by 8. Write the quotient and the remainder.';

describe('writeSlotFits', () => {
  test('three 68 mm boxes under two-line Urdu stems do not fit one page (G3 GK Q5)', () => {
    expect(Fit.writeSlotFits({ stems: [SHORT_UR, LONG_UR, LONG_UR], boxMm: 68, ur: true })).toBe(false);
  });
  test('three 68 mm boxes under one-line English stems fit one page (G4 Maths Q5)', () => {
    expect(Fit.writeSlotFits({ stems: [EN, EN, EN], boxMm: 68 })).toBe(true);
  });
  test('four 52 mm boxes under one-line English stems fit one page (G4 Maths Q3)', () => {
    expect(Fit.writeSlotFits({ stems: [EN, EN, EN, EN], boxMm: 52 })).toBe(true);
  });
  test('four 68 mm boxes do not fit one page (G4 Science Q5)', () => {
    expect(Fit.writeSlotFits({ stems: [EN, EN, EN, EN], boxMm: 68 })).toBe(false);
  });
  test('five one-line items with no box fit one page', () => {
    expect(Fit.writeSlotFits({ stems: [EN, EN, EN, EN, EN], boxMm: 0 })).toBe(true);
  });
});

describe('G3 GK paper', () => {
  const html = R.renderPaper({ examJson: gk, grade: 3, subject: 'general_knowledge' });
  const slots = html.split(/(?=<div class="slot[ "])/).slice(1).map((s) => s.slice(0, s.indexOf('>') + 1));

  test('Q5 (three long answers) is not marked short, so it does not jump to a fresh page', () => {
    expect(slots[slots.length - 1]).toBe('<div class="slot">');
  });
  test('Q1 (five MCQs) stays short and moves whole', () => {
    expect(slots[0]).toBe('<div class="slot short">');
  });
});
