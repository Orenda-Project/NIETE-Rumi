'use strict';
/**
 * bd-snkn32.42 — "Made by a teacher": the shelf and the human check before a plan is listed. Mounted at /api/portal
 * by dashboard/index.js beside portal-lp612-own.routes.js.
 *
 *   GET  /lp612/shelf?keys=L1,L2          teacher; portal_teacher_v2 AND portal_lp_own_shelf, else 404
 *     → { success, plans: [{ ownId, lesson, band, lang }] }  approved plans on those lessons; opened on the same
 *                                                             /lp612/status/:ownId and /lp612/file/:ownId as any plan
 *   GET  /lp612/own/review                staff listed in portal_lp_own_reviewers (list-only), else 404
 *     → { success, plans: [{ ownId, lesson, band, lang, score, reviewedAt, below, notAssessed }] }
 *   POST /lp612/own/review/:ownId  { decision: 'approve'|'reject', reason }   the reviewer is ALWAYS the session user
 *   GET  /lp612/own/review/:ownId/file    the PDF, relayed like every lesson plan
 *
 * Fields are whitelisted: never an author id or her answers. The bot holds every rule; a bot that cannot be reached
 * is 502.
 */
const express = require('express');
const supabase = require('../config/supabase');
const {
  PORTAL_TEACHER_V2_KEY, PORTAL_LP_OWN_SHELF_KEY, PORTAL_LP_OWN_REVIEWERS_KEY, isFlagEnabledForUser, isUserListedInFlag,
} = require('../lib/feature-flags');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { requirePortalAuth } = require('../lib/portal-auth');
const { relayLessonPlanPdf } = require('../lib/lesson-plan-file');

const router = express.Router();
const PASS_ON = new Set([400, 404]);
const SHELF_FIELDS = ['ownId', 'lesson', 'band', 'lang'];
const QUEUE_FIELDS = [...SHELF_FIELDS, 'score', 'reviewedAt', 'below', 'notAssessed'];

function botConfig() {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('LP 6-12 API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  return { baseUrl, headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' } };
}

const pick = (o, fields) => Object.fromEntries(fields.filter((f) => o && o[f] !== undefined).map((f) => [f, o[f]]));
const notFound = (res) => res.status(404).json({ success: false, error: 'Not found' });
const plansOf = (r) => (r.status === 200 && r.data && Array.isArray(r.data.plans) ? r.data.plans : null);

async function requireShelf(req, res, next) {
  const userId = req.session.portalUserId;
  let on = false;
  try {
    on = (await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId))
      && (await isFlagEnabledForUser(supabase, PORTAL_LP_OWN_SHELF_KEY, userId));
  } catch (_) { on = false; }
  return on ? next() : notFound(res);
}

async function requireReviewer(req, res, next) {
  let on = false;
  try { on = await isUserListedInFlag(supabase, PORTAL_LP_OWN_REVIEWERS_KEY, req.session.portalUserId); } catch (_) { on = false; }
  return on === true ? next() : notFound(res);
}

async function botGet(path, params) {
  const axios = require('axios');
  const { baseUrl, headers } = botConfig();
  return axios.get(`${baseUrl}${path}`, { headers, params, timeout: 15000, validateStatus: () => true });
}

router.get('/lp612/shelf', requirePortalAuth, requireShelf, async (req, res) => {
  const keys = typeof req.query.keys === 'string' ? req.query.keys.trim() : '';
  if (!keys || keys.length > 4000) return res.status(400).json({ success: false, error: 'keys are required' });
  try {
    const plans = plansOf(await botGet('/api/internal/lp612/own/shelf', { keys }));
    if (!plans) throw new Error('shelf read failed');
    return res.json({ success: true, plans: plans.map((p) => pick(p, SHELF_FIELDS)) });
  } catch (error) {
    console.error('❌ Portal lp612/shelf failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load the shelf' });
  }
});

router.get('/lp612/own/review', requirePortalAuth, requireReviewer, async (_req, res) => {
  try {
    const plans = plansOf(await botGet('/api/internal/lp612/own/review'));
    if (!plans) throw new Error('review queue read failed');
    return res.json({ success: true, plans: plans.map((p) => pick(p, QUEUE_FIELDS)) });
  } catch (error) {
    console.error('❌ Portal lp612/own/review failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not load the plans to check' });
  }
});

router.post('/lp612/own/review/:ownId', requirePortalAuth, requireReviewer, async (req, res) => {
  const b = req.body || {};
  try {
    const axios = require('axios');
    const { baseUrl, headers } = botConfig();
    const r = await axios.post(`${baseUrl}/api/internal/lp612/own/review/${encodeURIComponent(req.params.ownId)}`, {
      reviewerId: req.session.portalUserId, decision: b.decision, reason: b.reason,
    }, { headers, timeout: 15000, validateStatus: () => true });
    if (r.status === 200 && r.data && r.data.success) return res.json({ success: true, decision: r.data.decision });
    if (PASS_ON.has(r.status)) return res.status(r.status).json({ success: false, error: 'Could not record that' });
    throw new Error(`decide failed (HTTP ${r.status})`);
  } catch (error) {
    console.error('❌ Portal lp612/own/review decide failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not record that' });
  }
});

router.get('/lp612/own/review/:ownId/file', requirePortalAuth, requireReviewer, async (req, res) => {
  try {
    const r = await botGet(`/api/internal/lp612/own/review/${encodeURIComponent(req.params.ownId)}/file`);
    if (r.status === 404) return notFound(res);
    if (r.status !== 200 || !r.data || typeof r.data.url !== 'string') throw new Error(`file failed (HTTP ${r.status})`);
    return relayLessonPlanPdf(r.data.url, res);
  } catch (error) {
    console.error('❌ Portal lp612/own/review file failed', { error: error && error.message });
    return res.status(502).json({ success: false, error: 'Could not open that plan' });
  }
});

module.exports = router;
