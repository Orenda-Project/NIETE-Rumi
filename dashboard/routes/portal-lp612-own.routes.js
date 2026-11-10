'use strict';
/**
 * bd-snkn32 — "Make my own" lesson plan, from the teacher app. Mounted at /api/portal by dashboard/index.js beside the
 * other teacher modules (portal-share.routes.js's pattern).
 *
 *   POST /api/portal/lp612/own  { segment_id | lesson_id, answers: { size, resources, level, way, note } }
 *     (bd-snkn32.4: lesson_id is a grades 1–5 day, rewritten from its own plan in its book's language)
 *     → 202 { success, state: 'authoring', renderId }   her fork's id, polled on the SAME /lp612/status/:id and
 *                                                        /lp612/file/:id as any 6-12 lesson (the bot answers it)
 *
 *   POST /api/portal/lp612/own/:ownId/change  { part, text }   (bd-snkn32.15: up to two changes per plan)
 *     → 202 { success, state: 'authoring', renderId }   the changed plan's id, polled the same way
 *     → 409 { success: false, outcome }                 a refusal she is told about (too_short, too_small, repeat,
 *                                                        in_flight, cap_reached, daily_limit); no row, no model call
 *
 * Dark unless portal_teacher_v2 AND portal_lp_make_own are on for her: 404, the bot never asked. The user is ALWAYS
 * the session's. The bot holds every rule (codes checked, shared plan asked for, fork queued); this only passes on its
 * answer. A bot that cannot be reached is 502, never a plan.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY, PORTAL_LP_MAKE_OWN_KEY, isFlagEnabledForUser } = require('../lib/feature-flags');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { requirePortalAuth } = require('../lib/portal-auth');

const router = express.Router();
const PASS_ON = new Set([400, 403, 404]);
const REFUSALS = new Set(['too_short', 'too_small', 'repeat', 'in_flight', 'cap_reached', 'daily_limit']);
const TEXT_LIMIT = 2000;

function botConfig() {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('LP 6-12 API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  return { baseUrl, headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } };
}

/** Pass on the bot's answer: queued, a known refusal, or a 400/403/404. Anything else throws (→ 502). */
function answer(res, r, label) {
  if (r.status === 202 && r.data && r.data.success && r.data.renderId) {
    return res.status(202).json({ success: true, state: 'authoring', renderId: r.data.renderId });
  }
  if (r.status === 409 && r.data && REFUSALS.has(r.data.outcome)) {
    return res.status(409).json({ success: false, outcome: r.data.outcome });
  }
  if (PASS_ON.has(r.status)) return res.status(r.status).json({ success: false, error: 'Could not make that plan' });
  throw new Error(`${label} failed (HTTP ${r.status})`);
}

async function requireMakeOwn(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = (await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId))
      && (await isFlagEnabledForUser(supabase, PORTAL_LP_MAKE_OWN_KEY, userId));
  } catch (_) { on = false; }
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

router.post('/lp612/own', requirePortalAuth, requireMakeOwn, async (req, res) => {
  const b = req.body || {};
  const segmentId = typeof b.segment_id === 'string' ? b.segment_id.trim() : '';
  const lessonId = typeof b.lesson_id === 'string' ? b.lesson_id.trim() : '';
  const id = segmentId || lessonId;
  if (!id || (segmentId && lessonId) || id.length > 200 || !b.answers || typeof b.answers !== 'object' || Array.isArray(b.answers)) {
    return res.status(400).json({ success: false, error: 'segment_id or lesson_id, and answers, are required' });
  }
  try {
    const axios = require('axios');
    const { baseUrl, headers } = botConfig();
    const r = await axios.post(`${baseUrl}/api/internal/lp612/own`, {
      userId: req.session.portalUserId, ...(segmentId ? { segmentId } : { lessonId }), answers: b.answers,
    }, { headers, timeout: 20000, validateStatus: () => true });
    return answer(res, r, 'lp612/own');
  } catch (error) {
    console.error('❌ Portal lp612/own failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not make your plan' });
  }
});

router.post('/lp612/own/:ownId/change', requirePortalAuth, requireMakeOwn, async (req, res) => {
  const b = req.body || {};
  const ownId = String(req.params.ownId || '');
  const part = typeof b.part === 'string' ? b.part.trim() : '';
  const text = typeof b.text === 'string' ? b.text : '';
  if (!ownId || ownId.length > 200 || !part || part.length > 40 || !text.trim() || text.length > TEXT_LIMIT) {
    return res.status(400).json({ success: false, error: 'part and text are required' });
  }
  try {
    const axios = require('axios');
    const { baseUrl, headers } = botConfig();
    const r = await axios.post(`${baseUrl}/api/internal/lp612/own/${encodeURIComponent(ownId)}/change`, {
      userId: req.session.portalUserId, part, text,
    }, { headers, timeout: 20000, validateStatus: () => true });
    return answer(res, r, 'lp612/own change');
  } catch (error) {
    console.error('❌ Portal lp612/own change failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not change your plan' });
  }
});

/**
 * bd-snkn32.13 — GET /api/portal/lp612/own/slo/:segmentId → { success, mixed, summative, formative }. The form asks
 * "which learning outcomes first?" only for a lesson whose FBISE SLOs mix Summative and Formative. Read from the
 * bot's own map (no bot round trip: it is a file in this deploy), so the form and the instruction agree.
 */
router.get('/lp612/own/slo/:segmentId', requirePortalAuth, requireMakeOwn, (req, res) => {
  const { sloMix } = require('../../bot/shared/services/lp612-own-slo');
  const mix = sloMix(String(req.params.segmentId || '').slice(0, 200));
  return res.json({ success: true, mixed: !!mix, summative: mix ? mix.summative : [], formative: mix ? mix.formative : [] });
});

module.exports = router;
