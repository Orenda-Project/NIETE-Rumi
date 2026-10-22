'use strict';
/**
 * Reading Hour + Numeracy (FLN) in the teacher app: the server routes (SPEC v2 §3, §5;
 * contracts/api.md v2). Mounted at /api/portal by ONE line in dashboard/index.js.
 *
 *   GET  /fln/me           {lessons, share, role, ui_lang}         auth only
 *   GET  /fln/catalogue    the lesson list (Grades 1–5)            requireFln.lessons
 *   GET  /fln/plan/:id     {plan, placement}; logs ONE open        requireFln.lessons
 *                          (mirror media presigned on the portal bucket: services/fln-media-sign.js)
 *   POST /fln/events       share / link_copy / open_link rows; audio_play / audio_error as log events
 *   flnPreview             GET /portal/fln/p/:id for link-preview fetchers only (a hook in the SPA catch-all)
 *
 * Every answer is `Cache-Control: no-store` (noStore is the FIRST handler of every route; requireFln carries it):
 * shared phones in schools. 404 = FLN off for this user; 503 {error:'fln_unavailable'} = corpus not loaded.
 * An unknown or hidden plan is a 404 decided BEFORE the open is logged, and the preview never logs an open.
 *
 * WHAT FLN DELIBERATELY DOES NOT FEED (SPEC v2 §6 — EXCL rows; each is on purpose, do not "fix" one into a crash):
 *   8  ICT LP Engagement (lp-engagement.service kind filter) — the ICT ratio is textbook-LP coverage per grade×subject;
 *      Reading Hour would move its On/Off bands.
 *   9  LP survey "was this useful?" (lp-app-open-survey) — an FLN id must never reach lp_feedback.lp612_segment_id;
 *      this route never calls LpOpenSurvey.afterOpen, and the survey skips kind 'fln' itself.
 *   10 Coaching ask "record this lesson?" (lp-coaching-ask) — DC fidelity needs moves/assets FLN lacks (`not_k5`).
 *   16 15:00 LP quiz offer (lp-quiz-offer) — no FLN slide script to write a quiz from; its k5 filter stands.
 *   17 /quiz "From lesson plan" (lp-v8-lesson-provider) — same.
 *   18 Chat/call lp-context — the context block needs lesson text in its format; a later bead.
 *   19 Coaching subject resolution — subject-resolution already names FLN subjects from text; a later bead.
 *   20 Recent LPs for coaching/fidelity (recent-fidelity-lps) — fidelity needs asset/version/moves.
 *   22 Transcript quiz lesson hint — wants a chapter; later.
 *   23 Call/voice tools findLessons — reads downloads only (blind to all app opens; separate bug).
 *   24 Coaching library pick (portal-lesson-plan-library) — until FLN coaching exists.
 *   25 `lesson_plans` counters (portal.routes, leader-patch, leader-teacher-detail) — never write FLN anchor rows.
 *   26 every other `lesson_plans` reader (quiz pickers, feature-linker, retention MVs …) — no FLN anchors, ever.
 *   27 lesson_plan_requests — FLN is static content; no asks are written.
 *   28 Redis `lp_shelf` — WhatsApp deliveries only.
 *   29 lp612 deliveries store — grades 6-12 only.
 *   30 the ch3-10 A/B (lp-ab-ch310 + its readers) — EXCL by construction: nothing here requires it, FLN plans are never
 *      in the k5 catalogue, and an `fln` open row is invisible to its k5-filtered reads (fln-ab-isolation.test.js).
 */
const express = require('express');
const { flnAccess, requireFln, requirePortalAuth, noStore } = require('../lib/fln-access');
const Corpus = require('../services/fln-corpus.service');
const LpActivity = require('../services/lp-activity.service');
const LpReader = require('../services/lp-reader.service');
const FlnMedia = require('../services/fln-media-sign');
// The portal's OWN telemetry sink (never the bot's pino loggers: pino is not installed for this service).
const telemetry = require('../services/telemetry.service');
// The same pool portal.routes.js uses (one pool per process), as a plain (sql, params) function.
const pool = require('../config/database');

const dbQuery = (sql, params) => pool.query(sql, params);

const ID_RX = /^\d{1,9}$/;
const SUBJECTS = new Set(['rh-en', 'rh-ur', 'num']);
const MAX_EVENTS = 50;
const INSERTED_KINDS = new Set(['share', 'link_copy', 'open_link']);
// Audio events are logged as structured events, not stored (`send` is server-written only, m-links).
const LOGGED_KINDS = Object.freeze({ audio_play: 'fln.audio.play', audio_error: 'fln.audio.error' });
const PREVIEW_PATH = /^\/portal\/fln\/p\/(\d{1,9})\/?$/;
// Anchored as in web-quiz-preview.js: WhatsApp's link FETCHER sends a bare "WhatsApp/2.x A"; its in-app BROWSER sends
// "Mozilla/5.0 … WhatsApp/2.x", and that is a teacher who must get the app, not the stub.
const PREVIEW_UA = /^(?:WhatsApp\/\d[\d.]*(?:\s+[AIN])?\s*$|facebookexternalhit\/|Facebot\b|meta-externalagent\/|TelegramBot\b|Twitterbot\/|Slackbot|LinkedInBot\/|Discordbot\/)/;

/**
 * A teacher's keyed reference: bot/shared/services/quiz/web-quiz-kid.js `tk`, the one helper that computes it. That
 * module requires the bot logger only when it writes a line, and this service does not install the bot's pino: with
 * no WEB_QUIZ_KID_KEY, `tk` notes the missing key through that logger, the require throws here, and the answer is
 * null, as for a short key (then nothing is stored and /fln/events says why; never an unkeyed hash).
 */
function userKeyOf(userId) {
  try {
    return require('../../bot/shared/services/quiz/web-quiz-kid').tk(userId);
  } catch (_) {
    return null;
  }
}

/** iab-android | iab-ios | chrome | safari | other — from the User-Agent, nothing else kept. */
function uaClass(ua) {
  const s = typeof ua === 'string' ? ua : '';
  const ios = /iPhone|iPad|iPod/.test(s);
  if (/WhatsApp|FBAN|FBAV|Instagram/i.test(s)) return ios ? 'iab-ios' : 'iab-android';
  if (/; wv\)/.test(s)) return 'iab-android';
  if (ios && !/Safari\//.test(s)) return 'iab-ios';
  if (/Chrome\/|CriOS\/|Chromium\//.test(s)) return 'chrome';
  if (/Safari\//.test(s) && /Version\//.test(s)) return 'safari';
  return 'other';
}

/** At most `n` code points (never splits a surrogate pair), with an ellipsis when cut. */
function clipCodePoints(text, n) {
  const cps = [...String(text == null ? '' : text)];
  return cps.length <= n ? cps.join('') : `${cps.slice(0, n - 1).join('')}…`;
}

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const plainText = (s) => String(s == null ? '' : s).replace(/\*\*|\*/g, '').replace(/\s+/g, ' ').trim();

function badRequest(res) {
  return res.status(400).json({ error: 'bad_request' });
}

function unavailable(res) {
  return res.status(503).json({ error: 'fln_unavailable' });
}

async function openedRefs(query, userId) {
  try {
    const { rows } = await query(
      "SELECT DISTINCT plan_ref FROM niete_lp_opens WHERE user_id = $1::uuid AND plan_kind = 'fln'",
      [userId],
    );
    return new Set((rows || []).map((r) => String(r.plan_ref)));
  } catch (error) {
    console.error('❌ FLN catalogue: opened read failed (shown as not opened)', { error: error && error.message });
    return new Set();
  }
}

function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null;
  if (!INSERTED_KINDS.has(e.kind) && !LOGGED_KINDS[e.kind]) return null;
  const plan = typeof e.plan === 'number' ? String(e.plan) : e.plan;
  if (typeof plan !== 'string' || !ID_RX.test(plan)) return null;
  const clip = typeof e.clip === 'string' && e.clip.length <= 200 ? e.clip : null;
  const ms = Number.isInteger(e.ms) && e.ms >= 0 && e.ms <= 3600000 ? e.ms : null;
  const result = typeof e.result === 'string' && /^[a-z0-9_.:-]{1,60}$/i.test(e.result) ? e.result : null;
  return { kind: e.kind, plan, clip, ms, result };
}

// index.js parses JSON app-wide; parse here only when nothing has (a body is never read twice).
const jsonParser = express.json({ limit: '64kb' });
function jsonOnce(req, res, next) {
  if (req._body || req.body !== undefined) return next();
  return jsonParser(req, res, next);
}

function createFlnRouter({ query = dbQuery, corpus = Corpus, activity = LpActivity, media = FlnMedia } = {}) {
  const router = express.Router();

  // Who am I for FLN — m-app owns /me; m-links' links/teachers/send live in portal-fln-links.routes.js.
  router.get('/fln/me', noStore, requirePortalAuth, async (req, res) => {
    res.json(await flnAccess(req.session.portalUserId));
  });

  router.get('/fln/catalogue', ...requireFln.lessons, async (req, res) => {
    const q = req.query || {};
    const grade = /^\d{1,2}$/.test(String(q.grade || '')) ? Number(q.grade) : NaN;
    const subject = String(q.subject || '');
    const hasLevel = q.level !== undefined && q.level !== '';
    const level = hasLevel && /^[123]$/.test(String(q.level)) ? Number(q.level) : null;
    // FLN is Grades 1–5 only (bd-elc1qz); a grade's catalogue is that grade's own rows, so `level` is validated (the
    // list's "Other levels" chip and old links send it) but never passed on.
    if (!(grade >= 1 && grade <= 5) || !SUBJECTS.has(subject) || (hasLevel && level == null)) return badRequest(res);
    if (!(await corpus.ensure())) return unavailable(res);
    const opened = await openedRefs(query, req.session.portalUserId);
    const out = corpus.catalogue({ grade, subject, opened });
    if (!out) return unavailable(res);
    return res.json(out);
  });

  router.get('/fln/plan/:id', ...requireFln.lessons, async (req, res) => {
    const id = String(req.params.id || '');
    if (!ID_RX.test(id)) return res.status(404).json({ error: 'not_found' });
    if (!(await corpus.ensure())) return unavailable(res);
    const plan = corpus.plan(id);
    // Unknown or hidden is decided FIRST: no open row for a plan nobody can see (SPEC v2 §1, §5).
    if (!plan || corpus.isHidden(id)) return res.status(404).json({ error: 'not_found' });
    // Fire-and-forget, never awaited, and never chained to the lesson-plan survey (SPEC §6 row 9 EXCL).
    // bd-4joiqz — a leader reading it is not a teacher's open: a telemetry event, no open row (lp-reader.service).
    // The role is the one requireFln just re-read from users (req.fln.role): no second read.
    const userId = req.session.portalUserId;
    LpReader.readerOf(userId, { role: req.fln ? req.fln.role : null }).then((reader) => LpReader.recordOpen(reader, query, {
      userId, kind: 'fln', ref: id, lang: plan.lang, source: 'viewer',
    }, { survey: false, activity }));
    // The body is the plan + where it sits; NO `share` key — the client reads that from /me. Media on the public
    // mirror is served presigned on the portal's own bucket (a new tree; the corpus plan is never touched).
    const served = await media.servePlan(plan, id);
    return res.json({ plan: served, placement: corpus.placementOf(id) });
  });

  router.post('/fln/events', ...requireFln.lessons, jsonOnce, async (req, res) => {
    const body = req.body;
    if (!Array.isArray(body) || body.length > MAX_EVENTS) return badRequest(res);
    const events = body.map(cleanEvent).filter(Boolean);
    const userKey = userKeyOf(req.session.portalUserId);
    const ua = uaClass(req.get('user-agent'));
    if (events.length && !userKey) {
      console.error('❌ FLN events dropped: WEB_QUIZ_KID_KEY is not set (no keyed id, nothing stored)');
      return res.status(204).end();
    }
    for (const e of events) {
      if (!LOGGED_KINDS[e.kind]) continue;
      try {
        telemetry.logEvent(LOGGED_KINDS[e.kind], { tk: userKey, plan: e.plan, clip: e.clip, ms: e.ms, result: e.result, ua_class: ua });
      } catch (_) { /* a log line never costs the answer */ }
    }
    const rows = events.filter((e) => INSERTED_KINDS.has(e.kind));
    if (rows.length) {
      const params = [];
      const values = rows.map((e, i) => {
        params.push(userKey, e.kind, e.plan, e.clip, e.ms, e.result, ua);
        const b = i * 7;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
      });
      try {
        await query(`INSERT INTO niete_fln_events (user_key, kind, plan_ref, clip, ms, result, ua_class) VALUES ${values.join(', ')}`, params);
      } catch (error) {
        console.error('❌ FLN events not stored', { n: rows.length, error: error && error.message });
      }
    }
    return res.status(204).end();
  });

  // Link previews (WhatsApp, Facebook, Slack …) of /portal/fln/p/:id get a tiny og: page; people get the SPA.
  const flnPreview = {
    wants(req) {
      try {
        if (!req || req.method !== 'GET') return false;
        const m = PREVIEW_PATH.exec(req.path || '');
        if (!m || !PREVIEW_UA.test(String(req.get ? req.get('user-agent') || '' : ''))) return false;
        return corpus.ready() && !corpus.isHidden(m[1]) && Boolean(corpus.plan(m[1]));
      } catch (_) {
        return false;
      }
    },
    send(req, res) {
      const id = PREVIEW_PATH.exec(req.path)[1];
      const plan = corpus.plan(id);
      const ur = plan.lang === 'ur';
      const kicker = corpus.kickerFor(corpus.placementOf(id)[0], ur ? 'ur' : 'en');
      const title = kicker ? `${kicker} — ${plainText(plan.title)}` : plainText(plan.title);
      const desc = clipCodePoints(plainText((plan.slo || [])[0] || ''), 160);
      const image = `${req.protocol}://${req.get('host')}/favicon.png`;
      // Never logs an open: a preview fetcher is not a teacher reading the plan.
      res.set('Cache-Control', 'no-store');
      res.type('html');
      return res.send(`<!doctype html>
<html lang="${ur ? 'ur' : 'en'}" dir="${ur ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="NIETE Portal">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(image)}">
</head>
<body></body>
</html>`);
    },
  };
  router.flnPreview = flnPreview;
  return router;
}

const router = createFlnRouter();
router.use(require('./portal-fln-links.routes')); // m-links PR-D: /fln/links, /fln/title/:id (+ PR-E /fln/teachers, /fln/send)

module.exports = router;
module.exports.createFlnRouter = createFlnRouter;
module.exports.userKeyOf = userKeyOf;
module.exports.uaClass = uaClass;
module.exports.clipCodePoints = clipCodePoints;
