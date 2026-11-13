/**
 * FICO6 r2 fix-misc: the headline percentage on the teacher's image for an /observe2 visit scored on FICO17 v6.
 *
 * Spec §9.3: IE is never counted in a total, and a broken recording has no rubric report. The hero printed
 * `score.overall` twice (the headline `.hscore .p` and the scorecard label's `.ov`) whatever the rows held, so a
 * record with no numeric level read "0%", and a broken one kept a percentage over the coach's room levels
 * (fix-report finding 15:58Z; redteam2 r2-d-hero KNOWN OPEN). Now: no row with a number, or a broken recording,
 * means no percentage at all. Every other record, v5 and V3 included, renders as before (the PR carries the
 * before/after HTML hashes).
 *
 * Mocked: the narrative model, Chromium (htmlToImage returns the HTML), the trend read, R2, the logger.
 * Real: the hero service, score adapter, template, observe2 analysis, the v6 rubric.
 */
'use strict';

const LEVELS = { C1: 'IE', C2: '4', C3: '3', C4: '2', C5: '2', C6: '3', C7: 'NA', C8: '3', D1: '3', D2: '4', D3: 'IE', D4: '3', D5: '2', F1: '3', F2: '2', F3: '2', F4: '1' };
const SESSION = { id: 'cs-v6', user_id: 't-1', created_at: '2026-11-11T05:00:00Z', transcript_text: 'x' };
const BROKEN = { status: 'broken', coverage: 0.3, issues: [{ type: 'loop', from: '12:00', to: '40:00' }] };

let V6;
let generateHeroReport;
let buildAnalysis;

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
    ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
    generateReportNarrative: async () => ({ strength_name: 'S', strength_note: 'N', horizon_title: 'H', horizon_note: 'Q', moments: [] }),
  }));
  jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: async (html) => Buffer.from(String(html)) }));
  jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: async () => [] }));
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
// The page body only: the head carries the fonts as base64, which can spell anything.
const image = async (analysis, language = 'en') => {
  const html = (await generateHeroReport(SESSION, analysis, { language, brand: 'niete' })).png.toString();
  return html.slice(html.indexOf('</head>'));
};
const headline = (html) => (html.match(/<div class="hscore"><div class="p">([^<]*)<\/div>/) || [])[1];
const label = (html) => (html.match(/<span class="ov">([^<]*)<\/span>/) || [])[1];

describe('no numeric level: no headline percentage', () => {
  test.each(['en', 'ur'])('all 17 IE (%s): no headline and no percentage beside the scores label', async (lang) => {
    const all = Object.fromEntries(Object.keys(LEVELS).map((c) => [c, 'IE']));
    const html = await image(buildAnalysis(v6Form({ levels: all, priority: 'C1' })), lang);
    expect(html).not.toContain('class="hscore"');
    expect(html).not.toContain('class="ov"');
    expect(html).not.toMatch(/\d+%/);
  });

  test('all IE or NA: no percentage', async () => {
    const levels = Object.fromEntries(Object.keys(LEVELS).map((c) => [c, V6.COMBINED_CODES.includes(c) ? 'NA' : 'IE']));
    const html = await image(buildAnalysis(v6Form({ levels, priority: 'C1' })));
    expect(html).not.toMatch(/\d+%/);
  });

  test('a broken recording (coach room levels numeric): no percentage', async () => {
    const html = await image(buildAnalysis(v6Form({ quality: BROKEN })));
    expect(html).not.toContain('class="hscore"');
    expect(html).not.toMatch(/\d+%/);
  });
});

describe('a v6 record with numeric levels keeps its headline', () => {
  test('the headline and the label both show the record\'s percentage', async () => {
    const a = buildAnalysis(v6Form());
    const html = await image(a);
    const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');
    const pct = `${buildScoreViewModel(a, { language: 'en' }).overall}%`;
    expect(headline(html)).toBe(pct);
    expect(label(html)).toBe(pct);
  });
});

describe('v5 /observe2: the headline as before', () => {
  const { FORMS } = require('../observe2/fixtures/report-v5-forms');
  test.each(Object.keys(FORMS))('%s: the headline is the adapter\'s overall', async (k) => {
    const a = buildAnalysis(FORMS[k]);
    const html = await image(a);
    const { buildScoreViewModel } = require('../../bot/shared/services/coaching/report-v2/score-adapter.service');
    expect(headline(html)).toBe(`${buildScoreViewModel(a, { language: 'en' }).overall}%`);
  });
});
