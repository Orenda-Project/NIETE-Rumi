'use strict';
/**
 * bd-gzfdu9 R7r (COS ruling 20261026T155431 §1): for the A/B the /cr page carries no clip card, so a clip teacher in
 * v10 C/D (who also get the /cr link) sees the clip in the same places as A/B: the strip, the app card, the message.
 * VIDEO_RECO_CR_CARD=false removes the card; unset keeps today's page byte for byte.
 */
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const ENV = { ...process.env };
const SID = '1a2b3c4d-1111-4222-8333-444455556666';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const SESSION = { id: SID, user_id: UID, created_at: '2026-10-20T08:00:00Z', analysis_data: { scores: { overall_percentage: 60 } }, prioritized_action: { action: 'Ask why.' } };
const REC = { id: '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60', module_id: 51, seg_id: '51-s3', start_s: 82, end_s: 142, reason_en: 'Because.', reason_ur: 'کیونکہ۔' };

/** A supabase stand-in that answers by table and records every table it was asked for. */
function fakeDb() {
  const asked = [];
  const rows = { coaching_sessions: SESSION, users: { preferred_language: 'en', name: 'Tester' }, quizzes: null, video_recommendations: REC, training_modules: { title: 'Questioning' } };
  return {
    asked,
    from(table) {
      asked.push(table);
      const c = {};
      c.select = () => c; c.eq = () => c; c.order = () => c; c.limit = () => c;
      c.maybeSingle = async () => ({ data: rows[table] || null, error: null });
      c.then = (ok, ko) => Promise.resolve({ data: table === 'coaching_sessions' ? [SESSION] : [], error: null }).then(ok, ko);
      return c;
    },
  };
}

async function page(env) {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://p.example', ...env };
  for (const k of ['VIDEO_RECO_ENABLED', 'VIDEO_RECO_CR_CARD']) if (!(k in env)) delete process.env[k];
  const db = fakeDb();
  const data = await require('../../../dashboard/routes/coaching-report.routes').loadReport(db, SID, UID);
  const { buildReportView } = require('../../../dashboard/services/coaching-report-view');
  const { renderReportPage } = require('../../../dashboard/services/coaching-report-page');
  return { data, asked: db.asked, html: renderReportPage(buildReportView(data), process.env, {}) };
}

afterAll(() => { process.env = ENV; });

test('control: engine on, flag unset → the /cr page carries the clip card (today)', async () => {
  const r = await page({ VIDEO_RECO_ENABLED: 'true' });
  expect(r.data.video).toBeTruthy();
  expect(r.html).toContain('<section class="video">');
});

test.each(['false', '0', 'off', 'FALSE'])('VIDEO_RECO_CR_CARD=%p → no card, no recommendation read', async (v) => {
  const r = await page({ VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_CR_CARD: v });
  expect(r.data).not.toHaveProperty('video');
  expect(r.asked).not.toContain('video_recommendations');
  expect(r.html).not.toContain('class="video"');
});

test('flag off: the page is byte-identical to the page of a report with no clip', async () => {
  const off = await page({ VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_CR_CARD: 'false' });
  const noEngine = await page({});
  expect(off.html).toBe(noEngine.html);
  expect(off.data).toEqual(noEngine.data);
});

test.each(['true', '1', ''])('VIDEO_RECO_CR_CARD=%p keeps the card (only an explicit off removes it)', async (v) => {
  const r = await page({ VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_CR_CARD: v });
  expect(r.html).toContain('<section class="video">');
});

test('flag off does not touch the app card (video-reco-portal) or the engine switch', () => {
  const flags = require('../../../bot/shared/services/coaching/video-reco/flags');
  const env = { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_CR_CARD: 'false' };
  expect(flags.videoRecoEnabled(env)).toBe(true);
  expect(flags.videoRecoCrCard(env)).toBe(false);
  expect(flags.videoRecoCrCard({})).toBe(true);
});
