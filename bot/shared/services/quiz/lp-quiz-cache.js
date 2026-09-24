'use strict';
/**
 * THE LESSON-PLAN QUIZ CACHE — a quiz written from a lesson PLAN is the same
 * quiz for every teacher who was served the same version of that lesson.
 *
 * WHY THIS IS EXACT, NOT APPROXIMATE. An lp_v8 / lp612 quiz is written from
 * ONE source: the slide script (or 6-12 document) of `meta.lessons[0]`, the
 * exact version the teacher was served (transcript-quiz-generate
 * resolveLessonSource). The digest and the author read that source, the
 * catalog grade and subject, and the quiz language — nothing about the teacher.
 * So the key is that lesson's version identity plus the language:
 *
 *   lp_v8  lp_v8|<lesson_id>|<version_stamp>|<content_hash>|<language>
 *   lp612  lp612|<segment_id>|<render_id>|<template_version>|<language>
 *
 * A class quiz over several lessons is keyed the same way: it is written from
 * lessons[0] alone; the other lessons are the teacher's own coverage record in
 * `meta.lessons`, which a hit never touches.
 *
 * WHAT A HIT COPIES — an allowlist, never the donor's meta wholesale:
 *   - the question rows (new ids; external_id re-keyed to THIS quiz; the stored
 *     `media.display_order`, figure and card URLs kept — the display order is
 *     read from `media`, so the card's letters and the buttons still agree);
 *   - the lesson's content: digest, grade, grade_source, the two summaries,
 *     question_count, and the topic/subject/grade columns.
 * NEVER copied: the donor's teacher, lesson_date, class, lessons, nudge, share
 * code, link, student message, PDF, class cards, children, cost. The share code
 * is minted and the PDF rendered afterwards by the normal hand-off, with THIS
 * teacher's name and lesson date.
 *
 * WHO MAY DONATE. The newest quiz with the key that was actually sent, within
 * QUIZ_LP_CACHE_MAX_AGE_DAYS, whose every check passed: the blind solve ran and
 * agreed (clean / fixed / dropped — never `error`, which means it did not run),
 * the key check (lp_v8) did not fail, no soft fault was shipped, and it was
 * AUTHORED (a copy never donates, so every hit is one hop from real work). A
 * quiz made again after a failure ("Make it again" bypasses the cache and
 * authors) is preferred, newest first.
 *
 * SINGLE-FLIGHT. Two teachers making the same lesson at once should not both
 * author it. The first to miss takes a Redis lock on the key and authors; one
 * that finds the lock held does not wait in its worker slot — the job is
 * re-queued (`cacheWaitDelaySeconds`) and looks again, up to `maxCacheWaits`
 * times, then authors anyway. Redis down → no lock, author (the old behaviour).
 *
 * Kill switch QUIZ_LP_CACHE (default on; off/false/0 = author every time).
 */

const supabase = require('../../config/supabase');
const { LP_V8, LP612 } = require('./quiz-sources');

const DEFAULT_MAX_AGE_DAYS = 30;
const LOCK_TTL_SECONDS = 15 * 60;
const DEFAULT_WAIT_DELAY_SECONDS = 60;
const DEFAULT_MAX_WAITS = 3;
/** How many recent candidates are read to find one that may donate. */
const CANDIDATES = 10;
const PASSED_KEY_VERIFY = new Set(['clean', 'fixed', 'dropped']);
const FAILED_CHECK = new Set(['failed', 'error']);

const QUESTION_COLUMNS = [
  'question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'explanation',
  'misconception_feedback', 'distractor_misconceptions', 'option_feedback', 'difficulty_level',
  'media', 'render_pattern', 'sort_order', 'external_id',
];
/** The lesson's content on the donor's meta — the only meta a hit carries over. */
const CONTENT_META = ['digest', 'grade', 'grade_source', 'lesson_summary', 'lesson_summary_short'];

const off = (v) => ['off', 'false', '0', 'no'].includes(String(v || '').trim().toLowerCase());
function enabled() { return !off(process.env.QUIZ_LP_CACHE); }

function positiveInt(raw, dflt) {
  const n = Number.parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
function maxAgeDays() { return positiveInt(process.env.QUIZ_LP_CACHE_MAX_AGE_DAYS, DEFAULT_MAX_AGE_DAYS); }
function cacheWaitDelaySeconds() { return positiveInt(process.env.QUIZ_LP_CACHE_WAIT_SECONDS, DEFAULT_WAIT_DELAY_SECONDS); }
function maxCacheWaits() { return positiveInt(process.env.QUIZ_LP_CACHE_MAX_WAITS, DEFAULT_MAX_WAITS); }

/** The identity fields of lessons[0] that make the key, per source (null = not cacheable). */
function identityOf(quizSource, lesson) {
  const l = lesson || {};
  if (quizSource === LP_V8 && l.lesson_id && l.version_stamp && l.content_hash) {
    return { lesson_id: l.lesson_id, version_stamp: l.version_stamp, content_hash: l.content_hash };
  }
  if (quizSource === LP612 && l.segment_id && l.render_id) {
    return { segment_id: l.segment_id, render_id: l.render_id, template_version: l.template_version || '' };
  }
  return null;
}

/**
 * @param {{quiz_source:string, meta:object}} quiz
 * @param {string} language  the quiz language the author would write in
 * @returns {string|null}
 */
function cacheKey(quiz, language) {
  if (!quiz || !language) return null;
  const id = identityOf(quiz.quiz_source, ((quiz.meta && quiz.meta.lessons) || [])[0]);
  if (!id) return null;
  return [quiz.quiz_source, ...Object.values(id), language].join('|');
}

/** May this row donate its questions to `key`? Checked in code whatever the query filtered. */
function eligibleDonor(row, key, { now = new Date() } = {}) {
  if (!row || !row.meta) return false;
  const m = row.meta;
  if (!['sent', 'report_sent'].includes(row.status)) return false;
  if (cacheKey(row, row.language) !== key) return false;
  if (m.cache_donor) return false;
  if (Array.isArray(m.soft_faults) && m.soft_faults.length) return false;
  if (!m.key_verify || !PASSED_KEY_VERIFY.has(m.key_verify.status)) return false;
  if (row.quiz_source === LP_V8 && (!m.key_check || FAILED_CHECK.has(m.key_check.status))) return false;
  if (!m.digest || !(Number(m.question_count) > 0)) return false;
  const ageMs = now - new Date(row.created_at);
  return Number.isFinite(ageMs) && ageMs <= maxAgeDays() * 864e5;
}

/** Remade (authored after a failure) first, then newest. */
function rank(a, b) {
  const ra = Number(a.meta && a.meta.remakes) > 0 ? 1 : 0;
  const rb = Number(b.meta && b.meta.remakes) > 0 ? 1 : 0;
  if (ra !== rb) return rb - ra;
  return new Date(b.created_at) - new Date(a.created_at);
}

/**
 * The donor for this quiz and its question rows, or null. A read that ERRORS
 * returns null (the quiz is authored, as before the cache) — it never fails a
 * quiz the author could still write.
 *
 * @returns {Promise<{donor:object, rows:object[], key:string}|null>}
 */
async function findDonor(quiz, language, { now = new Date(), log = () => {} } = {}) {
  const key = cacheKey(quiz, language);
  if (!key) return null;
  const id = identityOf(quiz.quiz_source, quiz.meta.lessons[0]);
  let q = supabase.from('quizzes')
    .select('id, quiz_source, topic, subject, grade, language, status, meta, created_at')
    .eq('quiz_source', quiz.quiz_source)
    .eq('language', language)
    .in('status', ['sent', 'report_sent'])
    .neq('id', quiz.id)
    .gte('created_at', new Date(now.getTime() - maxAgeDays() * 864e5).toISOString());
  for (const [field, value] of Object.entries(id)) {
    if (value) q = q.eq(`meta->lessons->0->>${field}`, value);
  }
  const { data, error } = await q.order('created_at', { ascending: false }).limit(CANDIDATES);
  if (error) {
    log('⚠️ lp quiz cache: donor lookup failed — authoring instead', { quizId: quiz.id, error: error.message });
    return null;
  }
  const donors = (data || []).filter((r) => eligibleDonor(r, key, { now })).sort(rank);
  for (const donor of donors) {
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error: qErr } = await supabase.from('quiz_questions')
      .select(QUESTION_COLUMNS.join(', '))
      .eq('quiz_id', donor.id).order('sort_order', { ascending: true });
    if (qErr) {
      log('⚠️ lp quiz cache: donor questions unreadable — authoring instead', { quizId: quiz.id, donorId: donor.id, error: qErr.message });
      return null;
    }
    // The donor's stored set must be the set it shipped — a partial read is no donor.
    if (Array.isArray(rows) && rows.length && rows.length === Number(donor.meta.question_count)) {
      return { donor, rows, key };
    }
  }
  return null;
}

/**
 * The donor's rows as THIS quiz's rows: only the question columns, a new
 * quiz_id, and the external_id re-keyed (it is unique across all quizzes and
 * the report reads the SLO from its second-to-last segment).
 */
function rowsFor(quizId, donorRows) {
  return donorRows.map((r, i) => {
    const row = {};
    for (const c of QUESTION_COLUMNS) if (r[c] !== undefined && r[c] !== null) row[c] = r[c];
    const parts = String(r.external_id || '').split(':');
    const slo = parts.length >= 4 ? parts[parts.length - 2] : 'S?';
    const n = parts.length >= 4 ? parts[parts.length - 1] : String(i + 1);
    row.external_id = `tq:${quizId}:${slo}:${n}`;
    row.quiz_id = quizId;
    return row;
  });
}

const MEDIA_URL_FIELDS = ['question_image', 'question_card'];

/**
 * Re-host every picture of the copied rows under THIS quiz's own R2 key
 * (`<prefix>/<teacherId>/<quizId>/<file>`), so no row points at the donor's
 * objects — whose path names the donor teacher — and nothing here depends on
 * the donor's pictures outliving it. Throws on any failure: the caller then
 * authors the quiz rather than ship a question whose picture is missing.
 *
 * @returns {Promise<object[]>} the rows, media URLs replaced (new objects)
 */
async function rehostMedia(rows, { teacherId, quizId }) {
  // eslint-disable-next-line global-require
  const r2 = require('../../storage/r2');
  const moved = new Map();
  const move = async (url) => {
    if (moved.has(url)) return moved.get(url);
    const key = r2.extractKeyFromUrl(url);
    const parts = String(key).split('/').filter(Boolean);
    if (parts.length < 2) throw new Error(`unexpected picture key: ${key}`);
    const newKey = [parts[0], String(teacherId), String(quizId), parts[parts.length - 1]].join('/');
    const buffer = await r2.downloadFromR2(key);
    if (!buffer || !buffer.length) throw new Error(`picture ${key} came back empty`);
    const out = await r2.uploadBuffer(buffer, newKey, 'image/png');
    if (!out) throw new Error(`picture ${newKey} did not upload`);
    moved.set(url, out);
    return out;
  };
  const outRows = [];
  for (const row of rows) {
    const media = row.media ? { ...row.media } : row.media;
    if (media) {
      for (const f of MEDIA_URL_FIELDS) {
        // eslint-disable-next-line no-await-in-loop
        if (typeof media[f] === 'string' && media[f]) media[f] = await move(media[f]);
      }
    }
    outRows.push({ ...row, ...(media ? { media } : {}) });
  }
  return outRows;
}

/** The lesson's content from the donor's meta (the allowlist) + where it came from. */
function contentMetaFrom(donor, key) {
  const out = {};
  for (const k of CONTENT_META) if (donor.meta[k] !== undefined) out[k] = donor.meta[k];
  out.cache_donor = { quiz_id: donor.id, key, authored_at: donor.created_at };
  return out;
}

function redis() {
  // Required lazily: this module is loaded by the generate step in every suite.
  // eslint-disable-next-line global-require
  return require('../cache/railway-redis.service');
}
const lockName = (key) => `lpquizcache:${key}`;

/**
 * Take the author's lock on `key`.
 * @returns {Promise<'acquired'|'held'|'unavailable'>}
 */
async function acquire(key, quizId) {
  try {
    const r = redis();
    if (!r.isAvailable()) return 'unavailable';
    return (await r.acquireLock(lockName(key), String(quizId), LOCK_TTL_SECONDS)) ? 'acquired' : 'held';
  } catch (_) {
    return 'unavailable';
  }
}

async function release(key, quizId) {
  try { await redis().releaseLock(lockName(key), String(quizId)); } catch (_) { /* the TTL frees it */ }
}

module.exports = {
  enabled, cacheKey, identityOf, eligibleDonor, rank, findDonor, rowsFor, rehostMedia, contentMetaFrom, acquire, release,
  maxAgeDays, cacheWaitDelaySeconds, maxCacheWaits, QUESTION_COLUMNS, CONTENT_META, LOCK_TTL_SECONDS,
};
