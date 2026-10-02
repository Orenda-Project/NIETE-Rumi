'use strict';

/**
 * /observe2 — a lesson plan the bot didn't give the teacher, added in the form before the seal
 * (LP_PHOTOS / LP_FILE / LP_TEXT), stored, then read after the recording.
 *
 * Reading is /observe's, not a copy of it: the lesson-plan extraction worker's own reader (pdf text
 * layer, Word, and a vision read for photos and scanned PDFs), its structuring call, and the same
 * "is this a lesson plan?" check. The text that survives goes to the fidelity orchestrator's
 * uploaded-plan path, exactly where /observe sends coaching_sessions.lesson_plan_text.
 *
 * The one difference is deliberate: several photos are pages of ONE plan, read in order and joined.
 * (/observe reads each file as the whole plan.)
 */

const { logToFile } = require('../../../utils/logger');

const KEY = (formId, n) => `observe2/${formId}/plan-${n}`;

/** The R2 keys an added plan's files are stored under, in the order the coach added them. */
function planKeys(formId, count) {
  return Array.from({ length: count }, (_, i) => KEY(formId, i + 1));
}

function worker() {
  // Lazy: the worker module loads pdf-parse, mammoth and the OCR clients.
  return require('../../../../workers/lesson-plan-extraction.worker');
}

function readerDeps(deps = {}) {
  return {
    download: deps.download || ((key) => require('../../../storage/r2').downloadFromR2(key)),
    detectFileType: deps.detectFileType || ((buf) => worker().detectFileType(buf)),
    extractText: deps.extractText || ((buf, type) => worker().extractText(buf, type)),
    structure: deps.structure || ((text) => worker().parseWithGPT4oMini(text)),
    decrypt: deps.decrypt || ((m) => require('../../roster/roster-media').decryptMedia(m)),
    upload: deps.upload || ((buf, key) => require('../../../storage/r2').uploadBuffer(buf, key, 'application/octet-stream')),
  };
}

/**
 * Store the files the coach added (Flow media → R2), in order. Runs after the screen's reply; a file that
 * fails is logged and left out, and reading later reports it as unread.
 */
async function storePlanFiles(formId, media, keys, deps) {
  const d = readerDeps(deps);
  let stored = 0;
  for (let i = 0; i < keys.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const file = await d.decrypt(media[i]);
      // eslint-disable-next-line no-await-in-loop
      await d.upload(file.data, keys[i]);
      stored += 1;
    } catch (err) {
      logToFile('[observe2] a file of the added lesson plan was not stored', { formId, index: i, error: err.message }, 'error');
    }
  }
  logToFile('[observe2] added lesson plan stored', { formId, files: keys.length, stored });
  return stored;
}

/**
 * The added plan's text: typed as it was, or each file read in order and joined.
 * @returns {Promise<{text:string, kind:string, files:number, read:number, parsers:string[]}>}
 */
async function readAddedPlan(upload, deps) {
  const kind = upload && upload.kind;
  if (kind === 'text') {
    const text = String(upload.text || '').trim();
    return { text, kind, files: 0, read: text ? 1 : 0, parsers: ['typed'] };
  }
  const d = readerDeps(deps);
  const keys = Array.isArray(upload && upload.keys) ? upload.keys : [];
  const pages = [];
  const parsers = [];
  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const buf = await d.download(key);
      const type = d.detectFileType(buf);
      // eslint-disable-next-line no-await-in-loop
      const { text, parser } = await d.extractText(buf, type);
      parsers.push(parser || type);
      if (text && String(text).trim()) pages.push(String(text).trim());
    } catch (err) {
      parsers.push('failed');
      logToFile('[observe2] a file of the added lesson plan could not be read', { key, error: err.message }, 'error');
    }
  }
  return { text: pages.join('\n\n'), kind, files: keys.length, read: pages.length, parsers };
}

/**
 * /observe's check, on /observe's terms: structured only when there is enough text to structure (the
 * worker's own floor), and only an explicit "not a lesson plan" stops it.
 * @returns {Promise<boolean|null>}
 */
async function looksLikeLessonPlan(text, deps) {
  if (!text || text.length < 50) return null;
  const d = readerDeps(deps);
  const { isLikelyLessonPlan } = require('../../coaching/lesson-plan-classifier');
  try {
    return isLikelyLessonPlan(await d.structure(text));
  } catch (err) {
    logToFile('[observe2] structuring the added lesson plan failed; grading it as read', { error: err.message }, 'error');
    return null;
  }
}

module.exports = { planKeys, storePlanFiles, readAddedPlan, looksLikeLessonPlan };
