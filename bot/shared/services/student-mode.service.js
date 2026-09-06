'use strict';
/**
 * Who is holding this handset — a teacher, or one of her pupils?
 *
 * A child reaches this bot by tapping a link their teacher forwarded to the
 * class group. Inside the quiz they are handled by the quiz chain. The moment
 * they step OUTSIDE it — "what is a fraction?", "i didnt understand question 4"
 * — the free-chat path answers them as the NIETE Teaching Assistant: it offers
 * lesson plans, classroom-observation feedback and reading assessments, and it
 * talks to a ten-year-old as a colleague. That is the whole bug this module
 * exists to fix.
 *
 * THE ONE THING THIS MODULE MUST NEVER DO IS LOCK A TEACHER OUT.
 * So it is built as a PERSONA, not a lock, and every rule below is written to
 * fail towards "teacher":
 *
 *   - It is consulted at exactly ONE call site (the free-chat path in
 *     text-message.handler.js). Commands, registration keywords, share-code
 *     joins, quiz answers, Flow replies, /video, the coaching and lesson-plan
 *     paths never reach it and are byte-for-byte unchanged.
 *   - FIVE TEACHER SIGNALS are weighed before a single row about a child is
 *     read, and any one of them is decisive: a completed registration, a name
 *     on the users row, a quiz owned as `teacher_id`, a coaching session, or
 *     any completed feature. Registration alone was not enough — a live
 *     staging account with `registration_state = 'unregistered'`, six quizzes,
 *     dozens of coaching sessions and five stray quiz-joined `students` rows
 *     was classified `student` (bd-mg9c7.88). Teachers of that shape are
 *     ordinary, not exotic: the recovery-registration branch in
 *     text-message.handler.js exists precisely because people use features for
 *     months without ever finishing registration.
 *   - Student mode requires positive evidence on BOTH sides: an active
 *     quiz-joined `students` row for this handset AND a quiz session that row
 *     took within WINDOW_DAYS. No evidence means `unknown`, which means today's
 *     behaviour, unchanged.
 *   - Someone who says they are a teacher is taken at their word immediately,
 *     and the stray student rows on their handset are retired. That check now
 *     runs FIRST, ahead of the signals: it is free (it reads the message, not
 *     the database), and a registered teacher who says so gets her handset
 *     cleaned up too rather than short-circuiting past it.
 *   - The whole thing is behind STUDENT_MODE_ENABLED. Unset is off. The flag is
 *     the kill switch, and with it off this module reads nothing at all.
 *
 * A wrong "student" costs one message and is corrected by the next one. A wrong
 * "teacher" costs nothing — it is what happens today. That asymmetry is why the
 * evidence bar sits where it does.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const StudentIdentity = require('./quiz/student-identity.service');
// feature-registration.service is required LAZILY, inside the one function that
// uses it: it pulls `uuid`, whatsapp.service and audio.service at module scope,
// and the root suite runs before `bot/ npm ci`, so a module-scope require here
// would kill every root test FILE that loads this module.

/**
 * How long a child stays a child. Long enough to cover the gap between two
 * quizzes their teacher sends, short enough that a handset that has moved on
 * (a shared family phone, a resold SIM) reverts to today's behaviour by itself.
 * This is the expiry the plan calls a bounded blast radius: nothing has to be
 * cleaned up for the mode to end.
 */
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Unset means off. Only the exact string 'true' turns it on. */
function isEnabled(env = process.env) {
  return String(env.STUDENT_MODE_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Registered = she finished the registration Flow. Both columns are checked
 * because both are written: `registration_completed` by the older path and
 * `registration_state` by the Flow, which persists it at screen 1. The keyword
 * branch in the text handler reads exactly this pair — same test, same answer.
 */
function isRegisteredTeacher(user) {
  return Boolean(user
    && (user.registration_completed === true || user.registration_state === 'completed'));
}

/**
 * A name on the users row is a teacher signal on its own.
 *
 * `first_name` is written by the registration Flow AND by the recovery path
 * (`FeatureRegistrationService.sendNameQuestion` → the name reply), and it is
 * never written for a child: a child who joins a quiz gets a `students` row,
 * and the child's name is deliberately kept out of `users` and out of prompts.
 * So a named users row on a handset means an adult who has, at some point,
 * been asked who she is by the teacher-facing bot and answered.
 */
function hasTeacherName(user) {
  return Boolean(user && typeof user.first_name === 'string' && user.first_name.trim());
}

/**
 * The order the signals are tested in, and the `reason` each one publishes.
 * `registered` keeps its historical reason string because the docs, the
 * dashboards and the round-4 tests all name it.
 */
const SIGNAL_ORDER = [
  ['registered', 'registered_teacher'],
  ['hasName', 'hasName'],
  ['ownsQuizzes', 'ownsQuizzes'],
  ['hasCoaching', 'hasCoaching'],
  ['usedFeatures', 'usedFeatures'],
  // Not a signal but the same verdict: if a signal query failed we do not know
  // whether she is a teacher, and "do not know" resolves towards teacher.
  ['lookupFailed', 'signal_lookup_failed'],
];

/**
 * "I am a teacher", in the ways people actually type it.
 *
 * DELIBERATELY ANCHORED, NOT A BARE SUBSTRING. "teacher" on its own is the most
 * common word in a child's message about school — "my teacher said", "ask my
 * teacher", "استاد نے کہا" — and a bare-substring match would retire that
 * child's identity row for saying so, costing them their remembered name and
 * dropping them off their teacher's enrolled roster (student-identity.service
 * `findByPhone` / `findByTeacher` both filter `is_active`). So a claim is a
 * FIRST-PERSON claim, or the bare word as the entire message, or a registration
 * keyword, or a slash command.
 *
 * The false-negative side is cheap: a teacher who is somehow in student mode
 * and does not phrase it this way is still answered, still has every command,
 * and is one plainer sentence away from being recognised.
 */
const TEACHER_CLAIM_PATTERNS = [
  // English first-person claims: "i am a teacher", "i'm the teacher", "im teacher"
  /\b(?:i\s*am|i['’]?m|im)\s+(?:a|an|the)?\s*(?:teacher|ustad|ustaad)\b/i,
  // "this is the teacher", "teacher here", "teacher speaking"
  /\bthis\s+is\s+(?:the\s+|their\s+|your\s+)?teacher\b/i,
  /\bteacher\s+(?:here|speaking)\b/i,
  // Urdu first-person claims. "میں ... استاد/ٹیچر ... ہوں" and the bare
  // "استاد ہوں" / "ٹیچر ہوں" people type without the pronoun.
  /میں\s+(?:ایک\s+)?(?:استاد|اُستاد|ٹیچر|معلم|معلمہ|ٹیچر)\s*(?:ہوں|ہوں۔)/,
  /(?:استاد|اُستاد|ٹیچر|معلم|معلمہ)\s+ہوں/,
  // Registration — the same keyword list the handler's registration branch uses.
  /\b(?:register|registration|sign\s*up)\b/i,
  /رجسٹر/,
];

/** The bare word as the WHOLE message: someone answering "who is this?". */
const BARE_TEACHER_WORDS = ['teacher', 'استاد', 'اُستاد', 'ٹیچر', 'معلم', 'معلمہ'];

function looksLikeTeacherClaim(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return false;
  // A slash command is a teacher's vocabulary. It never reaches this module in
  // practice — every command short-circuits far above the free-chat path — but
  // if one ever does, it escapes rather than being tutored.
  if (raw.startsWith('/')) return true;
  const bare = raw.replace(/[!.?۔،,\s]+$/u, '').toLowerCase();
  if (BARE_TEACHER_WORDS.includes(bare)) return true;
  return TEACHER_CLAIM_PATTERNS.some((rx) => rx.test(raw));
}

/**
 * The decision itself — pure, so it can be asserted directly rather than
 * inferred from what the handler did afterwards.
 *
 * @param {object}   input
 * @param {object}   [input.user]          the users row for this phone, if any
 * @param {object}   [input.teacherSignals] what the async wrapper found out about
 *   the ADULT on this handset: `{registered, hasName, ownsQuizzes, hasCoaching,
 *   usedFeatures, lookupFailed}`. Any true value is decisive. `registered` and
 *   `hasName` are also derived from `user` when absent, so a caller written
 *   before the signals existed still gets both protections.
 * @param {object[]} [input.students]      ACTIVE quiz-joined students rows for this phone
 * @param {string|Date} [input.lastSessionAt] when one of those rows last took a quiz
 * @param {Date}     [input.now]
 * @param {boolean}  [input.flag]          STUDENT_MODE_ENABLED
 * @returns {{mode: 'teacher'|'student'|'unknown', reason: string}}
 */
function decide({ user, students, lastSessionAt, now = new Date(), flag, teacherSignals } = {}) {
  const on = flag === undefined ? isEnabled() : Boolean(flag);
  if (!on) return { mode: 'unknown', reason: 'flag_off' };

  // ── TEACHER SIGNALS, before a single row about a child is read ──
  // Any one of them is decisive. This is the whole of bd-mg9c7.88: the old
  // rule read only `registered`, and an unregistered teacher who had joined
  // her own class links came out a student.
  const sig = teacherSignals || {};
  const resolved = {
    ...sig,
    registered: sig.registered || isRegisteredTeacher(user),
    hasName: sig.hasName || hasTeacherName(user),
  };
  for (const [key, reason] of SIGNAL_ORDER) {
    if (resolved[key]) return { mode: 'teacher', reason };
  }

  const active = (students || []).filter((s) => s && s.is_active !== false);
  if (!active.length) return { mode: 'unknown', reason: 'no_student_row' };

  if (!lastSessionAt) return { mode: 'unknown', reason: 'no_quiz_session' };
  const at = lastSessionAt instanceof Date ? lastSessionAt : new Date(lastSessionAt);
  const age = now.getTime() - at.getTime();
  if (!Number.isFinite(age)) return { mode: 'unknown', reason: 'unreadable_session_date' };
  // A future timestamp is clock skew between us and Postgres, not a stale row.
  if (age > WINDOW_MS) return { mode: 'unknown', reason: 'quiz_session_stale' };

  return { mode: 'student', reason: 'active_student_recent_quiz' };
}

/**
 * Retire the quiz-joined student rows on a handset that has told us it belongs
 * to a teacher.
 *
 * Scoped to `list_id IS NULL` on purpose: that is the quiz-join shape
 * (student-identity.service `remember()` leaves it unset by design). A child on
 * an ATTENDANCE roster has `list_id` set, and their row must never be touched
 * by anything anyone types in chat — deactivating it would remove them from
 * their teacher's register.
 *
 * @returns {Promise<number>} how many rows were retired
 */
async function retireQuizStudentRows(phone, reason) {
  const key = StudentIdentity.normalisePhone(phone);
  if (!key) return 0;
  try {
    const { data, error } = await supabase
      .from('students')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('phone', key)
      .is('list_id', null)
      .eq('is_active', true)
      .select('id');
    if (error) {
      logToFile('⚠️ student-mode: could not retire student rows', { error: error.message, reason });
      return 0;
    }
    return (data || []).length;
  } catch (err) {
    logToFile('⚠️ student-mode: retire threw', { error: err.message, reason });
    return 0;
  }
}

/**
 * Does this user own at least one row in `table` under `column`? A head count,
 * so nothing but the number crosses the wire.
 *
 * @returns {Promise<boolean|null>} null means the read FAILED, which is not the
 *   same as "no rows" and must not be collapsed into it — that collapse is how
 *   a teacher becomes a child during a database hiccup.
 */
async function hasAnyRow(table, column, id) {
  try {
    const { count, error } = await supabase
      .from(table).select('*', { count: 'exact', head: true }).eq(column, id);
    if (error) {
      logToFile('⚠️ student-mode: teacher-signal lookup failed', { table, error: error.message });
      return null;
    }
    return (count || 0) > 0;
  } catch (err) {
    logToFile('⚠️ student-mode: teacher-signal lookup threw', { table, error: err.message });
    return null;
  }
}

/**
 * What this handset's users row says about the ADULT holding it.
 *
 * Ordered cheapest-first and short-circuited: the two free checks (a completed
 * registration, a name) settle most teachers with no query at all; then one
 * head count for a quiz she owns, one for a coaching session, and only then the
 * four counts inside `countUserFeatures`. A registered or named teacher costs
 * zero reads; the worst case — an adult with no name and no history — costs six
 * head counts on a path that is already making an LLM call.
 *
 * `countUserFeatures` is the handler's own test for "has this person used the
 * bot before" (text-message.handler.js ~L2319, the recovery-registration
 * branch); reusing it means student mode and registration recovery cannot
 * disagree about who counts as an established user.
 */
async function teacherSignalsFor(user) {
  const signals = {
    registered: false, hasName: false, ownsQuizzes: false,
    hasCoaching: false, usedFeatures: false, lookupFailed: false,
  };

  signals.registered = isRegisteredTeacher(user);
  if (signals.registered) return signals;
  signals.hasName = hasTeacherName(user);
  if (signals.hasName) return signals;

  const id = user && user.id;
  if (!id) return signals;

  const owns = await hasAnyRow('quizzes', 'teacher_id', id);
  if (owns === null) { signals.lookupFailed = true; return signals; }
  signals.ownsQuizzes = owns;
  if (owns) return signals;

  const coaching = await hasAnyRow('coaching_sessions', 'user_id', id);
  if (coaching === null) { signals.lookupFailed = true; return signals; }
  signals.hasCoaching = coaching;
  if (coaching) return signals;

  try {
    // Lazy on purpose — see the require block at the top of this file.
    const FeatureRegistrationService = require('./feature-registration.service');
    const n = await FeatureRegistrationService.countUserFeatures(id);
    signals.usedFeatures = Number(n || 0) > 0;
  } catch (err) {
    logToFile('⚠️ student-mode: feature count threw', { error: err.message });
    signals.lookupFailed = true;
  }
  return signals;
}

/** The active quiz-joined rows for a handset. Attendance-roster rows excluded. */
async function quizStudentsFor(phone) {
  const key = StudentIdentity.normalisePhone(phone);
  if (!key) return [];
  const { data, error } = await supabase
    .from('students')
    .select('id, student_name, self_reported_class, is_active, created_at')
    .eq('phone', key)
    .is('list_id', null)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) {
    // Fail towards teacher: a lookup failure must not tutor anybody.
    logToFile('⚠️ student-mode: student lookup failed', { error: error.message });
    return [];
  }
  return data || [];
}

/**
 * The most recent quiz session any of these children took, and the language
 * that quiz was written in — the child answered fifteen questions in it, so it
 * is the language they read, whatever a users row created by their first
 * inbound message happens to say.
 */
async function lastQuizSessionFor(studentIds) {
  if (!studentIds.length) return { at: null, language: null, studentClass: null };
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('id, created_at, quiz_id, student_class')
    .in('student_id', studentIds)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) {
    if (error) logToFile('⚠️ student-mode: session lookup failed', { error: error.message });
    return { at: null, language: null, studentClass: null };
  }
  const session = data[0];
  let language = null;
  try {
    const { data: quiz } = await supabase
      .from('quizzes').select('language').eq('id', session.quiz_id).maybeSingle();
    language = quiz?.language || null;
  } catch (err) {
    logToFile('⚠️ student-mode: quiz language lookup threw', { error: err.message });
  }
  return { at: session.created_at || null, language, studentClass: session.student_class || null };
}

/**
 * THE GATE. One call, one verdict, never throws.
 *
 * Called from exactly one place — the free-chat path — and nowhere else. It
 * returns `persona: null` for every outcome except a proven child, so the
 * caller's default branch is today's behaviour and stays that way if this
 * module ever fails.
 *
 * @returns {Promise<{persona: 'student'|null, mode: string, reason: string,
 *                    language: string|null, studentClass: string|null}>}
 */
async function personaFor({ from, user, messageBody = '', now = new Date() } = {}) {
  const NONE = (mode, reason) => ({ persona: null, mode, reason, language: null, studentClass: null });

  // Off means off: nothing is read, nothing is written, nothing is logged.
  if (!isEnabled()) return NONE('unknown', 'flag_off');

  try {
    if (looksLikeTeacherClaim(messageBody)) {
      const retired = await retireQuizStudentRows(from, 'teacher_claim');
      logEvent('student_mode.escaped', {
        reason: 'teacher_claim', retired, userId: user?.id || null,
      });
      return NONE('teacher', 'teacher_claim');
    }

    // bd-mg9c7.88 — the adult's own history, before anything about children.
    // A teacher signal returns here, so a teacher's handset never reaches the
    // two child queries below at all.
    const teacherSignals = await teacherSignalsFor(user);
    const early = decide({ user, teacherSignals, students: [], lastSessionAt: null, now, flag: true });
    if (early.mode === 'teacher') {
      logEvent('student_mode.decided', {
        mode: 'teacher', reason: early.reason, signal: early.reason, userId: user?.id || null,
      });
      return NONE('teacher', early.reason);
    }

    const students = await quizStudentsFor(from);
    const { at, language, studentClass } = await lastQuizSessionFor(students.map((s) => s.id));
    const verdict = decide({ user, teacherSignals, students, lastSessionAt: at, now, flag: true });

    logEvent('student_mode.decided', {
      mode: verdict.mode,
      reason: verdict.reason,
      signal: verdict.mode === 'teacher' ? verdict.reason : null,
      userId: user?.id || null,
      students: students.length,
      // Days, rounded — an age, never a name and never a phone (COMMON rule 6).
      sessionAgeDays: at ? Math.round((now.getTime() - new Date(at).getTime()) / 86400000) : null,
    });

    if (verdict.mode !== 'student') return NONE(verdict.mode, verdict.reason);
    return {
      persona: 'student',
      mode: 'student',
      reason: verdict.reason,
      language: language || null,
      // The class the child typed at join time is the better answer; the row's
      // own self_reported_class is the fallback for a session that predates it.
      studentClass: studentClass || students[0]?.self_reported_class || null,
    };
  } catch (err) {
    // Fail towards teacher. Whatever broke, she gets the assistant she had
    // yesterday rather than nothing.
    logToFile('⚠️ student-mode: personaFor threw (non-fatal)', { error: err.message });
    return NONE('unknown', 'error');
  }
}

module.exports = {
  WINDOW_DAYS,
  isEnabled,
  isRegisteredTeacher,
  hasTeacherName,
  looksLikeTeacherClaim,
  teacherSignalsFor,
  retireQuizStudentRows,
  decide,
  personaFor,
};
