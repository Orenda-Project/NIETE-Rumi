'use strict';
/**
 * Transcript quiz — the deterministic validator.
 *
 * Runs on every authored quiz BEFORE a single row is stored. The author
 * prompt asks for these properties; this file enforces them, because a model
 * complies most of the time and freestyles the rest (root rule 24c). Pure:
 * questions in, { ok, errors, questions } out. No network, no DB.
 *
 * The property list is the one the offline eval converged on across nine
 * flash-tier models and forty real transcripts — each check below caught a
 * real failure in that run.
 */

const { checkReligiousMarks, cpLen } = require('./religious-marks');
const { canonicalSubject, fixQuestionTransliterations } = require('./transcript-quiz-language');
const { peopleSpellings, spellQuestion, logRedactor } = require('./transcript-quiz-people');
const { renderFigureSvg, canonicalType, stripStrayLabels, figureLeaksAnswer, figureEmptyReason, svgInkCount, figureIsRedundant, unknownColourToken, figureMismatch, equalAmountOptions, relabelLetterParts, unnamedParts, unnamedBarInNamedSet, expandImproperBar, specStrings, MATHS_ONLY_TYPES } = require('./transcript-quiz-figure');

/** The engine clamps a fraction bar to this many parts (vendor fraction_bar.js). */
const FRACTION_BAR_MAX_PARTS = 24;
const { canonicalSubject: canonSubj } = require('./transcript-quiz-language');
const { figureGateDefects, droppedTextDefect } = require('./transcript-quiz-figure-gates');
const { scienceDefects, moleculeFromDictionary } = require('./transcript-quiz-figure-science');
const Multi = require('./transcript-quiz-multi');
const { pedagogyDefects } = require('./transcript-quiz-pedagogy');
const { normaliseWordBlank, wordBlankFixHint } = require('./transcript-quiz-word-blank');
const { mathToText, texFaults } = require('./quiz-math');
const { questionAddressForms } = require('./transcript-quiz-address');
const { lessonLexicon, questionAdjacentTerms } = require('./transcript-quiz-adjacent-terms');
const { duplicateQuestionErrors } = require('./transcript-quiz-duplicates');
const { keyByAuthorityError } = require('./transcript-quiz-key-authority');

const MIN_QUESTIONS = 6;
const MAX_QUESTIONS = 10;
const STEM_MAX = 200;        // a list body carries 1024, but a stem past this is not a child's question
const OPTION_MAX = 72;       // Meta's list-row description cap, in code points
const LEVELS = { recall: 0, understand: 1, apply: 2 };

// Roman Urdu tokens: three or more of these in an "Urdu" quiz means the model
// wrote Urdu in Latin letters, which no child reads comfortably.
const ROMAN_URDU = new Set(['hai', 'hain', 'aur', 'kya', 'nahi', 'nahin', 'kaun', 'kounsa', 'konsa', 'kis',
  'kiya', 'yeh', 'woh', 'mein', 'main', 'ko', 'ka', 'ki', 'ke', 'se', 'par', 'bhi', 'toh', 'hota', 'hoti',
  'karo', 'karen', 'kitna', 'kitne', 'kahan', 'kab', 'batao', 'sahi', 'ghalat', 'galat', 'paude', 'hissa', 'mitti', 'neeche']);

// Gendered address to the child: transcript-quiz-address.js. It replaced a
// list of feminine stems that matched third-person Urdu as readily as a
// feminine address («دو سطحیں رب کرتی ہیں», «بیماریاں ہو سکتی ہیں», even the
// «ہو گ» of «ہو گیا»), never caught the masculine guess at all, and on the real
// authored corpus did not once catch a feminine address to a child.

/**
 * PEDAGOGY_GENDERED_CHILD for ONE question, or null. One line per question
 * however many fields and forms, so the targeted rewrite repairs it once; the
 * message is what the rewrite reads, so it says what to write instead.
 */
function childAddressError(q, i) {
  const { fields, forms } = questionAddressForms(q);
  if (!forms.length) return null;
  const shown = [...new Set(forms)].slice(0, 4).map((f) => `"${f}"`).join(', ');
  return `q${i}: PEDAGOGY_GENDERED_CHILD — ${fields.join(' + ')} speak${fields.length === 1 ? 's' : ''} to the child with a gendered verb (${shown}); `
    + 'the class is boys and girls. Keep the same question and change only those verbs: the آپ-imperative or subjunctive («بتائیں»، «آپ کون سی علامت لگائیں؟»), '
    + 'the impersonal or obligative («کون سی علامت لگانی چاہیے؟»، «کون سا لفظ استعمال ہوگا؟»), or آپ نے + a verb that agrees with its object («آپ نے … سوچا»)';
}

/**
 * URDU_ADJACENT_TERMS for ONE question, or null (transcript-quiz-adjacent-terms).
 * Two separate English terms side by side in an Urdu sentence are one
 * left-to-right run, so a right-to-left reader meets the second one first and
 * the relation reads backwards («جب numerator denominator سے چھوٹا ہو»). One
 * line per question, naming every field, so the targeted rewrite repairs it
 * once; the message is what the rewrite reads, so it says what to write.
 */
function adjacentTermsError(q, i, lex) {
  const hits = questionAdjacentTerms(q, lex);
  if (!hits.length) return null;
  const pairs = [...new Set(hits.flatMap((h) => h.pairs))].slice(0, 4).map((x) => `"${x}"`).join(', ');
  return `q${i}: URDU_ADJACENT_TERMS — ${hits.map((h) => h.field).join(' + ')} put${hits.length === 1 ? 's' : ''} two separate English terms side by side (${pairs}); `
    + 'in a right-to-left line they read as one left-to-right phrase, so the second term is met first and the meaning turns around. '
    + 'Keep the same question and put an Urdu word between the two terms, or rephrase: «جب numerator کی قیمت denominator سے کم ہو», '
    + 'not «جب numerator denominator سے چھوٹا ہو». A single English term of two words («cross multiplication») stays together.';
}

// English technical terms belong in English letters inside Urdu (operator
// rule: "Urdu written well, English terms in English"). Speech-to-text spells
// them in Urdu letters and a model copies that. The common maths / science /
// grammar ones are listed; a hit sends the quiz back for a rewrite.
const TRANSLIT_TERMS = /(فیکشن|فریکشن|نیومریٹر|نمبریٹر|ڈینومینیٹر|ڈینامینیٹر|پروپر\s|امپروپر|ٹائپس|سبٹریکشن|ایڈیشن|ملٹیپلیکیشن|ملٹی\s*پلیکیشن|ڈویژن|فوٹو\s*سنتھیسز|ایکو\s*سسٹم|نائون|پروناؤن|ایڈجیکٹو|سینٹینس|ورب\b|ٹرائی\s*اینگل|ریکٹینگل|سرکل\b|ایریا\b|پیری\s*میٹر|ڈیجٹ|پلیس\s*ویلیو|ایون\b|آڈ\b|میٹر\b|کلوگرام|ٹمپریچر|انرجی|میٹیریل|سالڈ\b|لیکوئڈ|گیس\b)/;

// WhatsApp picks a message's direction from its FIRST strong character. An
// Urdu stem, explanation or feedback that opens with an English word is laid
// out left-to-right and reads scrambled on the phone. Options are exempt: a
// one-word English option ("numerator") is a button title.
const LATIN_FIRST = /^[\s"'«(]*[A-Za-z]/;

/**
 * An Urdu sentence that opens with an English word is laid out LEFT-to-right
 * by the phone: the Unicode bidi algorithm takes the paragraph direction from
 * the first strong character. Rejecting such sentences failed both attempts
 * on every "Types of Fractions" lesson — the English term IS the subject and
 * the model keeps leading with it. A RIGHT-TO-LEFT MARK (U+200F) as the first
 * character is a strong RTL character with no width, so the paragraph is laid
 * out RTL and the English run sits inside it in reading order. Same fix the
 * catalog uses for strings that open with a placeholder.
 */
const RLM = '\u200F';
function rtlOpen(t) {
  const str = String(t ?? '');
  if (!str.trim() || str.startsWith(RLM)) return str;
  return LATIN_FIRST.test(str) && /[؀-ۿ]/.test(str) ? RLM + str : str;
}
function rtlOpenQuestion(q) {
  const fb = q.option_feedback || { correct: '', wrong: {} };
  const wrong = {};
  Object.entries(fb.wrong || {}).forEach(([k, v]) => { wrong[k] = rtlOpen(v); });
  return {
    ...q,
    question: rtlOpen(q.question),
    options: Array.isArray(q.options) ? q.options.map(rtlOpen) : q.options,
    explanation: rtlOpen(q.explanation),
    selected_because: typeof q.selected_because === 'string' ? rtlOpen(q.selected_because) : q.selected_because,
    option_feedback: { ...fb, correct: rtlOpen(fb.correct), wrong },
  };
}

// Letters are shuffled before display, so any letter reference is wrong by
// the time a child reads it.
const LETTER_REF = /\b[A-D]\)|\b(answer|option)\s+(is\s+)?[A-D]\b|آپشن\s*[A-D]\b|جواب\s*[A-D]\b/i;

// A stem that promises a picture and does not carry one asks a child to read
// something that is not there. Both scripts, because the quiz language and the
// teacher's language are decided separately.
const STEM_PROMISES_PICTURE =
  /\b(in|on|from) the (picture|image|diagram|figure|graph|chart|number ?line)\b|\bshown (above|below|here)\b|\bpictured\b|تصویر|خاکہ|خاکے|شکل میں/i;

// No more than half the questions may carry a figure. A quiz that is mostly
// pictures stops testing the lesson and starts testing picture-reading.
const FIGURE_MAX_SHARE = 0.5;

// ─── PICTURES IN A GRADE 1-5 MATHS QUIZ ─────────────────────────────────────
// A young class is taught maths through the picture: concrete, then pictorial,
// then abstract. On production 5.5% of maths items carried one (49 of 884),
// because nothing asked for more than one and "earn the figure" rejected every
// picture that modelled numbers the stem states. Two rules, both grade 1-5
// maths only; grade 6 and above are untouched.

/** Pictures a grade 1-5 maths quiz aims for (never more than FIGURE_MAX_SHARE of it). */
const FIGURE_TARGET = 3;

/** Grade 1-5 (and KG/prep, however the band is spelled) — the author's own reading of a band. */
function isEarlyBand(gradeBand) {
  const g = String(gradeBand || '').toLowerCase();
  if (/\b(kg|k|prep|nursery|ecce|katchi)\b/.test(g)) return true;
  const nums = (g.match(/\d+/g) || []).map(Number);
  return nums.length > 0 && nums.every((k) => k <= 5);
}

const earlyMaths = (subject, gradeBand) => canonSubj(subject) === 'maths' && isEarlyBand(gradeBand);

/**
 * How far a quiz is from its picture target. Too few is a SOFT complaint,
 * FIGURE_FEW, and never a reason to refuse a quiz: a refused quiz is a teacher
 * with nothing, and a quiz with one picture is still a quiz. The generate step
 * answers it with ONE targeted "add a picture" repair and ships either way.
 * @returns {{applies:boolean, figured:number, n:number, target:number, need:number, room?:number, complaint:string|null}}
 */
function figureDensity(questions, { subject, gradeBand } = {}) {
  const qs = Array.isArray(questions) ? questions : [];
  const n = qs.length;
  const figured = qs.filter((q) => q && q.figure && typeof q.figure === 'object' && !Array.isArray(q.figure)).length;
  if (!earlyMaths(subject, gradeBand)) {
    return { applies: false, figured, n, target: 0, need: 0, complaint: null };
  }
  const target = Math.min(FIGURE_TARGET, Math.floor(n * FIGURE_MAX_SHARE));
  const need = Math.max(0, target - figured);
  // how many more the half cap still allows — the repair asks for a spare within it
  const room = Math.max(0, Math.floor(n * FIGURE_MAX_SHARE) - figured);
  return {
    applies: true, figured, n, target, need, room,
    complaint: need ? `FIGURE_FEW — ${figured}/${n} questions carry a picture; a grade 1-5 maths quiz aims for at least ${target}` : null,
  };
}

/**
 * figure_role "model": the picture MODELS numbers the stem already states — the
 * pictorial step the lesson itself used (fraction bars beside "which is larger,
 * 2/3 or 3/5?", counters beside "3 + 4"). FIGURE_REDUNDANT exists to stop a
 * decorative picture; for a young maths class this one is the lesson, so it is
 * exempt. The answer-leak rule is not: no option, no result, in the drawing.
 */
/**
 * A person's name left in English letters inside an Urdu quiz (URDU_NAME_LATIN).
 *
 * A remade grade 4 Urdu quiz wrote the lesson's child as "‏Hira کی بوتل", the
 * bar's name included: the Urdu style rule keeps TERMS in English letters, and
 * the model read the name as a term. A capitalised Latin word in a field with
 * Urdu script counts only when the lesson's own examples use it (so it is the
 * lesson's name, not a word the model brought) and it is not a key term.
 *
 * It is a SOFT fault repaired IN PLACE, like two English terms side by side:
 * the validator names it on its question, the one targeted rewrite writes the
 * name in Urdu script, and the quiz ships whatever that leaves — never a
 * refusal (the generate service's IN_PLACE_FAULT). The line says every field
 * the name sits in, a picture's labels included, because the rewrite reads it.
 */
function nameLexicon(digest, questions = []) {
  const lessonWords = new Set();
  (Array.isArray(digest && digest.examples_used) ? digest.examples_used : []).forEach((ex) => {
    (String(ex || '').match(/\b[A-Z][a-z]{2,}\b/g) || []).forEach((w) => lessonWords.add(w));
  });
  // A word the lesson or the quiz also writes in lowercase is a WORD, not a
  // name: a lesson plan's worked example begins "Compare: 10 is more than 9",
  // and a replayed teacher note that wrote "Compare" went to the repair as a
  // person. A child's name is never written in lowercase.
  const d = digest || {};
  const lessonText = [
    ...(Array.isArray(d.examples_used) ? d.examples_used : []), d.topic, d.topic_as_taught,
    ...(Array.isArray(d.slos) ? d.slos : []).flatMap((x) => [x && x.statement, x && x.statement_en]),
    ...(Array.isArray(d.misconceptions_surfaced) ? d.misconceptions_surfaced : []),
    ...(Array.isArray(questions) ? questions : []).map((q) => JSON.stringify(q || {})),
  ].map((t) => (typeof t === 'string' ? t : JSON.stringify(t || '')));
  const lowercase = new Set(lessonText.flatMap((t) => t.match(/\b[a-z]{3,}\b/g) || []));
  lowercase.forEach((w) => lessonWords.delete(w.charAt(0).toUpperCase() + w.slice(1)));
  // A real digest stores each key term as {term, as_spoken}; read as plain
  // text it was "[object Object]" and no term was ever exempt, so a vocabulary
  // lesson's Brother, Sister, King and Queen were flagged as people.
  const termText = (t) => (t && typeof t === 'object' ? [t.term, t.as_spoken] : [t]).map((x) => String(x || ''));
  const terms = new Set((Array.isArray(digest && digest.key_terms) ? digest.key_terms : [])
    .flatMap(termText).flatMap((x) => x.toLowerCase().split(/[^\p{L}]+/u)).filter(Boolean));
  return { lessonWords, terms };
}

/** Every field of one question with Urdu script in it, named the way the rewrite reads it. */
function urduNameFields(q) {
  const fb = q.option_feedback || {};
  const misc = q.distractor_misconceptions || {};
  const figure = q.figure && typeof q.figure === 'object' && !Array.isArray(q.figure) ? q.figure : null;
  return [
    ['question', q.question],
    ...(Array.isArray(q.options) ? q.options : []).map((o, k) => [`option ${k}`, o]),
    ['explanation', q.explanation],
    ['option_feedback', fb.correct],
    ...Object.values(fb.wrong || {}).map((w) => ['option_feedback', w]),
    ['selected_because', q.selected_because],
    ...Object.values(misc).map((m) => ['distractor_misconceptions', m]),
    ...(figure ? specStrings(figure).map((t) => ['figure labels', t]) : []),
  ].map(([f, t]) => [f, String(t ?? '')]).filter(([, t]) => /\p{Script=Arabic}/u.test(t));
}

/** URDU_NAME_LATIN for ONE question: one line per name, naming every field it is in. */
function latinNameErrors(q, i, lex) {
  if (!q || typeof q !== 'object' || !lex) return [];
  const where = new Map();
  urduNameFields(q).forEach(([field, t]) => (t.match(/\b[A-Z][a-z]{2,}\b/g) || []).forEach((w) => {
    if (!lex.lessonWords.has(w) || lex.terms.has(w.toLowerCase())) return;
    if (!where.has(w)) where.set(w, []);
    if (!where.get(w).includes(field)) where.get(w).push(field);
  }));
  return [...where].map(([w, fields]) => `q${i}: URDU_NAME_LATIN — "${w}" is a person's name, not a term, written in English letters in ${fields.join(' + ')}. `
    + 'In an Urdu quiz a name is written in Urdu script: keep the same question and change only the name, in every field it is in, spelled the same way each time.');
}

/**
 * The same check over a whole quiz, for the record the generate service keeps
 * of what SHIPPED (meta.soft_faults and transcript_quiz.latin_name).
 * @returns {string[]} one complaint per question and name
 */
function latinNames(questions, { language, digest } = {}) {
  if (language !== 'ur') return [];
  const lex = nameLexicon(digest, questions);
  return (Array.isArray(questions) ? questions : []).flatMap((q, i) => latinNameErrors(q, i, lex));
}

function modelsTheStem(q, subject, gradeBand) {
  return Boolean(q) && q.figure_role === 'model' && earlyMaths(subject, gradeBand);
}

/**
 * A question as the child READS it (bd-mg9c7.159.19). The author writes maths
 * as TeX (`$\frac{2}{9}$`) and the row stores that source for the card and the
 * PDF to typeset — but every rule below is about what reaches the child: a
 * length cap, two options that look the same, a picture that gives the answer
 * away. Measured on the TeX, `$\frac{2}{5}$` is not "2/5", so the figure gates
 * silently stop seeing a fraction key at all. So every check reads this view;
 * the question returned (and stored) keeps its source. (The Urdu word share
 * reads the source instead and leaves the maths out altogether: a flattened
 * "5 cm" or "x" would still count as an English word — urduShareByPart.)
 */
function plainView(q) {
  if (!q || typeof q !== 'object') return q;
  const fb = q.option_feedback || { correct: '', wrong: {} };
  const wrong = {};
  Object.entries(fb.wrong || {}).forEach(([k, v]) => { wrong[k] = mathToText(v); });
  return {
    ...q,
    question: mathToText(q.question),
    options: Array.isArray(q.options) ? q.options.map(mathToText) : q.options,
    explanation: mathToText(q.explanation),
    option_feedback: { ...fb, correct: mathToText(fb.correct), wrong },
  };
}

/**
 * MATH_TEX — the maths in one question, checked where the child will meet it:
 * the stem and options (typeset on the card) and the explanation and feedback
 * (flattened into WhatsApp text). One line per field, naming the field and the
 * expression, so the targeted rewrite can fix exactly that; a q-prefixed fault,
 * so the last-attempt salvage can drop the question rather than the quiz.
 */
function mathTexErrors(q, i) {
  const fb = (q && q.option_feedback) || {};
  const fields = [
    ['stem', q && q.question],
    ...(Array.isArray(q && q.options) ? q.options : []).map((o, k) => [`option ${k}`, o]),
    ['explanation', q && q.explanation],
    ['option_feedback.correct', fb.correct],
    ...Object.entries(fb.wrong || {}).map(([k, v]) => [`option_feedback.wrong.${k}`, v]),
  ];
  const out = [];
  fields.forEach(([name, value]) => {
    if (typeof value !== 'string') return;
    const faults = texFaults(value);
    if (faults.length) out.push(`q${i}: MATH_TEX — ${name}: ${faults[0]}`);
  });
  return out;
}

/**
 * Arabic-script LETTERS as a share of all letters. No longer what decides an
 * Urdu quiz (urduShareByPart does, below); kept because it is the measure the
 * word share was chosen against, and a test pins the failure it caused.
 */
function scriptRatio(s) {
  const letters = [...String(s || '')].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 1;
  const ar = letters.filter((c) => /[؀-ۿﭐ-﷿ﹰ-﻿]/.test(c)).length;
  return ar / letters.length;
}

/**
 * HOW MUCH OF AN URDU QUIZ IS URDU — counted in WORDS.
 *
 * The quiz-level check used to count LETTERS (scriptRatio above), and the
 * language ask promises the teacher the opposite of what a letter count
 * rewards: "English terms stay in English letters (fraction, numerator)". In a
 * fractions lesson those terms are long — "denominator" is eleven letters,
 * «کو» is two — so a correct Urdu quiz built around them is mostly Latin
 * LETTERS while being mostly Urdu WORDS. A lesson-plan quiz on comparing
 * unlike fractions died on all three attempts at 0.55, 0.59 and 0.57 against a
 * 0.6 bar, and the teacher was told the lesson plan was the problem. The
 * per-question teacher-fields rule below was moved to words for the same
 * reason after a production loss; this is the quiz-level half.
 *
 * A word is a whitespace-separated run that carries a letter, and it is Urdu
 * when one of its LETTERS is Arabic-script — «۔» and «،» sit in the Arabic
 * block but are punctuation, so "numerator۔" is still an English word. The
 * maths is removed first: `$\frac{2}{3}$` reads the same in either language,
 * and a unit typeset inside it (`$5\,\text{cm}$`) is notation, not an English
 * word. Bare numbers carry no letter and are not words either.
 */
const MATH_SPAN = /\$[^$\n]+?\$/g;             // the inline span, as quiz-math reads it
const URDU_LETTER = /(?=\p{L})\p{Script=Arabic}/u;
function urduWordShare(s) {
  const prose = mathToText(String(s ?? '').replace(MATH_SPAN, ' '));
  const words = String(prose ?? '').split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return 1;
  return words.filter((w) => URDU_LETTER.test(w)).length / words.length;
}

/**
 * The share is taken PART BY PART — the questions a child reads, and the
 * explanations and feedback a child reads — and the quiz is judged on the
 * lower of the two. Pooled into one number, the feedback (three strings a
 * question) outweighs the stem (one), so a quiz with every question in English
 * and every piece of feedback in Urdu scores 0.64 and reads as Urdu. The
 * options are left out of both parts: they are the answer choices, and in an
 * Urdu maths or grammar quiz they are rightly the English terms themselves
 * ("numerator", "masculine") or numbers.
 */
function urduShareByPart(questions) {
  const stems = [];
  const answers = [];
  (Array.isArray(questions) ? questions : []).forEach((q) => {
    if (!q || typeof q !== 'object') return;
    const fb = (q.option_feedback && typeof q.option_feedback === 'object') ? q.option_feedback : {};
    stems.push(q.question);
    answers.push(q.explanation, fb.correct, ...Object.values(fb.wrong || {}));
  });
  const join = (xs) => xs.map((t) => (typeof t === 'string' ? t : '')).join('\n');
  const share = { questions: urduWordShare(join(stems)), answers: urduWordShare(join(answers)) };
  const part = share.questions <= share.answers ? 'questions' : 'answers';
  return { ...share, part, min: share[part] };
}

/**
 * The bar, chosen from real authored quizzes (both distributions are in the
 * change that set it). The lower part's Urdu word share, on 241 real Urdu
 * quizzes — nine models, forty lessons, the lesson-plan quizzes, 84 of them
 * maths or science — was never below 0.58; the lowest are Urdu quizzes on
 * English-grammar lessons, whose questions quote English sentences. The real
 * Urdu fractions quizzes the letter bar passed by a hair (0.60 and 0.62 by
 * letters) score 0.81 and 0.82. On 110 real English quizzes it was never
 * above 0.04, Roman Urdu scores 0, and a quiz with its questions in one
 * language and its feedback in the other scores 0. The bar sits in the middle
 * of that gap, with more than 0.25 either side.
 */
const URDU_WORD_SHARE_MIN = 0.3;

/**
 * Accept the shapes models actually emit for option_feedback and return the
 * canonical { correct, wrong: { '<idx>': text } }. Seen in the eval:
 *   - flat: { correct, "1": …, "2": … }              (gemini-2.5-flash, 3.5-flash-lite)
 *   - list: wrong: [{ index, text }] or ["…", "…"]   (deepseek)
 *   - numeric keys                                    (everyone)
 */
function normaliseFeedback(q) {
  const out = { ...q };
  const fb = (q && typeof q.option_feedback === 'object' && q.option_feedback) ? { ...q.option_feedback } : {};
  const ci = Number(q?.correct_index);
  // A "select all that apply" question has a correct SET and may have four
  // options; an ordinary one has one correct index and exactly three. Both
  // reduce to "which indices are NOT correct", which is what the positional
  // shapes below (deepseek's `wrong: ["…","…"]`) have to be keyed back onto.
  const nOpts = Array.isArray(q?.options) && q.options.length ? q.options.length : 3;
  const correctSet = Multi.isMultiQuestion(q) ? Multi.authoredCorrectIndices(q) : [ci];
  const wrongIdx = Array.from({ length: nOpts }, (_, i) => i).filter((i) => !correctSet.includes(i));
  let wrong = fb.wrong;

  if (Array.isArray(wrong)) {
    const w = {};
    wrong.forEach((item, pos) => {
      if (item && typeof item === 'object') {
        const k = item.index ?? item.idx ?? item.option ?? wrongIdx[pos];
        w[String(k)] = String(item.text ?? item.feedback ?? item.message ?? '');
      } else {
        w[String(wrongIdx[pos])] = String(item ?? '');
      }
    });
    wrong = w;
  } else if (wrong && typeof wrong === 'object') {
    const w = {};
    Object.entries(wrong).forEach(([k, v]) => { w[String(k)] = typeof v === 'string' ? v : String(v?.text ?? v ?? ''); });
    wrong = w;
  } else {
    // Flat shape: numeric keys sit beside "correct".
    const w = {};
    Object.entries(fb).forEach(([k, v]) => { if (/^\d+$/.test(k)) w[k] = String(v ?? ''); });
    wrong = w;
  }
  const correct = typeof fb.correct === 'string' ? fb.correct : String(fb.correct?.text ?? fb.correct ?? '');
  out.option_feedback = { correct, wrong };
  return out;
}

function validate(rawQuestions, ctx = {}) {
  const {
    language, subject, digest, nExpected, lessonSummary, quizId,
  } = ctx;
  const gradeBand = ctx.gradeBand || (digest && digest.grade_band) || null;
  const checkD4 = 'lessonSummary' in ctx;
  const errs = [];
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
    return { ok: false, errors: ['no questions'], questions: [] };
  }
  // A figure never names its parts with the option letters (relabelLetterParts):
  // renamed first, so every check below and every surface reads the new names.
  // In an Urdu quiz each person the digest recorded is written in their Urdu
  // spelling, wherever a field or a picture label still has the name in English
  // letters (transcript-quiz-people). This is the one step every shipped
  // question passes, so a note a repair wrote with "Hira" cannot keep it.
  const spellings = language === 'ur' ? peopleSpellings(digest) : {};
  const qs = rawQuestions.map(normaliseFeedback)
    .map((q) => relabelLetterParts(q).question)
    .map((q) => (language === 'ur' ? rtlOpenQuestion(spellQuestion(fixQuestionTransliterations(q), spellings)) : q));
  // What the lesson calls a term, and what a phrase — for URDU_ADJACENT_TERMS.
  const adjacentLex = language === 'ur' ? lessonLexicon(digest, qs) : null;
  // The lesson's names and its key terms — for URDU_NAME_LATIN.
  const nameLex = language === 'ur' ? nameLexicon(digest, qs) : null;
  // What a log line may not carry: the lesson's people and name candidates (D4).
  const redactNames = logRedactor(digest, nameLexicon(digest, qs).lessonWords);
  if (qs.length < MIN_QUESTIONS || qs.length > MAX_QUESTIONS) {
    errs.push(`count ${qs.length} outside ${MIN_QUESTIONS}..${MAX_QUESTIONS}${nExpected ? ` (asked for ${nExpected})` : ''}`);
  }

  // D4 — the caller opting into ctx.lessonSummary (even as '') is the signal
  // it is on the new author contract; a legacy caller that never passes the
  // key at all must see exactly today's behaviour.
  if (checkD4) {
    const summaryTrimmed = typeof lessonSummary === 'string' ? lessonSummary.trim() : '';
    if (typeof lessonSummary !== 'string' || cpLen(summaryTrimmed) < 20) {
      errs.push('AUTHOR_MISSING_SUMMARY — the quiz needs a "lesson_summary": 2–3 sentences on what the lesson taught, in the quiz language');
    }
  }

  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  const sloIds = new Set(slos.map((s) => s.id));
  const taught = new Map(slos.map((s) => [s.id, LEVELS[s.taught_level] ?? 1]));
  const covered = new Set();
  let atOrBelow = 0;
  const levelGap = [];
  let figured = 0;
  const allText = [];
  // bd-mg9c7.95 — the religious-marks scan runs PER QUESTION, so the complaint
  // names the question that carries the fault. It used to run once over every
  // question's text joined together, which made it a quiz-level complaint: the
  // targeted rewrite refuses a set where one complaint names no question, and
  // the last-attempt salvage refuses a set with one non-droppable complaint. A
  // single un-honorified name therefore cost the teacher the whole quiz, with
  // no recovery path at all.
  const canon = canonicalSubject(subject);
  const scanReligious = canon === 'islamiat' || canon === 'urdu';

  qs.forEach((q, i) => {
    // Every check below reads the question as the child SEES it (plainView);
    // the MATH_TEX check reads the source, because that is what can be broken.
    errs.push(...mathTexErrors(q, i));
    const p = plainView(q);
    const opts = Array.isArray(p.options) ? p.options.map((o) => String(o ?? '').trim()) : [];
    const multi = Multi.isMultiQuestion(q);
    const fb = p.option_feedback || { correct: '', wrong: {} };
    // PLAN_R5 D4 — a "select all that apply" question has its own shape (3 or 4
    // options, a correct SET, feedback keyed on every wrong one). Its rules
    // live in transcript-quiz-multi so the author prompt, the validator and the
    // renderer cannot drift about what one is. Everything BELOW this branch —
    // stem length, SLO coverage, level, script, figures — applies to both.
    const ci = multi ? Multi.authoredCorrectIndices(q)[0] : q.correct_index;
    if (multi) {
      errs.push(...Multi.questionErrors(p, i));
    } else {
      if (opts.length !== 3) errs.push(`q${i}: ${opts.length} options`);
      if (opts.some((o) => !o)) errs.push(`q${i}: empty option`);
      if (new Set(opts).size !== opts.length) errs.push(`q${i}: duplicate options`);
      if (![0, 1, 2].includes(ci)) errs.push(`q${i}: bad correct_index ${ci}`);
      const need = [0, 1, 2].filter((k) => k !== ci).map(String).sort();
      const have = Object.keys(fb.wrong || {}).sort();
      if (have.join(',') !== need.join(',')) errs.push(`q${i}: wrong-feedback keys [${have}] != [${need}]`);
      if (need.some((k) => !String(fb.wrong?.[k] || '').trim())) errs.push(`q${i}: empty wrong feedback`);
      if (!String(fb.correct || '').trim()) errs.push(`q${i}: empty correct feedback`);
    }
    // A key justified by what was said in class, against the fact the item
    // itself states (transcript-quiz-key-authority): the class's mistake made
    // the answer. Read as the child sees it, so the quoted sentence is readable.
    const authority = keyByAuthorityError(p, i);
    if (authority) errs.push(authority);
    const stem = String(p.question || '').trim();
    if (!stem) errs.push(`q${i}: empty stem`);
    if (cpLen(stem) > STEM_MAX) errs.push(`q${i}: stem >${STEM_MAX} code points`);
    opts.forEach((o) => { if (cpLen(o) > OPTION_MAX) errs.push(`q${i}: option >${OPTION_MAX} code points`); });

    // D4 — same gate as AUTHOR_MISSING_SUMMARY: only enforced when the caller
    // is on the new contract, so a legacy caller with no selected_because at
    // all stays green.
    if (checkD4) {
      const why = String(q.selected_because || '').trim();
      if (!why) {
        errs.push(`q${i}: Q_MISSING_WHY — "selected_because" is empty; say in ≤15 words which moment of the lesson this question tests`);
      } else {
        const n = why.split(/\s+/).filter(Boolean).length;
        if (n > 30) errs.push(`q${i}: Q_MISSING_WHY — "selected_because" is ${n} words; 15 at most`);
      }
      q.selected_because = why;
    }

    if (sloIds.has(q.slo_id)) covered.add(q.slo_id);
    else if (sloIds.size) errs.push(`q${i}: unknown slo_id ${q.slo_id}`);
    const lv = LEVELS[q.level] ?? 1;
    const tl = taught.has(q.slo_id) ? taught.get(q.slo_id) : 1;
    if (lv <= tl) atOrBelow += 1;
    if (lv > tl + 1) errs.push(`q${i}: PEDAGOGY_LEVEL_ABOVE — level ${q.level} > taught ${slos.find((s) => s.id === q.slo_id)?.taught_level || 'understand'}+1`);
    levelGap.push({ i, gap: lv - tl, level: q.level, taught: slos.find((s) => s.id === q.slo_id)?.taught_level || 'recall' });

    const texts = [stem, String(p.explanation || ''), String(fb.correct || ''), ...opts, ...Object.values(fb.wrong || {}).map(String)];
    if (language === 'en') {
      // The mirror of the Urdu script check. The teacher chose English on a
      // lesson taught in Urdu and the model answered in Urdu — nothing objected.
      const stemAndOptions = [stem, ...opts].join(' ');
      const letters = [...stemAndOptions].filter((c) => /\p{L}/u.test(c));
      const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
      if (letters.length && latin / letters.length < 0.7) {
        errs.push(`q${i}: an English quiz must be written in English — the stem and options are mostly not Latin script`);
      }
    }
    if (language === 'ur') {
      // The teacher's PDF is one language (PLAN_R4 D1): the "from your lesson"
      // line and the distractor meanings are printed on it, and the second
      // live run of round 4 had every one of them in English on an all-Urdu
      // page. English technical terms in Latin letters are expected inside an
      // Urdu phrase, so the bar is "some Urdu", not "no Latin".
      // A verb that speaks to the child with a gender — «کون سی علامت لگائیں
      // گے؟», «آپ … سوچ رہے ہیں», «آپ … کر سکتی ہیں» — guesses whether the
      // child is a boy or a girl. Named per question (a quiz-level complaint is
      // one the rewrite cannot target and the salvage cannot drop: production,
      // 2026-09-07), read on the question as the child SEES it.
      const address = childAddressError(p, i);
      if (address) errs.push(address);
      // Two separate English terms side by side read backwards in a
      // right-to-left line. Read on the question as authored (the detector
      // leaves the $…$ maths out itself).
      const adjacent = adjacentTermsError(q, i, adjacentLex);
      if (adjacent) errs.push(adjacent);
      // A person's name in English letters («‏Hira کی بوتل»): a name is not a
      // term. Repaired in place like the two above, never a refusal.
      errs.push(...latinNameErrors(q, i, nameLex));
      const misc = q.distractor_misconceptions || {};
      const teacherFields = [['selected_because', q.selected_because], ...Object.values(misc).map((m) => ['distractor_misconceptions', m])];
      for (const [field, value] of teacherFields) {
        // Count WORDS, not letters. A letter ratio cannot tell an Urdu phrase
        // built around English technical terms from an English sentence: in a
        // fractions or a photosynthesis lesson those terms are long and English,
        // so a short correct Urdu note is mostly made of them. On production
        // 2026-09-07 "Mixed Fraction کو Improper Fraction سمجھنا" — 22% Arabic
        // LETTERS, 33% Urdu WORDS — was rejected three attempts running and a
        // class lost its quiz, by a rule whose own message says English
        // technical terms in Latin letters are fine. Words measure the thing the
        // rule is actually about: how much of the phrase is Urdu.
        const words = String(value || '').split(/\s+/).filter((w) => /\p{L}/u.test(w));
        const urduWords = words.filter((w) => /\p{Script=Arabic}/u.test(w)).length;
        const letters = [...String(value || '')].filter((c) => /\p{L}/u.test(c));
        if (letters.length >= 4 && words.length && urduWords / words.length < 0.25) {
          errs.push(`q${i}: URDU_TEACHER_FIELDS — ${field} must be written in Urdu (English technical terms in Latin letters are fine); got "${String(value).slice(0, 40)}"`);
          break;
        }
      }
    }
    allText.push(...texts);
    if (scanReligious) {
      checkReligiousMarks(texts.join('\n'))
        .forEach((d) => errs.push(`q${i}: RELIGIOUS_MARKS — ${d}`));
    }
    if (texts.some((t) => LETTER_REF.test(t))) errs.push(`q${i}: letter reference`);

    // ── the figure, if this question carries one ────────────────────────────
    // Each check gets its OWN error string: the retry prompt quotes these back
    // verbatim, and "bad figure" would send the model re-rolling blind.
    if (q.figure == null) {
      if (STEM_PROMISES_PICTURE.test(stem)) {
        errs.push(`q${i}: FIGURE_MISSING — the stem talks about a picture but the question has no "figure"`);
      }
      return;
    }
    figured += 1;
    if (typeof q.figure !== 'object' || Array.isArray(q.figure)) {
      errs.push(`q${i}: FIGURE_TYPE — "figure" must be a spec object with a "type", not ${typeof q.figure}`);
      return;
    }
    const { spec: cleanedFigure, stripped } = stripStrayLabels(q.figure, { stem, options: opts, redact: redactNames });
    if (stripped.length) q.figureStripped = stripped;
    // A `word_blank` whose `blanks` the author left out is not a broken
    // question — the stem it is attached to already says which letter is
    // hidden ("the beginning sound of the word 'road'"). Derived HERE, before
    // the render, so the spec that is drawn is the spec that is stored and the
    // teacher PDF re-draws the same picture. Never inside the engine: the
    // lesson-plan lane shares that contract and must still hear about a spec
    // it wrote wrong.
    q.figure = expandImproperBar(normaliseWordBlank(cleanedFigure, { stem, language, quizId, index: i }).spec);
    if (MATHS_ONLY_TYPES.has(String(q.figure.type || '').toLowerCase()) && canonSubj(subject) !== 'maths') {
      errs.push(`q${i}: FIGURE_TYPE — "${q.figure.type}" draws mathematics only; for this subject use flow, timeline, fraction_bar, grid, numberline, or no picture`);
      return;
    }
    const badTokens = unknownColourToken(q.figure);
    if (badTokens) {
      errs.push(`q${i}: FIGURE_TYPE — unknown colour token(s) ${badTokens.map((t) => `var(--${t})`).join(', ')}; use only the tokens in the minimal specs, or none`);
      return;
    }
    // The engine draws whatever it is given and never checks the science: an
    // off-table element renders as a hydrogen-shaped atom wearing the wrong
    // symbol, an unbalanced equation is typeset as confidently as a balanced
    // one, and a part the chosen cell has not got is dropped without a word.
    // Each is a picture that teaches something false, and each is its own code
    // so the retry names what to fix (PLAN_R4 D7e).
    const science = scienceDefects(q.figure);
    if (science.length) {
      science.forEach((d) => errs.push(`q${i}: ${d.code} — ${d.message}`));
      return;
    }
    // molecule is on the allowlist only behind the dictionary, and the
    // dictionary — not the model — writes the structure it draws from.
    if (canonicalType(q.figure.type) === 'molecule') {
      const known = moleculeFromDictionary(q.figure.formula);
      if (known) q.figure = { ...q.figure, ...known };
    }
    const empty = figureEmptyReason(q.figure);
    if (empty) {
      errs.push(`q${i}: FIGURE_EMPTY — ${empty}; give the picture something to read off, or drop it`);
      return;
    }
    // The engine draws a fraction bar of at most 24 parts (vendor fraction_bar.js
    // clamps `parts`), so a bar of 48 is drawn as 24 — a different fraction, and
    // live (grade 5 Urdu) two bars of "24" in a question with one right bar.
    if (canonicalType(q.figure.type) === 'fraction_bar' && Array.isArray(q.figure.bars)) {
      const tooFine = q.figure.bars.map((b) => Number(b && b.parts)).filter((n) => n > FRACTION_BAR_MAX_PARTS);
      if (tooFine.length) errs.push(`q${i}: FIGURE_TOO_FINE — a bar of ${tooFine[0]} parts is drawn as ${FRACTION_BAR_MAX_PARTS}, the most the engine draws; use at most ${FRACTION_BAR_MAX_PARTS} parts`);
    }
    let svg = null;
    try {
      svg = renderFigureSvg(q.figure, language);
    } catch (err) {
      // Naming the rule is not showing the fix: four attempts across two real
      // lessons were spent on `blanks` because the engine's complaint said what
      // was wrong and never what to write. Where a complete, renderable spec
      // can be computed, it goes on the end of the one line the retry reads.
      const hint = wordBlankFixHint(q.figure, { stem, language });
      errs.push(`q${i}: ${err.code || 'FIGURE_RENDER'} — ${err.message}${hint ? `; ${hint}` : ''}`);
    }
    if (!svg) return;
    if (svgInkCount(svg) < 3) {
      errs.push(`q${i}: FIGURE_BLANK — the drawing paints almost nothing (the engine skipped shapes it does not know); use a shape from the minimal specs`);
      return;
    }
    // The three gates the 6-12 lesson-plan lane runs on every diagram
    // (lint_lp.js FIGURE / DIAGRAM_OVERLAP / DIAGRAM_DEGENERATE), measured on
    // THIS lane's canvas: 1080x565 less the .fig padding, scaled by
    // min(boxW/vbW, boxH/vbH) because a tall figure is height-bound here and
    // the LP lane's column-only formula would report a label twice its real
    // size. Each defect keeps its own code so the retry prompt names what to
    // fix, and each is a q-prefixed FIGURE_ error so salvageWithoutBadFigures
    // can drop the question rather than the quiz.
    figureGateDefects(svg, canonicalType(q.figure.type) || 'figure')
      .forEach((d) => errs.push(`q${i}: ${d.code} — ${d.message}`));
    const dropped = droppedTextDefect(q.figure, svg, canonicalType(q.figure.type) || 'figure');
    if (dropped) errs.push(`q${i}: FIGURE_TEXT_DROPPED — ${dropped.message}`);
    // A "model" picture is NOT exempt, by decision: it is exempt from
    // FIGURE_REDUNDANT (below) because it shows numbers the stem states, but it
    // must still be able to produce the answer. On the live grade 4 fractions
    // replays every model picture this rule refused sat on a step of a
    // procedure — bars of 2/3 and 3/5 beside "what is 2 × 5?" (10), a bar of
    // 2/5 beside "2/5 = ?/20" (8/20). The bars modelled the fractions correctly
    // and answered nothing; a child reading them cannot reach the key. The
    // model uses a young class is taught with still pass: "which is larger" is
    // keyed to one of the fractions drawn, and a word answer is not checked. A
    // question no picture can answer is REPLACED by the add-pictures repair
    // instead (transcript-quiz-rewrite). Counters (count_objects) are held to
    // the same rule since two slipped through beside a product and an LCM.
    const unnamed = unnamedParts(q.figure, opts);
    if (unnamed) errs.push(`q${i}: FIGURE_PARTS_UNNAMED — the options name parts ${unnamed.join(', ')} but the picture names none; give each part its name as its label ("P", not "bar P")`);
    const loose = unnamedBarInNamedSet(q.figure, opts);
    if (loose) errs.push(`q${i}: FIGURE_PARTS_UNNAMED — bar ${loose} has no name while the options pick bars by name, so the child cannot tell which bars go together; name every bar, and draw an improper fraction in a picture of its own`);
    const mismatch = figureMismatch(q.figure, opts, ci, stem);
    if (mismatch) {
      errs.push(`q${i}: FIGURE_MISMATCH — ${mismatch}; draw the quantities the question is about`);
    }
    // 2/8 and 1/4 under a bar of 2 in 8 are both right (live, grade 3 Urdu,
    // passed by the blind solver). Named as a duplicate option so the targeted
    // rewrite repairs it with the distinct-options rule.
    const twin = equalAmountOptions(q.figure, opts, ci);
    if (twin) errs.push(`q${i}: duplicate options — ${twin}`);
    if (!modelsTheStem(q, subject, gradeBand) && figureIsRedundant(q.figure, stem)) {
      errs.push(`q${i}: FIGURE_REDUNDANT — the stem already states the numbers the picture shows; ask the child to READ them from the picture instead`);
    }
    // The DRAWING is checked, not only the spec: several types compute a label
    // the spec never mentions, and a fraction bar's "3/4" is the whole answer.
    if (figureLeaksAnswer(q.figure, opts, ci, svg)) {
      errs.push(`q${i}: FIGURE_LEAK — the picture gives the answer away (it names it, files it under a heading that decides it, or lands on it); a figure may show the situation, never the result`);
    }
    // Rendered once, here, and carried on the question: generate uploads this
    // SVG's PNG and the teacher PDF inlines the same vector.
    q.figureSvg = svg;
  });

  errs.push(...Multi.quizErrors(qs));
  // The same question asked twice (same answer, same item, near-identical
  // stem). Only the quiz as a whole can show it, and the complaint names the
  // LATER copy, so the targeted rewrite replaces that one question.
  errs.push(...duplicateQuestionErrors(qs));

  if (figured / qs.length > FIGURE_MAX_SHARE) {
    errs.push(`FIGURE_SHARE — ${figured}/${qs.length} questions carry a picture; at most half may`);
  }

  if (sloIds.size && covered.size !== sloIds.size) {
    errs.push(`SLOs uncovered: ${[...sloIds].filter((id) => !covered.has(id)).join(', ')}`);
  }
  if (qs.length && atOrBelow / qs.length < 0.6) {
    errs.push(`only ${atOrBelow}/${qs.length} at/below taught level`);
    // Name the questions to bring down — the fewest, furthest above the lesson —
    // so the targeted rewrite can repair the set instead of the whole quiz dying
    // on a complaint that names no question (production, 2026-09-07: "only 4/8
    // at/below taught level" on the last attempt, and the teacher got nothing).
    const need = Math.ceil(qs.length * 0.6) - atOrBelow;
    levelGap.filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap || a.i - b.i).slice(0, need).forEach((g) => {
      errs.push(`q${g.i}: PEDAGOGY_LEVEL_ABOVE — pitched at "${g.level}" but the lesson only reached "${g.taught}" for its SLO; ask the same idea at "${g.taught}" level (the child recalls or recognises what was taught, no new step)`);
    });
  }

  const joined = allText.join('\n');
  if (language === 'ur') {
    // Counted in WORDS, part by part (urduShareByPart), on the questions as
    // the author wrote them — maths still inside its dollars, so it can be
    // left out rather than counted as flattened letters. The complaint keeps
    // its "urdu script ratio " prefix: the retry note recognises a
    // wrong-script attempt by it (WRONG_SCRIPT_RE in
    // transcript-quiz-contract.js), and it is quoted to the model verbatim,
    // so it also says what to do.
    const byPart = urduShareByPart(qs);
    if (byPart.min < URDU_WORD_SHARE_MIN) {
      const where = byPart.part === 'questions' ? 'the questions' : 'the explanations and feedback';
      errs.push(`urdu script ratio ${byPart.min.toFixed(2)} < ${URDU_WORD_SHARE_MIN.toFixed(2)} — only ${Math.round(byPart.min * 100)}% of the words in ${where} are in Urdu script; write every stem, option, explanation and feedback in Urdu, keeping only the lesson's technical terms in English letters`);
    }
    const latinWords = joined.match(/\b[a-zA-Z]{2,}\b/g) || [];
    const roman = latinWords.filter((w) => ROMAN_URDU.has(w.toLowerCase()));
    if (roman.length >= 3) errs.push(`roman urdu tokens: ${roman.slice(0, 6).join(' ')}`);
    const tl = TRANSLIT_TERMS.exec(joined);
    if (tl) errs.push(`transliterated English term in Urdu script: ${tl[1].trim()} — write it in English letters`);
  }
  // PEDAGOGY (PLAN_R5 D3). Structure says the question is well formed; these
  // say it is worth asking. Each defect keeps its own PEDAGOGY_ code and a
  // q-prefix where it belongs to one question, so the retry prompt names what
  // to rewrite and the last-attempt salvage can drop that question rather
  // than the quiz. See transcript-quiz-pedagogy.js.
  // `lessonSummary` and `quizId` ride along for PEDAGOGY_GENDERED_TEACHER
  // (PLAN_R6 D5): the summary is the field the operator caught a "She" on, and
  // it is quiz-level, so it is checked here beside the questions rather than in
  // a second pass a caller could forget.
  pedagogyDefects(qs.map(plainView), {
    language, digest, quizId, ...(checkD4 ? { lessonSummary } : {}),
  }).forEach((d) => errs.push(d.message));

  return { ok: errs.length === 0, errors: errs, questions: qs };
}

module.exports = {
  validate,
  latinNames,
  nameLexicon,
  normaliseFeedback,
  STEM_PROMISES_PICTURE,
  FIGURE_MAX_SHARE,
  FIGURE_TARGET,
  figureDensity,
  scriptRatio,
  urduWordShare,
  urduShareByPart,
  URDU_WORD_SHARE_MIN,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  STEM_MAX,
  OPTION_MAX,
  LEVELS,
  TRANSLIT_TERMS,
  LATIN_FIRST,
  rtlOpen,
  LETTER_REF,
  ROMAN_URDU,
  plainView,
};
