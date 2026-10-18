'use strict';
/**
 * A grown-up changes the child's grade, for good (app_settings web_quiz_grade_change, default off, fail off).
 *
 * On: the hub answer carries `grownups.grade = { now, cls }` for the chosen child (now: the grade the hub goes by, the
 * family's own choice first; cls: the class grade when the child is on a teacher's class or list, else null), and the
 * grown-ups sheet (dashboard wq-home.js) shows a Grade row whose chips post set(). The grade is kept in the existing
 * students.self_reported_class as 'Grade N', the hub's grade wherever the child has no class; a class child's class
 * still wins for class quizzes, the class table and the league (web-quiz-challenge.js gradeInfo order, unchanged).
 * child_identity.fixed_grade, the year's measured grade, is never read or written here. Off: the key is absent, so
 * every hub answer is today's, byte for byte, and set() answers 404. Only the stored JSON boolean true turns it on.
 *
 * The key rides the hub switches' one app_settings read (web-quiz-hub-flags.js): carry() looks at that cache once the
 * hub answer is in (no read of its own; cold or expired is off); set() asks the same shared read (30 s cache).
 *
 *   on()                                the switch, never waited for and never read here
 *   carry(hubAnswerP, token)            the hub answer with grownups.grade while on; untouched while off
 *   set({ token, kid, device, grade })  the write: {ok: true, grade}, else a WqError (400 / 403 / 404 / 429)
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./web-quiz-hub-flags');
const T = require('./web-quiz-token');

const KEY = Flags.GRADE_CHANGE_KEY;
const FIELD = 'grade';
// The grades the child app serves everywhere (the Stories chips, the challenge bands, the fixed_grade CHECK).
const GRADES = Object.freeze([1, 2, 3, 4, 5]);
const DAY_MAX = 5;                         // changes per child per Pakistan day; more answer 429
const PKT_MS = 5 * 3600 * 1000;
const COUNT_TTL_S = 48 * 3600;             // the day's counter outlives its day

const fail = (status, error) => { const { WqError } = require('./web-quiz.service'); throw new WqError(status, { error }); };
// The one grade 1-5 a stored class names ('Grade 3', 'Class 3'), else null (a band, two numbers, KG, 6).
const gradeOf = (v) => { const m = /^\D*(\d+)\D*$/.exec(String(v == null ? '' : v)); const n = m ? Number(m[1]) : null; return GRADES.includes(n) ? n : null; };
const pktDay = (now = Date.now()) => new Date(now + PKT_MS).toISOString().slice(0, 10);

/** The switch, never waited for and never read here. Never throws. */
function on(now = Date.now()) {
  try { return Flags.nowOf('gradeChange', now); } catch (_) { return false; }
}

/** The switch from the hub switches' shared read (30 s cache), for a write that may come after the cache went cold. */
async function onNow() {
  try { return Boolean((await Flags.flags()).gradeChange); } catch (_) { return false; }
}

/**
 * The child a hub chip names on this token: { studentId, rawIds } (rawIds: the token's own ids behind the chip), or
 * null. A chip may name a folded id (web_quiz_identity_canon), resolved through the token's ids as kidFromHub does.
 */
async function chipChild(token, chip) {
  const tok = T.verify(token, 'h');
  if (!tok || !Array.isArray(tok.ids) || !tok.ids.length || !chip) return null;
  const raw = tok.ids.map(String);
  let rawIds = raw.filter((id) => T.chipId('h', id) === String(chip));
  if (rawIds.length) return { studentId: rawIds[0], rawIds };
  if (!(await require('./web-quiz-identity-flags').flags()).canon) return null;
  const canon = await require('./web-quiz-identity-roster').canonicalStudentIds(raw);
  rawIds = raw.filter((id) => T.chipId('h', canon.get(id) || id) === String(chip));
  return rawIds.length ? { studentId: canon.get(rawIds[0]) || rawIds[0], rawIds } : null;
}

/** The child's own row: a merged record's merged_into target (one hop, as the roster folds it), or null. */
async function ownRow(studentId) {
  const cols = 'id, self_reported_class, is_active, merged_into, status';
  const one = async (id) => {
    const { data, error } = await supabase.from('students').select(cols).eq('id', id).maybeSingle();
    if (error) throw new Error(error.message || 'students read failed');
    return data || null;
  };
  const row = await one(studentId);
  if (row && row.merged_into && String(row.merged_into) !== String(row.id)) return one(row.merged_into);
  return row;
}

/** { now, cls } for this row: the family's grade first, else the hub's own source order; the class grade apart. */
async function gradesOf(row) {
  const gi = await require('./web-quiz-challenge').gradeInfo({ studentId: row.id });
  const hub = GRADES.includes(Number(gi.grade)) ? Number(gi.grade) : null;
  const cls = gi.source === 'enrolment' || gi.source === 'list' ? hub : null;
  return { now: gradeOf(row.self_reported_class) || hub, cls };
}

/**
 * A hub answer (or its promise) with `grownups.grade` for its chosen child while on, merged into any `grownups` the
 * hub already sent; the same answer, untouched, while off, with no chosen child, on a locked page or a coach's preview.
 * A failed read leaves the answer as it came.
 */
function carry(hubAnswerP, token) {
  return Promise.resolve(hubAnswerP).then(async (out) => {
    if (!on() || !out || typeof out !== 'object' || Array.isArray(out) || !out.kid || out.locked || out.practice) return out;
    try {
      const who = await chipChild(token, out.kid);
      const row = who ? await ownRow(who.studentId) : null;
      if (!row || row.is_active === false) return out;
      const grade = await gradesOf(row);
      out.grownups = Object.assign(out.grownups && typeof out.grownups === 'object' ? out.grownups : {}, { [FIELD]: grade });
    } catch (err) {
      logToFile('⚠️ web quiz grade change: no grade on the hub answer', { error: err.message });
    }
    return out;
  });
}

// When Redis cannot count, this process counts (lost on a restart, per instance): the ceiling still holds on one box.
const localCounts = new Map();
function localIncr(key, now) {
  if (localCounts.size > 5000) for (const [k, v] of localCounts) if (v.exp <= now) localCounts.delete(k);
  const cur = localCounts.get(key);
  const next = cur && cur.exp > now ? { n: cur.n + 1, exp: cur.exp } : { n: 1, exp: now + COUNT_TTL_S * 1000 };
  localCounts.set(key, next);
  return next.n;
}

/** This change counted against the child's day: true while within DAY_MAX. Keyed on a hash, never the raw id. */
async function underDayCap(childId, now = Date.now()) {
  const key = `wq:grade_set:${pktDay(now)}:${crypto.createHash('sha256').update(String(childId)).digest('hex').slice(0, 32)}`;
  const redis = require('../cache/railway-redis.service');
  let n = null;
  try { n = await redis.incr(key); } catch (_) { n = null; }
  if (n === null || n === undefined || !Number.isFinite(Number(n))) n = localIncr(key, now);
  else if (Number(n) === 1) { try { await redis.expire(key, COUNT_TTL_S); } catch (_) { /* the count still holds */ } }
  return Number(n) <= DAY_MAX;
}

/**
 * A grown-up's grade for the child a hub chip names, written for good: students.self_reported_class = 'Grade N' on
 * the child's own row. Guards, in order: the switch (404), a whole number 1-5 (400), the chip is one of the token's
 * children (403), this phone is trusted for that child (403, as "Keep my place"), at most DAY_MAX changes a day (429).
 * The same grade again writes nothing and is not counted.
 */
async function set({ token, kid, device, grade } = {}) {
  if (!(await onNow())) fail(404, 'not_found');
  if (typeof grade !== 'number' || !GRADES.includes(grade)) fail(400, 'bad_grade');
  const who = await chipChild(token, kid);
  if (!who) fail(403, 'not_your_child');
  const trust = await require('./web-quiz-hub-device').deviceTrusted(token, device);
  if (!trust || !trust.ok || !who.rawIds.some((id) => (trust.ids || []).map(String).includes(id))) fail(403, 'other_device');
  let row;
  try { row = await ownRow(who.studentId); } catch (_) { fail(502, 'db_unavailable'); }
  if (!row || row.is_active === false) fail(403, 'not_your_child');
  const before = await gradesOf(row);
  if (gradeOf(row.self_reported_class) === grade) return { ok: true, grade };
  if (!(await underDayCap(row.id))) fail(429, 'try_tomorrow');
  const { error } = await supabase.from('students').update({ self_reported_class: `Grade ${grade}` }).eq('id', row.id);
  if (error) {
    logToFile('❌ web quiz grade change: write failed', { error: error.message }, 'error');
    fail(502, 'db_unavailable');
  }
  // The next hub answer reads the new grade: the child's shared rows and the roster lookups for each of its ids go.
  const ids = [...new Set([...who.rawIds, String(who.studentId), String(row.id)])];
  try {
    require('./web-quiz-hub-child-rows').forget(ids);
    const Roster = require('./web-quiz-identity-roster');
    ids.forEach((id) => Roster.forgetChild(id));
  } catch (_) { /* a cache that could not be dropped runs out by itself (30 s) */ }
  logEvent('web_quiz.grade_set', { kid_hash: require('./web-quiz-kid').kid(row.id), from: before.now, to: grade, class_grade: before.cls, via: 'grownups' });
  return { ok: true, grade };
}

module.exports = { on, carry, set, KEY, FIELD, GRADES, DAY_MAX };
