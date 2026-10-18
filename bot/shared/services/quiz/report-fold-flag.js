'use strict';
/**
 * The report's fold-by-child switch: app_settings `quiz_report_fold_by_child`. On, a child NOT on the class list is
 * one row per child (merged_into ?? student_id; the same typed name folds only on a shared phone or with no binding).
 * Only JSON `true` is on; an absent row, `false`, any other value (the strings "true" and "\"true\"", "yes", 1, {},
 * "TRUE", " true ") and a failed read are all OFF. 30 s cache.
 * Its settings read also carries the switches that ride it (settings-group; each joins from its own module), in the
 * same query, so a riding switch costs no read of its own. If that shared read fails, this key is read alone (no
 * rider rides that read) and its answer is the same; the riders answer off. A caller that read the whole group in
 * its own query hands the rows over with prime(rows, now, asked).
 */
const { logToFile } = require('../../utils/logger');
const { settingsGroup } = require('../settings-group');

const KEY = 'quiz_report_fold_by_child';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
const group = settingsGroup(KEY, [], TTL_MS);

// exactly JSON true — never a string
function isTrue(value) {
  return value === true;
}

/** → true only when the switch reads a real true. Never throws. */
async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await group.host(now);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && isTrue(data.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ teacher report: fold-by-child setting unreadable — same-name rows fold as before', { error: err && err.message });
    return false;
  }
}

/**
 * A caller that read this switch's group (`groupKeys(KEY)`) in its own query: `rows` = what it got, `asked` = the key
 * list it asked for. Throws when `asked` lacks a key of the group; an asked key with no row is off. Fills this cache
 * and the riders' at the same moment.
 */
function prime(rows, now = Date.now(), asked) {
  const data = group.prime(rows, now, asked);
  cache = { at: now, on: Boolean(data) && isTrue(data.value) };
  return cache.on;
}

/** The keys that ride this switch's read (the ones loaded in this process). */
function riders() { return group.riders(); }

/** Tests only: forget the cached reading (and the rows its read left for its riders). */
function reset() { cache = null; group.forgetAll(); }

module.exports = { on, prime, riders, reset, isTrue, KEY, TTL_MS };
