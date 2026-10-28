'use strict';
/**
 * bd-gzfdu9 R7p (COS 20261026T043131 §1): every promise the strip on the report IMAGE makes is true on every path.
 *
 * The image is rendered BEFORE the send (report-generator.service.js stripFor → generatePDFReport) and the 24 h window
 * is known only AT the send (sendHeroImageReport → report-window-send). The rendered image is also stored and reused:
 * the share template's header when the window is closed (no next message), the app's Share button (a template again),
 * and the app's report page. So the strip's hint is chosen at the render, from what is true wherever the image goes:
 *   - the teacher is on the teacher app      → "watch it in your report in the app" (the app's report page carries the
 *                                              clip card on every path)
 *   - else the window is open, ≥ 30 min left → "tap ▶ Watch in the next message" (the clip message follows the image)
 *   - else                                   → no strip: nothing true to promise (the image renders as today)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
const shown = (s) => String(s).replace(/[‎‏⁦-⁩]/g, '');

const thumb = path.join(os.tmpdir(), `vr-r7p-${process.pid}.jpg`);
beforeAll(() => fs.writeFileSync(thumb, Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
afterAll(() => fs.rmSync(thumb, { force: true }));

const ROW = { id: 'r', coaching_session_id: 's', status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229 };
const catalog = { segment: () => ({ module: { module_id: 63, title: 'Questioning', thumb: 'video-thumbs/63.jpg' }, segment: { title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال' } }) };

describe('stripFor: where the clip is, decided at the render', () => {
  const S = require('../../../bot/shared/services/coaching/video-reco/strip');
  const run = (over = {}, args = {}) => {
    // bd-9dbhh0.1: these pin where the hint points with the clip message on ('next'); off → 'link' (skip-iab.test.js)
    const deps = { enabled: () => true, waMessage: () => true, catalog, onTeacherApp: jest.fn(async () => false), windowOpen: jest.fn(async () => true), ...over };
    return { deps, out: S.stripFor({ coachingSessionId: 's', language: 'en', row: Promise.resolve(ROW), capMs: 1000, phone: '920000000000', userId: 'u1', deps, ...args }) };
  };

  test('on the teacher app → "app", whatever the window (the image may go as the template)', async () => {
    const { deps, out } = run({ onTeacherApp: jest.fn(async () => true), windowOpen: jest.fn(async () => false) });
    expect((await out).where).toBe('app');
    expect(deps.onTeacherApp).toHaveBeenCalledWith('u1');
  });

  test('off the app, window open with ≥ 30 min left → "next"; the check is asked for the margin', async () => {
    const { deps, out } = run();
    expect((await out).where).toBe('next');
    expect(deps.windowOpen).toHaveBeenCalledWith('920000000000', { marginMs: 30 * 60 * 1000 });
    expect(S.STRIP_WINDOW_MARGIN_MS).toBe(30 * 60 * 1000);
  });

  test('off the app, window closed (or < 30 min left) → no strip: the template carries no next message', async () => {
    const { out } = run({ windowOpen: jest.fn(async () => false) });
    expect(await out).toBeNull();
  });

  test('a check that throws → no strip (fail closed: never promise what may be false)', async () => {
    expect(await run({ onTeacherApp: jest.fn(async () => { throw new Error('db'); }) }).out).toBeNull();
    expect(await run({ windowOpen: jest.fn(async () => { throw new Error('db'); }) }).out).toBeNull();
  });

  test('no phone and no user → no strip', async () => {
    expect(await run({}, { phone: undefined, userId: undefined }).out).toBeNull();
  });

  test('nothing is checked unless the pick is shown (off / shadow / none read no window and no app switch)', async () => {
    const { deps, out } = run({}, { row: Promise.resolve({ ...ROW, status: 'none' }) });
    expect(await out).toBeNull();
    expect(deps.onTeacherApp).not.toHaveBeenCalled();
    expect(deps.windowOpen).not.toHaveBeenCalled();
  });
});

describe('stripHtml: the hint names where the clip is', () => {
  const { stripHtml } = require('../../../bot/shared/services/coaching/video-reco/strip');
  const T = (s) => s;
  const V = { thumbPath: thumb, title: 'Asking why-questions', durationS: 134 };
  test.each([
    ['en', 'app', '2 min · watch it in your report in the app'],
    ['ur', 'app', '۲ منٹ · ایپ میں اپنی رپورٹ پر دیکھیں'],
    ['en', 'next', '2 min · tap ▶ Watch in the next message'],
    ['ur', 'next', '۲ منٹ · اگلے پیغام میں ▶ دیکھیں دبائیں'],
  ])('%s %s', (language, where, hint) => {
    const html = shown(stripHtml({ ...V, where }, { language, T }));
    expect(html).toContain(hint);
    if (where === 'app') expect(html).not.toMatch(/next message|اگلے پیغام/);
  });
  test('the app hint fits the 60-code-point line in both languages (n up to 99)', () => {
    const { word } = require('../../../bot/shared/services/coaching/video-reco/copy');
    for (const l of ['en', 'ur']) expect([...word('videoRecoStripHintApp', l, { n: '99' })].length).toBeLessThanOrEqual(60);
  });
});

// The live branch: report-generator renders the image for a session whose window is CLOSED — the image then goes as
// the share template (sendHeroImageReport → 'template'), so no clip message follows it.
describe('report-generator: the template path', () => {
  const RGPATH = '../../../bot/shared/services/coaching/report-generator.service';
  const ENV = { ...process.env };
  afterEach(() => { jest.restoreAllMocks(); jest.resetModules(); process.env = { ...ENV }; });

  async function render({ onApp, open }) {
    jest.resetModules();
    process.env.VIDEO_RECO_ENABLED = 'true';
    process.env.VIDEO_RECO_MODE = 'ab';
    process.env.VIDEO_RECO_REASON = 'card';
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true), sendImage: jest.fn(async () => true), sendInteractiveButtons: jest.fn(async () => true), sendDocument: jest.fn(async () => true) }));
    jest.doMock('../../../bot/shared/storage/r2', () => ({ uploadReportImage: jest.fn(async () => 'https://r2.example/report.png'), uploadReportPDF: jest.fn(async () => 'u'), uploadImageWithRetry: jest.fn(async () => 'u'), uploadVoiceDebrief: jest.fn(async () => 'u') }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-card/commitment-card.service', () => ({ generateCommitmentCard: jest.fn(async () => ({ _source: 'llm', commitment: 'c', action: 'Ask two why questions', language: 'en' })) }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadPriorAction: jest.fn(async () => null), loadTrendData: jest.fn(async () => []), loadRecentSectionBModes: jest.fn(async () => []) }));
    jest.doMock('../../../bot/shared/services/coaching/ab-v10-switch', () => ({ v10Enabled: jest.fn(async () => false) }));
    jest.doMock('../../../bot/shared/services/coaching/report-link-send', () => ({ sendReportLinkIfNew: jest.fn(async () => false) }));
    jest.doMock('../../../bot/shared/services/coaching/video-reco/send', () => ({ sendAfterReport: jest.fn(async () => ({ sent: false })) }));
    jest.doMock('../../../bot/shared/services/coaching/video-reco/engine', () => ({ recommendForReport: () => Promise.resolve({ ...ROW, seg_id: '51-s1', module_id: 51 }) }));
    const onTeacherApp = jest.fn(async () => onApp);
    const windowOpen = jest.fn(async () => open);
    jest.doMock('../../../bot/shared/services/app-redirect.service', () => ({ isOnTeacherApp: onTeacherApp }));
    jest.doMock('../../../bot/shared/services/quiz/quiz-delivery.service', () => ({ _hasOpenMessageWindow: windowOpen }));
    const session = {
      id: 'sess-1', user_id: 'user-1', status: 'analysis_complete', created_at: '2026-10-20T00:00:00Z', conversation_state: { questions: [] },
      analysis_data: { framework: 'fico', domains: {} }, transcript_language: 'en',
      users: { phone_number: '920000000000', name: 'T', region: 'ICT', preferred_language: 'en' },
    };
    jest.doMock('../../../bot/shared/config/supabase', () => {
      const chain = {};
      ['select', 'eq', 'not', 'neq', 'order', 'limit', 'in', 'gte', 'upsert', 'update', 'insert'].forEach((m) => { chain[m] = jest.fn(() => chain); });
      chain.single = jest.fn(async () => ({ data: session, error: null }));
      chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
      chain.then = (resolve) => resolve({ data: null, error: null });
      return { from: jest.fn(() => chain) };
    });
    const RG = require(RGPATH);
    jest.spyOn(RG, 'enhanceAnalysisWithReflections').mockResolvedValue({ framework: 'fico', domains: {} });
    const gen = jest.spyOn(RG, 'generatePDFReport').mockResolvedValue({ png: Buffer.from('PNG'), caption: 'cap' });
    jest.spyOn(RG, 'sendHeroImageReport').mockResolvedValue(open ? true : 'template');
    jest.spyOn(RG, 'generateAndSendVoiceDebrief').mockResolvedValue(true);
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    await RG.generateReport('sess-1', { from: '920000000000' });
    expect(gen).toHaveBeenCalledTimes(1);
    return { strip: gen.mock.calls[0][6], onTeacherApp, windowOpen };
  }

  test('window closed, teacher on the app → the strip says "in the app"', async () => {
    const { strip, onTeacherApp } = await render({ onApp: true, open: false });
    expect(strip).toMatchObject({ where: 'app' });
    expect(onTeacherApp).toHaveBeenCalledWith('user-1');
  });

  test('window closed, teacher not on the app → no strip on the image (the template has no next message)', async () => {
    const { strip, windowOpen } = await render({ onApp: false, open: false });
    expect(strip).toBeNull();
    expect(windowOpen).toHaveBeenCalledWith('920000000000', { marginMs: 30 * 60 * 1000 });
  });

  test('window open, teacher not on the app, the clip message on → "next message" as before', async () => {
    process.env.VIDEO_RECO_WA_MESSAGE = 'true'; // bd-9dbhh0.1: off by default ("link", skip-iab.test.js)
    try {
      const { strip } = await render({ onApp: false, open: true });
      expect(strip).toMatchObject({ where: 'next' });
    } finally {
      delete process.env.VIDEO_RECO_WA_MESSAGE;
    }
  });
});

describe('_hasOpenMessageWindow: an optional margin, default unchanged', () => {
  const ENV = { ...process.env };
  afterEach(() => { jest.resetModules(); process.env = { ...ENV }; });
  async function cutoffFor(opts) {
    jest.resetModules();
    jest.dontMock('../../../bot/shared/services/quiz/quiz-delivery.service'); // the block above doMocks it; that outlives resetModules
    const gte = [];
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../../bot/shared/services/quiz/meta-window-cache.service', () => ({ isWindowClosed: async () => false }));
    jest.doMock('../../../bot/shared/config/supabase', () => {
      const chain = {};
      ['select', 'eq', 'order', 'limit'].forEach((m) => { chain[m] = jest.fn(() => chain); });
      chain.gte = jest.fn((col, v) => { gte.push(v); return chain; });
      chain.single = jest.fn(async () => ({ data: { id: 'u' }, error: null }));
      return { from: jest.fn(() => chain) };
    });
    const Q = require('../../../bot/shared/services/quiz/quiz-delivery.service');
    const t0 = Date.now();
    await (opts === undefined ? Q._hasOpenMessageWindow('920000000000') : Q._hasOpenMessageWindow('920000000000', opts));
    return { ageMs: t0 - Date.parse(gte[0]), W: Q.MESSAGE_WINDOW_MS };
  }
  test('no margin → the cutoff is the window, as today', async () => {
    const { ageMs, W } = await cutoffFor(undefined);
    expect(Math.abs(ageMs - W)).toBeLessThan(2000);
  });
  test('marginMs → the window must have that long left', async () => {
    const { ageMs, W } = await cutoffFor({ marginMs: 30 * 60 * 1000 });
    expect(Math.abs(ageMs - (W - 30 * 60 * 1000))).toBeLessThan(2000);
  });
});
