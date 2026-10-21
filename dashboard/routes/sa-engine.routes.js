'use strict';
/**
 * The self-administered battery engine's files at /sa/* (switch sa_engine, app_settings; OFF by default).
 *
 * The files live in dashboard/sa/ (not public/), so nothing is reachable while the switch is off: every /sa request
 * then calls next() and the portal answers exactly as it does today. ON only when the stored value is the JSON
 * boolean true (the web_quiz_brotli rule and 30 s cache, routes/web-quiz-brotli-flag.js). Served no-cache: the
 * engine's service worker keeps the offline copy, the HTTP cache never holds a stale engine. The battery files are
 * served by name from bot/shared/data/child-test/sa/ at /sa/batteries/ (nothing else in that folder's parents).
 *
 * The sandbox-only "Jump to…" (RULING #43): only when SA_DEV_TOOLS=sandbox AND RAILWAY_ENVIRONMENT_NAME=sandbox are
 * both set does play.html / run.html load ./sa-dev.js (window.SA_DEV_TOOLS = true), ahead of the engine's scripts.
 * Otherwise the pages are the folder's own bytes and sa-dev.js is a 404, so staging and production cannot draw it.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');
const { steady } = require('./sa-switch');

const KEY = 'sa_engine';
const DIR = path.join(__dirname, '..', 'sa');
// The content lane's battery files (sa.<form>.<lang>.json), served by name at /sa/batteries/<name>.
const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const BATTERY_RX = /^sa\.(coach|game)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)?\.(en|ur)\.json$/;
const DEV_PAGES = ['play.html', 'run.html'];
const DEV_TAG = '<script src="./sa-dev.js"></script>';

/** The sandbox's dev tools: both variables, exactly 'sandbox'. Never on any other service. */
function devToolsOn(env = process.env) {
  return Boolean(env) && env.SA_DEV_TOOLS === 'sandbox' && env.RAILWAY_ENVIRONMENT_NAME === 'sandbox';
}

/** createSaEngineRouter({ on }) → router. on() is the switch (default: app_settings sa_engine). */
function createSaEngineRouter({ on: reader = createBrotliFlag({ key: KEY }), holdMs, now, env } = {}) {
  const router = express.Router();
  // The switch as routes/sa-switch.js reads it: the first request waits for the first read, and a failed read after an
  // ON never flaps a request to the portal's page.
  const on = steady(reader, { ...(holdMs != null ? { holdMs } : {}), ...(now ? { now } : {}) });
  router.use('/sa', on.warm());
  const files = express.static(DIR, {
    index: false,
    dotfiles: 'ignore',
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/sa/');
    },
  });
  // The dev tools, read per request (an env change on the sandbox service needs no new build).
  router.get(DEV_PAGES.map((p) => `/sa/${p}`), (req, res, next) => {
    if (!on() || !devToolsOn(env || process.env)) return next();
    const page = path.basename(req.path);
    return fs.readFile(path.join(DIR, page), 'utf8', (err, html) => {
      if (err) return next();
      const at = html.indexOf('<script');
      const out = at < 0 ? html.replace('</head>', `${DEV_TAG}\n</head>`) : `${html.slice(0, at)}${DEV_TAG}\n${html.slice(at)}`;
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/sa/');
      return res.type('html').send(out);
    });
  });
  router.get('/sa/sa-dev.js', (req, res, next) => {
    if (!on() || !devToolsOn(env || process.env)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('application/javascript').send('window.SA_DEV_TOOLS = true;\n');
  });
  router.get('/sa/batteries/:name', (req, res, next) => {
    if (!on() || !BATTERY_RX.test(req.params.name)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(req.params.name, { root: BATTERIES, dotfiles: 'deny' }, (err) => { if (err) next(); });
  });
  // On: a file the folder does not have (a clip not made yet, a typo) is a 404 here. Falling through would let the
  // portal answer its own page with 200, which the offline copy would keep as the "clip".
  const missing = (req, res) => res.status(404).type('text/plain').set('Cache-Control', 'no-store').send('not found');
  router.use('/sa', (req, res, next) => (on() ? files(req, res, () => missing(req, res)) : next()));
  return router;
}

module.exports = { KEY, createSaEngineRouter, devToolsOn };
