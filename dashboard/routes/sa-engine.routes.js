'use strict';
/**
 * The self-administered battery engine's files at /sa/* (switch sa_engine, app_settings; OFF by default).
 *
 * The files live in dashboard/sa/ (not public/), so nothing is reachable while the switch is off: every /sa request
 * then calls next() and the portal answers exactly as it does today. ON only when the stored value is the JSON
 * boolean true (the web_quiz_brotli rule and 30 s cache, routes/web-quiz-brotli-flag.js). Served no-cache: the
 * engine's service worker keeps the offline copy, the HTTP cache never holds a stale engine.
 */
const path = require('path');
const express = require('express');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');

const KEY = 'sa_engine';
const DIR = path.join(__dirname, '..', 'sa');

/** createSaEngineRouter({ on }) → router. on() is the switch (default: app_settings sa_engine). */
function createSaEngineRouter({ on = createBrotliFlag({ key: KEY }) } = {}) {
  const router = express.Router();
  const files = express.static(DIR, {
    index: false,
    dotfiles: 'ignore',
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Service-Worker-Allowed', '/sa/');
    },
  });
  router.use('/sa', (req, res, next) => (on() ? files(req, res, next) : next()));
  return router;
}

module.exports = { KEY, createSaEngineRouter };
