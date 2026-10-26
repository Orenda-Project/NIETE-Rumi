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
const { closedQuestion } = require('./copy-rules');

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

// R7k (COS 044233 §1d; ped/urdu_terms.json v2 reason_frames): the line is built from the term's KIND. A question type keeps
// the q_frame («استاد نے ‹term› پوچھا، "…"»); a move name never says the teacher did the clip's move («استاد نے تھنک پیئر
// شیئر کروایا», 16 v8 rows): the gap first, then the move as the clip's («… یہ کلپ ‹term› دکھاتا ہے۔»). Descriptors, subject
// words and logistics are never the term (the empty-descriptor line).
const RF = DATA.reason_frames || {};
const MOVE_FRAME = (RF.move_frame && RF.move_frame.ur) || 'سبق میں استاد نے سوال پوچھا، "‹quote›"، ‹gap_clause›۔ یہ کلپ ‹term› دکھاتا ہے۔';
const GAPS = (RF.move_frame && RF.move_frame.gap_clauses) || {};
const FEEDBACK = String((RF.move_frame && RF.move_frame.feedback_variant) || '').replace(/^[^«]*«|»[^»]*$/g, '')
  || 'سبق میں استاد نے جواب پر "‹quote›" کہا اور اگلا قدم نہیں بتایا۔ یہ کلپ ‹term› دکھاتا ہے۔';
// the clip's own name for the feedback move, as the frame's example writes it («یہ کلپ دو حصوں والا فیڈبیک دکھاتا ہے»); the
// moves row's «شاباش اور ایک مشورہ» names what the teacher says, not the clip (v8 Z045 Z096 Z412)
const FEEDBACK_CLIP = ((((RF.move_frame && RF.move_frame.examples) || []).find((x) => x.includes('شاباش')) || '').match(/یہ کلپ (.+?) دکھاتا ہے/u) || [])[1] || null;
const clipTerm = (m) => (m.id === 'feedback_two_part' && FEEDBACK_CLIP) || m.ur;
// a quote that ends in its own mark takes no second one («؟۔», v8 Z108)
const closeQ = (line) => line.replace(/([؟?!])"([۔.])/gu, '$1"').replace(/([؟?!])\s*[۔.]$/u, '$1'); // …and a title's own mark (H2)
const kindOf = (m) => m.kind || (ACTIVITY.has(m.id) || m.id === 'feedback_two_part' ? 'move_name' : 'question_type');
const LINE_MOVES = FRAME_MOVES.filter((m) => ['question_type', 'move_name'].includes(kindOf(m)));
// the file's truth guards: a closed line is never «کھلا سوال» / «کیوں والا سوال»; «دہرائی» only on a question; the feedback
// variant only on a praise line
const WHY_HOW = /کیوں|کیسے|\bwhy\b|\bhow\b/iu;
const PRAISE = /شاباش|ویری گڈ|گڈ|بہت اچھے|بہت خوب|\b(?:good|very good|well done|excellent)\b/iu;
const truthful = (m, q) => {
  if (['why_question', 'why_how_question'].includes(m.id)) return WHY_HOW.test(q);
  if (m.id === 'open_question') return WHY_HOW.test(q) || !closedQuestion(q);
  if (m.id === 'recap_review') return /[?؟]/.test(q) && !PRAISE.test(q);
  return true;
};
// the gap clause only when the model's answer type shows it (one child / the class together), and only for a talk move
const gapOf = (move, answerKey) => {
  if (!ACTIVITY.has(move.id)) return null;
  if (answerKey === 'chorus_answer') return GAPS.chorus || null;
  if (answerKey === 'one_word_answer' || answerKey === 'quick_answers') return GAPS.one_child_answered || null;
  return null;
};

/**
 * The Urdu line for a cited moment. `moveId` / `answerId` are the model's; anything not in the file is no move.
 * @returns {string} the line, the quote in plain double quotes (copy.js isolates it)
 */
function transcriptLine({ moveId = null, answerId = null, quote = '', title = '' } = {}) {
  const q = String(quote || '').trim();
  // the model names a move by id; it sometimes writes the term itself (gold r7 b1ad001: 14 of 52), which is the same move
  const key = String(moveId || '').trim();
  const found = LINE_MOVES.find((m) => m.id === key || m.ur === key || m.ur_alt === key) || null;
  const move = found && truthful(found, q) ? found : null;
  const clip = CLIP_HALF.replace('‹chapter title›', String(title || '').trim().replace(/[۔.]$/u, ''));
  if (!move) return closeQ(`${EMPTY.replace('…', q)} ${clip}`);
  const ansKey = Object.keys(ANSWERS).find((id) => id === answerId || (BY_ID.get(id) || {}).ur === answerId || (BY_ID.get(id) || {}).ur_alt === answerId);
  if (kindOf(move) === 'move_name') {
    if (move.id === 'feedback_two_part' && PRAISE.test(q)) return FEEDBACK.replace('‹quote›', q).replace('‹term›', clipTerm(move));
    const gap = gapOf(move, ansKey);
    const line = MOVE_FRAME.replace('‹quote›', q).replace('‹term›', clipTerm(move));
    return closeQ(gap ? line.replace('‹gap_clause›', gap) : line.replace(/"،\s*‹gap_clause›۔/u, '"۔')); // no_gap_visible: close at the quote
  }
  const head = TRANSCRIPT.slice(0, TRANSCRIPT.indexOf('"…"') + 3).replace('‹term›', move.ur).replace('…', q);
  const ans = ANSWERS[ansKey];
  return closeQ(ans ? `${head}، اور ${ans}۔ ${clip}` : `${head}۔ ${clip}`);
}

// The English line for an Urdu-report teacher (the portal's), mirroring the same frame in one script after the quote
// (ped/urdu_terms.json v2 other_language_line_en; v8 Z017 Z294 Z386 switched to Urdu). The file gives no English answer
// tail, so the q-frame closes at the quote.
const termEn = (m) => { const t = String(m.en || '').split(' (')[0].trim(); return t.includes(' / ') ? t.split(' / ').pop().trim() : t; };
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
/** The English mirror line for a cited moment, or null when the move is not one the file frames (the caller keeps its line). */
function transcriptLineEn({ moveId = null, answerId = null, quote = '', title = '' } = {}) {
  const q = String(quote || '').trim();
  const key = String(moveId || '').trim();
  const found = LINE_MOVES.find((m) => m.id === key || m.ur === key || m.ur_alt === key) || null;
  const move = found && truthful(found, q) ? found : null;
  const t = String(title || '').trim().replace(/[.۔]$/u, '');
  if (!move || !termEn(move) || !t) return null;
  if (kindOf(move) === 'move_name') {
    const ansKey = Object.keys(ANSWERS).find((id) => id === answerId);
    const gap = gapOf(move, ansKey) === GAPS.one_child_answered && GAPS.one_child_answered ? ', and one child answered; the others did not talk to each other' : '';
    return closeQ(`In the lesson the teacher asked, "${q}"${gap}. This clip shows ${termEn(move)}.`);
  }
  return closeQ(`In the lesson the teacher asked ${article(termEn(move))} ${termEn(move)}, "${q}". This clip is about: ${t}.`);
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

module.exports = { MOVES, FRAME_MOVES, ANSWERS, BY_ID, NEVER, transcriptLine, transcriptLineEn, glossary, answerIds, header: frame('header_ur'), plainOther: frame('card_frame_other_ur') };
