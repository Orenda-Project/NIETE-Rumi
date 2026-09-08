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
 * The K-5 lesson-plan BROADCAST button, matched exactly — bd-oak77.4.
 *
 * Meta template QUICK_REPLY buttons arrive with no routable id: `whatsapp-bot.js` falls the visible
 * LABEL through to the text handler as an ordinary message (bd-kggts). The label is
 * "Lesson Plans & Assessment", which the pre-bd-hgwfo tiered matcher caught at STRONG tier — and
 * bd-hgwfo's narrowing to whole-message-is-the-artefact-name silently dropped it, leaving the button
 * to the LLM classifier. `template-button-fallthrough.test.js` has been failing on `develop` ever
 * since, saying so.
 *
 * This is an EXACT match on a label we ourselves publish, not a re-widening of BARE: the same shape
 * as `isSelectVideoButton`, which exists for exactly this Meta behaviour. A teacher who
 * types those three words as a sentence still goes to the classifier, because BARE is unchanged.
 *
 * If the template's button title changes at Meta, this constant changes with it — the test pins the
 * label and Meta's 25-character cap together so they cannot drift apart.
 */
const BROADCAST_BUTTON_LABELS = Object.freeze(['lesson plans & assessment']);

/**
 * @returns {{matched: boolean, tier: 'bare'|'broadcast_button'|'none', token: string|null}}
 */
function matchDetail(text) {
  if (typeof text !== 'string') return { matched: false, tier: 'none', token: null };
  const t = text.trim();
  if (!t) return { matched: false, tier: 'none', token: null };
  const m = BARE.exec(t);
  if (m) return { matched: true, tier: 'bare', token: m[0].trim() };
  if (BROADCAST_BUTTON_LABELS.includes(t.toLowerCase())) {
    return { matched: true, tier: 'broadcast_button', token: t };
  }
  return { matched: false, tier: 'none', token: null };
}

/** Is this message just a request for the lesson-plan menu? */
function isLessonPlanRequest(text) {
  return matchDetail(text).matched;
}

module.exports = { isLessonPlanRequest, matchDetail, BARE, BROADCAST_BUTTON_LABELS };
