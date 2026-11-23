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
 * a child saw. The served SET is not touched: the page drops nothing the server did not pick. Each question's place is a
 * rank by a hash of the seed and the question's own id (ranked), not a shuffle of the list: when the served set changes
 * under an open sitting (an answer-key hold set or cleared, a quiz edited), the resume keeps the sequence of the questions
 * both lists share.
 *
 * Options that stay where they are (pinReason): true/false (the page draws ✓ on the first button), order / match / label
 * items (the positions are the question), a "listen" item (its clips are numbered), a P5 grid or "Sound n"/"Picture n"
 * labels or "all/none of the above" or a key the labels cannot carry (video-quiz-render isOrderLocked), and any item
 * with fewer than two options. A stored WhatsApp order (media.display_order) is NOT a pin on the page: the page never
 * shows the WhatsApp card whose painted letters it binds (web-quiz.service questionImageOf).
 */
const Render = require('./video-quiz-render.service');
const AB = require('../ab-assign.service');
const { logToFile } = require('../../utils/logger');

const PINNED_KINDS = new Set(['tf', 'true_false', 'truefalse', 'order', 'order_steps', 'sequence', 'match', 'match_pairs',
  'matching', 'label', 'label_diagram', 'hotspot', 'listen']);
const ANCHORED = /^\s*(all|none|both|any)\s+of\s+(the\s+above|these|them|the\s+others)\s*[.!۔]?\s*$/i;
// The same whole-option rule in Urdu ("both", "none of these", "all of the above"): 16 of 13,521 questions sat on the web
// 7-21 Nov, as many as the English rule's 16. The WhatsApp card's lock (isOrderLocked) is English-only and is not changed here.
const ANCHORED_UR = new RegExp('^\\s*((یہ\\s*)?(مندرجہ\\s*بالا|اوپر\\s*(دیے|دئیے|دی)\\s*(گئے|گئی)?)\\s*(تمام|سب|سبھی)(\\s*(درست|صحیح))?'
  + '|(تمام|سب|سبھی)\\s*(مندرجہ\\s*بالا|درست|صحیح)|(یہ\\s*)?(ان|اِن)\\s*میں\\s*سے\\s*(کوئی\\s*(بھی\\s*)?نہیں|سب|تمام|دونوں)'
  + '|کوئی\\s*(بھی\\s*)?نہیں|دونوں|سب)\\s*(ہیں|ہے)?\\s*[.!۔]?\\s*$');

/**
 * web_quiz_order_seed_pct as an A/B test of the shared module (ab-assign assignArm): the registry (ab/registry.json) knows
 * it as this flag_key, the pct row sets its share. A link is in the on arm only while the registry carries this test's
 * frozen card; without it every link gets control ('off') and the module logs one line.
 */
const ORDER_TEST = Object.freeze({ flagKey: 'ab_web_quiz_own_order', salt: 'ict-web-quiz-own-order:link' });
const abLog = (m) => logToFile(`⚠️ ${m}`);

/**
 * Is the sitting order on for this link? The global switch (flags.orderSeed) wins; else web_quiz_order_seed_pct puts
 * N% of links in the on arm by the link's own hash, the same links every time (siblings on one link share an arm).
 */
function onFor(flags, shareCodeId) {
  const arm = armOf(flags, shareCodeId);
  return arm === 'all' || arm === 'pct';
}

/**
 * The link's arm, for session_started.order_arm: 'all' (the global switch), 'pct' (in web_quiz_order_seed_pct's arm),
 * 'off' (a pct canary runs and this link is out of it), or null when neither switch is set (no field: today's event).
 */
function armOf(flags, shareCodeId) {
  if (flags && flags.orderSeed) return 'all';
  const pct = (flags && flags.orderSeedPct) || 0;
  if (!(pct > 0)) return null;
  if (!shareCodeId) return 'off';
  // assignArm takes the arms in key order: 'off' holds the low buckets and 'pct' the top N%, so a larger N only adds links
  const on = Math.min(10000, Math.round(pct * 100));
  return AB.assignArm({ ...ORDER_TEST, unitId: String(shareCodeId), sharesBp: { off: 10000 - on, pct: on }, controlArm: 'off' },
    { log: abLog });
}

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

// session_started.order_algo: how this code orders a sitting's questions. 'rank' (ranked below); the earlier list
// shuffle was 'shuffle', and its events carry no order_algo, so a read can tell which code served a sitting.
const ALGO = 'rank';

/** The questions in the sitting's order: each id's rank by a hash of (seed, id), so one leaving or joining moves no other. */
function ranked(ids, seed) {
  const key = new Map(ids.map((id) => [id, Render.mulberry32(Render.hash32(`${seed}|q|${id}`))()]));
  return ids.slice().sort((a, b) => (key.get(a) - key.get(b)) || (String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0)));
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
  const q = ranked(rows.map((r) => r.id), seed);
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

module.exports = { onFor, armOf, seedOf, pinReason, sittingOrder, ANCHORED_UR, ORDER_TEST, ALGO, KEY: 'web_quiz_order_seed' };
