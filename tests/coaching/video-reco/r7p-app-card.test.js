'use strict';
/**
 * bd-gzfdu9 R7p (COS 20261026T043131 §2): the app's report page card (React VideoRecoCard) is a treatment surface.
 * On card-mode rows shaped like production (two stored reasons from the $0 replay of fresh-5 on 10de2eb303,
 * evals/runs/r7o_f5_cardlistA_10de2eb.jsonl: the longest English line quoting an Urdu card sentence, and the longest
 * Urdu line opening its quote on a digit), the payload the app gets:
 *   - carries the stored reason byte for byte, its FSI…PDI isolate intact (the card renders it with dir="auto");
 *   - links the /v player with a token signed for surface 'portal' — the app card is the only signer of 'portal'
 *     (video-reco-events.js signs 'cr', send.js 'wa'), so its taps are the app's rows in video_reco_events.
 * Real flags, catalogue and link-token; only the database is stubbed.
 */
const FIX = require('./fixtures-r7p-app-card.json');

function db(row) {
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => chain };
}

const ENV = { ...process.env };
beforeEach(() => {
  jest.resetModules();
  process.env.VIDEO_RECO_ENABLED = 'true';
  process.env.VIDEO_RECO_REASON = 'card';
  process.env.INTERNAL_API_KEY = 'test-internal-key-r7p';
  process.env.SUPABASE_URL = 'https://olvritwoqujtjvwfulbh.supabase.co';
});
afterEach(() => { process.env = { ...ENV }; });

describe.each(FIX.rows.map((r) => [r.case, r]))('app card, card mode: %s', (_c, r) => {
  const row = { id: '3b1cfab2-b5f6-4e20-923e-5b250b308291', module_id: r.module_id, seg_id: r.seg_id, start_s: r.start_s, end_s: r.end_s, reason_en: r.reason_en, reason_ur: r.reason_ur };
  const user = '0d1c2b3a-4f5e-4d6c-8b7a-9a8b7c6d5e4f';

  test('the stored reason, byte for byte, in the report language; the isolate intact', async () => {
    const { fieldFor } = require('../../../dashboard/services/video-reco-portal');
    const out = await fieldFor(db(row), 'sess-1', user, r.report_language);
    const want = r.report_language === 'ur' ? r.reason_ur : r.reason_en;
    expect(out.reason).toBe(want);
    expect(out.reason).toMatch(/⁨[^⁩]+⁩/);
    expect(out.title).toBeTruthy();
    expect(out.durationS).toBe(Math.round((r.end_s - r.start_s) * 100) / 100);
  });

  test('the Watch link is the /v player, signed for surface portal (the app card)', async () => {
    const { fieldFor } = require('../../../dashboard/services/video-reco-portal');
    const out = await fieldFor(db(row), 'sess-1', user, r.report_language);
    const m = /^\/v\/([^?]+)\?s=portal$/.exec(out.href);
    expect(m).not.toBeNull();
    const v = require('../../../bot/shared/services/coaching/video-reco/link-token').verifyVideoLink(m[1]);
    expect(v).toMatchObject({ ok: true, recommendationId: row.id, userId: user, surface: 'portal' });
  });
});
