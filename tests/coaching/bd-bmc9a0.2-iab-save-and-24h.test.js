'use strict';
/**
 * bd-bmc9a0.2 — ICT IAB Experience View row 31 (row 32 stays on sandbox; see below).
 *
 *   Row 31  "Save recording": the teacher saves her class recording in the app (IAB) and comes back later for the
 *           reflection and feedback. Saving starts the same server-side DC observation Submit does, so the recording
 *           can never be lost; the row carries conversation_state.saved_for_later_at.
 *   Row 32  (the unreflected lesson's report after 24 hours) is NOT on this branch: it builds on the report-caption
 *           lines and sweep thresholds that exist only on sandbox, and its switch would be off here anyway, which is
 *           exactly today's behaviour (bd-bmc9a0.8). Its tests live in the sandbox copy of this file.
 *
 * Only the network edges are mocked: Supabase, WhatsApp and the queue. The service, the route and the portal's bot
 * client run for real.
 */

const mockDb = { current: null };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (t) => mockDb.current.from(t),
}));

const mockSends = [];
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendInteractiveButtons: jest.fn(async (to, options) => { mockSends.push({ kind: 'buttons', to, options }); return true; }),
  sendMessage: jest.fn(async (to, text) => { mockSends.push({ kind: 'text', to, text }); return true; }),
}));

const mockQueued = [];
jest.mock('../../bot/shared/services/queue', () => ({
  queueCoachingJob: jest.fn(async (sessionId, jobType, payload) => { mockQueued.push({ sessionId, jobType, payload }); return 'msg-1'; }),
}));

// ── row 31: saving marks the row ────────────────────────────────────────────

const SERVICE = '../../bot/shared/services/coaching/portal-coaching.service';
const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const KEY = `classroom_audio/${USER}/2026-10/portal_abc123.webm`;

function serviceDeps() {
  const inserts = [];
  const from = (table) => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.order = () => q; q.limit = () => q;
    q.insert = (r) => { inserts.push({ table, row: r }); q._inserted = r; return q; };
    q.update = () => q;
    q.single = async () => (q._inserted
      ? { data: { id: 'cs-new', ...q._inserted }, error: null }
      : { data: table === 'users' ? { id: USER, phone_number: '000000000002' } : null, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej);
    return q;
  };
  return {
    inserts,
    supabase: { from },
    library: { resolveAsset: jest.fn(), readyRender: jest.fn(), link: jest.fn(), recent: jest.fn() },
    log: jest.fn(),
    r2: { getPresignedUploadUrl: jest.fn(), headObject: jest.fn().mockResolvedValue({ exists: true, sizeBytes: 1000 }), buildR2PublicUrl: (k) => `https://r2.example/${k}` },
    queue: { queueTranscription: jest.fn().mockResolvedValue('m') },
    reflective: {}, getUserLanguage: jest.fn().mockResolvedValue('en'),
    now: () => new Date('2026-10-28T08:00:00Z'), newId: () => 'abc123',
  };
}
const inserted = (d) => d.inserts.find((w) => w.table === 'coaching_sessions').row;

describe('row 31 — Save recording starts the DC observation and marks it saved', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SERVICE); });

  test('saveForLater:true → the session starts as Submit\'s does, with saved_for_later_at', async () => {
    const d = serviceDeps();
    const out = await Svc.startPortalSession({ userId: USER, key: KEY, saveForLater: true }, d);
    expect(out).toEqual({ status: 'ok', coachingSessionId: 'cs-new' });
    expect(d.queue.queueTranscription).toHaveBeenCalledTimes(1);
    expect(inserted(d).status).toBe('confirmed');
    expect(inserted(d).conversation_state).toMatchObject({ current_state: 'TRANSCRIBING', saved_for_later_at: '2026-10-28T08:00:00.000Z' });
  });

  test.each([['absent', undefined], ['false', false], ['a truthy non-boolean', 'yes']])('saveForLater %s → no mark (Submit, byte for byte)', async (_n, v) => {
    const d = serviceDeps();
    await Svc.startPortalSession({ userId: USER, key: KEY, ...(v === undefined ? {} : { saveForLater: v }) }, d);
    expect('saved_for_later_at' in inserted(d).conversation_state).toBe(false);
  });
});

describe('row 31 — the flag travels portal → bot', () => {
  test('the bot\'s /coaching/start passes saveForLater to the service', async () => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const svc = { presignUpload: jest.fn(), startPortalSession: jest.fn().mockResolvedValue({ status: 'ok', coachingSessionId: 'cs-1' }), submitReflection: jest.fn(), recentLessonPlans: jest.fn() };
    jest.doMock(SERVICE, () => svc);
    const router = require('../../bot/shared/routes/internal-api.routes');
    const layer = router.stack.find((l) => l.route && l.route.path === '/coaching/start' && l.route.methods.post);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body: { userId: 'u1', key: 'k', saveForLater: true }, headers: { 'x-api-key': 'secret' }, path: '/coaching/start', ip: '127.0.0.1' };
    await new Promise((resolve) => {
      const res = { status() { return this; }, json() { resolve(); return this; } };
      const run = (i) => handlers[i](req, res, () => run(i + 1));
      run(0);
    });
    expect(svc.startPortalSession).toHaveBeenCalledWith(expect.objectContaining({ saveForLater: true }));
    jest.dontMock(SERVICE);
  });

  test('the portal\'s bot client forwards saveForLater in the start body', async () => {
    jest.resetModules();
    process.env.MAIN_BOT_URL = 'https://bot.example';
    process.env.INTERNAL_API_KEY = 'secret';
    const post = jest.fn().mockResolvedValue({ status: 200, data: { success: true } });
    jest.doMock('axios', () => ({ post }));
    const client = require('../../dashboard/services/portal-coaching.client');
    await client.startSession({ userId: 'u1', key: 'k', saveForLater: true });
    expect(post).toHaveBeenCalledWith('https://bot.example/api/internal/coaching/start',
      expect.objectContaining({ userId: 'u1', key: 'k', saveForLater: true }), expect.anything());
    jest.dontMock('axios');
  });
});
