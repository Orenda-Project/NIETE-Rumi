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

async function loadStudentRoster(listId) {
  const { data } = await supabase
    .from('students')
    .select('id, student_name, roll_number')
    .eq('list_id', listId)
    .eq('is_active', true)
    .order('roll_number');
  return data || [];
}

async function loadClassLabel(listId) {
  const { data } = await supabase
    .from('student_lists')
    .select('class_name, section')
    .eq('id', listId)
    .maybeSingle();
  if (!data) return 'Your class';
  return data.section ? `${data.class_name} - ${data.section}` : data.class_name;
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
  const people = isTeacherSubject
    ? await loadStaffRoster(targetId, userId)
    : await loadStudentRoster(targetId);

  const label = isTeacherSubject ? await loadSchoolLabel(targetId) : await loadClassLabel(targetId);

  if (!people.length) {
    // Say what is missing and who can fix it — never a blank list.
    return {
      screen: 'CONFIRM',
      data: {
        heading: isTeacherSubject ? 'No teachers listed for your school yet' : 'No students in this class yet',
        detail: isTeacherSubject
          ? 'Your NIETE coordinator needs to link staff to your school before you can mark them.'
          : 'Say "edit class" to add students, then mark attendance.',
        overwrite_note: '',
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
