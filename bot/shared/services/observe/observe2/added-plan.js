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
 *
 * RUMI'S OWN PLAN (bd-eal7zn.2). Most files coaches add are byte-for-byte a plan PDF Rumi made (44 of
 * the first 52 on prod): the teacher's copy, forwarded. Rumi doesn't read its own plan. The file's
 * bytes name it: niete_lp_assets.content_hash is the first 12 hex of the PDF's SHA-1 (the asset's
 * own definition, scripts/verify-lp-v8-r2.js). A file that matches one lesson's plan (or its one-page
 * card) is graded from that plan's own steps, exactly like a plan picked from the list. Read as text,
 * an Urdu plan's layer came out as broken glyphs and was judged "not a lesson plan" (R6/R7, 13-14 Oct).
 */

const crypto = require('crypto');
const { logToFile } = require('../../../utils/logger');

const KEY = (formId, n) => `observe2/${formId}/plan-${n}`;
const PLAN_ASSET_KINDS = ['lesson', 'card'];

/** niete_lp_assets.content_hash of a file: the first 12 hex characters of its SHA-1. */
const contentHash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

async function lookupPlanAssets(hashes) {
  const supabase = require('../../../config/supabase');
  const { data, error } = await supabase.from('niete_lp_assets')
    .select('id, lesson_id, asset_kind, version_stamp, content_hash')
    .in('content_hash', hashes)
    .in('asset_kind', PLAN_ASSET_KINDS);
  if (error) throw new Error(error.message || String(error));
  return data || [];
}

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
    planAssets: deps.planAssets || lookupPlanAssets,
  };
}

/**
 * The same deps, with each stored file downloaded once however many times it is asked for: the plan
 * match and, when it finds nothing, the reading both look at the same files.
 */
function sharedDownloads(deps = {}) {
  const d = readerDeps(deps);
  const seen = new Map();
  const download = (key) => {
    if (!seen.has(key)) {
      const p = Promise.resolve().then(() => d.download(key));
      p.catch(() => seen.delete(key)); // a failed download is tried again by the next reader
      seen.set(key, p);
    }
    return seen.get(key);
  };
  return { ...deps, download };
}

/**
 * Is a file the coach added one of Rumi's own plans? Only files are looked at (photos taken of a
 * paper plan never match). A match names exactly one lesson; bytes that name two lessons, an empty
 * file, or a lookup that fails name none, and the plan is read as before.
 * @returns {Promise<null|{asset_id:string, lesson_id:string, asset_kind:string, version_stamp:string|null, content_hash:string}>}
 */
async function matchRumiPlan(upload, deps) {
  if (!upload || upload.kind !== 'file') return null;
  const keys = Array.isArray(upload.keys) ? upload.keys : [];
  if (!keys.length) return null;
  const d = readerDeps(deps);
  const hashes = [];
  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const buf = await d.download(key);
      if (buf && buf.length) hashes.push(contentHash(buf));
    } catch (_) {
      // Not stored or not downloadable: the reading that follows reports it.
    }
  }
  if (!hashes.length) return null;
  let rows;
  try {
    rows = await d.planAssets([...new Set(hashes)]);
  } catch (err) {
    logToFile("[observe2] the bot's own plans could not be looked up: the added plan is read instead", { files: keys.length, error: err.message }, 'error');
    return null;
  }
  const lessons = [...new Set((rows || []).map((r) => r.lesson_id).filter(Boolean))];
  if (lessons.length !== 1) {
    if (lessons.length > 1) logToFile("[observe2] the added files match more than one of the bot's plans: read instead", { lessons });
    return null;
  }
  const row = rows.find((r) => r.asset_kind === 'lesson') || rows[0];
  return {
    asset_id: String(row.id),
    lesson_id: row.lesson_id,
    asset_kind: row.asset_kind,
    version_stamp: row.version_stamp || null,
    content_hash: row.content_hash,
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

module.exports = { planKeys, storePlanFiles, readAddedPlan, looksLikeLessonPlan, matchRumiPlan, sharedDownloads, contentHash };
