'use strict';
/**
 * Retention A (bd-sex15q.36; NIGHTLY_JOB §10, INSIGHTS_SCHEMA §4; PENDING item 7): `--purge-clips` deletes a session's
 * pre-cut clips (coachip/clips/<env>/<session>/…) and its whole-lesson MP3 (coachip/full/<env>/<session>.mp3) once the
 * last window that showed the session has been closed for more than 8 weeks, then marks the session's moments
 * `clip_status = expired` (the player says so and the coach still hears the recording itself from `lesson_s`), and
 * writes one coachip_audit_log row per run.
 *
 * "The last window that showed it": the newest 8-week window holding the session's Karachi day, on screen for the week
 * it is held (windows.js), or a later circle week that picked one of its moments; an open step set from the session or
 * one of its moments keeps it outright. A session with objects but no fact row is kept and counted, never guessed at.
 *
 * Tier safety: only the tier's own two prefixes are listed, the bucket must be the tier's own (CLIP_BUCKETS; staging and
 * production share one), and every key is re-parsed against the tier before it is deleted, so a listing that returns
 * anything else (another tier's clips, a recording) deletes nothing. Production writes stay shut (PROD_WRITES_ALLOWED).
 * A dry run lists and counts only. Logs and the counts file carry counts only: never a key, a session id or a URL.
 */
const crypto = require('crypto');
const C = require('./constants');
const win = require('./windows');
const { karachiDay } = require('./facts');

const ENVS = ['sandbox', 'staging', 'production'];
const RETENTION_DAYS = 56;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IN = 200;

class PurgeRefusal extends Error {
  constructor(reason) {
    super(`purge refused: ${reason}`);
    this.name = 'PurgeRefusal';
    this.reason = reason;
  }
}

const prefixes = (env) => [`coachip/clips/${env}/`, `coachip/full/${env}/`];

/** The tier's own clip or full-lesson key → { kind, sessionId }; anything else (another tier, a recording) → null. */
function parseKey(env, key) {
  if (!ENVS.includes(env) || typeof key !== 'string') return null;
  let m = new RegExp(`^coachip/clips/${env}/(${UUID})/[0-9]+-[0-9]+\\.mp3$`).exec(key);
  if (m) return { kind: 'clip', sessionId: m[1] };
  m = new RegExp(`^coachip/full/${env}/(${UUID})\\.mp3$`).exec(key);
  return m ? { kind: 'full', sessionId: m[1] } : null;
}

/** The last day the newest 8-week window holding `day` is on screen: its end (a Sunday) plus the week it is held for. */
function lastWindowClose(day) {
  const end = win.addDays(win.mondayOf(win.addDays(day, 56)), -1);
  return win.addDays(end, 7);
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const later = (a, b) => (!a || (b && b > a) ? b : a);

async function selectIn(store, table, column, values, columns, more = (q) => q) {
  const out = [];
  for (let i = 0; i < values.length; i += IN) out.push(...await store.select(table, (q) => more(q.in(column, values.slice(i, i + IN))), columns));
  return out;
}

async function listTier(s3, bucket, env) {
  const keys = new Set();
  for (const prefix of prefixes(env)) {
    let token;
    do {
      const page = await s3.listObjectsV2({ Bucket: bucket, Prefix: prefix, ContinuationToken: token });
      for (const o of (page && page.Contents) || []) if (o && o.Key) keys.add(o.Key);
      token = page && page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
  return keys;
}

/**
 * deps: { envName, bucket, s3: {listObjectsV2, deleteObject}, store, today ('YYYY-MM-DD', Karachi), dryRun, actorUserId,
 * log?, buckets? (C.CLIP_BUCKETS), prodWritesAllowed? (C.PROD_WRITES_ALLOWED) }. Returns the counts. Throws PurgeRefusal
 * before any R2 call when the tier, the bucket or the actor is wrong.
 */
async function runPurge({ envName, bucket, s3, store, today, dryRun, actorUserId, log = () => {}, buckets = C.CLIP_BUCKETS,
  prodWritesAllowed = C.PROD_WRITES_ALLOWED }) {
  if (!ENVS.includes(envName)) throw new PurgeRefusal('unknown environment');
  if (!buckets[envName] || bucket !== buckets[envName]) throw new PurgeRefusal('clip bucket is not this environment\'s bucket');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new PurgeRefusal('no date');
  if (!dryRun) {
    if (envName === 'production' && !prodWritesAllowed) throw new PurgeRefusal('prod writes are shut in code');
    if (typeof actorUserId !== 'string' || !new RegExp(`^${UUID}$`).test(actorUserId)) throw new PurgeRefusal('no actor for the audit row');
  }
  const runId = crypto.randomUUID();
  const n = { run_id: runId, dry_run: !!dryRun, today, retention_days: RETENTION_DAYS, objects_listed: 0, foreign_keys: 0,
    sessions_listed: 0, sessions_purged: 0, sessions_kept: 0, sessions_unknown: 0, sessions_kept_open_step: 0, sessions_failed: 0,
    objects_to_delete: 0, objects_deleted: 0, moments_to_expire: 0, moments_expired: 0 };

  // 1. what is there, by session; anything that is not the tier's own shape is counted and left alone
  const bySession = new Map();
  for (const key of await listTier(s3, bucket, envName)) {
    n.objects_listed += 1;
    const p = parseKey(envName, key);
    if (!p) { n.foreign_keys += 1; continue; }
    if (!bySession.has(p.sessionId)) bySession.set(p.sessionId, []);
    bySession.get(p.sessionId).push(key);
  }
  const sessions = [...bySession.keys()];
  n.sessions_listed = sessions.length;

  // 2. when each session was last on screen
  const facts = await selectIn(store, 'coachip_session_facts', 'session_id', sessions, 'session_id,recorded_at');
  const moments = await selectIn(store, 'coachip_moments', 'session_id', sessions, 'id,session_id,clip_status');
  const momentIds = moments.map((m) => m.id);
  const circle = await selectIn(store, 'coachip_circle_items', 'moment_id', momentIds, 'moment_id,week_start');
  const openByMoment = await selectIn(store, 'coachip_steps', 'source_moment_id', momentIds, 'source_moment_id', (q) => q.eq('status', 'open'));
  const openBySession = await selectIn(store, 'coachip_steps', 'source_session_id', sessions, 'source_session_id', (q) => q.eq('status', 'open'));
  const sessionOf = new Map(moments.map((m) => [m.id, m.session_id]));
  const shownUntil = new Map();
  for (const f of facts) {
    if (f && f.recorded_at) shownUntil.set(f.session_id, later(shownUntil.get(f.session_id), lastWindowClose(karachiDay(f.recorded_at))));
  }
  for (const c of circle) {
    const s = sessionOf.get(c.moment_id);
    if (s && shownUntil.has(s)) shownUntil.set(s, later(shownUntil.get(s), win.addDays(String(c.week_start).slice(0, 10), 6)));
  }
  const open = new Set([...openBySession.map((r) => r.source_session_id), ...openByMoment.map((r) => sessionOf.get(r.source_moment_id))]);

  // 3. purge what has been off screen for more than 8 weeks
  for (const sessionId of sessions) {
    if (!shownUntil.has(sessionId)) { n.sessions_unknown += 1; continue; }
    if (open.has(sessionId)) { n.sessions_kept_open_step += 1; n.sessions_kept += 1; continue; }
    if (daysBetween(shownUntil.get(sessionId), today) <= RETENTION_DAYS) { n.sessions_kept += 1; continue; }
    const keys = bySession.get(sessionId);
    const mine = moments.filter((m) => m.session_id === sessionId && m.clip_status !== 'expired');
    n.objects_to_delete += keys.length;
    n.moments_to_expire += mine.length;
    n.sessions_purged += 1;
    if (dryRun) continue;
    let ok = true;
    for (const key of keys) {
      // the guard again, on the exact key about to go: a key that is not this tier's own is never deleted
      if (!parseKey(envName, key) || !prefixes(envName).some((p) => key.startsWith(p))) { ok = false; continue; }
      try { await s3.deleteObject({ Bucket: bucket, Key: key }); n.objects_deleted += 1; } catch (_) { ok = false; }
    }
    if (!ok) { n.sessions_purged -= 1; n.sessions_failed += 1; continue; }
    for (const m of mine) {
      await store.update('coachip_moments', m.id, { clip_status: 'expired', clip_r2_key: null });
      n.moments_expired += 1;
    }
  }

  // 4. one audit row per run, write mode only (a dry run writes nothing anywhere)
  if (!dryRun) await store.insert('coachip_audit_log', [{ actor_user_id: actorUserId, action: 'clip_purge', subject_id: runId }]);
  log(`purge dry_run=${dryRun ? 1 : 0} listed=${n.objects_listed} foreign=${n.foreign_keys} sessions=${n.sessions_listed} `
    + `purged=${n.sessions_purged} kept=${n.sessions_kept} open_step=${n.sessions_kept_open_step} unknown=${n.sessions_unknown} `
    + `failed=${n.sessions_failed} objects_to_delete=${n.objects_to_delete} deleted=${n.objects_deleted} `
    + `moments_to_expire=${n.moments_to_expire} expired=${n.moments_expired}`);
  return n;
}

/** The R2 wiring for the purge (list and delete only), from the portal service's env, built on call. */
function r2PurgeFromEnv(env) {
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
  return {
    listObjectsV2: (o) => client.send(new ListObjectsV2Command(o)),
    deleteObject: (o) => client.send(new DeleteObjectCommand(o)),
  };
}

const WRITE_OPS = ['upsert', 'insert', 'update', 'deleteWhere'];

/** A store that reads and refuses every write: the dry run's view of the coachip_ tables (reads only, never a row out). */
function readOnlyStore(store) {
  return new Proxy(store, {
    get(target, prop, recv) {
      if (WRITE_OPS.includes(prop)) return () => { throw new Error(`read-only store: ${prop} refused in a dry run`); };
      return Reflect.get(target, prop, recv);
    },
  });
}

module.exports = { PurgeRefusal, parseKey, lastWindowClose, runPurge, r2PurgeFromEnv, readOnlyStore, RETENTION_DAYS };
