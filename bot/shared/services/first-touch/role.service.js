'use strict';
/**
 * WHO IS HOLDING THIS PHONE — the one door's answer, decided on the server before any reply and again when the page
 * lands (the token's side is only what the bot thought; the server re-reads, every time).
 *
 * The order, first match wins:
 *   1  identity / activity (student-ingress-identity identity() + activity(): registration, a name, a school, role
 *      coach or principal, owns a quiz / coaching session / lesson plan / list / training / assessment, an active
 *      class) → teacher. Never "a users row exists": getOrCreateUser makes one for every phone that writes.
 *   2  a live child_phone_bindings row on this phone (web_quiz_phone_bind on)                      → child (bound)
 *   3  a chat-joined students row keyed by this phone (StudentMode.quizStudentsForPhone)           → child (roster)
 *   3b the class-roster record: active roster rows whose parent_phone is this phone, on a list of this school year,
 *      in ONE school, at most 4 children                                                            → child (family)
 *      (read only: the binding a "Yes, it's me" makes lives in child_phone_bindings, never on the roster row)
 *   4  our remembered page answer: door.keys quiz_door_teacher / quiz_door_child (≤ 90 days, newest wins,
 *      decideDoor) — teacher key → teacher; child key alone → the join screen (the "who" is never re-asked)
 *   5  nothing → unknown (the page asks once)
 *
 * decideRole is pure; resolveRole is the one read. A read that FAILS is never "no": rung 1 failing answers `unknown`
 * with src 'error' (the page then asks rather than guess a child into a teacher's home or the reverse), and every other
 * failed rung is skipped as absent. Nothing here writes anything — except writeRoleAnswer, the page's one writer.
 *
 * A sandbox walk-through persona (switch quiz_test_personas, listed test phones only): `fresh` skips rungs 1, 3 and 3b
 * and counts only the door answers given since the walk began; `teacher_empty` answers teacher. Off → no effect.
 *
 * → { role: 'teacher'|'child'|'unknown', side: 'teacher'|'child'|'join'|'unknown', src, uid, children: [ids],
 *     kids: [{ id, first }], lang, persona? }  src ∈ identity | activity | bound | roster | family | key | none | error | persona
 *     (`kids` carries first names only, for the "Is it <First>?" sheet; never a surname, a school or a phone)
 */
const { logToFile } = require('../../utils/logger');

const SIDES = Object.freeze(['teacher', 'child', 'join', 'unknown']);
const SRCS = Object.freeze(['identity', 'activity', 'bound', 'roster', 'family', 'key', 'none', 'error', 'persona']);
// The sandbox walk-through personas (switch quiz_test_personas; its own module): looked up by name, so this file runs
// the same with or without it; get() answers null whenever that switch is off.
const PERSONA_MODULE = './test-persona';
const MAX_KIDS = 4;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The first word of a name: the only part of a child's name the door ever shows. */
const firstOf = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const kidsOf = (rows) => {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const id = String((r && r.id) || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, first: firstOf(r.student_name) });
  }
  return out;
};

/** 1 April 00:00 PKT that starts the school year `now` falls in (the bindings' clock). */
function schoolYearStart(now = new Date()) {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = pkt.getUTCMonth() >= 3 ? pkt.getUTCFullYear() : pkt.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1) - PKT_OFFSET_MS);
}

/**
 * The decision, pure.
 * @param {{teacher?: 'identity'|'activity'|null, failed?: boolean, bound?: object[], roster?: object[], family?: object[],
 *          door?: string|null}} facts   bound/roster/family: [{id, first}] (or ids); door: decideDoor's answer or null
 */
function decideRole({ teacher = null, failed = false, bound = [], roster = [], family = [], door = null } = {}) {
  const kid = (src, list) => {
    const kids = list.slice(0, MAX_KIDS).map((k) => (typeof k === 'string' ? { id: k, first: '' } : k));
    return { role: 'child', side: 'child', src, children: kids.map((k) => k.id), kids };
  };
  if (teacher) return { role: 'teacher', side: 'teacher', src: teacher, children: [], kids: [] };
  if (failed) return { role: 'unknown', side: 'unknown', src: 'error', children: [], kids: [] };
  if (bound && bound.length) return kid('bound', bound);
  if (roster && roster.length) return kid('roster', roster);
  if (family && family.length) return kid('family', family);
  if (door === 'maker') return { role: 'teacher', side: 'teacher', src: 'key', children: [], kids: [] };
  if (door === 'family') return { role: 'child', side: 'join', src: 'key', children: [], kids: [] };
  return { role: 'unknown', side: 'unknown', src: 'none', children: [], kids: [] };
}

/** The page language for this person: Urdu when they wrote in Arabic script or chose Urdu; else bilingual. */
function langOf({ body = '', user = null } = {}) {
  if (/[؀-ۿ]/.test(String(body || ''))) return 'ur';
  if (user && user.preferred_language === 'ur') return 'ur';
  return 'bi';
}

async function firstNames(ids) {
  if (!ids.length) return new Map();
  const supabase = require('../../config/supabase');
  const { data } = await supabase.from('students').select('id, student_name').in('id', ids);
  return new Map((data || []).map((r) => [String(r.id), firstOf(r.student_name)]));
}

async function boundKids(phone) {
  const IdFlags = require('../quiz/web-quiz-identity-flags');
  if (!(await IdFlags.flags()).phoneBind) return [];
  const Repo = require('../quiz/child-phone-bindings.repo');
  const rows = await Repo.activeForPhone(Repo.normalisePhone(phone));
  const ids = [...new Set((rows || []).map((r) => String((r && r.canonical_id) || '')).filter(Boolean))].slice(0, MAX_KIDS);
  if (!ids.length) return [];
  const names = await soft('bound_names', () => firstNames(ids), new Map());
  return ids.map((id) => ({ id, first: names.get(id) || '' }));
}

async function rosterKids(phone) {
  const StudentMode = require('../student-mode.service');
  return kidsOf(await StudentMode.quizStudentsForPhone(phone));
}

/**
 * Rung 3b — the class-roster record, read only. Active rows on an active list made this school year whose parent_phone
 * is this phone; offered only when they sit in ONE school and number at most 4 (a number written on two schools'
 * registers, or against a whole class, is a wrong number: the page asks instead and shows no name).
 */
async function familyKids(phone, now = new Date()) {
  const { normalisePhone } = require('../quiz/student-identity.service');
  const norm = normalisePhone(phone);
  if (!norm) return [];
  const supabase = require('../../config/supabase');
  const { data: rows, error } = await supabase.from('students')
    .select('id, student_name, list_id')
    .in('parent_phone', [norm, `+${norm}`])
    .eq('is_active', true)
    .eq('status', 'active')
    .not('list_id', 'is', null)
    .limit(MAX_KIDS + 1);
  if (error) throw new Error(error.message || 'roster read failed');
  if (!rows || !rows.length || rows.length > MAX_KIDS) return [];
  const listIds = [...new Set(rows.map((r) => String(r.list_id)))];
  const { data: lists, error: lerr } = await supabase.from('student_lists').select('id, user_id, is_active, created_at').in('id', listIds);
  if (lerr) throw new Error(lerr.message || 'list read failed');
  const since = schoolYearStart(now).getTime();
  const live = new Map((lists || [])
    .filter((l) => l.is_active !== false && l.created_at && new Date(l.created_at).getTime() >= since)
    .map((l) => [String(l.id), l]));
  const kept = rows.filter((r) => live.has(String(r.list_id)));
  if (!kept.length) return [];
  const owners = [...new Set(kept.map((r) => String(live.get(String(r.list_id)).user_id || '')))];
  const { data: teachers, error: terr } = await supabase.from('users').select('id, school_id').in('id', owners);
  if (terr) throw new Error(terr.message || 'school read failed');
  const schools = new Set((teachers || []).map((t) => String(t.school_id || `teacher:${t.id}`)));
  if (schools.size !== 1) return [];
  return kidsOf(kept);
}

async function doorOf(userId, since = null) {
  const Keys = require('./door.keys');
  const { decideDoor } = require('./door.service');
  const keys = await Keys.readDoorKeys(userId);
  if (since) {
    // a walk-through "new phone": only the answers given since the walk began count (keys are never deleted)
    for (const k of Object.keys(keys)) if (!keys[k].usedAt || keys[k].usedAt.getTime() <= since) delete keys[k];
  }
  return decideDoor(keys);
}

/** The walk-through persona for this phone ({ as, since } | null); null without the module or with its switch off. */
async function personaOf(phone) {
  if (!phone) return null;
  let M = null;
  try { M = require(PERSONA_MODULE); } catch (e) { if (e && e.code !== 'MODULE_NOT_FOUND') throw e; return null; }
  if (!M || typeof M.get !== 'function') return null;
  const { normalisePhone } = require('../quiz/student-identity.service');
  const p = await M.get(normalisePhone(phone));
  return p && (p.as === 'fresh' || p.as === 'teacher_empty') ? p : null;
}

/** A rung's read; a throw is logged (no phone, no id) and read as absent. */
async function soft(label, fn, fallback) {
  try { return await fn(); } catch (err) {
    logToFile('⚠️ one door: a role read failed — read as absent', { rung: label, error: err && err.message });
    return fallback;
  }
}

/**
 * The one read. `user` = the users row (getOrCreateUser's, or `{ id }` on the landing); `phone` = the sender.
 * @returns {Promise<{role, side, src, uid, children, kids, lang}>}
 */
async function resolveRole({ user, phone, body = '' } = {}) {
  const uid = (user && user.id) || null;
  const lang = langOf({ body, user });
  if (!user || !uid) return { ...decideRole({ failed: true }), uid, lang };
  const tp = await soft('persona', () => personaOf(phone), null);
  if (tp && tp.as === 'teacher_empty') return { ...decideRole({ teacher: 'persona' }), uid, lang, persona: tp.as };
  if (tp && tp.as === 'fresh') {
    // a walk-through "new phone": no teacher signs, no chat or roster rows — the binding and the answers made since count
    const bound = phone ? await soft('bound', () => boundKids(phone), []) : [];
    const door = !bound.length ? await soft('key', () => doorOf(uid, Number(tp.since) || Date.now()), null) : null;
    return { ...decideRole({ bound, door }), uid, lang, persona: tp.as };
  }
  const Signs = require('../student-ingress-identity');
  let teacher = null;
  let failed = false;
  try {
    const full = await Signs.withIdentityFields(user);
    if (!full) throw new Error('users row not read');
    if (Signs.identity(full)) teacher = 'identity';
    else {
      const act = await Signs.activity(uid);
      if (act === null) failed = true;
      else if (act) teacher = 'activity';
    }
  } catch (err) {
    logToFile('⚠️ one door: the identity read failed — the page asks', { error: err && err.message });
    failed = true;
  }
  if (teacher || failed) return { ...decideRole({ teacher, failed }), uid, lang };
  const bound = phone ? await soft('bound', () => boundKids(phone), []) : [];
  const roster = !bound.length && phone ? await soft('roster', () => rosterKids(phone), []) : [];
  const family = !bound.length && !roster.length && phone ? await soft('family', () => familyKids(phone), []) : [];
  const door = !bound.length && !roster.length && !family.length ? await soft('key', () => doorOf(uid), null) : null;
  return { ...decideRole({ bound, roster, family, door }), uid, lang };
}

/**
 * The page's ONE writer (writer `role_page`): the remembered answer through door.keys (the closed writer list), which
 * also forgets the cached verdict for this phone. Never writes the users row. `phone` is read from the users row when
 * the caller does not hold it (the teacher home's "Change").
 * @returns {Promise<boolean>} true when written
 */
async function writeRoleAnswer({ userId, side, phone = null, src = 'role_page' } = {}) {
  if (!userId || (side !== 'teacher' && side !== 'child') || src !== 'role_page') return false;
  let ph = phone;
  if (!ph) {
    const supabase = require('../../config/supabase');
    const { data } = await supabase.from('users').select('phone_number').eq('id', userId).maybeSingle();
    ph = (data && data.phone_number) || null;
  }
  const Keys = require('./door.keys');
  if (side === 'teacher') await Keys.markTeacher(userId, ph);
  else await Keys.markChild(userId, ph);
  return true;
}

/** Forget this phone's cached verdict (both phone forms). Never throws. */
async function forgetDoorVerdict(phone) {
  try { await require('./door.keys').forgetVerdict(phone); } catch (_) { /* the cache expires on its own */ }
}

/** Teacher-side extras the landing may want (head counts only; null on a failed read). */
async function teacherFacts(uid) {
  if (!uid) return { hasLessons: null, hasCoaching: null };
  const supabase = require('../../config/supabase');
  const head = async (table, column, orFilter = null) => {
    try {
      let q = supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, uid);
      if (orFilter) q = q.or(orFilter);
      const { count, error } = await q;
      return error ? null : (count || 0) > 0;
    } catch (_) { return null; }
  };
  const [hasLessons, hasCoaching] = await Promise.all([
    head('lesson_plans', 'user_id', 'gamma_url.not.is.null,pdf_url.not.is.null'),
    head('coaching_sessions', 'user_id'),
  ]);
  return { hasLessons, hasCoaching };
}

module.exports = {
  decideRole, resolveRole, langOf, firstOf, schoolYearStart, familyKids, writeRoleAnswer, forgetDoorVerdict, teacherFacts, personaOf,
  SIDES, SRCS, MAX_KIDS,
};
