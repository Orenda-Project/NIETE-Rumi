// KNOWN DESIGN DEBT (Nov 2026): lesson plans are spread over ~20 tables, one set per product generation
// (K-5 v8/v9, 6-12, GB, legacy). Do NOT add another per-region or per-generation LP table, cache or env
// flag: extend the existing table with the book as the separator, say so in the PR, and ask the operator
// (Hataf) before any new LP table.
// Here: niete_gb_lp_renders is a copy of niete_lp612_renders (same FK, same unique key); it merges back first.
// Why, target model, follow-up (audit planned): docs/lesson-plan-data-model-debt.md
'use strict';
/**
 * GB's own lesson-plan lane (bd-rj6w0n.14.16).
 *
 * The 6-12 runtime MECHANISM — she asks, it is written at runtime, rendered, the PDF sent and cached for
 * the next teacher — but in GB's own storage: its own cache rows (niete_gb_lp_renders), its own R2 prefix
 * (gb-lp/), its own job (gb_lp_author). A GB lesson is never served from or written into ICT's lp612 cache,
 * and an ICT lesson never lands here. lp612 code is reused by CALLING it (the document send in
 * Serving.deliverRender, the waiter-join contract), never by sharing its rows or keys.
 *
 * Reached only from lp612-serving's one hook, after the curriculum guard, for an nbf_snc segment with
 * LP_GB_K5_ENABLED on. Flag off, nothing here runs and ICT is byte-identical.
 *
 * Until LP_GB_AUTHOR_ENABLED=true (the gb_lp_author worker), only built plans are served: a miss is told
 * "coming soon" and nothing is written or queued. Built plans are seeded by bot/scripts/gb-seed-renders.js.
 *
 * GB grades 1-5: the v10 coach card with the v9 plan embedded, one plan per lesson in its BOOK's language,
 * for English, Urdu, Maths and Science only (isGbOnRequestSubject); any other subject is told "coming soon".
 * GB grades 6-12: design pending (no nbf_snc 6-12 book is in the store; GB teachers get ICT's 6-12 books on
 * ICT's lane under #4091), so a GB 6-12 segment is told "coming soon" and nothing is authored.
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { resolveUx } = require('../config/ux-strings');
const WhatsAppService = require('./whatsapp.service');
const GbDelivery = require('./lp612-gb-delivery.service');
const { isGbOnRequestSubject } = require('./lp612-curriculum.service');

const RENDERS = 'niete_gb_lp_renders';
const JOB_TYPE = 'gb_lp_author';
const R2_PREFIX = 'gb-lp/';
const UNIQUE_VIOLATION = '23505';
// The built v9 plans (seeded by bot/scripts/gb-seed-renders.js). The v10 card PDF moves this to gb_k5_v10.x.
const DEFAULT_TV = 'gb_k5_v9';
const DEFAULT_STRANDED_MS = 20 * 60 * 1000;
const FIND_COLUMNS = 'id, status, r2_key, waiters, started_at, picked_up_at';

const templateVersion = () => String(process.env.LP_GB_TEMPLATE_VERSION || DEFAULT_TV).trim() || DEFAULT_TV;
// KNOWN DESIGN DEBT (Nov 2026): LP_GB_AUTHOR_ENABLED is a temporary launch gate, retired after the GB switch with
// LP_GB_K5_ENABLED (lp612-flags.js); do not add another region flag. See docs/lesson-plan-data-model-debt.md.
/** Runtime authoring of a GB miss. Off until the gb_lp_author worker exists: a miss is then "coming soon". */
const isAuthorEnabled = () => process.env.LP_GB_AUTHOR_ENABLED === 'true';
const strandedMs = () => Number(process.env.LP_GB_STRANDED_MS) || DEFAULT_STRANDED_MS;

/** gb-lp/{tv}/{lang}/{segment_id}.{ext} — never under lp612/. */
function keyFor(segmentId, lang, tv, ext = 'pdf') {
  if (!/^[a-z0-9_.-]+$/i.test(String(segmentId || ''))) throw new Error(`bad GB segment id: ${segmentId}`);
  return `${R2_PREFIX}${tv}/${lang}/${segmentId}.${ext}`;
}
const isGbKey = (k) => typeof k === 'string' && k.startsWith(R2_PREFIX) && !k.includes('..');
/** The bucket is shared with PK production: every GB write goes through this, right before the put. */
function assertGbKey(k) {
  if (!isGbKey(k)) throw new Error(`refusing to write "${k}": the GB lane may only write under ${R2_PREFIX}`);
  return k;
}

async function tell(phone, key, lang) {
  if (!phone) return;
  try {
    const copy = resolveUx(key, { language: lang });
    const ok = await WhatsAppService.sendMessage(phone, copy);
    if (ok) logEvent('gb_lp.send.sent', { kind: 'text', uxKey: key, lang: lang || null, copy });
  } catch (err) {
    logToFile('LP GB: could not send a status line', { key, error: err.message });
  }
}

const waiterEntry = ({ userId, phone, voice, correlationId, askedAt }) => ({
  user_id: userId || null, phone: phone || null, ui_lang: voice, correlation_id: correlationId || null,
  asked_at: askedAt || new Date().toISOString(),
});

async function findRender(segmentId, lang, tv) {
  const { data, error } = await supabase.from(RENDERS).select(FIND_COLUMNS)
    .eq('segment_id', segmentId).eq('lang', lang).eq('template_version', tv).maybeSingle();
  if (error) logToFile('LP GB: render lookup failed', { segmentId, lang, tv, error: error.message });
  return { render: error ? null : data, readFailed: !!error };
}

/** An `authoring` row nobody has finished in time: its worker died or its job was lost. */
function isStranded(render, now = Date.now()) {
  if (!render || render.status !== 'authoring') return false;
  const since = Date.parse(render.picked_up_at || render.started_at || '');
  return Number.isFinite(since) && now - since > strandedMs();
}

async function enqueue({ renderId, segmentId, lang, tv, correlationId }) {
  const SQSQueueService = require('./queue'); // lazily, like lp612-serving: the SQS driver needs aws-sdk.
  await SQSQueueService.queueJob(segmentId, JOB_TYPE, {
    renderId, segmentId, lang, templateVersion: tv, correlationId,
  }, { deduplicationId: `${Date.now()}-${lang}-${JOB_TYPE}-${renderId}`.slice(0, 128) });
}

async function enqueueOrFail(args) {
  try {
    await enqueue(args);
    return true;
  } catch (err) {
    logToFile('LP GB: could not enqueue the authoring job', { ...args, error: err.message });
    const now = new Date().toISOString();
    await supabase.from(RENDERS).update({
      status: 'failed', error_code: 'ENQUEUE_FAILED', error_detail: String(err.message || '').slice(0, 2000),
      completed_at: now, updated_at: now,
    }).eq('id', args.renderId).eq('status', 'authoring');
    return false;
  }
}

/** Send a ready GB PDF through 6-12's document send. renderId null: GB rows never enter lp612's ledger. */
async function deliver({ phone, userId, r2Key, segment, lang, askedAt, generatedAt, correlationId }) {
  if (!isGbKey(r2Key)) throw new Error(`refusing to serve a non-GB key on the GB lane: ${r2Key}`);
  const Serving = require('./lp612-serving.service'); // lazily: lp612-serving requires this module.
  await Serving.deliverRender({
    phone, userId, r2Key, segment, lang, renderId: null, askedAt, generatedAt, correlationId,
  });
}

async function join(renderId, entry) {
  const { data, error } = await supabase.rpc('gb_lp_join_waiters', { p_render_id: renderId, p_entry: entry });
  if (error) logToFile('LP GB: could not join waiter list', { renderId, error: error.message });
  return error ? 'error' : (data || 'error');
}

/**
 * Her ask, on GB's lane. `segment` is already loaded and has passed the hold and the curriculum guard.
 * @returns {{outcome: string, renderId?: string, error?: string}}
 */
async function requestLesson(req, depth = 0) {
  const { segment, userId, phone, voice, correlationId, askedAt, surface } = req;
  const segmentId = segment.segment_id;
  const t0 = Date.now();
  if (!GbDelivery.isGbK5Segment(segment)) {
    logToFile('LP GB: grade 6-12 GB lesson asked, design pending', { segmentId, correlationId });
    await tell(phone, 'lp612GbComingSoonTap', voice);
    return { outcome: 'gb_design_pending' };
  }
  if (!isGbOnRequestSubject(segment.grade, segment.subject)) {
    // Only English, Urdu, Maths and Science are written on request; nothing is read, written or queued.
    logToFile('LP GB: subject not written on request', { segmentId, subject: segment.subject, correlationId });
    await tell(phone, 'lp612GbComingSoonTap', voice);
    return { outcome: 'gb_subject_off' };
  }
  if ((surface || 'whatsapp') !== 'whatsapp') {
    logToFile('LP GB: non-WhatsApp surface asked, design pending', { segmentId, surface, correlationId });
    return { outcome: 'gb_design_pending' };
  }
  if (depth > 2) {
    await tell(phone, 'lp612Failed', voice);
    return { outcome: 'error', error: 'gb render row kept moving' };
  }
  const lang = GbDelivery.authorLanguage(segment);
  const tv = templateVersion();
  const again = () => requestLesson(req, depth + 1);
  const { render: row, readFailed } = await findRender(segmentId, lang, tv);
  if (readFailed) {
    await tell(phone, 'lp612Failed', voice);
    return { outcome: 'error', error: 'render lookup failed' };
  }

  // hit — GB's own cached PDF, sent like ICT's.
  if (row && row.status === 'ready' && row.r2_key) {
    try {
      await deliver({
        phone, userId, r2Key: row.r2_key, segment, lang, askedAt, generatedAt: askedAt, correlationId,
      });
      logEvent('gb_lp.serve.hit', { segmentId, lang, tv, renderId: row.id, ms: Date.now() - t0, correlationId });
      return { outcome: 'cache_hit', renderId: row.id };
    } catch (err) {
      logToFile('LP GB: cache delivery failed', { segmentId, r2Key: row.r2_key, error: err.message, correlationId });
      await tell(phone, 'lp612Failed', voice);
      return { outcome: 'deliver_failed', error: err.message };
    }
  }

  if (!isAuthorEnabled()) {
    // Only the built plans are served; nothing is written, so no job is left waiting on a worker.
    logEvent('gb_lp.serve.not_built', { segmentId, lang, tv, status: row ? row.status : null, correlationId });
    await tell(phone, 'lp612GbComingSoonTap', voice);
    return { outcome: 'gb_not_built' };
  }

  const entry = waiterEntry({ userId, phone, voice, correlationId, askedAt });

  // in flight — join it.
  if (row && row.status === 'authoring' && !isStranded(row)) {
    const r = await join(row.id, entry);
    if (r === 'not_authoring' || r === 'missing') return again();
    await tell(phone, 'lp612AlreadyPreparing', voice);
    logEvent('gb_lp.serve.joined', { segmentId, lang, tv, renderId: row.id, result: r, correlationId });
    return { outcome: 'joined', renderId: row.id };
  }

  let renderId;
  if (row) {
    // failed, stranded, or a ready row with no key: reset it under a compare-and-set on what we read.
    const now = new Date().toISOString();
    const { data, error } = await supabase.from(RENDERS).update({
      status: 'authoring', r2_key: null, error_code: null, error_detail: null, waiters: [entry],
      requested_by: userId || null, correlation_id: correlationId || null,
      started_at: now, picked_up_at: null, completed_at: null, updated_at: now,
    }).eq('id', row.id).eq('status', row.status).select('id');
    if (error || !data || !data.length) return again();
    renderId = row.id;
  } else {
    const { data, error } = await supabase.from(RENDERS).insert({
      segment_id: segmentId, lang, template_version: tv, status: 'authoring', waiters: [entry],
      requested_by: userId || null, correlation_id: correlationId || null,
    }).select('id').single();
    if (error && error.code === UNIQUE_VIOLATION) return again();
    if (error || !data) {
      logToFile('LP GB: could not claim render', { segmentId, error: error && error.message, correlationId });
      await tell(phone, 'lp612Failed', voice);
      return { outcome: 'error', error: error ? error.message : 'no row' };
    }
    renderId = data.id;
  }

  await tell(phone, 'lp612Preparing', voice);
  if (!await enqueueOrFail({ renderId, segmentId, lang, tv, correlationId })) {
    await tell(phone, 'lp612Failed', voice);
    return { outcome: 'error', error: 'enqueue failed', renderId };
  }
  logEvent('gb_lp.serve.queued', { segmentId, lang, tv, renderId, ms: Date.now() - t0, correlationId });
  return { outcome: 'queued', renderId };
}

module.exports = {
  requestLesson, deliver, keyFor, isGbKey, assertGbKey, isStranded, templateVersion, waiterEntry, isAuthorEnabled,
  RENDERS, JOB_TYPE, R2_PREFIX,
};
