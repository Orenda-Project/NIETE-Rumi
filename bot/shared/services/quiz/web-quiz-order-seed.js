'use strict';
/**
 * Each sitting its own order (app_settings web_quiz_order_seed, JSON true only, from the hub's switch read).
 *
 * Without it every child on a quiz meets the same questions in the same order with the options in the same places,
 * and a re-sit a few minutes after the answers were shown serves exactly that again: the second score measures memory
 * of positions, and siblings on one phone hand each other the answer key. With it, the session start answers with the
 * sitting's own order: the served questions re-ordered, and, for every item whose meaning does not live in where its
 * options sit, the options re-ordered by slot.
 *
 * The seed is the session's own id (hashed): new for every sitting, the same on a resume, nothing stored. Answers stay
 * slots (the stored A-D column), so the score, the report, the league and every answer row read the same whatever order
 * a child saw. The served SET is not touched: the page drops nothing the server did not pick.
 *
 * Options that stay where they are (pinReason): true/false (the page draws ✓ on the first button), order / match / label
 * items (the positions are the question), a "listen" item (its clips are numbered), a P5 grid or "Sound n"/"Picture n"
 * labels or "all/none of the above" or a key the labels cannot carry (video-quiz-render isOrderLocked), and any item
 * with fewer than two options. A stored WhatsApp order (media.display_order) is NOT a pin on the page: the page never
 * shows the WhatsApp card whose painted letters it binds (web-quiz.service questionImageOf).
 */
const Render = require('./video-quiz-render.service');

const PINNED_KINDS = new Set(['tf', 'true_false', 'truefalse', 'order', 'order_steps', 'sequence', 'match', 'match_pairs',
  'matching', 'label', 'label_diagram', 'hotspot', 'listen']);
const ANCHORED = /^\s*(all|none|both|any)\s+of\s+(the\s+above|these|them|the\s+others)\s*[.!۔]?\s*$/i;
// The same whole-option rule in Urdu ("both", "none of these", "all of the above"): 16 of 13,521 questions sat on the web
// 7-21 Nov, as many as the English rule's 16. The WhatsApp card's lock (isOrderLocked) is English-only and is not changed here.
const ANCHORED_UR = new RegExp('^\\s*((یہ\\s*)?(مندرجہ\\s*بالا|اوپر\\s*(دیے|دئیے|دی)\\s*(گئے|گئی)?)\\s*(تمام|سب|سبھی)(\\s*(درست|صحیح))?'
  + '|(تمام|سب|سبھی)\\s*(مندرجہ\\s*بالا|درست|صحیح)|(یہ\\s*)?(ان|اِن)\\s*میں\\s*سے\\s*(کوئی\\s*(بھی\\s*)?نہیں|سب|تمام|دونوں)'
  + '|کوئی\\s*(بھی\\s*)?نہیں|دونوں|سب)\\s*(ہیں|ہے)?\\s*[.!۔]?\\s*$');

/** The sitting's seed: a 32-bit number from the session id, so a resume finds the same one. */
function seedOf(sessionId) {
  return Render.hash32(`wq-order:${sessionId}`);
}

function shuffled(list, seed) {
  const rnd = Render.mulberry32(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Why an item's options keep their places (null: they may move). `payload` is the page's question (questionPayload). */
function pinReason(row, payload) {
  const opts = (payload && payload.options) || [];
  if (opts.length < 2) return 'few';
  if (PINNED_KINDS.has(String((payload && payload.type) || '').toLowerCase())) return 'kind';
  if (Array.isArray(payload.left)) return 'kind';   // a tap-to-match decoded from a WhatsApp drawing (no `type` of its own)
  if (opts.some((o) => ANCHORED.test(String(o.text || '')) || ANCHORED_UR.test(String(o.text || '')))) return 'anchored';
  if (Render.isOrderLocked(row, Render.optionLabels(row))) return 'locked';
  return null;
}

/**
 * The sitting's order for the page: { q: [question ids], o: { id: [slots] } }, plus the seed and how many items kept
 * their options' places. `payloads` are the page's questions in served order (same length as `rows`).
 */
function sittingOrder(rows, payloads, sessionId) {
  const seed = seedOf(sessionId);
  const q = shuffled(rows.map((r) => r.id), seed);
  const o = {};
  let pinned = 0;
  rows.forEach((row, k) => {
    const p = payloads[k];
    if (pinReason(row, p)) { pinned += 1; return; }
    const slots = p.options.map((x) => x.slot);
    o[row.id] = shuffled(slots, Render.hash32(`${seed}|${row.external_id || row.id}`));
  });
  return { order: { q, o }, seed, pinned };
}

module.exports = { seedOf, pinReason, sittingOrder, ANCHORED_UR, KEY: 'web_quiz_order_seed' };
