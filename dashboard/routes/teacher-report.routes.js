/**
 * The teacher's web quiz report: the public edge.
 *
 * Mounted at /r — /t is the portal-link login (portal-link.routes.js: training and other portal areas).
 *
 *   GET /r/:token          the report page (HTML), from the bot's /api/internal/tr/page
 *   GET /r/:token/pdf      the same page as a PDF attachment (the bot renders it)
 *   GET /r/:token/remind   the bot logs the tap and answers 302 -> wa.me; passed through
 *   POST /r/:token/class   the page's no-JS "Which class was this for?" form
 *   POST /r/:token/fix     the page's no-JS forms for a typed child not on the list
 *                          (both answered by the bot with a 303 back to the report)
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
const QUERY = {
  lang: (v) => v === 'en' || v === 'ur',
  tab: (v) => v === 'class',
  class: (v) => UUID_RX.test(v),
  quiz: (v) => UUID_RX.test(v),
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
        // Only the reminder redirects, and only ever to WhatsApp's share link.
        if (kind === 'remind' && out.location && /^https:\/\/wa\.me\//.test(out.location)) return res.redirect(302, out.location);
        return fail(502, 'error');
      }
      if (out.status >= 500) return fail(502, 'error');
      const type = out.contentType || 'text/html; charset=utf-8';
      if (kind === 'pdf' && out.status === 200 && /application\/pdf/i.test(type)) {
        const day = new Date(Date.now() + PKT_MS).toISOString().slice(0, 10);
        res.set('Content-Disposition', `attachment; filename="quiz-report-${day}.pdf"`);
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

  router.get(`${REPORT_PATH}/:token`, privateHeaders, limiter, forward('page'));
  router.post(`${REPORT_PATH}/:token/class`, privateHeaders, limiter, form, forwardForm('class'));
  router.post(`${REPORT_PATH}/:token/fix`, privateHeaders, limiter, form, forwardForm('fix'));
  router.get(`${REPORT_PATH}/:token/pdf`, privateHeaders, limiter, forward('pdf'));
  router.get(`${REPORT_PATH}/:token/remind`, privateHeaders, limiter, forward('remind'));
  return router;
}

module.exports = { createTeacherReportRouter };
