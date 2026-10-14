'use strict';
/**
 * Group C and D's coaching report page — v10 coaching test, bd-v0toag.18.
 *
 *   GET /cr/:token          genuine → that one coaching report's card (bd-v0toag.55), read-only, for the teacher the token names
 *                    (bot/shared/services/coaching/report-link-token.js; lasts 120 days, signs nobody in).
 *                    Expired → 302 to the portal sign-in, never a dead page (Amena, 14 Oct).
 *                    Bad, or not her session → a "link not complete" page, 404, no data.
 *   GET /cr/:token/detail   the same report's detailed screen (sections, journey); the same checks and answers.
 *
 * No link is sent until the report arm sends one (.19), so nothing changes for teachers when this ships.
 * The token is the credential: never logged; every answer is private and no-store. Rate limited per IP.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyReportLink, REPORT_PATH } = require('../../bot/shared/services/coaching/report-link-token');
const { renderReportPage, renderDetailPage, renderMessagePage } = require('../services/coaching-report-page');
const { buildReportView } = require('../services/coaching-report-view');
const { firstNameOf } = require('../../bot/shared/utils/person-name');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

const SIGN_IN = '/portal/login';
const SESSION_SELECT = 'id, user_id, created_at, analysis_data, prioritized_action, report_pdf_url, voice_debrief_url';
const TREND_LIMIT = 10;

function log(props) {
  try { telemetry.logEvent('coaching.report_page.open', props); } catch (_) { /* logging never decides the response */ }
}

/** The report, only for its own teacher, with her first name, language, last scores and the session's student quiz. */
async function loadReport(supabase, sessionId, userId) {
  const { data: session, error } = await supabase.from('coaching_sessions').select(SESSION_SELECT)
    .eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'coaching_sessions read failed');
  if (!session) return null;
  const [user, quiz, past] = await Promise.all([
    supabase.from('users').select('preferred_language, name').eq('id', userId).maybeSingle(),
    supabase.from('quizzes').select('meta').eq('coaching_session_id', sessionId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('coaching_sessions').select('created_at, analysis_data').eq('user_id', userId).eq('status', 'completed')
      .order('created_at', { ascending: false }).limit(TREND_LIMIT),
  ]);
  const u = (user && user.data) || {};
  const language = u.preferred_language === 'ur' ? 'ur' : 'en';
  const firstName = firstNameOf(u) || null; // `name` only: first_name/last_name were dropped (bd-60092)
  const meta = (quiz && quiz.data && quiz.data.meta) || {};
  const quizMessage = typeof meta.student_message === 'string' && meta.student_message.trim() ? meta.student_message : null;
  // Oldest first; a session with no overall score is left out of the line, never drawn as zero.
  const trend = ((past && past.data) || []).map((r) => {
    const p = r && r.analysis_data && r.analysis_data.scores && r.analysis_data.scores.overall_percentage;
    return { created_at: r && r.created_at, pct: p == null || p === '' || !Number.isFinite(Number(p)) ? null : Number(p) };
  }).filter((r) => r.pct != null).reverse();
  return { session, language, quizMessage, firstName, trend };
}

function createCoachingReportRouter(opts = {}) {
  const load = opts.load || ((sessionId, userId) => loadReport(require('../config/supabase'), sessionId, userId));
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).type('html').send(renderMessagePage('error')),
  });
  const privateHeaders = (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    next();
  };

  const serve = (screen) => async (req, res) => {
    const token = String(req.params.token || '');
    const v = verifyReportLink(token);
    if (!v.ok && v.reason === 'expired') {
      log({ outcome: 'expired' });
      return res.redirect(302, SIGN_IN);
    }
    if (!v.ok) {
      log({ outcome: 'bad' });
      return res.status(404).type('html').send(renderMessagePage('not_found'));
    }
    const { sessionId, userId } = v;
    let data;
    try {
      data = await load(sessionId, userId);
    } catch (_) {
      log({ outcome: 'error', sessionId, userId });
      return res.status(503).type('html').send(renderMessagePage('error'));
    }
    if (!data) {
      log({ outcome: 'not_found', sessionId, userId });
      return res.status(404).type('html').send(renderMessagePage('not_found'));
    }
    const view = buildReportView(data);
    const links = { card: `${REPORT_PATH}/${token}`, detail: `${REPORT_PATH}/${token}/detail` };
    log({ outcome: 'ok', sessionId, userId, language: view.language, screen });
    const html = screen === 'detail' ? renderDetailPage(view, links) : renderReportPage(view, process.env, links);
    return res.status(200).type('html').send(html);
  };

  router.get(`${REPORT_PATH}/:token`, privateHeaders, limiter, serve('card'));
  router.get(`${REPORT_PATH}/:token/detail`, privateHeaders, limiter, serve('detail'));
  return router;
}

module.exports = { createCoachingReportRouter, loadReport };
