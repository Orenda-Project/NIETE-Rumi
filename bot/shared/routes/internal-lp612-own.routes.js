'use strict';
/**
 * bd-snkn32 — POST /api/internal/lp612/own { userId, segmentId, answers, correlationId? } → 202 { success, state, renderId }.
 *
 * "Make my own": her class answers rewrite a 6-12 plan into a fork that is hers (services/lp612-own.service.js holds
 * every rule; this maps its outcome to a status). `renderId` is her fork's id, polled on the SAME /lp612/status and
 * /lp612/file as a shared lesson (lp612-browse renderStatus answers it). userId is the portal SESSION's user.
 * Mounted from internal-api.routes.js (router.use), like internal-share.routes.js.
 *
 *   queued → 202   bad_request → 400   held → 403   not_found → 404   error / a throw → 500
 *
 * bd-snkn32.15 — POST /api/internal/lp612/own/:ownId/change { userId, part, text, correlationId? }: "Change this plan"
 * (services/lp612-own-change.js). A guard refusal (too_short, too_small, repeat, in_flight, cap_reached, daily_limit,
 * grr = drops a phase of I do / We do / You do, rote = asks for rote drill;
 * daily_limit also on a make) is 409 with its `outcome`, so the portal can say why. Nothing was written or paid for.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const HTTP = { bad_request: 400, held: 403, not_found: 404 };
const REFUSED = new Set(['too_short', 'too_small', 'repeat', 'in_flight', 'cap_reached', 'daily_limit', 'grr', 'rote']);

function answer(res, out) {
  if (out.outcome === 'queued') return res.status(202).json({ success: true, state: 'authoring', renderId: out.ownId });
  if (REFUSED.has(out.outcome)) return res.status(409).json({ success: false, outcome: out.outcome, error: out.outcome });
  return res.status(HTTP[out.outcome] || 500).json({ success: false, error: out.error || out.outcome });
}

router.post('/lp612/own', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/lp612-own.service').requestOwn({
      userId: String(body.userId || '').trim(),
      segmentId: String(body.segmentId || '').trim(),
      // bd-snkn32.4 — a grades 1–5 day; the service refuses both or neither.
      lessonId: String(body.lessonId || '').trim() || undefined,
      answers: body.answers,
      correlationId: body.correlationId || null,
    });
    return answer(res, out);
  } catch (error) {
    logToFile('❌ Internal LP 6-12 own request failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not make your plan' });
  }
});

router.post('/lp612/own/:ownId/change', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  try {
    const out = await require('../services/lp612-own-change').requestChange({
      userId: String(body.userId || '').trim(),
      ownId: String(req.params.ownId || '').trim(),
      part: typeof body.part === 'string' ? body.part : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      correlationId: body.correlationId || null,
    });
    return answer(res, out);
  } catch (error) {
    logToFile('❌ Internal LP own change failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not change your plan' });
  }
});

/**
 * GET /api/internal/lp612/own/pages?lesson_id=<1–5 day>|segment_id=<6–12>&from=N&to=M
 * → 200 { success, loaded, pages: [{ page, text }], missing: [n] }. No range = the day's own pages. A book that is not
 * imported is 200 with loaded:false (never a stand-in). Bad range (whole pages, from ≤ to, ≤ 10 pages) 400; unknown
 * day or segment, or a worksheet/revision day, 404. Text only: grades 1–5 page images do not exist.
 */
router.get('/lp612/own/pages', requireInternalKey, async (req, res) => {
  const q = req.query || {};
  const one = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const lessonId = one(q.lesson_id);
  const segmentId = one(q.segment_id);
  if ((lessonId || '').length > 200 || (segmentId || '').length > 200) {
    return res.status(400).json({ success: false, error: 'bad_request' });
  }
  try {
    const out = await require('../services/lp-own-book').pagesFor({ lessonId, segmentId, from: one(q.from), to: one(q.to) });
    if (out.outcome === 'ok') return res.json({ success: true, loaded: out.loaded, pages: out.pages, missing: out.missing });
    return res.status(HTTP[out.outcome] || 500).json({ success: false, error: out.error || out.outcome });
  } catch (error) {
    logToFile('❌ Internal LP own pages failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not read the book' });
  }
});

/**
 * bd-snkn32.20 — GET /api/internal/lp612/own/mine?userId=<session user>&keys=<lesson ids, comma-separated>
 * → 200 { success, plans: [{ ownId, rootId, lesson, band, status, changesLeft, round, createdAt }] }: "Your plans for
 * this chapter" (services/lp-own-mine). No user or no usable lesson id 400. Declared before /:ownId routes.
 */
router.get('/lp612/own/mine', requireInternalKey, async (req, res) => {
  const q = req.query || {};
  const Mine = require('../services/lp-own-mine');
  const userId = typeof q.userId === 'string' ? q.userId.trim().slice(0, 200) : '';
  const keys = Mine.cleanKeys(q.keys);
  if (!userId || !keys.length) return res.status(400).json({ success: false, error: 'bad_request' });
  try {
    return res.json({ success: true, plans: await Mine.listMineLive({ userId, keys }) });
  } catch (error) {
    logToFile('❌ Internal LP own mine failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not list your plans' });
  }
});

/**
 * bd-snkn32.5 — GET /api/internal/lp612/own/recent?userId=<session user> → 200 { success, plans: [mine's fields +
 * grade, subject, chapter, title] }: "My own plans" on Lesson Plans home (services/lp-own-recent). No user 400.
 */
router.get('/lp612/own/recent', requireInternalKey, async (req, res) => {
  const q = req.query || {};
  const userId = typeof q.userId === 'string' ? q.userId.trim().slice(0, 200) : '';
  if (!userId) return res.status(400).json({ success: false, error: 'bad_request' });
  try {
    return res.json({ success: true, plans: await require('../services/lp-own-recent').listRecentLive({ userId }) });
  } catch (error) {
    logToFile('❌ Internal LP own recent failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not list your plans' });
  }
});

/**
 * GET /api/internal/lp612/own/:ownId/sections?userId=<session user> → 200
 * { success, band, changed, sections: [{ part, text, before? }] }: her ready plan as section cards, read from the JSON
 * stored beside its PDF (services/lp-own-sections). No user 400; not hers, not ready or no stored JSON 404.
 */
router.get('/lp612/own/:ownId/sections', requireInternalKey, async (req, res) => {
  const ownId = String(req.params.ownId || '').trim().slice(0, 200);
  const userId = typeof (req.query || {}).userId === 'string' ? req.query.userId.trim().slice(0, 200) : '';
  if (!ownId || !userId) return res.status(400).json({ success: false, error: 'bad_request' });
  try {
    const out = await require('../services/lp-own-sections').ownSectionsLive({ ownId, userId });
    if (out.outcome !== 'ok') return res.status(404).json({ success: false, error: 'not_found' });
    return res.json({ success: true, band: out.band, changed: out.changed, sections: out.sections });
  } catch (error) {
    logToFile('❌ Internal LP own sections failed', { error: error && error.message }, 'error');
    return res.status(500).json({ success: false, error: 'Could not read your plan' });
  }
});

module.exports = router;
