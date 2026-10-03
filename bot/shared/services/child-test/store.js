'use strict';

/**
 * Child test — the one reader and writer of child_test_draws, child_test_sessions and
 * child_test_blocks (migration V1.5.9), and of the roster reads the draw needs. Other lanes call
 * only what lanes/L3/STORE_API.md lists.
 *
 * The rules that matter live here, not in the callers:
 * - One session per draw, and only for a child marked present (status 'tested').
 * - ai_marks is written once: every AI write filters ai_marks IS NULL (and the database refuses
 *   any change to it, trigger child_test_blocks_keep_marks).
 * - The coach's check is written once (checked_at IS NULL), next to the AI marks, never over them.
 * - Draw updates are compare-and-set on the status the caller read.
 * Every Supabase error is logged at 'error' with ids only and returned, never read as "no row".
 * Nothing here logs a child's name.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { isVisitKey, oneVisit } = require('./draw/visit-key');

const DRAWS = 'child_test_draws';
const SESSIONS = 'child_test_sessions';
const BLOCKS = 'child_test_blocks';

const BLOCK_NAMES = ['urdu', 'english', 'maths'];
const CHANNELS = ['whatsapp', 'app'];
const SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'];
const AI_INTERIM_STATUSES = ['pending', 'scoring', 'failed'];
const AI_FINAL_STATUSES = ['scored', 'partial'];

function fail(where, error, extra) {
  logToFile(`[child-test] ${where} failed`, { ...extra, error: error && (error.message || String(error)) }, 'error');
  return { ok: false, error: error && (error.message || String(error)) };
}

const isUniqueViolation = (error) => Boolean(error && (error.code === '23505' || /duplicate key/i.test(error.message || '')));
// A visit is named by an observe2 field form id (visit_id) or, with no field form, by a visit key
// ('cs:…' / 'day:…', draw/visit-key.js). The two never look alike, so one string names either.
const visitColumn = (visit, idCol) => (isVisitKey(visit) ? 'visit_key' : idCol);

const iso = (at) => (at instanceof Date ? at : new Date(at || Date.now())).toISOString();

// ── Roster reads (for the draw) ────────────────────────────────────────────────────────────────

/**
 * Active classes of the school in the academic session, grades 3 and 5. A merged class is closed
 * with is_active = false (roster merge, 00_complete-schema), so is_active alone excludes it.
 */
async function listGradeClasses(schoolId, sessionCode) {
  const { data, error } = await supabase.from('classes')
    .select('id, school_id, grade_code, section, shift_code, session_code, is_active')
    .eq('school_id', schoolId)
    .eq('session_code', sessionCode)
    .eq('is_active', true)
    .in('grade_code', ['grade_3', 'grade_5']);
  if (error) return fail('listGradeClasses', error, { schoolId });
  return { ok: true, classes: data || [] };
}

/**
 * Current active enrolments of the classes, joined to students that are active (a merged or
 * withdrawn child is is_active = false).
 * Names are read here only to hand to the coach's screen; they are never logged.
 */
async function listActiveEnrollments(classIds) {
  if (!classIds.length) return { ok: true, enrollments: [] };
  const { data, error } = await supabase.from('class_enrollments')
    .select('class_id, student_id, is_active, left_on')
    .in('class_id', classIds)
    .eq('is_active', true)
    .is('left_on', null);
  if (error) return fail('listActiveEnrollments', error, { classes: classIds.length });
  const rows = data || [];
  const students = await listStudents(rows.map((r) => r.student_id));
  if (!students.ok) return students;
  const byId = new Map(students.students.map((s) => [s.id, s]));
  const enrollments = rows
    .filter((r) => {
      const s = byId.get(r.student_id);
      return s && s.is_active !== false;
    })
    .map((r) => {
      const s = byId.get(r.student_id);
      return { ...r, student_name: s.student_name, student_name_urdu: s.student_name_urdu || null, father_name: s.father_name || null };
    });
  return { ok: true, enrollments };
}

async function getClassesByIds(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return { ok: true, classes: [] };
  const { data, error } = await supabase.from('classes').select('id, school_id, grade_code, section, shift_code, session_code').in('id', unique);
  if (error) return fail('getClassesByIds', error, { classes: unique.length });
  return { ok: true, classes: data || [] };
}

async function listStudents(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return { ok: true, students: [] };
  const { data, error } = await supabase.from('students')
    // Only columns 00_complete-schema declares: a fresh database has no students.status/merged_into.
    .select('id, student_name, student_name_urdu, father_name, father_name_urdu, is_active')
    .in('id', unique);
  if (error) return fail('listStudents', error, { students: unique.length });
  return { ok: true, students: data || [] };
}

/**
 * The teacher links of the classes, with each linked user's name and whether they can be reached
 * (a phone, not deleted) — the draw names one class teacher per room from these (the same rule as
 * conversation/context.js classTeachersOf). Names go to the coach's screen only, never to a log.
 * @returns {Promise<{ok: true, links: Array<{class_id, teacher_user_id, is_class_teacher, ended_on, name, reachable}>}|{ok: false}>}
 */
async function listClassTeachers(classIds) {
  const unique = [...new Set((classIds || []).filter(Boolean))];
  if (!unique.length) return { ok: true, links: [] };
  const { data, error } = await supabase.from('class_teachers')
    .select('class_id, teacher_user_id, is_class_teacher, is_active, ended_on')
    .in('class_id', unique)
    .eq('is_active', true);
  if (error) return fail('listClassTeachers', error, { classes: unique.length });
  const rows = (data || []).filter((r) => r.teacher_user_id && r.is_active !== false && !r.ended_on);
  const userIds = [...new Set(rows.map((r) => r.teacher_user_id))];
  let users = [];
  if (userIds.length) {
    const u = await supabase.from('users').select('id, name, phone_number, deleted_at').in('id', userIds);
    if (u.error) return fail('listClassTeachers.users', u.error, { users: userIds.length });
    users = u.data || [];
  }
  const byId = new Map(users.map((x) => [x.id, x]));
  const links = rows.map((r) => {
    const x = byId.get(r.teacher_user_id);
    return {
      class_id: r.class_id,
      teacher_user_id: r.teacher_user_id,
      is_class_teacher: r.is_class_teacher === true,
      ended_on: r.ended_on || null,
      name: x && x.name != null ? String(x.name) : null,
      reachable: Boolean(x && x.phone_number && !x.deleted_at),
    };
  });
  return { ok: true, links };
}

async function getVisit(visitId) {
  const { data, error } = await supabase.from('observation_field_forms')
    .select('id, observer_user_id, visit_context')
    .eq('id', visitId)
    .maybeSingle();
  if (error) return fail('getVisit', error, { visitId });
  return { ok: true, visit: data || null };
}

async function findCoachSchool(coachUserId, schoolExtId) {
  const { data, error } = await supabase.from('leader_schools')
    .select('school_id')
    .eq('leader_user_id', coachUserId)
    .eq('source', 'niete_ict')
    .eq('school_ext_id', String(schoolExtId))
    .limit(1);
  if (error) return fail('findCoachSchool', error, { coachUserId });
  const row = (data || []).find((r) => r.school_id);
  return { ok: true, schoolId: row ? row.school_id : null };
}

async function findSchoolByEmis(emis) {
  if (!emis) return { ok: true, schoolId: null };
  const { data, error } = await supabase.from('schools').select('id').eq('emis', String(emis)).limit(2);
  if (error) return fail('findSchoolByEmis', error, {});
  return { ok: true, schoolId: data && data.length === 1 ? data[0].id : null };
}

async function findSchoolBySourceId(sourceSchoolId) {
  const n = Number(sourceSchoolId);
  if (!Number.isFinite(n)) return { ok: true, schoolId: null };
  const { data, error } = await supabase.from('schools').select('id').eq('source_school_id', n).limit(2);
  if (error) return fail('findSchoolBySourceId', error, {});
  return { ok: true, schoolId: data && data.length === 1 ? data[0].id : null };
}

// ── Draw rows ──────────────────────────────────────────────────────────────────────────────────

async function getDraw(drawId) {
  const { data, error } = await supabase.from(DRAWS).select('*').eq('id', drawId).maybeSingle();
  if (error) return fail('getDraw', error, { drawId });
  return { ok: true, draw: data || null };
}

/** Every draw row of the school in the cycle (frames, listings, returning rows). */
async function listSchoolDraws(schoolId, cycleId) {
  const { data, error } = await supabase.from(DRAWS).select('*').eq('school_id', schoolId).eq('cycle_id', cycleId);
  if (error) return fail('listSchoolDraws', error, { schoolId, cycleId });
  return { ok: true, draws: data || [] };
}

/** Every tested draw of the school, any cycle: who is no longer new, and who may return. */
async function listTestedDraws(schoolId) {
  const { data, error } = await supabase.from(DRAWS).select('*').eq('school_id', schoolId).eq('status', 'tested');
  if (error) return fail('listTestedDraws', error, { schoolId });
  return { ok: true, draws: data || [] };
}

/** The rows listed at a visit: `visit` is a field form id or a visit key. */
async function listVisitDraws(visit) {
  const { data, error } = await supabase.from(DRAWS).select('*').eq(visitColumn(visit, 'last_listed_visit_id'), visit);
  if (error) return fail('listVisitDraws', error, { visit });
  return { ok: true, draws: data || [] };
}

/**
 * Insert draw rows in one statement. A unique violation (another call wrote the same frame or
 * returning row first) is reported as { ok: false, conflict: true } and not logged as an error.
 */
async function insertDraws(rows) {
  const { data, error } = await supabase.from(DRAWS).insert(rows).select('*');
  if (error) {
    if (isUniqueViolation(error)) {
      logToFile('[child-test] insertDraws lost a race; re-reading', { rows: rows.length });
      return { ok: false, conflict: true };
    }
    return fail('insertDraws', error, { rows: rows.length });
  }
  return { ok: true, draws: data || [] };
}

/**
 * Compare-and-set: updates only while the row's status is one of `statusIn` and every `match`
 * column still holds the value the caller read (null → IS NULL). { draw: null } = lost the race.
 */
async function updateDraw(drawId, patch, { statusIn, match } = {}) {
  let q = supabase.from(DRAWS).update(patch).eq('id', drawId);
  if (statusIn) q = q.in('status', statusIn);
  for (const [col, val] of Object.entries(match || {})) q = val == null ? q.is(col, null) : q.eq(col, val);
  const { data, error } = await q.select('*');
  if (error) return fail('updateDraw', error, { drawId });
  return { ok: true, draw: (data || [])[0] || null };
}

// ── Sessions ───────────────────────────────────────────────────────────────────────────────────

async function getSession(sessionId) {
  const { data, error } = await supabase.from(SESSIONS).select('*').eq('id', sessionId).maybeSingle();
  if (error) return fail('getSession', error, { sessionId });
  return { ok: true, session: data || null };
}

async function getSessionByDraw(drawId) {
  const { data, error } = await supabase.from(SESSIONS).select('*').eq('draw_id', drawId).maybeSingle();
  if (error) return fail('getSessionByDraw', error, { drawId });
  return { ok: true, session: data || null };
}

/** `visit` is a field form id or a visit key. */
async function listSessionsForVisit(visit) {
  const { data, error } = await supabase.from(SESSIONS).select('*').eq(visitColumn(visit, 'visit_id'), visit).order('started_at', { ascending: true });
  if (error) return fail('listSessionsForVisit', error, { visit });
  return { ok: true, sessions: data || [] };
}

async function createSession({ drawId, coachUserId, visitId = null, visitKey = null, channel = 'whatsapp', itemBankVersion = null } = {}) {
  if (!CHANNELS.includes(channel)) return { ok: false, reason: 'bad_channel' };
  const named = oneVisit(visitId, visitKey);
  if (!named.ok) return named;
  const existing = await getSessionByDraw(drawId);
  if (!existing.ok) return existing;
  if (existing.session) return { ok: true, session: existing.session, created: false };

  const got = await getDraw(drawId);
  if (!got.ok) return got;
  if (!got.draw) return { ok: false, reason: 'no_draw' };
  if (got.draw.status !== 'tested') return { ok: false, reason: 'not_tested' };
  const d = got.draw;
  // The visit the caller names, else the one the child was listed at.
  const visit = named.visit || d.last_listed_visit_id || d.visit_key || null;
  const keyed = isVisitKey(visit);

  const { data, error } = await supabase.from(SESSIONS).insert({
    draw_id: d.id,
    coach_user_id: coachUserId,
    visit_id: keyed ? null : visit,
    visit_key: keyed ? visit : null,
    school_id: d.school_id,
    class_id: d.class_id,
    grade: d.grade,
    student_id: d.student_id,
    form: d.form,
    channel,
    selection_method: 'random_draw',
    frame_size: d.frame_size,
    item_bank_version: itemBankVersion,
    status: 'in_progress',
    started_at: iso(),
    timings: {},
  }).select('*').single();
  if (error) {
    if (isUniqueViolation(error)) {
      const again = await getSessionByDraw(drawId);
      if (again.ok && again.session) return { ok: true, session: again.session, created: false };
    }
    return fail('createSession', error, { drawId });
  }
  logToFile('[child-test] session created', { sessionId: data.id, drawId, channel });
  return { ok: true, session: data, created: true };
}

async function setSessionStatus(sessionId, status) {
  if (!SESSION_STATUSES.includes(status)) return { ok: false, reason: 'bad_status' };
  const patch = { status };
  if (status !== 'in_progress') patch.finished_at = iso();
  const { data, error } = await supabase.from(SESSIONS).update(patch).eq('id', sessionId).select('*');
  if (error) return fail('setSessionStatus', error, { sessionId, status });
  const session = (data || [])[0] || null;
  if (!session) return { ok: false, reason: 'no_session' };
  return { ok: true, session };
}

async function recordTiming(sessionId, key, at = new Date()) {
  const got = await getSession(sessionId);
  if (!got.ok) return got;
  if (!got.session) return { ok: false, reason: 'no_session' };
  const timings = { ...(got.session.timings || {}) };
  if (timings[key]) return { ok: true, timings };
  timings[key] = iso(at);
  const { data, error } = await supabase.from(SESSIONS).update({ timings }).eq('id', sessionId).select('*');
  if (error) return fail('recordTiming', error, { sessionId, key });
  return { ok: true, timings: ((data || [])[0] || {}).timings || timings };
}

/**
 * WhatsApp sessions still in progress that started since `since` (L26's unsent-draft nudge, every 30 s).
 * Narrow rows only; the table grows by one row per child tested.
 */
async function listOpenSessions({ since, limit = 50 } = {}) {
  const { data, error } = await supabase.from(SESSIONS).select('id, coach_user_id, channel, status, started_at')
    .eq('status', 'in_progress').eq('channel', 'whatsapp')
    .gte('started_at', iso(since))
    .order('started_at', { ascending: true })
    .limit(limit);
  if (error) return fail('listOpenSessions', error, {});
  return { ok: true, sessions: data || [] };
}

// ── Blocks ─────────────────────────────────────────────────────────────────────────────────────

async function getBlock(sessionId, block) {
  const { data, error } = await supabase.from(BLOCKS).select('*').eq('session_id', sessionId).eq('block', block).maybeSingle();
  if (error) return fail('getBlock', error, { sessionId, block });
  return { ok: true, block: data || null };
}

async function listBlocks(sessionId) {
  const { data, error } = await supabase.from(BLOCKS).select('*').eq('session_id', sessionId);
  if (error) return fail('listBlocks', error, { sessionId });
  return { ok: true, blocks: data || [] };
}

// The block row, created on first need. A racing creator is resolved by re-reading.
async function ensureBlock(sessionId, block) {
  const got = await getBlock(sessionId, block);
  if (!got.ok || got.block) return got;
  const { data, error } = await supabase.from(BLOCKS)
    .insert({ session_id: sessionId, block, ai_status: 'pending' })
    .select('*').single();
  if (error) {
    if (isUniqueViolation(error)) return getBlock(sessionId, block);
    return fail('ensureBlock', error, { sessionId, block });
  }
  return { ok: true, block: data };
}

async function attachBlockMedia({ sessionId, block, audioR2Key, photoR2Key } = {}) {
  if (!BLOCK_NAMES.includes(block)) return { ok: false, reason: 'bad_block' };
  const ensured = await ensureBlock(sessionId, block);
  if (!ensured.ok) return ensured;
  if (ensured.block.ai_marks != null) return { ok: false, alreadyScored: true, block: ensured.block };
  const patch = {};
  if (audioR2Key) patch.audio_r2_key = audioR2Key;
  if (photoR2Key) patch.photo_r2_key = photoR2Key;
  if (!Object.keys(patch).length) return { ok: true, block: ensured.block };
  const { data, error } = await supabase.from(BLOCKS).update(patch).eq('id', ensured.block.id).is('ai_marks', null).select('*');
  if (error) return fail('attachBlockMedia', error, { sessionId, block });
  const row = (data || [])[0];
  if (!row) return { ok: false, alreadyScored: true, block: (await getBlock(sessionId, block)).block || null };
  return { ok: true, block: row };
}

async function setAiStatus({ sessionId, block, aiStatus, reason = null } = {}) {
  if (!BLOCK_NAMES.includes(block)) return { ok: false, reason: 'bad_block' };
  if (!AI_INTERIM_STATUSES.includes(aiStatus)) return { ok: false, reason: 'bad_status' };
  const ensured = await ensureBlock(sessionId, block);
  if (!ensured.ok) return ensured;
  const { data, error } = await supabase.from(BLOCKS)
    .update({ ai_status: aiStatus, ai_reason: reason })
    .eq('id', ensured.block.id).is('ai_marks', null).select('*');
  if (error) return fail('setAiStatus', error, { sessionId, block, aiStatus });
  const row = (data || [])[0];
  if (!row) return { ok: false, alreadyScored: true };
  return { ok: true, block: row };
}

async function saveAiMarks({ sessionId, block, aiMarks, aiStatus = 'scored', modelVersions = null, transcript = null, reason = null } = {}) {
  if (!BLOCK_NAMES.includes(block)) return { ok: false, reason: 'bad_block' };
  if (!AI_FINAL_STATUSES.includes(aiStatus)) return { ok: false, reason: 'bad_status' };
  if (!aiMarks || typeof aiMarks !== 'object') return { ok: false, reason: 'no_marks' };
  const ensured = await ensureBlock(sessionId, block);
  if (!ensured.ok) return ensured;
  if (ensured.block.ai_marks != null) return { ok: false, alreadyScored: true, block: ensured.block };
  const patch = {
    ai_marks: aiMarks,
    ai_status: aiStatus,
    ai_reason: reason,
    ai_model_versions: modelVersions || aiMarks.model_versions || null,
    ai_scored_at: iso(),
  };
  if (transcript != null) patch.transcript = transcript;
  const { data, error } = await supabase.from(BLOCKS).update(patch).eq('id', ensured.block.id).is('ai_marks', null).select('*');
  if (error) return fail('saveAiMarks', error, { sessionId, block });
  const row = (data || [])[0];
  if (!row) return { ok: false, alreadyScored: true, block: (await getBlock(sessionId, block)).block || null };
  logToFile('[child-test] ai marks saved', { sessionId, block, aiStatus });
  return { ok: true, block: row };
}

// ── Scoring recovery ─────────────────────────────────────────────────────────────────────────
// A block saved by a process that died before it was scored has no in-memory job left anywhere.
// These are the sweep's reads (narrow: no transcript, no marks) and its claim.

const SCAN_COLUMNS = 'id, session_id, block, audio_r2_key, photo_r2_key, ai_status, ai_reason, ai_scored_at, checked_at, updated_at';

/** Blocks with no AI marks and no coach check, touched since `since`: oldest first, at most `limit`. */
async function listBlocksToRecover({ since, limit = 50 } = {}) {
  const { data, error } = await supabase.from(BLOCKS).select(SCAN_COLUMNS)
    .is('ai_marks', null).is('checked_at', null)
    .in('ai_status', AI_INTERIM_STATUSES)
    .gte('updated_at', iso(since))
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) return fail('listBlocksToRecover', error, {});
  return { ok: true, blocks: data || [] };
}

/** Blocks marked since `since` and not yet checked: their session's check may still be owed. */
async function listRecentlyScoredBlocks({ since, limit = 100 } = {}) {
  const { data, error } = await supabase.from(BLOCKS).select(SCAN_COLUMNS)
    .in('ai_status', AI_FINAL_STATUSES).is('checked_at', null)
    .gte('ai_scored_at', iso(since))
    .order('ai_scored_at', { ascending: true })
    .limit(limit);
  if (error) return fail('listRecentlyScoredBlocks', error, {});
  return { ok: true, blocks: data || [] };
}

/**
 * Compare-and-set on a block's AI status: moves it to `toStatus` only while it still has the status
 * AND the updated_at the caller read, and no marks. Two instances holding one snapshot: one wins.
 * → { ok, claimed, block? }
 */
async function claimBlockStatus({ blockId, fromStatus, fromUpdatedAt, toStatus, reason = null } = {}) {
  if (!AI_INTERIM_STATUSES.includes(toStatus) || !AI_INTERIM_STATUSES.includes(fromStatus)) return { ok: false, reason: 'bad_status' };
  if (!blockId || !fromUpdatedAt) return { ok: false, reason: 'no_snapshot' };
  const { data, error } = await supabase.from(BLOCKS)
    .update({ ai_status: toStatus, ai_reason: reason })
    .eq('id', blockId).eq('ai_status', fromStatus).eq('updated_at', fromUpdatedAt).is('ai_marks', null)
    .select(SCAN_COLUMNS);
  if (error) return fail('claimBlockStatus', error, { blockId, toStatus });
  const row = (data || [])[0] || null;
  return { ok: true, claimed: !!row, block: row };
}

async function saveCoachMarks({ sessionId, block, coachMarks, coachEdits = [] } = {}) {
  if (!BLOCK_NAMES.includes(block)) return { ok: false, reason: 'bad_block' };
  if (!coachMarks || typeof coachMarks !== 'object') return { ok: false, reason: 'no_marks' };
  const got = await getBlock(sessionId, block);
  if (!got.ok) return got;
  if (!got.block) return { ok: false, reason: 'no_block' };
  if (got.block.checked_at) return { ok: false, alreadyChecked: true, block: got.block };
  const { data, error } = await supabase.from(BLOCKS)
    .update({ coach_marks: coachMarks, coach_edits: Array.isArray(coachEdits) ? coachEdits : [], checked_at: iso() })
    .eq('id', got.block.id).is('checked_at', null).select('*');
  if (error) return fail('saveCoachMarks', error, { sessionId, block });
  const row = (data || [])[0];
  if (!row) return { ok: false, alreadyChecked: true, block: (await getBlock(sessionId, block)).block || null };
  logToFile('[child-test] coach marks saved', { sessionId, block, edits: row.coach_edits ? row.coach_edits.length : 0 });
  return { ok: true, block: row };
}

module.exports = {
  // L4 / L5 / L6 / L7 (STORE_API.md)
  createSession,
  getSession,
  getSessionByDraw,
  listSessionsForVisit,
  setSessionStatus,
  recordTiming,
  attachBlockMedia,
  getBlock,
  listBlocks,
  setAiStatus,
  saveAiMarks,
  saveCoachMarks,
  // scoring recovery (conversation/recovery.js)
  listBlocksToRecover,
  listOpenSessions,
  listRecentlyScoredBlocks,
  claimBlockStatus,
  // the draw's own reads and writes (draw/index.js)
  getDraw,
  listSchoolDraws,
  listTestedDraws,
  listVisitDraws,
  insertDraws,
  updateDraw,
  listGradeClasses,
  getClassesByIds,
  listActiveEnrollments,
  listStudents,
  listClassTeachers,
  getVisit,
  findCoachSchool,
  findSchoolByEmis,
  findSchoolBySourceId,
  BLOCK_NAMES,
};
