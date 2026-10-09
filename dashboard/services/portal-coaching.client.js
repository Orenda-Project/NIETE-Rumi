/**
 * Portal-coaching client — the portal's only route to starting a classroom
 * analysis from an upload, and to answering its reflective question (bd-lfzoz).
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * Mirrors certificates.service.js. The portal knows one thing: who is logged
 * in. Which keys a teacher may upload to, what a coaching_sessions row must
 * look like, how the job is queued and how a reflective answer is processed all
 * belong to the bot (bot/shared/services/coaching/portal-coaching.service.js).
 *
 * WHY HTTP RATHER THAN REQUIRING THE BOT'S CODE
 * ---------------------------------------------
 * Module resolution forces it. The queue driver requires aws-sdk v2 and the
 * reflection engine requires supabase-js, axios and openai from bot/; on the
 * portal service those resolve against bot/node_modules and the repo root,
 * never dashboard/node_modules, so the require works in a dev tree and throws
 * on the deployed service (tests/portal/portal-reaches-bot-modules.test.js).
 *
 * IDENTITY STAYS HERE
 * -------------------
 * Callers pass the userId read from the SESSION. The bot checks every key and
 * row against it. Never hand this client a user id that came off a request.
 *
 * FAILURE POLICY
 * --------------
 * A 4xx from the bot is an ANSWER (not hers, not ready, already analysing…)
 * and is returned as { httpStatus, body } for the route to relay. Anything else
 * — unconfigured, unreachable, a 5xx — THROWS, so the route answers 502 and the
 * browser can never read a failed start as "analysing".
 */

const axios = require('axios');

// The reflection call runs the acknowledgement model before it answers.
const TIMEOUT_MS = 45_000;

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

async function post(path, body, timeoutMs = TIMEOUT_MS) {
  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    throw new Error('portal coaching API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }
  const res = await axios.post(`${baseUrl}/api/internal/coaching/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: timeoutMs,
    // 4xx are answers; let them through instead of throwing.
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return { httpStatus: res.status, body: res.data || {} };
}

/** @param {{userId, filename, sizeBytes, kind}} args */
function presignUpload({ userId, filename, sizeBytes, kind }) {
  return post('presign-upload', { userId, filename, sizeBytes, kind });
}

/**
 * @param {{userId, key, lessonPlanKey, photoKeys, lessonPlan, teacherClass}} args
 *   teacherClass (bd-fmf24g.9): { grade, subject, subjectKey? } — the class she picked in the app
 *   lessonPlan (bd-5rz1v): a library pick — { assetId } | { lessonId } | { segmentId, lang }
 */
function startSession({ userId, key, lessonPlanKey, photoKeys, lessonPlan, teacherClass }) {
  return post('start', { userId, key, lessonPlanKey, photoKeys, lessonPlan, teacherClass });
}

/** @param {{userId, coachingSessionId, answer}} args */
function submitReflection({ userId, coachingSessionId, answer }) {
  return post('reflection', { userId, coachingSessionId, answer });
}

/** bd-5rz1v — her recent plans, from the WhatsApp list's source. @param {{userId}} args */
function recentPlans({ userId }) {
  return post('recent-plans', { userId });
}

// ── bd-5rz1v.6: a COACH's /observe observation, run from the portal ─────────
// Same rules: `userId` is the coach from the SESSION; the bot checks the rest.

// The debrief guide is one model call on its first open (the WhatsApp path's).
const GUIDE_TIMEOUT_MS = 100_000;

/** @param {{userId, teacherExtId, schoolExtId, key, lessonPlanKey, photoKeys, lessonPlan}} args */
function startObservation({ userId, teacherExtId, schoolExtId, key, lessonPlanKey, photoKeys, lessonPlan }) {
  return post('observe/start', { userId, teacherExtId, schoolExtId, key, lessonPlanKey, photoKeys, lessonPlan });
}
/** HER recent plans — for the teacher being observed. */
function observeRecentPlans({ userId, teacherExtId, schoolExtId }) {
  return post('observe/recent-plans', { userId, teacherExtId, schoolExtId });
}
function listObservations({ userId }) { return post('observe/list', { userId }); }
function observationView({ userId, coachingSessionId }) { return post('observe/view', { userId, coachingSessionId }); }
function getObservationDraft({ userId, coachingSessionId }) { return post('observe/draft', { userId, coachingSessionId }); }
function saveObservationDraft({ userId, coachingSessionId, edits }) {
  return post('observe/draft/save', { userId, coachingSessionId, edits });
}
function observationTalkGuide({ userId, coachingSessionId }) {
  return post('observe/talk/guide', { userId, coachingSessionId }, GUIDE_TIMEOUT_MS);
}
function startObservationTalk({ userId, coachingSessionId, key }) {
  return post('observe/talk/start', { userId, coachingSessionId, key });
}
function retryObservationTalk({ userId, coachingSessionId }) { return post('observe/talk/retry', { userId, coachingSessionId }); }
function previewObservationReport({ userId, coachingSessionId }) {
  return post('observe/report/preview', { userId, coachingSessionId });
}
function sendObservationReport({ userId, coachingSessionId }) { return post('observe/report/send', { userId, coachingSessionId }); }

module.exports = {
  presignUpload, startSession, submitReflection, recentPlans,
  startObservation, observeRecentPlans, listObservations, observationView, getObservationDraft,
  saveObservationDraft, observationTalkGuide, startObservationTalk, retryObservationTalk,
  previewObservationReport, sendObservationReport,
};
