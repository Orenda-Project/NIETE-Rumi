/**
 * Attendance — decide what "attendance" means for whoever just said it.
 *
 * One keyword, four possible destinations:
 *
 *   principal (+ school)            → mark TEACHERS
 *   teacher, one class              → mark STUDENTS
 *   teacher, several classes        → pick a class first
 *   teacher, no class yet           → offer class SETUP
 *
 * A principal who also runs their own class is ASKED, never guessed. The
 * invariant is that a principal can never be silently dropped into the student
 * flow — it is the one mistake that would have them marking children while they
 * believe they are marking staff.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');

// Deliberately tight. The old detector matched loose substrings, so "I need the
// student list for my LP" dropped the teacher into attendance. Everything here is
// either an explicit word for attendance or a slash command.
const KEYWORDS = [
  'attendance', '/attendance', 'roll call',
  'حاضری', 'hazri', 'haazri', 'haziri', 'hajri',
];

// WhatsApp platform caps: 3 reply buttons, 10 list rows, 24-char row titles.
const MAX_BUTTONS = 3;
const MAX_ROWS = 10;
const TITLE_CAP = 24;

function detect(message) {
  if (!message || typeof message !== 'string') return { detected: false };
  const lower = message.toLowerCase().trim();
  for (const kw of KEYWORDS) {
    // Word-boundary match, so a keyword inside a longer sentence still counts
    // ("mark attendance please") but an unrelated phrase does not.
    const re = new RegExp(`(^|[^a-z])${kw.replace('/', '\\/')}([^a-z]|$)`, 'i');
    if (re.test(lower)) return { detected: true, keyword: kw };
  }
  return { detected: false };
}

function classLabel(cls) {
  // A class-backed mirror row already carries section AND shift inside class_name
  // (ClassService.mirrorLabel), so appending section renders "Grade 11 - B - B",
  // and "Grade 7 - E (evening) - E" is 25 code points — over the 24-char row cap,
  // truncating to a dangling "Grade 7 - E (evening) - ". (bd-2725)
  const name = String(cls.class_name || '').trim();
  const section = cls.section ? String(cls.section).trim() : '';
  let base = name;
  if (section) {
    const esc = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const already = new RegExp(`(^|[\\s\\-])${esc}\\s*(\\(|$)`, 'i');
    base = already.test(name) ? name : `${name} - ${section}`;
  }
  return String(base || 'Class').slice(0, TITLE_CAP);
}

async function loadUser(userId) {
  const { data } = await supabase
    .from('users')
    .select('id, role, school_id')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

async function loadClasses(userId) {
  const { data } = await supabase
    .from('student_lists')
    .select('id, class_name, section, class_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at');
  return data || [];
}

/**
 * Is there anybody on this class roster?
 *
 * A class row can exist with zero students — the class is created first and the
 * roster filled after, and 5th-A on staging sat at student_count 0 for four days.
 * Opening the marking Flow on that is a dead end (bd-2713), so we ask before we
 * send rather than letting the endpoint discover it.
 *
 * Reads `students` rather than `student_lists.student_count` on purpose: the
 * denormalised count drifts, and a stale count either hides a usable class or
 * opens an empty one.
 */
async function hasStudents(listOrId) {
  const row = typeof listOrId === 'string' ? await loadList(listOrId) : listOrId;
  if (!row) return false;

  // Enrollment first — /class owns rosters. Same PREFER-THEN-FALL-BACK order as
  // the marking endpoint's loadStudentRoster(); if these two ever disagree, the
  // router opens a Flow the endpoint then refuses to fill. (bd-2724)
  if (row.class_id) {
    const { data: enrolled } = await supabase
      .from('class_enrollments')
      .select('id')
      .eq('class_id', row.class_id)
      .eq('is_active', true)
      .limit(1);
    if (enrolled && enrolled.length) return true;
  }

  const { data } = await supabase
    .from('students')
    .select('id')
    .eq('list_id', row.id)
    .eq('is_active', true)
    .limit(1);
  return Boolean(data && data.length);
}

/** One roster row, with the bridge to the canonical class. */
async function loadList(listId) {
  const { data } = await supabase
    .from('student_lists')
    .select('id, class_name, section, class_id')
    .eq('id', listId)
    .maybeSingle();
  return data || null;
}

/**
 * The empty-class dead end, as the design specifies it: a chat message naming
 * what is missing plus a way to fix it — "Empty state · button", not a Flow
 * screen the teacher has to back out of.
 */
function emptyClass(listId) {
  return {
    action: 'EMPTY_CLASS',
    listId,
    message: 'This class has no students yet. Add them and you can mark attendance in a couple of taps.',
  };
}

/**
 * No class yet — hand them to /class, which OWNS class creation now.
 *
 * attendance-setup used to create classes here, purely because attendance needed a
 * roster and no class flow existed. Two writers of class membership is what produced
 * the students.list_id vs class_enrollments divergence, so attendance points instead
 * of building. (bd-2724)
 *
 * The school check mirrors /class's own: classes.school_id is NOT NULL, so opening
 * the manager for a teacher with no school on file is a Flow that cannot succeed —
 * the dead-end pattern this deployment has already paid for once.
 */
function noClassYet(user) {
  if (!user || !user.school_id) {
    return {
      action: 'NO_SCHOOL',
      message: 'You do not have any classes yet, and your account is not linked to a school, '
        + 'so one cannot be created. Your NIETE coordinator can link it.',
    };
  }
  return {
    action: 'SEND_CLASS_MANAGER',
    message: 'You do not have any classes yet. Add one and you can mark attendance in a couple of taps.',
  };
}

/**
 * "Which class?" — buttons while they fit, a list once they do not.
 *
 * Extracted so BOTH entry points can offer the picker. resolveSubjectChoice used
 * to delegate the multi-class case back to route(), which re-enters the principal
 * fork and asks "teachers or students?" again — an unbreakable loop for any
 * principal with 2+ classes. A principal with exactly one class was fine, so it
 * stayed hidden until a second class existed.
 */
function pickClass(classes) {
  if (classes.length <= MAX_BUTTONS) {
    return {
      action: 'ASK_CLASS_BUTTONS',
      message: 'Which class?',
      classes,
      buttons: classes.map((c) => ({ id: `att_class_${c.id}`, title: classLabel(c) })),
    };
  }

  const shown = classes.slice(0, MAX_ROWS);
  return {
    action: 'ASK_CLASS_LIST',
    message: 'Which class?',
    classes,
    rows: shown.map((c) => ({ id: `att_class_${c.id}`, title: classLabel(c) })),
    truncated: classes.length > MAX_ROWS,
  };
}

/**
 * @returns {Promise<{action:string, message?:string, flowToken?:string,
 *                    buttons?:Array, rows?:Array, truncated?:boolean, classes?:Array}>}
 */
async function route(userId) {
  const user = await loadUser(userId);
  if (!user) {
    return { action: 'ERROR', message: "I couldn't find your account. Please say \"register\" first." };
  }

  // bd-njn7u: defensive LP-shelf flush — starting attendance is a real
  // feature switch, so any in-flight LP-Q&A context belongs to the past.
  // Parity with quiz/coaching/video/menu. Non-blocking by design.
  try {
    const LPShelfService = require('./lp-shelf.service');
    await LPShelfService.flushShelf(userId);
  } catch (err) {
    logToFile('⚠️ LP shelf flush failed at attendance start (non-blocking)', { error: err.message });
  }

  const classes = await loadClasses(userId);
  const isPrincipal = user.role === 'principal';
  const canMarkStaff = isPrincipal && Boolean(user.school_id);

  // Nothing to mark at all — /class owns creating it (bd-2724).
  if (!classes.length && !canMarkStaff) {
    if (isPrincipal) {
      return {
        action: 'NO_SCHOOL',
        message: 'Your account is set up as a principal but is not linked to a school yet, '
          + 'so there is no staff list to mark. Your NIETE coordinator can link it.',
      };
    }
    return noClassYet(user);
  }

  // One Flow, one open. The picker moved onto the Flow's CLASS screen (bd-2726),
  // because chat could only ever offer 3 reply buttons or 10 list rows in total —
  // a teacher with 20 class-sections had ten of them unreachable — while a Flow
  // Dropdown holds 200. The principal's "teachers or students?" question is the
  // first option on that same screen, since CLASS is the Flow's only legal entry
  // point and a separate staff entry is not expressible.
  //
  // flow_token is the BARE user id: there is nothing to pre-select.
  return { action: 'OPEN_REGISTER', flowToken: userId };
}

/** Resolve the "my teachers / my students" tap. */
async function resolveSubjectChoice(userId, buttonId) {
  const user = await loadUser(userId);
  if (!user) return { action: 'ERROR', message: "I couldn't find your account." };

  if (buttonId === 'att_subject_teacher') {
    if (!user.school_id) {
      return { action: 'NO_SCHOOL', message: 'Your account is not linked to a school yet.' };
    }
    return { action: 'MARK_TEACHERS', flowToken: `${userId}:teacher:${user.school_id}` };
  }

  const classes = await loadClasses(userId);
  if (!classes.length) return noClassYet(user);
  if (classes.length === 1) {
    if (!await hasStudents(classes[0])) return emptyClass(classes[0].id);
    return { action: 'MARK_STUDENTS', flowToken: `${userId}:student:${classes[0].id}` };
  }
  // Offer the picker directly. Delegating to route() here re-asked the subject
  // question a principal had just answered, forever.
  return pickClass(classes);
}

/**
 * Resolve an "att_class_<id>" tap into a marking token.
 *
 * Async since bd-2713 — the roster is checked before the Flow is sent, so both
 * call sites must await. `handleAttendanceTap` in whatsapp-bot.js was the one
 * that did not.
 */
async function resolveClassChoice(userId, buttonId) {
  const id = String(buttonId || '');
  // Require the prefix. A bare `.replace()` treated ANY id as a list id, so a
  // stray tap became flowToken "<user>:student:att_subject_student" and opened a
  // register against a class that does not exist.
  if (!id.startsWith('att_class_')) {
    return { action: 'ERROR', message: 'I did not catch that class. Say "attendance" again.' };
  }
  const listId = id.slice('att_class_'.length);
  if (!listId) return { action: 'ERROR', message: 'I did not catch that class. Say "attendance" again.' };
  if (!await hasStudents(listId)) return emptyClass(listId);
  return { action: 'MARK_STUDENTS', flowToken: `${userId}:student:${listId}` };
}

module.exports = {
  detect,
  route,
  resolveSubjectChoice,
  resolveClassChoice,
  KEYWORDS,
  MAX_BUTTONS,
  MAX_ROWS,
  TITLE_CAP,
};
