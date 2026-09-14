/**
 * Assessment generator client — the portal's only route to making a paper.
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * Mirrors lp-catalogue.service.js, certificates.service.js and
 * training-rules.service.js. The portal's Assessment Generator tab has been
 * rendering a real form — grade, subject, page ranges, question types — against
 * a route that does not exist. Measured on production 2026-09-08:
 *
 *   GET  /api/portal/config              assessmentGenerator: true   ← tab ON
 *   POST /api/portal/assessment/generate 404                         ← no route
 *   GET  /api/portal/lesson-plans        401                         ← control
 *
 * The 404-against-401 is the proof: the routes are ABSENT, not merely
 * unauthenticated. They were razed with the old UG_EG generator and the
 * September rebuild went WhatsApp-Flow-only, while the flag that lights the tab
 * is shared between both surfaces and stayed on.
 *
 * The dead panel it replaces had already drifted from the bot in three ways —
 * MAX_COUNT = 20 against MAX_QUESTIONS = 25, its own hardcoded subject lists,
 * and UG_EG-era subject ids ('Eng', 'GenK') that no longer resolve. That is
 * what a second implementation costs, and it is why this module contains no
 * assessment rules at all: not the question cap, not the subject catalogue, not
 * which types a subject supports. It asks the bot and returns the answer.
 *
 * There is deliberately NO local fallback. A fallback is a second
 * implementation, which is the bug being removed. A test asserts this file
 * touches no assessment table.
 *
 * WHY HTTP RATHER THAN REQUIRING THE BOT'S CODE
 * ---------------------------------------------
 * bot/shared code resolves its dependencies from bot/node_modules, never from
 * dashboard/node_modules, so an in-process require works in a dev tree where
 * both installs exist and fails on the deployed service.
 *
 * IDENTITY STAYS HERE
 * -------------------
 * Every call takes `userId`, and the caller MUST read it from the session,
 * never from a request body. It is what makes a paper hers: the bot checks
 * ownership inside its query, so a paper belonging to someone else is
 * indistinguishable from one that does not exist.
 *
 * FAILURE POLICY
 * --------------
 * Reads THROW on a transport error, so the route can answer 5xx and the page
 * can say "we are broken" rather than "you have no papers". The two answers
 * that are NOT errors — a job still running, and an artifact that is not
 * available — come back as ordinary values, because the page has to draw
 * something different for each.
 */

const axios = require('axios');

// Generation itself is queued and polled, so no call here waits on a model.
const TIMEOUT_MS = 15_000;

function config() {
  return {
    baseUrl: (process.env.MAIN_BOT_URL || '').replace(/\/$/, ''),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
}

async function ask(path, body) {
  const { baseUrl, apiKey } = config();
  if (!baseUrl || !apiKey) {
    throw new Error('Assessment API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/assessment/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
    // 400s carry a per-field message the teacher should see (an out-of-range
    // question count says which range). Letting axios throw on them would turn
    // a correctable mistake into "something went wrong".
    validateStatus: (s) => (s >= 200 && s < 300) || s === 400,
  });

  const data = res && res.data;
  if (res.status === 400) {
    const err = new Error(data?.error || 'That request was not valid.');
    err.userFacing = true;
    err.status = 400;
    throw err;
  }
  if (!data || data.success !== true) {
    throw new Error(`Assessment API returned failure for ${path}`);
  }
  return data;
}

/**
 * Everything the form needs to draw itself: grades, and — once she has picked —
 * the subjects for that grade and the question types for that subject.
 *
 * `maxQuestions` comes from here rather than being known locally. That is the
 * whole point: the form cannot offer a number the validator will refuse.
 */
async function options({ grade = null, subject = null } = {}) {
  return ask('options', { grade, subject });
}

/** The chapters of one book — full titles and the pages each covers. */
async function listChapters(grade, subject) {
  const data = await ask('chapters', { grade, subject });
  return data.chapters || [];
}

/**
 * Ask for a paper. Returns a requestId to poll on; the paper does not exist yet.
 *
 * `surface: 'portal'` is set bot-side, which is what makes the job build the
 * paper and message nobody. A portal request deliberately does NOT also arrive
 * on WhatsApp: we are usually outside the 24-hour window and would need a
 * template, so it would land sometimes and not others.
 */
async function create(spec) {
  const data = await ask('create', spec);
  return { requestId: data.requestId };
}

/**
 * Where a request has got to: queued | generating | ready | failed | not_found.
 *
 * "Not ready" is an ordinary value, not an error, so the page can tell STILL
 * WORKING from WE ARE BROKEN. A failure carries its code, so she can be told
 * which real thing went wrong rather than a generic apology.
 */
async function status(requestId, userId) {
  const data = await ask('status', { requestId, userId });
  return {
    status: data.status,
    paperId: data.paperId || null,
    errorCode: data.errorCode || null,
  };
}

/**
 * A time-limited link to a paper she owns, or null.
 *
 * null covers four situations the page treats identically: not hers, does not
 * exist, not finished, or an answer key whose location was never recorded
 * (every paper generated before V1.4.2 — the key may be in R2, but we never
 * wrote down where).
 */
async function download(paperId, userId, artifact = 'paper') {
  const data = await ask('download', { paperId, userId, artifact });
  if (!data.available) return null;
  return { url: data.url, filename: data.filename };
}

/** Her finished papers, newest first, filterable by grade and subject. */
async function listPapers(userId, { page = 1, pageSize = 10, grade = null, subject = null } = {}) {
  const data = await ask('papers', { userId, page, pageSize, grade, subject });
  return {
    papers: data.papers || [],
    total: data.total || 0,
    page: data.page || page,
    pageSize: data.pageSize || pageSize,
  };
}

module.exports = { options, listChapters, create, status, download, listPapers };
