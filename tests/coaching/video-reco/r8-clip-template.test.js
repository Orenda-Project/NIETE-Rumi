'use strict';
/**
 * bd-22gf7p (VIDREC R8, COS ruling 20261031T144349 §2): a "Watch the clip" button on the closed-window report template.
 *
 * 29–31 Oct: 31 of 141 shown teachers had a closed WhatsApp window, so the report went as share_dc_report_v1 (IMAGE header,
 * no buttons) and the clip had no link (2 opened, via the app). With VIDEO_RECO_CLIP_TEMPLATE set, a window-closed report
 * whose row is 'shown' goes as that template, with the /v token (surface 'wa') as its URL button's parameter. Unset, a
 * control (shadow) row, or no token → share_dc_report_v1 exactly as today. The image's strip hint is true on every path.
 *
 * The send is exercised end to end — report-window-send → share-send → WhatsAppService.sendTemplate — with the Graph call
 * mocked at axios (the network boundary), the DB and R2 at their modules.
 */
process.env.SUPABASE_URL = 'https://sandbox-ref.supabase.co';
process.env.INTERNAL_API_KEY = 'k-test';
process.env.PORTAL_URL = 'https://portal.example';

jest.mock('axios');
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../bot/shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  getPresignedUrl: async (u) => `${u}?signed`,
  downloadFromR2: jest.fn(), downloadMedia: jest.fn(), extractKeyFromUrl: jest.fn(),
}));
const mockRows = {};
jest.mock('../../../bot/shared/config/supabase', () => {
  const from = jest.fn((table) => {
    const chain = {};
    ['select', 'eq', 'limit', 'order'].forEach((m) => { chain[m] = jest.fn(() => chain); });
    chain.maybeSingle = jest.fn(async () => ({ data: mockRows[table] || null, error: null }));
    return chain;
  });
  return { from };
});

const axios = require('axios');
const { logEvent } = require('../../../bot/shared/utils/structured-logger');
const { logToFile } = require('../../../bot/shared/utils/logger');
const { sendReportByTemplateIfWindowClosed } = require('../../../bot/shared/services/coaching/report-window-send');
const { verifyVideoLink } = require('../../../bot/shared/services/coaching/video-reco/link-token');
const flags = require('../../../bot/shared/services/coaching/video-reco/flags');

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER = 'bbbbbbbb-0000-4000-8000-000000000002';
const REC = 'cccccccc-0000-4000-8000-000000000003';
const ROW = { id: REC, user_id: USER, coaching_session_id: SESSION, status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229 };
const req = { phone: '920000000000', userId: USER, sessionId: SESSION };

const posted = () => axios.post.mock.calls.map((c) => c[1].template);
const graphOk = () => axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.x' }] } });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_SHARE_TEMPLATE_DC = 'share_dc_report_v1';
  process.env.VIDEO_RECO_ENABLED = 'true';
  process.env.VIDEO_RECO_CLIP_TEMPLATE = 'share_dc_report_clip_v1';
  mockRows.users = { id: USER, phone_number: '920000000000', preferred_language: 'ur' };
  mockRows.coaching_sessions = {
    id: SESSION, observation_type: 'self', report_pdf_url: 'reports/u/s_report.png',
    analysis_data: { topic: 'Parts of a plant', grade: 4, subject: 'Science' },
  };
  graphOk();
});
afterAll(() => {
  ['WHATSAPP_SHARE_TEMPLATE_DC', 'VIDEO_RECO_ENABLED', 'VIDEO_RECO_CLIP_TEMPLATE'].forEach((k) => delete process.env[k]);
});

describe('flags.videoRecoClipTemplate', () => {
  test('unset or blank → null (today); set → the name, trimmed', () => {
    expect(flags.videoRecoClipTemplate({})).toBeNull();
    expect(flags.videoRecoClipTemplate({ VIDEO_RECO_CLIP_TEMPLATE: '  ' })).toBeNull();
    expect(flags.videoRecoClipTemplate({ VIDEO_RECO_CLIP_TEMPLATE: ' share_dc_report_clip_v1 ' })).toBe('share_dc_report_clip_v1');
  });
});

describe('clip-button.forRow / buttonFor', () => {
  const CB = require('../../../bot/shared/services/coaching/video-reco/clip-button');
  test('shown row + env → the template and a /v token for this row, surface wa', () => {
    const b = CB.forRow(ROW);
    expect(b.template).toBe('share_dc_report_clip_v1');
    expect(verifyVideoLink(b.token)).toEqual({ ok: true, recommendationId: REC, userId: USER, surface: 'wa' });
  });
  test.each([
    ['control arm (shadow)', { ...ROW, status: 'shadow' }],
    ['none', { ...ROW, status: 'none' }],
    ['no row', null],
  ])('%s → null', (_, row) => { expect(CB.forRow(row)).toBeNull(); });
  test('env unset → null; engine off → null; no signing key → null', () => {
    delete process.env.VIDEO_RECO_CLIP_TEMPLATE;
    expect(CB.forRow(ROW)).toBeNull();
    process.env.VIDEO_RECO_CLIP_TEMPLATE = 'share_dc_report_clip_v1';
    process.env.VIDEO_RECO_ENABLED = 'false';
    expect(CB.forRow(ROW)).toBeNull();
    process.env.VIDEO_RECO_ENABLED = 'true';
    const k = process.env.INTERNAL_API_KEY;
    delete process.env.INTERNAL_API_KEY;
    try { expect(CB.forRow(ROW)).toBeNull(); } finally { process.env.INTERNAL_API_KEY = k; }
  });
  test('env unset → buttonFor never waits for the row (today\'s timing)', async () => {
    delete process.env.VIDEO_RECO_CLIP_TEMPLATE;
    const never = new Promise(() => {});
    const t0 = Date.now();
    expect(await CB.buttonFor({ row: never, capMs: 2000 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(200);
  });
  test('buttonFor waits for the engine\'s promise (≤ cap)', async () => {
    expect((await CB.buttonFor({ row: Promise.resolve(ROW), capMs: 500 })).template).toBe('share_dc_report_clip_v1');
    expect(await CB.buttonFor({ row: new Promise(() => {}), capMs: 20 })).toBeNull();
  });
});

describe('report-window-send → share-send → Graph (the live send)', () => {
  const CB = require('../../../bot/shared/services/coaching/video-reco/clip-button');
  const markSent = jest.fn(async () => true);
  const run = (clip, windowOpen = async () => false) => sendReportByTemplateIfWindowClosed({ ...req, ...(clip ? { clip } : {}) }, { windowOpen, markSent });

  test('window closed + shown + env → the clip template, the button carrying the /v token; marked template_button', async () => {
    const clip = { ...CB.forRow(ROW), promised: true, imageStrip: true };
    expect(await run(clip)).toBe('template');
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [t] = posted();
    expect(t.name).toBe('share_dc_report_clip_v1');
    expect(t.language).toEqual({ code: 'ur' });
    expect(t.components.map((c) => c.type)).toEqual(['header', 'body', 'button']);
    expect(t.components[1].parameters).toHaveLength(2); // the same body variables as share_dc_report_v1
    const btn = t.components[2];
    expect(btn).toMatchObject({ type: 'button', sub_type: 'url', index: '0' });
    expect(verifyVideoLink(btn.parameters[0].text)).toMatchObject({ ok: true, recommendationId: REC, surface: 'wa' });
    expect(markSent).toHaveBeenCalledWith(SESSION, { sent_via: 'template_button', wamid: null, image_strip: true });
  });

  test('no clip (env unset / control / no token) → share_dc_report_v1 exactly as today, no button, no marker', async () => {
    expect(await run(undefined)).toBe('template');
    const [t] = posted();
    expect(t.name).toBe('share_dc_report_v1');
    expect(t.components.map((c) => c.type)).toEqual(['header', 'body']);
    expect(markSent).not.toHaveBeenCalled();
  });

  test('clip template refused → share_dc_report_v1, and the app-hint image is put in place first (promised)', async () => {
    const order = [];
    const useFallbackImage = jest.fn(async () => { order.push('swap'); return Buffer.from('APP'); });
    axios.post.mockImplementation(async (_, body) => { order.push(body.template.name); return { data: {} }; });
    axios.post.mockRejectedValueOnce({ response: { data: { error: { code: 132001, message: 'no template' } } } });
    const clip = { ...CB.forRow(ROW), promised: true, imageStrip: true, useFallbackImage };
    expect(await run(clip)).toBe('template');
    expect(posted().map((t) => t.name)).toEqual(['share_dc_report_clip_v1', 'share_dc_report_v1']);
    expect(order).toEqual(['swap', 'share_dc_report_v1']);
    expect(markSent).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith('coaching.report.clip_template_not_sent', expect.objectContaining({ status: 'unavailable', reason: 'template_missing' }));
  });

  test('refused and no app-hint image could be stored → the report still goes, logged at error', async () => {
    axios.post.mockRejectedValueOnce({ response: { data: { error: { code: 131000 } } } });
    const clip = { ...CB.forRow(ROW), promised: true, useFallbackImage: async () => null };
    expect(await run(clip)).toBe('template');
    expect(posted()[1].name).toBe('share_dc_report_v1');
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/button hint and no button/), expect.anything(), 'error');
  });

  test('not promised (no button strip) and refused → no image swap', async () => {
    axios.post.mockRejectedValueOnce({ response: { data: { error: { code: 131000 } } } });
    const useFallbackImage = jest.fn();
    expect(await run({ ...CB.forRow(ROW), promised: false, useFallbackImage })).toBe('template');
    expect(useFallbackImage).not.toHaveBeenCalled();
  });

  test('promised → the window is not consulted (the image says "button": it never goes free-form first)', async () => {
    const windowOpen = jest.fn(async () => true);
    expect(await run({ ...CB.forRow(ROW), promised: true }, windowOpen)).toBe('template');
    expect(windowOpen).not.toHaveBeenCalled();
    expect(posted()[0].name).toBe('share_dc_report_clip_v1');
  });

  test('not promised + window open → today\'s free-form send (null), nothing posted', async () => {
    expect(await run({ ...CB.forRow(ROW), promised: false }, async () => true)).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('share-send ignores a clip on any kind but dc, and a clip without a token', async () => {
    const { sendShare } = require('../../../bot/shared/services/share-send.service');
    await sendShare({ userId: USER, kind: 'dc', id: SESSION, clip: { template: 'share_dc_report_clip_v1', token: '' } });
    expect(posted()[0].name).toBe('share_dc_report_v1');
    expect(posted()[0].components).toHaveLength(2);
  });
});

describe('the strip hint matches what the teacher gets', () => {
  const S = require('../../../bot/shared/services/coaching/video-reco/strip');
  const catalog = { segment: () => ({ module: { module_id: 63, title: 'Questioning' }, segment: { title_en: 'Asking why', title_ur: 'کیوں والے سوال' } }) };
  const run = (over = {}) => S.stripFor({
    coachingSessionId: SESSION, language: 'en', row: Promise.resolve(ROW), capMs: 500, phone: '920000000000', userId: USER,
    deps: { enabled: () => true, waMessage: () => false, catalog, onTeacherApp: async () => false, windowOpen: async () => false, ...over },
  });

  test('off the app, window closed, button can go → "button"', async () => {
    expect((await run()).where).toBe('button');
  });
  test('env unset (no button) → no strip, as today', async () => {
    delete process.env.VIDEO_RECO_CLIP_TEMPLATE;
    expect(await run()).toBeNull();
  });
  test('window open with < 30 min left → no strip (the send may go free-form): never "button"', async () => {
    const windowOpen = jest.fn(async (_, o) => !(o && o.marginMs > 0));
    expect(await run({ windowOpen })).toBeNull();
    expect(windowOpen).toHaveBeenCalledWith('920000000000', { marginMs: 0 });
  });
  test('on the teacher app → still "app"; window open → still "link"', async () => {
    expect((await run({ onTeacherApp: async () => true })).where).toBe('app');
    expect((await run({ windowOpen: async () => true })).where).toBe('link');
  });
  test('a control row → no button check, no strip', async () => {
    const clipButton = jest.fn(() => null);
    expect(await S.stripFor({ coachingSessionId: SESSION, language: 'en', row: Promise.resolve({ ...ROW, status: 'shadow' }), capMs: 50, phone: '920000000000', userId: USER, deps: { enabled: () => true, clipButton } })).toBeNull();
    expect(clipButton).not.toHaveBeenCalled();
  });

  test.each([
    ['en', '2 min · tap the button under this picture'],
    ['ur', '۲ منٹ · اس تصویر کے نیچے بٹن دبائیں'],
  ])('stripHtml %s "button" hint', (language, hint) => {
    const html = S.stripHtml({ thumbPath: '', title: 'T', durationS: 134, where: 'button' }, { language, T: (s) => s });
    expect(html.replace(/[‎‏⁦-⁩]/g, '')).toContain(hint);
  });
  test('the button hint fits the strip like its siblings (code points)', () => {
    const { UX_STRINGS } = require('../../../bot/shared/config/ux-strings');
    const v = UX_STRINGS.videoRecoStripHintTemplate;
    expect([...v.en].length).toBeLessThanOrEqual(60);
    expect([...v.ur].length).toBeLessThanOrEqual(60);
  });
});

describe('the hero keeps an app-hint copy only when the strip promises the button', () => {
  let shots;
  let generateHeroReport;
  beforeAll(() => {
    jest.resetModules();
    shots = [];
    jest.doMock('../../../bot/shared/services/coaching/report-v2/narrative.service', () => ({
      ...jest.requireActual('../../../bot/shared/services/coaching/report-v2/narrative.service'),
      generateReportNarrative: async () => ({ strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.', moments: [] }),
    }));
    jest.doMock('../../../bot/shared/utils/html-to-pdf', () => ({ htmlToImage: async (html) => { shots.push(String(html)); return Buffer.from(String(html)); } }));
    jest.doMock('../../../bot/shared/services/coaching/coaching-trend.service', () => ({ loadTrendData: jest.fn(async () => []) }));
    jest.doMock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn(), extractKeyFromUrl: jest.fn() }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    ({ generateHeroReport } = require('../../../bot/shared/services/coaching/report-v2/hero-report.service'));
  });
  beforeEach(() => { shots.length = 0; });
  const session = { id: SESSION, user_id: USER, created_at: '2026-10-31T10:00:00Z', transcript_text: 'x' };
  const analysis = { framework: 'fico', scores: {} };
  const strip = (where) => ({ thumbPath: '', title: 'Asking why', durationS: 134, where });

  test('"button" strip → png says button, fallbackPng says app (same narrative, one call)', async () => {
    const out = await generateHeroReport(session, analysis, { language: 'en', videoStrip: strip('button') });
    expect(out.png.toString()).toContain('tap the button under this picture');
    expect(out.fallbackPng.toString()).toContain('watch it in your report in the app');
    expect(out.fallbackPng.toString()).not.toContain('tap the button');
  });
  test.each(['app', 'link', 'next'])('"%s" strip → no extra render, no fallbackPng (as today)', async (where) => {
    const out = await generateHeroReport(session, analysis, { language: 'en', videoStrip: strip(where) });
    expect(shots).toHaveLength(1);
    expect(out).not.toHaveProperty('fallbackPng');
  });
});
