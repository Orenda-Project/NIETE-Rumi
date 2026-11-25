'use strict';
/**
 * Queue #282 (bd-ra8xu.64.1) — the teacher's own DC report on FICO17 v6 with the 11 only, end to end on the report path.
 * The reader audit (work folder outputs/reader-audit.md, must-fix 2, 4, 5) found what a dc11 analysis would get wrong:
 *
 *   0/0 sections   a section whose rows are all "couldn't tell" (easy now: "What the children do" is D1 and D5 only) was
 *                  drawn "0/0" over an empty bar, and all 11 IE gave a "0%" headline. Now: the section reads "not
 *                  assessed" and names its IE rows once; with no level anywhere there is no headline.
 *   V3 in prompts  the reflection pass and the voice note serialised the whole analysis, V3 (v3_fico) included, so her
 *                  strengths, summary and voice note could come from V3. Now neither prompt sees v3_fico, dc, shadow or
 *                  combined_evidence, the voice is told the v6 strength and next step, and no V3-based debrief totals
 *                  are added to v6 scores.
 *   generic card   with no reflective answer (about half of teachers) the "one thing to try" fell to the canned template
 *                  ("try dedicating 5 minutes ..."), because v6 has no scorer-written move. Now a v6 target is phrased
 *                  by the card model, told the rubric's next level.
 *   narrative      the v6 narrative prompt names 17 indicators; for a dc11 report it lists the 11 only.
 *   subject note   the "subject not confirmed" note now reaches the v6 subject section too.
 */

jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => {
    const b = { select: () => b, eq: () => b, neq: () => b, then: (r) => r({ count: 2, error: null }) };
    return b;
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logEvent: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const SIX = ['C3', 'C5', 'C7', 'D2', 'D3', 'D4'];
const IE_LINE = "The recording didn't cover this part of the lesson.";
const TRANSCRIPT = '[00:10] Teacher (ur): Ali, what is half of ten?\n[00:15] Student (ur): Five.\n[30:00] Student (ur): I agree.';

/** A dc11 report analysis: levels as given (default 3), V3 kept under v3_fico as analysis-processor writes it. */
function dc11Analysis(levels = {}) {
  const lv = {};
  for (const c of v6.DC_CODES) {
    const r = levels[c] !== undefined ? levels[c] : 3;
    lv[c] = { result: r, because: `because ${c}`, evidence: r === 'IE' ? [] : [{ time: '00:15', quote: 'Five.' }] };
  }
  const a = fw.dc11Variant().computeScores({ levels: lv, topic: 'Halves', subject: 'maths' }, false);
  return {
    ...a,
    framework: 'fico17_v6',
    v3_fico: { framework: 'fico', marker: 'V3-ONLY-MARKER', strengths: [{ title: 'V3 strength marker' }], scores: { overall_marks: 90, overall_max_marks: 140 } },
    dc: { fico17_v6: { status: 'ok', marker: 'RAW-BLOB-MARKER' } },
  };
}

describe('0/0 sections and the headline', () => {
  const { buildFico17V6Groups } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico17-v6-adapter');

  test('a section whose rows are all IE is not assessed, never 0/0', () => {
    const groups = buildFico17V6Groups(dc11Analysis({ D1: 'IE', D5: 'IE' }), 'en');
    const d = groups.find((g) => g.key === 'D');
    expect(d.notAssessed).toBe(true);
    expect(d.score).toBeNull();
    expect(d.max).toBeNull();
    const c = groups.find((g) => g.key === 'C');
    expect(c.notAssessed).toBeFalsy();
    expect(c.max).toBe(20);
  });

  test('dcV6HeroRows: each IE row said once by name on its section; all-IE section not assessed', () => {
    const { dcV6HeroRows } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const a = dc11Analysis({ D1: 'IE', D5: 'IE', F2: 'IE' });
    const groups = buildFico17V6Groups(a, 'en');
    const out = dcV6HeroRows(groups, a, 'en');
    expect(out).toEqual(expect.objectContaining({ noLevels: false }));
    const d = groups.find((g) => g.key === 'D');
    expect(d.notAssessed).toBe(true);
    expect(d.why).toContain(`${v6.indicator('D1').name}: ${IE_LINE}`);
    const f = groups.find((g) => g.key === 'F');
    expect(f.notAssessed).toBeFalsy();
    expect(f.why.split(IE_LINE).length - 1).toBe(1);
  });

  test('all 11 IE: no level anywhere, so no headline', () => {
    const { dcV6HeroRows } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const all = Object.fromEntries(v6.DC_CODES.map((c) => [c, 'IE']));
    const a = dc11Analysis(all);
    const groups = buildFico17V6Groups(a, 'en');
    expect(dcV6HeroRows(groups, a, 'en').noLevels).toBe(true);
  });

  test('a V3 analysis is not touched by dcV6HeroRows', () => {
    const { dcV6HeroRows } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    expect(dcV6HeroRows([{ key: 'C', why: 'x' }], { framework: 'fico', scores: {} }, 'en')).toBeNull();
  });

  test('the subject-not-confirmed note reaches the v6 subject section', () => {
    const { attachSubjectNote } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const { subjectUnconfirmedNote } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
    const groups = [{ key: 'F', domainKey: 'v6_subject', why: 'ok.' }];
    attachSubjectNote(groups, { subject_resolution: { confidence: 'none' } }, 'en');
    expect(groups[0].why).toContain(subjectUnconfirmedNote('en'));
  });
});

describe('V3 never reaches the model through the reflection pass or the voice note', () => {
  const G = require('../../bot/shared/services/gpt5-mini.service');

  test('the reflection prompt carries the v6 analysis without v3_fico, dc, shadow or combined_evidence', async () => {
    let seen = '';
    const real = G.openai;
    G.openai = { chat: { completions: { create: jest.fn(async (req) => {
      seen = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      return { choices: [{ message: { content: JSON.stringify({ executive_summary: 'new', debrief_reflection: {} }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    }) } } };
    try {
      const a = dc11Analysis();
      const out = await G.enhanceAnalysisWithReflections(a, TRANSCRIPT, { questions: [{ question_number: 1, question: 'Q?', answer: 'An answer.' }] }, {}, 'u1', 's1');
      expect(seen).toContain('"indicator_set": "dc11"');
      expect(seen).not.toMatch(/V3-ONLY-MARKER|RAW-BLOB-MARKER|v3_fico/);
      // V3 is still kept on the stored analysis, and no V3-based debrief totals land on v6 scores.
      expect(out.v3_fico.marker).toBe('V3-ONLY-MARKER');
      expect(out.scores.rubric).toBe('fico17_v6');
      expect(out.scores.grand_total).toBeUndefined();
      expect(out.scores.percentage_with_debrief).toBeUndefined();
      expect(a.scores.grand_total).toBeUndefined();
    } finally {
      G.openai = real;
    }
  });

  test('the voice note sees no V3 and is told the v6 strength and next step', () => {
    const R = require('../../bot/shared/services/coaching/report-generator.service');
    const a = dc11Analysis({ C4: 1, F1: 4 });
    const { analysis } = R._projectAnalysisForVoice(a);
    const dump = JSON.stringify(analysis);
    expect(dump).not.toMatch(/V3-ONLY-MARKER|RAW-BLOB-MARKER|v3_fico/);
    expect(analysis.voice_focus).toEqual(expect.objectContaining({
      strength: expect.stringContaining(v6.indicator('F1').name),
      next_step: expect.stringContaining(v6.indicator('C4').name),
    }));
    // A V3 analysis is projected as before (no voice_focus).
    expect(R._projectAnalysisForVoice({ framework: 'fico', domains: {} }).analysis.voice_focus).toBeUndefined();
  });
});

describe('"one thing to try" with no reflective answer', () => {
  test('a v6 target is phrased by the card model (told the next level), not the canned template', async () => {
    const G = require('../../bot/shared/services/gpt5-mini.service');
    let prompt = '';
    const real = G.openai;
    G.openai = { chat: { completions: { create: jest.fn(async (req) => {
      prompt = req.messages[0].content;
      return { choices: [{ message: { content: JSON.stringify({ commitment: 'We value children choosing.', action: 'Next class, when you start the reading, let the children choose which picture to talk about first.', lesson_label: 'Urdu', highlights: ['picture'] }) } }] };
    }) } } };
    try {
      const { generateCommitmentCard } = require('../../bot/shared/services/coaching/coaching-card/commitment-card.service');
      const a = dc11Analysis({ C4: 1, F1: 4 });
      const card = await generateCommitmentCard(a, { questions: [] }, 'en', { teacherName: 'T' });
      expect(card._source).toBe('llm');
      expect(card.indicator).toBe('C4');
      expect(prompt).toContain(v6.indicator('C4').name);
      expect(prompt).toMatch(/next level on the rubric asks/i);
      expect(prompt).not.toMatch(/V3-ONLY-MARKER|V3 strength marker/);
      // Her strength comes from the v6 levels when the reflection pass wrote none.
      expect(prompt).toContain(v6.indicator('F1').name);
    } finally {
      G.openai = real;
    }
  });
});

describe('the v6 narrative prompt for a dc11 report names the 11 only', () => {
  test('11 indicators; none of the six by name', () => {
    const N = require('../../bot/shared/services/coaching/report-v2/narrative.service');
    const build = N._buildV6Prompt || N.buildV6Prompt;
    expect(typeof build).toBe('function');
    const p = build(dc11Analysis(), { transcript: TRANSCRIPT, language: 'en', teacherName: 'T' });
    expect(p).toMatch(/11 indicators/);
    expect(p).not.toMatch(/17 indicators/);
    for (const c of SIX) expect(p).not.toContain(v6.indicator(c).name);
  });
});

describe('a lesson plan linked later regrades a v6 lesson\'s plan section', () => {
  test('fico17_v6: lp_fidelity is recomputed and written; the V3 Section B writer never touches the v6 analysis', async () => {
    jest.doMock('../../bot/shared/services/coaching/fidelity/fidelity-orchestrator', () => ({
      resolveFidelitySources: () => ({ corpusKey: 'grade_3_maths_ch1_seg1', uploadedText: null, meta: {} }),
      planKeyOf: () => null,
    }));
    const { recomputeFidelityForSession } = require('../../bot/shared/services/coaching/fidelity/fidelity-recompute.service');
    const a = dc11Analysis();
    let written = null;
    const apply = jest.fn((x) => x);
    const out = await recomputeFidelityForSession('s1', {
      loadSession: async () => ({ id: 's1', status: 'analysis_complete', analysis_data: a, transcript_text: TRANSCRIPT }),
      computeLpFidelity: async () => ({ status: 'ok', fidelity_pct: 70, source: 'corpus' }),
      applyLpFidelity: apply,
      persist: async (_id, patch) => { written = patch; return { ok: true }; },
      log: () => {},
    });
    expect(out.recomputed).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(written.analysis_data.lp_fidelity.fidelity_pct).toBe(70);
    expect(written.analysis_data.domains).toEqual(a.domains);
    expect(written.analysis_data.scores).toEqual(a.scores);
  });
});

describe('the v6 text report (built, not wired) never prints the six for a dc11 analysis', () => {
  test('no "Combined indicators" line, no evidence rows, in English or Urdu', () => {
    const { buildTeacherReport } = require('../../bot/shared/services/coaching/frameworks/fico17-v6/teacher-report');
    const a = dc11Analysis();
    for (const language of ['en', 'ur']) {
      const r = buildTeacherReport(a.levels, { language, indicatorSet: 'dc11' });
      expect(r.text).not.toMatch(/Combined indicators/);
      for (const c of SIX) expect(r.text).not.toContain(v6.indicator(c).name);
      expect(r.evidence_rows).toEqual([]);
      expect(r.rows).toHaveLength(11);
    }
  });
});
