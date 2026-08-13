/**
 * bd-2668 — "Who did you observe?"
 *
 * An observation only recorded WHO was observed when the coach went through
 * the visit picker. Live 2026-08-13: 66 of 85 observations are self-owned —
 * 47 by a coach who HAD the picker and skipped it, 19 by a coach with no patch
 * at all. With no identity on the row, the pending-debrief list can only show a
 * date (bd-2669) and the portal shows "Unassigned" (bd-2670).
 *
 * So when a capture comes in unbound we simply ask, straight after the
 * recording is received. Two hard constraints shaped this design:
 *
 *   1. It must NEVER block or restart the capture. Riffat's worst pain is a
 *      flow that makes her re-record 20-30 minutes of lesson. The prompt is
 *      fire-and-forget: analysis continues regardless, the observe state
 *      machine is untouched, and ignoring the question leaves today's exact
 *      behaviour.
 *   2. It must not invent a new place to keep identity. The answer is written
 *      as an `observation_schedules` row — that table already carries
 *      teacher_name / school_name / school_ext_id and already links to the
 *      session through `session_id` (markDone stamps it for scheduled visits).
 *      A retro-recorded visit is the same shape as a scheduled one that has
 *      been carried out. No new table, no new column, and every existing
 *      reader (portal + the pending list) picks it up for free.
 *
 * Candidate teachers are held in Redis under a key of this service's own, NOT
 * in observe state — sharing that key is how a stray tap could corrupt a
 * capture.
 */

// Requires are LAZY on purpose (the repo's no-eager-SDK-construction contract):
// shared/config/supabase.js process.exit(78)s when its env is absent, so a
// top-level require would make the pure helpers below untestable and would
// couple merely *loading* this module to a fully configured environment.
const { observeStrings, observeLang } = require('./observe-strings');
const { logToFile } = require('../../utils/logger');

const WHO_PREFIX = 'observe_who_';
const TTL_SECONDS = 7200;              // matches the observe-state TTL
const MAX_TEACHER_ROWS = 9;            // +1 escape hatch = the WhatsApp 10-row cap
const TITLE_CAP = 24;
const DESC_CAP = 72;

const key = (userId) => `observe:who:${userId}`;
const clip = (s, n) => (s == null ? '' : String(s)).slice(0, n);

/**
 * The interactive list. One row per teacher in the coach's patch, plus
 * "someone else" so she is never trapped when the teacher isn't listed.
 */
function buildWhoPayload(teachers, S, sessionId) {
  const rows = (teachers || []).slice(0, MAX_TEACHER_ROWS).map((t, i) => ({
    id: `${WHO_PREFIX}${sessionId}_${i}`,
    title: clip(t.teacher_name || t.name, TITLE_CAP),
    description: clip(t.school_name || '', DESC_CAP),
  }));
  rows.push({
    id: `${WHO_PREFIX}${sessionId}_other`,
    title: clip(S.who_other, TITLE_CAP),
    description: clip(S.who_other_desc, DESC_CAP),
  });
  return {
    type: 'list',
    header: '',
    body: S.who_body,
    action: {
      button: clip(S.who_button, 20),
      sections: [{ title: clip(S.who_section, 24), rows }],
    },
  };
}

/** `observe_who_<sessionId>_<idx|other>` → parts, or null when not ours. */
function parseWhoId(listId) {
  if (!listId || typeof listId !== 'string' || !listId.startsWith(WHO_PREFIX)) return null;
  const rest = listId.slice(WHO_PREFIX.length);
  const cut = rest.lastIndexOf('_');
  if (cut <= 0) return null;
  const sessionId = rest.slice(0, cut);
  const tail = rest.slice(cut + 1);
  if (!sessionId) return null;
  if (tail === 'other') return { sessionId, index: null, other: true };
  if (!/^\d+$/.test(tail)) return null;
  return { sessionId, index: parseInt(tail, 10), other: false };
}

/**
 * The observation_schedules row that records a visit which already happened.
 * Throws rather than writing a record that identifies nothing.
 */
function buildObservationRecord({ leaderUserId, sessionId, teacher, today }) {
  if (!leaderUserId) throw new Error('observe-who: leaderUserId required');
  if (!sessionId) throw new Error('observe-who: sessionId required');
  if (!teacher) throw new Error('observe-who: teacher required');
  return {
    leader_user_id: leaderUserId,
    session_id: sessionId,
    teacher_ext_id: teacher.teacher_ext_id || null,
    teacher_name: teacher.teacher_name || teacher.name || null,
    school_ext_id: teacher.school_ext_id || null,
    school_name: teacher.school_name || null,
    scheduled_for: today,
    status: 'done',
  };
}

/**
 * Attach school_ext_id + school_name to a shortlist of teachers, from the
 * coach's own patch tables. Degrades to the input on any failure — a missing
 * school is cosmetic, a thrown error would cost the whole prompt.
 */
async function _withSchools(leaderUserId, teachers) {
  try {
    if (!teachers.length) return teachers;
    const supabase = require('../../config/supabase');
    const extIds = teachers.map((t) => t.teacher_ext_id).filter(Boolean);
    if (!extIds.length) return teachers;
    const { data: lt } = await supabase
      .from('leader_teachers')
      .select('teacher_ext_id, school_ext_id')
      .eq('leader_user_id', leaderUserId)
      .in('teacher_ext_id', extIds);
    if (!lt || !lt.length) return teachers;
    const schoolByTeacher = new Map(lt.map((r) => [r.teacher_ext_id, r.school_ext_id]));
    const schoolIds = [...new Set(lt.map((r) => r.school_ext_id).filter(Boolean))];
    let nameBySchool = new Map();
    if (schoolIds.length) {
      const { data: ls } = await supabase
        .from('leader_schools')
        .select('school_ext_id, school_name')
        .in('school_ext_id', schoolIds);
      nameBySchool = new Map((ls || []).map((r) => [r.school_ext_id, r.school_name]));
    }
    return teachers.map((t) => {
      const sid = schoolByTeacher.get(t.teacher_ext_id) || null;
      return { ...t, school_ext_id: sid, school_name: sid ? (nameBySchool.get(sid) || null) : null };
    });
  } catch (_) {
    return teachers;
  }
}

/**
 * Ask, if we don't already know. Fire-and-forget: every failure is swallowed —
 * not knowing the teacher's name is a far smaller problem than disturbing a
 * capture.
 */
async function maybeAskObservedTeacher(user, from, sessionId) {
  try {
    if (!user || !sessionId) return false;
    const LeaderSource = require('./assignment/leader-source');
    const WhatsAppService = require('../whatsapp.service');
    const redisService = require('../cache/railway-redis.service');
    const teachers = await LeaderSource.listTeachers(user.id).catch(() => []);
    if (!teachers || !teachers.length) return false;   // nothing to offer — stay silent

    const S = observeStrings(observeLang(user));
    // listTeachers() is used for its ORDER (most-needing-support first) but it
    // projects no school — and Riffat asked for the school precisely because
    // teachers share names. Enrich just the shortlist.
    const shortlist = await _withSchools(user.id, teachers.slice(0, MAX_TEACHER_ROWS));
    await redisService.setexWithCeiling(
      key(user.id), TTL_SECONDS, JSON.stringify({ sessionId, teachers: shortlist }));
    await WhatsAppService.sendInteractiveMessage(from, buildWhoPayload(shortlist, S, sessionId));
    logToFile('🔭 observe-who: asked who was observed', { userId: user.id, sessionId, offered: shortlist.length });
    return true;
  } catch (err) {
    logToFile('⚠️ observe-who: ask failed (non-blocking)', {
      userId: user && user.id, sessionId, error: err.message,
    });
    return false;
  }
}

/** A tap on one of our rows. Returns true when consumed. */
async function handleObservedTeacherPick(user, from, listId) {
  const parsed = parseWhoId(listId);
  if (!parsed || !user) return false;
  const supabase = require('../../config/supabase');
  const WhatsAppService = require('../whatsapp.service');
  const redisService = require('../cache/railway-redis.service');
  const S = observeStrings(observeLang(user));

  let stash = null;
  try {
    const raw = await redisService.get(key(user.id));
    stash = raw && typeof raw === 'object' ? raw : (raw ? JSON.parse(raw) : null);
  } catch (_) { stash = null; }

  if (parsed.other) {
    await WhatsAppService.sendMessage(from, S.who_other_ack);
    return true;
  }

  const teacher = stash && Array.isArray(stash.teachers) ? stash.teachers[parsed.index] : null;
  if (!teacher) {
    // Stale list (expired stash) — say so plainly rather than guessing a teacher.
    await WhatsAppService.sendMessage(from, S.who_stale);
    return true;
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const record = buildObservationRecord({
      leaderUserId: user.id, sessionId: parsed.sessionId, teacher, today,
    });
    // One record per session: replace rather than accumulate if she re-answers.
    await supabase.from('observation_schedules').delete()
      .eq('session_id', parsed.sessionId).eq('leader_user_id', user.id).eq('status', 'done');
    const { error } = await supabase.from('observation_schedules').insert(record);
    if (error) throw new Error(error.message);
    await WhatsAppService.sendMessage(
      from, (S.who_ack || 'Noted — {name}.').replace('{name}', record.teacher_name || ''));
    logToFile('🔭 observe-who: observed teacher recorded', {
      userId: user.id, sessionId: parsed.sessionId, teacher: record.teacher_name,
    });
  } catch (err) {
    logToFile('❌ observe-who: failed to record observed teacher', {
      userId: user.id, sessionId: parsed.sessionId, error: err.message,
    });
    await WhatsAppService.sendMessage(from, S.who_stale);
  }
  return true;
}

module.exports = {
  buildWhoPayload,
  parseWhoId,
  buildObservationRecord,
  maybeAskObservedTeacher,
  handleObservedTeacherPick,
  WHO_PREFIX,
};
