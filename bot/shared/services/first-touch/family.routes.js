'use strict';
/**
 * The family door's four routes, mounted by the maker's router (maker.routes.js, its marked slot) with ONE line:
 *
 *   require('./family.routes').mount(router);
 *
 *   GET  /f/:token            the family door page
 *   GET  /f/:token/teacher    302 → the chat with the teacher claim phrase (the countable escape)
 *   POST /api/ft/code         a QUIZ- code → 302 /q/<code>; anything else → the page with fd.bad
 *   POST /api/ft/door         "Change my choice" (maker token only) → the child key → 302 /f/<family token>
 *
 * Limits and body caps follow the web quiz edge's /q/ routes (dashboard/routes/web-quiz.routes.js): one-minute
 * windows keyed by the caller's address, `read` (300) on the pages, `session` (60) on the two posts, and a
 * failed-code limiter (20, only refusals counted) like the edge's `unknownCode`; express-rate-limit is required here,
 * where the router is built, and a missing package leaves the routes unthrottled rather than unmounted. Bodies are
 * a plain HTML form (urlencoded) or JSON, 4 kB; a body that is too large or not parseable answers the page, never 500.
 * Handlers: family.door.js.
 */
const express = require('express');
const Family = require('./family.door');

const BODY_LIMIT = '4kb';
const WINDOW_MS = 60 * 1000;

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

const pass = (req, res, next) => next();

function slowDown(req, res) {
  const built = Family.buildPlainPage({ lang: /^\s*ur\b/i.test(String(req.get('accept-language') || '')) ? 'ur' : 'en', id: 'mk.error' });
  res.set({ 'Cache-Control': 'no-store', 'Retry-After': '60' });
  return res.status(429).type('html').send(built.html);
}

/** { read, session, badCode } — express-rate-limit when it loads, else pass-through. */
function makeLimiters() {
  let rateLimit;
  try { rateLimit = require('express-rate-limit'); } catch (_) { return { read: pass, session: pass, badCode: pass }; }
  const common = { windowMs: WINDOW_MS, standardHeaders: true, legacyHeaders: false, validate: false, handler: slowDown };
  return {
    read: rateLimit({ ...common, max: 300, keyGenerator: (req) => `ft-r:${clientIp(req)}` }),
    session: rateLimit({ ...common, max: 60, keyGenerator: (req) => `ft-s:${clientIp(req)}` }),
    // A refused code is what a guesser produces: count only answers that did not redirect to /q/.
    badCode: rateLimit({ ...common, max: 20, keyGenerator: (req) => `ft-u:${clientIp(req)}`,
      skipSuccessfulRequests: true, requestWasSuccessful: (req, res) => res.statusCode === 302 }),
  };
}

const wrap = (fn) => (req, res) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(() => {
      if (res.headersSent) return;
      const built = Family.buildPlainPage({ lang: 'en', id: 'mk.error' });
      res.status(200).type('html').send(built.html);
    });
};

/**
 * Registers the four routes on `router`. `opts.limiters` replaces the rate limiters (tests pass pass-through ones).
 * Returns the router.
 */
function mount(router, opts = {}) {
  const lim = { ...makeLimiters(), ...(opts.limiters || {}) };
  const form = express.urlencoded({ extended: false, limit: BODY_LIMIT });
  const json = express.json({ limit: BODY_LIMIT, type: ['application/json', 'text/plain'] });

  router.get('/f/:token', lim.read, wrap(Family.handleGetFamily));
  router.get('/f/:token/teacher', lim.read, wrap(Family.handleTeacherLink));
  router.post('/api/ft/code', lim.session, lim.badCode, form, json, wrap(Family.handlePostCode));
  router.post('/api/ft/door', lim.session, form, json, wrap(Family.handlePostDoor));

  // A body too large or not parseable: the code box answers its page with fd.bad, the door its refusal. Never a 500.
  router.use('/api/ft/code', (err, req, res, next) => {
    if (!err || res.headersSent) return next(err);
    req.body = {};
    return Family.handlePostCode(req, res);
  });
  router.use('/api/ft/door', (err, req, res, next) => {
    if (!err || res.headersSent) return next(err);
    req.body = {};
    return Family.handlePostDoor(req, res);
  });
  return router;
}

module.exports = { mount, BODY_LIMIT };
