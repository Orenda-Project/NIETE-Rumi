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
 *     select-all question: "Pinky" is not "pinky", and a vowel mark makes
 *     another answer — «تَپ» is not «تِپ»; a trailing Urdu postposition does
 *     not, see below);
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
 *   - their stems are near-identical, word for word (or, for a sentence with a
 *     blank beside a question, content word for content word — below), once the text is
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
 * built to miss rather than to guess: a paraphrase that shares few words
 * ("What is formed in a physical change?" / "What is true about a physical
 * change?") is not caught, and those are most of the repeats it misses — see
 * the recall measured below.
 *
 * THE SAME FACT, WRITTEN TWO WAYS. A live Urdu quiz asked «…مچھیروں کو
 * __________ سے نوازا۔» (key «انعام و اکرام») and later «…مچھیروں کو کس چیز
 * سے نوازا؟» (key «انعام و اکرام سے»): one fact, a blank and a question, the
 * answers apart by a trailing «سے». So:
 *   - an answer is compared as written AND without a trailing Urdu postposition
 *     (سے، کو، میں، پر، کا، کی، کے، نے) or punctuation — never when the answer
 *     is nothing but postpositions («کا، کی، کے»), and never when stripping
 *     makes two of the question's own options the same («میز پر» / «میز میں»:
 *     that question is ABOUT the postposition);
 *   - a stem with a blank (a run of underscores, or the word «ڈیش» standing in
 *     for one) is compared with a stem without one by filling the blank with
 *     its answer and comparing the CONTENT words — function words, question
 *     words and quiz filler left out — of the filled sentence against the
 *     question and its answer: 80% of the smaller set, 50% of both together,
 *     with the same numbers and quoted items.
 * On the replica this adds one pair — a «ڈیش» blank and the question on the
 * same line of a story — and it is a repeat: 49 flags, 48 of them repeats
 * (precision 0.98). Reading the 388 closest pairs it leaves alone (the same
 * answer, half their content words shared) finds 71 more that ask the same
 * fact in other words, so it catches about 40% of the repeats a reader finds
 * (48 of 119). Those are paraphrases; the author prompt's own rule
 * (DISTINCT_QUESTIONS_RULE) is what keeps them out.
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

/** A blank: a run of underscores, or the word «ڈیش» ("dash") written in its place. */
const BLANK = /_{2,}|(?<![\p{L}\p{M}])ڈیش(?![\p{L}\p{M}])/u;
const BLANKS = new RegExp(BLANK.source, 'gu');
/** Urdu postpositions an answer can carry at its end without changing the fact. */
const POSTPOSITIONS = new Set(['سے', 'کو', 'میں', 'پر', 'کا', 'کی', 'کے', 'نے']);
/**
 * Left out when two stems are compared by their content: function words,
 * question words and the filler of a quiz instruction, in Urdu and English.
 */
const NOT_CONTENT = new Set([
  'کا', 'کی', 'کے', 'کو', 'سے', 'میں', 'پر', 'نے', 'تک', 'اور', 'یا', 'و', 'ہے', 'ہیں', 'تھا', 'تھی', 'تھے', 'ہو', 'ہوا', 'ہوئی', 'ہوئے', 'ہوتا', 'ہوتی', 'ہوتے',
  'گا', 'گی', 'گے', 'کیا', 'کون', 'کونسا', 'کونسی', 'سا', 'سی', 'کس', 'کسی', 'کن', 'کیوں', 'کیسے', 'کیسا', 'کیسی', 'کہاں', 'کب', 'کتنا', 'کتنی', 'کتنے',
  'جو', 'جس', 'جن', 'یہ', 'وہ', 'اس', 'ان', 'ایک', 'بھی', 'تو', 'نہیں', 'نہ', 'ہی', 'لیے', 'لئے', 'بعد', 'پہلے', 'ساتھ', 'چیز', 'چیزوں',
  'رہا', 'رہی', 'رہے', 'گیا', 'گئی', 'گئے', 'کر', 'کرتا', 'کرتی', 'کرتے', 'دیا', 'دی', 'دیے', 'لیا', 'لی', 'بہت', 'کچھ', 'پھر', 'اب', 'جب', 'تب',
  'اپنا', 'اپنی', 'اپنے', 'وہاں', 'یہاں', 'صحیح', 'درست', 'جواب', 'خالی', 'جگہ', 'لفظ', 'جملہ', 'جملے', 'مکمل', 'کریں', 'کیجیے', 'چنیں', 'منتخب',
  'بتائیں', 'درج', 'ذیل', 'مندرجہ',
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'this', 'that', 'these', 'those', 'which', 'what', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'does', 'do', 'did', 'can', 'could',
  'will', 'would', 'should', 'has', 'have', 'had', 'you', 'your', 'we', 'our', 'they', 'their', 'as', 'than', 'then', 'so', 'not', 'no', 'one',
  'following', 'correct', 'answer', 'choose', 'fill', 'blank', 'word', 'sentence', 'complete', 'best', 'option',
]);
/** A blank and a question on one fact: shared content words — of the smaller set, and of both. */
const BLANK_CONTAINMENT = 0.8;
const BLANK_JACCARD = 0.5;
const contentWords = (s) => new Set(words(s).filter((w) => !NOT_CONTENT.has(w)));
/** An option without a trailing postposition — unless it is nothing but postpositions. */
function withoutPostposition(key) {
  const tokens = key.split(' ');
  if (tokens.every((t) => POSTPOSITIONS.has(t))) return key;
  while (tokens.length > 1 && POSTPOSITIONS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

const QUOTED = /['‘’"“”«»]([^'‘’"“”«»]{1,120})['‘’"“”«»]/g;
/** What a stem is ABOUT: its numbers, its quoted words and its sentences with a blank. */
function itemsOf(stem, { blanks = true } = {}) {
  const t = base(stem);
  const quoted = [...t.matchAll(QUOTED)].map((m) => new Set(words(m[1])));
  if (blanks) {
    t.split(/[.?!\u06d4\u061f\n]+/)
      .filter((sentence) => BLANK.test(sentence))
      .forEach((sentence) => quoted.push(new Set(words(sentence.replace(BLANKS, ' ')))));
  }
  const numbers = new Set((t.match(/\d+(?:[.,/]\d+)*/g) || []).map((n) => n.replace(/,/g, '')));
  return { quoted, numbers };
}
function sameItem(a, b) {
  return sameItems(a.items, b.items, a.words, b.words);
}
function sameItems(ia, ib, wordsA, wordsB) {
  if (ia.numbers.size !== ib.numbers.size) return false;
  if ([...ia.numbers].some((n) => !ib.numbers.has(n))) return false;
  const appearsIn = (item, stemWords) => {
    let hit = 0;
    item.forEach((w) => { if (stemWords.has(w)) hit += 1; });
    return item.size > 0 && hit / item.size >= QUOTED_ITEM_SHARE;
  };
  return ia.quoted.every((item) => appearsIn(item, wordsB))
    && ib.quoted.every((item) => appearsIn(item, wordsA));
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
  const keys = options.map(optionKey);
  const stripped = keys.map(withoutPostposition);
  // stripping that makes two of this question's options the same means the
  // postposition IS what the question asks about — keep it
  const core = new Set(stripped).size === new Set(keys).size ? stripped : keys;
  const answer = correct.map((k) => keys[k]).sort().join(' | ');
  if (!answer) return null;
  return {
    stem,
    words: new Set(words(stem)),
    items: itemsOf(stem),
    options: keys.slice().sort().join(' | '),
    optionsCore: core.slice().sort().join(' | '),
    answer,
    answerCore: correct.map((k) => core[k]).sort().join(' | '),
    answerShown: correct.map((k) => base(options[k])).join(', '),
    blank: BLANK.test(base(stem)),
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

const sameAnswer = (a, b) => a.answer === b.answer || a.answerCore === b.answerCore;
const sameOptions = (a, b) => a.options === b.options || a.optionsCore === b.optionsCore;

/** The two stems, word for word — the rule this check started with. */
function sameWording(a, b) {
  if (!sameItem(a, b)) return false;
  const { containment, jaccard, shorter } = overlap(a.words, b.words);
  if (sameOptions(a, b)) return containment >= SAME_OPTIONS_CONTAINMENT;
  return (containment >= OTHER_OPTIONS_CONTAINMENT && jaccard >= OTHER_OPTIONS_JACCARD)
    || (containment >= 0.99 && shorter >= WHOLE_STEM_MIN_WORDS);
}

/** A sentence with a blank, and a question: the blank filled with its answer, content word for content word. */
function sameFactBlankAndQuestion(a, b) {
  if (a.blank === b.blank) return false;
  const [withBlank, question] = a.blank ? [a, b] : [b, a];
  const filled = base(withBlank.stem).replace(BLANK, ` ${withBlank.answerShown} `).replace(BLANKS, ' ');
  const asked = `${base(question.stem)} ${question.answerShown}`;
  if (!sameItems(itemsOf(filled, { blanks: false }), itemsOf(asked, { blanks: false }), new Set(words(filled)), new Set(words(asked)))) return false;
  const { containment, jaccard } = overlap(contentWords(filled), contentWords(asked));
  return containment >= BLANK_CONTAINMENT && jaccard >= BLANK_JACCARD;
}

/** Does the later question `b` ask what the earlier question `a` asks? */
function repeats(a, b) {
  if (!a || !b) return false;
  if (a.picture && b.picture && a.picture !== b.picture) return false;
  if (!sameAnswer(a, b)) return false;
  return sameWording(a, b) || sameFactBlankAndQuestion(a, b);
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

/**
 * A pair the blind solver says asks the same fact (transcript-quiz-key-verify
 * "same_fact"), held to that contract in code before anything acts on it: the
 * same answer (as written, or without a trailing Urdu postposition), not two
 * different pictures, and the same numbers and quoted items — so one template
 * on another item ("round 18" / "round 16") never passes. The words of the two
 * stems are the solver's to judge; this rule only refuses what the answer and
 * the items already show to be two questions.
 */
function confirmsSameFact(qa, qb) {
  const a = prepare(qa);
  const b = prepare(qb);
  if (!a || !b) return false;
  if (a.picture && b.picture && a.picture !== b.picture) return false;
  return sameAnswer(a, b) && sameItem(a, b);
}

/** The complaint a confirmed solver pair puts on its LATER question — the same code as a word-for-word repeat. */
function solverDuplicateComplaint(questions, i, j) {
  const qs = Array.isArray(questions) ? questions : [];
  const first = prepare(qs[i]);
  const stem = first ? clip(base(first.stem), QUOTE_CAP) : '';
  const answer = first ? clip(first.answerShown, 40) : '';
  return `q${j}: DUPLICATE_QUESTION — asks what q${i} already asks, in other words («${stem}»), with the same answer («${answer}»), so a child would answer the same question twice (found by a solver reading the whole quiz); replace it with a question on another example or idea from the lesson, with a different answer`;
}

module.exports = { duplicateQuestionErrors, confirmsSameFact, solverDuplicateComplaint };
