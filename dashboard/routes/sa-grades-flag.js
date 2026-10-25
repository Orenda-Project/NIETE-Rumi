'use strict';
/**
 * A switch whose value names grades (round 6, sa_guided_instructions; DESIGN_R6 §6): app_settings JSON `true` means
 * [1, 2, 3]; a JSON array of grades means those grades (each an integer 1-5); anything else (no row, a string, an
 * empty or bad array, a failed read, no client) is OFF (null). Same cache rule as routes/web-quiz-brotli-flag.js: never
 * reads per request, at most one read per 30 s, the first answers after a start are OFF until that read lands.
 */
const TTL_MS = 30 * 1000;
const ALL = [1, 2, 3];

/** The stored value → a sorted list of grades, or null (OFF). */
function gradesOf(value) {
  if (value === true) return ALL.slice();
  if (!Array.isArray(value) || !value.length) return null;
  if (!value.every((g) => Number.isInteger(g) && g >= 1 && g <= 5)) return null;
  return [...new Set(value)].sort((a, b) => a - b);
}

/** createGradesFlag({ db, now, key }) → grades() (a list or null); grades.ready() for tests and the first request. */
function createGradesFlag({ db = () => require('../config/supabase'), now = Date.now, key } = {}) {
  let at = -Infinity;
  let val = null;
  let reading = null;
  async function read() {
    try {
      const client = db();
      if (!client) return null;
      const { data, error } = await client.from('app_settings').select('value').eq('key', key).maybeSingle();
      return !error && data ? gradesOf(data.value) : null;
    } catch (_) {
      return null;
    }
  }
  function grades() {
    if (!reading && now() - at >= TTL_MS) {
      at = now();
      const job = read().then((next) => { val = next; }, () => { val = null; }).then(() => { at = now(); if (reading === job) reading = null; });
      reading = job;
    }
    return val ? val.slice() : null;
  }
  grades.ready = () => reading || Promise.resolve();
  return grades;
}

module.exports = { TTL_MS, gradesOf, createGradesFlag };
