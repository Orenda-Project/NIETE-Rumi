/**
 * Attendance — decide what "attendance" means for whoever just said it.
 *
 * One keyword, two audiences:
 *
 *   principal (+ school)  → TEACHER attendance, always. Ask tap or voice.
 *   teacher               → STUDENT attendance. Open the register; it picks the class.
 *
 * A principal's /attendance is STAFF attendance and nothing else. It used
 * to be a question — "your teachers, or your students?" — first as two reply buttons,
 * later as the first option on the Flow's class Dropdown. Both were asking a
 * principal to re-answer something their role had already settled, and the Dropdown
 * version buried the staff roster one screen deeper than the classes it sat above.
 * A principal who also runs a class marks it from /class, not from here.
 *
 * What a principal IS asked is how they want to mark: by tapping, or by talking. That
 * question is answered in CHAT rather than on a Flow screen, because it is the first
 * thing to decide and because a Flow cannot receive a voice note — the voice branch
 * has to leave the Flow before it can start.
 */

const supabase = require('../config/supabase');
const ConversationState = require('./conversation-state.service');
const { logToFile } = require('../utils/logger');

// Deliberately tight. The old detector matched loose substrings, so "I need the
// student list for my LP" dropped the teacher into attendance. Everything here is
// either an explicit word for attendance or a slash command.
const KEYWORDS = [
  'attendance', '/attendance', 'roll call',
  'حاضری', 'hazri', 'haazri', 'haziri', 'hajri',
];

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
 * Tap or talk — the only question a principal is asked before the register opens.
 *
 * Both options are named in the body text as well as on the buttons: reply buttons
 * render below the fold on some clients, and "How would you like to mark attendance?"
 * with nothing visible under it is unanswerable.
 */
function askMethod() {
  return {
    action: 'ASK_METHOD',
    message: 'Taking today\'s teacher attendance. How would you like to mark it '
      + '— by tapping the names, or by sending a voice note?',
    buttons: [
      { id: 'att_method_tap', title: 'Mark by tapping' },
      { id: 'att_method_voice', title: 'Mark by voice note' },
    ],
  };
}

/**
 * The tap-or-voice question, while it is open.
 *
 * Class A of the pre-merge checklist: WhatsApp delivers a user's answer through four
 * webhook shapes and free TEXT is one of them. People type "voice" instead of
 * tapping — the deleted implementation carried a whole VOICE_KEYWORDS list for
 * exactly that — and without this the typed answer falls through to general chat and
 * the roll call is lost to an LLM reply about something else.
 *
 * `attendance_method` is one of two conversation-state flows this feature owns; the
 * other is `attendance_voice` (voice-attendance.service), which holds the wait for
 * the note itself and then the extraction.
 */
const METHOD_FLOW = 'attendance_method';

/** Long enough to walk to the staff room; short enough not to haunt the afternoon. */
const METHOD_TTL_SECONDS = 600;

// "1"/"2" are here because the buttons are offered in that order and people answer
// numbered lists by number out of habit.
const TAP_WORDS = ['tap', 'tapping', 'tap to mark', 'type', 'manually', 'haath', '1'];
const VOICE_WORDS = ['voice', 'voice note', 'voicenote', 'audio', 'speak', 'speaking',
  'آواز', 'awaz', 'bolo', 'بولو', 'bol', '2'];

// A negation is not a selection. "not by voice" names the option it is refusing, so a
// plain substring match would read it as choosing that option.
//
// Word-boundaried, and that is load-bearing: a substring match on "not" fires inside
// "voice NOTe" and rejects the commonest answer there is.
const NEGATIONS = [/\bnot\b/i, /\bno\b/i, /n't\b/i, /\bnahi\b/i, /نہیں/];

/**
 * Which option a typed message chooses, or null if it is not an answer at all.
 *
 * Deliberately narrow. A principal who says "attendance" and then changes their mind
 * and asks for a lesson plan must get a lesson plan — so anything that is not
 * recognisably an answer falls through untouched rather than being guessed at.
 */
function readTypedMethod(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase().trim();
  if (!lower) return null;
  if (NEGATIONS.some((n) => n.test(lower))) return null;

  const hits = (words) => words.some((w) => (
    /^[0-9]+$/.test(w) ? lower === w : new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(lower)
  ));

  const voice = hits(VOICE_WORDS);
  const tap = hits(TAP_WORDS);
  // Both, or neither, is not an answer.
  if (voice === tap) return null;
  return voice ? 'att_method_voice' : 'att_method_tap';
}

/** Remember that we are waiting for an answer. */
async function openMethodQuestion(userId) {
  return ConversationState.setState(userId, {
    flow: METHOD_FLOW, step: 'awaiting_method', ttlSeconds: METHOD_TTL_SECONDS,
  });
}

/** Are we? */
async function methodQuestionOpen(userId) {
  const state = await ConversationState.getState(userId);
  return Boolean(state && state.flow === METHOD_FLOW);
}

/** Answered — by a tap or by typing. Either way, stop listening for the other. */
async function closeMethodQuestion(userId) {
  return ConversationState.clearState(userId, { flow: METHOD_FLOW });
}

/**
 * @returns {Promise<{action:string, message?:string, flowToken?:string,
 *                    buttons?:Array, schoolId?:string, listId?:string}>}
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

  // The principal fork comes FIRST and does not consult classes at all. Loading them
  // is what let a class picker back into this path twice; not loading them is the
  // guarantee that it cannot happen a third time.
  if (user.role === 'principal') {
    if (!user.school_id) {
      return {
        action: 'NO_SCHOOL',
        message: 'Your account is set up as a principal but is not linked to a school yet, '
          + 'so there is no staff list to mark. Your NIETE coordinator can link it.',
      };
    }
    return askMethod();
  }

  const classes = await loadClasses(userId);

  // Nothing to mark at all — /class owns creating it.
  if (!classes.length) return noClassYet(user);

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

/**
 * Resolve the tap/voice choice.
 *
 * Re-reads the user rather than trusting the button: a reply button is a durable
 * artifact on a handset and may come back long after the role or school changed.
 */
async function resolveMethodChoice(userId, buttonId) {
  const user = await loadUser(userId);
  if (!user) return { action: 'ERROR', message: "I couldn't find your account." };
  if (user.role !== 'principal' || !user.school_id) {
    return {
      action: 'NO_SCHOOL',
      message: 'Teacher attendance is marked by a principal whose account is linked to a school. '
        + 'Your NIETE coordinator can link yours.',
    };
  }

  if (buttonId === 'att_method_voice') {
    return {
      action: 'AWAIT_VOICE',
      schoolId: user.school_id,
      message: 'Send me a voice note naming the teachers who are away — for example '
        + '"Ayesha aur Bilal ghair hazir hain". I will tick them for you to check before saving.',
    };
  }

  if (buttonId === 'att_method_tap') {
    return { action: 'MARK_TEACHERS', flowToken: `${userId}:teacher:${user.school_id}` };
  }

  // Neither id. Ask again rather than defaulting: tapping and talking do very
  // different things, and picking one silently picks it FOR the principal.
  return askMethod();
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
  // Require the prefix. A bare `.replace()` treated ANY id as a list id, so any
  // stray button id became a flowToken like "<user>:student:<that id>" and opened a
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
  resolveMethodChoice,
  resolveClassChoice,
  readTypedMethod,
  openMethodQuestion,
  methodQuestionOpen,
  closeMethodQuestion,
  KEYWORDS,
  METHOD_FLOW,
};
