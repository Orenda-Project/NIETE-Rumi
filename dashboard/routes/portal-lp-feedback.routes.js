'use strict';
/**
 * The survey bar at the end of a lesson plan in the teacher app ("This plan": Useful / Not useful, then In class or
 * What was wrong). Mounted at /api/portal by dashboard/index.js beside the other teacher modules.
 *
 *   GET  /api/portal/lp/feedback?kind=k5|g612&ref=<plan>  → { success, feedback: null | { useful, usedInClass } }
 *   POST /api/portal/lp/feedback  { kind, ref, useful?, usedInClass?, reasonText? }
 *     → { success, outcome: 'saved'|'already_answered', feedback } · 404 unknown plan · 409 no first tap yet
 *
 * `ref` is the plan as the viewer holds it: a grades 1-5 catalogue lesson id, or a grades 6-12 render id (resolved for
 * HER, Lp612.requestStatus with the session user, to its segment and language; not hers is 404).
 *
 * The user is ALWAYS the session's (a userId in the request is ignored). Dark unless portal_teacher_v2 and
 * portal_lp_feedback_bar are on for her (404, nothing asked of the bot); a leader reading plans gets 404 too. The row
 * itself is the bot's to write (lp-in-app-feedback.service: one row per teacher per plan, trigger_mode 'in_app', the
 * band rule), asked over the internal API because the portal cannot load bot code. A bot that cannot be reached is
 * 502: the bar says "Not saved", never "Thanks".
 */
const express = require('express');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY } = require('../lib/feature-flags');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { isLpFeedbackBarOn } = require('../lib/lp-app-switches');
const { requirePortalAuth } = require('../lib/portal-auth');

const router = express.Router();
const KINDS = ['k5', 'g612'];
const USED_IN_CLASS = ['taught', 'planned', 'not_yet'];
const REASON_MAX = 300;
const REF_MAX = 200;
const TIMEOUT_MS = 10000;

const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });

/** On for her: the teacher app AND the bar's switch, and not a leader. Anything unreadable is off. */
/** Her keyed reference for a log line (web-quiz-kid `tk`); null when the key is missing. Never the raw id. */
function tkOf(userId) {
  try {
    return require('../../bot/shared/services/quiz/web-quiz-kid').tk(userId);
  } catch (_) {
    return null;
  }
}

async function requireBar(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = await isLpFeedbackBarOn(supabase, userId) && await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId);
  } catch (_) { on = false; }
  if (!on) return notFound(res);
  try {
    // A leader reads teachers' plans; the survey is a teacher's question (lp-reader.service).
    const reader = await require('../services/lp-reader.service').readerOf(userId);
    if (reader.leader) return notFound(res);
  } catch (_) { return notFound(res); }
  return next();
}

/** The plan, checked: { kind, ref } or null. */
function planOf(src) {
  const kind = src && src.kind;
  const ref = src && typeof src.ref === 'string' ? src.ref.trim() : '';
  return KINDS.includes(kind) && ref && ref.length <= REF_MAX ? { kind, ref } : null;
}

/** The answer, checked: { useful?, usedInClass?, reasonText? } with at least one, or null. */
function answerOf(b) {
  const out = {};
  if (b.useful !== undefined) {
    if (typeof b.useful !== 'boolean') return null;
    out.useful = b.useful;
  }
  if (b.usedInClass !== undefined) {
    if (!USED_IN_CLASS.includes(b.usedInClass)) return null;
    out.usedInClass = b.usedInClass;
  }
  if (b.reasonText !== undefined) {
    const text = typeof b.reasonText === 'string' ? b.reasonText.trim() : '';
    if (!text || text.length > REASON_MAX) return null;
    out.reasonText = text;
  }
  return Object.keys(out).length ? out : null;
}

/** The plan as the bot names it: a 6-12 render id becomes her segment + language; null when it is not hers. */
async function botPlan(plan, userId) {
  if (plan.kind === 'k5') return plan;
  const out = await require('../services/lp612.service').requestStatus(plan.ref, userId);
  if (!out || out.notFound || !out.segmentId) return null;
  return { kind: 'g612', ref: out.segmentId, ...(out.lang ? { lang: out.lang } : {}) };
}

async function callBot(path, body) {
  const axios = require('axios');
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('lesson plan feedback API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  return axios.post(`${baseUrl}/api/internal/lp/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS, validateStatus: () => true,
  });
}

router.get('/lp/feedback', requirePortalAuth, requireBar, async (req, res) => {
  const plan = planOf(req.query || {});
  if (!plan) return res.status(400).json({ success: false, error: 'kind and ref are required' });
  const userId = req.session.portalUserId;
  try {
    const at = await botPlan(plan, userId);
    if (!at) return notFound(res);
    const r = await callBot('feedback/state', { userId, kind: at.kind, ref: at.ref });
    if (!r || r.status !== 200 || !r.data || r.data.success !== true) throw new Error(`lp/feedback/state failed (HTTP ${r && r.status})`);
    return res.json({ success: true, feedback: r.data.feedback || null });
  } catch (error) {
    console.error('❌ Portal lp/feedback state failed', { tk: tkOf(userId), kind: plan.kind, error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not check' });
  }
});

router.post('/lp/feedback', requirePortalAuth, requireBar, async (req, res) => {
  const b = req.body || {};
  const plan = planOf(b);
  const answer = answerOf(b);
  if (!plan || !answer) return res.status(400).json({ success: false, error: 'kind, ref and an answer are required' });
  const userId = req.session.portalUserId;
  try {
    const at = await botPlan(plan, userId);
    if (!at) return notFound(res);
    const r = await callBot('feedback', { userId, ...at, ...answer });
    const data = (r && r.data) || {};
    if (r && (r.status === 404 || r.status === 409)) return res.status(r.status).json({ success: false, outcome: data.outcome || null });
    if (!r || r.status !== 200 || data.success !== true || !['saved', 'already_answered'].includes(data.outcome)) {
      throw new Error(`lp/feedback failed (HTTP ${r && r.status})`);
    }
    return res.json({ success: true, outcome: data.outcome, feedback: data.feedback || null });
  } catch (error) {
    console.error('❌ Portal lp/feedback failed', { tk: tkOf(userId), kind: plan.kind, error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not save' });
  }
});

module.exports = router;
