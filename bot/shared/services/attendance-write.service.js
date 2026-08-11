/**
 * Attendance — the single write path.
 *
 * Deliberately a service rather than logic inside a Flow handler: the teacher
 * portal will call these same functions through an HTTP route, and one write path
 * is the only way WhatsApp and the portal cannot disagree about a day's numbers.
 *
 * Two rules the previous implementation got wrong are enforced here:
 *
 *   1. MARK BY EXCEPTION. Callers pass only who is away; everyone else in the
 *      roster is present. A 30-student class is a couple of taps.
 *   2. RE-MARKING A DAY REPLACES IT. The old flow hit a duplicate guard and dead-
 *      ended, so a teacher who made a mistake had no way to fix it.
 *
 * Students write to attendance_sessions + attendance_records (one session per
 * class per day). Teachers write to teacher_attendance_records (one row per
 * teacher per day, upserted) — the same table and shape the web dashboard uses.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

const LEAVE_TYPES = ['casual', 'sick', 'official'];

/** A migrated teacher may have no name; a blank row reads as a bug. */
function personName(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return name || p.student_name || p.phone_number || 'Unnamed';
}

/**
 * Resolve each roster member to present / absent / leave.
 * Leave wins over absent when a caller passes the same id twice — it is the more
 * specific statement, and double-counting would corrupt the tallies.
 */
function resolveStatuses(roster, absentIds, leaveIds) {
  const leave = new Set(leaveIds || []);
  const absent = new Set((absentIds || []).filter((id) => !leave.has(id)));

  return roster.map((person) => ({
    person,
    status: leave.has(person.id) ? 'leave' : absent.has(person.id) ? 'absent' : 'present',
  }));
}

function tally(resolved) {
  return {
    total: resolved.length,
    present: resolved.filter((r) => r.status === 'present').length,
    absent: resolved.filter((r) => r.status === 'absent').length,
    leave: resolved.filter((r) => r.status === 'leave').length,
  };
}

function normaliseLeaveType(leaveType, hasLeave) {
  if (!hasLeave) return null;
  return LEAVE_TYPES.includes(leaveType) ? leaveType : 'casual';
}

/**
 * Mark a class of students for one day.
 *
 * @param {object} p
 * @param {string} p.userId      teacher marking
 * @param {string} p.listId      student_lists.id
 * @param {string} p.date        YYYY-MM-DD
 * @param {Array}  p.roster      [{ id, student_name }]
 * @param {string[]} p.absentIds
 * @param {string[]} p.leaveIds
 * @param {string} [p.leaveType] casual | sick | official
 * @param {string} [p.sessionType='full_day']
 */
async function markStudents({
  userId, listId, date, roster, absentIds = [], leaveIds = [],
  leaveType = null, sessionType = 'full_day',
}) {
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new Error('Cannot mark attendance: the roster is empty.');
  }

  const resolved = resolveStatuses(roster, absentIds, leaveIds);
  const counts = tally(resolved);
  const resolvedLeaveType = normaliseLeaveType(leaveType, counts.leave > 0);

  // Already marked today? Replace it rather than refusing.
  const { data: existing } = await supabase
    .from('attendance_sessions')
    .select('id')
    .eq('list_id', listId)
    .eq('session_date', date)
    .eq('session_type', sessionType)
    .maybeSingle();

  let sessionId;
  let replaced = false;

  if (existing?.id) {
    sessionId = existing.id;
    replaced = true;
    await supabase.from('attendance_records').delete().eq('session_id', sessionId);
    await supabase
      .from('attendance_sessions')
      .update({
        total_students: counts.total,
        present_count: counts.present,
        absent_count: counts.absent,
        leave_count: counts.leave,
        marking_method: 'tap',
        was_manually_edited: true,
      })
      .eq('id', sessionId);
  } else {
    const { data: created, error } = await supabase
      .from('attendance_sessions')
      .insert({
        user_id: userId,
        list_id: listId,
        session_date: date,
        session_type: sessionType,
        total_students: counts.total,
        present_count: counts.present,
        absent_count: counts.absent,
        leave_count: counts.leave,
        marking_method: 'tap',
      })
      .select('id')
      .single();

    if (error || !created) {
      logToFile('❌ Attendance session insert failed', { userId, listId, error: error?.message });
      throw new Error('Could not save attendance.');
    }
    sessionId = created.id;
  }

  const { error: recError } = await supabase.from('attendance_records').insert(
    resolved.map(({ person, status }) => ({
      session_id: sessionId,
      student_id: person.id,
      student_name: personName(person),
      status,
      notes: status === 'leave' ? resolvedLeaveType : null,
    })),
  );

  if (recError) {
    logToFile('❌ Attendance records insert failed', { userId, sessionId, error: recError.message });
    throw new Error('Saved the day but not the students. Please mark again.');
  }

  logToFile('✅ Student attendance saved', { userId, listId, date, ...counts, replaced });

  return {
    sessionId,
    replaced,
    summary: counts,
    leaveType: resolvedLeaveType,
    absentNames: resolved.filter((r) => r.status === 'absent').map((r) => personName(r.person)),
    leaveNames: resolved.filter((r) => r.status === 'leave').map((r) => personName(r.person)),
  };
}

/**
 * Mark a school's teachers for one day (the principal path).
 *
 * Writes teacher_attendance_records — one row per teacher per day — which is the
 * same table the web dashboard reads, so both channels converge.
 *
 * @param {object} p
 * @param {string} p.principalUserId
 * @param {string} p.schoolId
 * @param {string} p.date            YYYY-MM-DD
 * @param {Array}  p.staff           [{ id, first_name, last_name, phone_number }]
 * @param {string[]} p.absentIds
 * @param {string[]} p.leaveIds
 * @param {string} [p.leaveType]
 */
async function markTeachers({
  principalUserId, schoolId, date, staff, absentIds = [], leaveIds = [], leaveType = null,
}) {
  if (!Array.isArray(staff) || staff.length === 0) {
    throw new Error('Cannot mark attendance: no teachers on this school roster.');
  }

  const resolved = resolveStatuses(staff, absentIds, leaveIds);
  const counts = tally(resolved);
  const resolvedLeaveType = normaliseLeaveType(leaveType, counts.leave > 0);

  const rows = resolved.map(({ person, status }) => ({
    teacher_id: person.id,
    school_id: schoolId,
    date,
    status,
    leave_type: status === 'leave' ? resolvedLeaveType : null,
    marked_by_user_id: principalUserId,
  }));

  // One row per teacher per day — re-marking overwrites rather than duplicating.
  const { error } = await supabase
    .from('teacher_attendance_records')
    .upsert(rows, { onConflict: 'teacher_id,date' });

  if (error) {
    logToFile('❌ Teacher attendance upsert failed', { principalUserId, schoolId, error: error.message });
    throw new Error('Could not save attendance.');
  }

  logToFile('✅ Teacher attendance saved', { principalUserId, schoolId, date, ...counts });

  return {
    summary: counts,
    leaveType: resolvedLeaveType,
    absentNames: resolved.filter((r) => r.status === 'absent').map((r) => personName(r.person)),
    leaveNames: resolved.filter((r) => r.status === 'leave').map((r) => personName(r.person)),
  };
}

module.exports = {
  markStudents,
  markTeachers,
  resolveStatuses,
  personName,
  LEAVE_TYPES,
};
