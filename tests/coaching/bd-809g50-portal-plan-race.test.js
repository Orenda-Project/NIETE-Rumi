/**
 * ICT feedback (IAB Experience View, row 12): a teacher attached her lesson plan through the PORTAL's file upload
 * and it did not appear in the final report — Section B "No lesson plan was provided".
 *
 * Production, session 4c586359 (13 Oct): after transcription the portal queues lesson_plan_extraction and analysis
 * back to back (portal-coaching.service afterTranscription). Both sit in the session's FIFO group, but the worker
 * receives them in ONE batch and runs a batch concurrently (sqs-worker "Process each job concurrently"), so both
 * started at 07:54:08.515. The plan was saved at 07:54:43; the analysis, holding the row it loaded at 07:54:08,
 * graded Section B lp_absent at 07:55:28. The late-plan recompute only covers coach visits (its statuses are the
 * observe ones), so nothing repaired it. 7 of 7 portal file-upload sessions since 29 Sep; 0 of 54 library picks.
 *
 * The fix: a PORTAL analysis that starts while its plan is still being read waits for the read (bounded), then
 * reloads the row — so Section B is graded with the plan. WhatsApp rows are untouched.
 */

const Svc = require('../../bot/shared/services/coaching/analysis-processor.service');

const PORTAL_URL = 'https://r2.example/digital-coach-audio/classroom_audio/u-1/2026-10/portal_abc.ogg';
const WA_URL = 'https://r2.example/digital-coach-audio/classroom_audio/u-1/2026-10/cs-1_1791878011605.ogg';

const row = (over = {}) => ({
  id: 'cs-1', audio_url: PORTAL_URL, has_lesson_plan: true, lesson_plan_extraction_status: 'pending', ...over,
});

function clock() {
  let t = 0;
  return { now: () => t, sleep: jest.fn(async (ms) => { t += ms; }) };
}

describe('a portal analysis waits for her plan to be read', () => {
  test('pending at load → waits until the read completes, then grades with the reloaded row', async () => {
    const c = clock();
    const readStatus = jest.fn()
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('completed');
    const reloaded = row({ lesson_plan_extraction_status: 'completed', lesson_plan_text: 'the plan' });
    const reload = jest.fn().mockResolvedValue(reloaded);

    const out = await Svc._awaitPortalPlan('cs-1', row(), { readStatus, reload, sleep: c.sleep, now: c.now });

    expect(out).toBe(reloaded);
    expect(readStatus).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledWith('cs-1');
  });

  test('a failed read also ends the wait (graded without a plan, as before) — never stuck', async () => {
    const c = clock();
    const readStatus = jest.fn().mockResolvedValue('failed');
    const reload = jest.fn().mockResolvedValue(row({ lesson_plan_extraction_status: 'failed' }));
    const out = await Svc._awaitPortalPlan('cs-1', row(), { readStatus, reload, sleep: c.sleep, now: c.now });
    expect(out.lesson_plan_extraction_status).toBe('failed');
    expect(readStatus).toHaveBeenCalledTimes(1);
  });

  test('bounded: still pending past the limit → carries on with the row it has', async () => {
    const c = clock();
    const readStatus = jest.fn().mockResolvedValue('pending');
    const reload = jest.fn();
    const s = row();
    const out = await Svc._awaitPortalPlan('cs-1', s, { readStatus, reload, sleep: c.sleep, now: c.now, maxWaitMs: 30_000 });
    expect(out).toBe(s);
    expect(reload).not.toHaveBeenCalled();
    expect(c.now()).toBeGreaterThanOrEqual(30_000);
    expect(c.now()).toBeLessThan(40_000);
  });

  // bd-cdxv3a — the default limit is 3 minutes: 30 days of production plan reads (13 Sep–13 Oct, 3,662) ran p50 15 s,
  // p99 75 s; 0.38% took over 2 min, 0.30% over 3 min. The wait ends as soon as the read does, so only a slow or
  // stuck read ever reaches the limit.
  test('bd-cdxv3a — by default it waits up to 3 minutes, not longer', async () => {
    const c = clock();
    const readStatus = jest.fn().mockResolvedValue('pending');
    const s = row();
    const out = await Svc._awaitPortalPlan('cs-1', s, { readStatus, reload: jest.fn(), sleep: c.sleep, now: c.now });
    expect(out).toBe(s);
    expect(c.now()).toBeGreaterThanOrEqual(180_000);
    expect(c.now()).toBeLessThan(190_000);
  });

  test('nothing to wait for: a WhatsApp row, no plan, or a plan already read', async () => {
    for (const s of [
      row({ audio_url: WA_URL }),
      row({ has_lesson_plan: false }),
      row({ lesson_plan_extraction_status: 'completed' }),
      row({ lesson_plan_extraction_status: null }),
    ]) {
      const readStatus = jest.fn();
      const out = await Svc._awaitPortalPlan('cs-1', s, { readStatus, reload: jest.fn(), sleep: jest.fn(), now: () => 0 });
      expect(out).toBe(s);
      expect(readStatus).not.toHaveBeenCalled();
    }
  });

  test('processAnalysis calls it right after loading the row', () => {
    const src = require('fs').readFileSync(require.resolve('../../bot/shared/services/coaching/analysis-processor.service'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const load = src.indexOf(".select('*, users!inner(name, phone_number)')");
    const wait = src.indexOf('this._awaitPortalPlan(coachingSessionId');
    expect(load).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(load);
    expect(wait - load).toBeLessThan(1200);
  });
});
