/**
 * bd-x1tl95 — the portal's one route to the bot for "Send feedback" (bot/shared/services/feedback/app-feedback.service).
 * Mirrors portal-coaching.client.js: no logic, the session's userId in, the bot's answer out.
 *
 * FAILURE POLICY. A 4xx from the bot is an ANSWER (empty, not hers, too many…) returned as { httpStatus, body } for the
 * route to relay. Unconfigured, unreachable or a 5xx THROWS, so the route answers 502 and the app never shows "Sent"
 * for a send that did not happen.
 */

const axios = require('axios');

// Submit only checks the uploads and writes one row; the transcript and the Slack post come after the answer.
const TIMEOUT_MS = 20_000;

async function post(path, body) {
  const baseUrl = (process.env.MAIN_BOT_URL || '').replace(/\/$/, '');
  const apiKey = process.env.INTERNAL_API_KEY || '';
  if (!baseUrl || !apiKey) throw new Error('app feedback API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  const res = await axios.post(`${baseUrl}/api/internal/app-feedback/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return { httpStatus: res.status, body: res.data || {} };
}

/** @param {{userId, filename, sizeBytes, kind: 'feedback_audio'|'feedback_photo'}} args */
function presignUpload({ userId, filename, sizeBytes, kind }) {
  return post('presign-upload', { userId, filename, sizeBytes, kind });
}

/** @param {{userId, topic, text, audioKey, photoKeys, context}} args */
function submitFeedback({ userId, topic, text, audioKey, photoKeys, context }) {
  return post('submit', { userId, topic, text, audioKey, photoKeys, context });
}

module.exports = { presignUpload, submitFeedback };
