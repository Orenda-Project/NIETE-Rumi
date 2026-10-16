'use strict';
/**
 * WHO IS HOLDING THIS PHONE — the one door's answer, decided on the server before any reply and again when the page
 * lands (the token's side is only what the bot thought; the server re-reads, every time).
 *
 * The order, first match wins:
 *   1  identity / activity (student-ingress-identity identity() + activity(): registration, a name, a school, role coach or
 *      principal, owns a quiz / coaching session / lesson plan / list / training / assessment, an active class) → teacher
 *      Never "a users row exists": getOrCreateUser makes one for every phone that writes.
 *   2  a live child_phone_bindings row on this phone (web_quiz_phone_bind on)                               → child
 *   3  a chat-joined students row keyed by this phone (StudentMode.quizStudentsForPhone)                    → child
 *   4  our remembered page answer: door.keys quiz_door_teacher / quiz_door_child (≤ 90 days, newest wins,
 *      decideDoor) — teacher key → teacher; child key alone → the join screen (the "who" is never re-asked)
 *   5  nothing → unknown (the page asks once)
 *
 * decideRole is pure; resolveRole is the one read. A read that FAILS is never "no": rung 1 failing answers `unknown`
 * with src 'error' (the page then asks rather than guess a child into a teacher's home or the reverse), and every other
 * failed rung is skipped as absent. Nothing here writes anything.
 *
 * → { role: 'teacher'|'child'|'unknown', side: 'teacher'|'child'|'join'|'unknown', src, uid, children: [ids], lang }
 *   src ∈ identity | activity | bound | roster | key | none | error
 */
const { logToFile } = require('../../utils/logger');

const SIDES = Object.freeze(['teacher', 'child', 'join', 'unknown']);
const SRCS = Object.freeze(['identity', 'activity', 'bound', 'roster', 'key', 'none', 'error']);
const MAX_KIDS = 4;

const kidIds = (rows) => [...new Set((rows || []).map((r) => String(r && (r.canonical_id || r.id) || '')).filter(Boolean))].slice(0, MAX_KIDS);

/**
 * The decision, pure.
 * @param {{teacher?: 'identity'|'activity'|null, failed?: boolean, bound?: string[], roster?: string[], door?: string|null}} facts
 *   door: decideDoor's answer over this user's keys ('maker' | 'family' | 'chooser' | 'capped'), or null
 */
function decideRole({ teacher = null, failed = false, bound = [], roster = [], door = null } = {}) {
  if (teacher) return { role: 'teacher', side: 'teacher', src: teacher, children: [] };
  if (failed) return { role: 'unknown', side: 'unknown', src: 'error', children: [] };
  if (bound && bound.length) return { role: 'child', side: 'child', src: 'bound', children: bound.slice(0, MAX_KIDS) };
  if (roster && roster.length) return { role: 'child', side: 'child', src: 'roster', children: roster.slice(0, MAX_KIDS) };
  if (door === 'maker') return { role: 'teacher', side: 'teacher', src: 'key', children: [] };
  if (door === 'family') return { role: 'child', side: 'join', src: 'key', children: [] };
  return { role: 'unknown', side: 'unknown', src: 'none', children: [] };
}

/** The page language for this person: Urdu when they wrote in Arabic script or chose Urdu; else bilingual. */
function langOf({ body = '', user = null } = {}) {
  if (/[؀-ۿ]/.test(String(body || ''))) return 'ur';
  if (user && user.preferred_language === 'ur') return 'ur';
  return 'bi';
}

async function boundKids(phone) {
  const IdFlags = require('../quiz/web-quiz-identity-flags');
  if (!(await IdFlags.flags()).phoneBind) return [];
  const Repo = require('../quiz/child-phone-bindings.repo');
  return kidIds(await Repo.activeForPhone(Repo.normalisePhone(phone)));
}

async function rosterKids(phone) {
  const StudentMode = require('../student-mode.service');
  return kidIds(await StudentMode.quizStudentsForPhone(phone));
}

async function doorOf(userId) {
  const Keys = require('./door.keys');
  const { decideDoor } = require('./door.service');
  return decideDoor(await Keys.readDoorKeys(userId));
}

/** A rung's read; a throw is logged (no phone, no id) and read as absent. */
async function soft(label, fn, fallback) {
  try { return await fn(); } catch (err) {
    logToFile('⚠️ one door: a role read failed — read as absent', { rung: label, error: err && err.message });
    return fallback;
  }
}

/**
 * The one read. `user` = the users row (getOrCreateUser's, or read by id on the landing); `phone` = the sender.
 * @returns {Promise<{role, side, src, uid, children, lang}>}
 */
async function resolveRole({ user, phone, body = '' } = {}) {
  const uid = (user && user.id) || null;
  const lang = langOf({ body, user });
  if (!user || !uid) return { ...decideRole({ failed: true }), uid, lang };
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
  const door = !bound.length && !roster.length ? await soft('key', () => doorOf(uid), null) : null;
  return { ...decideRole({ bound, roster, door }), uid, lang };
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

module.exports = { decideRole, resolveRole, langOf, teacherFacts, SIDES, SRCS, MAX_KIDS };
