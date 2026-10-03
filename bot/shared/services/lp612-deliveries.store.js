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
 * WRITERS, by surface:
 *   whatsapp  `lp612-serving.deliverRender`, after the document send succeeded — the one function
 *             both the cache-hit path and the worker's waiter loop call.
 *   portal    (bd-5rz1v.21) the portal's claim on a render she asked for: `lp612-serving`'s cache
 *             hit for the portal, and the worker's loop for a portal waiter (who has no phone, so is
 *             never sent to) when it claims the waiter list.
 * READERS:
 *   - the lp612 /quiz provider (`recentForTeacher`, `byIdForTeacher`) — WhatsApp and backfill rows
 *     ONLY. /quiz is a WhatsApp menu of lessons she received there; a portal request is not that,
 *     and the K-5 portal opens (niete_lp_opens) do not reach /quiz either.
 *   - the portal's access check and "My lesson plans" (`claimsRender`, `portalRenderIds`, via
 *     lp612-browse) — any surface for the check: a teacher who received this render on WhatsApp
 *     may open it in the portal too.
 *   - the portal Home (dashboard lp-activity) reads the table in SQL — WhatsApp/backfill only.
 *
 * WHY A PORTAL ROW AT ALL (bd-5rz1v.21). The portal reads a lesson by RENDER id, and a render is
 * shared: `requested_by` names the first requester and `waiters` is emptied when it completes. A
 * portal cache hit recorded nothing for her, so every teacher after the first was told "No such
 * lesson request" about the lesson the request had just called ready — production 3 Sep–3 Oct
 * 2026: 98 of 114 portal cache-hit (render, teacher) pairs, 212 × 404 on /lp612/status. A row
 * here is her durable, per-render claim; the column comment of V1.5.5 reserved 'portal' for it.
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
/** What /quiz lists: lessons that reached her on WhatsApp (and the migration's backfill of them). */
const QUIZ_SURFACES = Object.freeze(['whatsapp', 'backfill']);

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
    .eq('user_id', userId)
    .in('surface', QUIZ_SURFACES);
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

/** One delivery, only if it is this teacher's and one /quiz may use (see QUIZ_SURFACES). */
async function byIdForTeacher(id, userId, opts = {}) {
  if (!id || !userId) return null;
  const { data, error } = await client(opts).from(TABLE)
    .select('id, user_id, render_id, segment_id, lang, template_version, delivered_at')
    .eq('id', id).eq('user_id', userId).in('surface', QUIZ_SURFACES)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) { sayMissing('read', error); return null; }
    throw new Error(`${TABLE}: ${error.message || error}`);
  }
  return data || null;
}

/**
 * bd-5rz1v.21 — has this render reached this teacher, on any surface? The portal's per-render claim
 * once `requested_by` (first requester only) and `waiters` (emptied on completion) are no help.
 *
 * Never throws, and FAILS CLOSED: a read that failed is not a claim. It is said at error level, so
 * a teacher refused because the ledger could not be read shows up as a fault, not as a quiet 404.
 * Load: one probe of idx_lp612_deliveries_user_recent (one teacher's rows), only when the cheaper
 * in-row claims have already said no.
 */
async function claimsRender(renderId, userId, opts = {}) {
  if (!renderId || !userId) return false;
  try {
    const { data, error } = await client(opts).from(TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('render_id', renderId)
      .limit(1);
    if (error) {
      if (isMissingTable(error)) { sayMissing('claim', error); return false; }
      logToFile(`❌ ${TABLE}: could not check a 6-12 render claim — refused`, { renderId, code: error.code, error: error.message }, 'error');
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    logToFile(`❌ ${TABLE}: checking a 6-12 render claim threw — refused`, { renderId, error: err.message }, 'error');
    return false;
  }
}

/**
 * bd-5rz1v.21 — the renders this teacher asked for in the PORTAL, newest first, deduplicated: the
 * cache hits that "My lesson plans" could not see (she is neither `requested_by` nor a waiter).
 * Never throws; a read that failed is logged and lists nothing extra.
 * @returns {Promise<string[]>} render ids
 */
async function portalRenderIds(userId, { limit = 50 } = {}, opts = {}) {
  if (!userId) return [];
  try {
    const { data, error } = await client(opts).from(TABLE)
      .select('render_id, delivered_at')
      .eq('user_id', userId)
      .eq('surface', 'portal')
      .order('delivered_at', { ascending: false })
      .limit(Math.max(1, limit) * 4);
    if (error) {
      if (isMissingTable(error)) { sayMissing('read', error); return []; }
      logToFile(`❌ ${TABLE}: could not list a teacher's portal 6-12 lessons`, { code: error.code, error: error.message }, 'error');
      return [];
    }
    const ids = [];
    for (const row of data || []) {
      if (row.render_id && !ids.includes(row.render_id)) ids.push(row.render_id);
      if (ids.length >= limit) break;
    }
    return ids;
  } catch (err) {
    logToFile(`❌ ${TABLE}: listing a teacher's portal 6-12 lessons threw`, { error: err.message }, 'error');
    return [];
  }
}

function __resetForTests() { missingUntil = 0; missingSaidAt = -Infinity; }

module.exports = {
  record,
  recentForTeacher,
  byIdForTeacher,
  claimsRender,
  portalRenderIds,
  isMissingTable,
  TABLE,
  SURFACES,
  MISSING_RETRY_MS,
  __resetForTests,
};
