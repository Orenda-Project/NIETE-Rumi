/**
 * FEAT-053 bd-22 — the debrief-guide builder (pure layer: prompt, validation,
 * render, deterministic fallback).
 *
 * The script structure + gates come from the research pass:
 * Observe Build/DEBRIEF_GUIDE_DESIGN.md §3 (6 steps, D25/D27) — verbatim
 * evidence, exactly ONE improvement, score-free, ≤35-word open questions,
 * no "could you have done better" form (World Bank TZ CPD finding),
 * "takriban dakika N" never "karibu dakika N" (Aloyce), moves-not-teacher.
 */

const {
  buildGuidePrompt,
  validateGuide,
  renderGuideMessage,
  buildFallbackGuide,
  GUIDE_CHAR_BUDGET,
} = require('../../shared/services/observe/observe-debrief-guide');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');

// Faithful v2 shape (mewaka-framework buildAnalysisPrompt schema + computeScores)
const V2 = () => ({
  framework: 'mewaka',
  language: 'sw',
  domains: {
    teaching_methods: {
      indicators: [
        { id: 'C3.7', score: 1, evidence_sw: 'Mwalimu aliuliza maswali ya kukariri tu', improvement_sw: 'Ongeza maswali ya kufikirisha' },
      ],
      domain_score: 9, domain_max: 21,
    },
  },
  strengths: [
    { title_sw: 'Matumizi ya zana halisi', evidence_sw: 'Alitumia vijiti kufundisha kujumlisha — watoto walishika vijiti wenyewe', anchor_indicator: 'B2.4' },
  ],
  growth_opportunities: [
    { area_sw: 'Maswali ya kufikirisha', rationale_sw: 'Maswali mengi yalikuwa ya kukariri', strategies_sw: ['Uliza "kwa nini"'] },
  ],
  focus_area_sw: {
    domain: 'teaching_methods',
    indicator: 'C3.7',
    title_sw: 'Maswali ya kufikirisha',
    rationale_sw: 'Wanafunzi hawakupata nafasi ya kueleza mawazo yao',
    try_this_tomorrow_sw: 'Baada ya kila jibu, uliza "Umejuaje?" na usubiri sekunde tatu',
    lever_question_sw: 'Ungejuaje kama wanafunzi wameelewa kweli?',
  },
  executive_summary_sw: 'Somo lilikuwa na mpangilio mzuri.',
  notable_moments: [
    { timestamp: '12:40', quote: 'Nani anaweza kunieleza kwa nini?', significance_sw: 'Swali la kufikirisha la pekee' },
  ],
  scores: { overall_marks: 40, overall_max_marks: 75, overall_percentage: 53.3 },
});

const goodGuide = () => ({
  intro: 'Mwongozo wa mazungumzo yako na mwalimu — dakika 15 hivi.',
  steps: [
    { n: 1, title: 'Fungua kwa nia', body: 'Mshukuru kwa kukukaribisha darasani.', say_this: 'Asante kwa kunikaribisha — lengo langu ni tusaidiane kwa ajili ya watoto.' },
    { n: 2, title: 'Sifa yenye ushahidi', body: 'Taja jambo moja la kweli.', say_this: 'Nilipenda ulivyotumia vijiti — watoto walishika vijiti wenyewe.' },
    { n: 3, title: 'Swali, kisha subira', body: 'Uliza, kisha subiri kimya sekunde 30-60.', say_this: 'Wewe mwenyewe, unaonaje somo lilikwendaje?' },
    { n: 4, title: 'Jambo MOJA', body: 'Pendekeza jaribio moja tu.', say_this: 'Vipi kesho, baada ya kila jibu, ukiuliza "Umejuaje?" na kusubiri sekunde tatu?' },
    { n: 5, title: 'Ahadi ya kama–basi', body: 'Mwombe aseme mpango kwa maneno yake.', say_this: 'Kesho, wakati gani utajaribu hili? Sema kwa maneno yako.' },
    { n: 6, title: 'Panga kurejea', body: 'Kubalianeni lini mtaangalia pamoja.', say_this: 'Nirudi Alhamisi tuone pamoja?' },
  ],
  outro: 'Hakuna namba ya kumpa — sifa moja ya kweli na jaribio moja tu. 💛',
});

describe('buildGuidePrompt', () => {
  test('carries the v2 evidence the guide must quote', () => {
    const p = buildGuidePrompt(V2(), { language: 'sw' });
    expect(p).toContain('vijiti');                                   // strength evidence
    expect(p).toContain('Maswali ya kufikirisha');                   // focus title
    expect(p).toContain('Umejuaje?');                                // try_this
    expect(p).toContain('Ungejuaje kama wanafunzi wameelewa kweli'); // lever question
    expect(p).toContain('Nani anaweza kunieleza kwa nini?');         // notable moment quote
  });

  test('contains the research gates as prompt rules', () => {
    const p = buildGuidePrompt(V2(), { language: 'sw' });
    expect(p).toMatch(/35/);                          // ≤35-word question gate
    expect(p).toMatch(/MOJA|ONE/);                    // one-improvement gate
    expect(p).toMatch(/takriban dakika/);             // Aloyce's phrasing rule
    expect(p).toMatch(/karibu dakika/);               // named as the FORBIDDEN form
    expect(p).toMatch(/alama|score|asilimia/i);       // score ban stated
    expect(p).toMatch(/could you have done better|ungeweza kufanya vizuri zaidi/i); // banned form named
  });

  test('never leaks numeric scores into the prompt data block', () => {
    const p = buildGuidePrompt(V2(), { language: 'sw' });
    expect(p).not.toMatch(/53\.3|40\s*\/\s*75|overall_percentage/);
  });

  test('previous-visit focus appears only when provided (cross-session closure)', () => {
    const without = buildGuidePrompt(V2(), { language: 'sw' });
    const withPrev = buildGuidePrompt(V2(), {
      language: 'sw',
      previousFocus: { title_sw: 'Ushirikishwaji wa wanafunzi', try_this_tomorrow_sw: 'Wape wanafunzi kazi za vikundi' },
    });
    expect(without).not.toContain('Ushirikishwaji wa wanafunzi');
    expect(withPrev).toContain('Ushirikishwaji wa wanafunzi');
  });

  test('asks for JSON (json_object mode requires the word)', () => {
    expect(buildGuidePrompt(V2(), { language: 'sw' })).toMatch(/JSON/);
  });
});

describe('validateGuide', () => {
  test('accepts a well-formed guide', () => {
    expect(() => validateGuide(goodGuide(), S)).not.toThrow();
  });

  test('rejects wrong step count', () => {
    const g = goodGuide();
    g.steps.pop();
    expect(() => validateGuide(g, S)).toThrow(/steps/i);
  });

  test('rejects score leakage (x/y, percent, alama N)', () => {
    for (const leak of ['Alipata 40/75 leo', 'asilimia 53', 'alama 40', '53% ya wanafunzi']) {
      const g = goodGuide();
      g.steps[3].body = leak;
      expect(() => validateGuide(g, S)).toThrow(/score/i);
    }
  });

  test('does NOT reject legitimate numbers (minutes, seconds, timestamps)', () => {
    const g = goodGuide();
    g.steps[1].say_this = 'Takriban dakika 12:40, uliuliza "kwa nini?" — sekunde 3 za kimya zilifuata.';
    expect(() => validateGuide(g, S)).not.toThrow();
  });

  test('rejects a rendered guide over the char budget', () => {
    const g = goodGuide();
    g.steps[3].body = 'x'.repeat(GUIDE_CHAR_BUDGET + 10);
    expect(() => validateGuide(g, S)).toThrow(/budget|length/i);
  });
});

describe('renderGuideMessage', () => {
  test('numbered steps with bold titles and quoted say-this lines, intro+outro present', () => {
    const msg = renderGuideMessage(goodGuide(), S);
    expect(msg).toContain('Mwongozo');
    for (let i = 1; i <= 6; i += 1) expect(msg).toContain(`${i}️⃣`);
    expect(msg).toMatch(/\*Fungua kwa nia\*/);
    expect(msg).toMatch(/_.*Asante kwa kunikaribisha.*_/);
    expect(msg).toContain('Hakuna namba');
    expect(msg.length).toBeLessThanOrEqual(GUIDE_CHAR_BUDGET);
  });
});

describe('buildFallbackGuide (deterministic, no LLM)', () => {
  test('produces a valid guide straight from v2 fields', () => {
    const g = buildFallbackGuide(V2(), { language: 'sw' });
    expect(() => validateGuide(g, S)).not.toThrow();
    expect(g.steps).toHaveLength(6);
    const all = JSON.stringify(g);
    expect(all).toContain('vijiti');                       // strength evidence quoted
    expect(all).toContain('Umejuaje?');                    // try_this in step 4
    expect(all).toContain('Ungejuaje kama wanafunzi');     // lever question reused
    expect(all).not.toMatch(/40\s*\/\s*75|53|asilimia/);   // score-free
  });

  test('handles a threadbare v2 without crashing (defensive like production prompt)', () => {
    const g = buildFallbackGuide({ framework: 'mewaka' }, { language: 'sw' });
    expect(() => validateGuide(g, S)).not.toThrow();
    expect(g.steps).toHaveLength(6);
  });

  test('english scaffold for en-preference FO', () => {
    const g = buildFallbackGuide(V2(), { language: 'en' });
    expect(JSON.stringify(g)).toMatch(/thank|one thing|together/i);
  });

  // review fix #6/#16: the fallback interpolates model-authored v2 text that
  // can carry score fragments — it must still pass validateGuide's gates.
  test('sanitizes score-shaped fragments in interpolated v2 evidence', () => {
    const dirty = V2();
    dirty.strengths[0].evidence_sw = 'Alifundisha vizuri — alama 3/3 kwa ushirikishwaji, 85% ya wanafunzi walijibu';
    dirty.focus_area_sw.try_this_tomorrow_sw = 'Fikia asilimia 90 kesho';
    const g = buildFallbackGuide(dirty, { language: 'sw' });
    expect(() => validateGuide(g, S)).not.toThrow();   // gates pass despite dirty input
    const all = JSON.stringify(g);
    expect(all).not.toMatch(/3\s*\/\s*3|85\s*%|asilimia 90/);
  });

  test('over-long v2 evidence cannot blow the char budget (fallback stays valid)', () => {
    const huge = V2();
    huge.strengths[0].evidence_sw = 'x'.repeat(5000);
    huge.focus_area_sw.try_this_tomorrow_sw = 'y'.repeat(5000);
    const g = buildFallbackGuide(huge, { language: 'sw' });
    expect(() => validateGuide(g, S)).not.toThrow();
  });
});

describe('buildGuidePrompt score-derived field redaction (review fix #5)', () => {
  test('performance_band (a verdict label) is stripped from the prompt data block', () => {
    const withBand = { ...V2(), performance_band: 'bora_sana', scores: { overall_marks: 68 } };
    const p = buildGuidePrompt(withBand, { language: 'sw' });
    expect(p).not.toContain('bora_sana');
    expect(p).not.toContain('performance_band');
    expect(p).not.toContain('overall_marks');
  });

  test('observer_edit_summary and observer_debrief are not fed to the guide prompt', () => {
    const withExtras = {
      ...V2(),
      observer_edit_summary: { indicators_rescored: 4 },
      observer_debrief: { transcript: 'FO said something', feedback: {} },
    };
    const p = buildGuidePrompt(withExtras, { language: 'sw' });
    expect(p).not.toContain('observer_edit_summary');
    expect(p).not.toContain('observer_debrief');
    expect(p).not.toContain('FO said something');
  });
});
