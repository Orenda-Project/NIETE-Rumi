'use strict';
/**
 * bd-gzfdu9 R7p-b (COS 20261026T044621 §1–3): the report's delivery path on the recommendation row.
 *   - video_recommendations.report_via (V1.7.9): image | slim | template | pdf, written on EVERY row (shown, shadow, none)
 *     once the hero has gone; never throws, never holds the report.
 *   - The write is gated on the column existing: probed once and cached, or VIDEO_RECO_REPORT_VIA=1. Without it the
 *     update carries no report_via key, and image_strip still goes.
 *   - image_strip = true whenever the hero that carried the strip went, on any path (the template path included, where
 *     no clip message follows and markSent never runs).
 *   - Flag off (the engine's promise is null): nothing is read or written.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const ROW = { id: 'r1', coaching_session_id: 'sess-1', status: 'shadow' };

function db({ probeError = null, updateError = null } = {}) {
  const calls = { probe: 0, updates: [] };
  const from = jest.fn(() => {
    const q = {};
    q.select = jest.fn(() => q);
    q.limit = jest.fn(async () => { calls.probe += 1; return { data: [], error: probeError }; });
    q.update = jest.fn((patch) => { const u = { patch }; calls.updates.push(u); return { eq: jest.fn(async (c, v) => { u.eq = [c, v]; return { error: updateError }; }) }; });
    return q;
  });
  return { supabase: { from }, calls };
}

describe('recordReportPath', () => {
  let RV;
  beforeEach(() => { jest.resetModules(); delete process.env.VIDEO_RECO_REPORT_VIA; RV = require('../../../bot/shared/services/coaching/video-reco/report-via'); });

  test('no row (flag off, engine refused) → nothing read, nothing written', async () => {
    const { supabase, calls } = db();
    expect(await RV.recordReportPath({ row: Promise.resolve(null), reportVia: 'image', imageStrip: true, deps: { supabase } })).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(calls.probe).toBe(0);
  });

  test.each(['image', 'slim', 'template', 'pdf'])('column present: report_via %s and image_strip on the session\'s row', async (via) => {
    const { supabase, calls } = db();
    expect(await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: via, imageStrip: true, deps: { supabase } })).toBe(true);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toEqual({ report_via: via, image_strip: true });
    expect(calls.updates[0].eq).toEqual(['coaching_session_id', 'sess-1']);
  });

  test.each([['42703'], ['PGRST204']])('column absent (%s): the update carries no report_via, image_strip still goes', async (code) => {
    const { supabase, calls } = db({ probeError: { code, message: 'column video_recommendations.report_via does not exist' } });
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'template', imageStrip: true, deps: { supabase } });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toEqual({ image_strip: true });
  });

  test('column absent and no strip → no write at all', async () => {
    const { supabase, calls } = db({ probeError: { code: '42703' } });
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'image', imageStrip: false, deps: { supabase } });
    expect(calls.updates).toHaveLength(0);
  });

  test('no strip → image_strip is not written (never set false over markSent)', async () => {
    const { supabase, calls } = db();
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'image', imageStrip: false, deps: { supabase } });
    expect(calls.updates[0].patch).toEqual({ report_via: 'image' });
  });

  test('the probe runs once per process (cached)', async () => {
    const { supabase, calls } = db();
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'image', imageStrip: false, deps: { supabase } });
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'slim', imageStrip: false, deps: { supabase } });
    expect(calls.probe).toBe(1);
    expect(calls.updates).toHaveLength(2);
  });

  test('VIDEO_RECO_REPORT_VIA=1 → no probe, the column is written', async () => {
    process.env.VIDEO_RECO_REPORT_VIA = '1';
    const { supabase, calls } = db({ probeError: { code: '42703' } });
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'pdf', imageStrip: false, deps: { supabase } });
    expect(calls.probe).toBe(0);
    expect(calls.updates[0].patch).toEqual({ report_via: 'pdf' });
  });

  test('an unknown path is never written; a failed update or a rejecting row never throws', async () => {
    const a = db();
    await RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'carrier-pigeon', imageStrip: false, deps: { supabase: a.supabase } });
    expect(a.calls.updates).toHaveLength(0);
    const b = db({ updateError: { message: 'boom' } });
    await expect(RV.recordReportPath({ row: Promise.resolve(ROW), reportVia: 'image', imageStrip: true, deps: { supabase: b.supabase } })).resolves.toBe(false);
    await expect(RV.recordReportPath({ row: Promise.reject(new Error('x')), reportVia: 'image', imageStrip: true, deps: { supabase: b.supabase } })).resolves.toBe(false);
  });
});

// The live branch: report-generator records the path after the hero (or the PDF) went, on every path.
describe('report-generator: the path the report went by', () => {
  const ENV = { ...process.env };
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); process.env = { ...ENV }; });

  async function run({ hero = { png: Buffer.from('PNG'), caption: 'cap' }, heroSent = true, strip = null }) {
    jest.resetModules();
    process.env.VIDEO_RECO_ENABLED = 'true';
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true) }));
    jest.doMock('../../../bot/shared/storage/r2', () => ({ uploadReportImage: jest.fn(async () => 'u'), uploadReportPDF: jest.fn(async () => 'u'), uploadImageWithRetry: jest.fn(async () => 'u'), uploadVoiceDebrief: jest.fn(async () => 'u') }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({ generateCommitmentCard: jest.fn(async () => ({ _source: 'llm', commitment: 'c', action: 'Ask why', language: 'en' })) }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: jest.fn(async () => null), loadTrendData: jest.fn(async () => []), loadRecentSectionBModes: jest.fn(async () => []) }));
    jest.doMock('../../../bot/shared/services/coaching/ab-v10-switch', () => ({ v10Enabled: jest.fn(async () => false) }));
    jest.doMock('../../../bot/shared/services/coaching/report-link-send', () => ({ sendReportLinkIfNew: jest.fn(async () => false) }));
    jest.doMock('../../../bot/shared/services/coaching/video-reco/send', () => ({ sendAfterReport: jest.fn(async () => ({ sent: false })) }));
    jest.doMock('../../../bot/shared/services/coaching/video-reco/strip', () => ({ stripFor: async () => strip }));
    const engineRow = Promise.resolve(ROW);
    jest.doMock('../../../bot/shared/services/coaching/video-reco/engine', () => ({ recommendForReport: () => engineRow }));
    const recordReportPath = jest.fn(async () => true);
    jest.doMock('../../../bot/shared/services/coaching/video-reco/report-via', () => ({ recordReportPath }));
    const session = { id: 'sess-1', user_id: 'user-1', status: 'analysis_complete', created_at: '2026-10-20T00:00:00Z', conversation_state: { questions: [] }, analysis_data: { framework: 'fico', domains: {} }, transcript_language: 'en', users: { phone_number: '920000000000', name: 'T', region: 'ICT', preferred_language: 'en' } };
    jest.doMock('../../../bot/shared/config/supabase', () => {
      const chain = {};
      ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in', 'gte', 'upsert', 'update', 'insert'].forEach((m) => { chain[m] = jest.fn(() => chain); });
      chain.single = jest.fn(async () => ({ data: session, error: null }));
      chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
      chain.then = (resolve) => resolve({ data: null, error: null });
      return { from: jest.fn(() => chain) };
    });
    const RG = require('../../../bot/shared/services/coaching/report-generator.service');
    jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'fico', domains: {} });
    jest.spyOn(RG, 'generatePDFReport').mockResolvedValue(hero);
    jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(heroSent);
    jest.spyOn(RG, 'sendPDFReport').mockResolvedValue(true);
    jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    await RG.generateReport('sess-1', { from: '920000000000' });
    return { recordReportPath, engineRow };
  }
  const STRIP = { thumbPath: '/x.jpg', title: 't', durationS: 60, where: 'app' };

  test('full image in an open window → image; the engine\'s own promise is handed over', async () => {
    const { recordReportPath, engineRow } = await run({});
    expect(recordReportPath).toHaveBeenCalledTimes(1);
    expect(recordReportPath.mock.calls[0][0]).toMatchObject({ coachingSessionId: 'sess-1', reportVia: 'image', imageStrip: false });
    expect(recordReportPath.mock.calls[0][0].row).toBe(engineRow);
  });
  test('the slim image (C/D) → slim', async () => {
    const { recordReportPath } = await run({ hero: { png: Buffer.from('P'), slimPng: Buffer.from('S'), caption: 'c' } });
    expect(recordReportPath.mock.calls[0][0]).toMatchObject({ reportVia: 'slim' });
  });
  test('window closed: the share template → template, and image_strip true (the strip went with it)', async () => {
    const { recordReportPath } = await run({ heroSent: 'template', strip: STRIP });
    expect(recordReportPath.mock.calls[0][0]).toMatchObject({ reportVia: 'template', imageStrip: true });
  });
  test('a PDF report → pdf', async () => {
    const { recordReportPath } = await run({ hero: Buffer.from('%PDF') });
    expect(recordReportPath.mock.calls[0][0]).toMatchObject({ reportVia: 'pdf', imageStrip: false });
  });
  test('the hero did not go (a duplicate run) → nothing recorded', async () => {
    const { recordReportPath } = await run({ heroSent: false });
    expect(recordReportPath).not.toHaveBeenCalled();
  });
});

describe('strip hint default (red7 N1, 051537)', () => {
  test('a strip with no `where` takes the app hint, never the next-message promise', () => {
    jest.resetModules();
    jest.dontMock('../../../bot/shared/services/coaching/video-reco/strip'); // the block above doMocks it; that outlives resetModules
    const { stripHtml } = require('../../../bot/shared/services/coaching/video-reco/strip');
    const html = stripHtml({ thumbPath: '/nope.jpg', title: 'x', durationS: 120 }, { language: 'en', T: (s) => s });
    expect(html).toContain('watch it in your report in the app');
    expect(html).not.toContain('next message');
  });
});
