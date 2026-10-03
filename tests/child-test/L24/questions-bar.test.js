'use strict';
/**
 * Child test L24 (bd-s1oo0.42), CR-1 — the Urdu questions bar goes 0.70 → 0.90 (accepted by L0).
 *
 * L23, all 185 May 2026 children (golive/lanes/L23/CHANGE_REQUEST.md): at 0.70, 98% of Urdu questions
 * arrived filled and 73% of those were right, which only equals the human floor (73% study-wide). At 0.90,
 * 55% arrive filled and 86% are right (n 92), 90% lower bound 79%, clear of the floor.
 */

const th = require('../../../bot/shared/services/child-test/scoring/thresholds');
const Bars = require('../../../bot/shared/services/child-test/check-flow/bars');

describe('CR-1: Urdu questions pre-fill at 0.90', () => {
  test('the Urdu bar is 0.90; English stays 0.90; the flat bar L6 reads stays 0.90', () => {
    expect(th.barFor('questions', 'urdu')).toBe(0.9);
    expect(th.barFor('questions', 'english')).toBe(0.9);
    expect(th.FIELD_BARS.questions).toBe(0.9);
  });

  test('an Urdu question at 0.80 now arrives empty; at 0.90 it is pre-selected (through the check Flow\'s reader)', () => {
    expect(th.prefill('questions', 0.8, { lang: 'urdu' })).toBe(false);
    expect(th.prefill('questions', 0.9, { lang: 'urdu' })).toBe(true);
    expect(Bars.confident('questions', 0.8, { lang: 'urdu' })).toBe(false);
    expect(Bars.confident('questions', 0.92, { lang: 'urdu' })).toBe(true);
  });

  test('the evidence string carries L23\'s numbers', () => {
    expect(th.BAR_EVIDENCE.questions).toMatch(/86% \(n 92\)/);
    expect(th.BAR_EVIDENCE.questions).toMatch(/L23/);
  });
});
