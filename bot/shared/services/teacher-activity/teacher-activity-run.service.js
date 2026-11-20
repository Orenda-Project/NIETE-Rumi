'use strict';
/**
 * One tick of the twice-a-day teacher activity job (docs/teacher-activity-store.md). The worker calls run() every
 * hour (workers/teacher-activity-schedule.js); almost every tick ends at once ("off" or "not_due").
 *
 * In order, each step a way out:
 *   1. The read replica (config/supabase-replica-only.js). None configured on this tier → off. The job never reads
 *      the primary: the switch, the region registry and every count are read on the replica. Test sites (staging,
 *      sandbox) have no paid replica and read their own database instead (supabase-replica-only.js says how).
 *   2. app_settings teacher_activity_slots, e.g. {"day":"14:30","night":"01:30"} (Pakistan times). No row, a
 *      malformed value or a failed read → off.
 *   3. A slot is due from its time for DUE_WINDOW_MIN minutes (an hourly tick always lands inside it once).
 *   4. One worker per tick (quiz-funnel-watch claimTick), then the run marker: this Pakistan date's slot already ran →
 *      done.
 *   5. The server must say it is a replica (rpc db_is_replica) → else refused, and the next tick in the window retries.
 *   6. The teacher list (rpc teacher_activity_teachers), the region registry, then batches of BATCH_SIZE ids → rpc
 *      teacher_activity_batch → the pure shaper → one Redis key per teacher (36 h). A pause between batches.
 *   7. Every batch read → the team key and the run marker. A failed batch keeps those teachers' previous values and
 *      writes neither, so the next tick in the window runs again.
 * Logged with a correlation id: counts and timings only, never a user id or a name. Never throws.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent, generateCorrelationId, runWithCorrelation } = require('../../utils/structured-logger');
const C = require('../../config/teacher-activity-contract');
const Shaper = require('./teacher-journey.service');
const Registry = require('../region-registry');
const RegionService = require('../region.service');
const { pktDate, pktHour, pktMinute } = require('../nudges/pkt-time');

const SLOTS_KEY = 'teacher_activity_slots';
const TICK_KEY = 'teacher_activity:v1:tick';
const BATCH_SIZE = 500;
const PAUSE_MS = 1000;
const DUE_WINDOW_MIN = 90;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** { day?: minutes, night?: minutes } from the switch's value, or null (off). */
function parseSlots(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [slot, time] of Object.entries(v)) {
    const m = C.SLOTS.includes(slot) && typeof time === 'string' ? HHMM.exec(time) : null;
    if (!m) return null;
    out[slot] = Number(m[1]) * 60 + Number(m[2]);
    // A slot's 90-minute window must end by midnight (dueSlot does not wrap): latest 22:30.
    if (out[slot] + DUE_WINDOW_MIN > 24 * 60) return null;
  }
  return Object.keys(out).length ? out : null;
}

/** The slot due at `now` (Pakistan time), or null. */
function dueSlot(now, slots) {
  const minute = pktHour(now) * 60 + pktMinute(now);
  return C.SLOTS.find((s) => slots[s] !== undefined && minute >= slots[s] && minute < slots[s] + DUE_WINDOW_MIN) || null;
}

async function readSlots(db) {
  try {
    const { data, error } = await db.from('app_settings').select('value').eq('key', SLOTS_KEY).maybeSingle();
    return error || !data ? null : parseSlots(data.value);
  } catch (_) {
    return null;
  }
}

async function rpcData(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message || `${name} failed`);
  return data;
}

/** { org, region }: her organization by region.service's rule, her region as the registry spells it. */
async function placementOf(db, rows, t) {
  const answer = await RegionService.regionForUser(db, { source: t.source, region: t.region, school_region: t.school_region });
  const match = (v) => rows.find((r) => Registry.regionKey(v) && (Registry.regionKey(r.region) === Registry.regionKey(v)
    || Registry.regionKey(r.display_name) === Registry.regionKey(v)));
  const row = match(t.region) || match(t.school_region);
  return { org: RegionService.ORGANIZATION[answer] || null, region: row ? row.display_name : null };
}

/** The teacher list and the region registry; throws when either cannot be read. */
async function readRoster(db) {
  const teachers = await rpcData(db, 'teacher_activity_teachers');
  if (!Array.isArray(teachers)) throw new Error('teacher list is not a list');
  return { teachers, rows: await Registry.listRegions(db) };
}

async function countAll({ db, redis, now, slot, sleep, batchSize, pauseMs, teachers, rows }) {
  const byId = new Map(teachers.filter((t) => t && t.id).map((t) => [t.id, t]));
  const ids = [...byId.keys()];
  const entries = [];
  let batches = 0; let failedBatches = 0; let written = 0; let unusable = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    if (i > 0) await sleep(pauseMs);
    batches += 1;
    let result;
    try {
      result = (await rpcData(db, 'teacher_activity_batch', { p_user_ids: ids.slice(i, i + batchSize) })) || [];
    } catch (err) {
      failedBatches += 1;
      logToFile('⚠️ Teacher activity: a batch failed — those teachers keep their previous numbers', { batch: batches, error: err && err.message }, 'warn');
      continue;
    }
    for (const r of result) {
      const t = byId.get(r && r.user_id);
      const value = t ? Shaper.shapeTeacher(r, { now: now.getTime(), slot, teacher: t }) : null;
      if (!value) { unusable += 1; continue; }
      await redis.set(C.teacherActivityKey(t.id), value, C.TTL_SECONDS);
      written += 1;
      entries.push({ userId: t.id, value, who: { ...(await placementOf(db, rows, t)), name: t.name, school: t.school } });
    }
  }
  return { teachers: ids.length, batches, failedBatches, written, unusable, entries };
}

async function tick({ now, redis, db, sleep, batchSize, pauseMs }) {
  if (!db) return { outcome: 'off', reason: 'no_replica' };
  // The replica check comes before ANY other read: a URL pointing at the primary by mistake gets nothing else.
  const { checkReplica } = require('../../config/supabase-replica-only');
  const check = await checkReplica(db);
  if (!check.ok) {
    logToFile('⚠️ Teacher activity: refused — not reading a replica; old numbers stay', { reason: check.reason }, 'warn');
    return { outcome: 'refused', reason: check.reason };
  }
  const slots = await readSlots(db);
  if (!slots) return { outcome: 'off', reason: 'no_slots' };
  const slot = dueSlot(now, slots);
  if (!slot) return { outcome: 'not_due' };

  const { claimTick } = require('../monitoring/quiz-funnel-watch.service');
  const claim = await claimTick(redis, { tickMin: 60 }, TICK_KEY);
  if (claim !== 'owner') return { outcome: 'skipped', reason: claim, slot };
  const marker = C.runMarkerKey(pktDate(now), slot);
  if (await redis.get(marker)) return { outcome: 'done_already', slot };

  const started = Date.now();
  let roster;
  try {
    roster = await readRoster(db);
  } catch (err) {
    logToFile('❌ Teacher activity: the teacher list could not be read — nothing written', { slot, error: err && err.message }, 'error');
    return { outcome: 'read_failed', slot };
  }
  const { entries, ...counts } = await countAll({ db, redis, now, slot, sleep, batchSize, pauseMs, ...roster });
  let outcome = 'partial';
  if (counts.failedBatches === 0) {
    const team = Shaper.buildTeam(entries, { now: now.getTime() });
    if (team) await redis.set(C.TEAM_ACTIVITY_KEY, team, C.TTL_SECONDS);
    await redis.set(marker, now.toISOString(), C.TTL_SECONDS);
    outcome = 'ran';
  }
  const summary = { outcome, slot, ...counts, ms: Date.now() - started };
  logEvent(`teacher_activity.run.${outcome}`, summary);
  return summary;
}

/**
 * @param {{ now?: Date, redis?: object, db?: object|null, sleep?: (ms:number)=>Promise<void>, batchSize?: number,
 *   pauseMs?: number }} deps all injectable; db defaults to the replica client (null when none is configured).
 */
async function run(deps = {}) {
  const {
    now = new Date(),
    redis = require('../cache/railway-redis.service'),
    db = require('../../config/supabase-replica-only').replicaClient(),
    sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }),
    batchSize = BATCH_SIZE,
    pauseMs = PAUSE_MS,
  } = deps;
  return runWithCorrelation(generateCorrelationId(), async () => {
    try {
      return await tick({ now, redis, db, sleep, batchSize, pauseMs });
    } catch (err) {
      logToFile('❌ Teacher activity: the run stopped', { error: err && err.message }, 'error');
      return { outcome: 'error' };
    }
  });
}

module.exports = { run, parseSlots, dueSlot, SLOTS_KEY, TICK_KEY, BATCH_SIZE, PAUSE_MS, DUE_WINDOW_MIN };
