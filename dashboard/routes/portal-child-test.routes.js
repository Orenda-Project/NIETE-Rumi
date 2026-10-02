/**
 * bd-s1oo0.7 (L7) — the child test in the coach app.
 *
 * Mounted at /api/portal/leader/child-test by dashboard/index.js. On WhatsApp a
 * coach cannot show the child an opened card and record at once; the app page
 * (portal/src/portal/pages/LeaderChildTest.tsx) can. These routes hold NO
 * child-test logic: each relays to the bot (services/portal-child-test.client.js)
 * with the SESSION user, never one from the request.
 *
 *   GET  /visits                      today's observe2 visits by this coach
 *   GET  /list?visitId=               today's five children (the server's draw; no redraws)
 *   POST /outcome                     { visitId, drawId, outcome: present|absent|refused, note? }
 *   GET  /session/:id                 per block: media in, AI status, check prefill
 *   GET  /session/:id/card/:block     the child's card (no answer keys)
 *   POST /session/:id/presign         { block, kind: audio|photo, contentType, sizeBytes } → R2 PUT url
 *   POST /session/:id/media           { block, audioKey?, photoKey?, timing? } → attached, scoring started
 *   POST /session/:id/check           { block, coachMarks } → stored next to the AI's marks
 *
 * GATES, in order: a portal session (401), the leader family (403), and the
 * `portal_child_test` app_settings flag — true, or a pilot list of user ids
 * (404 when off, the same answer as a route that does not exist). The bot adds
 * its own CHILD_TEST_ENABLED gate behind these.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { makeRequireLeaderRole } = require('../lib/leader-role');
const { isFlagEnabledForUser, PORTAL_CHILD_TEST_KEY } = require('../lib/feature-flags');
const Client = require('../services/portal-child-test.client');

const router = express.Router();

function requirePortalAuth(req, res, next) {
  if (!req.session || !req.session.portalUserId) {
    return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
  }
  return next();
}

async function getUserById(userId) {
  const { data, error } = await supabase.from('users').select('id, role').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

const requireLeaderRole = makeRequireLeaderRole({ getUser: getUserById });

async function requireChildTest(req, res, next) {
  const on = await isFlagEnabledForUser(supabase, PORTAL_CHILD_TEST_KEY, req.session && req.session.portalUserId);
  if (!on) return res.status(404).json({ success: false, error: 'Not found' });
  return next();
}

const gates = [requirePortalAuth, requireLeaderRole, requireChildTest];

function pick(src, fields) {
  const out = {};
  for (const f of fields) if (src && src[f] !== undefined) out[f] = src[f];
  return out;
}

/** Relay to the bot. A throw (unconfigured / unreachable / 5xx) is a 502. */
function relay(path, build) {
  return async (req, res) => {
    const body = { userId: req.session.portalUserId, ...build(req) };
    try {
      const { httpStatus, body: answer } = await Client.call(path, body);
      if (httpStatus >= 500) throw new Error(`bot answered ${httpStatus}`);
      return res.status(httpStatus).json(answer);
    } catch (error) {
      console.error(`Portal child-test ${path} failed:`, error.message);
      return res.status(502).json({ success: false, error: 'Could not reach Rumi. Please try again.' });
    }
  };
}

router.get('/visits', ...gates, relay('visits', () => ({})));
router.get('/list', ...gates, relay('list', (req) => pick(req.query, ['visitId'])));
router.post('/outcome', ...gates, relay('outcome', (req) => pick(req.body, ['visitId', 'drawId', 'outcome', 'note'])));
router.get('/session/:id', ...gates, relay('session', (req) => ({ sessionId: req.params.id })));
router.get('/session/:id/card/:block', ...gates, relay('card', (req) => ({ sessionId: req.params.id, block: req.params.block })));
router.post('/session/:id/presign', ...gates, relay('presign', (req) => ({
  sessionId: req.params.id, ...pick(req.body, ['block', 'kind', 'contentType', 'sizeBytes']),
})));
router.post('/session/:id/media', ...gates, relay('media', (req) => ({
  sessionId: req.params.id, ...pick(req.body, ['block', 'audioKey', 'photoKey', 'timing']),
})));
router.post('/session/:id/check', ...gates, relay('check', (req) => ({
  sessionId: req.params.id, ...pick(req.body, ['block', 'coachMarks']),
})));

module.exports = router;
