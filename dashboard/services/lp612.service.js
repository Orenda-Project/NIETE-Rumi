/**
 * Lesson plans for grades 6-12 — the portal's client for the other corpus.
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * The same reason `lp-catalogue.service.js` has none, and the same reason the assessment client
 * has none: the portal answering a curriculum question itself is how the surfaces drifted apart
 * in the first place. Grade 5 maths once showed 0 chapters in the portal and 8 on WhatsApp
 * because each was reading a different table. So this module contains no query rules, no
 * filters and no readiness logic — it asks the bot and returns the answer.
 *
 * There is deliberately NO local fallback. A fallback is a second implementation, which is the
 * bug being avoided.
 *
 * WHAT MAKES THIS LANE DIFFERENT FROM THE K-5 CLIENT
 * --------------------------------------------------
 * K-5 lessons are pre-rendered: the only question is whether the PDF exists. A 6-12 SEGMENT
 * always exists, but only ~8% have a render on the current template, and authoring one takes a
 * MEDIAN OF 172 SECONDS (p90 314s, measured over all 473 completed renders on production).
 *
 * That is why this client has a request/poll shape rather than a fetch shape, and why
 * `listLessons` carries a `ready` flag per lesson. A teacher is entitled to know she is starting
 * a three-minute job before she starts it.
 *
 * IDENTITY STAYS HERE, AND IT COMES FROM THE SESSION
 * --------------------------------------------------
 * Every call that names a teacher takes `userId`, and the ROUTE must read it from
 * `req.session.portalUserId` — never from a request body. `requirePortalAuth` sets that session
 * key and attaches nothing to `req`; reading `req.portalUser?.id` yields undefined for a teacher
 * (only the leader guard sets it), which is exactly the bug that made every Generate on the
 * Assessment Generator answer "userId is required".
 *
 * FAILURE POLICY
 * --------------
 * Every read THROWS. An empty list is a legitimate answer, so returning [] on a transport error
 * would tell a teacher her lessons do not exist. The route turns a throw into a 5xx she can
 * retry.
 */

const axios = require('axios');

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
    throw new Error('LP 6-12 API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/lp612/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
    // 202 is the NORMAL answer from /request and axios treats it as success already, but
    // 403/404 are real answers about a real lesson (withheld, or not in the catalogue) rather
    // than faults — the caller turns them into a sentence rather than a stack trace.
    validateStatus: (s) => (s >= 200 && s < 300) || s === 403 || s === 404,
  });

  const data = res && res.data;
  if (res.status === 404) return { notFound: true };
  if (res.status === 403) return { withheld: true };
  if (!data || data.success !== true) {
    throw new Error(`LP 6-12 API returned failure for ${path}`);
  }
  return data;
}

/** Grades with at least one servable 6-12 segment. */
async function listGrades() {
  const data = await ask('grades', {});
  return data.grades || [];
}

/** Subjects within a grade, with lesson counts. */
async function listSubjects(grade) {
  const data = await ask('subjects', { grade });
  return data.subjects || [];
}

/** Chapters within a grade+subject. Keyed by chapter_key — two books can share a number. */
async function listChapters(grade, subject) {
  const data = await ask('chapters', { grade, subject });
  return data.chapters || [];
}

/**
 * Lessons in one chapter, each with `ready`.
 *
 * `ready: false` is the common case — about 92% of the corpus — and it is not an error or an
 * absence. It means "tapping this writes it", which the UI must say out loud.
 */
async function listLessons(grade, subject, chapterKey, lang = 'en') {
  const data = await ask('lessons', { grade, subject, chapterKey, lang });
  return data.lessons || [];
}

/**
 * Ask for one lesson.
 *
 * Answers `{ state: 'ready' | 'authoring', renderId }`. Never returns the document itself: even
 * a cache hit comes back as a state, so the browser has ONE code path rather than a fast one for
 * the 8% and a slow one for the rest.
 *
 * `withheld` and `notFound` are real answers, not throws.
 */
async function requestLesson(segmentId, userId, lang = 'en') {
  return ask('request', { segmentId, userId, lang });
}

/** Poll one request. A `ready` state carries a freshly presigned URL. */
async function requestStatus(renderId, userId) {
  return ask('status', { renderId, userId });
}

/**
 * "My lesson plans" — every 6-12 lesson this teacher has asked for.
 *
 * The landing place that makes a three-minute wait survivable: she can close the tab and come
 * back to the lesson rather than losing a render we have already paid for.
 */
async function myLessons(userId) {
  const data = await ask('mine', { userId });
  return data.lessons || [];
}

module.exports = {
  listGrades,
  listSubjects,
  listChapters,
  listLessons,
  requestLesson,
  requestStatus,
  myLessons,
};
