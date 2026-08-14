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

// Region timezone for the register date. Config-driven, never hardcoded per country.
const REGISTER_TIME_ZONE = process.env.REGION_TIME_ZONE || 'Asia/Karachi';

const LEAVE_TYPE_OPTIONS = [
  { id: 'casual', title: 'Casual' },
  { id: 'sick', title: 'Sick' },
  { id: 'official', title: 'Official duty' },
];

// In-flight marking state, keyed by flow token. The Flow carries the taps between
// screens; we only need to remember the roster and the parsed selection.
const pending = new Map();

/**
 * "<userId>" | "<userId>:<subject>:<targetId>" → its parts.
 *
 * The target is OPTIONAL since bd-2726: the Flow's CLASS screen picks what to mark,
 * so the bot opens with the bare user id. The composite form still parses, because
 * a Flow message already delivered to a handset carries the old token and must not
 * break mid-conversation.
 */
function parseToken(flowToken) {
  const [userId, subject, targetId] = String(flowToken || '').split(':');
  return {
    userId,
    subject: subject === 'teacher' ? 'teacher' : 'student',
    targetId: targetId || null,
    picked: Boolean(targetId),
  };
}

/**
 * The register date in the REGION's timezone, not UTC.
 *
 * `new Date().toISOString()` is UTC, so for Pakistan (UTC+5) every register marked
 * before 05:00 local was being dated to the previous day — and prettyDate() then
 * formatted it in UTC too, so the screen agreed with the wrong date and nothing
 * looked amiss. Resolved from config rather than hardcoded, because region
 * behaviour is config-driven here and Tanzania/Yemen sit in different offsets.
 */
function regionToday(timeZone = REGISTER_TIME_ZONE) {
  // en-CA renders as YYYY-MM-DD, which is already the storage format.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

function todayISO() {
  return regionToday();
}

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    // The ISO date is already region-local (regionToday), so it is formatted as a
    // bare calendar date. Re-applying a zone here would shift it a second time.
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
  const name = String(row.class_name || '').trim();
  const section = row.section ? String(row.section).trim() : '';
  if (!section) return name;
  // Append the section only if the name does not already end with it. The mirror
  // has carried BOTH shapes on the same day — "Grade 11 - B" + section "B"
  // (doubling to "Grade 11 - B - B"), and later "Grade 11" + section "B" (where
  // dropping the section loses it). Shift-bearing names like
  // "Grade 7 - E (evening)" must not gain a second "- E" either. Comparing the
  // tail is stable across all three. (bd-2725)
  const endsWithSection = new RegExp(`(^|[\\s\\-])${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\(|$)`, 'i');
  return endsWithSection.test(name) ? name : `${name} - ${section}`;
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

/**
 * Everything this user can mark, as Dropdown options.
 *
 * This is the screen that replaced the chat picker. Chat could offer 3 reply buttons
 * or 10 list rows TOTAL (whatsapp.service.js refuses more), so a teacher with 20
 * class-sections had 10 of them permanently unreachable. A Flow Dropdown takes 200.
 *
 * The principal's "teachers or students?" question lives here too, as the first
 * option, because CLASS is the Flow's only entry screen — DATE has an incoming edge
 * and WhatsApp refuses to OPEN a flow on a screen with incoming nodes (bd-2713), so
 * a separate staff entry point is not expressible.
 *
 * Option ids carry the subject: "teacher:<schoolId>" | "student:<listId>".
 */
async function loadMarkables(userId) {
  const { data: user } = await supabase
    .from('users').select('id, role, school_id').eq('id', userId).maybeSingle();

  const options = [];

  if (user && user.role === 'principal' && user.school_id) {
    const staff = await loadStaffRoster(user.school_id, userId);
    options.push({
      id: `teacher:${user.school_id}`,
      title: 'My teachers',
      description: staff.length ? `${staff.length} on staff` : 'No staff listed yet',
    });
  }

  const { data: lists } = await supabase
    .from('student_lists')
    .select('id, class_name, section, class_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at');

  for (const row of lists || []) {
    const roster = await loadStudentRoster(row.id, row);
    options.push({
      id: `student:${row.id}`,
      title: listLabel(row),
      description: roster.length ? `${roster.length} students` : 'No students yet',
    });
  }

  return { user, options };
}

/** CLASS — pick what to mark. The Flow's entry screen. */
async function renderClassScreen(flowToken) {
  const { userId } = parseToken(flowToken);
  const { options } = await loadMarkables(userId);

  if (!options.length) {
    // Nothing to mark at all. Say so on the entry screen rather than opening a
    // register against nobody; the router normally intercepts this first.
    return {
      screen: 'CLASS',
      data: {
        heading: 'You do not have any classes yet',
        class_label: 'Class',
        classes: [],
      },
    };
  }

  return {
    screen: 'CLASS',
    data: {
      heading: 'Which class are we marking?',
      class_label: 'Class',
      classes: options,
    },
  };
}

/** CLASS submitted — remember the choice, then ask for the date. */
async function handleClassSubmit(flowToken, screenData) {
  const choice = String((screenData && screenData.class_id) || '');
  const [subject, targetId] = choice.split(':');
  if (!targetId) return renderClassScreen(flowToken);

  const { userId } = parseToken(flowToken);
  const resolved = subject === 'teacher' ? 'teacher' : 'student';
  pending.set(flowToken, { userId, subject: resolved, targetId });

  return renderDateScreen(flowToken);
}

/** DATE — any day up to today in the region's timezone. */
async function renderDateScreen(flowToken) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const label = ctx.subject === 'teacher'
    ? await loadSchoolLabel(ctx.targetId)
    : listLabel(await loadList(ctx.targetId));

  const today = regionToday();
  // A term's worth of back-marking is enough; an unbounded past invites typos
  // that land a register in the wrong academic year.
  const min = new Date(`${today}T00:00:00Z`);
  min.setUTCDate(min.getUTCDate() - 90);

  return {
    screen: 'DATE',
    data: {
      heading: label,
      date_label: 'Date',
      min_date: min.toISOString().split('T')[0],
      max_date: today,
      marked_note: 'Pick today, or any earlier day you missed.',
    },
  };
}

/** DATE submitted — then how they want to mark. */
async function handleDateSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const raw = (screenData && screenData.register_date) || '';
  // CalendarPicker returns epoch millis as a string in some clients and
  // YYYY-MM-DD in others. Accept both; never trust it to be one shape.
  let date = regionToday();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date = raw;
  } else if (/^\d+$/.test(raw)) {
    date = new Intl.DateTimeFormat('en-CA', {
      timeZone: REGISTER_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Number(raw)));
  }
  if (date > regionToday()) date = regionToday();   // never accept a future register

  pending.set(flowToken, { ...ctx, date });
  return renderMethodScreen(flowToken);
}

/** METHOD — tap now; voice is not built. */
async function renderMethodScreen(flowToken) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const label = ctx.subject === 'teacher'
    ? await loadSchoolLabel(ctx.targetId)
    : listLabel(await loadList(ctx.targetId));

  return {
    screen: 'METHOD',
    data: {
      heading: `${label} · ${prettyDate(ctx.date)}`,
      method_label: 'How would you like to mark?',
      // Voice roll-call was deleted on 2026-08-10 (voice-message.handler.js:134).
      // Offered but disabled, so the option is honest about existing rather than
      // silently missing — transcription infrastructure is live, the attendance
      // name-matching layer is not.
      methods: [
        { id: 'tap', title: 'Tap to mark', description: 'Tap whoever is away', enabled: true },
        { id: 'voice', title: 'Voice note (coming soon)', description: 'Not available yet', enabled: false },
      ],
    },
  };
}

/** METHOD submitted — tap goes to the register; voice says so and stays put. */
async function handleMethodSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  if (((screenData && screenData.method) || 'tap') === 'voice') {
    const screen = await renderMethodScreen(flowToken);
    screen.data.method_label = 'Voice marking is not ready yet — choose Tap to mark';
    return screen;
  }

  return renderMarkScreen(flowToken);
}

/**
 * INIT — the Flow's entry point.
 *
 * CLASS is the only screen with no incoming edges, so it is the only screen a Flow
 * may be OPENED on (bd-2713). A bare "<userId>" token therefore lands on the picker.
 * A composite "<userId>:<subject>:<targetId>" token still resolves straight to the
 * register, so Flow messages already sitting on a handset keep working.
 */
async function handleMarkingInit(flowToken) {
  const { userId, subject, targetId, picked } = parseToken(flowToken);
  logToFile('📋 Marking INIT', { userId, subject, targetId, picked });

  // ALWAYS the picker. A composite token used to short-circuit straight to the
  // register, which reintroduced bd-2713 exactly: MARK now has an incoming edge
  // (METHOD->MARK), so answering it at INIT would earn
  //   invalid-screen-transition: The first screen -[MARK] ... already have
  //   incoming nodes found in the routing model
  // and strand the teacher. flow-screen-contract caught this before it shipped.
  //
  // CLASS is the only entry screen, so an already-delivered Flow message costs one
  // extra tap rather than failing. The token's target is deliberately not used to
  // skip ahead — there is no legal screen to skip to.
  if (picked) logToFile('📋 Legacy composite token — entering at the picker', { userId, subject, targetId });
  return renderClassScreen(flowToken);
}

/** The register itself — roster loaded for whatever was picked. */
async function renderMarkScreen(flowToken) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const isTeacherSubject = ctx.subject === 'teacher';
  const listRow = isTeacherSubject ? null : await loadList(ctx.targetId);
  const people = isTeacherSubject
    ? await loadStaffRoster(ctx.targetId, ctx.userId)
    : await loadStudentRoster(ctx.targetId, listRow);

  const label = isTeacherSubject ? await loadSchoolLabel(ctx.targetId) : listLabel(listRow);

  if (!people.length) {
    // Say what is missing and who can fix it — never a blank list.
    //
    // MARK, not CONFIRM: CONFIRM has incoming edges (MARK->CONFIRM,
    // LEAVE_TYPE->CONFIRM) and answering it at INIT produced
    //   invalid-screen-transition: The first screen -[CONFIRM] ... already have
    //   incoming nodes found in the routing model
    // so the branch written to be graceful was the only one that hard-failed
    // (bd-2713). Reaching MARK by navigation is legal, which is why this is safe
    // here even though CLASS is now the entry screen.
    //
    // `pending` keeps the context but no roster, so submitting re-renders this
    // rather than writing a register against nobody.
    return {
      screen: 'MARK',
      data: {
        heading: isTeacherSubject ? 'No teachers listed for your school yet' : 'No students in this class yet',
        subject_note: isTeacherSubject
          ? 'Your NIETE coordinator needs to link staff to your school before you can mark them.'
          : 'Add students from /class, then mark attendance.',
        roster: [],
      },
    };
  }

  pending.set(flowToken, { ...ctx, people });

  return {
    screen: 'MARK',
    data: {
      heading: `${label} · ${prettyDate(ctx.date)}`,
      subject_note: isTeacherSubject
        ? 'Tap the teachers who are absent. Leave is asked next.'
        : 'Tap the students who are absent. Leave is asked next.',
      roster: people.map((p) => ({
        id: p.id,
        title: personName(p),
        description: p.roll_number ? `Roll ${p.roll_number}` : '',
      })),
    },
  };
}

/**
 * MARK submitted — absentees recorded, then ask about leave SEPARATELY.
 *
 * Absent and leave used to be two CheckboxGroups over the same roster on this one
 * screen, so both listed every student and the same child could be ticked in both;
 * resolveStatuses() then arbitrated it at write time. Now the leave page is offered
 * the roster MINUS the absentees, so the overlap cannot be expressed (bd-2727).
 *
 * Nothing is written here. markStudents() derives every tally from the whole roster
 * in one call, so a partial write would store wrong counts — and a teacher who
 * abandoned the leave page would leave them wrong for good.
 */
async function handleMarkSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const absentIds = screenData?.absent || [];
  pending.set(flowToken, { ...ctx, absentIds });
  return renderLeaveScreen(flowToken);
}

/** LEAVE — only the students who were NOT marked absent. */
async function renderLeaveScreen(flowToken) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  const absent = new Set(ctx.absentIds || []);
  const remaining = (ctx.people || []).filter((p) => !absent.has(p.id));
  const absentCount = absent.size;

  return {
    screen: 'LEAVE',
    data: {
      heading: absentCount
        ? `${absentCount} marked absent`
        : 'Nobody marked absent',
      // Say what has already been decided, so the teacher is not re-deciding it.
      subject_note: `Everyone else is marked present. Tap anyone on approved leave instead — ${remaining.length} left to consider.`,
      roster: remaining.map((p) => ({
        id: p.id,
        title: personName(p),
        description: p.roll_number ? `Roll ${p.roll_number}` : '',
      })),
    },
  };
}

/** LEAVE submitted — a leave type only if anyone actually is. */
async function handleLeaveSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

  // Intersect with what this page actually offered. A payload naming an absentee
  // cannot promote them onto the leave list.
  const absent = new Set(ctx.absentIds || []);
  const offered = new Set((ctx.people || []).filter((p) => !absent.has(p.id)).map((p) => p.id));
  const leaveIds = (screenData?.on_leave || []).filter((id) => offered.has(id));

  pending.set(flowToken, { ...ctx, leaveIds });

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

  return renderConfirm(flowToken, { ...ctx, leaveIds, leaveType: null });
}

/** LEAVE_TYPE submitted. */
async function handleLeaveTypeSubmit(flowToken, screenData) {
  const ctx = pending.get(flowToken);
  if (!ctx) return renderClassScreen(flowToken);

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
  if (screen === 'CLASS') return handleClassSubmit(flowToken, screenData);
  if (screen === 'DATE') return handleDateSubmit(flowToken, screenData);
  if (screen === 'METHOD') return handleMethodSubmit(flowToken, screenData);
  if (screen === 'MARK') return handleMarkSubmit(flowToken, screenData);
  if (screen === 'LEAVE') return handleLeaveSubmit(flowToken, screenData);
  if (screen === 'LEAVE_TYPE') return handleLeaveTypeSubmit(flowToken, screenData);
  if (screen === 'CONFIRM') return handleConfirmSubmit(flowToken);
  return handleMarkingInit(flowToken);
}

module.exports = {
  handleMarkingInit,
  renderClassScreen,
  regionToday,
  handleMarkingDataExchange,
  parseToken,
  prettyDate,
  LEAVE_TYPE_OPTIONS,
};
