'use strict';
/**
 * Group C and D's coaching report page — v10 coaching test, bd-v0toag.18.
 *
 *   GET /cr/:token   genuine → that one coaching report, read-only, for the teacher the token names
 *                    (bot/shared/services/coaching/report-link-token.js; lasts 120 days, signs nobody in).
 *                    Expired → 302 to the portal sign-in, never a dead page (Amena, 14 Oct).
 *                    Bad, or not her session → a "link not complete" page, 404, no data.
 *
 * No link is sent until the report arm sends one (.19), so nothing changes for teachers when this ships.
 * The token is the credential: never logged; every answer is private and no-store. Rate limited per IP.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyReportLink, REPORT_PATH } = require('../../bot/shared/services/coaching/report-link-token');
const { renderReportPage, renderMessagePage } = require('../services/coaching-report-page');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

const SIGN_IN = '/portal/login';
const SESSION_SELECT = 'id, user_id, created_at, analysis_data, prioritized_action, report_pdf_url, voice_debrief_url';

function log(props) {
  try { telemetry.logEvent('coaching.report_page.open', props); } catch (_) { /* logging never decides the response */ }
}

/** The report, only for its own teacher, with her language and the session's student quiz message. */
async function loadReport(supabase, sessionId, userId) {
  const { data: session, error } = await supabase.from('coaching_sessions').select(SESSION_SELECT)
    .eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message || 'coaching_sessions read failed');
  if (!session) return null;
  const [user, quiz] = await Promise.all([
    supabase.from('users').select('preferred_language').eq('id', userId).maybeSingle(),
    supabase.from('quizzes').select('meta').eq('coaching_session_id', sessionId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const language = user && user.data && user.data.preferred_language === 'ur' ? 'ur' : 'en';
  const meta = (quiz && quiz.data && quiz.data.meta) || {};
  const quizMessage = typeof meta.student_message === 'string' && meta.student_message.trim() ? meta.student_message : null;
  return { session, language, quizMessage };
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

  router.get(`${REPORT_PATH}/:token`, privateHeaders, limiter, async (req, res) => {
    const v = verifyReportLink(String(req.params.token || ''));
    if (!v.ok && v.reason === 'expired') {
      log({ outcome: 'expired' });
      return res.redirect(302, SIGN_IN);
    }
    if (!v.ok) {
      log({ outcome: 'bad' });
      return res.status(404).type('html').send(renderMessagePage('not_found'));
    }
    const { sessionId, userId } = v;
    let view;
    try {
      view = await load(sessionId, userId);
    } catch (_) {
      log({ outcome: 'error', sessionId, userId });
      return res.status(503).type('html').send(renderMessagePage('error'));
    }
    if (!view) {
      log({ outcome: 'not_found', sessionId, userId });
      return res.status(404).type('html').send(renderMessagePage('not_found'));
    }
    log({ outcome: 'ok', sessionId, userId, language: view.language === 'ur' ? 'ur' : 'en' });
    return res.status(200).type('html').send(renderReportPage(view));
  });
  return router;
}

module.exports = { createCoachingReportRouter, loadReport };
