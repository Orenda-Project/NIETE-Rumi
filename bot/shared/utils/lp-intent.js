'use strict';
/**
 * Is this message JUST a request for the lesson-plan menu?
 *
 * A receptionist, not a router. It fires only when the whole message is the
 * artefact name — "lp", "lesson plan", "/lesson plans", "لیسن پلان" — the way
 * a bare "video" opens the video library (isVideoCommand, bd-2486). A message
 * that carries anything else goes to the LLM intent classifier, which knows
 * what was just delivered (bd-wpupy) and decides with context: a NEW request
 * lands on the same Flow via the lesson_plan intent; a follow-up about the
 * lesson she already has gets the lesson rewritten.
 *
 * History (bd-hgwfo, 2026-08-30). This used to fire on ANY mention — a tiered
 * STRONG / WEAK / BLOCK matcher (bd-hvhhu) — because a message that reached
 * the LLM "often produced a GENERATED plan instead of the ready-made corpus".
 * bd-2540 retired generation, which removed the reason and left the cost: on
 * production, 16-30 Aug, 748 messages were intercepted and 47% were ones the
 * picker could not answer — dictated observations, feedback on a delivered
 * plan, "shorten this lp". 153 were a bare command. This is the 153.
 *
 * Deliberately NOT an LLM call: it runs on every inbound text, and a
 * deterministic matcher is testable, instant, and free.
 */

// The whole message, allowing a leading slash (111 of the 153 production
// bare messages were "/lesson plan"), a stray slash after, and trailing
// punctuation in either script. Word forms: lp/lps, lesson/lessons,
// lesson plan(s) joined or hyphenated, and the Urdu names.
const BARE = new RegExp(
  '^\\/?\\s*(?:'
  + 'lps?|lessons?(?:[\\s-]*plans?)?'
  + '|لیسن(?:\\s*پلان)?'
  + '|سبق\\s*ک[اے]\\s*منصوبہ'
  + ')\\s*\\/?[\\s.!?،۔؟]*$',
  'iu',
);

/**
 * @returns {{matched: boolean, tier: 'bare'|'none', token: string|null}}
 */
function matchDetail(text) {
  if (typeof text !== 'string') return { matched: false, tier: 'none', token: null };
  const t = text.trim();
  if (!t) return { matched: false, tier: 'none', token: null };
  const m = BARE.exec(t);
  if (m) return { matched: true, tier: 'bare', token: m[0].trim() };
  return { matched: false, tier: 'none', token: null };
}

/** Is this message just a request for the lesson-plan menu? */
function isLessonPlanRequest(text) {
  return matchDetail(text).matched;
}

module.exports = { isLessonPlanRequest, matchDetail, BARE };
