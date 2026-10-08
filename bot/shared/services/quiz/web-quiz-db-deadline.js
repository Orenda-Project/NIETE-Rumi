'use strict';
/**
 * A deadline and ONE retry for the web quiz's own database READS (app_settings web_quiz_db_deadline, default off).
 *
 * At the evening peak a few reads hung 16–50 s in transit between the bot and the database while the database
 * itself answered in milliseconds; the portal gives up at 10 s and the child sees an error. The same read sent
 * again comes back in well under a second. So, with the flag on, each read wrapped here gets DEADLINE_MS per attempt
 * and is sent once more if that attempt overran it; a second overrun ends the request with the 502 db_unavailable
 * the page already handles (logged web_quiz.db_retry {label, outcome, ms, deadline_ms}). Off: the read runs exactly
 * as before.
 *
 *   read(label, build)  build(client) returns ONE supabase read (select / head count). Writes (insert, update,
 *                       upsert, delete, rpc) are not idempotent: never pass one. If one arrives anyway it runs once,
 *                       untouched, with no deadline and no retry.
 *
 * Only the web-quiz request path calls this. The shared client and its other callers are untouched (the stale-session
 * sweep and the clip-cap count legitimately take longer than the deadline).
 *
 * Flag value: true | {"enabled": true, "ms": 4000}. Read at most once a minute, fail closed; after the first load it
 * refreshes in the background, so a slow settings read never holds a child's request.
 *
 * To measure it on a test tier, {"enabled": true, "inject": "<label>"} holds that read's FIRST attempt for the deadline
 * (the request is never sent), then the retry runs for real and logs injected: true. Ignored when NODE_ENV=production.
 */
const supabase = require('../../config/supabase');
const { logEvent } = require('../../utils/structured-logger');
const { WqError } = require('./web-quiz-error');

const FLAG_KEY = 'web_quiz_db_deadline';
const FLAG_TTL_MS = 60 * 1000;
const FLAG_READ_MS = 2000;
const DEADLINE_MS = 4000;
const READ_METHODS = new Set(['GET', 'HEAD']);

const OFF = { on: false, ms: DEADLINE_MS, inject: null };
let flag = null;        // { at, on, ms }
let loading = null;

function parse(v) {
  if (v === true || v === 'true') return { on: true, ms: DEADLINE_MS, inject: null };
  if (v && typeof v === 'object' && v.enabled === true) {
    const ms = Number(v.ms);
    return {
      on: true,
      ms: Number.isFinite(ms) ? Math.min(4500, Math.max(1000, Math.round(ms))) : DEADLINE_MS,
      inject: typeof v.inject === 'string' ? v.inject.slice(0, 60) : null,
    };
  }
  return OFF;
}

async function load() {
  try {
    let q = supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY]);
    if (typeof q.abortSignal === 'function') q = q.abortSignal(AbortSignal.timeout(FLAG_READ_MS));
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    flag = { at: Date.now(), ...parse(row && row.value) };
  } catch (_) {
    flag = { at: Date.now(), ...(flag ? { on: flag.on, ms: flag.ms, inject: flag.inject } : OFF) };
  } finally {
    loading = null;
  }
  return flag;
}

async function settings() {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag;
  if (!loading) loading = load();
  return flag || loading;       // stale value while it refreshes; only the very first read waits
}

/** One attempt with its own deadline. `hung` = our deadline fired (a transit stall), not an answer from the database. */
async function attempt(q, ms) {
  const ac = new AbortController();
  let hung = false;
  const timer = setTimeout(() => { hung = true; ac.abort(); }, ms);
  try {
    const res = await q.abortSignal(ac.signal);
    return { res, hung };
  } catch (e) {
    if (hung) return { res: null, hung };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** The injected stall: wait out the deadline without sending anything, as a hung request would. */
const held = (ms) => new Promise((resolve) => { setTimeout(() => resolve({ res: null, hung: true }), ms); });

async function read(label, build) {
  const cfg = await settings();
  const first = build(supabase);
  if (!cfg.on || !first || !READ_METHODS.has(first.method) || typeof first.abortSignal !== 'function') return first;
  const t0 = Date.now();
  const injected = Boolean(cfg.inject) && cfg.inject === label && process.env.NODE_ENV !== 'production';
  const a = injected ? await held(cfg.ms) : await attempt(first, cfg.ms);
  if (!a.hung) return a.res;
  const b = await attempt(build(supabase), cfg.ms);
  const ev = { label: String(label).slice(0, 60), outcome: b.hung ? 'failed' : 'recovered', ms: Date.now() - t0, deadline_ms: cfg.ms };
  if (injected) ev.injected = true;
  logEvent('web_quiz.db_retry', ev);
  if (b.hung) throw new WqError(502, { error: 'db_unavailable' });
  return b.res;
}

module.exports = { read, FLAG_KEY, DEADLINE_MS, _reset: () => { flag = null; loading = null; } };
