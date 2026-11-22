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
 * another teacher or another journey. The journey (set by /go from the link's token) counts for 24 hours from the tap
 * (the link itself lives 7 days: bd-zrdvmi.28); after that the same session logs journeyId null.
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
// bd-snkn32.51 (queue #134 A) — "Make my own" asks one question per screen on ONE route (the step is in the query, which
// page rows drop), so each screen reports itself: own_form.step, entered / left. Codes from these lists only.
const OWN_ROUTE = '/portal/teacher/lessons/own';
const OWN_STEPS = new Set(['pages', 'purpose', 'focus', 'size', 'level', 'resources', 'way', 'check']);
const OWN_PHASES = new Set(['enter', 'leave']);
const OWN_BANDS = new Set(['k5', 'g612']);

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

/** A form screen of "Make my own" → ['own_form.step', props], or null. Grade, subject, band: a code or null. */
function toStepRow(ev, browser, base, now) {
  if (normaliseRoute(ev.r) !== OWN_ROUTE || !OWN_STEPS.has(ev.s) || !OWN_PHASES.has(ev.ph)) return null;
  const grade = Number.isInteger(ev.g) && ev.g >= 1 && ev.g <= 12 ? ev.g : null;
  const props = {
    _time: new Date(now - clampInt(ev.age, MAX_AGE_MS)).toISOString(),
    ...base,
    route: OWN_ROUTE,
    feature: 'lesson_plan',
    browser,
    step: ev.s,
    phase: ev.ph,
    grade,
    subject: typeof ev.sub === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(ev.sub) ? ev.sub : null,
    band: OWN_BANDS.has(ev.bd) ? ev.bd : null,
  };
  if (ev.ph === 'leave') {
    props.dwellMs = clampInt(ev.d, MAX_DWELL_MS);
    props.how = HOW.has(ev.why) ? ev.why : 'unknown';
  }
  return ['own_form.step', props];
}

/** One reported event → [eventName, props], or null when it is not something we log. */
function toRow(ev, browser, base, now) {
  if (ev && typeof ev === 'object' && ev.k === 'step') return toStepRow(ev, browser, base, now);
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
        // bd-bmc9a0.1 — ICT IAB rows 28-29: how much of the part left the phone, whether the phone said it was online,
        // and what was sent (an in-memory copy of a picked file, a slice of one, or the page's own Blob).
        sentBytes: clampInt(body.sentBytes, 2 * 1024 * 1024 * 1024),
        online: typeof body.online === 'boolean' ? body.online : null,
        sentAs: pick(body.sentAs, DC_UPLOAD_SENT_AS),
        // bd-r2uzg1.9 — ICT IAB row 29: the browser's own name for a failed read of a picked file, and what a picked
        // "photo" is from its first bytes. Absent stays null; anything not on the lists is 'unknown'.
        errName: body.errName == null ? null : pick(body.errName, DC_UPLOAD_ERR_NAMES),
        magic: body.magic == null ? null : pick(body.magic, DC_UPLOAD_MAGIC),
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
  /**
   * bd-zrdvmi.21 — ICT Feedback sheet, GB row 3: the lesson-plan reader's "Can't show it here" (components/
   * LessonPlanViewer via lib/lpViewerReport.ts). The server answered every file request with 200, so the failure is in
   * the phone: which step (download, loading the reader, reading the file, drawing page 1), the HTTP status or the
   * browser's reason, the file's size and page 1's shape, how long it ran, online or not. Teacher from the SESSION.
   */
  router.post(
    '/funnel/lp-viewer-failed',
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
      const { journeyId, ...base } = who(req, now);
      emit('lp_viewer.failed', {
        ...base,
        journeyId,
        feature: 'lesson_plan',
        browser: browserClass(req, body.b),
        stage: pick(body.stage, LP_VIEWER_STAGES),
        lane: pick(body.lane, LP_VIEWER_LANES),
        reason: pick(body.reason, LP_VIEWER_REASONS),
        status: body.status != null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        errName: body.errName == null ? null : (typeof body.errName === 'string' && /^[A-Za-z]{1,40}$/.test(body.errName) ? body.errName : 'unknown'),
        sizeBytes: clampInt(body.sizeBytes, 200 * 1024 * 1024),
        pages: clampInt(body.pages, 10000),
        pageWidth: clampInt(body.pageWidth, 100000),
        pageHeight: clampInt(body.pageHeight, 100000),
        elapsedMs: clampInt(body.elapsedMs, 60 * 60 * 1000),
        online: typeof body.online === 'boolean' ? body.online : null,
      });
      return res.status(204).end();
    },
    (err, _req, res, _next) => res.status(err && err.status === 413 ? 413 : 400).end(),
  );

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

  /**
   * "Get ready for offline" and the class list on the coach's page (portal lib/assess/offlineReport.ts). Both ran only
   * on the phone: a Get ready that never finished, or a class list that never came, left no trace on our side. One
   * row per report, every field a flat top-level column (never a nested object), the user from the SESSION:
   *   sa_prep.result         Get ready ended (ready / partly / updating): counts, the engine's reason, up to 5 missing
   *                          paths (no query string), the two service workers' state
   *   sa_prep.still_waiting  Get ready still running 120 s after the tap (once per tap), and where it is
   *   sa_list.failed         the list read failed: the server's reason, a network failure or not, the HTTP status
   *   sa_list.slow           the list still not on screen 15 s after its step opened
   *   sa_list.late           a list that was slow did come, and when
   * Counts, known words and booleans only: no names, no ids, no children.
   */
  router.post(
    '/funnel/sa-offline',
    requireSession,
    express.text({ type: 'text/*', limit: '4kb' }),
    (req, res) => {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.prototype.hasOwnProperty.call(SA_OFFLINE_KINDS, body.k)) {
        return res.status(400).end();
      }
      const now = Date.now();
      if (!limits.take(appSessionId(req.session, req), 1, now)) return res.status(429).end();
      const pick = (v, allowed) => (allowed.includes(v) ? v : 'unknown');
      const bool = (v) => (typeof v === 'boolean' ? v : null);
      const ms = (v) => clampInt(v, 60 * 60 * 1000);
      const grade = (v) => (Number.isInteger(v) && v >= 1 && v <= 12 ? v : null);
      const { journeyId, ...base } = who(req, now);
      const props = { ...base, journeyId, feature: 'learning_assessment', browser: browserClass(req, body.b), ...micPhone(req), browserMajor: chromeMajor(req) };
      const k = body.k;
      if (k === 'prep' || k === 'prep_waiting' || k === 'list_slow') Object.assign(props, swState(body, bool));
      if (k === 'prep') {
        Object.assign(props, {
          outcome: pick(body.outcome, PREP_OUTCOMES),
          ok: body.ok === true,
          why: saWhy(body.why),
          total: clampInt(body.total, 100000),
          cached: clampInt(body.cached, 100000),
          missing: clampInt(body.missing, 100000),
          missingPaths: (Array.isArray(body.missingPaths) ? body.missingPaths : []).map(sitePath).filter(Boolean).slice(0, 5),
          missingForms: (Array.isArray(body.missingForms) ? body.missingForms : []).filter((f) => typeof f === 'string' && SA_FORM.test(f)).slice(0, 20),
          bytes: clampInt(body.bytes, 4 * 1024 * 1024 * 1024),
          forms: clampInt(body.forms, 100),
          schools: clampInt(body.schools, 500),
          listed: clampInt(body.listed, 500),
          grades: clampInt(body.grades, 12),
          elapsedMs: ms(body.elapsedMs),
          pageKept: bool(body.pageKept),
        });
      } else if (k === 'prep_waiting') {
        Object.assign(props, { phase: pick(body.phase, PREP_PHASES), done: clampInt(body.done, 100000), total: clampInt(body.total, 100000), elapsedMs: ms(body.elapsedMs) });
      } else if (k === 'list_failed') {
        const status = Number(body.status);
        Object.assign(props, {
          reason: body.reason == null ? 'none' : saWhy(body.reason),
          shown: pick(body.shown, LIST_SHOWN),
          network: bool(body.network),
          status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
          elapsedMs: ms(body.elapsedMs),
          grade: grade(body.grade),
        });
      } else if (k === 'list_slow') {
        Object.assign(props, { elapsedMs: ms(body.elapsedMs), pending: bool(body.pending), grade: grade(body.grade) });
      } else {
        Object.assign(props, { elapsedMs: ms(body.elapsedMs), grade: grade(body.grade) });
      }
      emit(SA_OFFLINE_KINDS[k], props);
      return res.status(204).end();
    },
    (err, _req, res, _next) => res.status(err && err.status === 413 ? 413 : 400).end(),
  );

  /**
   * bd-o15qnr.26 (queue #177) — the coach visit flow v2 (portal coach/flow/track.ts): what she does on the one Schedule
   * list, New visit's level chips and the Home's Today card → app_funnel.coach_flow { action, level }. Coach and journey
   * from the SESSION; only the actions below (anything else is a 400 and nothing is logged), level only from its list.
   */
  router.post(
    '/funnel/coach-flow',
    requireSession,
    express.text({ type: 'text/*', limit: '1kb' }),
    (req, res) => {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !COACH_FLOW_ACTIONS.includes(body.a)) {
        return res.status(400).end();
      }
      const now = Date.now();
      if (!limits.take(appSessionId(req.session, req), 1, now)) return res.status(429).end();
      const { journeyId, ...base } = who(req, now);
      emit('app_funnel.coach_flow', {
        ...base,
        journeyId,
        feature: 'schedule',
        browser: browserClass(req, body.b),
        action: body.a,
        level: body.a === 'new_visit.level' ? (COACH_FLOW_LEVELS.includes(body.level) ? body.level : 'unknown') : null,
      });
      return res.status(204).end();
    },
    (err, _req, res, _next) => res.status(err && err.status === 413 ? 413 : 400).end(),
  );

  return router;
}

// bd-o15qnr.26 Concept 1: observe.start = the Observe screen's "Start an observation".
// bd-o15qnr.27 (v6): observe.schedule = Observe's "Schedule an observation"; schedule.now_record / schedule.now_upload =
// "Schedule for Now"'s Start recording / Upload recording; schedule.later = "Schedule for Later"'s Schedule; home.focus =
// the Home Focus card's button; observe.booked_open = All booked opened on Observe.
const COACH_FLOW_ACTIONS = [
  'schedule.cancel_tap', 'schedule.cancel_confirm', 'schedule.start', 'new_visit.level', 'home.today_start', 'observe.start',
  'observe.schedule', 'schedule.now_record', 'schedule.now_upload', 'schedule.later', 'home.focus', 'observe.booked_open',
];
const COACH_FLOW_LEVELS = ['all', 'primary', 'middle', 'high'];


const SA_OFFLINE_KINDS = {
  prep: 'sa_prep.result', prep_waiting: 'sa_prep.still_waiting', list_failed: 'sa_list.failed', list_slow: 'sa_list.slow', list_late: 'sa_list.late',
};
const PREP_OUTCOMES = ['ready', 'partly', 'updating'];
const PREP_PHASES = ['page', 'lists', 'files'];
const LIST_SHOWN = ['problem', 'failed', 'saved_list'];
const SW_STATES = ['none', 'parsed', 'installing', 'installed', 'activating', 'activated', 'redundant'];
const SA_FORM = /^sa\.coach\.G\d{1,2}\.A\.(en|ur)$/;

/** An engine or server reason: a short snake_case word, else 'other' (a thrown message is never logged as text). */
function saWhy(v) {
  if (v == null || v === '') return null;
  return typeof v === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(v) ? v : 'other';
}

/** A same-site path without its query string (a school or visit id never reaches the log), or null. */
function sitePath(v) {
  if (typeof v !== 'string' || v[0] !== '/' || v[1] === '/') return null;
  const path = v.split(/[?#]/)[0];
  return /^\/[A-Za-z0-9._~/-]{0,160}$/.test(path) ? path : null;
}

/** The two service workers as the page saw them: the page's (/portal/leader/assess) and the engine's (/sa/). */
function swState(body, bool) {
  const script = (v) => (v === '' || v == null ? '' : (sitePath(v) || 'unknown'));
  return {
    pageSwControlled: bool(body.pageSwControlled),
    pageSwScript: script(body.pageSwScript),
    saSwScript: script(body.saSwScript),
    saSwActive: SW_STATES.includes(body.saSwActive) ? body.saSwActive : 'unknown',
    saSwWaiting: bool(body.saSwWaiting),
    saSwInstalling: bool(body.saSwInstalling),
    saSwUpdateFound: bool(body.saSwUpdateFound),
  };
}

/** Chrome's major version from the user agent (never stored), or null. */
function chromeMajor(req) {
  const m = String(req.get('user-agent') || '').slice(0, 300).match(/(?:Chrome|CriOS)\/(\d{2,3})\./);
  return m ? Number(m[1]) : null;
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

// bd-zrdvmi.21 — the lesson-plan reader's failure steps (portal lib/lpViewerReport.ts).
const LP_VIEWER_STAGES = ['download', 'reader', 'read', 'draw'];
const LP_VIEWER_LANES = ['k5', 'g612', 'paper'];
const LP_VIEWER_REASONS = ['http', 'network', 'timeout', 'abort', 'unknown'];
// bd-bmc9a0.1: 'read' + 'unreadable' — a picked file the phone could not read, before any upload.
const DC_UPLOAD_STAGES = ['pick', 'read', 'presign', 'upload', 'start'];
const DC_UPLOAD_KINDS = ['audio', 'lesson_plan', 'photo'];
const DC_UPLOAD_REASONS = ['http', 'network', 'abort', 'unknown', 'unreadable', 'not_image'];
const DC_UPLOAD_SENT_AS = ['copy', 'slice', 'blob', 'none'];
// bd-r2uzg1.9 — DOMException names a failed File read can carry (portal lib/pickedRead.ts errNameOf).
const DC_UPLOAD_ERR_NAMES = ['NotReadableError', 'NotFoundError', 'SecurityError', 'AbortError', 'InvalidStateError',
  'EncodingError', 'NotAllowedError', 'TypeError', 'Error'];
// bd-r2uzg1.9 — what a picked file is from its first bytes (portal lib/pickedRead.ts sniff).
const DC_UPLOAD_MAGIC = ['jpeg', 'png', 'webp', 'heic', 'gif', 'video', 'pdf', 'zip', 'other'];

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
  // The survey bar at the end of a lesson plan in the app: an answer saved (the route's body is never logged).
  ['POST', /^\/lp\/feedback$/, 'lp_feedback', 'lesson_plan', {}],
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

module.exports = { createAppFunnelRouter, actionLogger, logAppAction };
