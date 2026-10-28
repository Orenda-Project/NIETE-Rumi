'use strict';
/**
 * bd-9dbhh0.1 (VIDREC), COS 20261028T151950 §1.1–1.2, red7 152411 gates 1, 2, 5: on the real report path
 * (report-generator.generateReport, hero image) the clip's /v link is the END of the report image's caption and NO clip
 * message follows; the row records sent_via 'caption'. Engine off, a row that is not 'shown', or the message switched
 * back on → the caption is exactly what it was. The engine's pick is faked (its promise); caption-link, send and the
 * link token are real. The harness of report-generator.video-reco-send.test.js.
 */
jest.mock('../../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendImageFromUrl: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true), sendCtaUrl: jest.fn(async () => true),
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


const SID = 'sess-1';
const REC = '1a2b3c4d-1111-4222-8333-444455556666';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
let mockRow = null;
jest.mock('../../../bot/shared/services/coaching/video-reco/engine', () => ({
  recommendForReport: jest.fn(() => Promise.resolve(mockRow)),
  prefetchReads: jest.fn(() => false),
}));
const mockMarkSent = jest.fn(async () => true);
jest.mock('../../../bot/shared/services/coaching/video-reco/store', () => ({
  markSent: (...a) => mockMarkSent(...a), readForSession: jest.fn(async () => mockRow),
}));
jest.mock('../../../bot/shared/services/coaching/video-reco/report-via', () => ({ recordReportPath: jest.fn(async () => true) }));
const mockStripFor = jest.fn(async () => null);
jest.mock('../../../bot/shared/services/coaching/video-reco/strip', () => ({
  ...jest.requireActual('../../../bot/shared/services/coaching/video-reco/strip'), stripFor: (...a) => mockStripFor(...a),
}));
const WA = require('../../../bot/shared/services/whatsapp.service');
const RG = require('../../../bot/shared/services/coaching/report-generator.service');

const ENV = { ...process.env };
const SHOWN = { id: REC, user_id: UID, coaching_session_id: SID, status: 'shown', arm: 'video', module_id: 10, seg_id: '10-s1', start_s: 30, end_s: 210, reason_en: 'r', reason_ur: 'ر' };
beforeEach(() => {
  updates.length = 0; jest.clearAllMocks();
  process.env = { ...ENV, VIDEO_RECO_ENABLED: 'true', INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk', VIDEO_RECO_STRIP_WAIT_MS: '200' };
  delete process.env.VIDEO_RECO_WA_MESSAGE;
  delete process.env.VIDEO_RECO_MODE;
  mockRow = SHOWN;
  mockSwitch.mockResolvedValue(true);
  mockGroup.mockResolvedValue({ group: 'C', plan: 'v9', report: 'new' });
  jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue(JSON.parse(JSON.stringify(ANALYSIS)));
  jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
  jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(true);
  jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { process.env = ENV; });

const captionSent = () => RG.sendHeroImageReport.mock.calls[0][3];
const LINK = /\n\n▶‏? (?:Watch next|اگلا دیکھیں) \([^)]*\): [^\n]*\nhttps:\/\/portal\.example\.pk\/v\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/;

describe('the report caption carries the clip link; no clip message', () => {
  test('shown row → the caption starts with the report caption and ENDS with the label + the /v link; no cta_url, no text with the link', async () => {
    await RG.generateReport(SID, { from: '10000000000' });
    const cap = captionSent();
    expect(cap.startsWith('cap')).toBe(true);
    expect(cap).toMatch(LINK);
    expect([...cap].length).toBeLessThanOrEqual(1024);
    const url = cap.split('\n').pop();
    const v = require('../../../bot/shared/services/coaching/video-reco/link-token').verifyVideoLink(url.split('/v/')[1]);
    expect(v).toMatchObject({ ok: true, recommendationId: REC, userId: UID, surface: 'wa' });
    // no separate clip message: nothing but the caption ever carries the link
    const texts = WA.sendMessage.mock.calls.map((c) => String(c[1]));
    expect(texts.some((t) => t.includes('/v/'))).toBe(false);
    expect(WA.sendCtaUrl).not.toHaveBeenCalled();
    expect(mockMarkSent).toHaveBeenCalledWith(SID, { sent_via: 'caption', wamid: null, image_strip: false });
  });

  test('a strip on the image → image_strip recorded with the caption link', async () => {
    mockStripFor.mockResolvedValue({ thumbPath: '/t.jpg', title: 'T', durationS: 120, where: 'link' });
    await RG.generateReport(SID, { from: '10000000000' });
    expect(captionSent()).toMatch(LINK);
    expect(mockMarkSent).toHaveBeenCalledWith(SID, { sent_via: 'caption', wamid: null, image_strip: true });
  });

  test.each([
    ['engine off', () => { delete process.env.VIDEO_RECO_ENABLED; }],
    ['control / shadow row', () => { mockRow = { ...SHOWN, status: 'shadow', arm: 'control' }; }],
    ['stopped teacher (none / opted_out)', () => { mockRow = { ...SHOWN, status: 'none', none_reason: 'opted_out' }; }],
    ['no row', () => { mockRow = null; }],
    ['clip message switched back on', () => { process.env.VIDEO_RECO_WA_MESSAGE = 'true'; }],
  ])('%s → the caption exactly as before, no markSent', async (_n, set) => {
    set();
    await RG.generateReport(SID, { from: '10000000000' });
    const cap = captionSent();
    expect(cap.includes('/v/')).toBe(false);
    expect(cap.startsWith('cap')).toBe(true);
    expect(mockMarkSent).not.toHaveBeenCalledWith(SID, expect.objectContaining({ sent_via: 'caption' }));
  });

  test('flag-off identity: the caption with the engine off equals the caption with a shown row minus its link block', async () => {
    await RG.generateReport(SID, { from: '10000000000' });
    const withLink = captionSent();
    jest.clearAllMocks();
    delete process.env.VIDEO_RECO_ENABLED;
    await RG.generateReport(SID, { from: '10000000000' });
    const off = captionSent();
    expect(withLink.replace(LINK, '')).toBe(off);
  });

  test('window closed (the report went as the template): no markSent — the template text is Meta\'s', async () => {
    RG.sendHeroImageReport.mockResolvedValue('template');
    await RG.generateReport(SID, { from: '10000000000' });
    expect(mockMarkSent).not.toHaveBeenCalled();
  });
});
