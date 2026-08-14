/**
 * Attendance — marking Flow endpoint (data_exchange, encrypted).
 *
 * Screens: MARK → LEAVE_TYPE (only when someone is on leave) → CONFIRM
 * (docs/flows/attendance-marking-flow.json)
 *
 * ONE screen set serves both actors. A teacher marks students, a principal marks
 * their school's teachers; the only difference is which roster the INIT loads and
 * which write function CONFIRM calls. Two products became one interaction to
 * learn and one to maintain.
 *
 * flow_token carries the context: "<userId>:student:<listId>" or "<userId>:teacher:<schoolId>".
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { markStudents, markTeachers, personName, LEAVE_TYPES } = require('../services/attendance-write.service');

const LEAVE_TYPE_OPTIONS = [
  { id: 'casual', title: 'Casual' },
  { id: 'sick', title: 'Sick' },
  { id: 'official', title: 'Official duty' },
];

// In-flight marking state, keyed by flow token. The Flow carries the taps between
// screens; we only need to remember the roster and the parsed selection.
const pending = new Map();

/** "<userId>:<subject>:<targetId>" → its parts. */
function parseToken(flowToken) {
  const [userId, subject, targetId] = String(flowToken || '').split(':');
  return { userId, subject: subject === 'teacher' ? 'teacher' : 'student', targetId };
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/** The roster row, including the bridge to the canonical class. */
async function loadList(listId) {
  const { data } = await supabase
    .from('student_lists')
    .select('id, class_name, section, class_id')
    .eq('id', listId)
    .maybeSingle();
  return data || null;
}

/** Membership from the enrollment system: class_enrollments -> students. */
async function loadEnrolledRoster(classId) {
  const { data: enrollments } = await supabase
    .from('class_enrollments')
    .select('student_id, roll_number')
    .eq('class_id', classId)
    .eq('is_active', true);

  if (!enrollments || !enrollments.length) return [];

  const { data: people } = await supabase
    .from('students')
    .select('id, student_name')
    .in('id', enrollments.map((e) => e.student_id));

  const nameById = new Map((people || []).map((p) => [p.id, p.student_name]));
  return enrollments
    .map((e) => ({ id: e.student_id, student_name: nameById.get(e.student_id), roll_number: e.roll_number }))
    .sort((a, b) => (a.roll_number ?? 1e9) - (b.roll_number ?? 1e9));
}

/** Membership from the legacy denormalised pointer. */
async function loadLegacyRoster(listId) {
  const { data } = await supabase
    .from('students')
    .select('id, student_name, roll_number')
    .eq('list_id', listId)
    .eq('is_active', true)
    .order('roll_number');
  return data || [];
}

/**
 * Who is in this class — enrollment first, legacy second.
 *
 * PREFER-THEN-FALL-BACK rather than a switch. `/class` owns rosters now, so
 * class_enrollments is the source of truth, but it is not populated yet and the
 * backfill has not run. A hard switch would read zero for every class, including
 * the 29 real students on production whose membership exists only as
 * students.list_id — a full class silently marked present. This ordering is
 * correct before, during, and after the backfill.
 *
 * Remove the fallback once class_enrollments is backfilled AND verified, not
 * before. (bd-2724)
 */
async function loadStudentRoster(listId, list = null) {
  const row = list || await loadList(listId);
  if (row && row.class_id) {
    const enrolled = await loadEnrolledRoster(row.class_id);
    if (enrolled.length) return enrolled;
  }
  return loadLegacyRoster(listId);
}

/**
 * A class-backed mirror row already carries section AND shift inside class_name
 * (ClassService.mirrorLabel), so appending `section` renders "Grade 11 - B - B"
 * and pushes "Grade 7 - E (evening) - E" past the 24-char row cap (bd-2725).
 * The mirror owns the label for those rows; legacy rows compose it.
 */
function listLabel(row) {
  if (!row) return 'Your class';
  if (row.class_id) return row.class_name;
  return row.section ? `${row.class_name} - ${row.section}` : row.class_name;
}

async function loadStaffRoster(schoolId, principalUserId) {
  const { data } = await supabase
    .from('users')
    .select('id, first_name, last_name, phone_number')
    .eq('school_id', schoolId)
    .eq('role', 'teacher')
    .order('first_name');
  // A principal does not mark themselves.
  return (data || []).filter((u) => u.id !== principalUserId);
}

async function loadSchoolLabel(schoolId) {
  const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return data?.name || 'Your school';
}

/** INIT — load the right roster and render the tap screen. */
async function handleMarkingInit(flowToken) {
  const { userId, subject, targetId } = parseToken(flowToken);
  const date = todayISO();
  logToFile('📋 Marking INIT', { userId, subject, targetId });

  const isTeacherSubject = subject === 'teacher';
  // One read of the roster row serves both the membership lookup and the label,
  // so a class-backed list is not fetched twice.
  const listRow = isTeacherSubject ? null : await loadList(targetId);
  const people = isTeacherSubject
    ? await loadStaffRoster(targetId, userId)
    : await loadStudentRoster(targetId, listRow);

  const label = isTeacherSubject ? await loadSchoolLabel(targetId) : listLabel(listRow);

  if (!people.length) {
    // Say what is missing and who can fix it — never a blank list.
    //
    // MARK, not CONFIRM. WhatsApp refuses to OPEN a flow on a screen that has
    // incoming edges in routing_model, and CONFIRM has two (MARK->CONFIRM,
    // LEAVE_TYPE->CONFIRM). Answering CONFIRM here produced
    //   invalid-screen-transition: The first screen -[CONFIRM] ... already have
    //   incoming nodes found in the routing model
    // so the branch written to be graceful was the only one that hard-failed
    // (bd-2713). MARK is the sole entry screen; the empty roster rides on it,
    // exactly as BUG-072's fix did in the main bot (68dc641, Apr 2026) where an
    // empty data-source rendered fine in production for four months.
    //
    // The router now stops this case before the Flow is even sent, so reaching
    // here means the roster emptied between send and open. `pending` is
    // deliberately NOT set: submitting re-runs INIT and re-shows this message
    // rather than attempting a write against nobody.
    return {
      screen: 'MARK',
      data: {
        heading: isTeacherSubject ? 'No teachers listed for your school yet' : 'No students in this class yet',
        subject_note: isTeacherSubject
          ? 'Your NIETE coordinator needs to link staff to your school before you can mark them.'
          : 'Say "edit class" to add students, then mark attendance.',
        roster: [],
      },
    };
  }

  pending.set(flowToken, { userId, subject, targetId, date, people });

  return {
    screen: 'MARK',
    data: {
      heading: `${label} · ${prettyDate(date)}`,
      subject_note: isTeacherSubject
        ? 'Tap only the teachers who are away. Everyone else is marked present.'
        : 'Tap only the students who are away. Everyone else is marked present.',
      roster: people.map((p) => ({
        id: p.id,
        title: personName(p),
        description: p.roll_number ? `Roll ${p.roll_number}` : '',
      })),
    },
  };
}

/** MARK submitted — ask for a leave type only if anyone is on leave. */
async function handleMarkSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return handleMarkingInit(flowToken);

  const absentIds = screenData?.absent || [];
  const leaveIds = (screenData?.on_leave || []).filter((id) => true);

  pending.set(flowToken, { ...ctx, absentIds, leaveIds });

  if (leaveIds.length) {
    const names = ctx.people.filter((p) => leaveIds.includes(p.id)).map(personName);
    return {
      screen: 'LEAVE_TYPE',
      data: {
        heading: leaveIds.length === 1 ? '1 person on leave' : `${leaveIds.length} people on leave`,
        names: names.join(', '),
        leave_types: LEAVE_TYPE_OPTIONS,
      },
    };
  }

  return renderConfirm(flowToken, { ...ctx, absentIds, leaveIds, leaveType: null });
}

/** LEAVE_TYPE submitted. */
async function handleLeaveTypeSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return handleMarkingInit(flowToken);

  const leaveType = LEAVE_TYPES.includes(screenData?.leave_type) ? screenData.leave_type : 'casual';
  pending.set(flowToken, { ...ctx, leaveType });
  return renderConfirm(flowToken, { ...ctx, leaveType });
}

/**
 * CONFIRM preview — names who is being marked BEFORE the write.
 * The old principal channel took typed coordinates and never named anyone back,
 * so one mistyped number silently marked the wrong colleague absent.
 */
function renderConfirm(flowToken, ctx) {
  const away = new Set([...(ctx.absentIds || []), ...(ctx.leaveIds || [])]);
  const absentNames = ctx.people.filter((p) => (ctx.absentIds || []).includes(p.id)).map(personName);
  const leaveNames = ctx.people
    .filter((p) => (ctx.leaveIds || []).includes(p.id) && !(ctx.absentIds || []).includes(p.id))
    .map(personName);
  const present = ctx.people.length - away.size;

  const lines = [];
  if (absentNames.length) lines.push(`Absent: ${absentNames.join(', ')}`);
  if (leaveNames.length) lines.push(`On leave${ctx.leaveType ? ` (${ctx.leaveType})` : ''}: ${leaveNames.join(', ')}`);
  if (!lines.length) lines.push('Everyone is present.');

  return {
    screen: 'CONFIRM',
    data: {
      heading: `${present} present · ${absentNames.length} absent · ${leaveNames.length} on leave`,
      detail: lines.join('\n'),
      overwrite_note: 'Marked this day already? Saving replaces the earlier record.',
    },
  };
}

/** CONFIRM confirmed — write through the shared service. */
async function handleConfirmSubmit(flowToken) {
  const ctx = pending.get(flowToken);
  if (!ctx) {
    return {
      screen: 'CONFIRM',
      data: { heading: 'That session expired', detail: 'Say "attendance" to start again.', overwrite_note: '' },
    };
  }

  try {
    const result = ctx.subject === 'teacher'
      ? await markTeachers({
        principalUserId: ctx.userId, schoolId: ctx.targetId, date: ctx.date,
        staff: ctx.people, absentIds: ctx.absentIds, leaveIds: ctx.leaveIds, leaveType: ctx.leaveType,
      })
      : await markStudents({
        userId: ctx.userId, listId: ctx.targetId, date: ctx.date,
        roster: ctx.people, absentIds: ctx.absentIds, leaveIds: ctx.leaveIds, leaveType: ctx.leaveType,
      });

    pending.delete(flowToken);

    const s = result.summary;
    return {
      screen: 'SAVED',
      data: {
        heading: `Saved · ${s.present} present · ${s.absent} absent · ${s.leave} on leave`,
        detail: result.replaced
          ? 'This replaced the record you saved earlier for the same day.'
          : 'Thank you — that is today done.',
        overwrite_note: '',
      },
    };
  } catch (error) {
    logToFile('❌ Marking confirm failed', { flowToken, error: error.message });
    return {
      screen: 'CONFIRM',
      data: { heading: 'Could not save', detail: error.message, overwrite_note: '' },
    };
  }
}

async function handleMarkingDataExchange(flowToken, screen, screenData) {
  logToFile('📋 Marking data_exchange', { screen });
  if (screen === 'MARK') return handleMarkSubmit(flowToken, screenData);
  if (screen === 'LEAVE_TYPE') return handleLeaveTypeSubmit(flowToken, screenData);
  if (screen === 'CONFIRM') return handleConfirmSubmit(flowToken);
  return handleMarkingInit(flowToken);
}

module.exports = {
  handleMarkingInit,
  handleMarkingDataExchange,
  parseToken,
  prettyDate,
  LEAVE_TYPE_OPTIONS,
};
