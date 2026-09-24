'use strict';
/**
 * THE SAME QUESTION TWICE IN ONE QUIZ.
 *
 * Every check in the validator looks at one question at a time, so nothing saw
 * a quiz ask the same thing twice. A lesson quiz on proper fractions shipped
 *
 *   q4  «ان میں سے کون سا Proper Fraction ہے؟»          3/3 · 7/3 · 3/7
 *   q5  «ان میں سے کون سا fraction Proper Fraction ہے؟»  3/7 · 3/3 · 7/3
 *
 * — the same three fractions in another order, the same answer. A child
 * answers the same question twice and the class loses a question's worth of
 * the lesson.
 *
 * WHAT COUNTS AS THE SAME QUESTION. A LATER question repeats an EARLIER one when
 *   - they have the SAME ANSWER (the correct option, or the correct set of a
 *     select-all question, compared as written: "Pinky" is not "pinky", and a
 *     vowel mark makes another answer — «تَپ» is not «تِپ»);
 *   - they do not carry two DIFFERENT pictures (one stem over two different
 *     pictures asks about two different pictures). A question with a picture
 *     and the same question without one ARE the same question: the picture
 *     repair can draw on one copy of a repeat and leave the other as text, and
 *     a check that skipped such pairs stopped seeing a repeat it had named.
 *     On the replica, comparing them adds one pair, and it is a repeat;
 *   - they are about the SAME ITEM: the numbers in the two stems are the same
 *     set, and every quoted word and every sentence with a blank in one stem
 *     appears in the other ("…before the word 'kite'" and "…before the word
 *     'tree'" are two questions, as are rounding 18 and rounding 16);
 *   - their stems are near-identical, word for word, once the text is
 *     normalised (maths flattened, direction marks dropped, Arabic and Persian
 *     letter and digit forms unified). With the same options, in any order,
 *     three quarters of the shorter stem's words must be in the other — the
 *     staging pair differs by one added word. With other options it must be
 *     nearly all of them: 85% of the shorter stem's words AND 60% of both
 *     stems' words together, or every word of a shorter stem of four words or
 *     more.
 *
 * Measured on every shipped class quiz on the production read replica (2,350
 * quizzes): 47 pairs flagged in 47 quizzes, 46 of them the same question asked
 * twice when read by hand (precision 0.98) — about one quiz in fifty. The one
 * it gets wrong is "Which of these is a day of the week?" beside "Which of
 * these is the first working day of the week?" with the same answer. It is
 * built to miss rather than to guess: a paraphrase with other distractors that
 * shares few words ("Which of these is a vowel?" / "Which letter is a vowel
 * sound?") is not caught, an estimated one in four or five of those a reader
 * would call the same question.
 *
 * THE COMPLAINT names the LATER question only (`qN: DUPLICATE_QUESTION`), once,
 * against the earliest question it repeats, so the targeted rewrite replaces
 * that one question and keeps the first. It is repaired in place and never a
 * reason to send nothing (transcript-quiz-generate: IN_PLACE_FAULT,
 * SOFT_FAULT).
 */
const { mathToText } = require('./quiz-math');
const Multi = require('./transcript-quiz-multi');

/** How much of a stem must match — the calibrated thresholds described above. */
const SAME_OPTIONS_CONTAINMENT = 0.75;
const OTHER_OPTIONS_CONTAINMENT = 0.85;
const OTHER_OPTIONS_JACCARD = 0.6;
const WHOLE_STEM_MIN_WORDS = 4;
/** A quoted item "appears" in the other stem when this share of its words do. */
const QUOTED_ITEM_SHARE = 0.6;
/** The earlier question is quoted in the complaint up to this many code points. */
const QUOTE_CAP = 90;

/** Text as the child reads it, with the spelling variation that is not a difference removed. */
function base(s) {
  return String(mathToText(String(s == null ? '' : s)) || '')
    .replace(/[\u200e\u200f\u2066-\u2069\u061c]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u064a\u0649]/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/\u06c0/g, '\u06c1')
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, ' ')
    .trim();
}
/** An option, for comparison: spacing and punctuation dropped; case and vowel marks KEPT. */
const optionKey = (s) => base(s).replace(/[\s.!?\u061f\u06d4\u060c,;:'"«»“”‘’()[\]-]+/g, ' ').trim();
/** A stem's words, lower-cased (the answer is compared separately, with its case). */
const words = (s) => base(s).toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

const QUOTED = /['‘’"“”«»]([^'‘’"“”«»]{1,120})['‘’"“”«»]/g;
/** What a stem is ABOUT: its numbers, its quoted words and its sentences with a blank. */
function itemsOf(stem) {
  const t = base(stem);
  const quoted = [...t.matchAll(QUOTED)].map((m) => new Set(words(m[1])));
  t.split(/[.?!\u06d4\u061f\n]+/)
    .filter((sentence) => /_{2,}/.test(sentence))
    .forEach((sentence) => quoted.push(new Set(words(sentence.replace(/_+/g, ' ')))));
  const numbers = new Set((t.match(/\d+(?:[.,/]\d+)*/g) || []).map((n) => n.replace(/,/g, '')));
  return { quoted, numbers };
}
function sameItem(a, b) {
  if (a.items.numbers.size !== b.items.numbers.size) return false;
  if ([...a.items.numbers].some((n) => !b.items.numbers.has(n))) return false;
  const appearsIn = (item, stemWords) => {
    let hit = 0;
    item.forEach((w) => { if (stemWords.has(w)) hit += 1; });
    return item.size > 0 && hit / item.size >= QUOTED_ITEM_SHARE;
  };
  return a.items.quoted.every((item) => appearsIn(item, b.words))
    && b.items.quoted.every((item) => appearsIn(item, a.words));
}

/** Keys sorted, so one picture written with its fields in another order is the same picture. */
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}
function pictureOf(q) {
  const f = q && q.figure;
  if (!f || typeof f !== 'object' || !Object.keys(f).length) return '';
  return stableJson(f);
}

function prepare(q) {
  if (!q || typeof q !== 'object') return null;
  const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? '')) : [];
  const correct = Multi.isMultiQuestion(q) ? Multi.authoredCorrectIndices(q) : [Number(q.correct_index)];
  if (!options.length || !correct.length || correct.some((k) => !Number.isInteger(k) || !options[k] || !options[k].trim())) return null;
  const stem = String(q.question ?? '');
  const answer = correct.map((k) => optionKey(options[k])).sort().join(' | ');
  if (!answer) return null;
  return {
    stem,
    words: new Set(words(stem)),
    items: itemsOf(stem),
    options: options.map(optionKey).sort().join(' | '),
    answer,
    answerShown: correct.map((k) => base(options[k])).join(', '),
    picture: pictureOf(q),
  };
}

function overlap(a, b) {
  let shared = 0;
  a.forEach((w) => { if (b.has(w)) shared += 1; });
  const shorter = Math.min(a.size, b.size);
  return {
    containment: shared / (shorter || 1),
    jaccard: shared / ((a.size + b.size - shared) || 1),
    shorter,
  };
}

/** Does the later question `b` ask what the earlier question `a` asks? */
function repeats(a, b) {
  if (!a || !b) return false;
  if (a.picture && b.picture && a.picture !== b.picture) return false;
  if (a.answer !== b.answer) return false;
  if (!sameItem(a, b)) return false;
  const { containment, jaccard, shorter } = overlap(a.words, b.words);
  if (a.options === b.options) return containment >= SAME_OPTIONS_CONTAINMENT;
  return (containment >= OTHER_OPTIONS_CONTAINMENT && jaccard >= OTHER_OPTIONS_JACCARD)
    || (containment >= 0.99 && shorter >= WHOLE_STEM_MIN_WORDS);
}

const clip = (s, n) => {
  const cps = [...String(s)];
  return cps.length > n ? `${cps.slice(0, n - 1).join('').trim()}…` : String(s);
};

/**
 * The complaints for a quiz's questions (authored shape: question, options,
 * correct_index — or answer_mode "multi" with correct_indices — and figure):
 * one per LATER question that repeats an earlier one, naming the earliest.
 */
function duplicateQuestionErrors(questions) {
  const qs = Array.isArray(questions) ? questions : [];
  const prepared = qs.map(prepare);
  const errs = [];
  for (let j = 1; j < prepared.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      if (repeats(prepared[i], prepared[j])) {
        const first = prepared[i];
        errs.push(`q${j}: DUPLICATE_QUESTION — asks what q${i} already asks («${clip(base(first.stem), QUOTE_CAP)}»), with the same answer («${clip(first.answerShown, 40)}»), so a child would answer the same question twice; replace it with a question on another example or idea from the lesson, with a different answer`);
        break;
      }
    }
  }
  return errs;
}

module.exports = { duplicateQuestionErrors };
