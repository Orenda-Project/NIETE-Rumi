/**
 * FEAT-053 bd-23 — subject-knowledge flags: the MEWAKA analysis prompt gains
 * a subject_accuracy section (verbatim-quote gate, explicit-statements-only,
 * precision over recall — a false accusation poisons trust), and the debrief
 * guide includes a gentle joint-check line ONLY when high-confidence flags
 * exist. Never teacher-facing (D8).
 */

const mewaka = require('../../shared/services/coaching/frameworks/mewaka-framework');
const {
  buildGuidePrompt,
  buildFallbackGuide,
  validateGuide,
  SUBJECT_FLAG_MIN_CONFIDENCE,
} = require('../../shared/services/observe/observe-debrief-guide');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');

const V2_WITH_FLAGS = (confidence = 0.9) => ({
  framework: 'mewaka',
  strengths: [{ title_sw: 'Zana', evidence_sw: 'Alitumia vijiti' }],
  focus_area_sw: {
    indicator: 'C3.7', title_sw: 'Maswali ya kufikirisha',
    try_this_tomorrow_sw: 'Uliza "Umejuaje?"', lever_question_sw: 'Ungejuaje?',
  },
  subject_accuracy: [
    {
      concept: 'Mzunguko wa maji',
      quote: 'Mvua hutokana na mawingu kugongana',
      correct_idea: 'Mvua hutokana na mvuke wa maji kupoa na kuganda kuwa matone',
      confidence,
    },
  ],
});

describe('mewaka analysis prompt — subject_accuracy section (bd-23)', () => {
  const prompt = mewaka.buildAnalysisPrompt('transcript ya somo hapa', {});

  test('schema includes subject_accuracy with the required fields', () => {
    expect(prompt).toContain('subject_accuracy');
    for (const field of ['concept', 'quote', 'correct_idea', 'confidence']) {
      expect(prompt).toContain(`"${field}"`);
    }
  });

  test('states the verbatim + explicit-statement-only + precision gates', () => {
    expect(prompt).toMatch(/VERBATIM|neno-kwa-neno/i);
    expect(prompt).toMatch(/NEVER infer|usikisie|omission/i);
    expect(prompt).toMatch(/empty array|orodha tupu|\[\]/i);
  });

  test('computeScores is untouched by a subject_accuracy key (marks stay domain-only)', () => {
    const analysis = {
      domains: {
        introduction: { indicators: [{ id: 'A1.1', score: 2 }, { id: 'A1.2', score: 3 }] },
      },
      subject_accuracy: V2_WITH_FLAGS().subject_accuracy,
    };
    const scored = mewaka.computeScores(analysis);
    expect(scored.scores.overall_marks).toBe(5);
    expect(scored.subject_accuracy).toHaveLength(1); // survives untouched
  });
});

describe('debrief guide — gentle joint-check hook (bd-23)', () => {
  test('high-confidence flag → prompt carries the flag + sense-making framing', () => {
    const p = buildGuidePrompt(V2_WITH_FLAGS(0.9), { language: 'sw' });
    expect(p).toContain('Mvua hutokana na mawingu kugongana');       // the verbatim quote
    expect(p).toContain('mvuke wa maji');                            // the correct idea
    expect(p).toMatch(/pamoja|together/i);                           // joint-check framing
    expect(p).toMatch(/si mtihani|not a test|lawama|accus/i);        // never accusatory
  });

  test('no flags → no subject block in the prompt', () => {
    const v2 = V2_WITH_FLAGS();
    delete v2.subject_accuracy;
    const p = buildGuidePrompt(v2, { language: 'sw' });
    expect(p).not.toContain('Mvua hutokana');
  });

  test('low-confidence flags are dropped (precision over recall)', () => {
    const p = buildGuidePrompt(V2_WITH_FLAGS(0.4), { language: 'sw' });
    expect(p).not.toContain('Mvua hutokana');
  });

  test('threshold exported and sane', () => {
    expect(SUBJECT_FLAG_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.5);
    expect(SUBJECT_FLAG_MIN_CONFIDENCE).toBeLessThanOrEqual(0.95);
  });

  test('fallback guide with flags present stays valid and non-accusatory', () => {
    const g = buildFallbackGuide(V2_WITH_FLAGS(0.9), { language: 'sw' });
    expect(() => validateGuide(g, S)).not.toThrow();
  });
});
