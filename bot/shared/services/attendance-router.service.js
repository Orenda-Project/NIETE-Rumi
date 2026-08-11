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
  const base = cls.section ? `${cls.class_name} - ${cls.section}` : cls.class_name;
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
    .select('id, class_name, section')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at');
  return data || [];
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

  const classes = await loadClasses(userId);
  const isPrincipal = user.role === 'principal';

  if (isPrincipal) {
    if (!user.school_id) {
      return {
        action: 'NO_SCHOOL',
        message: 'Your account is set up as a principal but is not linked to a school yet, '
          + 'so there is no staff list to mark. Your NIETE coordinator can link it.',
      };
    }
    if (classes.length) {
      // Runs a class too — ask rather than assume.
      return {
        action: 'ASK_SUBJECT',
        // Name both options in the text as well as the buttons: on some clients
        // the buttons render below the fold, and a bare "whose?" is unanswerable.
        message: 'Whose attendance are you marking — your teachers, or your students?',
        buttons: [
          { id: 'att_subject_teacher', title: 'My teachers' },
          { id: 'att_subject_student', title: 'My students' },
        ],
      };
    }
    return {
      action: 'MARK_TEACHERS',
      flowToken: `${userId}:teacher:${user.school_id}`,
    };
  }

  if (!classes.length) {
    return {
      action: 'SEND_SETUP',
      message: "Let's set up your first class — then you can mark attendance in a couple of taps.",
    };
  }

  if (classes.length === 1) {
    return { action: 'MARK_STUDENTS', flowToken: `${userId}:student:${classes[0].id}` };
  }

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
  if (!classes.length) {
    return { action: 'SEND_SETUP', message: "Let's set up your first class." };
  }
  if (classes.length === 1) {
    return { action: 'MARK_STUDENTS', flowToken: `${userId}:student:${classes[0].id}` };
  }
  return route(userId);
}

/** Resolve an "att_class_<id>" tap into a marking token. */
function resolveClassChoice(userId, buttonId) {
  const listId = String(buttonId || '').replace('att_class_', '');
  if (!listId) return { action: 'ERROR', message: 'I did not catch that class. Say "attendance" again.' };
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
