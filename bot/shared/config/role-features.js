'use strict';
/**
 * Which of the two role-shaped features a user is offered.
 *
 *   DC   (Classroom Coaching) — "coach ME on MY lesson"
 *   HITL (/observe)           — "I observed SOMEONE ELSE's lesson"
 *
 * The menu used to offer every user the same rows. Row 122 of the DC review
 * sheet (14 Sep 2026) is what that costs: a `role='principal'` teacher tapped
 * Classroom Coaching, was told to send her recording, and got the HITL binding
 * list — "Whose observation is this?" — because observe-audio-router
 * intercepts a leader's audio on role alone. Her 20 minutes were parked in
 * Redis and never analysed. 544 live users sit on that role family.
 *
 * In ICT a principal genuinely also teaches, so `principal` is the one role
 * that gets BOTH.
 *
 * ── Why this is a pure map and not authz/capability.js ────────────────────
 * That module is the repo's normal gate and it is right for portal routes: DB
 * backed, table driven, DEFAULT-DENY, fail-CLOSED. All three properties are
 * wrong here. It is consulted on the menu and on the audio hot path, where a
 * lookup blip would strip DC from ~14,400 teachers, and where "deny" does not
 * mean "403" — it means the teacher's recording gets parked. Policy this hot
 * must have no failure mode, so it has no IO.
 *
 * Unknown roles keep DC and are never granted HITL: never take the feature
 * 14,400 teachers use because a role string was unexpected, and never hand
 * someone another teacher's observation by accident.
 */

/**
 * Every role in observe-gate LEADER_ROLES appears here EXPLICITLY. Left to the
 * default, `school_leader`/`supervisor`/`aeo` would get DC and no HITL —
 * backwards. NIETE has zero of them today; this is a landmine guard, and it is
 * the line to edit when a market seeds one (the main bot also has
 * `cluster_coordinator`).
 */
const ROLE_FEATURES = Object.freeze({
  teacher:       Object.freeze({ dc: true,  observe: false }),
  principal:     Object.freeze({ dc: true,  observe: true  }),   // teaches AND observes
  coach:         Object.freeze({ dc: false, observe: true  }),
  school_leader: Object.freeze({ dc: false, observe: true  }),
  supervisor:    Object.freeze({ dc: false, observe: true  }),
  aeo:           Object.freeze({ dc: false, observe: true  }),
});

const DEFAULT_FEATURES = Object.freeze({ dc: true, observe: false });

/** Registration stores the raw string — normalise before comparing. */
function featuresFor(user) {
  const raw = user && user.role;
  if (typeof raw !== 'string') return DEFAULT_FEATURES;
  return ROLE_FEATURES[raw.trim().toLowerCase()] || DEFAULT_FEATURES;
}

/** May this user have their OWN lesson coached? */
function canSelfCoach(user) {
  return featuresFor(user).dc === true;
}

/**
 * May this user be offered the observe/HITL entry?
 *
 * This is the MENU's view only. `/observe` keeps its own authority
 * (evaluateObserveTrigger still answers `deny_role`), so the two cannot
 * disagree in a direction that grants access.
 */
function canObserve(user) {
  return featuresFor(user).observe === true;
}

/**
 * The main-menu rows: one layout per role shape, ordered by MEASURED demand.
 *
 * The menu used to offer five rows out of the deployment's fourteen live
 * features. The nine it left out were reachable only by typing a command nobody
 * had been told about — and the seven-day usage says teachers found them anyway
 * and in what proportion: attendance 1,771, classes 843, roster 814, assessment
 * 294, quiz 121, videos 100, language 14. That is a lower bound on demand for
 * every one of them, so it is what the order is built from. Lesson plans (4,467
 * menu taps) lead the teacher layout; a leader's layout leads with the thing
 * only they can do.
 *
 * Training was pinned FIRST by an earlier decision, when it was the only thing
 * teachers were being asked to do and the menu had omitted it entirely. The
 * approved design supersedes that with demand order — 500 training taps against
 * 4,467 for lesson plans — and training keeps a row in every layout.
 *
 * WhatsApp's cap is 10 rows TOTAL across all sections and it rejects the whole
 * message, so somebody's feature does not make it: a principal's layout drops
 * quiz, classes and videos for the roster and staff attendance, which is what
 * their own usage says they do.
 *
 * TWO features have no row, by decision, and the reasons are different:
 *   · Reading assessment — it cannot run here at all. Its command, its handler
 *     and its keyword all answer honestly instead.
 *   · /settings — SETTINGS_FLOW_ID is unset, so the surface answers "not
 *     available yet". /language is the live language door and has the row.
 *
 * This module owns the ROLE RULE, the row IDS and the ORDER. It does not own the
 * copy: each row names its catalog keys and the send site resolves them in the
 * teacher's language. A per-language map here would sit outside the designated
 * catalog, invisible to resolveUx, to the field-cap check and to the audit.
 *
 * Still pure — no IO, and the requires are static in-process config. This is
 * consulted on the audio hot path, where a failure parks a recording.
 */

/** WhatsApp's hard cap on TOTAL rows in one list. */
const MAX_MENU_ROWS = 10;

/**
 * Every row this build can emit. `gate` names the key in `opts` that must be
 * true for the row to appear; a row with no gate is always available BECAUSE ITS
 * FEATURE CAN START WITHOUT A FLOW — that is the test for whether a gate
 * belongs here, not "does it have an env var".
 *
 * Coaching is audio-driven. Attendance routes through the database. Lesson plans
 * fall back to asking for a topic in chat. /language and Ask Anything are pure
 * chat. None of them needs a published Flow to answer her.
 *
 * The ids are never translated and never reused: the reply router matches on
 * them, and WhatsApp keeps a list row tappable forever.
 */
const ROW = Object.freeze({
  training: { id: 'menu_training', titleKey: 'menuRowTrainingTitle', descriptionKey: 'menuRowTrainingDesc', gate: 'trainingEnabled' },
  // NO gate, deliberately. `_handleLessonPlanningChoice` falls back to asking
  // for a topic in chat when PAKISTAN_LP_FLOW_ID is unset, and that path still
  // produces a lesson plan — so the feature CAN start without the Flow, and a
  // gate here would hide a row that works. The test asserts this explicitly so
  // nobody "completes" the gate table later.
  lessonPlan: { id: 'menu_lesson_plan', titleKey: 'menuRowLessonPlanTitle', descriptionKey: 'menuRowLessonPlanDesc' },
  coaching: { id: 'menu_coaching', titleKey: 'menuRowCoachingTitle', descriptionKey: 'menuRowCoachingDesc' },
  observe: { id: 'menu_observe', titleKey: 'menuRowObserveTitle', descriptionKey: 'menuRowObserveDesc', gate: 'observeEnabled' },
  attendance: { id: 'menu_attendance', titleKey: 'menuRowAttendanceTitle', descriptionKey: 'menuRowAttendanceDesc' },
  staffAttendance: { id: 'menu_attendance', titleKey: 'menuRowStaffAttendanceTitle', descriptionKey: 'menuRowStaffAttendanceDesc' },
  classes: { id: 'menu_classes', titleKey: 'menuRowClassesTitle', descriptionKey: 'menuRowClassesDesc', gate: 'classesEnabled' },
  quiz: { id: 'menu_quiz', titleKey: 'menuRowQuizTitle', descriptionKey: 'menuRowQuizDesc', gate: 'quizEnabled' },
  assessment: { id: 'menu_assessment', titleKey: 'menuRowAssessmentTitle', descriptionKey: 'menuRowAssessmentDesc', gate: 'assessmentEnabled' },
  videos: { id: 'menu_videos', titleKey: 'menuRowVideosTitle', descriptionKey: 'menuRowVideosDesc', gate: 'videosEnabled' },
  roster: { id: 'menu_roster', titleKey: 'menuRowRosterTitle', descriptionKey: 'menuRowRosterDesc', gate: 'rosterEnabled' },
  language: { id: 'menu_language', titleKey: 'menuRowLanguageTitle', descriptionKey: 'menuRowLanguageDesc' },
  other: { id: 'menu_other', titleKey: 'menuRowOtherTitle', descriptionKey: 'menuRowOtherDesc' },
});

/**
 * One ordered layout per role shape. Ten rows is the cap, not a target.
 *
 * `teacher`   — canSelfCoach && !canObserve (and every unknown role)
 * `principal` — canSelfCoach && canObserve: she teaches AND she observes
 * `coach`     — canObserve && !canSelfCoach
 */
const LAYOUTS = Object.freeze({
  teacher: Object.freeze([
    ROW.lessonPlan, ROW.coaching, ROW.training, ROW.attendance, ROW.classes,
    ROW.quiz, ROW.assessment, ROW.videos, ROW.language, ROW.other,
  ]),
  principal: Object.freeze([
    ROW.observe, ROW.lessonPlan, ROW.coaching, ROW.training, ROW.roster,
    ROW.staffAttendance, ROW.assessment, ROW.language, ROW.other,
  ]),
  coach: Object.freeze([
    ROW.observe, ROW.roster, ROW.lessonPlan, ROW.training, ROW.assessment,
    ROW.language, ROW.other,
  ]),
});

/** Which layout this user gets. Unknown roles take the teacher shape. */
function layoutFor(user) {
  const dc = canSelfCoach(user);
  const observe = canObserve(user);
  if (dc && observe) return 'principal';
  if (observe) return 'coach';
  return 'teacher';
}

/**
 * @param {object|null} user
 * @param {object} [opts] one boolean per gate above. A gate that is absent is
 *   treated as CLOSED for every row that declares one — presence-based gating,
 *   per the architecture rule: no Flow, no row. `coaching`, `attendance`,
 *   `language` and `other` declare none, because they need no Flow to start.
 * @returns {Array<{id: string, titleKey: string, descriptionKey: string}>}
 */
function featureMenuRows(user, opts = {}) {
  const rows = LAYOUTS[layoutFor(user)]
    .filter((row) => !row.gate || opts[row.gate] === true)
    .map(({ id, titleKey, descriptionKey }) => ({ id, titleKey, descriptionKey }));

  // Belt and braces for a cap Meta enforces by rejecting the whole message. The
  // send site refuses and logs at error if this is ever exceeded; trimming here
  // keeps the builder's own contract true.
  return rows.slice(0, MAX_MENU_ROWS);
}

module.exports = {
  ROLE_FEATURES,
  DEFAULT_FEATURES,
  MAX_MENU_ROWS,
  ROW,
  LAYOUTS,
  featuresFor,
  canSelfCoach,
  canObserve,
  layoutFor,
  featureMenuRows,
};
