/**
 * The teacher app's funnel, as seen from the app — bd-4r3rei.
 *
 * The WhatsApp half is the bot's (bot/shared/services/app-redirect.service.js: app_funnel.command / link_sent /
 * link_failed) and the open is app-login.routes.js (app_link.open). This file is the rest of the journey:
 *
 *   POST /api/portal/funnel/events   the pages report where she is (batched by the SPA, sendBeacon on pagehide):
 *                                    app_funnel.page_view / page_leave / page_resume
 *   actionLogger                     the key things she DOES, logged here from the server the moment the request
 *                                    succeeds: app_funnel.action (lesson plan opened, paper requested, attendance saved…)
 *
 * Both write structured events to Axiom (services/telemetry.service.js — the portal's own sink). No table, no column,
 * no change to any feature's route: Axiom is the home for this (workspace Rule 15).
 *
 * WHO SAYS WHO. The user, the journey and the session come from the portal SESSION — never from the request body. A
 * browser can say "I am on /portal/teacher/lessons" and nothing else about itself, so it cannot attribute events to
 * another teacher or another journey. The journey (set by /go from the link's token) counts for 24 hours, the life of
 * the link; after that the same session logs journeyId null.
 *
 * WHAT IS NEVER LOGGED. Names, phones, free text, ids, query strings. Routes are normalised to their shape
 * ('/portal/coach/visit/:id/record'); `appSessionId` is a hash of the session id, never the id itself.
 *
 * It must not be the reason a page is slow or a request fails: every failure here is swallowed, the endpoint answers
 * 204 before anyone waits on Axiom, and a session that floods it is cut off (429).
 */
const crypto = require('crypto');
const express = require('express');
const { normaliseRoute, featureOfRoute, isJourneyId, JOURNEY_TTL_MS } = require('../../bot/shared/services/app-journey');
// The portal's OWN sink (the bot's loggers need pino, which this service does not install).
const telemetry = require('../services/telemetry.service');

const MAX_BODY = '8kb';
const MAX_EVENTS = 25;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_DWELL_MS = 6 * 60 * 60 * 1000;
const HOW = new Set(['nav', 'hidden', 'pagehide']);
const KINDS = { view: 'app_funnel.page_view', leave: 'app_funnel.page_leave', resume: 'app_funnel.page_resume' };

function emit(event, props) {
  try { telemetry.logEvent(event, props); } catch (_) { /* logging never decides the response */ }
}

/**
 * Which kind of browser this is, from the request itself — the page does not get to say it is "in WhatsApp"
 * (in-app-browser-whatsapp: classify server-side from the UA). WhatsApp's own browser carries `WA4A/<version>` (or
 * announces itself in X-Requested-With), NOT `; wv)`: a bare WebView is another app's, so it is its own class.
 * The only claim believed is the Android app's own 'native' — a label, not a permission. The user agent is read, never
 * stored: only the class is logged.
 */
function browserClass(req, claimed) {
  if (claimed === 'native') return 'native';
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  const xrw = String(req.get('x-requested-with') || '').slice(0, 80);
  if (/WhatsApp|WA4A\//.test(ua) || /^com\.whatsapp/.test(xrw)) return 'whatsapp-iab';
  if (/Android/i.test(ua)) return /; wv\)/.test(ua) ? 'webview' : 'browser';
  if (/iPhone|iPad|iPod/i.test(ua)) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
    return !otherBrowser && !/Safari\//.test(ua) ? 'webview' : 'browser';
  }
  return 'browser';
}

/** A stable, non-reversible label for this session — the same on every row she makes until she signs in again. */
function appSessionId(session, req) {
  const id = (session && session.id) || (req && req.sessionID) || '';
  return crypto.createHash('sha256').update(`app-funnel\u0000${id}`).digest('hex').slice(0, 12);
}

/** The journey the link started, while the link is still good. */
function activeJourney(session, now) {
  const j = session && session.appJourney;
  if (!j || !isJourneyId(j.id) || !Number.isFinite(j.at)) return null;
  if (now - j.at >= JOURNEY_TTL_MS || j.at > now + 60 * 1000) return null;
  return j;
}

/** The fields every row of this session shares. */
function who(req, now) {
  const s = req.session;
  const journey = activeJourney(s, now);
  const scope = s.portalScope ? String(s.portalScope).replace(/[^a-z_]/gi, '').slice(0, 24) : '';
  return {
    userId: s.portalUserId,
    journeyId: journey ? journey.id : null,
    appSessionId: appSessionId(s, req),
    entry: scope ? `link:${scope}` : (journey ? 'app_link' : 'session'),
    ...(journey && journey.feature ? { linkFeature: String(journey.feature).slice(0, 32) } : {}),
  };
}

function requireSession(req, res, next) {
  const s = req.session;
  if (!s || !s.portalUserId) return res.status(401).end();
  return next();
}

/**
 * Per-session allowance (the IP when there is no session id): `maxRequests` calls and `maxEvents` events per window.
 * A teacher's phone sends one call every few seconds at the very most; this stops a loop, not a person.
 */
function createFunnelLimiter({ windowMs = 60 * 1000, maxRequests = 30, maxEvents = 200 } = {}) {
  const seen = new Map(); // key -> { resetAt, requests, events }
  return {
    /** → events this call may log (0 = refuse), consuming the allowance. */
    take(key, wanted, now = Date.now()) {
      if (seen.size > 5000) for (const [k, v] of seen) if (v.resetAt <= now) seen.delete(k);
      let h = seen.get(key);
      if (!h || h.resetAt <= now) { h = { resetAt: now + windowMs, requests: 0, events: 0 }; seen.set(key, h); }
      h.requests += 1;
      if (h.requests > maxRequests) return 0;
      const allowed = Math.max(0, Math.min(wanted, maxEvents - h.events));
      h.events += allowed;
      return allowed;
    },
  };
}

const clampInt = (v, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), max);
};

/** One reported event → [eventName, props], or null when it is not something we log. */
function toRow(ev, browser, base, now) {
  if (!ev || typeof ev !== 'object' || typeof ev.k !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, ev.k)) return null;
  const route = normaliseRoute(ev.r);
  if (!route) return null;
  const props = {
    // Placed by how long ago it happened — the page's clock is never trusted, and a batch keeps its order.
    _time: new Date(now - clampInt(ev.age, MAX_AGE_MS)).toISOString(),
    ...base,
    route,
    feature: featureOfRoute(route),
    browser,
  };
  if (ev.k === 'view') props.prevRoute = normaliseRoute(ev.pr);
  if (ev.k === 'leave') {
    props.dwellMs = clampInt(ev.d, MAX_DWELL_MS);
    props.how = HOW.has(ev.why) ? ev.why : 'unknown';
  }
  return [KINDS[ev.k], props];
}

function createAppFunnelRouter({ limiter } = {}) {
  const router = express.Router();
  const limits = createFunnelLimiter(limiter || {});

  router.post(
    '/funnel/events',
    requireSession,
    (req, res, next) => {
      // Cheap refusal before any body is read: the call count only; events are counted once the batch is parsed.
      const key = appSessionId(req.session, req);
      req.funnelKey = key;
      return next();
    },
    express.text({ type: 'text/*', limit: MAX_BODY }),
    (req, res) => {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object' || !Array.isArray(body.ev)) return res.status(400).end();

      const now = Date.now();
      const events = body.ev.slice(0, MAX_EVENTS);
      const allowed = limits.take(req.funnelKey, events.length, now);
      if (!allowed && events.length) return res.status(429).end();

      const browser = browserClass(req, body.b);
      const base = who(req, now);
      for (const ev of events.slice(0, allowed)) {
        const row = toRow(ev, browser, base, now);
        if (row) emit(row[0], row[1]);
      }
      return res.status(204).end();
    },
    // A body over the cap, or one the parser refuses: a quiet 4xx, never the app's error page.
    (err, _req, res, _next) => res.status(err && err.status === 413 ? 413 : 400).end(),
  );

  /**
   * bd-1d6g8o — ICT IAB row 19: a Digital Coach Submit that failed. The page said "No internet" and nothing recorded
   * which file failed or why (every request the server saw was a 200: the failure was in the phone, uploading straight
   * to storage). The page now says the step, the file (kind, its place, size, type) and the reason; this logs it as
   * dc_upload.failed with the teacher from the SESSION. Only known values pass; no names, no file names.
   */
  router.post(
    '/funnel/dc-upload-failed',
    requireSession,
    express.text({ type: 'text/*', limit: '2kb' }),
    (req, res) => {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).end();
      const now = Date.now();
      if (!limits.take(appSessionId(req.session, req), 1, now)) return res.status(429).end();
      const pick = (v, allowed) => (allowed.includes(v) ? v : 'unknown');
      const status = Number(body.status);
      const type = typeof body.type === 'string' && /^[a-z]+\/[a-z0-9.+-]{1,60}$/i.test(body.type) ? body.type.toLowerCase() : 'unknown';
      const { journeyId, ...base } = who(req, now);
      emit('dc_upload.failed', {
        ...base,
        journeyId,
        feature: 'ai_coaching',
        browser: browserClass(req, body.b),
        stage: pick(body.stage, DC_UPLOAD_STAGES),
        kind: pick(body.kind, DC_UPLOAD_KINDS),
        item: clampInt(body.item, 20),
        items: clampInt(body.items, 20),
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        reason: pick(body.reason, DC_UPLOAD_REASONS),
        sizeBytes: clampInt(body.sizeBytes, 2 * 1024 * 1024 * 1024),
        type,
        elapsedMs: clampInt(body.elapsedMs, 60 * 60 * 1000),
      });
      return res.status(204).end();
    },
    (err, _req, res, _next) => res.status(err && err.status === 413 ? 413 : 400).end(),
  );

  /**
   * The coach's microphone check (portal lib/assess/micReport.ts), logged as sa_mic.check. A check that failed on a
   * coach's iPhone left no trace: it runs only on the phone. The page says what the phone did (the browser's reason for
   * a refused microphone, the recorder's type and bytes, the meter's loudest level, the AudioContext's state, a refused
   * play-back, the track's settings) and then what the coach answered. The user comes from the SESSION; the phone, its
   * major version and its browser are classed here from the user agent, which is never stored. Only known values pass.
   */
  router.post(
    '/funnel/mic-check',
    requireSession,
    express.text({ type: 'text/*', limit: '2kb' }),
    (req, res) => {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).end();
      const now = Date.now();
      if (!limits.take(appSessionId(req.session, req), 1, now)) return res.status(429).end();
      const pick = (v, allowed) => (allowed.includes(v) ? v : 'unknown');
      const word = (v) => (typeof v === 'string' && /^[A-Za-z_]{1,40}$/.test(v) ? v : 'unknown');
      const bool = (v) => (typeof v === 'boolean' ? v : null);
      const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : null);
      const phase = pick(body.phase, MIC_PHASES);
      const { journeyId, ...base } = who(req, now);
      const props = { ...base, journeyId, feature: 'learning_assessment', browser: browserClass(req, body.b), ...micPhone(req), phase, iosMic: body.iosMic === true };
      if (phase === 'answer') props.answer = pick(body.answer, MIC_ANSWERS);
      else {
        Object.assign(props, {
          gum: word(body.gum),
          recorder: body.recorder === true,
          mimeType: typeof body.mimeType === 'string' && /^[a-z]+\/[a-z0-9.+-]{1,40}(;codecs=[a-z0-9.,"-]{1,30})?$/i.test(body.mimeType) ? body.mimeType.toLowerCase() : (body.mimeType === '' ? '' : 'unknown'),
          bytes: clampInt(body.bytes, 50 * 1024 * 1024),
          chunks: clampInt(body.chunks, 1000),
          peak: num(body.peak, 1) ?? 0,
          ctxStart: pick(body.ctxStart, MIC_CTX_STATES),
          ctxEnd: pick(body.ctxEnd, MIC_CTX_STATES),
          play: pick(body.play, MIC_PLAY),
          playError: body.playError === '' ? '' : word(body.playError),
          sampleRate: num(body.sampleRate, 384000),
          channelCount: num(body.channelCount, 32),
          echoCancellation: bool(body.echoCancellation),
          autoGainControl: bool(body.autoGainControl),
          noiseSuppression: bool(body.noiseSuppression),
        });
      }
      emit('sa_mic.check', props);
      return res.status(204).end();
    },
    (err, _req, res, _next) => res.status(err && err.status === 413 ? 413 : 400).end(),
  );

  return router;
}

const MIC_PHASES = ['probe', 'answer'];
const MIC_ANSWERS = ['heard', 'again', 'skip', 'replay'];
const MIC_CTX_STATES = ['none', 'suspended', 'running', 'closed', 'interrupted'];
const MIC_PLAY = ['ok', 'blocked', 'error', 'none'];

/** The phone (ios / android / other), its major OS version and its browser, classed from the user agent (never stored). */
function micPhone(req) {
  const ua = String(req.get('user-agent') || '').slice(0, 300);
  const ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)_/);
  const android = ua.match(/Android (\d+)/);
  const os = ios ? 'ios' : (android ? 'android' : 'other');
  const osMajor = Number((ios || android || [])[1]) || null;
  let engine = 'other';
  if (/WAiOS\/|WhatsApp|WA4A\//.test(ua)) engine = 'whatsapp';
  else if (/CriOS\//.test(ua)) engine = 'crios';
  else if (/FxiOS\//.test(ua)) engine = 'fxios';
  else if (/EdgiOS\/|EdgA\//.test(ua)) engine = 'edge';
  else if (ios && /Version\/[\d.]+.*Safari\//.test(ua)) engine = 'safari';
  else if (/Chrome\//.test(ua)) engine = /; wv\)/.test(ua) ? 'android_webview' : 'chrome';
  return { os, osMajor, engine };
}

const DC_UPLOAD_STAGES = ['presign', 'upload', 'start'];
const DC_UPLOAD_KINDS = ['audio', 'lesson_plan', 'photo'];
const DC_UPLOAD_REASONS = ['http', 'network', 'abort', 'unknown'];

// ─── the key actions ────────────────────────────────────────────────────────────────────────────────────────
//
// [method, path (under /api/portal), action, feature, extra props, optional predicate on the request].
// Matched against the path only, so no id ever reaches a log; only a 2xx/3xx answer counts.
const isOpenHint = (req) => ['1', 'true'].includes(String(req.query && req.query.open));
const ACTIONS = [
  // A lesson plan reaches her screen: the PDF went out (grades 1-5 and 6-12), or the "open in another app" hint.
  ['GET', /^\/curriculum\/lp\/[^/]+\/(?:file|pdf)$/, 'lesson_plan.opened', 'lesson_plan', { lane: 'k5' }],
  ['GET', /^\/lp612\/file\/[^/]+$/, 'lesson_plan.opened', 'lesson_plan', { lane: 'g612' }],
  ['GET', /^\/lp612\/status\/[^/]+$/, 'lesson_plan.opened', 'lesson_plan', { lane: 'g612' }, isOpenHint],
  ['GET', /^\/fln\/plan\/\d+$/, 'lesson_plan.opened', 'lesson_plan', { lane: 'fln' }],
  ['POST', /^\/lp612\/request$/, 'lesson_plan.requested', 'lesson_plan', { lane: 'g612' }],
  // bd-zcgpkx — a leader sent an FLN plan to their teachers: what a leader's lesson-plan journey is for.
  ['POST', /^\/fln\/send$/, 'fln.sent', 'lesson_plan', { lane: 'fln_send' }],
  // The assessment generator: a paper asked for (it is written in the background), and one she edited.
  ['POST', /^\/assessment\/generate$/, 'paper.requested', 'assessment_generator', {}],
  ['POST', /^\/assessment\/edit\/[^/]+\/save$/, 'paper.edited', 'assessment_generator', {}],
  // Attendance: a class marked, the register sent; the principal's own marking.
  ['POST', /^\/teacher\/attendance\/classes\/[^/]+\/mark$/, 'attendance.saved', 'attendance', {}],
  ['POST', /^\/teacher\/attendance\/classes\/[^/]+\/register\/send$/, 'attendance.register_sent', 'attendance', {}],
  ['POST', /^\/attendance\/mark$/, 'attendance.saved', 'attendance', {}],
  // Training.
  ['GET', /^\/training\/module\/[^/]+$/, 'training.module_opened', 'teacher_training', {}],
  ['POST', /^\/training\/module\/[^/]+\/quiz-attempts\/start$/, 'training.quiz_started', 'teacher_training', {}],
  ['POST', /^\/training\/module\/[^/]+\/quiz-attempts\/[^/]+\/finish$/, 'training.quiz_finished', 'teacher_training', {}],
  ['POST', /^\/training\/module\/[^/]+\/complete$/, 'training.module_completed', 'teacher_training', {}],
  ['POST', /^\/training\/level\/[^/]+\/certificate$/, 'training.certificate_issued', 'teacher_training', {}],
  // Classes.
  ['POST', /^\/classes$/, 'class.created', 'classes', {}],
  ['POST', /^\/classes\/[^/]+\/students$/, 'class.students_added', 'classes', {}],
  // Digital Coach: a classroom recording submitted, a reflection written.
  ['POST', /^\/coaching-upload\/start$/, 'coaching.recording_submitted', 'ai_coaching', {}],
  ['POST', /^\/coaching-session\/[^/]+\/reflection$/, 'coaching.reflection_saved', 'ai_coaching', {}],
  // Sharing to WhatsApp, the "she did something with it" step of every page that offers it.
  ['POST', /^\/share\/whatsapp$/, 'share.whatsapp', 'share', {}],
  // A coach's observation: started, the report sent.
  ['POST', /^\/leader\/observe\/start$/, 'observe.started', 'coach', {}],
  ['POST', /^\/leader\/observe\/[^/]+\/report\/send$/, 'observe.report_sent', 'coach', {}],
  // The "ready for you" strip.
  ['POST', /^\/me\/notices\/[^/]+\/opened$/, 'notice.opened', 'notice', {}],
];

function matchAction(req) {
  const method = req.method;
  for (const [m, re, action, feature, extra, when] of ACTIONS) {
    if (m === method && re.test(req.path) && (!when || when(req))) return { action, feature, extra };
  }
  return null;
}

/** Mounted on /api/portal BEFORE the routers (index.js): logs a key action once its response has gone out with a 2xx/3xx. */
function actionLogger(req, res, next) {
  let hit = null;
  try { hit = matchAction(req); } catch (_) { hit = null; }
  if (!hit) return next();
  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;
      const s = req.session;
      if (!s || !s.portalUserId) return;
      emit('app_funnel.action', {
        ...who(req, Date.now()), action: hit.action, feature: hit.feature, ...hit.extra, status: res.statusCode,
      });
    } catch (_) { /* never */ }
  });
  return next();
}

/**
 * bd-c5reix — a key action a route can only name once it has the bot's answer (actionLogger sees the request alone):
 * her waiting WhatsApp recordings shown, one sent, a repeat caught before an upload. The same row, the same who.
 */
function logAppAction(req, action, feature, extra = {}) {
  try {
    const s = req && req.session;
    if (!s || !s.portalUserId) return;
    emit('app_funnel.action', { ...who(req, Date.now()), action, feature, ...extra });
  } catch (_) { /* never */ }
}

// browserClass: bd-x1tl95, the app's Send feedback records which browser it came from the same way.
module.exports = { createAppFunnelRouter, actionLogger, logAppAction, browserClass };
