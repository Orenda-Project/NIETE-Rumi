'use strict';
/**
 * bd-snkn32.4 — where a grades 1–5 "Make my own" starts: the day in the catalogue (its book's grade, subject and
 * LANGUAGE) and the plan she would be served today — the current lesson asset's own slide script, resolved by its
 * exact version (lp-asset-source.store's rule: never "latest"). A day with no current asset or no stored script has
 * nothing to rewrite, so Make my own answers "not found" for it before any row is written.
 *
 * bd-snkn32.12 — a v9/v10 day's stored script is the QUIZ digest (no Opening, no We Do, no I-Do steps), so Make my
 * own reads that version's own authored document (source_url, on R2) in full instead (lp-k5-own-html). A v8 day's
 * stored script is already the full plan and is used as stored. The request check (k5Lesson) never downloads.
 *
 * Reads only. Dependencies injectable for tests (createK5Source).
 */
const { toK5Script } = require('./lp-k5-own-html');

const isV9 = (src) => src.verified === 'v9_html' || (src.slideScript && src.slideScript.meta && src.slideScript.meta.source === 'v9_html');

const { clampLanguage } = require('../config/ux-strings');
const { dayPages } = require('./lp-k5-own-pages');

function createK5Source(deps) {
  const d = deps;

  /** { lessonId, lang, grade, subject, subjectName, pages? } for a day of the catalogue, or null. */
  function book(lessonId) {
    const hit = lessonId ? d.lessonById(lessonId) : null;
    if (!hit || !hit.book) return null;
    const lpType = hit.lesson && hit.lesson.lp_type;
    if (lpType === 'assessment' || lpType === 'revision') return null; // a worksheet or a revision is not a day plan
    const pages = dayPages(hit.lesson); // bd-snkn32.17 — the day's own book pages, when the catalogue lists them
    return {
      ...(pages ? { pages } : {}),
      lessonId,
      lang: clampLanguage(hit.book.language), // the BOOK's language, through the one clamp
      grade: Number(hit.book.grade),
      subject: hit.book.subject_key,
      subjectName: hit.book.subject,
    };
  }

  /** The day's current plan as a slide script, with its book; null when there is none to start from. */
  async function loadK5(lessonId, { full = true } = {}) {
    const b = book(lessonId);
    if (!b) return null;
    const asset = await d.currentAsset(lessonId);
    if (!asset) return null;
    const src = await d.resolveSlideScript({ lessonId, versionStamp: asset.version_stamp, contentHash: asset.content_hash });
    let script = src && src.slideScript;
    if (!script || typeof script !== 'object' || !script.iDo) return null;
    if (isV9(src)) {
      if (!src.sourceUrl) return null; // the digest alone is not a day plan
      if (full) script = toK5Script(String(await d.readHtml(src.sourceUrl)), { lessonId });
    }
    return { ...b, script };
  }

  /** The request's check: in the catalogue AND a plan stored to rewrite. */
  async function k5Lesson(lessonId) {
    const loaded = await loadK5(lessonId, { full: false });
    if (!loaded) return null;
    const { script: _s, ...rest } = loaded;
    return rest;
  }

  return { loadK5, k5Lesson };
}

let live = null;
const source = () => {
  live = live || createK5Source({
    lessonById: (id) => require('./lp-v8-catalog.service').lessonById(id),
    currentAsset: (id) => require('./lp-v8-delivery.service').currentAssetFor(id, 'lesson'),
    resolveSlideScript: (key) => require('./quiz/lp-asset-source.store').resolveSlideScript(key),
    readHtml: async (key) => (await require('../storage/r2').downloadFromR2(key)).toString('utf8'),
  });
  return live;
};

module.exports = {
  createK5Source,
  loadK5: (id) => source().loadK5(id),
  k5Lesson: (id) => source().k5Lesson(id),
};
