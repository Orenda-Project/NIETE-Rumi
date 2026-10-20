'use strict';
/**
 * The big flight at the edge: the reading and number battery as a game in the child's games door (switch
 * sa_game,
 * decided by the BOT; OFF by default).
 *
 *   GET /sa-game/:token?kid&lang   the game page. The bot checks the hub token, the chip and this phone (the games door's
 *                                  own check) and names the language and the grade's form (GET /api/internal/sagame/page);
 *                                  the edge draws the shell. Switch off (the bot's 404), a malformed token or no bot
 *                                  configured → next(): the portal answers exactly as it does today. Not this child's
 *                                  phone, or a grade outside 1–5 → a one-line note, never a 500.
 *   GET /sa-game/a/:file           the page's own files (dashboard/sa-game/: game.js, game.css), an allow-list, served
 *                                  only while app_settings sa_game is a JSON true (the edge's 30 s read); else next().
 *   POST /api/sa-game/s/:op, POST /api/sa-game/s/audio/:op, GET /api/sa-game/s/status   the game's sink, forwarded
 *                                  path for path to the bot (/api/internal/sagame/s/*), which checks the switch, the
 *                                  run's token and the child; the bot's answer is passed back as it came (JSON).
 *   GET /sa-game/b/:form/:lang     the form's battery file as the engine reads it (bot/shared/data/child-test/sa/
 *                                  sa.<form>.<lang>.json, else <form>.json: the item set's own build), same switch; a
 *                                  form of the wrong shape or no file → next().
 *
 * The engine itself (/sa/*, switch sa_engine) is loaded from its own router. The page carries no name, no phone and no
 * id: the hub token and chip it was opened with are the only things it holds.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBotClient, bootJson } = require('./web-quiz.routes');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');
const { steady } = require('./sa-switch');

const KEY = 'sa_game';
const DIR = path.join(__dirname, '..', 'sa-game');
const WQ_DIR = path.join(__dirname, '..', 'public', 'wq');
const BANK_DIR = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const FILES = Object.freeze({ 'game.js': 'application/javascript; charset=utf-8', 'game.css': 'text/css; charset=utf-8' });
const TOKEN_RX = /^[A-Za-z0-9_-]{8,1000}\.[A-Za-z0-9_-]{16,64}$/;
const CHIP_RX = /^[0-9a-f]{16}$/;
const FORM_RX = /^game\.G(1|23|45)$/;
// The engine's files the map needs (dashboard/sa/, sa-engine.routes.js): its phone store, read for a run's card when the
// child comes back. The run itself is the child's page, /sa/play.html. A missing one is skipped by the page.
const ENGINE = ['sa-store.js'];
const UR_FONT = '/wq/fonts/wq-nastaliq-5.woff2';

const COPY = {
  en: { title: "Jugnu's big flight", boot: 'Getting the islands ready…', other: 'Open the big flight from your games, on the phone you play on.', not_eligible: 'The big flight is for classes 1 to 5.', error: "That didn't work. Try again in a moment." },
  ur: { title: 'جگنو کی بڑی اڑان', boot: 'جزیرے تیار ہو رہے ہیں…', other: 'بڑی اڑان اپنے کھیلوں میں سے کھولیں، اُسی فون پر جس پر آپ کھیلتے ہیں۔', not_eligible: 'بڑی اڑان جماعت ۱ سے ۵ کے لیے ہے۔', error: 'یہ نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔' },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const versions = new Map();
function versionOf(file, dir = DIR) {
  const k = path.join(dir, file);
  if (!versions.has(k)) {
    try { versions.set(k, crypto.createHash('sha256').update(fs.readFileSync(k)).digest('hex').slice(0, 10)); } catch (_) { versions.set(k, '0'); }
  }
  return versions.get(k);
}

// The first paint: Jugnu and one line, before any script (≤ 1 KB). The rest of the look is game.css.
const CSS = `@font-face{font-family:"WQ Nastaliq";src:url(${UR_FONT}) format("woff2");font-display:swap;size-adjust:155%;unicode-range:U+0600-06FF,U+00A0,U+200C-200F,U+0020,U+0021}
*{box-sizing:border-box}html,body{margin:0;background:#BFE6F5;color:#2A2D3A;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
html[lang=ur] body{font-family:"WQ Nastaliq","Noto Nastaliq Urdu",system-ui,sans-serif;line-height:1.9;word-spacing:.2em}
.sg-boot{min-height:100vh;display:grid;place-items:center;align-content:center;text-align:center;padding:16px}.sg-boot p{font-weight:800;color:#333748;margin:8px 0 0}`;

function shell({ l, title, body, head = '' }) {
  return `<!doctype html>
<html lang="${l}" dir="${l === 'ur' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="same-origin">
<meta name="theme-color" content="#7CC8E8">
<title>${esc(title)}</title>
${l === 'ur' ? `<link rel="preload" href="${UR_FONT}" as="font" type="font/woff2" crossorigin>\n` : ''}<style>${CSS}</style>
${head}</head>
${body}
</html>`;
}

/** The game page: the boot line, then game.css + game.js; the engine's files after them (deferred, in order). */
function renderGamePage({ token, kid, lang, form, grade }) {
  const l = lang === 'en' ? 'en' : 'ur';
  const c = COPY[l];
  const boot = { token, kid, lang: l, form, grade: grade || null, bank: [`/sa/batteries/sa.${form}.${l}.json`, `/sa-game/b/${form}/${l}`], engine: ENGINE.map((f) => `/sa/${f}`),
    // the sound + motion kit every child screen uses (WQJ), at the child pages' own long-cached URLs
    juice: { js: `/wq/wq-juice.js?v=${versionOf('wq-juice.js', WQ_DIR)}`, css: `/wq/wq-juice.css?v=${versionOf('wq-juice.css', WQ_DIR)}` } };
  const head = `<link rel="stylesheet" href="/sa-game/a/game.css?v=${versionOf('game.css')}">\n<link rel="preload" href="/wq/jugnu/hello.webp" as="image">\n`;
  return shell({ l, title: c.title, head, body: `<body>
<main id="sg" class="sg-app"><div class="sg-boot"><img src="/wq/jugnu/hello.webp" alt="" width="120" height="120"><p>${esc(c.boot)}</p></div></main>
<script id="boot" type="application/json">${bootJson(boot)}</script>
<script src="/sa-game/a/game.js?v=${versionOf('game.js')}" defer></script>
</body>` });
}

function renderNote({ lang, kind }) {
  const l = lang === 'en' ? 'en' : 'ur';
  const c = COPY[l];
  return shell({ l, title: c.title, body: `<body>
<main class="sg-boot"><img src="/wq/jugnu/sleep.webp" alt="" width="120" height="120"><p>${esc(kind === 'other' ? c.other : kind === 'not_eligible' ? c.not_eligible : c.error)}</p></main>
</body>` });
}

function createSaGameRouter(opts = {}) {
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  // The page's own files and the form's battery read the switch steadily (routes/sa-switch.js): a cold or failed read
  // must never answer the portal's page for game.js (the map hung on it).
  const on = steady(opts.on || createBrotliFlag({ key: KEY }), { ...(opts.holdMs != null ? { holdMs: opts.holdMs } : {}), ...(opts.now ? { now: opts.now } : {}) });
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl, ...(opts.logEvent ? { logEvent: opts.logEvent } : {}) });
  const router = express.Router();
  const phoneLang = (req) => (/^\s*en\b/i.test(String(req.get('accept-language') || '')) ? 'en' : 'ur');
  const noStore = (res) => res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });

  router.get('/sa-game/:token', async (req, res, next) => {
    const token = String(req.params.token || '');
    const kid = String(req.query.kid || '');
    if (!TOKEN_RX.test(token) || !CHIP_RX.test(kid) || !botUrl || !apiKey) return next();
    const want = req.query.lang === 'en' || req.query.lang === 'ur' ? req.query.lang : null;
    let out;
    try {
      out = await callBot('GET', `/api/internal/sagame/page/${token}?kid=${kid}${want ? `&lang=${want}` : ''}`, req, null, { route: '/api/internal/sagame/page/:token' });
    } catch (_) {
      return next();
    }
    if (out.status === 404) return next();
    noStore(res);
    if (out.status === 401) return res.status(403).type('html').send(renderNote({ lang: want || phoneLang(req), kind: 'other' }));
    // a grade outside 1–5 or unknown (the bot's not_eligible): the note in the child's language, never a guessed form
    if (out.status === 403 && out.body && out.body.error === 'not_eligible') return res.status(403).type('html').send(renderNote({ lang: want || out.body.lang || phoneLang(req), kind: 'not_eligible' }));
    const b = out.body || {};
    if (out.status !== 200 || !b.ok || !FORM_RX.test(String(b.form || ''))) return res.status(502).type('html').send(renderNote({ lang: want || phoneLang(req), kind: 'error' }));
    return res.status(200).type('html').send(renderGamePage({ token, kid, lang: b.lang, form: b.form, grade: b.grade }));
  });

  router.use(['/sa-game/a', '/sa-game/b'], on.warm());
  router.get('/sa-game/a/:file', (req, res, next) => {
    const type = Object.prototype.hasOwnProperty.call(FILES, req.params.file) ? FILES[req.params.file] : null;
    if (!type || !on()) return next();
    res.set({ 'Content-Type': type, 'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache' });
    return res.sendFile(path.join(DIR, req.params.file), { dotfiles: 'allow' }, (err) => { if (err && !res.headersSent) next(); });
  });

  const SINK_OPS = /^(session|batch|audio\/presign|audio\/register|status)$/;
  const sink = async (req, res, next) => {
    const op = req.params.op ? (req.params.audio ? `audio/${req.params.op}` : req.params.op) : 'status';
    if (!SINK_OPS.test(op) || !botUrl || !apiKey) return next();
    const qs = req.method === 'GET' && typeof req.query.st === 'string' ? `?st=${encodeURIComponent(req.query.st)}` : '';
    let out;
    try {
      out = await callBot(req.method, `/api/internal/sagame/s/${op}${qs}`, req, req.method === 'GET' ? null : req.body, { route: `/api/internal/sagame/s/${op}` });
    } catch (_) {
      return res.status(503).json({ error: 'unavailable' });
    }
    if (out.status === 404 && out.body && out.body.off) return next();
    res.set('Cache-Control', 'no-store');
    return res.status(out.status).json(out.body || {});
  };
  const json = express.json({ limit: '512kb' });
  router.post('/api/sa-game/s/:op', json, sink);
  router.post('/api/sa-game/s/:audio(audio)/:op', json, sink);
  router.get('/api/sa-game/s/status', sink);

  router.get('/sa-game/b/:form/:lang', (req, res, next) => {
    const { form, lang } = req.params;
    if (!FORM_RX.test(form) || (lang !== 'en' && lang !== 'ur') || !on()) return next();
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    // today's per-language file, else the item set's per-form file (both languages in one) as its next build names it
    const dir = opts.bankDir || BANK_DIR;
    const file = [`sa.${form}.${lang}.json`, `${form}.json`].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!file) return next();
    return res.sendFile(file, { dotfiles: 'allow' }, (err) => { if (err && !res.headersSent) next(); });
  });

  return router;
}

module.exports = { createSaGameRouter, renderGamePage, renderNote, COPY, ENGINE, TOKEN_RX, CHIP_RX, FORM_RX, KEY };
