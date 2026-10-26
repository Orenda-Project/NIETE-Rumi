'use strict';
/**
 * bd-sex15q.13 — COACHIP, the coach and RM insight portal: every /api/portal/coachip/* route (contracts/API.md,
 * contracts/routes.json; SPEC v2 §1-§3, §8). Dark by default: with no app_settings row every route answers 404
 * except GET /coachip/me, which answers 200 with nulls (B8).
 *
 * Guard chain, in this order, on every route except /me (API.md §1):
 *   requirePortalAuth   signed out → 401 (the house body)
 *   coachipLeaderGate   not in the leader family → 404 (not the house 403: a teacher must not learn the area exists, A1)
 *   requireCoachip(k)   k = coach | rm | either; switch off for this user → 404; a flag read error is off
 *   coachipScope        req.coachip = { coach: CoachScope|null, rm: RmScope|null }, computed once per request
 * then, per route: path/query/body grammar → 400 {"error":"bad_request"}; then the handler, which checks the
 * resource's scope (one 404 body for "not yours" and "does not exist", B3).
 *
 * Every answer carries Cache-Control: private, no-store. Nothing here takes a teacher key, code, name or users.id of a
 * teacher in a path or query (B1, B21): code_id travels only in POST bodies. The two media streams are m-player's,
 * registered through deps.mediaRoutes with these same guards.
 */
const express = require('express');
const { isLeaderRole } = require('../lib/leader-role');
const S = require('../services/coachip-shapes');

const NOT_AUTHED = S.BODIES[401];
const send = (res, answer) => res.status(answer.status).json(answer.body);

/** The house sign-in check (dashboard/lib/fln-access.js requirePortalAuth), with the house 401 body. */
function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) return res.status(401).json(NOT_AUTHED);
  return next();
}

// ── body and query grammar (API.md §2): exact keys, typed values; anything else is 400 ─────────────────────────
const V = {
  uuid: (v) => S.isUuid(v),
  'uuid?': (v) => v === null || S.isUuid(v),
  w_id: (v) => S.isWId(v),
  i_id: (v) => S.isIId(v),
  template_id: (v) => typeof v === 'string' && S.TEMPLATE_RX.test(v),
  school_ids: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every(S.isUuid) && new Set(v.map((x) => x.toLowerCase())).size === v.length,
  date28: (v, ctx) => S.isIsoDate(v) && v >= ctx.today && v <= S.addDays(ctx.today, 28),
  coach_tick: (v) => v === 'yes' || v === 'no',
  step_status: (v) => v === 'completed' || v === 'deferred' || v === 'cancelled',
  note_status: (v) => v === 'seen' || v === 'dismissed',
};
const BODY = {
  createStep: { code_id: 'uuid', school_id: 'uuid', w_id: 'w_id', i_id: 'i_id', source_session_id: 'uuid?', rm_note_id: 'uuid?' },
  tickStep: { coach_tick: 'coach_tick' },
  stepStatus: { status: 'step_status' },
  noteStatus: { status: 'note_status' },
  teacherName: { code_id: 'uuid' },
  rmNote: { coach_user_id: 'uuid', template_id: 'template_id', w_id: 'w_id', school_ids: 'school_ids', due_on: 'date28' },
  rmStep: { i_id: 'i_id', w_id: 'w_id', date: 'date28' },
};
function bodyOk(spec, body, ctx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  const want = Object.keys(spec);
  if (keys.length !== want.length || !want.every((k) => Object.prototype.hasOwnProperty.call(body, k))) return false;
  return want.every((k) => V[spec[k]](body[k], ctx));
}
/** R5's ?week: a Karachi Monday, not after this week's, not before the Monday 7 weeks earlier. */
function weekOk(v, today) {
  if (!S.isIsoDate(v) || S.weekdayOf(v) !== 1) return false;
  const thisMonday = S.mondayOf(today);
  return v <= thisMonday && v >= S.addDays(thisMonday, -49);
}

/**
 * @param {object} deps
 * @param {Function} deps.query      pg-shaped query(sql, params) → {rows} (dashboard/config/database)
 * @param {Function} [deps.tx]       tx(async (q) => …) runs q in one transaction; default: pool.connect via deps.pool
 * @param {object} deps.flags        { coachOn(uid), rmSector(uid), decodeOn(uid) } (fail-closed readers)
 * @param {object} deps.scope        createCoachipScope(...) — coachScope, rmScope, inScope, circleAllows
 * @param {object} deps.codes        createCoachipCodes(...) — ready, teacherKey, codeFor, keyFor, audit
 * @param {Function} [deps.mediaRoutes] (router, guards) => void — m-player's two media streams
 * @param {Function} [deps.now]      () => Date (tests pin the clock)
 * @param {object} [deps.handlers]   override the route handlers (tests)
 */
function createCoachipRouter(deps) {
  const {
    query, flags, scope, codes, mediaRoutes, now = () => new Date(),
  } = deps;
  const tx = deps.tx || (deps.pool ? poolTx(deps.pool) : null);
  const handlers = { ...defaultHandlers(), ...(deps.handlers || {}) };
  const router = express.Router();

  router.use('/coachip', (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

  async function loadUser(uid) {
    const { rows } = await query('SELECT id, role, preferred_language FROM users WHERE id = $1 AND deleted_at IS NULL', [uid]);
    return rows[0] || null;
  }

  async function coachipLeaderGate(req, res, next) {
    try {
      const user = await loadUser(req.session.portalUserId);
      if (!user || !isLeaderRole(user.role)) return send(res, S.NOT_FOUND());
      req.portalUser = user;
      return next();
    } catch (err) {
      console.error('[coachip] leader gate failed:', err.message);
      return send(res, S.reply(500, S.BODIES[500]));
    }
  }

  const safe = async (fn) => { try { return await fn(); } catch (_) { return null; } };
  function requireCoachip(kind) {
    return async function requireCoachipSwitch(req, res, next) {
      const uid = req.session.portalUserId;
      const [coachOn, sector] = await Promise.all([
        kind === 'rm' ? false : safe(() => flags.coachOn(uid)),
        kind === 'coach' ? null : safe(() => flags.rmSector(uid)),
      ]);
      const on = { coach: coachOn === true, sector: typeof sector === 'string' ? sector : null };
      if (kind === 'coach' && !on.coach) return send(res, S.NOT_FOUND());
      if (kind === 'rm' && !on.sector) return send(res, S.NOT_FOUND());
      if (kind === 'either' && !on.coach && !on.sector) return send(res, S.NOT_FOUND());
      // A13: no codec secret → the coach side answers 503, never an unkeyed hash.
      if (on.coach && kind !== 'rm' && !codes.ready()) {
        if (kind === 'coach' || !on.sector) return send(res, S.reply(503, S.BODIES['503_codec']));
        on.coach = false;
      }
      req.coachipOn = on;
      return next();
    };
  }

  function coachipScope(req, res, next) {
    const uid = req.session.portalUserId;
    const on = req.coachipOn;
    Promise.all([
      on.coach ? scope.coachScope(uid) : null,
      on.sector ? scope.rmScope(uid, on.sector) : null,
    ]).then(([coach, rm]) => {
      req.coachip = { coach, rm };
      next();
    }, (err) => {
      console.error('[coachip] scope failed:', err.message);
      send(res, S.reply(500, S.BODIES[500]));
    });
  }

  const chain = (kind) => [requirePortalAuth, coachipLeaderGate, requireCoachip(kind), coachipScope];
  const json = express.json({ limit: '4kb', strict: true });

  /**
   * One route: chain(kind) → grammar (params, query, body) → handler. `opts.scopeless` lets the handler answer for a
   * coach with no scope (R2's no_scope state); every other coach route is 404 without one, and an RM route without
   * an RmScope is 404.
   */
  function route(method, path, kind, name, opts = {}) {
    const mw = [...chain(kind)];
    if (method === 'post') mw.push(json);
    router[method](path, ...mw, async (req, res) => {
      const ctx = context(req, kind);
      if (!grammarOk(req, ctx, opts)) return send(res, S.BAD());
      if (kind === 'coach' && !ctx.coach && !opts.scopeless) return send(res, S.NOT_FOUND());
      if (kind === 'rm' && !ctx.rm) return send(res, S.NOT_FOUND());
      if (kind === 'either' && !ctx.coach && !ctx.rm) return send(res, S.NOT_FOUND());
      try {
        return send(res, await handlers[name](ctx));
      } catch (err) {
        if (err instanceof S.HttpAnswer) return send(res, err.answer);
        console.error(`[coachip] ${name} failed:`, err.message);
        return send(res, S.reply(500, S.BODIES[500]));
      }
    });
  }

  function context(req, kind) {
    const at = now();
    const user = req.portalUser;
    return {
      uid: req.session.portalUserId,
      user,
      lang: user && user.preferred_language === 'ur' ? 'ur' : 'en',
      kind,
      coach: req.coachip ? req.coachip.coach : null,
      rm: req.coachip ? req.coachip.rm : null,
      params: req.params,
      query: req.query,
      body: req.body,
      now: at,
      today: S.karachiDay(at),
      deps: { query, tx, scope, codes, flags, now },
    };
  }

  function grammarOk(req, ctx, opts) {
    const p = req.params || {};
    for (const [k, v] of Object.entries(p)) {
      if (k === 'wId' ? !S.isWId(v) : !S.isUuid(v)) return false;
    }
    if (opts.query) {
      for (const [k, rule] of Object.entries(opts.query)) {
        const v = req.query[k];
        if (v === undefined) continue;
        if (typeof v !== 'string') return false;
        if (rule === 'w_or_good' && !(v === 'good' || S.isWId(v))) return false;
        if (rule === 'week' && !weekOk(v, ctx.today)) return false;
        if (rule === 'uuid' && !S.isUuid(v)) return false;
      }
    }
    if (opts.body && !bodyOk(BODY[opts.body], req.body, ctx)) return false;
    return true;
  }

  // ── R1 GET /coachip/me: requirePortalAuth only (A2); the one route that answers 200 with every switch off ──
  router.get('/coachip/me', requirePortalAuth, async (req, res) => {
    const uid = req.session.portalUserId;
    let user = null;
    try { user = await loadUser(uid); } catch (err) { console.error('[coachip] me user failed:', err.message); }
    const lang = user && user.preferred_language === 'ur' ? 'ur' : 'en';
    const body = { coach: null, rm: null, decode: false, lang, computed_at: S.isoTime(now()) };
    if (!user || !isLeaderRole(user.role)) return res.json(body);
    const [coachOn, sector, decodeOn] = await Promise.all([
      safe(() => flags.coachOn(uid)), safe(() => flags.rmSector(uid)), safe(() => flags.decodeOn(uid)),
    ]);
    if (coachOn === true && codes.ready()) {
      try {
        const c = await scope.coachScope(uid);
        if (c) body.coach = { schoolCount: c.schoolCount, teacherCount: c.teacherCount };
      } catch (err) { console.error('[coachip] me coach scope failed:', err.message); }
    }
    if (typeof sector === 'string') {
      try {
        const r = await scope.rmScope(uid, sector);
        if (r) body.rm = { sector: r.sector, schoolCount: r.schoolIds.length, coachCount: r.coachUserIds.length };
      } catch (err) { console.error('[coachip] me rm scope failed:', err.message); }
    }
    body.decode = decodeOn === true && body.coach !== null;
    return res.json(body);
  });

  // m-player's media streams register first, with the same guards (API.md §1; R7, R8).
  if (typeof mediaRoutes === 'function') {
    mediaRoutes(router, { either: chain('either'), coach: chain('coach') });
  } else {
    // Until m-player's module is deployed the two streams still sit behind the full chain (off → the one 404), and
    // answer what API.md §1 says when nothing can serve the bytes. Never a URL, never express's HTML 404.
    router.get('/coachip/m/:momentId/clip', ...chain('either'), (req, res) => send(res, S.isUuid(req.params.momentId) ? S.reply(503, { error: 'clip_unavailable' }) : S.BAD()));
    router.get('/coachip/session/:sessionId/audio', ...chain('coach'), (req, res) => send(res, S.isUuid(req.params.sessionId) ? S.reply(503, { error: 'audio_unavailable' }) : S.BAD()));
  }

  // ── coach (API.md §7) ──
  route('get', '/coachip/home', 'coach', 'home', { scopeless: true });
  route('get', '/coachip/w/:wId', 'coach', 'weakness');
  route('get', '/coachip/schools', 'coach', 'schools');
  route('get', '/coachip/moments', 'coach', 'moments', { query: { w: 'w_or_good', week: 'week' } });
  route('get', '/coachip/m/:momentId', 'either', 'moment');
  route('get', '/coachip/i/:wId', 'coach', 'intervention', { query: { school: 'uuid' } });
  route('post', '/coachip/steps', 'coach', 'createStep', { body: 'createStep' });
  route('post', '/coachip/steps/:stepId/tick', 'coach', 'tickStep', { body: 'tickStep' });
  route('post', '/coachip/steps/:stepId/status', 'coach', 'stepStatus', { body: 'stepStatus' });
  route('post', '/coachip/notes/:noteId/status', 'coach', 'noteStatus', { body: 'noteStatus' });
  route('get', '/coachip/stats', 'coach', 'stats');
  route('get', '/coachip/results', 'coach', 'results');
  route('post', '/coachip/teacher-name', 'coach', 'teacherName', { body: 'teacherName' });
  // ── RM (API.md §9) ──
  route('get', '/coachip/rm/home', 'rm', 'rmHome');
  route('get', '/coachip/rm/coach/:coachUserId', 'rm', 'rmCoach');
  route('post', '/coachip/rm/notes', 'rm', 'rmNote', { body: 'rmNote' });
  route('get', '/coachip/rm/circle', 'rm', 'rmCircle');
  route('post', '/coachip/rm/steps', 'rm', 'rmStep', { body: 'rmStep' });

  // Any other /coachip path: the house 401 signed out, else the one 404 (never express's HTML page, never another router).
  router.all('/coachip/*', requirePortalAuth, (req, res) => send(res, S.NOT_FOUND()));

  // A body that is not JSON or is over 4 kB is a 400 like any other malformed request (never express's HTML page).
  // eslint-disable-next-line no-unused-vars
  router.use('/coachip', (err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.status === 400 || err.status === 413)) {
      return send(res, S.BAD());
    }
    console.error('[coachip] request failed:', err && err.message);
    return send(res, S.reply(500, S.BODIES[500]));
  });

  return router;
}

/** tx(fn): BEGIN, fn(q) with q bound to one client, COMMIT; ROLLBACK and rethrow on any error. */
function poolTx(pool) {
  return async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn((sql, params) => client.query(sql, params));
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection gone */ }
      throw err;
    } finally {
      client.release();
    }
  };
}

function defaultHandlers() {
  const coach = require('../services/coachip-coach-read.service');
  const listen = require('../services/coachip-listen-read.service');
  const rm = require('../services/coachip-rm-read.service');
  const write = require('../services/coachip-write.service');
  return {
    home: coach.home,
    weakness: coach.weakness,
    schools: coach.schools,
    intervention: coach.intervention,
    moments: listen.moments,
    moment: listen.moment,
    stats: listen.stats,
    results: listen.results,
    rmHome: rm.rmHome,
    rmCoach: rm.rmCoach,
    rmCircle: rm.rmCircle,
    createStep: write.createStep,
    tickStep: write.tickStep,
    stepStatus: write.stepStatus,
    noteStatus: write.noteStatus,
    teacherName: write.teacherName,
    rmNote: write.rmNote,
    rmStep: write.rmStep,
  };
}

/**
 * The production wiring (dashboard/index.js): the pg pool, the fail-closed flag readers over supabase, and the two
 * services. Kept here so index.js carries one line.
 */
function createCoachipRouterFromEnv({ pool, supabase, mediaRoutes } = {}) {
  const { isFlagEnabledForUser, rmSectorFor, PORTAL_COACHIP_KEY, PORTAL_COACHIP_DECODE_KEY } = require('../lib/feature-flags');
  const { createCoachipScope } = require('../services/coachip-scope.service');
  const { createCoachipCodes } = require('../services/coachip-codes.service');
  const query = (sql, params) => pool.query(sql, params);
  const codes = createCoachipCodes({ query, secret: process.env.COACHIP_TEACHER_KEY_SECRET });
  const scope = createCoachipScope({ query, codes });
  const flags = {
    coachOn: (uid) => isFlagEnabledForUser(supabase, PORTAL_COACHIP_KEY, uid),
    rmSector: (uid) => rmSectorFor(supabase, uid),
    decodeOn: (uid) => isFlagEnabledForUser(supabase, PORTAL_COACHIP_DECODE_KEY, uid),
  };
  const router = createCoachipRouter({
    query, pool, flags, scope, codes,
    mediaRoutes: typeof mediaRoutes === 'function' ? mediaRoutes({ query, scope, codes }) : undefined,
  });
  return { router, scope, codes };
}

module.exports = { createCoachipRouter, createCoachipRouterFromEnv, requirePortalAuth, BODY, weekOk };
