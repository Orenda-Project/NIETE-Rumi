'use strict';
/**
 * Section B (Lesson Plan Fidelity) is NOT SCORED when no lesson plan was
 * measured — and every surface has to say so.
 *
 * What happened before: when no usable plan reached the observation, Section B
 * fell back to ten LLM "proxy" indicators that guessed at plan fidelity from the
 * transcript alone. 2,349 sessions (47.4%, 1,109 teachers) were scored that way,
 * averaging 25.5/40, and indicator B7 "Use of Taleemabad Lesson Plan" was marked
 * Proficient on 27.0% of them — crediting a teacher for following a plan she
 * never supplied. A fidelity score with no plan is not a measurement of
 * anything.
 *
 * The decision: EXCLUDE. Section B leaves both sides of the total, the card says
 * "not assessed" instead of drawing a bar, the why line says a plan was not
 * provided, the voice note never quotes a fidelity figure, and the coach's
 * review form stops claiming the section "was scored by the AI assessment".
 * Arithmetically this is neutral fleet-wide (60.2% -> 60.2%), which is why it
 * beats flooring the section at 10/40 (-11.1 points for all 1,109 teachers).
 *
 * `assessed === false` is the ONLY thing that removes the section. An absent
 * flag means assessed, so every session scored before this change keeps exactly
 * the totals it was reported with.
 */
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');
const { buildFicoGroups } = require('../../bot/shared/services/coaching/report-v2/score-adapters/fico-adapter');
const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');
const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
const { buildPrompt } = require('../../bot/shared/services/coaching/report-v2/narrative.service');
const { buildBreakdown } = require('../../bot/shared/services/coaching/coaching-breakdown.service');
const { buildScreenPrefill } = require('../../bot/shared/services/observe/observe-draft.service');

const rows = (prefix, n, score) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, score }));

// The proxy scores Section B 20/40; C 36/48, D 21/28, F 16/32. computeScores
// makes that 93/148. With Section B excluded it is 73/108.
function noPlanAnalysis() {
  return fico.computeScores({
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: { indicators: rows('B', 10, 2) },
      high_leverage_practices: { indicators: rows('C', 12, 3) },
      student_engagement: { indicators: rows('D', 7, 3) },
      teacher_subject_knowledge: { indicators: rows('F', 8, 2) },
    },
  });
}

describe('the framework owns the exclusion', () => {
  test('THE BUG: no measured fidelity -> Section B leaves the total', () => {
    const a = noPlanAnalysis();
    expect(a.scores.overall_max_marks).toBe(148); // before the exclusion

    fico.applyLpFidelity(a, { status: 'lp_absent' });

    expect(a.domains.lesson_plan_fidelity.assessed).toBe(false);
    expect(a.domains.lesson_plan_fidelity.not_assessed_reason).toBe('lp_absent');
    expect(a.scores.overall_max_marks).toBe(108); // 148 - 40
    expect(a.scores.overall_marks).toBe(73);      // 93 - 20
    expect(a.scores.overall_percentage).toBe(67.6);
  });

  test('every not-measured state excludes, and records which one it was', () => {
    const cases = [
      [{ status: 'lp_absent' }, 'lp_absent'],
      [{ status: 'fidelity_unavailable', error: 'lp_unparseable' }, 'fidelity_unavailable'],
      [{ status: 'ok', fidelity_pct: null }, 'ok'],
      [undefined, 'lp_absent'],
    ];
    for (const [blob, reason] of cases) {
      const a = noPlanAnalysis();
      fico.applyLpFidelity(a, blob);
      expect(a.domains.lesson_plan_fidelity.assessed).toBe(false);
      expect(a.domains.lesson_plan_fidelity.not_assessed_reason).toBe(reason);
      expect(a.scores.overall_max_marks).toBe(108);
    }
  });

  test('the legacy B numbers stay on the row, so readers below the report keep theirs', () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'lp_absent' });
    // The per-sector card downstream sums the legacy B indicators over domain_max;
    // nulling it would make that row vanish with no note.
    expect(a.domains.lesson_plan_fidelity.domain_max).toBe(40);
    expect(a.domains.lesson_plan_fidelity.domain_score).toBe(20);
  });

  test('a MEASURED session is untouched by the exclusion', () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 60, band: 'partial' });
    expect(a.domains.lesson_plan_fidelity.assessed).not.toBe(false);
    expect(a.domains.lesson_plan_fidelity.fidelity_derived).toBe(true);
    expect(a.scores.overall_max_marks).toBe(148);
  });

  test('re-running with a measured blob clears a previous not-assessed mark', () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'lp_absent' });
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 60 });
    expect(a.domains.lesson_plan_fidelity.assessed).toBe(true);
    expect(a.domains.lesson_plan_fidelity.not_assessed_reason).toBeUndefined();
    expect(a.scores.overall_max_marks).toBe(148);
  });

  test('BACK-COMPAT LOCK: computeScores with no assessed flag is unchanged', () => {
    const a = noPlanAnalysis();
    expect(a.scores.overall_max_marks).toBe(148);
    expect(a.scores.overall_marks).toBe(93);
  });
});

describe('the report card', () => {
  const excluded = () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'lp_absent' });
    return a;
  };

  test('the adapter emits a not-assessed row instead of a number', () => {
    const groups = buildFicoGroups(excluded(), 'en');
    const b = groups.find((g) => g.domainKey === 'lesson_plan_fidelity');
    expect(b.notAssessed).toBe(true);
    expect(b.score).toBeNull();
    expect(b.max).toBeNull();
    expect(b.pct).toBeNull();
  });

  test('the other three sections keep their numbers', () => {
    const groups = buildFicoGroups(excluded(), 'en');
    for (const key of ['high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge']) {
      const g = groups.find((x) => x.domainKey === key);
      expect(typeof g.score).toBe('number');
      expect(typeof g.max).toBe('number');
    }
  });

  test('the headline reads the adjusted total, not 148', () => {
    const vm = buildScoreViewModel(excluded(), { framework: 'fico', language: 'en' });
    expect(vm.max).toBe(108);
    expect(vm.marks).toBe(73);
    expect(vm.overall).toBe(68);
  });

  test('the template prints the words, not "null/null", and draws no bar for that row', () => {
    const groups = buildFicoGroups(excluded(), 'en');
    const html = buildHeroReportHtml({
      language: 'en', brand: 'niete', teacherName: 'Sana', topic: 'Fractions', date: '2026-09-15',
      score: { overall: 68, marks: 73, max: 108 },
      groups, narrative: { affirmation: 'x', moments: [] }, trend: [],
    });
    expect(html).not.toContain('null/null');
    expect(html).toContain('not assessed');
    // one bar per SCORED section: three, not four
    expect(html.match(/class="pbar"/g)).toHaveLength(3);
  });

  test('the ur template prints the Urdu words', () => {
    const groups = buildFicoGroups(excluded(), 'ur');
    const html = buildHeroReportHtml({
      language: 'ur', brand: 'niete', teacherName: 'ثناء', topic: 'اعداد', date: '2026-09-15',
      score: { overall: 68, marks: 73, max: 108 },
      groups, narrative: { affirmation: 'x', moments: [] }, trend: [],
    });
    expect(html).toContain('جانچ نہیں ہوئی');
    expect(html.match(/class="pbar"/g)).toHaveLength(3);
  });

  test('the why line is written by code and says a plan was not provided', () => {
    for (const [lang, needle] of [['en', 'No lesson plan was provided'], ['ur', 'کوئی لیسن پلان فراہم نہیں']]) {
      const b = buildFicoGroups(excluded(), lang).find((g) => g.domainKey === 'lesson_plan_fidelity');
      expect(b.why).toContain(needle);
    }
  });

  test('a fidelity engine failure says THAT, not that no plan arrived', () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'fidelity_unavailable' });
    const b = buildFicoGroups(a, 'en').find((g) => g.domainKey === 'lesson_plan_fidelity');
    expect(b.why).toMatch(/could not be measured/i);
    expect(b.why).not.toMatch(/No lesson plan was provided/i);
  });

  test('the narrative prompt stops asking the model to diagnose the unscored section', () => {
    const prompt = buildPrompt(excluded(), { transcript: 't', trend: [], language: 'en', teacherName: 'Sana' });
    expect(prompt).toMatch(/NOT ASSESSED/);
    // the proxy's "lowest indicators" grounding is what invented the missing element
    const sectionBLine = prompt.split('\n').find((l) => l.startsWith('- lesson_plan_fidelity'));
    expect(sectionBLine).not.toMatch(/Lowest indicators/);
    expect(sectionBLine).not.toMatch(/20\/40/);
  });

  test('the model cannot overwrite the code-written why line', () => {
    const { attachDomainWhys } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const groups = buildFicoGroups(excluded(), 'en');
    attachDomainWhys(groups, { lesson_plan_fidelity: 'This is developing because the opening was clear.' });
    const b = groups.find((g) => g.domainKey === 'lesson_plan_fidelity');
    expect(b.why).toContain('No lesson plan was provided');
  });
});

describe('the portal and app drill-down', () => {
  test('the unscored section is not rendered 0/0 and is not sorted weakest', () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'lp_absent' });
    const bd = buildBreakdown(a, 'en');
    const b = bd.groups.find((g) => g.domainKey === 'lesson_plan_fidelity');
    expect(b.notAssessed).toBe(true);
    expect(b.score).toBeNull();
    expect(b.max).toBeNull();
    expect(b.pct).toBeNull();
    // the surface opens the LAST group by default — the weakest SCORED section
    expect(bd.groups[bd.groups.length - 1].domainKey).not.toBe('lesson_plan_fidelity');
    expect(bd.overall).toBe(68);
    expect(bd.max).toBe(108);
  });

  test('a measured session still ranks all four sections', () => {
    const a = noPlanAnalysis();
    fico.applyLpFidelity(a, { status: 'ok', fidelity_pct: 20 });
    const bd = buildBreakdown(a, 'en');
    expect(bd.groups).toHaveLength(4);
    expect(bd.groups.every((g) => !g.notAssessed)).toBe(true);
  });
});

describe("the coach's review form", () => {
  const prev = process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
  beforeEach(() => { process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = 'editable'; });
  afterAll(() => {
    if (prev === undefined) delete process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY;
    else process.env.OBSERVE_FICO_FLOW_HAS_FIDELITY = prev;
  });

  const copy = (lp) => buildScreenPrefill(
    { framework: 'fico', lp_fidelity: lp, domains: {} },
    'lesson_plan_fidelity',
  ).fid_fallback;

  test('stops telling the coach the section was scored by the AI assessment', () => {
    for (const lp of [{ status: 'lp_absent' }, undefined, { status: 'fidelity_unavailable' }, { status: 'ok', fidelity_pct: null }]) {
      expect(copy(lp)).not.toMatch(/AI assessment/i);
      expect(copy(lp)).toMatch(/not scored/i);
    }
  });

  test('each state still names what actually happened', () => {
    expect(copy({ status: 'lp_absent' })).toMatch(/No lesson plan was provided/i);
    expect(copy({ status: 'ok', fidelity_pct: null })).toMatch(/linked/i);
    expect(copy({ status: 'fidelity_unavailable' })).toMatch(/could not run/i);
    const three = new Set([
      copy({ status: 'ok', fidelity_pct: null }),
      copy({ status: 'fidelity_unavailable' }),
      copy({ status: 'lp_absent' }),
    ]);
    expect(three.size).toBe(3);
  });
});
