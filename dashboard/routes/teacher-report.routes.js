/**
 * The teacher's web quiz report: the public edge.
 *
 * Mounted at /r — /t is the portal-link login (portal-link.routes.js: training and other portal areas).
 *
 *   GET /r/:token          the report page (HTML), from the bot's /api/internal/tr/page
 *   GET /r/:token/pdf      the same page as a PDF attachment (the bot renders it)
 *   GET /r/:token/remind   the bot logs the tap and answers 302 -> wa.me; passed through
 *   GET /r/:token/jlink    the class link card: Forward → 302 wa.me (the link only); Copy → 303 back to the report
 *   POST /r/:token/jnew    the class link card's confirm "Make a new link" {class, n} (303 back to the report; the bot's 400 without n)
 *   POST /r/:token/class   the page's no-JS "Which class was this for?" form
 *   POST /r/:token/fix     the page's no-JS forms for a typed child not on the list
 *   GET /r/:token/fwd      the Jugnu tab's "Forward to the class group": the bot's 302 -> wa.me
 *   POST /r/:token/queue   the Jugnu tab's no-JS confirm-queue forms
 *   POST /r/:token/unbind  the Jugnu tab's "Saved on WhatsApp ✓ · Undo" form
 *   GET /r/:token/wfwd     the class week card's forward: the bot's 302 -> wa.me
 *                          (both answered by the bot with a 303 back to the report)
 *   GET  /r/:token/round   the class round's locked mode (web_quiz_class_round; the bot's 404 while off)
 *   POST /r/:token/round/{start,absent,declined,pause,resume,next,teacher,not-this-term}  its no-JS forms (303 back to /r/ only)
 *
 * Like /q/:code, the edge never touches the database: it checks the token's shape,
 * forwards only the query keys the bot reads, and calls the bot with the internal key
 * through the child quiz's own bot client (web-quiz.routes createBotClient). The page
 * carries children's names, so every answer is private, never stored and never indexed.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');
const { renderMessagePage, REPORT_PATH } = require('../../bot/shared/templates/teacher-report.page');

// base64url(payload) "." base64url(HMAC)[:22] — web-quiz-token's format.
const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PKT_MS = 5 * 3600 * 1000;
// The phone's device ref cookie (the one hub.js writes): the round page gives a phone without one its own.
const DEVICE_COOKIE_RX = /(?:^|;\s*)wq_dv=[A-Za-z0-9_-]{22}(?:;|$)/;
const newDeviceRef = () => require('crypto').randomBytes(16).toString('base64url').slice(0, 22);
const QUERY = {
  lang: (v) => v === 'en' || v === 'ur',
  // 'jugnu' is admitted always; the bot ignores it while web_quiz_teacher_jugnu is off (its golden: the page is byte-identical).
  tab: (v) => v === 'class' || v === 'jugnu',
  class: (v) => UUID_RX.test(v),
  quiz: (v) => UUID_RX.test(v),
  // The report's own notices after a POST (the bot's 303 adds them): a failure code,
  // or what a saved fix did and the child's list number. Dropping them here hid both.
  e: (v) => /^[123]$/.test(v),
  ok: (v) => v === 'added' || v === 'moved',
  no: (v) => /^\d{1,4}$/.test(v),
  // The class link card (web_quiz_class_link): Forward or Copy, and the class whose link Copy opens.
  how: (v) => v === 'forward' || v === 'copy',
  cl_open: (v) => UUID_RX.test(v),
  // Its "Make a new link" asks first: the class whose card shows the confirm (the bot signs the nonce).
  jconfirm: (v) => UUID_RX.test(v),
};

function forwardQuery(q) {
  const out = Object.keys(QUERY)
    .filter((k) => typeof q[k] === 'string' && QUERY[k](q[k]))
    .map((k) => `${k}=${encodeURIComponent(q[k])}`);
  return out.length ? `?${out.join('&')}` : '';
}

// The fields each form may carry, and their shape; anything else is dropped.
const FORM = {
  class: { quiz: (v) => UUID_RX.test(v), key: (v) => v.length > 0 && v.length <= 200 },
  fix: { quiz: (v) => UUID_RX.test(v), ref: (v) => v.length > 0 && v.length <= 64, add: (v) => v === '1', studentId: (v) => v.length > 0 && v.length <= 64 },
  // The Jugnu tab's confirm queue (one tap: Same child / Different / Not sure / Undo, or link the class's codes).
  queue: { loose_id: (v) => UUID_RX.test(v), candidate_id: (v) => UUID_RX.test(v), decision: (v) => ['same', 'no', 'unsure', 'undo', 'link'].includes(v), class: (v) => UUID_RX.test(v) },
  // "Saved on WhatsApp ✓ · Undo": one binding of a child on the teacher's list (the bot checks it is theirs).
  unbind: { binding: (v) => UUID_RX.test(v), class: (v) => UUID_RX.test(v) },
  // The class link card's confirm "Make a new link" (web_quiz_class_link): the class whose link is renewed, and the
  // confirm card's signed nonce (web-quiz-token's format; the bot verifies it and answers 400 without it).
  jnew: { class: (v) => UUID_RX.test(v), n: (v) => TOKEN_RX.test(v) },
};
function formBody(kind, body) {
  const out = {};
  Object.entries(FORM[kind]).forEach(([k, ok]) => {
    const v = body && body[k];
    if (typeof v === 'string' && ok(v)) out[k] = v;
  });
  return out;
}

function createTeacherReportRouter(opts = {}) {
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl });
  const router = express.Router();

  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, validate: false,
    keyGenerator: (req) => `tr:${clientIp(req)}`,
    handler: (req, res) => res.status(429).type('html').send(renderMessagePage({ kind: 'error' })),
  });
  const privateHeaders = (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    next();
  };

  function forward(kind) {
    return async (req, res) => {
      const t0 = Date.now();
      const lang = req.query.lang === 'ur' || req.query.lang === 'en' ? req.query.lang : null;
      const fail = (status, k) => res.status(status).type('html').send(renderMessagePage({ kind: k, lang }));
      const token = String(req.params.token || '');
      if (!TOKEN_RX.test(token)) return fail(404, 'incomplete');
      if (!botUrl || !apiKey) return fail(503, 'error');
      let out;
      try {
        out = await callBot('GET', `/api/internal/tr/${kind}/${token}${forwardQuery(req.query)}`, req, null, { raw: true });
      } catch (_) {
        return fail(502, 'error');
      }
      if (out.status >= 300 && out.status < 400) {
        // Only the reminder, the Jugnu forwards (story, class week) and the class link card redirect, and only ever to WhatsApp's share link.
        if ((kind === 'remind' || kind === 'fwd' || kind === 'wfwd' || kind === 'jlink') && out.location && /^https:\/\/wa\.me\//.test(out.location)) return res.redirect(302, out.location);
        // The class link card's Copy comes back to the report itself (card open).
        if (kind === 'jlink' && out.status === 303 && out.location && out.location.startsWith(`${REPORT_PATH}/`)) return res.redirect(303, out.location);
        return fail(502, 'error');
      }
      if (out.status >= 500) return fail(502, 'error');
      const type = out.contentType || 'text/html; charset=utf-8';
      if (kind === 'pdf' && out.status === 200 && /application\/pdf/i.test(type)) {
        const day = new Date(Date.now() + PKT_MS).toISOString().slice(0, 10);
        res.set('Content-Disposition', `attachment; filename="quiz-report-${day}.pdf"`);
      }
      // The report page's timing, when the bot sent it (events v2 on): its own numbers back, and the edge's whole time.
      if (kind === 'page' && out.status === 200 && out.timing) {
        if (out.timing.render != null) res.set('x-render-ms', out.timing.render);
        if (out.timing.queue != null) res.set('x-queue-age', out.timing.queue);
        res.set('x-edge-ms', String(Date.now() - t0));
      }
      return res.status(out.status).type(type).send(out.bytes || Buffer.alloc(0));
    };
  }

  const form = express.urlencoded({ extended: false, limit: '2kb' });
  function forwardForm(kind) {
    return async (req, res) => {
      const fail = (status, k) => res.status(status).type('html').send(renderMessagePage({ kind: k }));
      const token = String(req.params.token || '');
      if (!TOKEN_RX.test(token)) return fail(404, 'incomplete');
      if (!botUrl || !apiKey) return fail(503, 'error');
      let out;
      try {
        out = await callBot('POST', `/api/internal/tr/${kind}/${token}`, req, formBody(kind, req.body), { raw: true });
      } catch (_) {
        return fail(502, 'error');
      }
      // The bot answers 303 back to the report; nothing else is followed.
      if (out.status === 303 && out.location && out.location.startsWith(`${REPORT_PATH}/`)) return res.redirect(303, out.location);
      if (out.status >= 300 && out.status < 400) return fail(502, 'error');
      if (out.status >= 500) return fail(502, 'error');
      return res.status(out.status).type(out.contentType || 'text/html; charset=utf-8').send(out.bytes || Buffer.alloc(0));
    };
  }

  // ── class round: GET the round screen, POST its no-JS forms (pos, or the long-press's act/hold); 303s back to /r/ only ──
  async function forwardRound(req, res, act = null) {
    const lang = req.query.lang === 'ur' || req.query.lang === 'en' ? req.query.lang : null;
    const fail = (status, k) => res.status(status).type('html').send(renderMessagePage({ kind: k, lang }));
    const token = String(req.params.token || '');
    if (!TOKEN_RX.test(token)) return fail(404, 'incomplete');
    if (!botUrl || !apiKey) return fail(503, 'error');
    const isPost = !!act;
    const body = {};
    if (isPost) {
      const b = req.body || {};
      if (typeof b.pos === 'string' && /^\d{1,3}$/.test(b.pos)) body.pos = b.pos;
      if (b.act === 'hold') body.act = 'hold';
      if (typeof b.hold === 'string' && /^\d{1,6}$/.test(b.hold)) body.hold = b.hold;
    }
    const path = `/api/internal/tr/round/${token}${isPost ? `/${act}` : ''}${lang ? `?lang=${lang}` : ''}`;
    // A child's hand-back answers only the phone this page was opened on, so the page must know the phone: one with
    // no wq_dv gets one now, sent to the bot on this same call and set on the answer when the round page renders.
    const minted = !isPost && !DEVICE_COOKIE_RX.test(String(req.get('cookie') || '')) ? newDeviceRef() : null;
    let out;
    try {
      out = await callBot(isPost ? 'POST' : 'GET', path, req, isPost ? body : null, { raw: true, device: minted });
    } catch (_) {
      return fail(502, 'error');
    }
    if (minted && out.status === 200) {
      const secure = req.secure || req.get('x-forwarded-proto') === 'https';
      res.append('Set-Cookie', `wq_dv=${minted}; Path=/; Max-Age=2592000; SameSite=Lax${secure ? '; Secure' : ''}`);
    }
    if (out.status === 303 && out.location && out.location.startsWith(`${REPORT_PATH}/`)) return res.redirect(303, out.location);
    if (out.status >= 300 && out.status < 400) return fail(502, 'error');
    if (out.status >= 500) return fail(502, 'error');
    return res.status(out.status).type(out.contentType || 'text/html; charset=utf-8').send(out.bytes || Buffer.alloc(0));
  }

  router.get(`${REPORT_PATH}/:token`, privateHeaders, limiter, forward('page'));
  router.post(`${REPORT_PATH}/:token/class`, privateHeaders, limiter, form, forwardForm('class'));
  router.post(`${REPORT_PATH}/:token/fix`, privateHeaders, limiter, form, forwardForm('fix'));
  router.get(`${REPORT_PATH}/:token/pdf`, privateHeaders, limiter, forward('pdf'));
  router.get(`${REPORT_PATH}/:token/remind`, privateHeaders, limiter, forward('remind'));
  // The Jugnu tab (bot switch web_quiz_teacher_jugnu; the bot answers 404 while it is off).
  router.get(`${REPORT_PATH}/:token/fwd`, privateHeaders, limiter, forward('fwd'));
  router.post(`${REPORT_PATH}/:token/queue`, privateHeaders, limiter, form, forwardForm('queue'));
  router.post(`${REPORT_PATH}/:token/unbind`, privateHeaders, limiter, form, forwardForm('unbind'));
  // The class week card's forward (bot switch web_quiz_class_week; the bot answers 404 while it is off).
  router.get(`${REPORT_PATH}/:token/wfwd`, privateHeaders, limiter, forward('wfwd'));
  // The standing class link card's Forward (web_quiz_class_link): the bot logs it and answers 302 -> wa.me.
  router.get(`${REPORT_PATH}/:token/jlink`, privateHeaders, limiter, forward('jlink'));
  // Its "Make a new link" form: the bot revokes the old link, mints a new one and answers 303 back to the class tab.
  router.post(`${REPORT_PATH}/:token/jnew`, privateHeaders, limiter, form, forwardForm('jnew'));
  // ── class round (web_quiz_class_round): the locked round mode; the bot answers its own 404 while off ──
  router.get(`${REPORT_PATH}/:token/round`, privateHeaders, limiter, (req, res) => forwardRound(req, res, null));
  ['start', 'absent', 'declined', 'pause', 'resume', 'next', 'teacher', 'not-this-term'].forEach((act) => {
    router.post(`${REPORT_PATH}/:token/round/${act}`, privateHeaders, limiter, form, (req, res) => forwardRound(req, res, act));
  });
  // ── end class round ──
  return router;
}

module.exports = { createTeacherReportRouter };
