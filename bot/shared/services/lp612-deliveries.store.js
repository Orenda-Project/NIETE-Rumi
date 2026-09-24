'use strict';
/**
 * `niete_lp612_deliveries` — which Grades 6-12 lessons each teacher RECEIVED (migration V1.5.5).
 *
 * WHY IT EXISTS. /quiz lists a teacher's recent lessons so a quiz can be made from one on request.
 * For K-5 that list is `niete_lp_downloads`; the 6-12 lane had no equivalent. A lesson served from
 * the render cache wrote nothing about the teacher to the database (the Redis LP shelf only — 24 h,
 * cap 5, flushed on every quiz/coaching/video start), `niete_lp612_renders.requested_by` names only
 * the first requester, and `waiters` is emptied when the render is done. On production 10–24 Sep
 * 2026 that was 1,439 of 3,392 serves with no per-teacher record, a share that grows as the cache
 * fills.
 *
 * ONE WRITER: `lp612-serving.deliverRender`, after the document send succeeded — the one function
 * both the cache-hit path and the worker's waiter loop call. READERS: the lp612 /quiz provider.
 *
 * THE TABLE MAY NOT BE THERE YET. Code ships before its migration is applied in each environment,
 * so a missing table (PostgREST PGRST205 / Postgres 42P01) is said at error level at most once per
 * ten minutes, and the writer stops trying for those ten minutes — then tries again, so applying
 * the migration takes effect without a restart. The reader returns nothing meanwhile. Any other
 * error is logged at error level every time — that one is a real fault.
 *
 * The supabase client is injectable (opts.client) so unit tests never touch a DB.
 */

const { logToFile } = require('../utils/logger');

const TABLE = 'niete_lp612_deliveries';
const SURFACES = Object.freeze(['whatsapp', 'portal', 'backfill']);

/** How long a missing table is believed before the writer tries again, and the log's own quiet period. */
const MISSING_RETRY_MS = 10 * 60 * 1000;
let missingUntil = 0;
let missingSaidAt = -Infinity;

function client(opts = {}) {
  return opts.client || require('../config/supabase');
}

function isMissingTable(error) {
  const e = error || {};
  return e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(String(e.message || ''));
}

function sayMissing(where, error) {
  const now = Date.now();
  missingUntil = now + MISSING_RETRY_MS;
  if (now - missingSaidAt < MISSING_RETRY_MS) return;
  missingSaidAt = now;
  logToFile(`❌ ${TABLE} is missing — 6-12 deliveries are not recorded and /quiz cannot list them until migration V1.5.5 is applied`, {
    where, code: error && error.code,
  }, 'error');
}

/**
 * Record one delivered lesson. Never throws: the lesson has already reached the teacher.
 * @returns {Promise<boolean>} true when a row was written
 */
async function record({
  userId, renderId = null, segmentId, lang, templateVersion, surface = 'whatsapp', deliveredAt = null,
}, opts = {}) {
  if (!userId || !segmentId || !lang || !templateVersion) return false;
  if (Date.now() < missingUntil) return false;
  try {
    const { error } = await client(opts).from(TABLE).insert({
      user_id: userId,
      render_id: renderId,
      segment_id: segmentId,
      lang,
      template_version: templateVersion,
      surface: SURFACES.includes(surface) ? surface : 'whatsapp',
      delivered_at: deliveredAt || new Date().toISOString(),
    });
    if (error) {
      if (isMissingTable(error)) { sayMissing('record', error); return false; }
      logToFile(`❌ ${TABLE}: could not record a delivered 6-12 lesson`, { segmentId, renderId, code: error.code, error: error.message }, 'error');
      return false;
    }
    return true;
  } catch (err) {
    logToFile(`❌ ${TABLE}: recording a delivered 6-12 lesson threw`, { segmentId, renderId, error: err.message }, 'error');
    return false;
  }
}

/**
 * A teacher's delivered 6-12 lessons since `since`, newest first — at most one row per
 * (segment, language): the latest delivery of each.
 * @returns {Promise<Array<{id, user_id, render_id, segment_id, lang, template_version, delivered_at}>>}
 */
async function recentForTeacher(userId, { since = null, limit = 20 } = {}, opts = {}) {
  if (!userId) return [];
  let q = client(opts).from(TABLE)
    .select('id, user_id, render_id, segment_id, lang, template_version, delivered_at')
    .eq('user_id', userId);
  if (since) q = q.gte('delivered_at', new Date(since).toISOString());
  // Over-read: a teacher re-taps a lesson, and each tap is a delivery row.
  const { data, error } = await q.order('delivered_at', { ascending: false }).limit(Math.max(1, limit) * 4);
  if (error) {
    if (isMissingTable(error)) { sayMissing('read', error); return []; }
    throw new Error(`${TABLE}: ${error.message || error}`);
  }
  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const k = `${row.segment_id}|${row.lang}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/** One delivery, only if it is this teacher's. */
async function byIdForTeacher(id, userId, opts = {}) {
  if (!id || !userId) return null;
  const { data, error } = await client(opts).from(TABLE)
    .select('id, user_id, render_id, segment_id, lang, template_version, delivered_at')
    .eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) { sayMissing('read', error); return null; }
    throw new Error(`${TABLE}: ${error.message || error}`);
  }
  return data || null;
}

function __resetForTests() { missingUntil = 0; missingSaidAt = -Infinity; }

module.exports = {
  record, recentForTeacher, byIdForTeacher, isMissingTable, TABLE, SURFACES, MISSING_RETRY_MS, __resetForTests,
};
