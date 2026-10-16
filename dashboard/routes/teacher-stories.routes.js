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
 * `th` is the teacher-home token. Like /q/:code and /r/:token, the edge checks shapes, forwards only the
 * keys the bot reads and calls the bot with the internal key through the child quiz's bot client.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBotClient, clientIp } = require('./web-quiz.routes');

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
const FLAG_TTL_MS = 30000;

/** app_settings web_quiz_stories_teacher through the portal's own client and flag rule, remembered 30 s; failure = off. */
function teacherFlagReader({ now = Date.now, db = () => require('../config/supabase') } = {}) {
  let at = -Infinity;
  let val = false;
  return async () => {
    if (now() - at < FLAG_TTL_MS) return val;
    try {
      const supabase = db();
      val = supabase ? (await require('../lib/feature-flags').isFlagEnabled(supabase, FLAG_KEY)) === true : false;
    } catch (_) { val = false; }
    at = now();
    return val;
  };
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
  const teacherOn = opts.teacherOn || teacherFlagReader({ now: opts.now });
  const isOn = async () => { try { return (await teacherOn()) === true; } catch (_) { return false; } };
  const router = express.Router();
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
  const pageOn = async (req, res, next) => ((await isOn()) ? next() : next('route'));
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
    if (out.status !== 200 || !out.bytes || !/^text\/html/i.test(out.contentType || '')) return next();
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
    return res.status(200).type('html').send(out.bytes);
  });

  return router;
}

module.exports = { createTeacherStoriesRouter, forwardQuery, teacherFlagReader };
