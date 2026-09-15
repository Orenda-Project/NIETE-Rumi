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
 * The main-menu rows, in a stable order. Training / Lesson Plans / Ask
 * Anything are unchanged for everyone; only the two role-shaped rows move.
 *
 * This module owns the ROLE RULE and the row IDS. It does NOT own the copy:
 * each row names its catalog keys and the send site resolves them in the
 * teacher's language. The copy used to sit here as English literals, which is
 * how 9,205 menu sends in nine days went out in English to a cohort that is
 * 99.0% Urdu — the builder had no language argument to give them. Moving the
 * copy to a per-language map HERE would only relocate the problem: a map
 * outside the designated catalog is invisible to resolveUx, to the field-cap
 * check and to the language audit that guards it.
 *
 * The ids are never translated. WhatsApp list rows stay tappable forever and
 * the reply router matches on the id.
 *
 * Caps live with the copy (catalog): row title 24 code points, description 72.
 *
 * Still pure — no IO, and the one require is a static in-process catalog. That
 * matters because this file is consulted on the audio hot path, where a
 * failure would park a teacher's recording rather than return a 403.
 *
 * @param {object|null} user
 * @param {{observeEnabled?: boolean}} [opts] observeEnabled — the market has a
 *   published observe Flow (OBSERVE_MEWAKA_FLOW_ID). Presence-based gating,
 *   per the NIETE architecture rule: no Flow, no row.
 * @returns {Array<{id: string, titleKey: string, descriptionKey: string}>}
 */
function featureMenuRows(user, opts = {}) {
  const rows = [
    // Training first: it is the thing teachers are actually being asked to do,
    // and it was once missing from this list entirely.
    { id: 'menu_training', titleKey: 'menuRowTrainingTitle', descriptionKey: 'menuRowTrainingDesc' },
    { id: 'menu_lesson_plan', titleKey: 'menuRowLessonPlanTitle', descriptionKey: 'menuRowLessonPlanDesc' },
  ];

  if (canSelfCoach(user)) {
    rows.push({ id: 'menu_coaching', titleKey: 'menuRowCoachingTitle', descriptionKey: 'menuRowCoachingDesc' });
  }
  if (canObserve(user) && opts.observeEnabled === true) {
    rows.push({ id: 'menu_observe', titleKey: 'menuRowObserveTitle', descriptionKey: 'menuRowObserveDesc' });
  }

  // Reading Assessment and AI Video Generation are NOT rows, by product
  // decision. Their /readingtest and /video commands still work, and
  // menu.service still handles menu_reading / menu_video, because WhatsApp list
  // rows live in scrollback forever and an old tap must still land somewhere.
  // Do not "tidy" those handlers away because no row points at them.
  rows.push({ id: 'menu_other', titleKey: 'menuRowOtherTitle', descriptionKey: 'menuRowOtherDesc' });
  return rows;
}

module.exports = {
  ROLE_FEATURES,
  DEFAULT_FEATURES,
  featuresFor,
  canSelfCoach,
  canObserve,
  featureMenuRows,
};
