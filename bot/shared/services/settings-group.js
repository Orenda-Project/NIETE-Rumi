'use strict';
/**
 * One app_settings read for a switch and the switches that ride it.
 *
 * `settingsGroup(hostKey, riderKeys, ttl)` → the host key's group (one per host key in this process; a rider joins
 * it from its own module, so riders added by different modules share the host's one read). The group's keys,
 * `[host, ...riders]`, are the unit:
 * - `host(now)`: the host switch's own read. With riders it is ONE query, `.in('key', [host, ...riders])`, and it
 *   fills every rider's row at the same moment, so a host read always primes its riders. With no rider it is the
 *   host's own `.eq('key', host).maybeSingle()`, exactly as before. A failed shared read re-reads the HOST ALONE (no
 *   rider rides a fallback read), and every rider answers off (no row) for ttl, like a normal read.
 * - `prime(rows, now, asked)`: a caller outside the host that read the group's keys in its own query hands over the
 *   rows it got and the key list it ASKED for. `asked` must hold every key of the group, or it throws (a prime that
 *   carries only the host can never leave a rider cold, i.e. a rider switched on that stays off). An asked key with
 *   no row is an absent setting: off. It fills the riders' rows and returns the host's row for the host to keep.
 * - `rider(key, now)`: a riding switch's read. It answers from the row its host's read (or a prime) left, while that
 *   row is younger than ttl. Otherwise (its host has not read within ttl) it reads its own key alone: one read, never
 *   an answer from a host read older than ttl. That read, or its failure (off), is kept for ttl.
 * - `seen(key)`: the rider's last row and when it was read, with no read (null when none is held); a caller that
 *   must cost nothing decides its own age limit.
 * Rows are found by key, never by position. Reads answer in the shape of `.maybeSingle()`: `{ data: row | null,
 * error }`. Rows are raw: each switch keeps its own rule for what counts as on, and its own cache and log line.
 * `groupKeys(hostKey)` → the keys a caller must ask for to prime that group (`[hostKey]` when it has no rider).
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

const DEFAULT_TTL_MS = 30 * 1000;
const groups = new Map(); // host key → { host, riders: Set, ttl }
const rows = new Map(); // rider key → { at, ttl, data }

const keysOf = (group) => [group.host, ...group.riders];
const rowOf = (list, key) => (Array.isArray(list) ? list : []).find((r) => r && r.key === key) || null;

function ownRead(key) {
  return supabase.from('app_settings').select('key, value').eq('key', key).maybeSingle();
}

function fill(group, list, now) {
  for (const key of group.riders) rows.set(key, { at: now, ttl: group.ttl, data: rowOf(list, key) });
}

async function readHost(group, now) {
  if (group.riders.size) {
    const keys = keysOf(group);
    try {
      const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
      if (error) throw new Error(error.message || 'app_settings read failed');
      fill(group, data, now);
      return { data: rowOf(data, group.host), error: null };
    } catch (err) {
      logToFile('⚠️ settings: shared switch read failed — the host switch reads its own key, its riders are off', { keys, error: err && err.message });
      fill(group, [], now);
    }
  }
  return ownRead(group.host);
}

function prime(group, given, now, asked) {
  const list = Array.isArray(asked) ? asked : [];
  const missing = keysOf(group).filter((key) => !list.includes(key));
  if (missing.length) throw new Error(`settings group ${group.host}: a prime must ask for every key (missing ${missing.join(', ')})`);
  fill(group, given, now);
  return rowOf(given, group.host);
}

async function readRider(group, key, now) {
  const row = rows.get(key);
  if (row && now - row.at < row.ttl) return { data: row.data, error: null };
  try {
    const res = await ownRead(key);
    rows.set(key, { at: now, ttl: group.ttl, data: (res && !res.error && res.data) || null });
    return res;
  } catch (err) {
    rows.set(key, { at: now, ttl: group.ttl, data: null });
    return { data: null, error: { message: (err && err.message) || 'app_settings read failed' } };
  }
}

function settingsGroup(hostKey, riderKeys = [], ttl = DEFAULT_TTL_MS) {
  let group = groups.get(hostKey);
  if (!group) {
    group = { host: hostKey, riders: new Set(), ttl };
    groups.set(hostKey, group);
  }
  for (const key of riderKeys) group.riders.add(key);
  return {
    KEY: hostKey,
    keys: () => keysOf(group),
    riders: () => [...group.riders],
    host: (now = Date.now()) => readHost(group, now),
    prime: (given, now = Date.now(), asked) => prime(group, given, now, asked),
    rider: (key, now = Date.now()) => readRider(group, key, now),
    /** A rider's last row as this process holds it, with NO read: `{ at, data }`, or null when none is held. */
    seen: (key) => { const row = rows.get(key); return row ? { at: row.at, data: row.data } : null; },
    /** Tests only: forget one rider's row. */
    forget: (key) => { rows.delete(key); },
    /** Tests only: forget every rider row of this group. */
    forgetAll: () => { for (const key of group.riders) rows.delete(key); },
  };
}

function groupKeys(hostKey) {
  const group = groups.get(hostKey);
  return group ? keysOf(group) : [hostKey];
}

module.exports = { settingsGroup, groupKeys, DEFAULT_TTL_MS };
