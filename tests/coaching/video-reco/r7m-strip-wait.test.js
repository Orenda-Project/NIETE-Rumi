'use strict';
/**
 * R7m (COS ruling 20261024T165956 §1; the operator: "20 secs is still too much of a wait!"). The report image waits for the
 * pick only as long as the reason mode needs: shadow never waits (nothing is drawn), card mode ≤ 1.5 s (p99 ~0.3 s on the
 * v9 runs), LLM modes ≤ 5 s; VIDEO_RECO_STRIP_WAIT_MS overrides both. A slower pick skips the strip; the clip message
 * (send.js, its own 60 s cap) still follows. Both A/B arms wait the same way: the wait never looks at the arm.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const ENV = { ...process.env };
const ROW = { id: 'r', coaching_session_id: 's', status: 'shown', arm: 'video', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229 };
const HIT = { module: { module_id: 63, title: 'Questioning', cpd_level: 1, thumb: 'video-thumbs/63.jpg' }, segment: { seg_id: '63-s2', title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال' } };
const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

let S;
let deps;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV };
  for (const k of ['VIDEO_RECO_MODE', 'VIDEO_RECO_REASON', 'VIDEO_RECO_STRIP_WAIT_MS', 'VIDEO_RECO_AB_ENABLED']) delete process.env[k];
  S = require('../../../bot/shared/services/coaching/video-reco/strip');
  deps = { enabled: () => true, catalog: { segment: () => HIT }, store: { readForSession: jest.fn(() => new Promise(() => {})) } };
});
afterEach(() => { jest.useRealTimers(); process.env = { ...ENV }; });

/** How long stripFor held the image for a pick that arrives at `at` ms (fake clock): { out, waited }. */
async function race(at, row = ROW) {
  jest.useFakeTimers();
  let done = false; let out; let waited = null;
  const t0 = Date.now();
  S.stripFor({ coachingSessionId: 's', language: 'en', row: later(at, row), deps }).then((v) => { out = v; done = true; waited = Date.now() - t0; });
  for (let i = 0; i < 400 && !done; i++) await jest.advanceTimersByTimeAsync(50);
  return { out, waited };
}

describe('shadow never waits', () => {
  test('VIDEO_RECO_MODE=shadow → null at once, the row is not awaited or read', async () => {
    process.env.VIDEO_RECO_MODE = 'shadow';
    const t0 = Date.now();
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', row: new Promise(() => {}), deps })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(50);
    expect(await S.stripFor({ coachingSessionId: 's', language: 'en', deps })).toBeNull();
    expect(deps.store.readForSession).not.toHaveBeenCalled();
  });
});

describe('the cap follows the reason mode', () => {
  test('stripWaitMs: card 1.5 s, llm 5 s, VIDEO_RECO_STRIP_WAIT_MS overrides; shadow 0', () => {
    expect(S.stripWaitMs({})).toBe(5000);
    expect(S.stripWaitMs({ VIDEO_RECO_REASON: 'card' })).toBe(1500);
    expect(S.stripWaitMs({ VIDEO_RECO_REASON: 'card', VIDEO_RECO_STRIP_WAIT_MS: '800' })).toBe(800);
    expect(S.stripWaitMs({ VIDEO_RECO_STRIP_WAIT_MS: '2500' })).toBe(2500);
    expect(S.stripWaitMs({ VIDEO_RECO_STRIP_WAIT_MS: 'abc' })).toBe(5000); // junk → the mode's default
    expect(S.stripWaitMs({ VIDEO_RECO_STRIP_WAIT_MS: '-1' })).toBe(5000);
    expect(S.stripWaitMs({ VIDEO_RECO_MODE: 'shadow', VIDEO_RECO_STRIP_WAIT_MS: '9000' })).toBe(0);
  });
  test('card mode: a pick at 1.2 s is drawn; one at 1.6 s is not, and the image was held 1.5 s', async () => {
    process.env.VIDEO_RECO_REASON = 'card';
    expect((await race(1200)).out).toMatchObject({ title: 'Asking why-questions' });
    const slow = await race(1600);
    expect(slow.out).toBeNull();
    expect(slow.waited).toBeLessThanOrEqual(1550);
  });
  test('llm mode: a pick at 4.8 s is drawn; one at 6 s is not, and the image was held 5 s, not 20', async () => {
    expect((await race(4800)).out).not.toBeNull();
    const slow = await race(6000);
    expect(slow.out).toBeNull();
    expect(slow.waited).toBeGreaterThanOrEqual(5000);
    expect(slow.waited).toBeLessThanOrEqual(5050);
  });
  test('the env override is read at call time', async () => {
    process.env.VIDEO_RECO_STRIP_WAIT_MS = '300';
    expect((await race(400)).out).toBeNull();
    expect((await race(200)).out).not.toBeNull();
  });
  test('an explicit capMs from the caller still wins (tests, a future caller)', async () => {
    jest.useFakeTimers();
    let out = 'pending';
    S.stripFor({ coachingSessionId: 's', language: 'en', row: later(100, ROW), capMs: 50, deps }).then((v) => { out = v; });
    await jest.advanceTimersByTimeAsync(60);
    expect(out).toBeNull();
  });
});

describe('A/B: both arms wait the same way', () => {
  test('the control arm\'s shadow row is awaited exactly as long as the treatment\'s shown row (card mode)', async () => {
    process.env.VIDEO_RECO_REASON = 'card';
    process.env.VIDEO_RECO_AB_ENABLED = 'true';
    const ctl = await race(1600, { ...ROW, arm: 'control', status: 'shadow' });
    const trt = await race(1600, ROW);
    expect(ctl.out).toBeNull();
    expect(trt.out).toBeNull();
    expect(ctl.waited).toBe(trt.waited);
    const ctlFast = await race(100, { ...ROW, arm: 'control', status: 'shadow' });
    const trtFast = await race(100, ROW);
    expect(ctlFast.waited).toBe(trtFast.waited);
  });
});

describe('a pick slower than the strip cap: no strip, the clip message still goes', () => {
  test('card mode, pick at 2 s: stripFor → null; sendAfterReport on the same promise → sent', async () => {
    process.env.VIDEO_RECO_REASON = 'card';
    const send = require('../../../bot/shared/services/coaching/video-reco/send');
    Object.assign(process.env, { INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk' });
    const wa = { sendCtaUrl: jest.fn(async () => true), sendMessage: jest.fn(async () => true) };
    const sdeps = { enabled: () => true, whatsapp: wa, catalog: { segment: () => HIT }, store: { readForSession: jest.fn(), markSent: jest.fn(async () => undefined) }, claimPiece: jest.fn(async () => true), releasePiece: jest.fn(async () => undefined), renderCard: jest.fn(async () => Buffer.from('PNG')) };
    const track = { opts: jest.fn(() => ({ onMessageId: jest.fn() })), record: jest.fn(async () => undefined) };
    jest.useFakeTimers();
    const FULL = { ...ROW, id: '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60', coaching_session_id: '1a2b3c4d-1111-4222-8333-444455556666', user_id: '60530046-7ac3-4ea3-a976-b43c37c23213', reason_en: 'This clip shows one way to do it.', reason_ur: 'اس کلپ میں ایک طریقہ ہے۔' };
    const pick = later(2000, FULL);
    let strip = 'pending'; let sent = 'pending';
    S.stripFor({ coachingSessionId: 's', language: 'en', row: pick, deps }).then((v) => { strip = v; });
    await jest.advanceTimersByTimeAsync(1600);
    expect(strip).toBeNull();
    send.sendAfterReport({ coachingSessionId: FULL.coaching_session_id, phone: '923000000001', language: 'en', track, row: pick, imageStrip: false, deps: sdeps }).then((v) => { sent = v; });
    await jest.advanceTimersByTimeAsync(1000);
    expect(sent).toMatchObject({ sent: true });
    expect(wa.sendCtaUrl).toHaveBeenCalledTimes(1);
  });
});
