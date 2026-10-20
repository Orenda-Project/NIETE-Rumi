'use strict';
/**
 * bd-gzfdu9 (VIDREC): the one "watch this clip" message after the report (SPEC §4.3).
 * cta_url with the video card as its header → the same without the picture → plain text with the link.
 * Once per session (claimPiece 'video', given back on a failed send), tracked as report part 'video', the
 * send recorded on the row (markSent). Only for status 'shown'; never throws.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const ENV = { ...process.env };
const REC = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const SESSION = '1a2b3c4d-1111-4222-8333-444455556666';
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const PHONE = '923000000001';

const ROW = {
  id: REC, coaching_session_id: SESSION, user_id: USER, status: 'shown', arm: 'video',
  module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229,
  reason_en: 'At 12:40 you asked "What is a noun?" and moved on. This clip shows a teacher asking why and waiting.',
  reason_ur: 'آپ نے 12:40 پر پوچھا "اسم کیا ہے؟" اور آگے بڑھ گئے۔ اس کلپ میں ایک استاد wait time دیتے ہیں۔',
};
const CATALOG_HIT = {
  module: { module_id: 63, title: 'Questioning', language: 'ur', cpd_level: 1, thumb: 'video-thumbs/63.jpg' },
  segment: { seg_id: '63-s2', title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال', start_s: 95, end_s: 229 },
};

let send; let deps; let wa; let calls;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk' };
  calls = [];
  wa = {
    sendCtaUrl: jest.fn(async (to, o, opts) => { calls.push(o.headerImage ? 'cta_header' : 'cta'); if (opts && opts.onMessageId) opts.onMessageId('wamid.X'); return true; }),
    sendMessage: jest.fn(async () => { calls.push('text'); return true; }),
  };
  deps = {
    whatsapp: wa,
    store: { readForSession: jest.fn(async () => ROW), markSent: jest.fn(async () => undefined) },
    catalog: { segment: jest.fn(() => CATALOG_HIT) },
    claimPiece: jest.fn(async () => true),
    releasePiece: jest.fn(async () => undefined),
    renderCard: jest.fn(async () => Buffer.from('PNG')),
    enabled: () => true,
  };
  send = require('../../../bot/shared/services/coaching/video-reco/send');
});
afterAll(() => { process.env = ENV; });

const track = () => {
  const t = { recorded: [], opts: jest.fn((part) => ({ onMessageId: jest.fn(), part })), record: jest.fn(async (part, ok) => { t.recorded.push([part, ok]); }) };
  return t;
};

test('shown row: one cta_url with the video card header, the link, the button; tracked and marked sent', async () => {
  const tr = track();
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', track: tr, deps });
  expect(out).toEqual({ sent: true, via: 'cta_header' });
  expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
  const [to, o, opts] = wa.sendCtaUrl.mock.calls[0];
  expect(to).toBe(PHONE);
  expect(o.url).toMatch(/^https:\/\/portal\.example\.pk\/v\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  expect(o.buttonText.replace(/[‎‏⁦-⁩]/g, '')).toBe('▶ Watch 2 min');
  expect(o.body).toContain(ROW.reason_en);
  expect(o.body).toContain('⏱ 2 min · Urdu');
  expect(o.headerImage).toEqual(Buffer.from('PNG'));
  expect(tr.opts).toHaveBeenCalledWith('video');
  expect(typeof opts.onMessageId).toBe('function');
  expect(tr.recorded).toEqual([['video', true]]);
  expect(deps.claimPiece).toHaveBeenCalledWith(SESSION, 'video');
  expect(deps.markSent).toBeUndefined();
  expect(deps.store.markSent).toHaveBeenCalledWith(SESSION, { sent_via: 'cta_header', wamid: 'wamid.X', image_strip: false });
  expect(deps.releasePiece).not.toHaveBeenCalled();
});

test('the card gets the clip title in the teacher\'s language, its length, the level chip and the module thumbnail', async () => {
  await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'ur', deps });
  const vm = deps.renderCard.mock.calls[0][0];
  expect(vm).toMatchObject({ title: 'کیوں والے سوال', durationS: 134, language: 'ur' });
  expect(vm.levelLabel.replace(/[‎‏⁦-⁩]/g, '')).toBe('لیول ۱');
  expect(vm.thumbPath).toMatch(/bot\/assets\/video-thumbs\/63\.jpg$/);
  const body = wa.sendCtaUrl.mock.calls[0][1].body;
  expect(body).toContain('⁦wait time⁩');
});

test('no picture (render failed) → the button without a header', async () => {
  deps.renderCard.mockResolvedValue(null);
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', deps });
  expect(out).toEqual({ sent: true, via: 'cta' });
  expect(calls).toEqual(['cta']);
});

test('cascade: header refused → plain button refused → text with the link', async () => {
  wa.sendCtaUrl.mockImplementation(async (to, o) => { calls.push(o.headerImage ? 'cta_header' : 'cta'); return false; });
  const tr = track();
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', track: tr, deps });
  expect(calls).toEqual(['cta_header', 'cta', 'text']);
  expect(out).toEqual({ sent: true, via: 'text' });
  const text = wa.sendMessage.mock.calls[0][1];
  expect(text).toContain(ROW.reason_en);
  expect(text.split('\n').pop()).toMatch(/^https:\/\/portal\.example\.pk\/v\//);
  expect(deps.store.markSent).toHaveBeenCalledWith(SESSION, { sent_via: 'text', wamid: null, image_strip: false });
});

test('everything refused → not sent, the claim given back, recorded as failed, never throws', async () => {
  wa.sendCtaUrl.mockResolvedValue(false);
  wa.sendMessage.mockRejectedValue(new Error('131047'));
  const tr = track();
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', track: tr, deps });
  expect(out).toEqual({ sent: false, via: null });
  expect(deps.releasePiece).toHaveBeenCalledWith(SESSION, 'video');
  expect(tr.recorded).toEqual([['video', false]]);
  expect(deps.store.markSent).not.toHaveBeenCalled();
});

test('already sent for this session (claim taken) → nothing', async () => {
  deps.claimPiece.mockResolvedValue(false);
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', deps });
  expect(out).toEqual({ sent: false, via: null });
  expect(wa.sendCtaUrl).not.toHaveBeenCalled();
});

test.each([['shadow'], ['none'], ['error']])('status %s → nothing sent, nothing claimed', async (status) => {
  const out = await send.sendVideoRecommendation({ row: { ...ROW, status }, phone: PHONE, language: 'en', deps });
  expect(out).toEqual({ sent: false, via: null });
  expect(deps.claimPiece).not.toHaveBeenCalled();
  expect(wa.sendCtaUrl).not.toHaveBeenCalled();
});

test('already sent (row.sent_via set: a retry after Redis lost the claim, red-team H9) → nothing', async () => {
  const out = await send.sendVideoRecommendation({ row: { ...ROW, sent_via: 'cta' }, phone: PHONE, language: 'en', deps });
  expect(out).toEqual({ sent: false, via: null });
  expect(deps.claimPiece).not.toHaveBeenCalled();
});

test('the WhatsApp link is minted for surface wa', async () => {
  await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', deps });
  const url = wa.sendCtaUrl.mock.calls[0][1].url;
  const { verifyVideoLink } = require('../../../bot/shared/services/coaching/video-reco/link-token');
  expect(verifyVideoLink(url.split('/v/')[1]).surface).toBe('wa');
});

test('no PORTAL_URL (no link) → nothing sent', async () => {
  process.env.PORTAL_URL = '';
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', deps });
  expect(out).toEqual({ sent: false, via: null });
  expect(wa.sendCtaUrl).not.toHaveBeenCalled();
});

test('the clip is not in the catalogue → still sent, the row\'s own times, no picture title from nowhere', async () => {
  deps.catalog.segment.mockReturnValue(null);
  const out = await send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', deps });
  expect(out.sent).toBe(true);
  expect(wa.sendCtaUrl.mock.calls[0][1].body).toContain('2-minute');
});

test('a thrown error anywhere is swallowed (the report is never touched)', async () => {
  deps.claimPiece.mockRejectedValue(new Error('redis'));
  await expect(send.sendVideoRecommendation({ row: ROW, phone: PHONE, language: 'en', deps })).resolves.toEqual({ sent: false, via: null });
});

describe('sendAfterReport (hooks B and B2): the row is read by session', () => {
  test('flag off → no read, no send', async () => {
    deps.enabled = () => false;
    const out = await send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', deps });
    expect(out).toEqual({ sent: false, via: null });
    expect(deps.store.readForSession).not.toHaveBeenCalled();
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });
  test('flag on, no row → nothing', async () => {
    deps.store.readForSession.mockResolvedValue(null);
    expect(await send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', deps })).toEqual({ sent: false, via: null });
    expect(wa.sendCtaUrl).not.toHaveBeenCalled();
  });
  test('imageStrip: the row records that the report image carried the clip', async () => {
    await send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', imageStrip: true, deps });
    expect(deps.store.markSent).toHaveBeenCalledWith(SESSION, { sent_via: 'cta_header', wamid: 'wamid.X', image_strip: true });
  });
  test('flag on, shown row → sent', async () => {
    expect(await send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', deps })).toEqual({ sent: true, via: 'cta_header' });
    expect(deps.store.readForSession).toHaveBeenCalledWith(SESSION);
  });
  test('the engine\'s row is handed over (a row or its promise): it is used, the store is not read', async () => {
    expect(await send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', row: Promise.resolve(ROW), deps })).toEqual({ sent: true, via: 'cta_header' });
    expect(deps.store.readForSession).not.toHaveBeenCalled();
  });
  test('handed a null row (the engine stored nothing / flag off in the engine) → nothing, no read', async () => {
    expect(await send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', row: Promise.resolve(null), deps })).toEqual({ sent: false, via: null });
    expect(deps.store.readForSession).not.toHaveBeenCalled();
  });
  test('the store throws → nothing, no throw', async () => {
    deps.store.readForSession.mockRejectedValue(new Error('db'));
    await expect(send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en', deps })).resolves.toEqual({ sent: false, via: null });
  });
  test('default deps without the engine\'s modules on disk: the flag reads off and nothing is required', async () => {
    delete process.env.VIDEO_RECO_ENABLED;
    await expect(send.sendAfterReport({ coachingSessionId: SESSION, phone: PHONE, language: 'en' })).resolves.toEqual({ sent: false, via: null });
  });
});
