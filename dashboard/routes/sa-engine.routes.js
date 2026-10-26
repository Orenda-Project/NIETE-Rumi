'use strict';
/**
 * The self-administered battery engine's files at /sa/* (switch sa_engine, app_settings; OFF by default).
 *
 * The files live in dashboard/sa/ (not public/), so nothing is reachable while the switch is off: every /sa request
 * then calls next() and the portal answers exactly as it does today. ON only when the stored value is the JSON
 * boolean true (the web_quiz_brotli rule and 30 s cache, routes/web-quiz-brotli-flag.js). Served no-cache: the
 * engine's service worker keeps the offline copy, the HTTP cache never holds a stale engine. The battery files are
 * served by name from bot/shared/data/child-test/sa/ at /sa/batteries/ (nothing else in that folder's parents), with the
 * content switches applied (routes/sa-battery-switches.js: sa_practice_all_maths, sa_passage_rotation, and Wave 3's
 * sa_one_at_a_time, sa_passage_punct, sa_rdf_manual, sa_rdf_w3_forms, sa_voice_gate_v2).
 *
 * The sandbox-only "Jump to…" (RULING #43): only when SA_DEV_TOOLS=sandbox AND RAILWAY_ENVIRONMENT_NAME=sandbox are
 * both set does play.html / run.html load ./sa-dev.js (window.SA_DEV_TOOLS = true), ahead of the engine's scripts.
 * Otherwise the pages are the folder's own bytes and sa-dev.js is a 404, so staging and production cannot draw it.
 *
 * Switch sa_voice_v2 (app_settings, OFF by default): ON, a battery is served with its clip keys under sa/v2/ instead of
 * sa/v1/ (the second voice set: one South Asian voice per language), so the phone fetches and keeps the new clips under
 * new addresses. OFF, or a failed read, the battery is served exactly as before.
 *
 * Switch sa_voice_tashdeed (app_settings, OFF by default; round 4): ON with sa_voice_v2, an Urdu key that has a tashdeed
 * take (sa/v3/ur/<key>.mp3: the same voice given the narration with its doubled letters marked) is served from
 * sa/v3/ur/; every other key stays where sa_voice_v2 puts it. OFF, or sa_voice_v2 OFF, nothing changes.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createBrotliFlag } = require('./web-quiz-brotli-flag');
const { steady } = require('./sa-switch');
const { SWITCHES, applySwitches } = require('./sa-battery-switches');

const KEY = 'sa_engine';
const VOICE_V2_KEY = 'sa_voice_v2';
const VOICE_TASHDEED_KEY = 'sa_voice_tashdeed';
const DIR = path.join(__dirname, '..', 'sa');
// The content lane's battery files (sa.<form>.<lang>.json), served by name at /sa/batteries/<name>.
const BATTERIES = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const BATTERY_RX = /^sa\.(coach|game)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)?\.(en|ur)\.json$/;
const DEV_PAGES = ['play.html', 'run.html'];
const DEV_TAG = '<script src="./sa-dev.js"></script>';

/** The tashdeed takes on disk (sa/v3/ur/<12 hex>.mp3), by file name; none when the folder is missing. */
function tashdeedTakes(dir = path.join(DIR, 'v3', 'ur')) {
  try { return new Set(fs.readdirSync(dir).filter((n) => /^[0-9a-f]{12}\.mp3$/.test(n))); } catch (_) { return new Set(); }
}

/** The sandbox's dev tools: both variables, exactly 'sandbox'. Never on any other service. */
function devToolsOn(env = process.env) {
  return Boolean(env) && env.SA_DEV_TOOLS === 'sandbox' && env.RAILWAY_ENVIRONMENT_NAME === 'sandbox';
}

/** A reader that throws (a failed read) answers OFF, so warming it never fails a request. */
function safe(read) {
  const out = () => { try { return read(); } catch (_) { return false; } };
  if (typeof read.ready === 'function') out.ready = () => read.ready();
  return out;
}

/**
 * createSaEngineRouter({ on, practiceAllMaths, env }) → router. on() is the switch (default: app_settings sa_engine);
 * practiceAllMaths() and passageRotation() the content switches (app_settings sa_practice_all_maths, sa_passage_rotation);
 * voiceV2() the voice set's (app_settings sa_voice_v2); voiceTashdeed() the Urdu tashdeed takes' (sa_voice_tashdeed).
 */
function createSaEngineRouter({ on: reader = createBrotliFlag({ key: KEY }), practiceAllMaths: practiceReader = createBrotliFlag({ key: SWITCHES.practiceAllMaths }),
  passageRotation: rotationReader = createBrotliFlag({ key: SWITCHES.passageRotation }), voiceV2: voiceReader = createBrotliFlag({ key: VOICE_V2_KEY }),
  oneAtATime: cellReader = createBrotliFlag({ key: SWITCHES.oneAtATime }), passagePunct: punctReader = createBrotliFlag({ key: SWITCHES.passagePunct }),
  rdfManual: manualReader = createBrotliFlag({ key: SWITCHES.rdfManual }), rdfW3Forms: rdfW3Reader = createBrotliFlag({ key: SWITCHES.rdfW3Forms }),
  voiceGateV2: gateReader = createBrotliFlag({ key: SWITCHES.voiceGateV2 }),
  compAllQuestions: compReader = createBrotliFlag({ key: SWITCHES.compAllQuestions }),
  cellPace: paceReader = createBrotliFlag({ key: SWITCHES.cellPace }),
  sectionRecording: sectionReader = createBrotliFlag({ key: SWITCHES.sectionRecording }),
  coachLastWord: lastWordReader = createBrotliFlag({ key: SWITCHES.coachLastWord }),
  cellNextOnly: nextOnlyReader = createBrotliFlag({ key: SWITCHES.cellNextOnly }),
  autoChildLastWord: childLastWordReader = createBrotliFlag({ key: SWITCHES.autoChildLastWord }),
  appAsks: appAsksReader = createBrotliFlag({ key: SWITCHES.appAsks }),
  urFit: urFitReader = createBrotliFlag({ key: SWITCHES.urFit }),
  autoNoLastWord: noLastWordReader = createBrotliFlag({ key: SWITCHES.autoNoLastWord }),
  voiceTashdeed: tashdeedReader = createBrotliFlag({ key: VOICE_TASHDEED_KEY }),
  holdMs, now, env } = {}) {
  const router = express.Router();
  // The switch as routes/sa-switch.js reads it: the first request waits for the first read, and a failed read after an
  // ON never flaps a request to the portal's page. The content and voice switches are read the same way, so the first
  // battery after a restart carries their stored values (the engine keeps that battery offline for the session).
  const hold = { ...(holdMs != null ? { holdMs } : {}), ...(now ? { now } : {}) };
  const on = steady(reader, hold);
  const practiceAllMaths = steady(safe(practiceReader), hold);
  const passageRotation = steady(safe(rotationReader), hold);
  const voiceV2 = steady(safe(voiceReader), hold);
  const oneAtATime = steady(safe(cellReader), hold);
  const passagePunct = steady(safe(punctReader), hold);
  const rdfManual = steady(safe(manualReader), hold);
  const rdfW3Forms = steady(safe(rdfW3Reader), hold);
  const voiceGateV2 = steady(safe(gateReader), hold);
  const compAllQuestions = steady(safe(compReader), hold);
  const cellPace = steady(safe(paceReader), hold);
  const sectionRecording = steady(safe(sectionReader), hold);
  const coachLastWord = steady(safe(lastWordReader), hold);
  const cellNextOnly = steady(safe(nextOnlyReader), hold);
  const autoChildLastWord = steady(safe(childLastWordReader), hold);
  const appAsks = steady(safe(appAsksReader), hold);
  const urFit = steady(safe(urFitReader), hold);
  const autoNoLastWord = steady(safe(noLastWordReader), hold);
  const voiceTashdeed = steady(safe(tashdeedReader), hold);
  const takes = tashdeedTakes();
  router.use('/sa', on.warm(), practiceAllMaths.warm(), passageRotation.warm(), voiceV2.warm(), oneAtATime.warm(), passagePunct.warm(), rdfManual.warm(),
    rdfW3Forms.warm(), voiceGateV2.warm(), compAllQuestions.warm(), cellPace.warm(), sectionRecording.warm(), coachLastWord.warm(), cellNextOnly.warm(),
    autoChildLastWord.warm(), appAsks.warm(), urFit.warm(), autoNoLastWord.warm(), voiceTashdeed.warm());
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
    return fs.readFile(path.join(BATTERIES, req.params.name), 'utf8', (err, text) => {
      if (err) return next();
      let battery;
      try { battery = JSON.parse(text); } catch (_) { return next(); }
      res.setHeader('Cache-Control', 'no-cache');
      const out = applySwitches(battery, {
        practiceAllMaths: practiceAllMaths() === true, passageRotation: passageRotation() === true,
        oneAtATime: oneAtATime() === true, passagePunct: passagePunct() === true, rdfManual: rdfManual() === true,
        rdfW3Forms: rdfW3Forms() === true, voiceGateV2: voiceGateV2() === true, compAllQuestions: compAllQuestions() === true,
        cellPace: cellPace() === true, sectionRecording: sectionRecording() === true,
        coachLastWord: coachLastWord() === true, cellNextOnly: cellNextOnly() === true, autoChildLastWord: autoChildLastWord() === true,
        appAsks: appAsks() === true,
        urFit: urFit() === true,
        autoNoLastWord: autoNoLastWord() === true,
      });
      let v2 = false;
      try { v2 = voiceV2() === true; } catch (_) { v2 = false; }
      if (!v2) return res.json(out);
      let tashdeed = false;
      try { tashdeed = voiceTashdeed() === true; } catch (_) { tashdeed = false; }
      const moved = JSON.stringify(out).replace(/"sa\/v1\/(en|ur)\//g, '"sa/v2/$1/');
      return res.type('json').send(!tashdeed ? moved
        : moved.replace(/"sa\/v2\/ur\/([0-9a-f]{12}\.mp3)"/g, (m, n) => (takes.has(n) ? `"sa/v3/ur/${n}"` : m)));
    });
  });
  // On: a file the folder does not have (a clip not made yet, a typo) is a 404 here. Falling through would let the
  // portal answer its own page with 200, which the offline copy would keep as the "clip".
  const missing = (req, res) => res.status(404).type('text/plain').set('Cache-Control', 'no-store').send('not found');
  router.use('/sa', (req, res, next) => (on() ? files(req, res, () => missing(req, res)) : next()));
  return router;
}

module.exports = { KEY, VOICE_V2_KEY, VOICE_TASHDEED_KEY, createSaEngineRouter, devToolsOn };
