'use strict';
/**
 * bd-s1oo0.46.3 (L27) — the oral maths bars live in scoring/thresholds.js with their evidence. A field below
 * its bar goes to the coach's end-of-visit review (L28); at or above it the AI's verdict stands. The bars
 * sit where every synthetic item scored at or above them agreed with the exact key (REPORT.md §4), and
 * every way the scorer can be unsure («اگلا» not said, a mishearing, a count) stays below them.
 */
const T = require('../../../bot/shared/services/child-test/scoring/thresholds');
const { CONF } = require('../../../bot/shared/services/child-test/scoring/maths-oral');

const FIELDS = ['maths.oral.compare', 'maths.oral.sums', 'maths.oral.word_problems'];

test('each oral maths field has a bar and the evidence for it', () => {
  for (const f of FIELDS) {
    expect(T.FIELD_BARS[f]).toBe(0.7);
    expect(T.BAR_EVIDENCE[f]).toMatch(/synthetic/i);
  }
});

test('confident verdicts clear the bar; unsure ones go to the coach', () => {
  for (const c of [CONF.compareOnly, CONF.compareBoth, CONF.compareSmaller, CONF.sumRight, CONF.sumRightReadAloud, CONF.noneNext]) {
    expect(T.prefill('maths.oral.compare', c)).toBe(true);
  }
  for (const c of [CONF.compareOther, CONF.sumWrong, CONF.misheard, CONF.counted, CONF.noneSilent, CONF.noneEmpty]) {
    expect(T.prefill('maths.oral.sums', c)).toBe(false);
  }
});
