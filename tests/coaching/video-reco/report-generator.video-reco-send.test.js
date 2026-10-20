'use strict';
/**
 * bd-gzfdu9 (VIDREC) hook B: the recommended clip goes out as ONE message right after the report (and its C/D
 * link), only while the 24 h window is open (followUps), before the voice debrief. The row is read by session
 * (video-reco/send.js sendAfterReport), so this file holds no state of its own; with VIDEO_RECO_ENABLED unset every
 * WhatsApp call the report makes is exactly what it was.
 */
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true),
}));
const mockLog = jest.fn();
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-ns' }));
jest.mock('../../../bot/shared/storage/r2', () => ({
  uploadReportImage: jest.fn(async () => 'https://r2.example/report.png'), uploadReportPDF: jest.fn(async () => 'https://r2.example/report.pdf'),
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/card.png'), uploadVoiceDebrief: jest.fn(async () => 'https://r2.example/voice.mp3'),
}));
const mockCard = jest.fn(async (analysis, cs, lang, opts) => ({
  _source: 'fallback', commitment: 'c', action: 'a', language: 'ur',
  indicator: opts.target ? `${opts.target.name} (${opts.target.indicator})` : 'Something else (X9)',
}));
jest.mock('../../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({ generateCommitmentCard: (...a) => mockCard(...a) }));
jest.mock('../../../bot/shared/config/coaching-card.config', () => ({ getCoachingCardCopy: jest.fn(() => ({ commitPrompt: 'Will you try this?', commitButtons: { yes: 'Yes', later: 'Later', no: 'No' }, cardFooter: 'Human Coach' })) }));
jest.mock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: jest.fn(async () => null), loadTrendData: jest.fn(async () => []), loadRecentSectionBModes: jest.fn(async () => []) }));

// While ab_v10_enabled is on, the one next step is the new report: groups C and D only (Amena, 16 Oct).
// Switch off → every teacher gets it, as before the test.
const mockSwitch = jest.fn(async () => true);
jest.mock('../../../bot/shared/services/coaching/ab-v10-switch', () => ({ v10Enabled: (...a) => mockSwitch(...a) }));
const mockGroup = jest.fn(async () => ({ group: 'C', plan: 'v9', report: 'new' }));
jest.mock('../../../bot/shared/services/coaching/ab-v10-arms', () => ({ groupFor: (...a) => mockGroup(...a) }));
// The C/D report-link sender (bd-v0toag.19) reads the group on its own and has its own tests;
// here only the one-next-step path is under test.
jest.mock('../../../bot/shared/services/coaching/report-link-send', () => ({ sendReportLinkIfNew: jest.fn(async () => false) }));

const updates = [];
const ok = (id, name, score) => ({ id, name, score, applicable: true });
const ANALYSIS = {
  framework: 'fico',
  domains: {
    lesson_plan_fidelity: { indicators: [ok('B1', 'Instructional Clarity & Learning Objectives', 2), ok('B6', 'Differentiation / Catering to Learning Levels', 0)] },
    high_leverage_practices: { indicators: [{ id: 'C1', name: 'Quality Questioning (Bloom\'s Aligned)', score: null, applicable: false }, ok('C3', 'Effective Feedback', 1)] },
  },
  focus_area: { domain: 'high_leverage_practices', indicator: 'C1', title: 'کھلے سوالات کی مشق', try_this_tomorrow: 'سبق سے ایک open-ended سوال تیار کیا جائے' },
};
const mockSessionRow = {
  id: 'sess-1', user_id: 'user-1', status: 'analysis_complete', created_at: '2026-10-07T00:00:00Z',
  conversation_state: { questions: [] }, analysis_data: ANALYSIS, transcript_language: 'ur',
  users: { phone_number: '10000000000', name: 'Teacher B', region: 'ICT', preferred_language: 'ur' },
};
jest.mock('../../../bot/shared/config/supabase', () => {
  const makeChain = () => {
    const chain = {};
    ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.single = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.maybeSingle = jest.fn(async () => ({ data: mockSessionRow, error: null }));
    chain.update = jest.fn((payload) => { updates.push(payload); return chain; });
    chain.then = (resolve) => resolve({ data: null, error: null });
    return chain;
  };
  return { from: jest.fn(() => makeChain()) };
});

const mockSendAfter = jest.fn(async () => ({ sent: false, via: null }));
let mockRealSend = false;
jest.mock('../../../bot/shared/services/coaching/video-reco/send', () => {
  const real = jest.requireActual('../../../bot/shared/services/coaching/video-reco/send');
  return { ...real, sendAfterReport: (...a) => (mockRealSend ? real.sendAfterReport(...a) : mockSendAfter(...a)) };
});
const mockStripFor = jest.fn(async () => null);
jest.mock('../../../bot/shared/services/coaching/video-reco/strip', () => ({ stripFor: (...a) => mockStripFor(...a) }));
const WA = require('../../../bot/shared/services/whatsapp.service');
const RG = require('../../../bot/shared/services/coaching/report-generator.service');

beforeEach(() => {
  updates.length = 0; jest.clearAllMocks();
  mockSwitch.mockResolvedValue(true);
  mockGroup.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
  jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); });


describe('the report image strip (SPEC §4.9)', () => {
  beforeEach(() => mockStripFor.mockReset().mockResolvedValue(null));
  test('a strip → handed to the hero render, and the clip message records image_strip', async () => {
    const STRIP = { thumbPath: '/t.jpg', title: 'T', durationS: 120 };
    mockStripFor.mockResolvedValue(STRIP);
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(mockStripFor).toHaveBeenCalledWith(expect.objectContaining({ coachingSessionId: 'sess-1' }));
    expect(RG.generatePDFReport.mock.calls[0][6]).toEqual(STRIP);
    expect(mockSendAfter.mock.calls[0][0].imageStrip).toBe(true);
  });
  test('no strip → the hero render gets null, image_strip false', async () => {
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(RG.generatePDFReport.mock.calls[0][6]).toBeNull();
    expect(mockSendAfter.mock.calls[0][0].imageStrip).toBe(false);
  });
  test('stripFor throwing never fails the report', async () => {
    mockStripFor.mockRejectedValue(new Error('boom'));
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(RG.generatePDFReport).toHaveBeenCalled();
    expect(RG.generatePDFReport.mock.calls[0][6]).toBeNull();
  });
  test('generatePDFReport puts the strip on the hero input; absent → no key (the hero opts are as today)', () => {
    const SRC = require('fs').readFileSync(require.resolve('../../../bot/shared/services/coaching/report-generator.service'), 'utf8');
    const body = SRC.slice(SRC.indexOf('static async generatePDFReport'));
    expect(body).toMatch(/static async generatePDFReport\([^)]*videoStrip = null\)/);
  });
});

describe('hook B', () => {
  test('after the report image (and the report link), before the voice debrief, with the session, phone, language and tracker', async () => {
    const order = [];
    require('../../../bot/shared/services/coaching/report-link-send').sendReportLinkIfNew.mockImplementation(async () => { order.push('link'); return false; });
    mockSendAfter.mockImplementation(async () => { order.push('video'); return { sent: true, via: 'cta' }; });
    RG.generateAndSendVoiceDebrief.mockImplementation(async () => { order.push('voice'); return true; });
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(order).toEqual(['link', 'video', 'voice']);
    expect(mockSendAfter).toHaveBeenCalledTimes(1);
    const arg = mockSendAfter.mock.calls[0][0];
    const linkArg = require('../../../bot/shared/services/coaching/report-link-send').sendReportLinkIfNew.mock.calls[0][0];
    expect(arg).toMatchObject({ coachingSessionId: 'sess-1', phone: '10000000000', language: linkArg.language });
    expect(arg.track).toBe(linkArg.track);
    expect(typeof arg.track.opts).toBe('function');
  });

  test('window closed (the report went as the template): no clip message', async () => {
    RG.sendHeroImageReport.mockResolvedValue('template');
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(mockSendAfter).not.toHaveBeenCalled();
  });

  test('the report image did not go out (heroSent false, red-team H14): no clip after a report that never arrived', async () => {
    RG.sendHeroImageReport.mockResolvedValue(false);
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(mockSendAfter).not.toHaveBeenCalled();
  });

  test('a clip failure that throws never fails the report: the voice debrief still goes', async () => {
    mockSendAfter.mockRejectedValue(new Error('boom'));
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(mockSendAfter).toHaveBeenCalledTimes(1);
    expect(RG.generateAndSendVoiceDebrief).toHaveBeenCalled();
  });

  test('flag unset, the real sender: nothing clip-shaped is sent and the store is never read', async () => {
    delete process.env.VIDEO_RECO_ENABLED;
    mockRealSend = true;
    const supabase = require('../../../bot/shared/config/supabase');
    try {
      await RG.generateReport('sess-1', { from: '10000000000' });
    } finally { mockRealSend = false; }
    const all = Object.values(WA).filter((f) => f && f.mock).flatMap((f) => f.mock.calls);
    expect(JSON.stringify(all)).not.toMatch(/\/v\/|🎬|Watch \d+ min/);
    expect(supabase.from.mock.calls.map(([t]) => t)).not.toContain('video_recommendations');
    expect(RG.generateAndSendVoiceDebrief).toHaveBeenCalled();
  });
});
