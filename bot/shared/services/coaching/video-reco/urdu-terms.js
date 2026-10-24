'use strict';
/**
 * The Urdu words of the video message (bd-8hhqhf R7j §2, COS 20261024T022905): owned by the people who judge them. The data
 * file is ped-scale's `ped/urdu_terms.json`, shipped verbatim (bot/shared/data/video-reco-urdu-terms.v1.json); this module
 * only reads it. Pure.
 *   - moves: each move the engine may name → `ur` (the «‹term› پوچھا» slot) and `ur_alt` (oblique / accepted synonym);
 *   - the transcript frame: «سبق میں استاد نے ‹term› پوچھا، "…"۔ یہ کلپ اس بارے میں ہے: ‹chapter title›۔» — the term BEFORE
 *     the quote, an answer clause only from the file, nothing free after the quote; no move → the empty-descriptor template;
 *   - never_use: phrases the copy never carries, each with the one to use instead.
 */
const DATA = require('../../../data/video-reco-urdu-terms.v1.json');

const MOVES = Object.freeze((DATA.moves || []).filter((m) => m && m.id && m.ur));
const BY_ID = new Map(MOVES.map((m) => [m.id, m]));
// The moves a teacher does rather than asks (rules: «تھنک پیئر شیئر / جوڑیوں میں بات چیت / ساتھی کو سمجھانا take کروایا»)
const ACTIVITY = new Set(['think_pair_share', 'pair_talk', 'partner_explanation', 'student_to_student']);
// The answer-type clauses the rules name («اور جواب ایک ساتھ آیا» / «اور فوری جواب آیا» / «اور ایک لفظ کا جواب آیا»)
const ANSWERS = Object.freeze({ chorus_answer: 'جواب ایک ساتھ آیا', quick_answers: 'فوری جواب آیا', one_word_answer: 'ایک لفظ کا جواب آیا' });
// The moves the transcript frame may name before a quote (the answer types and the logistics row are not a teacher's move)
const FRAME_MOVES = MOVES.filter((m) => !ANSWERS[m.id] && m.id !== 'logistics_aside');

const frame = (id) => ((DATA.frames || []).find((f) => f.id === id) || {});
const TRANSCRIPT = frame('transcript_frame_ur').ur || 'سبق میں استاد نے ‹term› پوچھا، "…"۔ یہ کلپ اس بارے میں ہے: ‹chapter title›۔';
const EMPTY = DATA.empty_descriptor_template || 'سبق میں استاد نے بچوں سے پوچھا، "…"۔';
const CLIP_HALF = TRANSCRIPT.slice(TRANSCRIPT.indexOf('یہ کلپ')); // «یہ کلپ اس بارے میں ہے: ‹chapter title›۔»

/**
 * The Urdu line for a cited moment. `moveId` / `answerId` are the model's; anything not in the file is no move.
 * @returns {string} the line, the quote in plain double quotes (copy.js isolates it)
 */
function transcriptLine({ moveId = null, answerId = null, quote = '', title = '' } = {}) {
  const q = String(quote || '').trim();
  const move = FRAME_MOVES.find((m) => m.id === moveId) || null;
  const clip = CLIP_HALF.replace('‹chapter title›', String(title || '').trim().replace(/[۔.]$/u, ''));
  if (!move) return `${EMPTY.replace('…', q)} ${clip}`;
  const verb = ACTIVITY.has(move.id) ? 'کروایا' : 'پوچھا';
  const head = TRANSCRIPT.slice(0, TRANSCRIPT.indexOf('"…"') + 3).replace('‹term›', move.ur).replace('پوچھا', verb).replace('…', q);
  const ans = ANSWERS[answerId];
  return ans ? `${head}، اور ${ans}۔ ${clip}` : `${head}۔ ${clip}`;
}

/** The prompt's list: each move id with its Urdu term (the model names the move by id; the engine writes the Urdu). */
function glossary() {
  return FRAME_MOVES.map((m) => `${m.id} = «${m.ur}»`).join('; ');
}

/** The answer-type ids the model may name. */
const answerIds = () => Object.keys(ANSWERS);

/**
 * The never-use rewrites: [phrase, replacement] for the rows whose replacement is a phrase (the first of «a / b»); rows
 * whose advice is prose («(omit…)», «name what happened») and Latin-description rows are left to the frame and the prompt.
 */
const VERB_END = /(?:دیا|دی|دیے|کیا|کی|کیے|لیا|لی|آیا|آئی|پوچھا|مانگے|گئے|گیا|رہا)$/u;
const NEVER = Object.freeze((DATA.never_use || []).flatMap((n) => {
  const phrase = String(n.phrase || '').trim();
  const options = String(n.use_instead || '').split(' / ').map((x) => x.trim());
  // a clause («…جواب دیا») takes the option that is a clause too («جواب ایک ساتھ آیا»), else the first
  const use = (VERB_END.test(phrase) && options.find((o) => VERB_END.test(o))) || options[0];
  if (!phrase || /[A-Za-z(…]/.test(phrase) || /[A-Za-z()…]/.test(use) || phrase.includes(' / ')) return [];
  return [[phrase, use]];
}).sort((a, b) => b[0].length - a[0].length)); // the longest phrase first («بچوں نے سب کا مل کر جواب دیا» before «سب کا مل کر جواب»)

module.exports = { MOVES, FRAME_MOVES, ANSWERS, BY_ID, NEVER, transcriptLine, glossary, answerIds, header: frame('header_ur'), plainOther: frame('card_frame_other_ur') };
