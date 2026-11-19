'use strict';
/**
 * bd-22gf7p (VIDREC R8): report-generator wiring for the clip button on the closed-window template. The harness is
 * report-generator.video-reco-send.test.js's (the DB, R2 and WhatsApp at their modules); clip-button and the window send
 * are stubbed so the wiring itself runs: _clipForSend, the image swap, and what sendHeroImageReport hands on.
 */
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true),
}));
const mockLog = jest.fn();
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: (...a) => mockLog(...a), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/utils/constants', () => ({ TEMP_DIR: '/tmp/rumi-test-r8' }));
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
jest.mock('../../../bot/shared/services/coaching/video-reco/strip', () => ({ stripFor: (...a) => mockStripFor(...a), stripWaitMs: () => 50 }));
const mockButtonFor = jest.fn(async () => null);
jest.mock('../../../bot/shared/services/coaching/video-reco/clip-button', () => ({ buttonFor: (...a) => mockButtonFor(...a) }));
jest.mock('../../../bot/shared/services/coaching/report-piece-once', () => ({ claimPiece: jest.fn(async () => true), releasePiece: jest.fn(async () => {}) }));
const mockWindowSend = jest.fn(async () => null);
jest.mock('../../../bot/shared/services/coaching/report-window-send', () => ({ ...jest.requireActual('../../../bot/shared/services/coaching/report-window-send'), sendReportByTemplateIfWindowClosed: (...a) => mockWindowSend(...a) }));
const WA = require('../../../bot/shared/services/whatsapp.service');
const RG = require('../../../bot/shared/services/coaching/report-generator.service');


const R2 = require('../../../bot/shared/storage/r2');
const BUTTON = { template: 'share_dc_report_clip_v1', token: 'tok.abc' };
const FULL = Buffer.from('FULL-button-hint');
const APP = Buffer.from('FULL-app-hint');

beforeEach(() => {
  updates.length = 0; jest.clearAllMocks();
  mockSwitch.mockResolvedValue(true);
  mockGroup.mockResolvedValue({ group: 'A', plan: 'v9', report: 'old' });
  mockStripFor.mockReset().mockResolvedValue(null);
  mockButtonFor.mockReset().mockResolvedValue(null);
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: FULL, caption: 'cap', fallbackPng: APP });
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); });

describe('bd-22gf7p: generateReport hands the clip button to the hero send', () => {
  test('no button (env unset / control) → the send options carry no clip key, the image is the rendered one (today)', async () => {
    jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
    await RG.generateReport('sess-1', { from: '10000000000' });
    const call = RG.sendHeroImageReport.mock.calls[0];
    expect(call[2]).toBe(FULL);
    expect(call[6]).not.toHaveProperty('clip');
    expect(R2.uploadReportImage).toHaveBeenCalledTimes(1); // the report itself, no swap
  });

  test('a button + a "button" strip → clip { template, token, promised, imageStrip } on the send', async () => {
    mockStripFor.mockResolvedValue({ thumbPath: '', title: 'T', durationS: 120, where: 'button' });
    mockButtonFor.mockResolvedValue(BUTTON);
    jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue('template');
    await RG.generateReport('sess-1', { from: '10000000000' });
    const { clip } = RG.sendHeroImageReport.mock.calls[0][6];
    expect(clip).toMatchObject({ ...BUTTON, promised: true, imageStrip: true });
    expect(typeof (mockButtonFor.mock.calls[0][0].row || {}).then).toBe('function');
    // the fallback stores the app-hint copy under the report's key and returns it
    expect(await clip.useFallbackImage()).toBe(APP);
    expect(R2.uploadReportImage).toHaveBeenLastCalledWith(APP, 'user-1', 'sess-1');
  });

  test('a "button" strip but no button can go → the app-hint image is stored and sent instead, at once', async () => {
    mockStripFor.mockResolvedValue({ thumbPath: '', title: 'T', durationS: 120, where: 'button' });
    jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue('template');
    await RG.generateReport('sess-1', { from: '10000000000' });
    expect(R2.uploadReportImage).toHaveBeenLastCalledWith(APP, 'user-1', 'sess-1');
    expect(RG.sendHeroImageReport.mock.calls[0][2]).toBe(APP);
    expect(RG.sendHeroImageReport.mock.calls[0][6]).not.toHaveProperty('clip');
  });
});

describe('bd-22gf7p: sendHeroImageReport', () => {
  test('no clip → the window send is asked exactly as before', async () => {
    await RG.sendHeroImageReport('10000000000', 'sess-1', FULL, 'cap', 'T', null, { userId: 'user-1' });
    expect(mockWindowSend).toHaveBeenCalledWith({ phone: '10000000000', userId: 'user-1', sessionId: 'sess-1' });
  });
  test('the clip rides to the window send; a swap during it changes the free-form image too', async () => {
    const seen = [];
    WA.sendImage.mockImplementation(async (to, p) => { seen.push(require('fs').readFileSync(p).toString()); return true; });
    mockWindowSend.mockImplementation(async (req) => { await req.clip.useFallbackImage(); return null; });
    const clip = { ...BUTTON, promised: true, useFallbackImage: jest.fn(async () => APP) };
    // staging shape: no NC5 claim, so a free-form send resolves undefined (sandbox: true); never 'template' here
    expect(await RG.sendHeroImageReport('10000000000', 'sess-1', FULL, 'cap', 'T', null, { userId: 'user-1', clip })).toBeUndefined();
    expect(mockWindowSend.mock.calls[0][0]).toMatchObject({ phone: '10000000000', userId: 'user-1', sessionId: 'sess-1', clip: { ...BUTTON, promised: true } });
    expect(clip.useFallbackImage).toHaveBeenCalled();
    expect(seen).toEqual(['FULL-app-hint']);
    expect(WA.sendImage.mock.calls[0][3]).not.toHaveProperty('clip'); // never leaks into the Graph send options
  });
});
