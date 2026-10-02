/**
 * Attendance — decide what "attendance" means for whoever just said it.
 *
 * One keyword, two audiences:
 *
 *   principal, no class  → TEACHER attendance, always. Ask tap or voice.
 *   principal WITH a class → ask tap or voice, then ask WHICH register.
 *   teacher               → STUDENT attendance. Open the register; it picks the class.
 *
 * A principal's /attendance was STAFF attendance and nothing else. It used
 * to be a question — "your teachers, or your students?" — first as two reply buttons,
 * later as the first option on the Flow's class Dropdown. Both were asking a
 * principal to re-answer something their role had already settled, and the Dropdown
 * version buried the staff roster one screen deeper than the classes it sat above.
 *
 * bd-37lyd REOPENED that question, for one group only: a principal who actually
 * OWNS an active class. /roster can now name a principal the class teacher of a
 * class, and its SAVED screen tells the coach "the class teacher can see them in
 * their attendance now". With the old fork that sentence was false — the principal
 * said "attendance", got the staff register, and the children were unreachable from
 * every surface. One live principal owns a class and his student marking stopped.
 *
 * A principal who owns NO class never sees the question, which is why the fork can
 * be reopened without undoing the thing it fixed: the 99% case is untouched.
 *
 * What every principal IS asked is how they want to mark: by tapping, or by talking.
 * That question is answered in CHAT rather than on a Flow screen, because it is the
 * first thing to decide and because a Flow cannot receive a voice note — the voice
 * branch has to leave the Flow before it can start.
 *
 * WHY THE REGISTER QUESTION COMES SECOND. The tap-or-voice question is also
 * answerable by TYPING ("voice"), and text-message.handler carries a reader for
 * exactly that. Whichever question is asked second cannot recover the first answer
 * from a typed reply — so the first question must be the one people type at, and the
 * second one's answer travels in its own button ids (`att_register_<which>_<how>`),
 * where it survives a handset sitting on it for a week. Asking "whose register?"
 * first would have put the typed-answer path on the question nobody types at.
 */

const supabase = require('../config/supabase');
const ConversationState = require('./conversation-state.service');
const { rosterRowTitle } = require('./classes/roster-label');
const { resolveUx } = require('../config/ux-strings');
const { logToFile } = require('../utils/logger');

// WhatsApp platform caps, and they bind in exactly one place now: the voice branch's
// "which class?" question, which has to be answered in chat because a Flow cannot
// receive a voice note. The TAP picker is a Flow screen and is not bound by these.
const MAX_BUTTONS = 3;
const MAX_ROWS = 10;

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
    // `preferred_language` is the ONE language column — never the dead `user.language`.
    // Read here so the planner can resolve its own copy: both of its consumers would
    // otherwise have to resolve it, and two copies of a decision drift (see the
    // comment on router-action-coverage.test.js for what that costs).
    .select('id, role, school_id, preferred_language')
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
 * Tap or talk — the first question asked before the register opens.
 *
 * ONE function for all three actors. A principal marks staff, a teacher marks a
 * class, and a principal who is ALSO a class teacher has not said which yet; the
 * only thing that differs is the noun, and giving each its own copy is how they
 * would drift apart on the day someone reworded one of them.
 *
 * Both options are named in the body text as well as on the buttons: reply buttons
 * render below the fold on some clients, and "How would you like to mark attendance?"
 * with nothing visible under it is unanswerable.
 *
 * @param {'teacher'|'student'|'either'} subject whose register this is, when known
 * @param {string} [language] the reader's `preferred_language`
 */
function askMethod(subject, language) {
  // 'either' is a principal who owns a class: the register is NOT settled, so the
  // question must not name one. It is settled by the ASK_REGISTER question next.
  const subjects = { teacher: 'teacher', student: 'student', either: 'either' };
  const known = subjects[subject] || 'student';
  const bodyKey = {
    teacher: 'attendanceAskMethodTeacher',
    student: 'attendanceAskMethodStudent',
    either: 'attendanceAskMethodEither',
  }[known];
  return {
    action: 'ASK_METHOD',
    subject: known,
    message: resolveUx(bodyKey, { language }),
    buttons: [
      { id: 'att_method_tap', title: resolveUx('attendanceMethodTapButton', { language }) },
      { id: 'att_method_voice', title: resolveUx('attendanceMethodVoiceButton', { language }) },
    ],
  };
}

/**
 * Whose register — asked ONLY of a principal who owns at least one active class.
 *
 * The method is already chosen and travels in the button ids rather than in
 * conversation state, because the typed-answer path closes the state before it
 * resolves (text-message.handler) while the tapped path closes it after — so state
 * would carry the method on one path and not the other. An id carries it on both,
 * and keeps carrying it if the button is tapped tomorrow.
 *
 * @param {'tap'|'voice'} method what they already answered
 * @param {string} [language]
 */
function askRegister(method, language) {
  const how = method === 'voice' ? 'voice' : 'tap';
  return {
    action: 'ASK_REGISTER',
    method: how,
    message: resolveUx('attendanceAskRegister', { language }),
    buttons: [
      {
        id: `att_register_staff_${how}`,
        title: resolveUx('attendanceRegisterStaffButton', { language }),
      },
      {
        id: `att_register_class_${how}`,
        title: resolveUx('attendanceRegisterClassButton', { language }),
      },
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

  // Defensive LP-shelf flush — starting attendance is a real
  // feature switch, so any in-flight LP-Q&A context belongs to the past.
  // Parity with quiz/coaching/video/menu. Non-blocking by design.
  try {
    const LPShelfService = require('./lp-shelf.service');
    await LPShelfService.flushShelf(userId);
  } catch (err) {
    logToFile('⚠️ LP shelf flush failed at attendance start (non-blocking)', { error: err.message });
  }

  // The principal fork comes FIRST. It used to not consult classes at all, because
  // loading them is what let a class PICKER back into this path twice. It now asks
  // whether the principal owns one — which is a different question with a different
  // answer: it decides whether there is a second register to offer, and it never
  // puts a class Dropdown in front of a principal who has no class.
  if (user.role === 'principal') {
    if (!user.school_id) {
      return {
        action: 'NO_SCHOOL',
        message: 'Your account is set up as a principal but is not linked to a school yet, '
          + 'so there is no staff list to mark. Your NIETE coordinator can link it.',
      };
    }
    const own = await loadClasses(userId);
    // No class of their own: staff attendance, exactly as before. The question that
    // follows names the staff register, because there is nothing else it could be.
    return askMethod(own.length ? 'either' : 'teacher', user.preferred_language);
  }

  const classes = await loadClasses(userId);

  // Nothing to mark at all — /class owns creating it.
  if (!classes.length) return noClassYet(user);

  // A teacher is asked the same question a principal is. It used to be a Flow screen
  // for them and no question at all in chat, which put the voice option somewhere a
  // voice note cannot be answered from.
  return askMethod('student', user.preferred_language);
}

/**
 * Resolve the tap/voice choice, for whoever is asking.
 *
 * Re-reads the user rather than trusting the button: a reply button is a durable
 * artifact on a handset and may come back long after the role or school changed.
 *
 * TAP is symmetrical — the principal's target is settled by their role, the teacher's
 * is settled on the Flow's CLASS screen.
 *
 * VOICE is not. Matching spoken names needs the roster IN HAND before the note
 * arrives, and a teacher may have several classes. So a teacher choosing voice is
 * asked which class first, in chat, and only then is the wait armed. A principal
 * has exactly one staff list and skips that step.
 */
async function resolveMethodChoice(userId, buttonId) {
  const user = await loadUser(userId);
  if (!user) return { action: 'ERROR', message: "I couldn't find your account." };

  const wantsVoice = buttonId === 'att_method_voice';
  const wantsTap = buttonId === 'att_method_tap';
  const isPrincipal = user.role === 'principal';

  // Neither id. Ask again rather than defaulting: tapping and talking do very
  // different things, and picking one silently picks it FOR them.
  if (!wantsVoice && !wantsTap) {
    return askMethod(isPrincipal ? 'teacher' : 'student', user.preferred_language);
  }

  if (isPrincipal) {
    if (!user.school_id) {
      return {
        action: 'NO_SCHOOL',
        message: 'Teacher attendance is marked by a principal whose account is linked to a school. '
          + 'Your NIETE coordinator can link yours.',
      };
    }
    // bd-37lyd — a principal who owns a class has two registers, so which one is
    // now a real question. Re-read rather than trusting what route() saw: a reply
    // button is durable on a handset and the class may have been handed over since.
    if ((await loadClasses(userId)).length) {
      return askRegister(wantsVoice ? 'voice' : 'tap', user.preferred_language);
    }
    if (wantsTap) return { action: 'MARK_TEACHERS', flowToken: `${userId}:teacher:${user.school_id}` };
    return awaitVoice('teacher', user.school_id);
  }

  // A teacher tapping: the Flow picks the class, so the token names no target —
  // "<userId>:student", which the marking endpoint reads exactly as it read the
  // bare id (this teacher, marking students, class not yet picked).
  //
  // The subject is spelled out because the token is the ONLY part of the Flow's
  // completion that every WABA is guaranteed to return. A bare id carried nothing
  // the classifier could recognise, and the SAVED Footer's attendance_action tag
  // arrives only from an asset republished after it was added — production's was
  // not, so every teacher save was answered "Thanks for your response! Type
  // /menu…" (1,369 a week). We set the token at send time; it always comes back.
  if (wantsTap) return { action: 'OPEN_REGISTER', flowToken: `${userId}:student` };

  const classes = await loadClasses(userId);
  if (!classes.length) return noClassYet(user);
  if (classes.length === 1) {
    if (!await hasStudents(classes[0])) return emptyClass(classes[0].id);
    return awaitVoice('student', classes[0].id);
  }
  return pickClassForVoice(classes);
}

/**
 * Resolve "whose register?" — `att_register_<staff|class>_<tap|voice>`.
 *
 * Only a principal ever receives these ids, and the method they already chose is
 * the id's own suffix. Everything is RE-READ: the user (their role or school may
 * have changed), and the classes (the class may have been handed to someone else
 * since the question was asked). A class branch that finds no class falls back to
 * the staff register rather than dead-ending — it is what every principal got
 * before this question existed, and it is never wrong, only less specific.
 */
async function resolveRegisterChoice(userId, buttonId) {
  const user = await loadUser(userId);
  if (!user) return { action: 'ERROR', message: "I couldn't find your account." };

  const id = String(buttonId || '');
  const wantsClass = id === 'att_register_class_tap' || id === 'att_register_class_voice';
  const wantsStaff = id === 'att_register_staff_tap' || id === 'att_register_staff_voice';
  const wantsVoice = id.endsWith('_voice');

  // An id we do not know is not an answer. Ask again rather than guessing which
  // register somebody meant — the two write to different registers entirely.
  if (!wantsClass && !wantsStaff) return askRegister(wantsVoice ? 'voice' : 'tap', user.preferred_language);

  if (!user.school_id) {
    return {
      action: 'NO_SCHOOL',
      message: 'Teacher attendance is marked by a principal whose account is linked to a school. '
        + 'Your NIETE coordinator can link yours.',
    };
  }

  const classes = wantsClass ? await loadClasses(userId) : [];

  if (wantsClass && classes.length) {
    // From here the principal is marking a class, so they take the TEACHER path
    // verbatim: the Flow's own CLASS screen picks which one for a tap, and the
    // voice branch needs the roster in hand before the note arrives.
    if (!wantsVoice) return { action: 'OPEN_REGISTER', flowToken: `${userId}:student` };
    if (classes.length === 1) {
      if (!await hasStudents(classes[0])) return emptyClass(classes[0].id);
      return awaitVoice('student', classes[0].id);
    }
    return pickClassForVoice(classes);
  }

  if (!wantsVoice) return { action: 'MARK_TEACHERS', flowToken: `${userId}:teacher:${user.school_id}` };
  return awaitVoice('teacher', user.school_id);
}

/** The prompt that arms the wait. One place, so both subjects ask the same way. */
function awaitVoice(subject, targetId) {
  const example = subject === 'teacher'
    ? '"Ayesha aur Bilal ghair hazir hain"'
    : '"Aleeha aur Bilal ghair hazir hain"';
  return {
    action: 'AWAIT_VOICE',
    subject,
    targetId,
    // Kept for the principal callers that read it by name.
    schoolId: subject === 'teacher' ? targetId : undefined,
    message: `Send me a voice note naming the ${subject === 'teacher' ? 'teachers' : 'students'} `
      + `who are away — for example ${example}. `
      + 'I will tick them for you to check before saving.',
  };
}

/**
 * "Which class?" — for the VOICE branch only.
 *
 * The tap branch does not need this: its picker is a Flow screen that holds 200
 * options. Chat allows three reply buttons or ten list rows, so this is the one place
 * the old chat-picker limits still apply — and it is bounded, because it exists only
 * to name the roster a voice note will be matched against.
 */
function pickClassForVoice(classes) {
  if (classes.length <= MAX_BUTTONS) {
    return {
      action: 'ASK_CLASS_FOR_VOICE',
      message: 'Which class is the voice note for?',
      buttons: classes.map((c) => ({ id: `att_voice_${c.id}`, title: rosterRowTitle(c) })),
    };
  }
  const shown = classes.slice(0, MAX_ROWS);
  return {
    action: 'ASK_CLASS_FOR_VOICE_LIST',
    message: 'Which class is the voice note for?',
    rows: shown.map((c) => ({ id: `att_voice_${c.id}`, title: rosterRowTitle(c) })),
    truncated: classes.length > MAX_ROWS,
  };
}

/** Resolve an "att_voice_<listId>" tap into the armed voice wait. */
async function resolveVoiceClassChoice(userId, buttonId) {
  const id = String(buttonId || '');
  if (!id.startsWith('att_voice_')) {
    return { action: 'ERROR', message: 'I did not catch that class. Say "attendance" again.' };
  }
  const listId = id.slice('att_voice_'.length);
  if (!listId) return { action: 'ERROR', message: 'I did not catch that class. Say "attendance" again.' };
  if (!await hasStudents(listId)) return emptyClass(listId);
  return awaitVoice('student', listId);
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
  resolveRegisterChoice,
  resolveVoiceClassChoice,
  resolveClassChoice,
  askMethod,
  askRegister,
  MAX_BUTTONS,
  MAX_ROWS,
  readTypedMethod,
  openMethodQuestion,
  methodQuestionOpen,
  closeMethodQuestion,
  KEYWORDS,
  METHOD_FLOW,
};
