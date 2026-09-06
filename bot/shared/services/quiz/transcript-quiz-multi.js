'use strict';
/**
 * "Select all that apply" — a quiz question with more than one right answer.
 *
 * WhatsApp reply buttons and list rows are SINGLE-SELECT. There is no tap
 * surface in an ordinary message that lets a child choose a set, so a question
 * whose answer is a set is delivered as a **Flow with a CheckboxGroup** — the
 * same mechanism the teacher-training exam already uses
 * (`services/training/quiz-delivery.service.js`, `docs/flows/training-msq-flow.json`),
 * pointed at a child instead of a teacher and made per-language.
 *
 * WHAT IS SET WHERE, and why there is no schema change
 *   `correct_option`      "A,C" — a comma-joined letter set. Already the shape
 *                         `video-quiz-render.correctIndices()` parses, and the
 *                         column is TEXT with no A/B/C constraint (asserted
 *                         against the live database, not read off the schema
 *                         file, which still carries a stale CHECK).
 *   `media.answer_mode`   'multi'. The single discriminator every consumer
 *                         reads; its absence means today's behaviour, exactly.
 *   `media.display_order` the persisted display order (PLAN_R5 D1). Read when
 *                         present so the letters on the card, the checkboxes in
 *                         the Flow and the verdict are one order; falls back to
 *                         the seeded shuffle when a row predates it.
 *
 * THREE RULES THAT ARE NOT STYLE
 *  1. **The cue is written by CODE, never by the model.** The author is told to
 *     write the question and forbidden to write "select all that apply" into
 *     the stem; the renderer prepends the cue from the catalog, in both
 *     languages, on every surface. A prompt rule the model follows 95% of the
 *     time would leave one child in twenty facing a set question that looks
 *     single (root rule 24c).
 *  2. **The Flow is never told how many answers are right.** `max_selected` is
 *     the OPTION count. Capping it at the size of the answer key would hand the
 *     child the cardinality of the set, which is most of the question.
 *  3. **A missing Flow degrades, it never blanks.** With `QUIZ_MULTI_FLOW_ID`
 *     unset the question is asked as an ordinary picker that SAYS more than one
 *     answer is right, and any right option scores — a degraded question, not a
 *     silent one, and one logged event per occurrence so we know it happened.
 */

const { resolveUx } = require('../../config/ux-strings');
const { truncateCodePoints, cpLen } = require('./religious-marks');

const ANSWER_MODE_MULTI = 'multi';

/**
 * Meta's cap on a CheckboxGroup data-source item TITLE. An option longer than
 * this is truncated by the client without a word, so it is enforced at
 * AUTHORING time (the validator rejects and the retry prompt says why) rather
 * than papered over at render time. It is deliberately tighter than the
 * single-select OPTION_MAX (72, the list-row description cap): a checkbox row
 * has no description to spill into.
 */
const MULTI_OPTION_MAX = 30;

/** A quiz is a walk through a lesson, not a set-theory exam. */
const MAX_MULTI_PER_QUIZ = 2;

/** Question 1 must be the easiest, so a nervous child gets one right first. */
const FIRST_QUESTION_IS_SINGLE = true;

const MIN_OPTIONS = 3;
const MAX_OPTIONS = 4;

const LETTERS = ['A', 'B', 'C', 'D'];
const TOKEN_PREFIX = 'vqm';

/** The literal echoed in the Flow's completion payload; see docs/flows/quiz-multi-select-flow.json. */
const FLOW_ACTION = 'answer';

const ux = (key, language, params) => resolveUx(key, { language, params });

// ─── shape ───────────────────────────────────────────────────────────────────

/** An AUTHORED question (the model's JSON), before it is a row. */
function isMultiQuestion(q) {
  return Boolean(q) && String(q.answer_mode || '') === ANSWER_MODE_MULTI;
}

/** A STORED row (quiz_questions). */
function isMultiRow(row) {
  return Boolean(row) && Boolean(row.media) && String(row.media.answer_mode || '') === ANSWER_MODE_MULTI;
}

/** The authored correct set, as sorted distinct integers. Junk is dropped, not guessed at. */
function authoredCorrectIndices(q) {
  const raw = Array.isArray(q && q.correct_indices) ? q.correct_indices : [];
  const seen = new Set();
  raw.forEach((v) => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0) seen.add(n);
  });
  return [...seen].sort((a, b) => a - b);
}

/** "A,C" from [0,2]. The storage form. */
function lettersFor(indices) {
  return indices.slice().sort((a, b) => a - b).map((i) => LETTERS[i]).filter(Boolean).join(',');
}

/** [0,2] from "A,C". Mirrors video-quiz-render.correctIndices, kept here so a
 *  caller that has no render import can still read a row's answer key. */
function indicesFor(letterSet) {
  return String(letterSet || '')
    .split(',')
    .map((c) => LETTERS.indexOf(c.trim()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
}

// ─── the validator's multi branch ────────────────────────────────────────────

/**
 * A stem must NOT carry its own "select all" cue: the renderer adds one, in the
 * quiz language, on every surface. A model-written cue would either duplicate
 * it or contradict it, and on the questions where the model forgot, nothing
 * would say the question was a set at all.
 */
const STEM_WRITES_ITS_OWN_CUE =
  /select all that apply|choose all that apply|tick all|all that are correct|سب درست جواب|تمام درست جواب|جتنے جواب درست/i;

/**
 * Every rule for ONE authored multi question, each with its own error string —
 * the retry prompt quotes these back verbatim, so "bad multi question" would
 * send the model re-rolling blind.
 *
 * @returns {string[]} `q<i>: CODE — message` lines; empty when the question is fine
 */
function questionErrors(q, i) {
  const errs = [];
  const opts = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()) : [];
  if (opts.length < MIN_OPTIONS || opts.length > MAX_OPTIONS) {
    errs.push(`q${i}: MULTI_OPTION_COUNT — a "select all that apply" question needs ${MIN_OPTIONS} or ${MAX_OPTIONS} options; got ${opts.length}`);
  }
  if (opts.some((o) => !o)) errs.push(`q${i}: empty option`);
  if (new Set(opts).size !== opts.length) errs.push(`q${i}: duplicate options`);
  opts.forEach((o) => {
    if (cpLen(o) > MULTI_OPTION_MAX) {
      errs.push(`q${i}: MULTI_OPTION_LONG — an option on a "select all that apply" question is a checkbox label, capped at ${MULTI_OPTION_MAX} characters; "${o.slice(0, 40)}" is ${cpLen(o)}`);
    }
  });

  const correct = authoredCorrectIndices(q);
  if (correct.length < 2) {
    errs.push(`q${i}: MULTI_TOO_FEW_CORRECT — "correct_indices" must name at least 2 correct options; got ${JSON.stringify(q.correct_indices ?? null)}`);
  }
  if (opts.length && correct.length >= opts.length) {
    errs.push(`q${i}: MULTI_ALL_CORRECT — ${correct.length} of ${opts.length} options are correct; at least one must be wrong`);
  }
  if (opts.length && correct.some((c) => c >= opts.length)) {
    errs.push(`q${i}: MULTI_INDEX_RANGE — "correct_indices" ${JSON.stringify(correct)} names an option that does not exist (there are ${opts.length})`);
  }

  const stem = String(q.question || '').trim();
  if (STEM_WRITES_ITS_OWN_CUE.test(stem)) {
    errs.push(`q${i}: MULTI_STEM_CUE — do not write "select all that apply" into the stem; the quiz adds that line itself, in the quiz language, on every screen. Write the question alone.`);
  }

  // Per-option feedback, keyed exactly on the WRONG options — the same contract
  // as a single-answer question, widened to a set.
  const fb = (q.option_feedback && typeof q.option_feedback === 'object') ? q.option_feedback : { correct: '', wrong: {} };
  const need = opts.map((_, k) => k).filter((k) => !correct.includes(k)).map(String).sort();
  const have = Object.keys(fb.wrong || {}).sort();
  if (need.join(',') !== have.join(',')) {
    errs.push(`q${i}: MULTI_FEEDBACK_KEYS — "option_feedback.wrong" keys [${have}] must be exactly the options that are NOT correct [${need}]`);
  }
  if (need.some((k) => !String((fb.wrong || {})[k] || '').trim())) errs.push(`q${i}: empty wrong feedback`);
  if (!String(fb.correct || '').trim()) errs.push(`q${i}: empty correct feedback`);
  return errs;
}

/** Rules about the SET of questions, not any one of them. */
function quizErrors(questions) {
  const errs = [];
  const list = Array.isArray(questions) ? questions : [];
  const multi = list.map((q, i) => (isMultiQuestion(q) ? i : -1)).filter((i) => i >= 0);
  if (multi.length > MAX_MULTI_PER_QUIZ) {
    errs.push(`MULTI_SHARE — ${multi.length} questions are "select all that apply"; at most ${MAX_MULTI_PER_QUIZ} may be`);
  }
  if (FIRST_QUESTION_IS_SINGLE && multi.includes(0)) {
    errs.push('MULTI_FIRST — question 1 must be the easiest one-answer question, never "select all that apply"');
  }
  // A mode we do not serve is worse than none: it would store as single and
  // score the first correct option only.
  list.forEach((q, i) => {
    const mode = q && q.answer_mode;
    if (mode !== undefined && mode !== null && mode !== '' && mode !== 'single' && mode !== ANSWER_MODE_MULTI) {
      errs.push(`q${i}: MULTI_MODE — "answer_mode" is "${mode}"; the only values are "single" (or omitted) and "${ANSWER_MODE_MULTI}"`);
    }
  });
  return errs;
}

// ─── the author's contract block ─────────────────────────────────────────────

/**
 * The prompt paragraph. Appended to the author prompt only when the deployment
 * can actually DELIVER a multi question — asking for one we cannot render is
 * how a child ends up with a set question and a single-select picker.
 */
function multiContract({ allowMulti = false, n = 8 } = {}) {
  if (!allowMulti) return '';
  return `
"SELECT ALL THAT APPLY" QUESTIONS.
At most ${MAX_MULTI_PER_QUIZ} of the ${n} questions may have MORE THAN ONE correct answer, and question 1 never may. Write one only where the lesson genuinely taught a SET — several properties of the same thing, several members of a category, several steps that belong to one stage — never by splitting a single-answer question in two.
Such a question carries "answer_mode": "multi" and "correct_indices": a list of the 2 (or at most options−1) indices that are correct. It may have 3 OR 4 options; a single-answer question still has exactly 3.
- Do NOT write "select all that apply" (or its Urdu equivalent) into the stem. The quiz prints that line itself, in the quiz language, above the checkboxes and on the printed card. Write the question alone.
- Each option is a CHECKBOX LABEL: at most ${MULTI_OPTION_MAX} characters, no full sentences.
- "option_feedback.wrong" is keyed by every index that is NOT in "correct_indices"; each says which confusion picking it shows.
- "option_feedback.correct" names why the WHOLE set is right, not just one member.
- Every wrong option must be genuinely wrong. A "sometimes true" option makes the question unmarkable.
Shape:
  { "slo_id": "S3", "level": "understand", "question": "", "options": ["", "", "", ""],
    "answer_mode": "multi", "correct_indices": [0, 2], "explanation": "", "selected_because": "",
    "distractor_misconceptions": { "1": "", "3": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "3": "" } }, "figure": null, "figure_role": null }
Omit "answer_mode" and "correct_indices" entirely on every ordinary one-answer question — those keep "correct_index".`;
}

/** Read at call time, never at module load, so a restart is enough to turn it on or off. */
function multiFlowId() {
  return process.env.QUIZ_MULTI_FLOW_ID || '';
}

// ─── display ─────────────────────────────────────────────────────────────────

/**
 * The order stored on the row, or null.
 *
 * PLAN_R5 D1: the order is decided once at generation and stored on the row. A
 * row written before D1 has none, and the caller falls back to the seeded
 * shuffle — the caller, not this function, because this module must not require
 * video-quiz-render: that module requires THIS one to build a set question, and
 * the pair would be a require cycle (tests/setup/circular-deps).
 */
function persistedOrder(row, labels) {
  const stored = row && row.media && row.media.display_order;
  const ok = Array.isArray(stored) && stored.length === labels.length
    && stored.every((v) => Number.isInteger(v) && v >= 0 && v < labels.length)
    && new Set(stored).size === stored.length;
  return ok ? stored.slice() : null;
}

/**
 * The message list for one multi question.
 *
 * ONE interaction message, and no separate question-image message: the card or
 * figure rides as the Flow's own image header so the picture and the checkboxes
 * arrive together. The fallback path re-sends it as a chat image before the
 * picker, so the child sees the picture on both paths and never twice.
 *
 * There is no ANSWER phase here. A single-answer verdict is one of N pre-built
 * branches the sender filters by the index tapped; a set has no such branch —
 * what is said depends on which members were missed and which were added. The
 * verdict is composed in `verdictText()` at grading time and sent directly.
 */
function buildMulti(row, { order, shown, language }) {
  const media = row.media || {};
  const stem = String(row.question_text || '').trim();
  const cue = ux('vqMultiSelectAll', language);
  return [{
    phase: 'interaction',
    kind: 'multiflow',
    role: 'ask',
    // `body` is what an ordinary picker would show; `stem` is kept apart because
    // the Flow puts the question in its own heading and the cue in the checkbox
    // label, so joining them there would print the cue twice.
    body: `${stem}\n\n${cue}`,
    stem,
    cue,
    options: shown,
    optionIndices: order,
    headerImage: media.question_card || media.question_image || null,
    seq: 0,
  }];
}

/**
 * Everything the Flow send needs, computed with no network and no env read, so
 * a test can assert the exact payload a child's phone would receive.
 */
function flowPayload(m, ctx = {}) {
  const language = ctx.language;
  const idx = m.optionIndices || (m.options || []).map((_, i) => i);
  const options = (m.options || []).map((title, i) => ({
    id: String(idx[i]),
    // Truncation here is a backstop, not the contract: MULTI_OPTION_LONG
    // rejects the question at authoring time. Never cut a sacred name from
    // its honorific.
    title: truncateCodePoints(String(title), MULTI_OPTION_MAX),
  }));
  const token = flowToken(ctx.sessionId, ctx.questionId);
  return {
    buttonText: ux('vqMultiCta', language),
    body: m.stem || m.body,
    footer: ux('vqMultiFooter', language),
    screen: 'PICK',
    flowToken: token,
    headerImage: m.headerImage || null,
    // EXACTLY the fields the PICK screen declares, and no others: Meta
    // validates navigate-mode data against the screen's schema and an
    // undeclared key is a rejected send, not an ignored one.
    screenData: {
      question: m.stem || m.body,
      instruction: m.cue || ux('vqMultiSelectAll', language),
      options,
      submit_label: ux('vqMultiSubmit', language),
      answer_token: token,
    },
  };
}

// ─── the reply ───────────────────────────────────────────────────────────────

function flowToken(sessionId, questionId) {
  return `${TOKEN_PREFIX}:${sessionId || 'none'}:${questionId}`;
}

/** Does this nfm_reply belong to us? Decided on the token we minted ourselves. */
function ownsToken(token) {
  return typeof token === 'string' && token.startsWith(`${TOKEN_PREFIX}:`);
}

/**
 * Pull the chosen set out of a Flow completion.
 *
 * Meta has been seen to drop `extension_message_response` from a completion
 * payload (see the assessment-gen note in utils/flow-type-detector.js), so the
 * token is read from three places and the picks from two shapes — an array, or
 * the same array delivered as a JSON string.
 *
 * @returns {{sessionId:string, questionId:string, indices:number[]}|null}
 */
function parseFlowReply(rawToken, responseJson = {}) {
  const token = ownsToken(rawToken) ? rawToken
    : (ownsToken(responseJson.answer_token) ? responseJson.answer_token
      : (ownsToken(responseJson.flow_token) ? responseJson.flow_token : null));
  if (!token) return null;
  const [, sessionId, questionId] = token.split(':');
  if (!questionId) return null;

  let picks = responseJson.picks;
  if (typeof picks === 'string') {
    try { picks = JSON.parse(picks); } catch { picks = picks.split(','); }
  }
  if (!Array.isArray(picks)) return null;
  const indices = [...new Set(picks
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < LETTERS.length))]
    .sort((a, b) => a - b);
  if (!indices.length) return null;
  return { sessionId: sessionId || null, questionId, indices };
}

/** Exact-set scoring. A partial answer is wrong, and the verdict says what was missed. */
function scoreSet(selected, correct) {
  const sel = new Set(selected);
  const cor = new Set(correct);
  const missed = [...cor].filter((i) => !sel.has(i)).sort((a, b) => a - b);
  const extra = [...sel].filter((i) => !cor.has(i)).sort((a, b) => a - b);
  return { isCorrect: missed.length === 0 && extra.length === 0, missed, extra };
}

/**
 * What the child reads after submitting a set, and whether she was right.
 *
 * Returns the TEXT WITHOUT a ✅/❌ marker, and the verdict separately: D2's
 * marker is applied by video-quiz-render.withVerdictMark(), which is also the
 * only thing that knows when an Urdu line opening with a Latin technical term
 * needs a right-to-left mark after the emoji. Two places prepending an emoji is
 * how a child reads "✅ ✅" — and this module cannot require that one (it is a
 * LEAF, see the note below), so it returns what to mark rather than marking it.
 *
 * Option feedback is used verbatim. It cannot name a letter: the transcript
 * quiz validator rejects any letter reference in an authored question
 * (LETTER_REF), which is what makes it safe to print here without the
 * stored→shown letter remap the single-answer path has to do.
 *
 * @returns {{text:string, isCorrect:boolean}}
 */
function verdictText(row, { selectedIndices, labels, language }) {
  const correct = indicesFor(row.correct_option);
  const { isCorrect, missed, extra } = scoreSet(selectedIndices, correct);
  const join = ux('vqMultiJoin', language);
  const name = (list) => list.map((i) => labels[i]).filter(Boolean).join(join);
  const rightText = name(correct);
  const fb = (row.option_feedback && typeof row.option_feedback === 'object') ? row.option_feedback : {};
  const expl = String(row.explanation || '').trim();

  if (isCorrect) {
    const body = String(fb.correct || '').trim() || ux('vqMultiRight', language, { right: rightText });
    return { text: [body, expl].filter(Boolean).join('\n\n'), isCorrect: true };
  }

  const lines = [ux('vqMultiWrong', language, { right: rightText })];
  if (missed.length) lines.push(ux('vqMultiMissed', language, { missed: name(missed) }));
  if (extra.length) lines.push(ux('vqMultiExtra', language, { extra: name(extra) }));
  // The author's per-option line for what the child wrongly ticked — the part
  // that names the misconception. Capped at two so a child's phone does not
  // fill with paragraphs on one question.
  const wrongFb = extra.slice(0, 2)
    .map((i) => String((fb.wrong || {})[String(i)] || (fb.wrong || {})[i] || '').trim())
    .filter(Boolean);
  return { text: [lines.join(' '), ...wrongFb, expl].filter(Boolean).join('\n\n'), isCorrect: false };
}

// The two side-effecting halves of this feature — grading a submitted set and
// claiming the nfm_reply that carries it — live in video-quiz.service, beside
// the single-answer handleAnswer they parallel. They need that service's
// session state, its duplicate reconcile and its next-question walk, and this
// module must stay a LEAF: video-quiz-render and video-quiz-sender both require
// it, so a require back the other way would put it inside their cycle.

module.exports = {
  ANSWER_MODE_MULTI,
  MULTI_OPTION_MAX,
  MAX_MULTI_PER_QUIZ,
  MIN_OPTIONS,
  MAX_OPTIONS,
  TOKEN_PREFIX,
  FLOW_ACTION,
  STEM_WRITES_ITS_OWN_CUE,
  isMultiQuestion,
  isMultiRow,
  authoredCorrectIndices,
  lettersFor,
  indicesFor,
  questionErrors,
  quizErrors,
  multiContract,
  multiFlowId,
  persistedOrder,
  buildMulti,
  flowPayload,
  flowToken,
  ownsToken,
  parseFlowReply,
  scoreSet,
  verdictText,
};
