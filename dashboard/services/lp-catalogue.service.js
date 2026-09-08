/**
 * Lesson-plan catalogue client — the portal's only source of "which lesson
 * plans exist?".
 *
 * WHY THIS FILE HAS NO LOGIC IN IT
 * --------------------------------
 * Mirrors training-rules.service.js and certificates.service.js. The portal
 * used to answer the question itself, with its own Supabase reads:
 *
 *   | Question         | Bot (WhatsApp)                  | Portal (before)        |
 *   |------------------|---------------------------------|------------------------|
 *   | what exists      | data/lp_catalog.json            | curriculum_lp_ast      |
 *   | what is servable | niete_lp_assets is_current      | pre_generated_lps      |
 *   | subject match    | subject_key, lowercase          | .eq() on 'Math'/'Maths'|
 *
 * Those are not the same corpus. Measured on production 2026-09-08:
 * curriculum_lp_ast 2,485 enabled · pre_generated_lps 317 current ·
 * niete_lp_assets 1,284 current lessons — and PORTAL_INCLUDE_CORE_LPS was
 * unset on the prod portal service, so the 2,485 were hidden and the portal
 * served only the 317. Grade 5 maths: 0 chapters in the portal, 8 chapters and
 * 87 lessons on WhatsApp. A teacher on the app and a teacher on WhatsApp were
 * looking at different products.
 *
 * So this module contains NO catalogue rules. It asks the bot and returns the
 * answer. There is deliberately no local fallback — a fallback is a second
 * implementation, which is the bug being removed. A test asserts this file
 * touches no LP table.
 *
 * WHY HTTP RATHER THAN REQUIRING THE BOT'S CODE
 * ---------------------------------------------
 * The same module-resolution trap the LP enqueue and the certificate renderer
 * both hit: bot/shared code resolves its dependencies from bot/node_modules,
 * never from dashboard/node_modules, so an in-process require works in a dev
 * tree where both installs exist and fails on the deployed service.
 *
 * IDENTITY STAYS HERE
 * -------------------
 * `userId` is passed only to drive the per-teacher "already downloaded" tick,
 * and the caller must read it from the SESSION, never from a request body.
 *
 * FAILURE POLICY
 * --------------
 * Every read THROWS. An empty list is a legitimate answer ("nothing rendered
 * for this chapter yet"), so returning [] on a transport error would tell a
 * teacher her lesson plans do not exist — the failure mode this whole change
 * is about. The route turns a throw into a 5xx she can retry.
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
    throw new Error('LP catalogue API is not configured (MAIN_BOT_URL / INTERNAL_API_KEY)');
  }

  const res = await axios.post(`${baseUrl}/api/internal/lp/v8/${path}`, body, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const data = res && res.data;
  if (!data || data.success !== true) {
    throw new Error(`LP catalogue API returned failure for ${path}`);
  }
  return data;
}

/** Grades with at least one servable lesson. */
async function listGrades() {
  const data = await ask('grades', {});
  return data.grades || [];
}

/** Subjects for a grade, with servable lesson counts. */
async function listSubjects(grade) {
  const data = await ask('subjects', { grade });
  return data.subjects || [];
}

/** Chapters for a book — full titles, only those with servable lessons. */
async function listChapters(grade, subjectKey) {
  const data = await ask('chapters', { grade, subjectKey });
  return data.chapters || [];
}

/** Lessons in a chapter. `userId` (from the session) drives the ✓ tick. */
async function listLessons(grade, subjectKey, chapterNumber, userId = null) {
  const data = await ask('lessons', { grade, subjectKey, chapterNumber, userId });
  return data.lessons || [];
}

/**
 * A presigned URL for one lesson's PDF, or null when it is not rendered yet.
 *
 * `null` is a real answer, not an error — the caller renders "not ready".
 * There is deliberately no "queue a render" companion: the v8 corpus is
 * pre-rendered and uploaded, so availability is the only gate, and the Gamma
 * render path the old endpoint queued is off.
 */
async function lessonPdf(lessonId, kind = 'lesson') {
  const data = await ask('pdf', { lessonId, assetKind: kind });
  if (!data.available) return null;
  return { url: data.url, asset_kind: data.asset_kind, version_stamp: data.version_stamp };
}

module.exports = { listGrades, listSubjects, listChapters, listLessons, lessonPdf };
