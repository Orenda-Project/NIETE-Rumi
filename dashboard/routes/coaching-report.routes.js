'use strict';
/**
 * Group C and D's coaching report page — v10 coaching test, bd-v0toag.18.
 *
 *   GET /cr/:token          genuine → that one coaching report's card (bd-v0toag.55), read-only, for the teacher the token names
 *                    (bot/shared/services/coaching/report-link-token.js; lasts 120 days, signs nobody in).
 *                    Expired → 302 to the portal sign-in, never a dead page (Amena, 14 Oct).
 *                    Bad, or not her session → a "link not complete" page, 404, no data.
 *   GET /cr/:token/detail   the same report's detailed screen (sections, journey); the same checks and answers.
 *   POST /cr/:token/useful  "What do you think of this report?" (bd-v0toag.49, reworded in .38.9 and .79): useful=yes|no, or
 *                    the 👎 reason, stored on the session's metrics row, then 303 back to the card. For C and D a
 *                    No opens the coach ping instead. POST only, so a link preview never answers; the reason
 *                    text is stored, never logged.
 *   GET|POST /cr/:token/coach  The coach ping (bd-v0toag.38.9, replacing .45's one-tap ask), groups C and D only
 *                    (404 for anyone else, and while ab_v10_enabled is off): what wasn't right, an optional
 *                    voice note, her coach when the school has more than one; Send pings the coach
 *                    (dashboard/services/coach-visit-request.js) and she goes back to the card (303, ?coach=).
 *
 * No link is sent until the report arm sends one (.19), so nothing changes for teachers when this ships.
 * The token is the credential: never logged; every answer is private and no-store. Rate limited per IP.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyReportLink, REPORT_PATH } = require('../../bot/shared/services/coaching/report-link-token');
const { renderReportPage, renderDetailPage, renderMessagePage } = require('../services/coaching-report-page');
const { renderReasonsPage } = require('../services/coach-ping-page');
const { cleanReasons } = require('../services/coach-ping-reasons');
const { buildReportView } = require('../services/coaching-report-view');
const { firstNameOf } = require('../../bot/shared/utils/person-name');
const useful = require('../services/coaching-useful');
const coachVisit = require('../services/coach-visit-request');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

const SIGN_IN = '/portal/login';
const SESSION_SELECT = 'id, user_id, created_at, analysis_data, prioritized_action, report_pdf_url, voice_debrief_url';
const TREND_LIMIT = 10;

function log(props, event = 'coaching.report_page.open') {
  try { telemetry.logEvent(event, props); } catch (_) { /* logging never decides the response */ }
}
const USEFUL_STATES = new Set(['yes', 'no', 'done']);
const COACH_STATES = new Set(['sent', 'already', 'failed', 'invalid', 'no_coach']);
const COACH_GROUPS = new Set(['C', 'D']);
const NOTE_RX = /^data:(audio\/[a-z0-9.+-]+)(;[^,]*)?;base64,/i;
const NOTE_MAX_BYTES = 1500000;

/** Her recorded note from the form's data URL, or undefined when it is missing, not audio or too big. */
function noteFrom(raw) {
  const m = typeof raw === 'string' ? NOTE_RX.exec(raw) : null;
  if (!m) return undefined;
  const buffer = Buffer.from(raw.slice(m[0].length), 'base64');
  return buffer.length && buffer.length <= NOTE_MAX_BYTES ? { buffer, type: m[1].toLowerCase() } : undefined;
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
  const firstName = firstNameOf(u) || null; // `name` only: first_name/last_name were dropped
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
  const db = () => require('../config/supabase');
  const load = opts.load || ((sessionId, userId) => loadReport(db(), sessionId, userId));
  const lookup = opts.groupOf || ((userId) => useful.groupOf(db(), userId));
  const groupOf = async (userId) => { try { return await lookup(userId); } catch (_) { return null; } };
  const recordUseful = opts.recordUseful || ((args) => useful.recordUseful(db(), args));
  const listCoaches = opts.coachesFor || ((userId) => coachVisit.coachesFor(db(), userId));
  const coachesFor = async (userId) => { try { return (await listCoaches(userId)) || []; } catch (_) { return []; } };
  const requestVisit = opts.requestVisit || ((args) => coachVisit.requestVisit(db(), args));
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).type('html').send(renderMessagePage('error')),
  });
  const privateHeaders = (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    next();
  };

  /** The link's session and teacher, or null once the bad/expired answer has been sent. */
  const verified = (token, res) => {
    const v = verifyReportLink(token);
    if (!v.ok && v.reason === 'expired') {
      log({ outcome: 'expired' });
      res.redirect(302, SIGN_IN);
      return null;
    }
    if (!v.ok) {
      log({ outcome: 'bad' });
      res.status(404).type('html').send(renderMessagePage('not_found'));
      return null;
    }
    return v;
  };

  const serve = (screen) => async (req, res) => {
    const token = String(req.params.token || '');
    const v = verified(token, res);
    if (!v) return undefined;
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
    const links = { card: `${REPORT_PATH}/${token}`, detail: `${REPORT_PATH}/${token}/detail`, useful: `${REPORT_PATH}/${token}/useful` };
    log({ outcome: 'ok', sessionId, userId, language: view.language, screen });
    if (screen === 'detail') return res.status(200).type('html').send(renderDetailPage(view, links));
    const state = USEFUL_STATES.has(req.query.useful) ? req.query.useful : undefined;
    const group = await groupOf(userId);
    if (COACH_GROUPS.has(group)) links.coach = `${REPORT_PATH}/${token}/coach`;
    const coachState = COACH_STATES.has(req.query.coach) ? req.query.coach : undefined;
    if (!state) log({ coachingSessionId: sessionId, userId, group, channel: 'page' }, 'coaching.useful.asked');
    return res.status(200).type('html').send(renderReportPage(view, process.env, links, state, coachState));
  };

  const answer = async (req, res) => {
    const token = String(req.params.token || '');
    const v = verified(token, res);
    if (!v) return undefined;
    const { sessionId, userId } = v;
    const card = `${REPORT_PATH}/${token}`;
    const body = req.body || {};
    const thumb = body.useful === 'yes' || body.useful === 'no' ? body.useful === 'yes' : undefined;
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, useful.REASON_MAX) : undefined;
    if (thumb === undefined && reason === undefined) return res.redirect(303, card);
    const args = thumb !== undefined ? { sessionId, userId, useful: thumb } : { sessionId, userId, reason };
    if (!(await recordUseful(args))) return res.status(503).type('html').send(renderMessagePage('error'));
    if (thumb === undefined) return res.redirect(303, `${card}?useful=done`);
    const group = await groupOf(userId);
    log({ coachingSessionId: sessionId, userId, useful: thumb, group, channel: 'page' }, 'coaching.useful.answered');
    // C and D: "No, I don't agree" goes straight to telling her coach.
    if (!thumb && COACH_GROUPS.has(group)) return res.redirect(303, `${card}/coach`);
    return res.redirect(303, `${card}?useful=${thumb ? 'yes' : 'no'}`);
  };

  /** The link's session, teacher and group when she is in C or D, or null once the 404 has been sent. */
  const coachGate = async (req, res) => {
    const v = verified(String(req.params.token || ''), res);
    if (!v) return null;
    const group = await groupOf(v.userId);
    if (COACH_GROUPS.has(group)) return { ...v, group };
    res.status(404).type('html').send(renderMessagePage('not_found'));
    return null;
  };

  const coachPage = async (req, res) => {
    const g = await coachGate(req, res);
    if (!g) return undefined;
    let data;
    try {
      data = await load(g.sessionId, g.userId);
    } catch (_) {
      return res.status(503).type('html').send(renderMessagePage('error'));
    }
    if (!data) return res.status(404).type('html').send(renderMessagePage('not_found'));
    const coaches = await coachesFor(g.userId);
    log({ coachingSessionId: g.sessionId, userId: g.userId, group: g.group, coaches: coaches.length }, 'coaching.coach_ping.asked');
    const card = `${REPORT_PATH}/${req.params.token}`;
    return res.status(200).type('html').send(renderReasonsPage(buildReportView(data), coaches, `${card}/coach`, card));
  };

  const coachAnswer = async (req, res) => {
    const g = await coachGate(req, res);
    if (!g) return undefined;
    const token = String(req.params.token);
    const body = req.body || {};
    const reasons = cleanReasons(body.reason);
    const note = noteFrom(body.note);
    if (!reasons.length && !note) return res.redirect(303, `${REPORT_PATH}/${token}/coach`);
    const coachId = typeof body.coach === 'string' && body.coach.trim() ? body.coach.trim().slice(0, 64) : null;
    const { sessionId, userId, group } = g;
    const out = await requestVisit({ sessionId, userId, group, coachId, reasons, note }).catch(() => null);
    const status = out && COACH_STATES.has(out.status) ? out.status : 'failed';
    log({ coachingSessionId: sessionId, userId, group, reasons, note: !!note }, `coaching.coach_ping.${status}`);
    return res.redirect(303, `${REPORT_PATH}/${token}?coach=${status}`);
  };

  router.get(`${REPORT_PATH}/:token`, privateHeaders, limiter, serve('card'));
  router.get(`${REPORT_PATH}/:token/detail`, privateHeaders, limiter, serve('detail'));
  router.post(`${REPORT_PATH}/:token/useful`, privateHeaders, limiter, express.urlencoded({ extended: false, limit: '8kb' }), answer);
  router.get(`${REPORT_PATH}/:token/coach`, privateHeaders, limiter, coachPage);
  // 2 MB: a 20-second voice note arrives as base64 in the form.
  router.post(`${REPORT_PATH}/:token/coach`, privateHeaders, limiter, express.urlencoded({ extended: false, limit: '2mb' }), coachAnswer);
  return router;
}

module.exports = { createCoachingReportRouter, loadReport };
