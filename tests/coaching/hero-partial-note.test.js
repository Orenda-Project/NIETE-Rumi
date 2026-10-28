/**
 * The hero (image) coaching report shows the partial-report note (bd-1r3k2h).
 *
 * Mock run 20261026-2335-par, COA19: a FICO report built after the teacher skipped the reflection carried
 * no note at all. report-generator builds one (buildPartialNote in report-transformers/_shared.js: "Note:
 * This report is based on classroom audio analysis only. The reflective conversation was skipped at your
 * request.") for the PDFKit transformers, but the hero image — the report a teacher here actually gets —
 * had no slot for it. The spec: the report note says it is based on the classroom audio alone.
 *
 * Three pieces, all red before the fix:
 *   1. the template renders vm.partialNote;
 *   2. generateHeroReport fills it from the session's partial flags at delivery time, and from
 *      analysis.partial_report_note on a re-render (hero-text.js, the app's report page) — the flags only
 *      exist on the delivery job's session object;
 *   3. persistReportNarrative stores the note next to the narrative so a re-render has it.
 */
'use strict';

const SID = 'cs-partial-1';

describe('hero-report.template renders the partial note', () => {
  const { buildHeroReportHtml } = require('../../bot/shared/services/coaching/report-v2/hero-report.template');
  const vm = {
    language: 'en', brand: 'niete', teacherName: 'Sana', topic: 'Fractions', date: '2026-10-26',
    score: { overall: 68, marks: 38, max: 56 }, groups: [], narrative: {}, tryNext: '', uptake: null, trend: [], photoB64: '', classroomPhotos: [],
  };
  test('with a note: the note text is in the page', () => {
    const html = buildHeroReportHtml({ ...vm, partialNote: 'Note: This report is based on classroom audio analysis only. The reflective conversation was skipped at your request.' });
    expect(html).toMatch(/class="pnote"/);
    expect(html).toMatch(/based on classroom audio analysis only/);
  });
  test('without a note: nothing is added', () => {
    expect(buildHeroReportHtml(vm)).not.toMatch(/class="pnote"/);
  });
});

describe('generateHeroReport fills the note', () => {
  let htmlToImage;
  let generateHeroReport;
  beforeEach(() => {
    jest.resetModules();
    htmlToImage = jest.fn(async (html) => Buffer.from(String(html)));
    jest.doMock('../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: async () => ({ strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.', moments: [] }),
    }));
    jest.doMock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: (...a) => htmlToImage(...a) }));
    jest.doMock('../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []) }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    ({ generateHeroReport } = require('../../bot/shared/services/coaching/report-v2/hero-report.service'));
  });
  const analysis = { framework: 'fico', scores: {} };

  test('at delivery: from the session\'s partial flags, and returned so the caller can store it', async () => {
    const session = { id: SID, user_id: 't-1', created_at: '2026-10-26T10:00:00Z', transcript_text: 'x',
      _isPartialReport: true, _isUserRequestedEarly: true, _questionsAtCompletion: 0 };
    const out = await generateHeroReport(session, analysis, { language: 'en' });
    expect(out.partialNote).toMatch(/based on classroom audio analysis only/);
    expect(out.png.toString()).toMatch(/based on classroom audio analysis only/);
  });
  test('on a re-render: from analysis.partial_report_note', async () => {
    const session = { id: SID, user_id: 't-1', created_at: '2026-10-26T10:00:00Z', transcript_text: 'x' };
    const out = await generateHeroReport(session, { ...analysis, partial_report_note: 'Note: This report is based on classroom audio analysis only. The reflective conversation was skipped at your request.' }, { language: 'en' });
    expect(out.png.toString()).toMatch(/reflective conversation was skipped/);
  });
  test('a whole report carries no note', async () => {
    const session = { id: SID, user_id: 't-1', created_at: '2026-10-26T10:00:00Z', transcript_text: 'x' };
    const out = await generateHeroReport(session, analysis, { language: 'en' });
    expect(out.partialNote).toBeNull();
    expect(out.png.toString()).not.toMatch(/class="pnote"/);
  });
});

describe('persistReportNarrative stores the note beside the narrative', () => {
  function fakeSupabase(row) {
    const writes = [];
    const from = () => {
      const q = {};
      q.select = () => q; q.eq = () => q;
      q.single = async () => ({ data: row, error: null });
      q.update = (patch) => { writes.push(patch); return { eq: async () => ({ error: null }) }; };
      return q;
    };
    return { from, writes };
  }
  const NARRATIVE = { strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.', moments: [] };
  test('extra keys ride the same read-merge-write', async () => {
    const store = require('../../bot/shared/services/coaching/report-v2/narrative-store');
    const sb = fakeSupabase({ analysis_data: { framework: 'fico' } });
    const ok = await store.persistReportNarrative(SID, NARRATIVE, { supabase: sb, log: jest.fn(), now: () => new Date('2026-10-26T10:00:00Z'), extra: { partial_report_note: 'Note: audio only.' } });
    expect(ok).toBe(true);
    expect(sb.writes[0].analysis_data).toMatchObject({ framework: 'fico', partial_report_note: 'Note: audio only.', report_narrative: { strength_name: 'Wait time' } });
  });
});
