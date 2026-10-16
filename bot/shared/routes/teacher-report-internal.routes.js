'use strict';
/**
 * /api/internal/tr/* — the teacher's web quiz report, called only by the
 * portal's /r/<token> pages (which forward with x-api-key). Every route sits
 * behind requireInternalKey; WHO is asking comes only from the signed report
 * token (kind 'tr'), never from the request.
 *
 *   GET /page/:token[?lang=&tab=class&class=<listId>]  the report page (HTML)
 *   GET /pdf/:token[?lang=&tab=class]                  the same page, print mode, as a PDF
 *   GET /remind/:token?quiz=<id>                       logs the tap, 302 -> wa.me with the reminder
 *   GET /jlink/:token?class=<id>&how=forward|copy      the class link card: 302 -> wa.me with the link only / 303 back, card open
 *   POST /jnew/:token {class, n}                       the class link card's confirm "Make a new link": 303 back to the class tab
 *                                                      (400 without the confirm card's signed nonce n; a stale one → 303
 *                                                      back to the confirm card with a fresh nonce; nothing revoked)
 *   GET /data/:token                                   the report as JSON (tests, QA)
 *   POST /class/:token {quiz, key}                     "Which class was this for?" -> identity v2 whoClass
 *   POST /fix/:token {quiz, ref, add|studentId}        a typed child: add to the class / who it really is -> fixWho
 *   GET /fwd/:token, POST /queue/:token                the Jugnu tab's (teacher-jugnu-internal.routes; switch off -> 404)
 * The two POSTs answer 303 back to the report (with ?e=1 when nothing was saved).
 *
 * A bad or expired token gets the "link has expired" page (401 / 410); a quiz
 * that is not the token's teacher's is 404 — never 403, so it says nothing
 * about whether the quiz exists.
 */
const express = require('express');
const { performance } = require('perf_hooks');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const supabase = require('../config/supabase');
const { clampLanguage } = require('../config/ux-strings');
const Data = require('../services/quiz/teacher-report.data');
const Token = require('../services/quiz/teacher-report-token');
const { renderPage, renderMessagePage, REPORT_PATH } = require('../templates/teacher-report.page');
const Jugnu = require('./teacher-jugnu-internal.routes'); // the Jugnu tab (web_quiz_teacher_jugnu)

const router = express.Router();
router.use(requireInternalKey);
router.use(express.json({ limit: '4kb' }));

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// WhatsApp's in-app browser (and Android WebViews generally) — for the opened event only.
const IAB_RX = /WhatsApp|; wv\)|FBAN|FBAV|Instagram/i;
const PKT_MS = 5 * 3600 * 1000;

const noStore = (res) => res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
const queryLang = (req) => (req.query.lang === 'ur' || req.query.lang === 'en' ? req.query.lang : null);
const uuidOr = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);

function page(res, status, kind, lang) {
  noStore(res);
  return res.status(status).type('html').send(renderMessagePage({ kind, lang }));
}

/** The token's payload, or the expired page already sent (null). */
function authorise(req, res) {
  const v = Token.verifyTeacherReport(req.params.token);
  if (v) return v;
  const reason = Token.explain(req.params.token) === 'expired' ? 'expired' : 'bad';
  logEvent('teacher_report.denied', { reason, route: req.path.split('/')[1] || '' });
  // An expired link and a cut-off / tampered one are different states (Rule 24d).
  page(res, reason === 'expired' ? 410 : 401, reason === 'expired' ? 'expired' : 'incomplete', queryLang(req));
  return null;
}

/** The teacher's chrome language: ?lang=, else the quiz's own language, else their preference. */
async function languageFor(req, teacherId, quizLanguage) {
  const asked = queryLang(req);
  if (asked) return asked;
  if (quizLanguage === 'ur' || quizLanguage === 'en') return quizLanguage;
  try {
    const { data } = await supabase.from('users').select('preferred_language').eq('id', teacherId).maybeSingle();
    return clampLanguage(data && data.preferred_language);
  } catch (err) {
    logToFile('⚠️ teacher report: preferred_language read failed — English chrome', { teacherId, error: err.message }, 'warn');
    return clampLanguage(null);
  }
}

/**
 * How long the page waits on the class report's base read (ms). The portal edge gives the bot 10 s
 * (BOT_TIMEOUT_MS) and answered 502 at ~10.8 s; the base alone measured 6.7–7.6 s bot-direct for a teacher
 * with 43 lists / 561 codes, and the edge added up to ~3 s on top. 5 s leaves the rest of the page and the
 * edge inside 10 s. Past it the class tab renders without its quiz sections (the retry line instead).
 */
const BASE_BUDGET_MS = 5000;
const OVER_BUDGET = Symbol('over budget');

/** The class report's base read raced against the budget: its answer (or its error) in time, else OVER_BUDGET. */
async function baseWithin(teacherId, ms) {
  const work = Data.classReport(teacherId);
  let timer;
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(OVER_BUDGET), ms); });
  try {
    const out = await Promise.race([work, budget]);
    if (out !== OVER_BUDGET) return out;
  } finally {
    clearTimeout(timer);
  }
  work.catch((err) => logToFile('⚠️ teacher report: the class report failed after its budget', { error: err && err.message }, 'warn'));
  logToFile('⚠️ teacher report: the class report was over its budget — the page renders without it', { budget_ms: ms }, 'warn');
  return OVER_BUDGET;
}

/**
 * Everything one page needs: the data, its tab, its language and the tokens it links with.
 * opts.budgetMs (the page only): the class report's base read waits at most this long; opts.lang: already known.
 */
async function build(req, v, opts = {}) {
  const tab = req.query.tab === 'class' || !v.quizId ? 'class' : 'quiz';
  if (tab === 'quiz') {
    const report = await Data.quizReport(v.teacherId, v.quizId, { listId: uuidOr(req.query.class) });
    if (!report) return null;
    const lang = await languageFor(req, v.teacherId, report.quiz && report.quiz.language);
    return { tab, lang, data: { quiz: report }, report, tokens: { self: req.params.token } };
  }
  const based = opts.budgetMs ? await baseWithin(v.teacherId, opts.budgetMs) : await Data.classReport(v.teacherId);
  const report = based === OVER_BUDGET ? null : based;
  const quizTokens = {};
  ((report && report.quizzes) || []).forEach((q) => {
    const t = Token.signTeacherReport({ teacherId: v.teacherId, quizId: q.id });
    if (t) quizTokens[q.id] = t;
  });
  const lang = opts.lang || await languageFor(req, v.teacherId, null);
  const classData = report || (based === OVER_BUDGET ? { pending: true } : {});
  // ── standing class link card (web_quiz_class_link): null when off → the class tab is unchanged ──
  const classLink = await require('../services/quiz/web-quiz-class-link').forTeacher(v.teacherId);
  if (classLink) classData.classLink = { ...classLink, open: uuidOr(req.query.cl_open) };
  // "Make a new link" asks first (?jconfirm=<class>): that class's card shows the warning and a nonce for this teacher + class.
  const asked = classLink ? uuidOr(req.query.jconfirm) : null;
  if (asked && classLink.cards.some((c) => c.classId === asked)) {
    const n = require('../services/quiz/web-quiz-class-link').signRenewNonce({ teacherId: v.teacherId, classId: asked });
    if (n) classData.classLink.confirm = { classId: asked, n };
  }
  // ── end standing class link card ──
  return { tab, lang, data: { class: classData }, report, tokens: { self: req.params.token, quiz: quizTokens } };
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    logToFile('❌ teacher report route failed', { route: req.path.split('/')[1] || '', error: err.message }, 'error');
    if (!res.headersSent) page(res, 500, 'error', queryLang(req));
  }
};

function notFound(req, res, v) {
  logEvent('teacher_report.denied', { reason: 'not_found', teacherId: v.teacherId, route: req.path.split('/')[1] || '' });
  return page(res, 404, 'missing', queryLang(req));
}

/**
 * Events v2 (web_quiz_events_v2, fail-closed): teacher_report.opened in the v2 envelope with render_ms (the route's
 * start to just before the send) and queue_age_s (the kept queue's age in whole seconds, ≤ QUEUE_TTL_S, when the
 * join-queue service has queueAge and keeps one); the same numbers as the x-render-ms / x-queue-age headers. Off:
 * today's event, no headers.
 */
async function queueAgeOf(teacherId) {
  try {
    const Q = require('../services/quiz/teacher-jugnu.data').queueService();
    if (!Q || typeof Q.queueAge !== 'function') return null;
    const age = await Q.queueAge(teacherId);
    return typeof age === 'number' && Number.isFinite(age) && age >= 0 ? Math.round(age) : null; // null: none known
  } catch (err) {
    logToFile('⚠️ teacher report: the queue age read failed', { error: err.message }, 'warn');
    return null;
  }
}

router.get('/page/:token', handle(async (req, res) => {
  const t0 = performance.now();
  const v = authorise(req, res);
  if (!v) return;
  const budgetMs = module.exports.BASE_BUDGET_MS;
  let b;
  let jugnu;
  if (req.query.tab === 'jugnu' && !v.quizId) {
    // The Jugnu tab draws none of the class report: its own reads run beside the base read, not after it.
    const lang = await languageFor(req, v.teacherId, null);
    [b, jugnu] = await Promise.all([build(req, v, { budgetMs, lang }), Jugnu.pageExtras(req, v, lang)]);
    if (!b) { notFound(req, res, v); return; }
  } else {
    b = await build(req, v, { budgetMs });
    if (!b) { notFound(req, res, v); return; }
    jugnu = await Jugnu.pageExtras(req, v, b.lang); // Jugnu tab: null when its switch is off
  }
  // ── class round (web_quiz_class_round): its card on the class tab; '' when off or no open draw ──
  const roundCard = b.tab === 'class' ? await require('../services/quiz/web-quiz-class-round').cardFor(v.teacherId, { lang: b.lang, token: req.params.token }) : '';
  const opened = {
    teacherId: v.teacherId, quizId: v.quizId, scope: v.quizId ? 'quiz' : 'all', tab: jugnu && jugnu.view ? 'jugnu' : b.tab, iab: IAB_RX.test(req.get('user-agent') || ''),
  };
  const v2 = await require('../services/quiz/web-quiz-hub-flags').eventsV2On();
  if (!v2) logEvent('teacher_report.opened', opened);
  const queueAge = v2 ? await queueAgeOf(v.teacherId) : null;
  const html = renderPage(b.data, {
    lang: b.lang, tab: b.tab, scope: v.quizId ? 'quiz' : 'all', tokens: b.tokens, notice: NOTICES[req.query.e] || null, ok: okOf(req.query),
    ...(jugnu ? { jugnu } : {}),
    ...(roundCard ? { roundCard } : {}),
  });
  if (v2) {
    const renderMs = Math.max(0, Math.round(performance.now() - t0));
    logEvent('teacher_report.opened', require('../services/quiz/web-quiz-kid').envelope({
      ...opened, render_ms: renderMs, ...(queueAge != null ? { queue_age_s: queueAge } : {}),
    }));
    res.set('x-render-ms', String(renderMs));
    if (queueAge != null) res.set('x-queue-age', String(queueAge));
  }
  noStore(res);
  res.status(200).type('html').send(html);
}));

router.get('/pdf/:token', handle(async (req, res) => {
  const v = authorise(req, res);
  if (!v) return;
  const b = await build(req, v);
  if (!b) { notFound(req, res, v); return; }
  const html = renderPage(b.data, { lang: b.lang, tab: b.tab, scope: v.quizId ? 'quiz' : 'all', tokens: b.tokens, print: true });
  // Required here, not at the top: Chromium is loaded only when a PDF is asked for.
  // eslint-disable-next-line global-require
  const { htmlToPdf } = require('../utils/html-to-pdf');
  const pdf = await htmlToPdf(html);
  const day = new Date(Date.now() + PKT_MS).toISOString().slice(0, 10);
  logEvent('teacher_report.pdf', { teacherId: v.teacherId, quizId: v.quizId, scope: v.quizId ? 'quiz' : 'all' });
  noStore(res);
  res.set('Content-Disposition', `attachment; filename="quiz-report-${day}.pdf"`);
  res.status(200).type('application/pdf').send(pdf);
}));

router.get('/remind/:token', handle(async (req, res) => {
  const v = authorise(req, res);
  if (!v) return;
  const asked = uuidOr(req.query.quiz);
  // A quiz token reminds for its own quiz only; a teacher-wide token for any quiz of that teacher.
  if (v.quizId && asked && asked !== v.quizId) { notFound(req, res, v); return; }
  const quizId = v.quizId || asked;
  const report = quizId ? await Data.quizReport(v.teacherId, quizId) : null;
  if (!report || !report.reminder || !report.reminder.text) { notFound(req, res, v); return; }
  logEvent('teacher_report.reminder', {
    teacherId: v.teacherId, quizId, notPlayed: Array.isArray(report.notPlayed) ? report.notPlayed.length : null,
  });
  noStore(res);
  res.redirect(302, `https://wa.me/?text=${encodeURIComponent(report.reminder.text)}`);
}));

// ── standing class link: the card's Forward (302 wa.me, the URL only) and Copy (303 back, card open); both logged ──
router.get('/jlink/:token', handle(async (req, res) => {
  const v = authorise(req, res);
  if (!v) return;
  const how = req.query.how === 'copy' ? 'copy' : 'forward';
  const href = await require('../services/quiz/web-quiz-class-link').forwardHref({
    teacherId: v.teacherId, classId: uuidOr(req.query.class), how, reportBase: `${REPORT_PATH}/${encodeURIComponent(req.params.token)}`,
  });
  if (!href) { notFound(req, res, v); return; }
  noStore(res);
  res.redirect(how === 'copy' ? 303 : 302, href);
}));
// "Make a new link" (the confirm card's form): switch off → 404 as before; no valid nonce for this teacher + class
// → 400, a stale one (the card left open past 10 minutes) → 303 back to the confirm card (a fresh nonce); not the
// class's own teacher (the signed report token) → 404. Only the 303 to the class tab changes a row.
router.post('/jnew/:token', handle(async (req, res) => {
  const v = authorise(req, res);
  if (!v) return;
  const body = req.body || {};
  const made = await require('../services/quiz/web-quiz-class-link').renew({
    teacherId: v.teacherId, classId: uuidOr(body.class), n: typeof body.n === 'string' ? body.n : null,
  });
  if (made && made.refused === 'stale_nonce') {
    noStore(res);
    res.redirect(303, `${REPORT_PATH}/${encodeURIComponent(req.params.token)}?tab=class&jconfirm=${encodeURIComponent(uuidOr(body.class))}#class-link`);
    return;
  }
  if (made && made.refused) { page(res, 400, 'error', queryLang(req)); return; }
  if (!made) { notFound(req, res, v); return; }
  noStore(res);
  res.redirect(303, `${REPORT_PATH}/${encodeURIComponent(req.params.token)}?tab=class#class-link`);
}));
// ── end standing class link ──

router.get('/data/:token', handle(async (req, res) => {
  const v = Token.verifyTeacherReport(req.params.token);
  if (!v) {
    const reason = Token.explain(req.params.token) === 'expired' ? 'expired' : 'bad';
    logEvent('teacher_report.denied', { reason, route: 'data' });
    noStore(res);
    res.status(reason === 'expired' ? 410 : 401).json({ error: reason });
    return;
  }
  const b = await build(req, v);
  noStore(res);
  if (!b) { res.status(404).json({ error: 'not_found' }); return; }
  res.status(200).json({ tab: b.tab, lang: b.lang, report: b.report });
}));

/**
 * The quiz a POST is about, when it is this teacher's: a quiz token speaks for its
 * own quiz only, a teacher-wide token for any of the teacher's quizzes.
 */
async function postedQuiz(req, res, v) {
  const asked = uuidOr(req.body && req.body.quiz);
  if (v.quizId && asked && asked !== v.quizId) { notFound(req, res, v); return null; }
  const quizId = v.quizId || asked;
  const report = quizId ? await Data.quizReport(v.teacherId, quizId) : null;
  if (!report || !report.quiz || !report.quiz.code) { notFound(req, res, v); return null; }
  return { quizId, code: report.quiz.code };
}

// Why a save failed, as the notice the page shows (Rule 24d: the copy names the state).
// e=2 the class column is not migrated on this environment (or no identity v2), e=3 the
// hand-out has closed, e=1 anything else ("did not save, try again").
const NOTICE_OF = { not_ready: '2', expired: '3' };
const NOTICES = { 1: 'failed', 2: 'notReady', 3: 'closed' };
/** ?ok=added|moved[&no=<list no.>] — allow-listed; anything else is ignored. */
function okOf(query) {
  if (query.ok !== 'added' && query.ok !== 'moved') return null;
  const no = /^\d{1,4}$/.test(String(query.no || '')) ? Number(query.no) : null;
  return { kind: query.ok, no };
}

/** Back to the report the form was on. */
function back(req, res, out, done = null) {
  noStore(res);
  let q = out.ok ? '' : `?e=${NOTICE_OF[out.reason] || '1'}`;
  // A saved fix says what happened: the kind and the child's list number only —
  // never a name in a URL; the page finds the name in its own rows.
  if (out.ok && done) q = `?ok=${done.kind}${done.no != null ? `&no=${done.no}` : ''}`;
  res.redirect(303, `${REPORT_PATH}/${encodeURIComponent(req.params.token)}${q}`);
}

/** Calls an identity v2 writer on web-quiz.service, which may not be deployed yet. */
async function identityWrite(fnName, args) {
  // eslint-disable-next-line global-require
  const WebQuiz = require('../services/quiz/web-quiz.service');
  if (typeof WebQuiz[fnName] !== 'function') return { ok: false, reason: 'not_ready' };
  try {
    const value = await WebQuiz[fnName](args);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof WebQuiz.WqError) return { ok: false, reason: String((err.body && err.body.error) || err.status) };
    throw err;
  }
}

const text = (v, max) => (typeof v === 'string' && v.length && v.length <= max ? v : null);

router.post('/class/:token', handle(async (req, res) => {
  const v = authorise(req, res);
  if (!v) return;
  const q = await postedQuiz(req, res, v);
  if (!q) return;
  const key = text(req.body.key, 200);
  const out = key ? await identityWrite('whoClass', { code: q.code, tr: req.params.token, key }) : { ok: false, reason: 'bad_request' };
  logEvent('teacher_report.class_bound', { teacherId: v.teacherId, quizId: q.quizId, ok: out.ok, ...(out.ok ? {} : { reason: out.reason }) });
  back(req, res, out);
}));

router.post('/fix/:token', handle(async (req, res) => {
  const v = authorise(req, res);
  if (!v) return;
  const q = await postedQuiz(req, res, v);
  if (!q) return;
  const ref = text(req.body.ref, 64);
  const studentId = text(req.body.studentId, 64);
  const add = req.body.add === '1' || req.body.add === true;
  let out = { ok: false, reason: 'bad_request' };
  if (ref && (add || studentId)) {
    out = await identityWrite('fixWho', add ? { code: q.code, tr: req.params.token, ref, add: true } : { code: q.code, tr: req.params.token, ref, studentId });
  }
  logEvent('teacher_report.fixed', { teacherId: v.teacherId, quizId: q.quizId, how: add ? 'add' : 'student', ok: out.ok, ...(out.ok ? {} : { reason: out.reason }) });
  const row = out.value && out.value.row;
  const no = row && Number.isInteger(Number(row.roll)) && row.roll !== null ? Number(row.roll) : null;
  back(req, res, out, { kind: add ? 'added' : 'moved', no });
}));

// ── Jugnu tab (web_quiz_teacher_jugnu): GET /fwd/:token, POST /queue/:token — 404 while the switch is off ──
Jugnu.attach(router, { authorise, handle, notFound, noStore, languageFor });
// ── end Jugnu tab ──
// ── class round (web_quiz_class_round): the locked round mode; every route is the report's 404 while off ──
router.use('/round', require('./class-round-internal.routes')({ page, noStore, queryLang }));
// ── end class round ──

module.exports = router;
module.exports.BASE_BUDGET_MS = BASE_BUDGET_MS; // the page's base budget (tests shrink it)
