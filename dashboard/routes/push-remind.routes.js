'use strict';
/**
 * The child's evening reminder at the edge: web push opted into on the result screen (switch web_quiz_push_remind,
 * decided by the BOT; OFF by default). Routes only, each with its own body parser and limits (routes/edge-mounts.js).
 *
 *   GET  /sw.js                   the reminder worker (dashboard/public/wq/sw.js) while app_settings web_quiz_push_remind
 *                                 is a JSON true (the edge's own 30 s read); while it is off, the KILL-SWITCH worker
 *                                 (sw-off.js: unregisters itself), so a phone that still holds the worker drops it. The
 *                                 one route that answers when off, on a path nothing requested before. no-cache,
 *                                 Service-Worker-Allowed: /.
 *   GET  /remind/:code            the reminder page, both languages (for the Chrome escape from WhatsApp's browser, and
 *                                 any forward). The bot says whether it is on (GET /api/internal/wqpush/state); its 404,
 *                                 no bot, the bot down or a junk code → next(): the portal answers as it does today.
 *                                 No name, no token: the code and the language only.
 *   GET  /api/wqpush/key, POST /api/wqpush/{subscribe,unsubscribe,opened,test,e}
 *                                 forwarded path for path to the bot (/api/internal/wqpush/*), which checks the switch;
 *                                 its 404 → 404 {error:'not_found'}, unreachable → 503. 8 KB bodies; 60/min/ip on
 *                                 subscribe/unsubscribe/opened/e, 5/min per phone on test.
 *
 * Path note: /api/wq/* is answered (404) by the web quiz router mounted before the edge list, hence /api/wqpush/*.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBotClient, bootJson, clientIp } = require('./web-quiz.routes');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');

const KEY = 'web_quiz_push_remind';
const WQ_DIR = path.join(__dirname, '..', 'public', 'wq');
const CODE_RX = /^[A-Za-z0-9]{4,12}$/;   // the child page's own code shape (web-quiz.routes.js CODE_RX)
const UR_FONT = '/wq/fonts/wq-nastaliq-5.woff2';
const POST_OPS = ['subscribe', 'unsubscribe', 'opened', 'test', 'e', 'delivered'];

// The page's first paint, both languages (wq-remind.js draws the card from its own copy table).
// The reminder comes on the next school evening, so on a Friday or Saturday (PKT) the title says Monday (wq-remind.js
// does the same for the card).
const COPY = {
  en: { title: 'Want Jugnu to remind you tomorrow evening?', titleMon: 'Want Jugnu to remind you on Monday evening?', other: 'اردو' },
  ur: { title: 'کیا جگنو کل شام آپ کو یاد دلائے؟', titleMon: 'کیا جگنو پیر کی شام آپ کو یاد دلائے؟', other: 'English' },
};
const onMonday = (now) => [5, 6].includes(new Date(now + 5 * 60 * 60 * 1000).getUTCDay());

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const versions = new Map();
function versionOf(file) {
  if (!versions.has(file)) {
    try { versions.set(file, crypto.createHash('sha256').update(fs.readFileSync(path.join(WQ_DIR, file))).digest('hex').slice(0, 10)); } catch (_) { versions.set(file, '0000000000'); }
  }
  return versions.get(file);
}

// Only what wq.css does not already give this page: the column, Jugnu, and Nastaliq room (line-height 2) for Urdu.
const CSS = `.wqr{padding:24px var(--gutter,16px) 32px;display:grid;gap:12px;align-content:start}
.wqr .wqr-j{margin:0 auto;width:120px;height:120px}.wqr h1{margin:0;font-size:22px;text-align:center}
html[lang=ur] .wqr h1,html[lang=ur] .wqr p{line-height:2}
.wqr .wqr-l{justify-self:center;width:auto;min-height:48px;min-width:48px}`;

/** The reminder page in the child pages' look (wq.css, + the adventure look when the quiz page has it): Jugnu, the
 *  ask in this page's language only, then wq-remind.js boots the card. The other language is one small link. */
function renderRemindPage({ code, lang, test, qa, adv, now = Date.now() }) {
  const l = lang === 'en' ? 'en' : 'ur';
  const o = l === 'en' ? 'ur' : 'en';
  const c = { ...COPY[l], title: onMonday(now) ? COPY[l].titleMon : COPY[l].title };
  // the test-send is for QA only: the switch AND ?qa=1, so a child's walk never sees it
  const boot = { code, lang: l, test: test === true && qa === true };
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ur' ? 'rtl' : 'ltr'}"${adv ? ' class="wq-adv"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="same-origin">
<meta name="theme-color" content="#7CC8E8">
<title>${esc(c.title)}</title>
${l === 'ur' ? `<link rel="preload" href="${UR_FONT}" as="font" type="font/woff2" crossorigin>\n` : ''}<link rel="stylesheet" href="/wq/wq.css?v=${versionOf('wq.css')}">
${adv ? `<link rel="stylesheet" href="/wq/wq-adventure.css?v=${versionOf('wq-adventure.css')}">\n` : ''}<style>${CSS}</style>
</head>
<body>
<main class="wq-app"><section class="wq-screen wqr">
<img class="wqr-j" src="/wq/jugnu/hello.webp" alt="" width="120" height="120">
<h1>${esc(c.title)}</h1>
<div id="wq-remind-root"></div>
<a class="wq-btn wq-ghost wqr-l" href="/remind/${esc(code)}?lang=${o}" lang="${o}" dir="${o === 'ur' ? 'rtl' : 'ltr'}">${esc(c.other)}</a>
</section></main>
<script id="wq-remind-boot" type="application/json">${bootJson(boot)}</script>
<script src="/wq/wq-remind.js?v=${versionOf('wq-remind.js')}" defer></script>
</body>
</html>`;
}

function createPushRemindRouter(opts = {}) {
  // express-rate-limit is required here (as the web quiz router does), so the module loads without the dashboard's deps.
  const rateLimit = require('express-rate-limit');
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  // a failed read keeps the last answer (OFF there serves the self-unregistering worker); no read landed yet → 503 below
  const on = opts.on || createBrotliFlag({ key: KEY, keepOnError: () => true, ...(opts.flagDb ? { db: opts.flagDb } : {}), ...(opts.flagNow ? { now: opts.flagNow } : {}) });
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, ...(opts.logEvent ? { logEvent: opts.logEvent } : {}) });
  const logEvent = opts.logEvent || ((e, p) => { try { require('../services/telemetry.service').logEvent(e, p); } catch (_) { /* never decides a response */ } });
  const router = express.Router();
  const phoneLang = (req) => (/^\s*en\b/i.test(String(req.get('accept-language') || '')) ? 'en' : 'ur');

  // The edge's switch answers its last value while a read is out, and OFF before its first read lands: a cold process
  // would hand a child the kill-switch worker. So the first answer waits for the first read (one read per process).
  let primed = false;
  let swLoggedAt = -Infinity;
  router.get('/sw.js', async (req, res, next) => {
    if (!primed && typeof on.ready === 'function') {
      on();
      try { await on.ready(); } catch (_) { /* answers what the switch says */ }
      primed = true;
    }
    const live = on();
    const st = typeof on.state === 'function' ? on.state() : 'fresh';
    // an answer from a failed read is counted (at most one line a minute per process), so the path shows in the logs;
    // its props ride inside data_json, never as new top-level log fields
    if (st !== 'fresh' && Date.now() - swLoggedAt >= 60000) { swLoggedAt = Date.now(); logEvent('web_quiz.push_sw_switch', { data_json: JSON.stringify({ state: st, served: !live && st === 'unread' ? '503' : live ? 'sw' : 'off' }) }); }
    // no read has landed (the first one failed): not an off. 503 leaves the browser's current worker in place
    if (!live && st === 'unread') return res.status(503).set('Cache-Control', 'no-store').type('application/javascript').send('');
    const file = live ? 'sw.js' : 'sw-off.js';
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    return res.sendFile(path.join(WQ_DIR, file), { dotfiles: 'allow', headers: { 'Cache-Control': 'no-cache' }, cacheControl: false, lastModified: false }, (err) => { if (err && !res.headersSent) next(); });
  });

  router.get('/remind/:code', async (req, res, next) => {
    const code = String(req.params.code || '');
    if (!CODE_RX.test(code) || !botUrl || !apiKey) return next();
    let out;
    try {
      out = await callBot('GET', '/api/internal/wqpush/state', req, null, { route: '/api/internal/wqpush/state' });
    } catch (_) {
      return next();
    }
    if (out.status !== 200) return next();
    const lang = req.query.lang === 'en' || req.query.lang === 'ur' ? req.query.lang : phoneLang(req);
    res.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
    return res.status(200).type('html').send(renderRemindPage({ code, lang, test: Boolean(out.body && out.body.test === true), qa: req.query.qa === '1', adv: Boolean(out.body && out.body.adv === true) }));
  });

  const relay = (op) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!botUrl || !apiKey) return res.status(404).json({ error: 'not_found' });
    let out;
    try {
      // the key's ask depends on the quiz (the canary): its code rides along, only in the page's own code shape
      const q = op === 'key' && CODE_RX.test(String(req.query.code || '')) ? `?code=${req.query.code}` : '';
      out = await callBot(req.method, `/api/internal/wqpush/${op}${q}`, req, req.method === 'GET' ? null : (req.body || {}), { route: `/api/internal/wqpush/${op}` });
    } catch (_) {
      return res.status(503).json({ error: 'unavailable' });
    }
    // a real off reaches the page as {off:true} (its cue to drop the worker); any other 404 is not an off
    if (out.status === 404) return res.status(404).json(out.body && out.body.off === true ? { off: true } : { error: 'not_found' });
    return res.status(out.status).json(out.body || {});
  };

  const common = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).json({ error: 'slow_down' }) };
  const dv = (req) => { const m = /(?:^|;\s*)wq_dv=([^;]{1,200})/.exec(String(req.get('cookie') || '')); return m ? m[1] : null; };
  const perIp = rateLimit({ ...common, max: 60, keyGenerator: (req) => `ip:${clientIp(req)}` });
  const perPhone = rateLimit({ ...common, max: 5, keyGenerator: (req) => (dv(req) ? `dv:${dv(req)}` : `ip:${clientIp(req)}`) });
  const json = express.json({ limit: '8kb' });

  router.get('/api/wqpush/key', perIp, relay('key'));
  for (const op of POST_OPS) router.post(`/api/wqpush/${op}`, json, op === 'test' ? perPhone : perIp, relay(op));

  return router;
}

module.exports = { createPushRemindRouter, renderRemindPage, COPY, CODE_RX, KEY };
