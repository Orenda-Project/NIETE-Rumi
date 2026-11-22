'use strict';
/**
 * The standing class link's canary: app_settings `web_quiz_class_link_canary` = {"regions": [...], "school_ids": [...],
 * "class_ids": [...]}, the same shape and sector rule as the reminders' web_quiz_push_canary (regions = schools.region,
 * the ICT sector, matched exactly after trim), so both canaries name the same sector. While it lists anything, only the
 * listed classes, the classes of the listed schools, or of a school in a listed sector get the class-link surfaces that
 * reach out on their own: the evening round's writer and the teacher app's class-link card. No row, or empty lists:
 * every class. A failed read: no class (fail closed: a database blip pauses new exposure, it never widens it).
 * 30 s cache. Never throws.
 * A teacher opening the report's class tab, and a link already forwarded, are not gated: they are the teacher's own act.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const CANARY_KEY = 'web_quiz_class_link_canary';
const TTL_MS = 30 * 1000;
const CHUNK = 200;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idsOf = (v) => (Array.isArray(v) ? v.map(String).filter((x) => UUID_RX.test(x)) : []);
const namesOf = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x && x.length <= 64) : []);
const CLOSED = 'closed';
let cache = null; // { at, c }: c = null (every class) | CLOSED | { schools: Set, classes: Set, regions: Set }

async function scope(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.c;
  let c;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', CANARY_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    let v = data && data[0] ? data[0].value : null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const schools = idsOf(o.school_ids);
    const classes = idsOf(o.class_ids);
    const regions = namesOf(o.regions);
    c = schools.length || classes.length || regions.length
      ? { schools: new Set(schools), classes: new Set(classes), regions: new Set(regions) } : null;
  } catch (err) {
    logToFile('⚠️ class link canary: settings lookup failed — no class in the canary', { error: err.message });
    c = CLOSED;
  }
  cache = { at: now, c };
  return c;
}

/** The subset of `classIds` inside the canary, as a Set of ids. Reads classes (and schools for sectors) only when needed. */
async function allowedClasses(classIds) {
  const want = [...new Set((classIds || []).filter(Boolean).map(String))];
  const out = new Set();
  if (!want.length) return out;
  const c = await scope();
  if (c === null) { want.forEach((id) => out.add(id)); return out; }
  if (c === CLOSED) return out;
  want.filter((id) => c.classes.has(id)).forEach((id) => out.add(id));
  const rest = want.filter((id) => !out.has(id));
  if (!rest.length || !(c.schools.size || c.regions.size)) return out;
  try {
    const schoolOf = new Map();
    for (let i = 0; i < rest.length; i += CHUNK) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('classes').select('id, school_id').in('id', rest.slice(i, i + CHUNK));
      if (error) throw new Error(error.message || 'classes read failed');
      (data || []).forEach((r) => { if (r.school_id) schoolOf.set(String(r.id), String(r.school_id)); });
    }
    rest.forEach((id) => { if (c.schools.has(schoolOf.get(id))) out.add(id); });
    const left = rest.filter((id) => !out.has(id) && schoolOf.has(id));
    if (left.length && c.regions.size) {
      const inSector = await sectorSchools([...new Set(left.map((id) => schoolOf.get(id)))], c.regions);
      left.forEach((id) => { if (inSector.has(schoolOf.get(id))) out.add(id); });
    }
  } catch (err) {
    logToFile('⚠️ class link canary: class read failed — those classes stay out', { error: err.message });
  }
  return out;
}

/** The ids among `schoolIds` whose schools.region (trimmed) is a listed sector. Throws on a read error. */
async function sectorSchools(schoolIds, regions) {
  const out = new Set();
  for (let i = 0; i < schoolIds.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('schools').select('id, region').in('id', schoolIds.slice(i, i + CHUNK));
    if (error) throw new Error(error.message || 'schools read failed');
    (data || []).forEach((r) => { if (r.region && regions.has(String(r.region).trim())) out.add(String(r.id)); });
  }
  return out;
}

/** One class: inside the canary? `schoolId` saves the classes read when the caller already has it. */
async function inCanary({ classId, schoolId = null } = {}) {
  if (!classId) return false;
  const c = await scope();
  if (c === null) return true;
  if (c === CLOSED) return false;
  if (c.classes.has(String(classId))) return true;
  if (!(c.schools.size || c.regions.size)) return false;
  if (!schoolId) return (await allowedClasses([classId])).has(String(classId));
  if (c.schools.has(String(schoolId))) return true;
  if (!c.regions.size) return false;
  try {
    return (await sectorSchools([String(schoolId)], c.regions)).has(String(schoolId));
  } catch (err) {
    logToFile('⚠️ class link canary: school read failed — the class stays out', { error: err.message });
    return false;
  }
}

module.exports = { inCanary, allowedClasses, CANARY_KEY, _resetCache: () => { cache = null; } };
