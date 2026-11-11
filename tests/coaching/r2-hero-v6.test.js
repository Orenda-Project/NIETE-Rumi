/**
 * FICO6 r2 fix-report: the teacher's image for an /observe2 visit scored on FICO17 v6 (spec §9.3, CONTRACTS §11.5).
 *
 * The PNG a teacher gets is generateHeroReport(session, analysis_data) (observe-send.service.js, renderer-registry
 * via _heroInput), built from the raw record, never the transformer's reportData. For a v6 record:
 * - T4.3: an IE row is said as the one line "The recording didn't cover this part of the lesson.", once per row,
 *   next to its v6 name; an NA row is absent;
 * - T4.4: observe2.transcript_quality.status 'broken' → the broken note, once, and no rubric bars;
 * - F3: held (a combined code without a level, reachable on v6_fallback only) → no rubric bars;
 * - T7.D6: no V3 journey line (the trend is never read), gated on the v6 stamp, not on framework 'fico17_v6'.
 * A v5 /observe2 visit's image is unchanged: the v6 step leaves its rows as they were and the journey line is drawn
 * (the PR carries the before/after HTML hashes on the five v5 fixtures).
 *
 * Mocked: the narrative model, Chromium (htmlToImage returns the HTML), the trend read, R2, the logger.
 * Real: the hero service, score adapter, template, observe2 analysis, the v6 rubric.
 */
'use strict';

const IE_LINE = "The recording didn't cover this part of the lesson.";
const BROKEN_LINE = "The recording couldn't be used, so this report has no levels from it.";
// C7 NA (no group task), D3 IE (couldn't tell), C1 IE on the DC side.
const LEVELS = { C1: 'IE', C2: '4', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: 'IE', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
const SESSION = { id: 'cs-v6', user_id: 't-1', created_at: '2026-11-11T05:00:00Z', transcript_text: 'x' };
const count = (s, sub) => s.split(sub).length - 1;

let V6;
let htmlToImage;
let loadTrendData;
let generateHeroReport;
let buildAnalysis;

beforeEach(() => {
  jest.resetModules();
  htmlToImage = jest.fn(async (html) => Buffer.from(String(html)));
  loadTrendData = jest.fn(async () => [{ date: '2026-10-01', pct: 61 }, { date: '2026-10-15', pct: 64 }]);
  jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
    ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
    generateReportNarrative: async () => ({ strength_name: 'S', strength_note: 'N', horizon_title: 'H', horizon_note: 'Q', moments: [] }),
  }));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: (...a) => htmlToImage(...a) }));
  jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: (...a) => loadTrendData(...a) }));
  jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
  V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
  ({ generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service'));
  ({ buildAnalysis } = require('../../bot/shared/services/observe/observe2/analysis'));
});

function v6Form({ levels = LEVELS, priority = 'C5', quality = null } = {}) {
  const v6Levels = {};
  for (const c of V6.COMBINED_CODES) v6Levels[c] = { level: levels[c], because: 'What I saw from the back of the room.', source: 'coach', set_by: 'coach', dc_result: c === 'D2' ? null : 2 };
  return {
    id: 'form-v6', rubric_version: 'fico17_v6', period_minutes: 40,
    answers: { lp: 'none', priority },
    final_levels: { ...levels },
    rumi_moments: { moments: [], ...(quality ? { transcript_quality: quality } : {}) },
    evidence_review: { priority_final: priority, v6_levels: v6Levels },
  };
}
const BROKEN = { status: 'broken', coverage: 0.3, issues: [{ type: 'loop', from: '12:00', to: '40:00' }] };
// The page body only: the head carries the fonts as base64, which can spell anything.
const image = async (analysis, opts = {}) => {
  const html = (await generateHeroReport(SESSION, analysis, { language: 'en', brand: 'niete', ...opts })).png.toString();
  return html.slice(html.indexOf('</head>'));
};
// The scorecard rows the image draws a bar for, by section name (template: one .pbar per scored row).
const barred = (html) => [...html.matchAll(/<span class="sc-n">([^<]*)<\/span><span class="sc-s">\d+\/\d+<\/span><\/div>\s*<div class="pbar">/g)].map((m) => m[1]);
const sectionName = (key) => require('../../bot/shared/services/coaching/frameworks/fico-framework').getScoringConstants().domains[key].displayName;

describe('T4.3 IE and NA in the teacher\'s image', () => {
  test('each IE row is said once, by its v6 name, as the one line', async () => {
    const html = await image(buildAnalysis(v6Form()));
    expect(count(html, IE_LINE)).toBe(2);
    expect(html).toContain(`${V6.indicator('C1').name}: ${IE_LINE}`);
    expect(html).toContain(`${V6.indicator('D3').name}: ${IE_LINE}`);
  });

  test('in Urdu the line is the Urdu string', async () => {
    const S = require('../../bot/shared/services/observe/observe2/strings').observe2Strings('ur');
    const html = await image(buildAnalysis(v6Form()), { language: 'ur' });
    expect(count(html, S.v6_report_ie)).toBe(2);
  });

  test('an NA row is absent: no name, no "N/A", never a code', async () => {
    const html = await image(buildAnalysis(v6Form()));
    expect(html).not.toContain(V6.indicator('C7').name);
    expect(html).not.toMatch(/N\/A|Couldn't tell|\b[CDF][1-8]\b/);
  });

  test('no IE row, no line', async () => {
    const html = await image(buildAnalysis(v6Form({ levels: { ...LEVELS, C1: '3', D3: '2' } })));
    expect(html).not.toContain(IE_LINE);
  });
});

describe('T4.4 a broken transcript', () => {
  test('the image says the recording could not be used, once', async () => {
    const html = await image(buildAnalysis(v6Form({ quality: BROKEN })));
    expect(count(html, BROKEN_LINE)).toBe(1);
  });

  test('no rubric bars (C, D, F); no IE line on top of the broken note', async () => {
    const html = await image(buildAnalysis(v6Form({ quality: BROKEN })));
    const rubric = ['high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge'].map(sectionName);
    expect(barred(html).filter((n) => rubric.includes(n))).toEqual([]);
    expect(html).not.toContain(IE_LINE);
  });

  test('a partial transcript still draws its bars', async () => {
    const html = await image(buildAnalysis(v6Form({ quality: { status: 'partial', coverage: 0.7, issues: [{ type: 'short', from: '28:00' }] } })));
    expect(barred(html).length).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain(BROKEN_LINE);
  });
});

describe('F3 held (a combined code without a level, v6_fallback only)', () => {
  test('no rubric bars', async () => {
    const html = await image(buildAnalysis(v6Form({ levels: { ...LEVELS, C3: '' } })));
    const rubric = ['high_leverage_practices', 'student_engagement', 'teacher_subject_knowledge'].map(sectionName);
    expect(barred(html).filter((n) => rubric.includes(n))).toEqual([]);
  });
});

describe('T7.D6 the journey line', () => {
  test('an /observe2 v6 record (framework fico, v6 stamp) never reads the V3 trend', async () => {
    const a = buildAnalysis(v6Form());
    expect(a.framework).toBe('fico');
    const html = await image(a);
    expect(loadTrendData).not.toHaveBeenCalled();
    expect(html).not.toContain('class="journey"');
  });

  test('an /observe v6 record (framework fico17_v6) still never reads it', async () => {
    await image({ framework: 'fico17_v6', scores: { rubric: 'fico17_v6' }, domains: {} });
    expect(loadTrendData).not.toHaveBeenCalled();
  });
});

describe('v5 /observe2: the image as before', () => {
  const { FORMS } = require('../observe2/fixtures/report-v5-forms');

  test.each(Object.keys(FORMS))('%s: the v6 step leaves the rows as they were; the journey line is drawn', async (k) => {
    const { v6HeroRows } = require('../../bot/shared/services/coaching/report-v2/hero-report.service');
    const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');
    const a = buildAnalysis(FORMS[k]);
    const before = JSON.stringify(buildScoreViewModel(a, { language: 'en' }).groups);
    const groups = buildScoreViewModel(a, { language: 'en' }).groups;
    expect(v6HeroRows(groups, a, 'en')).toBeNull();
    expect(JSON.stringify(groups)).toBe(before);
    const html = await image(a);
    expect(loadTrendData).toHaveBeenCalledTimes(1);
    expect(html).toContain('class="journey"');
    expect(html).not.toContain(IE_LINE);
  });
});
