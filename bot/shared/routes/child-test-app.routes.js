/**
 * bd-s1oo0.7 (L7) — /api/internal/child-test/* : the coach app's child test.
 *
 * The portal relays here (dashboard/services/portal-child-test.client.js) with
 * the userId read from ITS session. These routes add no logic: each delegates to
 * services/child-test/app/app-api.service.js and maps its status to HTTP.
 * Mounted from internal-api.routes.js; the router checks the internal key itself
 * so it is never open, however it is mounted.
 *
 * FAIL CLOSED. Any status that is not 'ok' is a 4xx/5xx with success:false, so
 * the portal can never read a failed save as saved.
 */

const express = require('express');
const { logToFile, logError } = require('../utils/logger');

const HTTP = {
  ok: 200,
  invalid: 400,
  not_found: 404,
  disabled: 404,
  not_ready: 409,
  error: 500,
};

function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || req.headers['x-api-key'] !== expected) {
    logToFile('❌ Unauthorized child-test internal call', { path: req.path }, 'warn');
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

// route → service function, and the body fields it takes (nothing else is forwarded)
const ROUTES = {
  '/visits': ['listVisits', ['userId']],
  '/list': ['todaysList', ['userId', 'visitId']],
  '/outcome': ['markOutcome', ['userId', 'visitId', 'drawId', 'outcome', 'note']],
  '/card': ['getCard', ['userId', 'sessionId', 'block']],
  '/presign': ['presignBlockUpload', ['userId', 'sessionId', 'block', 'kind', 'contentType', 'sizeBytes']],
  '/media': ['registerBlockMedia', ['userId', 'sessionId', 'block', 'audioKey', 'photoKey', 'timing', 'photoDeclined']],
  '/session': ['sessionStatus', ['userId', 'sessionId']],
  '/check': ['submitCheck', ['userId', 'sessionId', 'block', 'coachMarks']],
  // the Learning assessment (self-administered battery): services/child-test/app/sa-api.service.js
  '/sa/schools': ['listSchools', ['userId'], 'sa-api.service'],
  '/sa/list': ['dayList', ['userId', 'schoolId', 'visitId', 'grade'], 'sa-api.service'],
  '/sa/outcome': ['dayOutcome', ['userId', 'schoolId', 'visitId', 'drawId', 'outcome', 'note', 'clientSessionId', 'block', 'repick', 'grade'], 'sa-api.service'],
  '/sa/battery': ['saBattery', ['userId', 'sessionId', 'lang', 'full'], 'sa-api.service'],
  '/sa/batch': ['saBatch', ['userId', 'sessionId', 'seqFrom', 'seqTo', 'events', 'results', 'lang', 'device'], 'sa-api.service'],
  '/sa/presign': ['saPresign', ['userId', 'sessionId', 'taskId', 'itemId', 'mime', 'bytes'], 'sa-api.service'],
  '/sa/register': ['saRegister', ['userId', 'sessionId', 'taskId', 'itemId', 'key'], 'sa-api.service'],
  '/sa/status': ['saStatus', ['userId', 'sessionId'], 'sa-api.service'],
  // asAdmin: the portal's own sa_results_admins check for its session user, never the browser's
  '/sa/results': ['saResults', ['userId', 'sessionId', 'asAdmin'], 'sa-api.service'],
  // another phone: the coach mints a link; the linked phone's sink calls carry the token, never a user
  '/sa/link-mint': ['saLink', ['userId', 'sessionId'], 'sa-api.service'],
  '/sa/via-link': ['saViaLink', ['token', 'op', 'sessionId', 'phone', 'seqFrom', 'seqTo', 'events', 'results', 'lang', 'device',
    'taskId', 'itemId', 'mime', 'bytes', 'key'], 'sa-api.service'],
};

function createChildTestAppRouter({ deps } = {}) {
  const router = express.Router();
  router.use(requireInternalKey);
  for (const [path, [fn, fields, service = 'app-api.service']] of Object.entries(ROUTES)) {
    router.post(path, async (req, res) => {
      const body = req.body || {};
      const args = {};
      for (const f of fields) if (body[f] !== undefined) args[f] = body[f];
      try {
        // eslint-disable-next-line global-require
        const Svc = require(`../services/child-test/app/${service}`);
        const result = (await Svc[fn](args, deps)) || { status: 'error' };
        const code = HTTP[result.status] || 500;
        if (code >= 500) logError('child_test.app.route_failed', { route: path, userId: args.userId, reason: result.reason });
        return res.status(code).json({ success: code < 400, ...result });
      } catch (error) {
        logError('child_test.app.route_threw', { route: path, userId: args.userId, error: error && error.message });
        return res.status(500).json({ success: false, status: 'error', reason: 'internal' });
      }
    });
  }
  return router;
}

module.exports = { createChildTestAppRouter, router: createChildTestAppRouter() };
