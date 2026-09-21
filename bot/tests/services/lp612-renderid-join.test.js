/**
 * A thumbs-down that cannot be walked back to the artifact she rated. bd-jsong (§1.8 thread 3).
 *
 * `renderId` names the artifact a teacher actually received — which template version, whether it
 * was capped, degraded, or had its overlay dropped. It is a parameter of `deliverRender` and was
 * simply not forwarded to the feedback prompt, so a 👎 told you the segment and never the thing
 * that was rated. The single most useful question about the length trade-off — "are the degraded
 * ones the ones she dislikes?" — could not be asked at all.
 *
 * This drives the REAL chain: deliverRender → scheduleFeedbackPrompt → the emitted event. Only
 * the network boundaries are stubbed (supabase, WhatsApp, R2); nothing inside either module under
 * change is faked, so the test fails on the live branch for the actual defect.
 *
 * Scope note: this restores the join in TELEMETRY. The tap itself still arrives as
 * `lp612_fb_(yes|no)_(en|ur)_<segment_id>`, which carries no render id, and `lp_feedback` has no
 * render column — so the SQL-side join is still open. See bd-jsong.
 */
const events = [];
jest.mock('../../shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../../shared/utils/structured-logger');
  return { ...actual, logEvent: (name, data) => { events.push({ name, data }); } };
});

// ── network boundaries only ───────────────────────────────────────────────────
jest.mock('../../shared/storage/r2', () => ({
  buildR2PublicUrl: (k) => `https://r2.test/${k}`,
  getPresignedUrl: async (u) => u,
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendDocumentByLink: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
}));
jest.mock('../../shared/config/supabase', () => {
  const chain = () => {
    const c = {};
    for (const m of ['select', 'eq', 'insert', 'update', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => ({ data: null });
    c.single = async () => ({ data: { id: 'row-1' } });
    c.then = undefined;
    return c;
  };
  return { from: () => chain(), rpc: async () => ({ data: [] }) };
});

const Serving = require('../../shared/services/lp612-serving.service');

const SEGMENT = {
  segment_id: 'seg-4242', grade: 6, subject: 'Computer Science',
  chapter_number: 1, subtopic_title: 'Fundamentals of ICT',
};

beforeEach(() => { events.length = 0; jest.clearAllMocks(); });

describe('a rating can be walked back to the artifact (bd-jsong)', () => {
  test('deliverRender carries renderId into the scheduled feedback prompt', async () => {
    await Serving.deliverRender({
      phone: '000', userId: 'user-9', r2Key: 'lp-cache/v8/seg-4242/abc.pdf',
      segment: SEGMENT, lang: 'en', oneScreen: false,
      overlayDropped: false, renderDegraded: true,
      renderId: 'rnd-1234',
    });

    const scheduled = events.find((e) => e.name === 'lp612.feedback.scheduled');
    expect(scheduled).toBeDefined();
    // The whole point: the segment was never the missing half — the artifact was.
    expect(scheduled.data.segmentId).toBe('seg-4242');
    expect(scheduled.data.renderId).toBe('rnd-1234');
  });

  test('a delivery with no renderId still schedules — the prompt is never held hostage to it', async () => {
    await Serving.deliverRender({
      phone: '000', userId: 'user-9', r2Key: 'lp-cache/v8/seg-4242/abc.pdf',
      segment: SEGMENT, lang: 'en', oneScreen: false,
    });

    const scheduled = events.find((e) => e.name === 'lp612.feedback.scheduled');
    expect(scheduled).toBeDefined();
    expect(scheduled.data.segmentId).toBe('seg-4242');
    expect(scheduled.data.renderId ?? null).toBeNull();
  });
});
