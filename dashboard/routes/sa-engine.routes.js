'use strict';
/**
 * The self-administered battery engine's files at /sa/* (switch sa_engine, app_settings; OFF by default).
 *
 * The files live in dashboard/sa/ (not public/), so nothing is reachable while the switch is off: every /sa request
 * then calls next() and the portal answers exactly as it does today. ON only when the stored value is the JSON
 * boolean true (the web_quiz_brotli rule and 30 s cache, routes/web-quiz-brotli-flag.js). Served no-cache: the
 * engine's service worker keeps the offline copy, the HTTP cache never holds a stale engine. The battery files are
 * served by name from bot/shared/data/child-test/sa/ at /sa/batteries/ (nothing else in that folder's parents).
 */
const path = require('path');
const express = require('express');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');

const KEY = 'sa_engine';
const DIR = path.join(__dirname, '..', 'sa');
// The content lane's battery files (sa.<form>.<lang>.json), served by name at /sa/batteries/<name>.
const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const BATTERY_RX = /^sa\.(coach|game)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)?\.(en|ur)\.json$/;

/** createSaEngineRouter({ on }) → router. on() is the switch (default: app_settings sa_engine). */
function createSaEngineRouter({ on = createBrotliFlag({ key: KEY }) } = {}) {
  const router = express.Router();
  // The switch's reader never waits, so on a cold portal its first answer is OFF and that one request would fall
  // through to the portal's page. Until the first read has landed, an /sa request waits for it (once per process).
  let warm = false;
  router.use('/sa', (req, res, next) => {
    if (warm || typeof on.ready !== 'function') return next();
    on();
    return Promise.resolve(on.ready()).then(() => { warm = true; next(); }, () => { warm = true; next(); });
  });
  const files = express.static(DIR, {
    index: false,
    dotfiles: 'ignore',
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/sa/');
    },
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

module.exports = { KEY, createSaEngineRouter };
