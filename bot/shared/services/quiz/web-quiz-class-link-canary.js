'use strict';
/**
 * The standing class link's canary: app_settings `web_quiz_class_link_canary` = {"school_ids": [...], "class_ids": [...]}.
 * While it lists at least one id, only the listed classes (or the classes of the listed schools: one geographic sector is
 * its schools) get the class-link surfaces that reach out on their own: the evening round's writer and the teacher app's
 * class-link card. No row, or empty lists: every class. A failed read: no class (fail closed: a database blip pauses new
 * exposure, it never widens it). 30 s cache. Never throws.
 * A teacher opening the report's class tab, and a link already forwarded, are not gated: they are the teacher's own act.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const CANARY_KEY = 'web_quiz_class_link_canary';
const TTL_MS = 30 * 1000;
const CHUNK = 200;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idsOf = (v) => (Array.isArray(v) ? v.map(String).filter((x) => UUID_RX.test(x)) : []);
const CLOSED = 'closed';
let cache = null; // { at, c }: c = null (every class) | CLOSED | { schools: Set, classes: Set }

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
    c = schools.length || classes.length ? { schools: new Set(schools), classes: new Set(classes) } : null;
  } catch (err) {
    logToFile('⚠️ class link canary: settings lookup failed — no class in the canary', { error: err.message });
    c = CLOSED;
  }
  cache = { at: now, c };
  return c;
}

/** The subset of `classIds` inside the canary, as a Set of ids. One classes read only when the canary lists schools. */
async function allowedClasses(classIds) {
  const want = [...new Set((classIds || []).filter(Boolean).map(String))];
  const out = new Set();
  if (!want.length) return out;
  const c = await scope();
  if (c === null) { want.forEach((id) => out.add(id)); return out; }
  if (c === CLOSED) return out;
  want.filter((id) => c.classes.has(id)).forEach((id) => out.add(id));
  const rest = want.filter((id) => !out.has(id));
  if (!rest.length || !c.schools.size) return out;
  try {
    for (let i = 0; i < rest.length; i += CHUNK) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('classes').select('id, school_id').in('id', rest.slice(i, i + CHUNK));
      if (error) throw new Error(error.message || 'classes read failed');
      (data || []).forEach((r) => { if (r.school_id && c.schools.has(String(r.school_id))) out.add(String(r.id)); });
    }
  } catch (err) {
    logToFile('⚠️ class link canary: class read failed — those classes stay out', { error: err.message });
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
  if (schoolId) return c.schools.has(String(schoolId));
  if (!c.schools.size) return false;
  return (await allowedClasses([classId])).has(String(classId));
}

module.exports = { inCanary, allowedClasses, CANARY_KEY, _resetCache: () => { cache = null; } };
