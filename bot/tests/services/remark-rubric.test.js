/**
 * bd-2531 — STEPS "S" rubric object (design spec Appendix A).
 *
 * The rubric is the SINGLE source of truth for the form, the scoring, the
 * export column names, and the narrative prompt. Appendix A is "finalized for
 * now… may revise. This version supersedes the 7- and 10-indicator drafts" —
 * it has already changed twice, so these tests pin the CONTRACT (shape, scale,
 * math, language completeness) rather than transcribing every anchor string.
 *
 * Rule 20 (language is data): en + ur must BOTH be complete. A partial map
 * silently degrades a principal to English — the exact bug the rule exists for.
 */
const {
  INDICATORS,
  SCALE,
  MAX_SCORE,
  getIndicator,
  getAnchor,
  computeS,
  isComplete,
} = require('../../shared/services/remark/remark-rubric');

describe('bd-2531 — rubric shape (Appendix A)', () => {
  test('exactly 5 indicators, ordinals 1..5 in order', () => {
    expect(INDICATORS).toHaveLength(5);
    expect(INDICATORS.map((i) => i.ordinal)).toEqual([1, 2, 3, 4, 5]);
  });

  test('export keys match the STEPS sub-score column names', () => {
    // The design spec's supervisor_remarks columns. STEPS consumes these names,
    // so they are a published contract — renaming one breaks the export.
    expect(INDICATORS.map((i) => i.key)).toEqual([
      'score_growth',
      'score_collaboration',
      'score_leadership',
      'score_student_support',
      'score_parents',
    ]);
  });

  test('the scale is 4=Exemplary … 1=Needs Improvement', () => {
    expect(Object.keys(SCALE).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect(SCALE[4].en).toMatch(/exemplary/i);
    expect(SCALE[1].en).toMatch(/needs improvement/i);
  });

  test('MAX_SCORE is 20 (5 indicators x 4)', () => {
    expect(MAX_SCORE).toBe(20);
  });
});

describe('bd-2531 — every indicator is complete in BOTH languages (Rule 20)', () => {
  test.each([1, 2, 3, 4, 5])('indicator %i has en + ur name and 4 anchors each', (ordinal) => {
    const ind = getIndicator(ordinal);
    for (const lang of ['en', 'ur']) {
      expect(typeof ind.name[lang]).toBe('string');
      expect(ind.name[lang].length).toBeGreaterThan(0);
      for (const level of [1, 2, 3, 4]) {
        const anchor = ind.anchors[level][lang];
        expect(typeof anchor).toBe('string');
        expect(anchor.length).toBeGreaterThan(0);
      }
    }
  });

  test('the Urdu anchors are actually Urdu, not English placeholders', () => {
    // A copy-paste that leaves English in the ur slot passes a length check but
    // ships an English form to an Urdu-speaking principal. Require Arabic-script.
    const arabicScript = /[؀-ۿ]/;
    for (const ind of INDICATORS) {
      expect(ind.name.ur).toMatch(arabicScript);
      for (const level of [1, 2, 3, 4]) {
        expect(ind.anchors[level].ur).toMatch(arabicScript);
      }
    }
  });

  test('the English anchors carry no Arabic script (no cross-contamination)', () => {
    const arabicScript = /[؀-ۿ]/;
    for (const ind of INDICATORS) {
      expect(ind.name.en).not.toMatch(arabicScript);
      for (const level of [1, 2, 3, 4]) {
        expect(ind.anchors[level].en).not.toMatch(arabicScript);
      }
    }
  });
});

describe('bd-2531 — getAnchor', () => {
  test('returns the requested language anchor', () => {
    expect(getAnchor(1, 4, 'en')).toBe(getIndicator(1).anchors[4].en);
    expect(getAnchor(1, 4, 'ur')).toBe(getIndicator(1).anchors[4].ur);
  });

  test('an unsupported language falls back to English, never to undefined', () => {
    // English is the deliberate floor (Rule 20) — a Swahili principal on this
    // ICT-only feature must still see words, not "undefined".
    expect(getAnchor(2, 3, 'sw')).toBe(getIndicator(2).anchors[3].en);
  });

  test('an out-of-range ordinal or level throws rather than returning garbage', () => {
    expect(() => getAnchor(6, 1, 'en')).toThrow();
    expect(() => getAnchor(1, 5, 'en')).toThrow();
    expect(() => getAnchor(1, 0, 'en')).toThrow();
  });
});

describe('bd-2531 — computeS / S_pct math (design spec §12 boundaries)', () => {
  const all = (n) => [1, 2, 3, 4, 5].map((ordinal) => ({ ordinal, score: n }));

  test('all-4 -> 20/20 -> 100.0', () => {
    expect(computeS(all(4))).toEqual({ s_score: 20, s_pct: 100.0 });
  });

  test('all-1 -> 5/20 -> 25.0 (the floor is 25, NOT 0)', () => {
    // A teacher scored 1 across the board still contributes 25% of the S
    // dimension. Anyone assuming a 0..100 range starting at 0 is wrong.
    expect(computeS(all(1))).toEqual({ s_score: 5, s_pct: 25.0 });
  });

  test('all-3 -> 15/20 -> 75.0', () => {
    expect(computeS(all(3))).toEqual({ s_score: 15, s_pct: 75.0 });
  });

  test('mixed 4,3,3,2,1 -> 13/20 -> 65.0', () => {
    expect(computeS([
      { ordinal: 1, score: 4 }, { ordinal: 2, score: 3 }, { ordinal: 3, score: 3 },
      { ordinal: 4, score: 2 }, { ordinal: 5, score: 1 },
    ])).toEqual({ s_score: 13, s_pct: 65.0 });
  });

  test('a non-terminating percentage is rounded to 1dp', () => {
    // 14/20 = 70.0 exactly; 11/20 = 55.0. The /20 denominator always lands on
    // a .0 or .5 — assert the contract holds so a future denominator change
    // (a rubric revision!) surfaces here rather than in BigQuery.
    expect(computeS([
      { ordinal: 1, score: 3 }, { ordinal: 2, score: 3 }, { ordinal: 3, score: 2 },
      { ordinal: 4, score: 2 }, { ordinal: 5, score: 1 },
    ])).toEqual({ s_score: 11, s_pct: 55.0 });
  });

  test('an INCOMPLETE rubric refuses to score', () => {
    // The dangerous case: 3 of 5 answered summing to 12 would look like 60%.
    // A partial must never produce a number — it must produce nothing.
    expect(() => computeS(all(4).slice(0, 3))).toThrow(/incomplete/i);
  });

  test('a duplicate ordinal refuses to score', () => {
    const dupes = [
      { ordinal: 1, score: 4 }, { ordinal: 1, score: 4 }, { ordinal: 3, score: 4 },
      { ordinal: 4, score: 4 }, { ordinal: 5, score: 4 },
    ];
    expect(() => computeS(dupes)).toThrow(/duplicate|incomplete/i);
  });

  test('an out-of-range score refuses to score', () => {
    const bad = all(4);
    bad[2].score = 5;
    expect(() => computeS(bad)).toThrow(/score/i);
  });
});

describe('bd-2531 — isComplete', () => {
  test('true only when all five distinct ordinals are present', () => {
    const all4 = [1, 2, 3, 4, 5].map((ordinal) => ({ ordinal, score: 4 }));
    expect(isComplete(all4)).toBe(true);
    expect(isComplete(all4.slice(0, 4))).toBe(false);
    expect(isComplete([])).toBe(false);
    expect(isComplete(null)).toBe(false);
  });
});
