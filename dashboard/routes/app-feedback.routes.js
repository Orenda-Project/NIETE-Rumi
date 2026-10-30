'use strict';
/**
 * bd-x1tl95 — "Send feedback" from the More page of the coach's app. Mounted at /api/portal by dashboard/index.js.
 *
 *   POST /api/portal/feedback/presign  { filename, sizeBytes, kind: 'feedback_audio' | 'feedback_photo' }
 *     → { key, uploadUrl, contentType }: the app PUTs the voice message or the screenshot straight to R2
 *   POST /api/portal/feedback          { topic, text?, audioKey?, photoKeys?, context? } → { success, feedbackId }
 *
 * The user is ALWAYS the session's; a userId in the body is ignored. Which browser she is in is read from the request
 * (app-funnel.routes browserClass, the in-app-browser rule: classify server-side); the app's own claim is believed only
 * for "I am the Android app". The bot decides everything else. A bot that cannot be reached is 502, never "sent".
 */
const express = require('express');
const AppFeedbackClient = require('../services/app-feedback.client');

const CONTEXT_FROM_APP = ['surface', 'appBuild'];

function contextOf(req) {
  const raw = (req.body && req.body.context) || {};
  const out = {};
  for (const k of CONTEXT_FROM_APP) if (raw[k] !== undefined) out[k] = raw[k];
  out.browser = require('./app-funnel.routes').browserClass(req, raw.native === true ? 'native' : undefined);
  return out;
}

async function relay(res, label, call) {
  const reply = (status, body) => (res.headersSent ? undefined : res.status(status).json(body));
  try {
    const { httpStatus, body } = await call();
    return reply(httpStatus, body);
  } catch (error) {
    console.error(`App feedback ${label} failed:`, error.message);
    return reply(502, { success: false, error: 'Could not reach the service. Please try again.' });
  }
}

function createAppFeedbackRouter({ requirePortalAuth }) {
  const router = express.Router();

  router.post('/feedback/presign', requirePortalAuth, (req, res) => {
    const { filename, sizeBytes, kind } = req.body || {};
    return relay(res, 'presign', () => AppFeedbackClient.presignUpload({
      userId: req.session.portalUserId, filename, sizeBytes, kind,
    }));
  });

  router.post('/feedback', requirePortalAuth, (req, res) => {
    const { topic, text, audioKey, photoKeys } = req.body || {};
    return relay(res, 'send', () => AppFeedbackClient.submitFeedback({
      userId: req.session.portalUserId, topic, text, audioKey, photoKeys, context: contextOf(req),
    }));
  });

  return router;
}

// The portal's one sign-in check (lib/portal-auth.js), required only when the real router is built.
const router = createAppFeedbackRouter({ requirePortalAuth: (...a) => require('../lib/portal-auth').requirePortalAuth(...a) });

module.exports = router;
module.exports.createAppFeedbackRouter = createAppFeedbackRouter;
