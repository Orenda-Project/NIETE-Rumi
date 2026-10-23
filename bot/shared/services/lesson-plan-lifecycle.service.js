'use strict';
/**
 * Lesson-plan lifecycle — the ONE writer of an ask's path, stages, outcome and log id.
 *
 * Every lesson-plan ask leaves ONE row in lesson_plan_requests, on every path: which path served
 * it (source), where (channel), when each stage happened (created_at → processing_started_at →
 * generated_at → delivered_at), how it ended (status, error_code) and the correlation id of its
 * logs — so a plan seen in the portal can be traced to its ask, its outcome and its logs, and the
 * plan row names its ask (lesson_plans.request_id).
 *
 * Two ways a path records:
 *   · a path that already keeps a queue row (the grounded Gamma path) adds `askColumns()` to its
 *     insert and the stage columns to its existing updates;
 *   · every other path (grade 1-5 v8, grade 6-12, Oxbridge, share, the Flow lanes) calls `recordOutcome()` ONCE, when
 *     the ask has reached its end — so it never leaves a pending/processing row behind for the
 *     queue's stale sweeper or the in-flight check in teacher-state to find.
 *
 * SWITCHED per path by LP_LIFECYCLE_PATHS ('all', or a comma list of SOURCES values). Unset, no
 * function here touches the database and every caller writes exactly what it wrote before.
 *
 * SOFT-FAIL. Nothing here throws into a delivery. A failed write returns null and is counted
 * (`lesson_plan.lifecycle.write_failed`) and said at error level at most once per ten minutes per kind
 * of failure; it is retried every time, so applying the migration needs no restart. A path that adds
 * lifecycle columns to its OWN write (the queue paths, the plan and ledger links) goes through
 * writeWithFallback: if the database refuses the write because of them — a column it does not have yet,
 * a value its CHECK will not take — the same write runs again exactly as it was before the lifecycle.
 * The lesson is the thing the teacher asked for; the record is ours.
 *
 * DEPENDENCIES ON PURPOSE: only the database client and the two loggers — never the queue — so any
 * module can require this one without changing what its process loads.
 *
 * The vocabularies below are the CHECK constraints of migration V1.6.4;
 * tests/lesson-plan-lifecycle/vocabulary.test.js pins code and database to one list.
 */

const crypto = require('crypto');
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const structuredLogger = require('../utils/structured-logger');

const { logEvent } = structuredLogger;
// Read defensively: many suites replace the structured logger with a stub that has only logEvent.
const currentCorrelationId = () => (typeof structuredLogger.getCurrentCorrelationId === 'function'
  ? structuredLogger.getCurrentCorrelationId()
  : undefined);

const LIFECYCLE = Object.freeze({
  STATUSES: Object.freeze(['pending', 'processing', 'completed', 'failed', 'cancelled']),
  // One value per path, shared with the other Rumi deployment so the two databases speak one
  // vocabulary. The niete_* paths are this deployment's own.
  SOURCES: Object.freeze({
    GAMMA_STANDARD: 'gamma_standard',
    GAMMA_ENRICHED: 'gamma_enriched',
    UG_LP: 'ug_lp',
    PS_PREGEN: 'ps_pregen',
    V7_SEGMENT: 'v7_segment',
    V7_CHAPTER: 'v7_chapter',
    GAMMA_CHAPTER: 'gamma_chapter',
    PRE_GEN_CHAPTER: 'pre_gen_chapter',
    HOMEWORK_BUNDLE: 'homework_bundle',
    PIC_TO_LP_KIEAI: 'pic_to_lp_kieai',
    KENYA_BROWSE: 'kenya_browse',
    MULTIGRADE_LP: 'multigrade_lp',
    NIETE_GROUNDED: 'niete_grounded',
    NIETE_V8_SEGMENT: 'niete_v8_segment',
    NIETE_LP612: 'niete_lp612',
    NIETE_OXBRIDGE: 'niete_oxbridge',           // the Oxbridge catalogue (typed-topic picker + Flow)
    NIETE_PORTAL_SHARE: 'niete_portal_share',   // the portal's "Send on WhatsApp" for a lesson plan
    FREEFORM_V1: 'freeform_v1',                 // the free-form engine (typed topic in neither catalogue)
  }),
  CHANNELS: Object.freeze({ WHATSAPP: 'whatsapp', PORTAL: 'portal' }),
  // Short machine codes for a failed ask. error_message keeps the human detail.
  ERROR_CODES: Object.freeze({
    GENERATION_FAILED: 'GENERATION_FAILED', // the artefact could not be made
    RENDER_FAILED: 'RENDER_FAILED',         // it was authored but could not be rendered/stored
    DELIVERY_FAILED: 'DELIVERY_FAILED',     // it existed, and the send to the teacher failed
    QUEUE_FAILED: 'QUEUE_FAILED',           // the job could not be queued
    NO_ASSET: 'NO_ASSET',                   // nothing to deliver for what she asked
    NOT_ELIGIBLE: 'NOT_ELIGIBLE',           // a deliberate policy: no version for her group
  }),
});
const SOURCE_SET = new Set(Object.values(LIFECYCLE.SOURCES));
const ERROR_CODE_SET = new Set(Object.values(LIFECYCLE.ERROR_CODES));
/** The longest a lifecycle record may hold up its caller: past this the caller carries on (the write may still land). */
const WRITE_TIMEOUT_MS = 2000;
const TIMED_OUT = Symbol('lifecycle write timed out');
const CHANNEL_SET = new Set(Object.values(LIFECYCLE.CHANNELS));
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const SCHEMA_MISSING_CODES = new Set(['PGRST204', 'PGRST205', '42703', '42P01']);
/** The database refused a write BECAUSE of what the lifecycle added: a column it does not have yet (V1.6.4
 *  not applied), or a value its CHECK / foreign key / type will not take. */
const REFUSED_BY_LIFECYCLE_CODES = new Set(['PGRST204', '42703', '23514', '23503', '22P02', '22001']);
const LOUD_EVERY_MS = 10 * 60 * 1000;
/** When each kind of write failure (code + path) was last said at error level. */
const loudAt = new Map();
let switchAnnounced = false;
// A boolean-shaped value switches every path on — sandbox sets its flags to `1`.
const ALL_VALUES = new Set(['all', '1', 'true', 'yes', 'on']);

function isoOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function gradeOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function textOrNull(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function switchParts() {
  const raw = String(process.env.LP_LIFECYCLE_PATHS || '').trim().toLowerCase();
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** Words that mean "off" — known, not typos. */
const OFF_VALUES = new Set(['0', 'false', 'no', 'off', 'none']);

/** The paths LP_LIFECYCLE_PATHS switches on: 'all' (or 1/true/yes/on), or a comma list of sources. */
function switchedOnPaths() {
  const parts = switchParts();
  if (parts.some((s) => ALL_VALUES.has(s))) return new Set(SOURCE_SET);
  return new Set(parts.filter((s) => SOURCE_SET.has(s)));
}

/**
 * Is the lifecycle writer switched on for this path? Read on every call, so a test (or a restart)
 * sees the current value. The first call in a process says once what the switch resolved to —
 * a gate that is off must say so, not stay silent.
 * @param {string} source
 * @returns {boolean}
 */
function enabled(source) {
  const on = switchedOnPaths();
  if (!switchAnnounced) {
    switchAnnounced = true;
    // A name that is not a path (a typo) switches nothing on — said at warn level, never silently.
    const unknown = switchParts().filter((s) => !ALL_VALUES.has(s) && !OFF_VALUES.has(s) && !SOURCE_SET.has(s));
    logToFile('Lesson-plan lifecycle switch resolved', {
      LP_LIFECYCLE_PATHS: process.env.LP_LIFECYCLE_PATHS || '(unset)',
      pathsOn: [...on].sort(),
      ...(unknown.length ? { unknown } : {}),
    }, unknown.length ? 'warn' : undefined);
  }
  return SOURCE_SET.has(source) && on.has(source);
}

/**
 * The lifecycle columns a path that keeps its OWN queue row adds to that row's insert: path,
 * channel, region, grade, subject, artefact reference, correlation id. `{}` when the path is
 * switched off, so the caller's insert is byte-identical to before.
 */
function askColumns({ source, channel, grade, subject, artifactRef, correlationId } = {}) {
  if (!enabled(source)) return {};
  const ch = CHANNEL_SET.has(channel) ? channel : LIFECYCLE.CHANNELS.WHATSAPP;
  return {
    source,
    channel: ch,
    region: textOrNull(process.env.REGION, 40),
    grade: gradeOrNull(grade),
    subject: textOrNull(subject, 100),
    artifact_ref: textOrNull(artifactRef, 300),
    correlation_id: textOrNull(correlationId || currentCorrelationId(), 200),
  };
}

/**
 * The lifecycle columns a QUEUE path adds to one of its existing stage updates. `{}` when the path is
 * switched off, so the update is byte-identical to before. The queue keeps its own status (its
 * worker's retry and idempotency read it); these columns only add what happened:
 *   'completed' — generated_at, and delivered_at when the send was accepted (sent === true) or
 *                 error_code DELIVERY_FAILED when WhatsApp refused it (sent === false); a stale
 *                 error_code from an earlier failed attempt is cleared unless the send failed;
 *   'failed'    — error_code (GENERATION_FAILED unless the caller names another), and generated_at
 *                 when the artefact existed before it failed (a refused send);
 *   'queue_failed' — error_code QUEUE_FAILED: the job could not be queued (the request stays pending
 *                 for the recovery sweep, exactly as before).
 */
function queueColumns(source, stage, { generatedAt, sent, errorCode } = {}) {
  if (!enabled(source)) return {};
  const now = new Date().toISOString();
  if (stage === 'completed') {
    if (sent === false) return { generated_at: isoOrNull(generatedAt) || now, error_code: LIFECYCLE.ERROR_CODES.DELIVERY_FAILED };
    return {
      generated_at: isoOrNull(generatedAt) || now,
      ...(sent === true ? { delivered_at: now } : {}),
      error_code: null,
    };
  }
  if (stage === 'failed') {
    const generated = isoOrNull(generatedAt);
    return {
      ...(generated ? { generated_at: generated } : {}),
      error_code: knownCode(errorCode, source),
    };
  }
  if (stage === 'queue_failed') return { error_code: LIFECYCLE.ERROR_CODES.QUEUE_FAILED };
  return {};
}

/** The canonical event for a queue-path stage, emitted only when the path is switched on. */
function queueEvent(source, eventName, fields = {}) {
  safely(() => {
    if (!enabled(source)) return;
    logEvent(eventName, { source, region: textOrNull(process.env.REGION, 40), correlationId: currentCorrelationId(), ...fields });
  });
}

/**
 * Record a lesson-plan ask that has reached its end — delivered, failed or cancelled — on a path
 * that keeps no queue row of its own. ONE upsert on the ask's id: a retried call rewrites the same
 * row, never adds a second.
 *
 * Never throws. Returns the ask's id, or null when the path is switched off, the input is not
 * recordable (no teacher, no phone, an unknown path/status/channel), or the write failed — in every
 * one of those cases the caller carries on delivering exactly as before.
 *
 * @param {Object} o
 * @param {string} [o.id]            the ask's id, when the caller has one (a retry rewrites that row)
 * @param {string} o.userId
 * @param {string} [o.phone]         absent on a portal / app ask: read from users (switch on only)
 * @param {string} o.topic
 * @param {string} [o.fullMessage]   defaults to the topic
 * @param {string} [o.language]      'en' | 'ur'; absent with no phone → her preferred_language
 * @param {string} [o.contentType]   defaults to 'lesson_plan'
 * @param {string} o.source          a LIFECYCLE.SOURCES value
 * @param {string} [o.channel]       a LIFECYCLE.CHANNELS value; defaults to whatsapp
 * @param {number|string} [o.grade]
 * @param {string} [o.subject]
 * @param {string} [o.artifactRef]   the delivered artefact's id in the path's own catalogue
 * @param {'completed'|'failed'|'cancelled'} o.status
 * @param {Date|string} [o.askedAt]  when the teacher asked (defaults to now)
 * @param {Date|string} [o.startedAt]
 * @param {Date|string} [o.generatedAt]
 * @param {Date|string} [o.deliveredAt] defaults to now when status is completed
 * @param {string} [o.errorCode]     a LIFECYCLE.ERROR_CODES value, for a failed ask
 * @param {string} [o.errorMessage]
 * @param {string} [o.correlationId] defaults to the request context's correlation id
 * @returns {Promise<string|null>}
 */
async function recordOutcome(o = {}) {
  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), WRITE_TIMEOUT_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    const out = await Promise.race([recordOutcomeNow(o), timedOut]);
    if (out !== TIMED_OUT) return out;
    // The database did not answer in time: the caller carries on (the write may still land). Counted.
    writeFailed({ code: 'TIMEOUT', message: `no answer within ${WRITE_TIMEOUT_MS} ms — the caller carried on` }, { source: o.source }, { table: 'lesson_plan_requests' });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function recordOutcomeNow(o) {
  let row = null;
  try {
    row = outcomeRow(await withContact(o));
    if (!row) return null;
    // Insert or ignore: a retried call that names its id adds no second row, and no call can rewrite a
    // row that is already there (another teacher's ask included).
    const { error } = await supabase
      .from('lesson_plan_requests')
      .upsert({ ...row }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      writeFailed(error, row);
      return null;
    }
    logEvent(outcomeEvent(row), eventFields(row));
    return row.id;
  } catch (err) {
    writeFailed({ code: 'THROWN', message: err && err.message, stack: err && err.stack }, row);
    return null;
  }
}

/**
 * An ask that arrives without the teacher's phone — the portal and the teacher app name her by her id
 * alone — takes it from users, and her language with it when the caller gave none. One read by primary
 * key, made only when the path is switched on and the phone is missing. Never throws: a read that fails
 * or finds no phone leaves the ask as it came, and outcomeRow refuses it ('no_phone').
 */
async function withContact(o) {
  if (o.phone || !o.userId || !enabled(o.source)) return o;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('phone_number, preferred_language')
      .eq('id', o.userId)
      .maybeSingle();
    if (error) {
      // Not a teacher without a phone: the read failed. Said, so an outage is not mistaken for one, and
      // counted, because this ask is lost.
      logToFile('⚠️ Lesson-plan lifecycle: could not read the teacher\'s phone from users — this ask is not recorded',
        { code: error.code, message: error.message, source: o.source }, 'warn');
      safely(() => logEvent('lesson_plan.lifecycle.write_failed', { code: error.code || 'USERS_READ_FAILED', message: String(error.message || '').slice(0, 300), source: o.source, table: 'users' }));
      return o;
    }
    if (!data) return o;
    return { ...o, phone: data.phone_number, language: o.language || data.preferred_language };
  } catch (err) {
    logToFile('⚠️ Lesson-plan lifecycle: reading the teacher\'s phone threw — this ask is not recorded',
      { error: err && err.message, source: o.source }, 'warn');
    return o;
  }
}

/** A code the vocabulary knows, or the default (GENERATION_FAILED) — an unknown one is said, never stored as is. */
function knownCode(errorCode, source) {
  const code = textOrNull(errorCode, 40);
  if (!code) return LIFECYCLE.ERROR_CODES.GENERATION_FAILED;
  if (ERROR_CODE_SET.has(code)) return code;
  safely(() => logEvent('lesson_plan.lifecycle.refused', { reason: 'error_code', errorCode: code, source }));
  return LIFECYCLE.ERROR_CODES.GENERATION_FAILED;
}

/** Run a reporting call that must never reach a teacher's delivery: a broken logger is swallowed here. */
function safely(fn) {
  try { fn(); } catch (_) { /* reporting is best-effort; the caller is a delivery */ }
}

/** The row recordOutcome writes, or null (switched off / not recordable). Pure: no I/O. */
function outcomeRow(o) {
  if (!SOURCE_SET.has(o.source)) {
    // Switched on for any path, an outcome for a path the vocabulary does not know is a caller's
    // mistake: refused out loud (the event), never dropped in silence.
    if (switchedOnPaths().size) {
      logEvent('lesson_plan.lifecycle.refused', { reason: 'source', source: o.source, status: o.status, channel: o.channel });
    }
    return null;
  }
  if (!enabled(o.source)) return null;
  const refuse = (reason) => {
    logEvent('lesson_plan.lifecycle.refused', { reason, source: o.source, status: o.status, channel: o.channel });
    return null;
  };
  if (!TERMINAL.has(o.status)) return refuse('status');
  const channel = o.channel || LIFECYCLE.CHANNELS.WHATSAPP;
  if (!CHANNEL_SET.has(channel)) return refuse('channel');
  if (!o.userId) return refuse('no_user');
  const phone = String(o.phone || '').replace(/\D/g, '').slice(0, 20);
  if (!phone) return refuse('no_phone');

  const topic = textOrNull(o.topic, 500) || 'lesson plan';
  const deliveredAt = o.status === 'completed' ? (isoOrNull(o.deliveredAt) || new Date().toISOString()) : null;
  const failed = o.status === 'failed';
  return {
    id: o.id || crypto.randomUUID(),
    user_id: o.userId,
    phone_number: phone,
    topic,
    full_message: textOrNull(o.fullMessage, 4000) || topic,
    language: textOrNull(o.language, 10) || 'en',
    content_type: textOrNull(o.contentType, 20) || 'lesson_plan',
    status: o.status,
    source: o.source,
    channel,
    region: textOrNull(process.env.REGION, 40),
    grade: gradeOrNull(o.grade),
    subject: textOrNull(o.subject, 100),
    artifact_ref: textOrNull(o.artifactRef, 300),
    created_at: isoOrNull(o.askedAt) || new Date().toISOString(),
    processing_started_at: isoOrNull(o.startedAt),
    generated_at: isoOrNull(o.generatedAt),
    delivered_at: deliveredAt,
    completed_at: deliveredAt,
    error_code: failed ? knownCode(o.errorCode, o.source) : null,
    error_message: failed ? textOrNull(o.errorMessage, 1000) : null,
    correlation_id: textOrNull(o.correlationId || currentCorrelationId(), 200),
  };
}

/** The canonical event for a recorded outcome — the same names the other deployment emits. */
function outcomeEvent(row) {
  if (row.status === 'completed') return 'lesson_plan.delivery.sent';
  if (row.status === 'cancelled') return 'lesson_plan.request.cancelled';
  // A content answer (the plan is not there, or not for her) is not a failure of ours — the main bot's name.
  if (row.error_code === LIFECYCLE.ERROR_CODES.NO_ASSET || row.error_code === LIFECYCLE.ERROR_CODES.NOT_ELIGIBLE) {
    return 'lesson_plan.delivery.unavailable';
  }
  return row.generated_at ? 'lesson_plan.delivery.failed' : 'lesson_plan.generation.failed';
}

/** The fields every lifecycle event carries: the ids an analyst joins on, never a phone. */
function eventFields(row) {
  const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : undefined);
  return {
    requestId: row.id,
    userId: row.user_id,
    source: row.source,
    channel: row.channel,
    region: row.region,
    status: row.status,
    grade: row.grade,
    subject: row.subject,
    artifactRef: row.artifact_ref,
    errorCode: row.error_code || undefined,
    correlationId: row.correlation_id,
    askToDeliveredMs: ms(row.created_at, row.delivered_at),
    askToGeneratedMs: ms(row.created_at, row.generated_at),
  };
}

/**
 * A lifecycle write — or the lifecycle part of a path's own write — failed. Counted every time (the
 * write_failed event); said at ERROR level, which the error monitor pages on, at most once per ten
 * minutes per kind of failure (code + path), so a path whose every write fails is seen, not drowned.
 */
function writeFailed(error, row, ctx = {}) {
  safely(() => reportWriteFailed(error, row, ctx));
}

function reportWriteFailed(error, row, ctx) {
  const code = (error && error.code) || 'UNKNOWN';
  const message = (error && error.message) || '';
  const source = row && row.source;
  logEvent('lesson_plan.lifecycle.write_failed', {
    code, message: message.slice(0, 300), requestId: row && row.id, source, table: ctx.table, fellBack: Boolean(ctx.fellBack),
  });
  const key = `${code}|${source || ''}`;
  const now = Date.now();
  if (now - (loudAt.get(key) || 0) < LOUD_EVERY_MS) return;
  loudAt.set(key, now);
  if (SCHEMA_MISSING_CODES.has(code) || /schema cache/i.test(message)) {
    logToFile('Lesson-plan lifecycle columns are missing — apply migration V1.6.4. Every lesson-plan path '
      + 'carries on exactly as before; the lifecycle record is not written until it is applied.',
    { code, message, source, table: ctx.table }, 'error');
    return;
  }
  logToFile('❌ Lesson-plan lifecycle write failed — the teacher\'s flow is unaffected; this lifecycle record is lost',
    { code, message, source, table: ctx.table, stack: error && error.stack }, 'error');
}

/**
 * A path's own recorder threw while describing an ask, before recordOutcome ran (recordOutcome itself never
 * throws). Switched on for that path, reported like a failed write — the write_failed event every time,
 * error level at most once per ten minutes; switched off, nothing, as before. Never throws.
 *
 * @param {*} error what the recorder threw
 * @param {string} source the path's LIFECYCLE.SOURCES value
 */
function recorderThrew(error, source) {
  try {
    if (!enabled(source)) return;
    writeFailed({ code: 'THROWN', message: error && error.message, stack: error && error.stack }, { source }, { table: 'lesson_plan_requests' });
  } catch (_) {
    // Reporting is best-effort by contract: the recorder's caller is a teacher's delivery.
  }
}

/** True when the database refused a write because of the lifecycle's additions (see the code list). */
function refusedByLifecycle(error) {
  if (!error) return false;
  return REFUSED_BY_LIFECYCLE_CODES.has(error.code) || /schema cache/i.test(String(error.message || ''));
}

/**
 * Run one of a path's OWN writes with the lifecycle's additions spread in — and if the database refuses it
 * BECAUSE of them, run it again exactly as it was before the lifecycle existed. A lesson-plan path's write
 * can never fail because of the lifecycle; the refusal is reported (writeFailed). Switched off, the
 * additions are {} and this is exactly one write. Any other error is returned untouched, as before.
 *
 * @param {(extra: object) => PromiseLike<{data?: any, error?: any}>} write  runs the write with `extra` spread in
 * @param {object} additions  what the lifecycle adds (askColumns / queueColumns / a request_id link)
 * @param {{ source?: string, table?: string, requestId?: string }} [ctx]  for the report
 */
async function writeWithFallback(write, additions, ctx = {}) {
  const extra = additions && typeof additions === 'object' ? additions : {};
  const first = await write(extra);
  if (!Object.keys(extra).length || !first || !first.error || !refusedByLifecycle(first.error)) return first;
  const second = await write({});
  // Only a write that lands WITHOUT the additions was refused because of them. One that fails again failed
  // for its own reason: its own error goes back to the path, exactly as before, and the lifecycle is not blamed.
  if (second && !second.error) writeFailed(first.error, { id: ctx.requestId, source: ctx.source }, { table: ctx.table, fellBack: true });
  return second;
}

/** Test seam: forget the once-per-ten-minutes state between tests. */
function __resetForTests() {
  loudAt.clear();
  switchAnnounced = false;
}

module.exports = {
  LIFECYCLE,
  enabled,
  askColumns,
  queueColumns,
  queueEvent,
  writeWithFallback,
  recordOutcome,
  recorderThrew,
  writeFailed,
  __resetForTests,
};
