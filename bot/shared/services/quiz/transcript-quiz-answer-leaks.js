'use strict';
/**
 * ONE QUESTION GIVING AWAY ANOTHER'S ANSWER (quiz_author_gates_v2).
 *
 * Every other check looks at one question at a time. The red team's blind
 * re-score of ten real sources (5 Oct 2026) found a later question's answer
 * stated by an earlier question in every transcript quiz: an earlier stem asks
 * "Why is Urdu called the national language?" before a later one asks which
 * the national language is; an explanation the child reads after one question
 * says "a sentence ends with a full stop" before the next asks what ends a
 * sentence. The child is not tested on the second; the class report counts it.
 *
 * WHAT COUNTS. A LATER question j leaks from an EARLIER question i (the child
 * plays them in order and reads i's explanation before j) when
 *   - j's answer is a short term (one to five words, not a number, a maths
 *     expression, yes/no or true/false), and j's own stem does not offer it
 *     ("Is this a structural or behavioural adaptation?" is a choice, not a
 *     fact anything can give away);
 *   - i's stem, its explanation or the line it shows when right — each read on
 *     its own — contains that answer as words;
 *   - that text names NONE of j's wrong options (a line that lists the crust,
 *     the mantle and the core states an order, not one answer);
 *   - and it shares a topic word with j's stem beyond the answer itself
 *     ("Which of these is a structural adaptation?" names the category; it says
 *     nothing about the desert fox the later question asks about).
 * Measured on 47 quizzes authored from ten real sources (both arms of two
 * re-scores): 19 flagged, read by hand as 15 give-aways ("re-reading is a good
 * strategy" before "which strategy is good?"; "each piece is one quarter"
 * before "what is each part called?") and 4 debatable — a definition in one
 * explanation, then a question applying it. Without the last two conditions
 * the same rule flagged category words named in passing.
 *
 * The complaint names the LATER question, so the targeted rewrite replaces it
 * with a question on another fact; it is a SOFT fault (generate's
 * IN_PLACE_FAULT): a quiz never fails over it.
 */

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'are', 'was', 'were', 'and', 'or', 'what', 'which', 'who', 'whom',
  'how', 'why', 'when', 'where', 'this', 'that', 'these', 'those', 'it', 'its', 'be', 'by', 'for', 'with', 'as', 'at',
  'from', 'do', 'does', 'did', 'you', 'your', 'one', 'two', 'type', 'kind', 'called', 'name', 'there', 'their', 'they',
  'will', 'would', 'can', 'could', 'should', 'have', 'has', 'had', 'into', 'about', 'than', 'then', 'them', 'also',
  'کی', 'کا', 'کے', 'ہے', 'ہیں', 'کو', 'میں', 'سے', 'نے', 'پر', 'اور', 'یا', 'کون', 'کونسا', 'کونسی', 'سا', 'سی',
  'کیا', 'کیوں', 'کیسے', 'کہاں', 'کب', 'یہ', 'وہ', 'ان', 'اس', 'ایک', 'جاتا', 'جاتی', 'جاتے', 'کہا', 'کہتے', 'ہوتا',
  'ہوتی', 'ہوتے', 'لفظ', 'قسم',
]);
const BINARY = new Set(['yes', 'no', 'true', 'false', 'ہاں', 'نہیں', 'صحیح', 'غلط', 'درست']);

/** Lower-cased words, any script; diacritics and direction marks dropped; Eastern digits to Western. */
function words(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟ‌-‏‪-‮⁦-⁩]/g, '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .match(/[\p{L}\p{N}]+/gu) || [];
}
const phrase = (s) => ` ${words(s).join(' ')} `;
const contains = (text, term) => phrase(text).includes(` ${term} `);
const topical = (w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w);

function correctList(q) {
  if (Array.isArray(q.correct_indices) && q.correct_indices.length) return q.correct_indices.map(Number);
  if (Array.isArray(q.correct_index)) return q.correct_index.map(Number);
  return [Number(q.correct_index) || 0];
}

/** j's answer as a term a sentence could state, or null. */
function answerTerm(q) {
  const keys = correctList(q);
  const opts = Array.isArray(q.options) ? q.options : [];
  if (keys.length !== 1) return null;
  const raw = String(opts[keys[0]] ?? '');
  if (/\$|\\[a-z]+\{/.test(raw)) return null;            // a maths expression
  const w = words(raw);
  const term = w.join(' ');
  if (!w.length || w.length > 5 || term.length < 4 || w.every((x) => /^\d+$/.test(x)) || BINARY.has(term)) return null;
  if (!w.some((x) => !STOP.has(x))) return null;
  return term;
}

/** What the child reads of question i, each on its own: its stem, then (after answering) its explanation and its "right" line. */
function readOf(q) {
  const fb = (q && q.option_feedback && typeof q.option_feedback === 'object') ? q.option_feedback : {};
  return [
    ['question', String(q.question || '')],
    ['explanation', String(q.explanation || '')],
    ['feedback', typeof fb.correct === 'string' ? fb.correct : ''],
  ];
}

/**
 * @param {object[]} questions the quiz in the order it is played
 * @returns {string[]} one `qN: ANSWER_LEAK — …` per leaking LATER question (the first source found)
 */
function answerLeakErrors(questions) {
  const qs = Array.isArray(questions) ? questions : [];
  const out = [];
  qs.forEach((qj, j) => {
    if (!qj || j === 0) return;
    const term = answerTerm(qj);
    if (!term) return;
    const termWords = new Set(term.split(' '));
    const stemJ = words(qj.question);
    if ([...termWords].every((w) => stemJ.includes(w))) return;   // the stem offers it
    const opts = Array.isArray(qj.options) ? qj.options : [];
    const keys = new Set(correctList(qj));
    const wrong = opts.map((o, k) => (keys.has(k) ? null : words(o).join(' '))).filter((o) => o && o.length >= 3);
    const topic = new Set(stemJ.filter((w) => topical(w) && !termWords.has(w)));
    for (let i = 0; i < j; i += 1) {
      const qi = qs[i];
      if (!qi) continue;
      if (answerTerm(qi) === term) continue;   // the same answer: a repeat, which DUPLICATE_QUESTION judges
      const hit = readOf(qi).find(([, text]) => contains(text, term)
        && !wrong.some((o) => contains(text, o))
        && words(text).some((w) => topic.has(w)));
      if (!hit) continue;
      const where = hit[0];
      out.push(`q${j}: ANSWER_LEAK — its answer "${opts[[...keys][0]]}" is already given by q${i}'s ${where}, which the child reads first; ask about a different fact of the lesson, one no other question states`);
      return;
    }
  });
  return out;
}

module.exports = { answerLeakErrors };
