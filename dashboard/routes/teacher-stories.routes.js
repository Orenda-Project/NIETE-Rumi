/**
 * A teacher sends a storybook to the class: the public edge. It forwards path for path to the bot's /api/internal/ts/*
 * and the bot decides (app_settings web_quiz_stories_teacher, default off, together with the child's stories and hub).
 * The edge reads the same switch itself (at most every 30 s, any failure = off) only to cost nothing while it is off:
 * then it never asks the bot and answers exactly what the bot's off answers (404 stories_off; the page falls through).
 *
 *   GET  /api/teacher/stories?th=&grade=&lang=[&all=1]    the story shelf (≤ 4 books; all of them with all=1)
 *   GET  /api/teacher/story/preview?th=&story_id=          the send made ready: the book, the exact class message
 *   POST /api/teacher/story/share {th, story_id, class?}   {code, link, class_message}
 *   POST /api/teacher/story/send {th, story_id}            the teacher's tap (the page's form): the bot's 302 → wa.me
 *   GET  /quiz/teacher/:th/stories[?grade=&lang=&book=]    the Stories page, rendered by the bot; with the switch off (the
 *                                                          bot's 404) the request goes on to whatever answers it today
 *
 * Switch app_settings quiz_teacher_stories_bot_gate (JSON true only; absent, any other value or a failed read = off),
 * read in the same one read as web_quiz_stories_teacher. On: the edge no longer decides from its own reading, it always
 * forwards and the bot's answer is the gate. The API passes the bot's status on unchanged; the page, on the bot's
 * 404 stories_off, gets the teacher home's one-line page with the Stories page's own line (storySendNotOpen) instead
 * of falling through. Off: exactly today.
 *
 * `th` is the teacher-home token. Like /q/:code and /r/:token, the edge checks shapes, forwards only the
 * keys the bot reads and calls the bot with the internal key through the child quiz's bot client.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');
const { buildMessagePage } = require('../../bot/shared/services/first-touch/maker.page');
const { str } = require('../../bot/shared/services/first-touch/teacher-home.strings');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { carryBotSecurity, edgeSecurityOn } = require('./edge-security-headers');

const TOKEN_RX = /^[A-Za-z0-9_-]{8,900}\.[A-Za-z0-9_-]{22}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY = {
  th: (v) => TOKEN_RX.test(v),
  grade: (v) => /^[1-5]$/.test(v),
  lang: (v) => v === 'en' || v === 'ur',
  all: (v) => v === '1',
  story_id: (v) => UUID_RX.test(v),
  class: (v) => UUID_RX.test(v),
  book: (v) => UUID_RX.test(v),
};
const ORDER = ['th', 'grade', 'lang', 'all', 'story_id', 'class', 'book'];
const FLAG_KEY = 'web_quiz_stories_teacher';
const GATE_KEY = 'quiz_teacher_stories_bot_gate';
const FLAG_TTL_MS = 30000;

/** The portal's flag rule (feature-flags.isFlagEnabled) applied to a row already read: a client that serves only it. */
function teacherValue(row) {
  const one = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row || null, error: null }) }) }) }) };
  return require('../lib/feature-flags').isFlagEnabled(one, FLAG_KEY);
}

/**
 * Both switches in ONE app_settings read (`.in('key', [...])`) through the portal's own client, remembered 30 s:
 * { teacher, gate }. teacher = web_quiz_stories_teacher by the portal's flag rule (as today); gate = JSON true only.
 * A failed shared read re-reads the teacher key alone, exactly as today, and the switch is off; no client = both off.
 */
function storiesFlagsReader({ now = Date.now, db = () => require('../config/supabase') } = {}) {
  let at = -Infinity;
  let val = { teacher: false, gate: false };
  return async () => {
    if (now() - at < FLAG_TTL_MS) return val;
    let supabase = null;
    try { supabase = db(); } catch (_) { supabase = null; }
    if (!supabase) {
      val = { teacher: false, gate: false };
    } else {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY, GATE_KEY]);
        if (error || !Array.isArray(data)) throw new Error('app_settings read failed');
        const rows = (k) => data.filter((r) => r && r.key === k);
        if (rows(FLAG_KEY).length > 1 || rows(GATE_KEY).length > 1) throw new Error('app_settings key twice');
        const gate = rows(GATE_KEY)[0];
        val = { teacher: (await teacherValue(rows(FLAG_KEY)[0])) === true, gate: Boolean(gate) && gate.value === true };
      } catch (_) {
        let teacher = false;
        try { teacher = (await require('../lib/feature-flags').isFlagEnabled(supabase, FLAG_KEY)) === true; } catch (e) { teacher = false; }
        val = { teacher, gate: false };
      }
    }
    at = now();
    return val;
  };
}

/** web_quiz_stories_teacher alone, as the edge decides with the gate off (the same shared read). */
function teacherFlagReader(o = {}) {
  const read = storiesFlagsReader(o);
  return async () => (await read()).teacher;
}

/** The request's language for an edge-made page: ?lang, else the phone's Accept-Language, else English. */
function langOf(req) {
  const asked = req.query && req.query.lang;
  if (asked === 'en' || asked === 'ur') return asked;
  return /^\s*ur\b/i.test(String(req.get('accept-language') || '')) ? 'ur' : 'en';
}

/** The bot's own off answer: 404 {error:'stories_off'} (a raw answer: bytes). */
function isStoriesOff(out) {
  if (!out || out.status !== 404) return false;
  try { return JSON.parse(Buffer.from(out.bytes || '').toString('utf8')).error === 'stories_off'; } catch (_) { return false; }
}

/**
 * Stories not open: the teacher home's one-line page (status 200, its headers) with the Stories page's own reviewed
 * line (storySendNotOpen), never "expired", and one tap back to the chat when the number is known.
 */
function notOpenPage(req, res) {
  const lang = langOf(req);
  const digits = String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
  const tap = /^\d{10,15}$/.test(digits) ? { href: `https://wa.me/${digits}?text=quiz`, text: str('th.open.wa', lang) } : null;
  const built = buildMessagePage({ lang, id: 'mk.stale', tap, say: UX_STRINGS.storySendNotOpen[lang] });
  res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': built.csp });
  return res.status(200).type('html').send(built.html);
}

/** Only the keys the bot reads, in one order, each checked. */
function forwardQuery(q = {}, keys = ORDER) {
  const out = keys.filter((k) => typeof q[k] === 'string' && QUERY[k](q[k])).map((k) => `${k}=${encodeURIComponent(q[k])}`);
  return out.length ? `?${out.join('&')}` : '';
}

function createTeacherStoriesRouter(opts = {}) {
  const botUrl = String(opts.botUrl != null ? opts.botUrl : (process.env.MAIN_BOT_URL || '')).replace(/\/$/, '');
  const apiKey = opts.apiKey != null ? opts.apiKey : (process.env.INTERNAL_API_KEY || '');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const callBot = createBotClient({ botUrl, apiKey, fetchImpl });
  // opts.flags (tests): → {teacher, gate}; opts.teacherOn (tests): the teacher key alone, the gate off.
  const flags = opts.flags || (opts.teacherOn ? async () => ({ teacher: await opts.teacherOn(), gate: false }) : storiesFlagsReader({ now: opts.now, db: opts.db }));
  const flagsNow = async () => {
    try { const f = await flags(); return { teacher: Boolean(f) && f.teacher === true, gate: Boolean(f) && f.gate === true }; } catch (_) { return { teacher: false, gate: false }; }
  };
  // Gate on: always forward (the bot decides). Gate off: the edge's own reading, as today.
  const isOn = async () => { const f = await flagsNow(); return f.gate || f.teacher; };
  const router = express.Router();
  // quiz_edge_security_headers: the bot's own security headers on a relayed answer (edge-security-headers.js; OFF = today)
  const securityOn = typeof opts.securityOn === 'function' ? opts.securityOn : edgeSecurityOn;
  const common = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).json({ error: 'slow_down' }) };
  const read = rateLimit({ ...common, max: 120, keyGenerator: (req) => `ts:${clientIp(req)}` });
  const write = rateLimit({ ...common, max: 30, keyGenerator: (req) => `tsw:${clientIp(req)}` });
  const ready = (req, res, next) => (botUrl && apiKey ? next() : res.status(503).json({ error: 'stories_off' }));
  // Off: the bot's own off answer, without asking the bot and before any limiter counts the request.
  const on = async (req, res, next) => ((await isOn()) ? next() : res.status(404).json({ error: 'stories_off' }));
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const tokenIn = (v) => TOKEN_RX.test(String(v || ''));

  const pass = (res, out) => {
    if (out.status >= 300 && out.status < 400 && out.location) return res.redirect(out.status, out.location);
    if (out.status >= 500 && out.status !== 503) return res.status(502).json({ error: 'upstream_error' });
    return res.status(out.status).json(out.body == null ? {} : out.body);
  };
  const forward = (method, botPath, route) => async (req, res) => {
    const body = method === 'POST' ? req.body : null;
    const th = method === 'POST' ? (body || {}).th : req.query.th;
    if (!tokenIn(th)) return res.status(401).json({ error: 'bad_token' });
    try {
      const qs = method === 'POST' ? '' : forwardQuery(req.query);
      return pass(res, await callBot(method, `${botPath}${qs}`, req, body, { route }));
    } catch (_) {
      return res.status(502).json({ error: 'bot_unreachable' });
    }
  };

  router.get('/api/teacher/stories', noStore, ready, on, read, forward('GET', '/api/internal/ts/stories', '/api/internal/ts/stories'));
  router.get('/api/teacher/story/preview', noStore, ready, on, write, forward('GET', '/api/internal/ts/preview', '/api/internal/ts/preview'));
  // {th, story_id, class?} only, each checked; the page's Send form posts it form-encoded, the home as JSON.
  const shareBody = (req, res, next) => {
    const b = req.body || {};
    if (!UUID_RX.test(String(b.story_id || ''))) return tokenIn(b.th) ? res.status(400).json({ error: 'bad_story' }) : res.status(401).json({ error: 'bad_token' });
    if (b.class != null && b.class !== '' && !UUID_RX.test(String(b.class))) return res.status(400).json({ error: 'bad_class' });
    req.body = { th: b.th, story_id: b.story_id, ...(b.class ? { class: b.class } : {}) };
    return next();
  };
  const bodies = [express.json({ limit: '4kb', type: ['application/json', 'text/plain'] }), express.urlencoded({ extended: false, limit: '4kb' })];
  router.post('/api/teacher/story/send', noStore, ready, on, write, ...bodies, shareBody, forward('POST', '/api/internal/ts/send', '/api/internal/ts/send'));
  router.post('/api/teacher/story/share', noStore, ready, on, write, ...bodies, shareBody, forward('POST', '/api/internal/ts/share', '/api/internal/ts/share'));

  // The page: the bot's HTML, forwarded as bytes. With the switch off (here, or the bot's 404) the request goes on.
  const pageOn = async (req, res, next) => {
    const f = await flagsNow();
    if (!(f.gate || f.teacher)) return next('route');
    res.locals.tsGate = f.gate; // the one reading this request decides by
    return next();
  };
  router.get('/quiz/teacher/:th/stories', pageOn, read, async (req, res, next) => {
    const th = String(req.params.th || '');
    if (!TOKEN_RX.test(th) || !botUrl || !apiKey) return next();
    let out;
    try {
      out = await callBot('GET', `/api/internal/ts/page/${encodeURIComponent(th)}${forwardQuery(req.query, ['grade', 'lang', 'book'])}`, req, null,
        { raw: true, route: '/api/internal/ts/page' });
    } catch (_) {
      return next();
    }
    // Gate on: the bot's switch-off answer is the home's one-line page with the "not open yet" line, never a fall-through.
    if (res.locals.tsGate === true && isStoriesOff(out)) return notOpenPage(req, res);
    if (out.status !== 200 || !out.bytes || !/^text\/html/i.test(out.contentType || '')) return next();
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
    carryBotSecurity(res, out, securityOn);
    return res.status(200).type('html').send(out.bytes);
  });

  return router;
}

module.exports = { createTeacherStoriesRouter, forwardQuery, teacherFlagReader, storiesFlagsReader, GATE_KEY };
