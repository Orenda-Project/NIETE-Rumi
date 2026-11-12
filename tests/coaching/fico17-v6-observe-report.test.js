'use strict';
/**
 * bd-ra8xu.38 — a FICO17 v6 /observe visit's teacher report has its own path, never the OECD fallback.
 *
 * The reportData transformer (the PDFKit fallback and the report record) and the renderer brand know 'fico17_v6'
 * (the hero score bars need a report-v2 adapter: prepared separately, see the bead): the 17 v6 indicators by section (C/D/F) with v6 names and level titles, N/A left
 * out, couldn't-tell as one line with no number, the coach's levels marked as the coach's, and lesson-plan fidelity
 * (Section B) shown as its own bar, outside the v6 total (operator 11 Nov: it is not one of the 17).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { getReportTransformer } = require('../../bot/shared/services/coaching/report-transformers/report-transformer-dispatch');
const { transformOECDToReportData } = require('../../bot/shared/services/coaching/report-transformers/oecd-report-transformer');
const { getReportRenderer, heroBrandFor } = require('../../bot/shared/services/coaching/report-renderers/renderer-registry');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { getScoreAdapter } = require('../../bot/shared/services/coaching/report-v2/score-adapters/dispatch');
const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');

const LEVELS = {
  C1: 3, C2: 'NA', C3: 4, C4: 2, C5: 3, C6: 'IE', C7: 'NA', C8: 2,
  D1: 3, D2: 3, D3: 1, D4: 3, D5: 2,
  F1: 3, F2: 3, F3: 2, F4: 1,
};
const COACH = new Set(['C3', 'C5', 'C7', 'D2', 'D3', 'D4', 'C4']);

function v6Analysis({ lp = null } = {}) {
  const domains = {};
  for (const s of Object.values(V6.SECTIONS)) {
    domains[s.domain] = {
      key: s.key,
      indicators: s.codes.map((code) => {
        const lv = LEVELS[code];
        return {
          id: code, name: V6.indicator(code).name, result: lv, score: typeof lv === 'number' ? lv : null,
          applicable: lv !== 'NA', set_by: COACH.has(code) ? 'coach' : 'rumi',
          evidence: `[02:10] "evidence for ${code}"`, because: COACH.has(code) ? 'Seen from the back of the room myself.' : '',
        };
      }),
    };
  }
  const t = V6.totals(LEVELS);
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', domains,
    scores: { overall_marks: t.marks, overall_max_marks: t.max, overall_percentage: t.percentage, rubric: 'fico17_v6' },
    lp_fidelity: lp,
    executive_summary: 'Good lesson.',
  };
}
const SESSION = { created_at: '2026-11-12T05:00:00Z', users: { region: 'Sihala' } };

describe('report data (transformer)', () => {
  test("'fico17_v6' has its own transformer, not the OECD fallback", () => {
    expect(getReportTransformer('fico17_v6')).not.toBe(transformOECDToReportData);
  });

  test('17 v6 indicators by section, NA left out, IE one line, the coach\'s levels marked', () => {
    const rd = getReportTransformer('fico17_v6')(SESSION, 'Rabia', v6Analysis());
    expect(rd.framework).toBe('fico17_v6');
    const all = rd.goals.flatMap((g) => g.criteria);
    const names = all.map((c) => c.name);
    expect(names.some((n) => n.startsWith('C2 '))).toBe(false);
    expect(names.some((n) => n.startsWith('C7 '))).toBe(false);
    const c6 = all.find((c) => c.name.startsWith('C6 '));
    expect(c6.score).toBeNull();
    expect(c6.evidence).toMatch(/couldn't tell/i);
    const c1 = all.find((c) => c.name.startsWith('C1 '));
    expect(c1.name).toBe(`C1 Quality of Questions Asked by the Teacher: ${V6.TITLES.C1[2]}`);
    const c3 = all.find((c) => c.name.startsWith('C3 '));
    expect(c3.setBy).toBe('coach');
    expect(c3.evidence).toMatch(/your coach/i);
    expect(rd.totalScore).toBe(V6.totals(LEVELS).marks);
    expect(rd.maxScore).toBe(V6.totals(LEVELS).max);
    expect(rd.goals.map((g) => g.title)).toEqual(expect.arrayContaining(['What the teacher does', 'What the children do', 'Subject knowledge']));
  });

  test('every V3 key still maps to the transformer it had', () => {
    for (const k of ['oecd', 'hots', 'teach', 'fico', 'mewaka']) expect(typeof getReportTransformer(k)).toBe('function');
    expect(getReportTransformer('fico')).not.toBe(getReportTransformer('fico17_v6'));
  });
});

describe('renderer', () => {
  test('a v6 report renders on the NIETE hero, like V3 FICO', () => {
    expect(heroBrandFor('fico17_v6')).toBe('niete');
    expect(getReportRenderer('fico17_v6').key).toBe('hero-niete');
    expect(getReportRenderer('fico').key).toBe('hero-niete');
  });
});
describe('hero report score bars', () => {
  test('a v6 analysis gets C/D/F bars from its own indicators, never an empty card', () => {
    const groups = getScoreAdapter('fico17_v6')(v6Analysis(), 'en');
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(Object.keys(byKey)).toEqual(expect.arrayContaining(['C', 'D', 'F']));
    // C: C1 3, C3 4, C4 2, C5 3, C8 2 (C2 NA, C6 IE, C7 NA left out) = 14 of 20
    expect(byKey.C).toMatchObject({ score: 14, max: 20, pct: 70 });
    expect(byKey.D).toMatchObject({ score: 12, max: 20 });
    expect(byKey.F).toMatchObject({ score: 9, max: 16 });
    expect(byKey.C.name).toBe('What the teacher does');
  });

  test('Urdu section names', () => {
    const groups = getScoreAdapter('fico17_v6')(v6Analysis(), 'ur');
    expect(groups.find((g) => g.key === 'C').name).toMatch(/[؀-ۿ]/);
  });

  test('lesson-plan fidelity is its own bar when measured, and not counted in the v6 headline', () => {
    const a = v6Analysis({ lp: { status: 'ok', fidelity_pct: 75, moves: [] } });
    const vm = buildScoreViewModel(a, { language: 'en' });
    const b = vm.groups.find((g) => g.key === 'B');
    expect(b).toMatchObject({ pct: 75 });
    expect(vm.overall).toBe(Math.round(V6.totals(LEVELS).percentage));
    expect(vm.framework).toBe('fico17_v6');
  });

  test('no plan: Section B says not assessed, never a zero', () => {
    const b = getScoreAdapter('fico17_v6')(v6Analysis(), 'en').find((g) => g.key === 'B');
    expect(b).toMatchObject({ score: null, notAssessed: true });
  });
});


describe('journey trend', () => {
  test('a v6 hero report never draws the teacher\'s V3 history beside a v6 score', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/report-v2/hero-report.service.js'), 'utf8');
    expect(src).toMatch(/if \(framework !== 'fico17_v6'\) try \{\s*const raw = await loadTrendData/);
  });
});
