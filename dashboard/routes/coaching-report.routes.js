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
 *   POST /cr/:token/time   bd-chz35n.25: the seconds the page was in view (report-page-time.js), only while
 *                    report_delivery_fixes.time_on_page is on; off → 404, and the pages carry no script (today's bytes).
 *
 * No link is sent until the report arm sends one (.19), so nothing changes for teachers when this ships.
 * The token is the credential: never logged; every answer is private and no-store. Rate limited per IP.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyReportLink, REPORT_PATH } = require('../../bot/shared/services/coaching/report-link-token');
const { renderReportPage, renderDetailPage, renderMessagePage } = require('../services/coaching-report-page');
const { renderReasonsPage } = require('../services/coach-ping-page');
const { cleanReasons, reasonText } = require('../services/coach-ping-reasons');
const { buildReportView } = require('../services/coaching-report-view');
const { firstNameOf } = require('../../bot/shared/utils/person-name');
const useful = require('../services/coaching-useful');
const coachVisit = require('../services/coach-visit-request');
const videoReco = require('../services/video-reco-events');
const pageTime = require('../services/report-page-time');
const deliveryFixes = require('../../bot/shared/services/coaching/report-delivery-switch');
const { cachedSwitch } = require('../../bot/shared/services/settings/switch-cache');
const { fetchFrom: pageQuizSwitch, LANGS: QUIZ_LANGS, SURFACES: QUIZ_SURFACES } = require('../../bot/shared/services/quiz/report-page-quiz');
const { renderQuizPage, renderQuizBlock, BEACON_EVENTS, NOTICE } = require('../services/report-quiz-page');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

const SIGN_IN = '/portal/login';
// observation_type (bd-r2uzg1.12): a coach visit gets no "the lesson plan you chose" line, and without the column
// every visit would read as her own recording.
const SESSION_SELECT = 'id, user_id, created_at, analysis_data, prioritized_action, report_pdf_url, voice_debrief_url, observation_type';
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
    // bd-ra8xu.38 / bd-pni007: a session on its own rubric (FICO17 v6, FDE obs612) is left off the V3 line, like one
    // with no score.
    const p = r && r.analysis_data && !require('../services/coaching-frameworks.service').isOwnRubric(r.analysis_data)
      && r.analysis_data.scores && r.analysis_data.scores.overall_percentage;
    return { created_at: r && r.created_at, pct: p == null || p === '' || !Number.isFinite(Number(p)) ? null : Number(p) };
  }).filter((r) => r.pct != null).reverse();
  // bd-gzfdu9: the recommended clip's card — read only while VIDEO_RECO_ENABLED is on (a tier without the table
  // never sees the query); any failure is "no card", never a failed report. VIDEO_RECO_CR_CARD=false (R7r, the A/B) skips it.
  if (videoReco.enabled() && videoReco.crCardEnabled()) {
    try {
      const video = await videoReco.cardFor(supabase, sessionId, userId, language, videoReco.catalogOrNull());
      if (video) return { session, language, quizMessage, firstName, trend, video };
    } catch (_) { /* the report without the card */ }
  }
  return { session, language, quizMessage, firstName, trend };
}

/**
 * qfix offers: the bot's /api/internal/rq (report-quiz-internal.routes.js), reached as every portal → bot call is
 * (MAIN_BOT_URL + INTERNAL_API_KEY, read per call). Resolves { status, body }; never throws past a refusal or a timeout.
 */
function createReportQuizClient(options = {}) {
  const call = createBotCaller(options);
  return (op, body) => call('POST', `/api/internal/rq/${op}`, body);
}

/** One portal → bot call (method, path, JSON body). Resolves { status, body }; a refusal or a timeout is { 503 }. */
function createBotCaller({ fetchImpl = (...a) => fetch(...a), timeoutMs = 4000 } = {}) {
  return async (method, pathname, body) => {
    const base = String(process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
    const key = process.env.INTERNAL_API_KEY || '';
    if (!base || !key) return { status: 503, body: null };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${pathname}`, {
        method, headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': key },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }), signal: ctl.signal,
      });
      let json = null;
      try { json = await res.json(); } catch (_) { json = null; }
      return { status: res.status, body: json };
    } catch (_) {
      return { status: 503, body: null };
    } finally {
      clearTimeout(timer);
    }
  };
}
// The /cr report shows the page block for an offer held for a closed window or a quiz made in the page; a quiz made in
// WhatsApp keeps the report's own section.
const crShowsBlock = (quiz) => Boolean(quiz && (quiz.state === 'held' || (quiz.page && quiz.state !== 'none')));
// the ?e= line a save or a refusal left, only one the page knows
const noticeOf = (query) => (query && typeof query.e === 'string' && Object.prototype.hasOwnProperty.call(NOTICE, query.e) ? query.e : null);

function createCoachingReportRouter(opts = {}) {
  const db = () => require('../config/supabase');
  const load = opts.load || ((sessionId, userId) => loadReport(db(), sessionId, userId));
  const lookup = opts.groupOf || ((userId) => useful.groupOf(db(), userId));
  const groupOf = async (userId) => { try { return await lookup(userId); } catch (_) { return null; } };
  const recordUseful = opts.recordUseful || ((args) => useful.recordUseful(db(), args));
  const listCoaches = opts.coachesFor || ((userId) => coachVisit.coachesFor(db(), userId));
  const coachesFor = async (userId) => { try { return (await listCoaches(userId)) || []; } catch (_) { return []; } };
  const requestVisit = opts.requestVisit || ((args) => coachVisit.requestVisit(db(), args));
  // bd-chz35n.25: report_delivery_fixes, read through the portal's own client; any failure is off.
  const switchCache = cachedSwitch({ ttlMs: 30 * 1000, off: () => ({ ...deliveryFixes.OFF }), read: () => deliveryFixes.fetchFrom(db()) });
  const readSwitch = opts.deliverySwitch || ((now) => switchCache.get(now));
  const timeOnPage = async () => { try { return (await readSwitch()).timeOnPage === true; } catch (_) { return false; } };
  // qfix offers: quiz_offer_closed_window.report_page, the "Make a quiz" block for an offer held for a closed window.
  const quizSwitchCache = cachedSwitch({ ttlMs: 30 * 1000, off: false, read: () => pageQuizSwitch(db()) });
  const quizPageOn = async () => { try { return (await quizSwitchCache.get()) === true; } catch (_) { return false; } };
  const botNumber = () => String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
  const reportQuiz = opts.reportQuiz || createReportQuizClient();
  // The bot's quiz edit routes (/api/internal/wqedit, quiz-teacher-edit.routes.js; switch web_quiz_teacher_edit,
  // off → 404). The PDF remake renders inline, so it gets longer than a page read.
  const callBot = opts.callBot || createBotCaller();
  const callBotSlow = opts.callBotSlow || opts.callBot || createBotCaller({ timeoutMs: 25000 });
  /** The bot's view of the quiz for its teacher (questions with qid and key, locked, edit_v, min, pdf), or null. */
  const editView = async (model, userId) => {
    if (!model || model.state !== 'ready' || !model.quizId) return null;
    const r = await callBot('GET', `/api/internal/wqedit/quiz/${encodeURIComponent(model.quizId)}?t=${encodeURIComponent(userId)}`);
    return r.status === 200 && r.body && r.body.editable !== false && Array.isArray(r.body.questions) ? r.body : null;
  };
  /** The bot's state for the quiz block, or null (switch off, the bot unreachable, not this teacher's). */
  const quizModel = async (sessionId, userId) => {
    if (!(await quizPageOn())) return null;
    const r = await reportQuiz('state', { sessionId, userId });
    return r.status === 200 && r.body && r.body.state ? r.body : null;
  };
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
    const timed = await timeOnPage();
    const send = (html) => res.status(200).type('html').send(timed ? pageTime.withTiming(html, `${REPORT_PATH}/${token}/time`, screen) : html);
    if (screen === 'detail') return send(renderDetailPage(view, links));
    const state = USEFUL_STATES.has(req.query.useful) ? req.query.useful : undefined;
    const group = await groupOf(userId);
    if (COACH_GROUPS.has(group)) links.coach = `${REPORT_PATH}/${token}/coach`;
    const quiz = await quizModel(sessionId, userId);
    if (crShowsBlock(quiz)) {
      const edit = await editView(quiz, userId);
      links.quizBlock = renderQuizBlock(quiz, {
        language: view.language, base: `/cq/${token}`, surface: 'cr', bot: botNumber(), heading: true, edit, notice: noticeOf(req.query),
      });
    }
    const coachState = COACH_STATES.has(req.query.coach) ? req.query.coach : undefined;
    if (!state) log({ coachingSessionId: sessionId, userId, group, channel: 'page' }, 'coaching.useful.asked');
    return send(renderReportPage(view, process.env, links, state, coachState));
  };

  const timeAnswer = async (req, res) => {
    if (!(await timeOnPage())) return res.status(404).type('html').send(renderMessagePage('not_found'));
    const v = verified(String(req.params.token || ''), res);
    if (!v) return undefined;
    const t = pageTime.parseTime(req.body);
    if (t) log({ sessionId: v.sessionId, userId: v.userId, screen: t.screen, ms: t.ms }, 'coaching.report_page.time');
    return res.status(204).end();
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
    return res.status(200).type('html').send(renderReasonsPage(buildReportView(data), coaches, `${card}/coach`));
  };

  const coachAnswer = async (req, res) => {
    const g = await coachGate(req, res);
    if (!g) return undefined;
    const token = String(req.params.token);
    const body = req.body || {};
    const reasons = cleanReasons(body.reason);
    if (body.cancel) {
      // Cancel asks no coach, but her ticked reasons are her 👎 reason, as A/B's typed one is (bd-v0toag.80).
      if (reasons.length) {
        await recordUseful({ sessionId: g.sessionId, userId: g.userId, reason: reasonText(reasons, 'en') });
        log({ coachingSessionId: g.sessionId, userId: g.userId, group: g.group, reasons }, 'coaching.coach_ping.cancelled');
      }
      return res.redirect(303, `${REPORT_PATH}/${token}`);
    }
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
  router.post(`${REPORT_PATH}/:token/time`, privateHeaders, limiter, express.urlencoded({ extended: false, limit: '1kb' }), timeAnswer);
  router.get(`${REPORT_PATH}/:token/coach`, privateHeaders, limiter, coachPage);
  // 2 MB: a 20-second voice note arrives as base64 in the form.
  router.post(`${REPORT_PATH}/:token/coach`, privateHeaders, limiter, express.urlencoded({ extended: false, limit: '2mb' }), coachAnswer);

  // qfix offers: /cq/:token, the quiz-only page the closed-window report's button opens for a teacher who does not get
  // the new report, and the actions of the quiz block on it and on /cr (dashboard/services/report-quiz-page.js; bot
  // quiz/report-page-quiz.js). The /cr token and its checks; switch off → 404, the link not complete.
  //   GET  /cq/:token          the page            POST /cq/:token/make   the tap (303 back, or JSON)
  //   GET  /cq/:token/state    the poll (JSON)     POST /cq/:token/lang   the language picked
  //   GET  /cq/:token/pdf      302 to the PDF      GET  /cq/:token/try    302 to the student's view
  //   POST /cq/:token/e        one beacon: copy | share | view_questions | make_timeout (204)
  const quizGate = async (req, res) => {
    if (!(await quizPageOn())) {
      res.status(404).type('html').send(renderMessagePage('not_found'));
      return null;
    }
    return verified(String(req.params.token || ''), res);
  };
  const surfaceOf = (b) => (QUIZ_SURFACES.includes(b && b.surface) ? b.surface : 'cq');
  const backTo = (token, surface) => (surface === 'cr' ? `${REPORT_PATH}/${token}#quiz` : `/cq/${token}`);
  // back to the page with the outcome's line and the question in view
  const backWith = (token, surface, code, qid) => `${surface === 'cr' ? `${REPORT_PATH}/${token}` : `/cq/${token}`}?e=${code}${qid ? `#q-${qid}` : ''}`;
  const wantsJson = (req) => /application\/json/i.test(String(req.get('accept') || ''));
  const quizEvent = (name, v, props) => log({ coachingSessionId: v.sessionId, userId: v.userId, ...props }, name);

  const quizPage = async (req, res) => {
    const v = await quizGate(req, res);
    if (!v) return undefined;
    let data;
    try {
      data = await load(v.sessionId, v.userId);
    } catch (_) {
      log({ outcome: 'error', sessionId: v.sessionId, userId: v.userId, screen: 'quiz' });
      return res.status(503).type('html').send(renderMessagePage('error'));
    }
    if (!data) return res.status(404).type('html').send(renderMessagePage('not_found'));
    const language = data.language === 'ur' ? 'ur' : 'en';
    // The bot unreachable: the made quiz's message as the report has it, else the /quiz door.
    const model = (await quizModel(v.sessionId, v.userId))
      || (data.quizMessage ? { state: 'ready', message: data.quizMessage, questions: [], pdf: false, preview: null } : { state: 'none' });
    log({ outcome: 'ok', sessionId: v.sessionId, userId: v.userId, language, screen: 'quiz', state: model.state });
    const topic = data.session && data.session.analysis_data && data.session.analysis_data.topic;
    const token = String(req.params.token);
    const edit = await editView(model, v.userId);
    return res.status(200).type('html').send(renderQuizPage({ language, topic, model, base: `/cq/${token}`, bot: botNumber(), edit, notice: noticeOf(req.query) }));
  };

  /** make / lang: the bot's answer, then 303 back to the page the form was on (or the state as JSON). */
  const quizAction = (op, bodyOf) => async (req, res) => {
    const v = await quizGate(req, res);
    if (!v) return undefined;
    const b = req.body || {};
    const surface = surfaceOf(b);
    const r = await reportQuiz(op, { sessionId: v.sessionId, userId: v.userId, surface, ...bodyOf(b) });
    if (r.status === 404) return res.status(404).type('html').send(renderMessagePage('not_found'));
    if (r.status !== 200 || !r.body) return res.status(503).type('html').send(renderMessagePage('error'));
    if (wantsJson(req)) return res.status(200).json(r.body);
    return res.redirect(303, backTo(String(req.params.token), surface));
  };

  const quizState = async (req, res) => {
    if (!(await quizPageOn())) return res.status(404).json({ error: 'off' });
    const v = verifyReportLink(String(req.params.token || ''));
    if (!v.ok) return res.status(404).json({ error: 'not_found' });
    const model = await quizModel(v.sessionId, v.userId);
    return model ? res.status(200).json({ state: model.state }) : res.status(503).json({ error: 'unavailable' });
  };

  const quizPdf = async (req, res) => {
    const v = await quizGate(req, res);
    if (!v) return undefined;
    const surface = surfaceOf(req.query);
    const r = await reportQuiz('pdf', { sessionId: v.sessionId, userId: v.userId });
    if (r.status === 200 && r.body && typeof r.body.url === 'string') {
      quizEvent('transcript_quiz.page_pdf', v, { surface });
      return res.redirect(302, r.body.url);
    }
    // No stored PDF (an edit drops it): the bot makes it again from the edited quiz, then the same 1-hour link.
    const model = await quizModel(v.sessionId, v.userId);
    if (!model || model.state !== 'ready' || !model.quizId) return res.status(404).type('html').send(renderMessagePage('not_found'));
    const made = await callBotSlow('POST', '/api/internal/wqedit/pdf', { quizId: model.quizId, teacherUserId: v.userId });
    if (made.status === 404 || made.status === 403) return res.status(404).type('html').send(renderMessagePage('not_found'));
    if (made.status === 200 && made.body && made.body.pdf === 'ready') {
      const again = await reportQuiz('pdf', { sessionId: v.sessionId, userId: v.userId });
      if (again.status === 200 && again.body && typeof again.body.url === 'string') {
        quizEvent('transcript_quiz.page_pdf', v, { surface, remade: true });
        return res.redirect(302, again.body.url);
      }
    }
    // not ready yet (a slow render, a later save, a failure the bot logged): the page says so; Download again later
    quizEvent('transcript_quiz.page_pdf', v, { surface, remade: 'pending' });
    return res.redirect(303, backWith(String(req.params.token), surface, 'pdf_pending'));
  };

  /**
   * POST /cq/:token/edit — one question's form. The teacher is the token's (never the form's); the quiz is the
   * session's own (the bot's state); the form is diffed against the bot's view into one ops array and sent with the edit_v
   * the page was drawn with. After the first child answer only the right answer is sent. Back to the page with the line.
   */
  const EDIT_REASONS = new Set(['locked', 'floor', 'stale', 'too_long', 'empty', 'not_text', 'not_editable']);
  const keyOf = (x) => [...new Set((Array.isArray(x) ? x : [x]).filter((k) => typeof k === 'string' && k))].sort().join(',');
  const quizEdit = async (req, res) => {
    const v = await quizGate(req, res);
    if (!v) return undefined;
    const b = req.body || {};
    const surface = surfaceOf(b);
    const token = String(req.params.token);
    const model = await quizModel(v.sessionId, v.userId);
    const view = await editView(model, v.userId);
    if (!view) return res.status(404).type('html').send(renderMessagePage('not_found'));
    const it = view.questions.find((x) => x && x.qid === b.qid);
    if (!it) return res.status(400).type('html').send(renderMessagePage('not_found'));
    // the page always sends the version it was drawn with; without it a save could land over a newer one
    const drawn = Number.parseInt(String(b.v), 10);
    if (!Number.isFinite(drawn) || drawn < 0) return res.status(400).type('html').send(renderMessagePage('not_found'));
    const ed = it.editable || {};
    const slots = new Set((it.options || []).map((o) => o.slot));
    const ops = [];
    let held = false; // a wording change kept out: by the lock, or by what the item allows
    const changed = (x, was) => typeof x === 'string' && x.trim() !== String(was == null ? '' : was);
    if (b.do === 'remove') {
      if (view.locked || ed.remove === false) held = true;
      else ops.push({ op: 'remove', qid: it.qid });
    } else {
      if (changed(b.text, it.text)) {
        if (view.locked || ed.text === false || it.picture) held = true;
        else ops.push({ op: 'text', qid: it.qid, text: b.text.trim() });
      }
      for (const o of it.options || []) {
        if (!changed(b[`opt_${o.slot}`], o.text)) continue;
        if (view.locked || ed.options === false || o.picture) held = true;
        else ops.push({ op: 'option', qid: it.qid, slot: o.slot, text: b[`opt_${o.slot}`].trim() });
      }
      // one slot (a radio), or several for a "pick all that apply" item (checkboxes), sent as "A,C"
      const key = b.key === undefined ? null : keyOf(b.key);
      if (key !== null && key !== keyOf(String(it.key || '').split(','))) {
        if (!key || key.split(',').some((k) => !slots.has(k)) || (!it.multi && key.includes(','))) {
          return res.status(400).type('html').send(renderMessagePage('not_found'));
        }
        if (ed.key !== false) ops.push({ op: 'key', qid: it.qid, slot: key });
      }
    }
    if (!ops.length) return res.redirect(303, backWith(token, surface, held ? (view.locked ? 'locked' : 'not_editable') : 'none', it.qid));
    // the page drew v; the bot refuses a save over a newer one (stale)
    const r = await callBotSlow('POST', '/api/internal/wqedit/save', {
      quizId: model.quizId, teacherUserId: v.userId, v: drawn, ops, surface,
    });
    const why = r.body && typeof r.body.reason === 'string' ? r.body.reason : null;
    const code = r.status === 200 && r.body && r.body.ok ? 'saved' : why === 'no_change' ? 'none' : EDIT_REASONS.has(why) ? why : 'failed';
    // the bot logs transcript_quiz.page_edit per saved field; this is the page's own outcome, once per save
    quizEvent('transcript_quiz.page_edit_result', v, {
      quizId: model.quizId, outcome: code, fields: ops.map((o) => o.op).join(','), locked: Boolean(view.locked), surface,
    });
    return res.redirect(303, backWith(token, surface, code, it.qid));
  };

  const quizTry = async (req, res) => {
    const v = await quizGate(req, res);
    if (!v) return undefined;
    const model = await quizModel(v.sessionId, v.userId);
    if (!model || model.state !== 'ready' || model.closed || typeof model.preview !== 'string') return res.status(404).type('html').send(renderMessagePage('not_found'));
    quizEvent('transcript_quiz.page_try', v, { surface: surfaceOf(req.query) });
    return res.redirect(302, model.preview);
  };

  const BEACON = { copy: 'page_copy', share: 'page_share', view_questions: 'page_view_questions', make_timeout: 'page_make_failed' };
  const quizBeacon = async (req, res) => {
    const v = await quizGate(req, res);
    if (!v) return undefined;
    const b = req.body || {};
    if (!BEACON_EVENTS.includes(b.ev)) return res.status(400).json({ error: 'bad_event' });
    const props = { surface: surfaceOf(b) };
    // the page's beacon is form-encoded ("true"); a JSON body says true
    const yes = (x) => x === true || x === 'true';
    if (b.ev === 'copy') {
      props.fallback = yes(b.fallback);
      if (yes(b.manual)) props.manual = true;
    }
    if (b.ev === 'make_timeout') props.reason = 'timeout';
    quizEvent(`transcript_quiz.${BEACON[b.ev]}`, v, props);
    return res.status(204).end();
  };

  const form = express.urlencoded({ extended: false, limit: '4kb' });
  const json = express.json({ limit: '2kb' });
  router.get('/cq/:token', privateHeaders, limiter, quizPage);
  router.get('/cq/:token/state', privateHeaders, limiter, quizState);
  router.post('/cq/:token/make', privateHeaders, limiter, form, json, quizAction('make', () => ({})));
  router.post('/cq/:token/lang', privateHeaders, limiter, form, json,
    quizAction('lang', (b) => ({ language: QUIZ_LANGS.includes(b.language) ? b.language : null })));
  router.get('/cq/:token/pdf', privateHeaders, limiter, quizPdf);
  router.get('/cq/:token/try', privateHeaders, limiter, quizTry);
  router.post('/cq/:token/e', privateHeaders, limiter, form, json, quizBeacon);
  // a question's text and four answers fit well inside 16 kB
  router.post('/cq/:token/edit', privateHeaders, limiter, express.urlencoded({ extended: false, limit: '16kb' }), quizEdit);
  return router;
}

module.exports = { createCoachingReportRouter, loadReport, createReportQuizClient, createBotCaller };
