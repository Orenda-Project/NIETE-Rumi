'use strict';
/**
 * Transcript quiz — the PEDAGOGY rules (PLAN_R5 D3).
 *
 * The structural validator asks "is this a well-formed question?". This file
 * asks the other question: "is it a question worth asking a child?".
 *
 * Three shapes came back from the operator's own staging run and each is
 * banned here, deterministically, because the round-4 author prompt already
 * banned the third IN WORDS and the model wrote it anyway (root rule 24c — a
 * prompt's contract is asserted in code, not left to a model that complies
 * ~95% of the time):
 *
 *   COUNT_RECALL        "How many types of matter did the teacher mention?"
 *                       — ratta: it tests how many times something was said,
 *                       not what the thing is. The same lesson supports
 *                       "Which of these is a type of matter?", which tests the
 *                       concept and needs the same knowledge.
 *   TEACHER_AS_SUBJECT  "What did madam call the middle part?"
 *                       — the subject of the question is the teacher's speech
 *                       rather than the idea; a child who understood the idea
 *                       but forgot the wording is marked wrong.
 *   UNANSWERABLE        "Which atom did the teacher ask your group to draw?"
 *                       — the answer depends on which group the child sat in,
 *                       and the quiz cannot know that. There is no way to be
 *                       just to the child.
 *
 * A fourth joined them in round 6, from the operator reading a teacher's own
 * pre-send document:
 *
 *   GENDERED_TEACHER    "The teacher reviewed 'Before', 'After' … She then
 *                       introduced the new topic …"
 *                       — the teacher's gender is not a fact this system holds,
 *                       so every gendered reference to the teacher is a guess
 *                       printed on that teacher's own document. See
 *                       genderedTeacherDefects() for the forms, per language.
 *
 * Plus one rule about the SET rather than a question: LEVEL_MIX, at least half
 * the quiz above bare recall — capped so it can never contradict the
 * validator's "60% at or below the taught level" (see levelMixDefect).
 *
 * Pure except for ONE telemetry counter (`transcript_quiz.gendered_teacher`),
 * the same way transcript-quiz-word-blank.js counts an inferred blank from
 * inside this very validator pass: no network, no DB, no read of anything.
 * Every message is written to be QUOTED BACK to the author on the retry, so it
 * says what is wrong AND what to write instead.
 */

const { logEvent } = require('../../utils/structured-logger');

// ── options that are bare numbers ────────────────────────────────────────────
// A count question is only ratta when the child is picking a NUMBER. The same
// stem with "solid / liquid / gas" under it is a content question.
const DIGITS = /^[\s]*[0-9٠-٩۰-۹]+[\s]*$/;
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'چھے', 'سات', 'آٹھ', 'نو', 'دس',
  'گیارہ', 'بارہ',
]);

function isBareNumber(option) {
  const s = String(option ?? '').trim();
  if (!s) return false;
  if (DIGITS.test(s)) return true;
  return NUMBER_WORDS.has(s.toLowerCase());
}

/** True when EVERY option is a bare number — the signature of a count question. */
function optionsAreBareNumbers(options) {
  const opts = Array.isArray(options) ? options : [];
  return opts.length > 0 && opts.every(isBareNumber);
}

// ── COUNT_RECALL ─────────────────────────────────────────────────────────────
// "How many …" plus a verb of SPEAKING. A verb that is inherently about
// discourse (mention, discuss, name, list, say) is enough on its own; a weaker
// one (learn, study, watch) also needs the lesson or the teacher in the stem,
// because "how many did you see" is a fine question about a picture.
const HOW_MANY_EN = /\bhow many\b/i;
const HOW_MANY_UR = /(کتنی|کتنے|کتنا|کتنوں)/;
const MENTION_STRONG_EN = /\b(mention(ed|s)?|discuss(ed|es)?|talk(ed|s)? about|spoke about|speak about|named?|names|list(ed|s)?|says?|said|tells?|told|cover(ed|s)?|went over|go(es)? over|referred to|refer to)\b/i;
const MENTION_WEAK_EN = /\b(learn(ed|t|s)? about|stud(y|ied|ies)|read about|heard about|watch(ed|es)?)\b/i;
const LESSON_CONTEXT_EN = /\b(teacher|madam|ma'?am|miss|sir|ustani|ustaad|lesson|class|today|video|chapter|we|you)\b/i;
const MENTION_STRONG_UR = /(بتائ|بتایا|بتلائ|ذکر|بیان|کہا|گنوائ|شمار کی|سنائ|سنایا|نام لی|نام بتائ)/;
const MENTION_WEAK_UR = /(پڑھائ|سکھائ|سیکھ|دیکھائ|دکھائ|سن)/;
const LESSON_CONTEXT_UR = /(استاد|اُستاد|ٹیچر|میڈم|مِس|معلم|آپا|کلاس|سبق|آج|ویڈیو|باب)/;

// The TAXONOMY TALLY. "How many types of matter are there?" carries no verb of
// speaking, so the mention branch above never sees it — and it is the exact
// question the operator quoted, with the exact answer he gave: ask the child to
// SELECT a type instead. Counting a category the lesson taught the members of
// is a tally, whatever verb it is dressed in.
const TAXONOMY_EN = /\bhow many\s+(types?|kinds?|sorts?|categories|forms?|states?|stages?)\s+of\b/i;
const TAXONOMY_UR = /(کتنی|کتنے)\s*(اقسام|قسمیں|قسمین|قسم|طرح|حالتیں|صورتیں|درجے)/;

// A picture question is exempt from every branch. Counting what a drawing shows
// is the whole point of a count_compare figure — the author's own worked
// example is a shaded fraction bar with 3 / 1 / 4 under it — and a rule that
// threw those away would fail every maths lesson that draws one.
const ABOUT_A_PICTURE = /\b(in|on|from) the (picture|image|diagram|figure|graph|chart|number ?line)\b|\bshown (above|below|here)\b|\bin the picture\b|تصویر|خاکہ|خاکے|شکل میں/i;

function countRecall(stem, options, language, question = null) {
  if (!optionsAreBareNumbers(options)) return false;
  const s = String(stem || '');
  if (question && question.figure) return false;
  if (ABOUT_A_PICTURE.test(s)) return false;
  const ur = language === 'ur' || /[؀-ۿ]/.test(s);
  if (ur) {
    if (TAXONOMY_UR.test(s)) return true;
    if (HOW_MANY_UR.test(s)) {
      if (MENTION_STRONG_UR.test(s)) return true;
      if (MENTION_WEAK_UR.test(s) && LESSON_CONTEXT_UR.test(s)) return true;
    }
  }
  if (TAXONOMY_EN.test(s)) return true;
  if (HOW_MANY_EN.test(s)) {
    if (MENTION_STRONG_EN.test(s)) return true;
    if (MENTION_WEAK_EN.test(s) && LESSON_CONTEXT_EN.test(s)) return true;
  }
  return false;
}

// ── TEACHER_AS_SUBJECT ───────────────────────────────────────────────────────
// English marks this with AUXILIARY INVERSION — "did the teacher …" only ever
// happens in a question about the teacher's act, so it does not fire on a stem
// that merely sets the scene ("The teacher showed a circuit. Which bulb …?").
// Urdu has no inversion; it marks the subject of a past transitive verb with
// the ergative نے, so "استاد نے … کہا" is the same signal, and the stem must
// also carry a question word.
const TEACHER_INVERSION_EN = /\bdid\s+(the\s+|your\s+|our\s+|my\s+)?(teacher|teachers|madam|ma'?am|miss|sir|ustani|ustaad|class|group|partner|classmates?)\b/i;
const ACCORDING_TO_EN = /\baccording to\s+(the\s+|your\s+|our\s+)?(teacher|madam|ma'?am|miss|sir|ustani|ustaad)\b/i;
const ERGATIVE_ACTOR_UR = /(استاد|اُستاد|ٹیچر|میڈم|مِس|معلم|آپا|باجی|سر)\s*(صاحب\s*)?(نے|نےَ)/;
const SPEECH_VERB_UR = /(کہا|کہی|پوچھا|بتایا|بتائ|ذکر|بیان|سکھایا|پڑھایا|لکھوایا|بنوایا|دیا|مثال\s*د|نام لیا|کرنے کو|بنانے کو)/;
const QUESTION_WORD_UR = /(کون|کیا|کتن|کس\s|کہاں|کب|کیوں|کیسے)/;

/**
 * Urdu has no auxiliary inversion to anchor on, so the rule is: the teacher
 * clause and the question word must be in the SAME sentence. "ٹیچر نے بتایا کہ
 * کچھ ذرائع تیز رفتار ہوتے ہیں۔ ان میں سے کون سا تیز رفتار ہے؟" sets the scene
 * in sentence one and asks about the concept in sentence two — the same shape
 * English's "The teacher showed a circuit. Which bulb is brighter?" takes, and
 * the same verdict. Without the split, a sweep of 1,156 previously generated
 * questions fired this rule 29 times and a fifth of those were scene-setters.
 */
const SENTENCE_SPLIT = /[۔؟?!.]+/;

function teacherAsSubject(stem, language) {
  const s = String(stem || '');
  if (TEACHER_INVERSION_EN.test(s) || ACCORDING_TO_EN.test(s)) return true;
  const ur = language === 'ur' || /[؀-ۿ]/.test(s);
  if (!ur) return false;
  return s.split(SENTENCE_SPLIT).some((clause) => ERGATIVE_ACTOR_UR.test(clause)
    && SPEECH_VERB_UR.test(clause) && QUESTION_WORD_UR.test(clause));
}

// ── UNANSWERABLE ─────────────────────────────────────────────────────────────
// The answer depends on which child, which group or which turn — facts the
// quiz does not hold and cannot check. Also the pure logistics: the page, the
// homework, who was called to the board.
const UNANSWERABLE_EN = /(your\s+(group|team|row|partner|bench|side)|you were\s+(asked|told|given|assigned|called)|the\s+(student|child|boy|girl|classmate|pupil)\s+who|who\s+(was|were)\s+(called|asked|picked|chosen|sent)|which\s+(group|team|row)\s+(was|were)\s+(called|asked|picked|chosen|sent|given|told)|what homework|which page|on which page|in your (notebook|copy|register))/i;
const UNANSWERABLE_UR = /(آپ\s*کے\s*گروپ|آپ\s*کا\s*گروپ|آپ\s*کی\s*ٹیم|آپ\s*کے\s*ساتھی|آپ\s*کو\s*کہا|آپ\s*سے\s*کہا|آپ\s*کو\s*دی\s*گئی|جس\s*بچے|جس\s*طالب|کس\s*گروپ\s*کو|کون\s*سے\s*گروپ\s*کو|آپ\s*کو\s*\S*\s*کہا|بورڈ\s*پر\s*بلا|کس\s*صفح|کون\s*سے\s*صفح|ہوم\s*ورک|کاپی\s*میں\s*کیا)/;

// A GROUP OF OBJECTS IS NOT A GROUP OF CHILDREN. The bare words «کس گروپ» and
// "which group" used to fire this rule, and on 2026-09-07 that made an entire
// early-years maths topic un-quizzable: a grade 1-2 "More and Less" lesson,
// whose own objective is telling which of two GROUPS has more and whose
// examples are all "group A has 6, group B has 5", was rejected six times over
// six model calls, and the teacher was told the recording was unclear. The
// fault this rule exists for is the INDEXICAL framing — an answer that depends
// on which child you are, which group you sat in, what you were personally
// asked to do. That is carried by the second person, by the child-who
// construction, and by the activity VERB ("which group WAS CALLED to the
// board", «کس گروپ کو…»), never by the noun on its own. In Urdu the
// discriminator is the postposition: «کس گروپ کو» is something done TO a group
// of children; «کس گروپ میں» is a question about what is IN a group of things.
function unanswerable(stem, language) {
  const s = String(stem || '');
  if (UNANSWERABLE_EN.test(s)) return true;
  const ur = language === 'ur' || /[؀-ۿ]/.test(s);
  return Boolean(ur && UNANSWERABLE_UR.test(s));
}

// ── GENDERED_TEACHER ─────────────────────────────────────────
// The teacher's gender is not a fact this system holds: `users` has no gender
// column and nothing in the pipeline infers one. So a gendered reference to the
// teacher is a coin toss printed on that teacher's own document, and the
// operator read one on the round-5 pre-send PDF ("She then introduced the new
// topic…"). PLAN_R6 D5.
//
// ENGLISH is the simple half: the pronouns, whole words, either case.
const EN_PRONOUNS = /\b(she|her|hers|him|his|herself|himself)\b/gi;
// "he" needs one exception. It is also the chemical symbol for helium, which a
// science quiz writes mid-sentence and capitalised ("a balloon filled with He
// floats"). A PRONOUN is lowercase, or it opens a sentence — it is never a
// capitalised word in the middle of one. So: lowercase `he` anywhere, plus a
// sentence-initial `He`, and the symbol survives.
const EN_HE_LOWER = /\bhe\b/g;
const EN_HE_SENTENCE_START = /(?:^|[.!?:;"’”)\]»\n]\s*)(He)\b/g;
//
// URDU is not the same shape, and the naive rule does not work here. Urdu marks
// the subject of a past transitive verb with the ergative نے, and the verb then
// agrees with the OBJECT, not with the subject: «استاد نے سبق پڑھایا» and
// «استاد نے وضاحت دہرائی» are BOTH gender-neutral about the teacher — the first
// agrees with سبق (masculine), the second with وضاحت (feminine). A rule of the
// shape "ٹیچر نے .*ی" would therefore flag correct, neutral Urdu; the round-5
// Urdu render fixture is written exactly that way. Gender surfaces in two
// places instead, and those are what is checked:
//
//   1. GENDERED NOUNS AND HONORIFICS — a female-marked or male-marked word for
//      the teacher, wherever it appears: استانی, معلمہ, میڈم, مِس/مس, باجی,
//      آپا, any صاحبہ, a teacher noun plus صاحب, and «سر نے» (سر alone is the
//      ordinary word for "head" and is not an anchor).
//   2. SUBJECT AGREEMENT — a teacher noun that is the grammatical SUBJECT (so:
//      not followed by a case marker نے/کا/کی/کے/کو/سے/پر/میں/تک) with a
//      gendered verb form later in the same sentence: پڑھاتی ہیں / پڑھاتے ہیں,
//      رہی تھیں / رہے تھے, پڑھائیں گی / پڑھائیں گے. Both the feminine and the
//      masculine form is a guess; the neutral moves are an imperative, an
//      impersonal reframe, or آپ نے + an object-agreeing verb (the Urdu rule in
//      .claude/skills/broadcast-template).
//
// آپ is deliberately NOT an agreement anchor: «آپ نے پڑھایا» is the neutral form
// the summary is now asked for, and the respectful-plural imperatives a child
// is addressed with (کریں، دیکھیں) carry no gender. A gendered address to the
// CHILD is a different rule and already lives in the validator (FEM_STEMS).
const UR_LETTER = '؀-ۿ';
const UR_GENDERED_NOUN = new RegExp(
  `(?<![${UR_LETTER}])(?:استانی|اُستانی|معلمہ|میڈم|مِس|مس|باجی|آپا)(?![${UR_LETTER}])`
  + `|صاحبہ`
  + `|(?<![${UR_LETTER}])(?:استاد|اُستاد|ٹیچر|معلم)\\s*صاحب`
  + `|(?<![${UR_LETTER}])سر\\s+نے(?![${UR_LETTER}])`,
);
const UR_TEACHER_ANCHOR = new RegExp(
  `(?<![${UR_LETTER}])(?:استاد|اُستاد|ٹیچر|معلم)(?![${UR_LETTER}])`, 'g',
);
const UR_CASE_MARKER = new RegExp(`^\\s*(?:نے|کا|کی|کے|کو|سے|پر|میں|تک)(?![${UR_LETTER}])`);
const UR_SENTENCE_END = /[۔؟?!.\n]/;
const UR_GENDERED_VERB = new RegExp(
  '(?:رہی|رہے|کرتی|کرتے|پڑھاتی|پڑھاتے|بتاتی|بتاتے|سمجھاتی|سمجھاتے'
  + '|بولتی|بولتے|دکھاتی|دکھاتے|لکھتی|لکھتے|سکتی|سکتے|چاہتی|چاہتے'
  + '|جانتی|جانتے|سوچتی|سوچتے|دیتی|دیتے|لیتی|لیتے|تھیں|تھی|تھے|گی|گے)',
);
/** How far past the teacher noun a gendered verb still counts as its agreement. */
const UR_AGREEMENT_WINDOW = 40;
const HAS_URDU = new RegExp(`[${UR_LETTER}]`);

/** Every gendered form in one string, as the words that matched. */
function genderedTeacherForms(text, language) {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  const out = [];
  const push = (m) => { if (m) out.push(...m); };
  push(s.match(EN_PRONOUNS));
  push(s.match(EN_HE_LOWER));
  push(s.match(EN_HE_SENTENCE_START) && ['He']);
  // A Latin-script pronoun is a hit in an Urdu quiz too (the model mixes
  // scripts), so the English half runs unconditionally and the Urdu half is
  // added whenever there is Urdu in the string at all.
  const ur = language === 'ur' || HAS_URDU.test(s);
  if (ur) {
    const noun = UR_GENDERED_NOUN.exec(s);
    if (noun) out.push(noun[0].trim());
    UR_TEACHER_ANCHOR.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = UR_TEACHER_ANCHOR.exec(s))) {
      const after = s.slice(m.index + m[0].length);
      if (UR_CASE_MARKER.test(after)) continue;   // ergative or genitive: the verb agrees with the object
      const clause = after.split(UR_SENTENCE_END)[0].slice(0, UR_AGREEMENT_WINDOW);
      const verb = clause.match(UR_GENDERED_VERB);
      if (verb) { out.push(`${m[0]} … ${verb[0]}`); break; }
    }
  }
  return out;
}

/** The fields of ONE question a gendered teacher must never appear in. */
function questionFields(q) {
  const fb = (q && q.option_feedback) || {};
  const misc = (q && q.distractor_misconceptions) || {};
  return [
    ['question', q && q.question],
    ['options', (Array.isArray(q && q.options) ? q.options : []).join(' │ ')],
    ['explanation', q && q.explanation],
    ['selected_because', q && q.selected_because],
    ['option_feedback.correct', fb.correct],
    ['option_feedback.wrong', Object.values(fb.wrong || {}).map(String).join(' │ ')],
    ['distractor_misconceptions', Object.values(misc).map(String).join(' │ ')],
  ];
}

const HOW_TO_WRITE_IT = 'The teacher has no gender here: the lesson summary is written TO the '
  + 'teacher as "you" ("Today you taught…") and everywhere else the teacher is "the teacher". '
  + 'In Urdu use an imperative or a verb that agrees with the object («آپ نے … پڑھایا»), never '
  + 'استانی / معلمہ / صاحبہ and never پڑھاتی ہیں / پڑھاتے ہیں about the teacher. '
  + 'Rewrite the wording; keep the lesson’s own examples, numbers and words exactly as they are.';

/**
 * ONE defect per question (and one for the quiz) however many fields are
 * gendered: the retry has to rewrite that question once, and eight complaints
 * about eight fields of the same question read as eight faults.
 *
 * @param {object[]} questions authored questions (post-normalisation)
 * @param {{language?:string, lessonSummary?:string, quizId?:string}} ctx
 * @returns {{index:number|null, code:string, message:string}[]}
 */
function genderedTeacherDefects(questions, ctx = {}) {
  const { language, lessonSummary, quizId = null } = ctx;
  const out = [];
  const note = (index, field, forms) => {
    const where = index === null ? '"lesson_summary"' : field;
    out.push({
      index,
      code: 'PEDAGOGY_GENDERED_TEACHER',
      message: `${index === null ? '' : `q${index}: `}PEDAGOGY_GENDERED_TEACHER — ${where} `
        + `refers to the teacher with a gendered word (${forms.slice(0, 4).map((f) => `"${f}"`).join(', ')}). `
        + HOW_TO_WRITE_IT,
    });
    logEvent('transcript_quiz.gendered_teacher', {
      quizId, field: index === null ? 'lesson_summary' : field, index, hits: forms.length, language: language || null,
    });
  };

  if (typeof lessonSummary === 'string') {
    const forms = genderedTeacherForms(lessonSummary, language);
    if (forms.length) note(null, 'lesson_summary', forms);
  }
  (Array.isArray(questions) ? questions : []).forEach((q, i) => {
    if (!q || typeof q !== 'object') return;
    const fields = [];
    const forms = [];
    questionFields(q).forEach(([field, value]) => {
      const f = genderedTeacherForms(value, language);
      if (f.length) { fields.push(field); forms.push(...f); }
    });
    if (forms.length) note(i, fields.join(' + '), forms);
  });
  return out;
}

// ── LEVEL_MIX ────────────────────────────────────────────────────────────────
const LEVELS = { recall: 0, understand: 1, apply: 2 };
// The validator's own rule: at least 60% of the set must sit at or below the
// level the teacher taught. So on a lesson taught wholly at "recall", at most
// 40% of the questions can be above recall — asking for half would fail every
// attempt of every such lesson, forever. The requirement is therefore capped
// at what the other rule leaves room for.
const AT_OR_BELOW_SHARE = 0.6;

function levelMixDefect(questions, digest) {
  const qs = Array.isArray(questions) ? questions : [];
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  if (!qs.length || !slos.length) return null;
  const taught = new Map(slos.map((s) => [s.id, LEVELS[s.taught_level] ?? 1]));
  const higher = qs.filter((q) => (LEVELS[q && q.level] ?? 0) >= 1).length;
  // Questions whose own SLO was taught at understand or above can be asked at
  // understand for free; the rest must spend the "above taught level" budget.
  const free = qs.filter((q) => (taught.has(q && q.slo_id) ? taught.get(q.slo_id) : 1) >= 1).length;
  const budget = Math.floor(qs.length * (1 - AT_OR_BELOW_SHARE));
  const feasible = Math.min(qs.length, free + budget);
  const required = Math.min(Math.ceil(qs.length / 2), feasible);
  if (higher >= required) return null;
  return {
    index: null,
    code: 'PEDAGOGY_LEVEL_MIX',
    message: `PEDAGOGY_LEVEL_MIX — only ${higher} of ${qs.length} questions are tagged "understand" or "apply"; at least ${required} must be. Rewrite the plainest recall questions so the child has to USE the idea: ask which of these belongs to the group, which one does NOT, what happens next, or why the lesson's own example turned out the way it did.`,
  };
}

/**
 * The number the AUTHOR PROMPT quotes, computed from the digest before a single
 * question exists — the best case levelMixDefect could ever measure.
 *
 * The prompt used to say "at least HALF at understand or apply" flat, and on a
 * lesson whose SLOs were ALL taught at recall that is not reachable: coverage
 * forces one question onto each recall SLO, and only the 40% budget may sit
 * above the taught level. Told to find four, the model tagged two questions
 * "apply" on recall SLOs and the validator threw the whole quiz away — twice in
 * the twelve lessons of the offline pedagogy eval. Quoting the feasible NUMBER
 * instead of a fraction is the fix: prompt and validator agree on an integer.
 *
 * This is an upper bound over question-to-SLO assignments, so it is never
 * SMALLER than what levelMixDefect will require of the finished quiz — the
 * author is never asked for more than the rule allows.
 */
function requiredHigherOrder(n, digest) {
  const half = Math.ceil(n / 2);
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  if (!slos.length) return half;
  const higherSlos = slos.filter((s) => (LEVELS[s && s.taught_level] ?? 1) >= 1).length;
  const recallSlos = slos.length - higherSlos;
  // Every SLO must be covered, so `recallSlos` questions are pinned to a
  // recall SLO; the rest can sit on a higher-taught SLO for free.
  const free = higherSlos ? Math.max(0, n - recallSlos) : 0;
  const budget = Math.floor(n * (1 - AT_OR_BELOW_SHARE));
  return Math.max(0, Math.min(half, n, free + budget));
}

// ── the rule set ─────────────────────────────────────────────────────────────
// Order matters only in that the retry prompt quotes these in order; the
// count rule is the one the operator hit most, so it leads.
const RULES = [
  {
    code: 'PEDAGOGY_COUNT_RECALL',
    test: (q, language) => countRecall(q.question, q.options, language, q),
    message: (i) => `q${i}: PEDAGOGY_COUNT_RECALL — this stem asks how many things were mentioned and every option is a bare number, so it tests how many times something was said, not what it is. Ask the child to PICK the thing itself instead: "Which of these is a type of matter?", "Which of these is NOT one of them?" — same knowledge, real understanding.`,
  },
  {
    code: 'PEDAGOGY_TEACHER_AS_SUBJECT',
    test: (q, language) => teacherAsSubject(q.question, language),
    message: (i) => `q${i}: PEDAGOGY_TEACHER_AS_SUBJECT — the subject of this question is the teacher or the class ("did the teacher…", "استاد نے… کہا") rather than the idea, so a child who understood the concept but not the wording is marked wrong. Ask about the CONCEPT: keep the lesson's own example in the stem, but make the question one any child who followed the lesson can answer.`,
  },
  {
    code: 'PEDAGOGY_UNANSWERABLE',
    test: (q, language) => unanswerable(q.question, language),
    message: (i) => `q${i}: PEDAGOGY_UNANSWERABLE — the answer depends on which child, which group or which turn ("your group", "you were asked", "the student who…", "آپ کے گروپ") and the quiz cannot know that, so some children are marked wrong for something they never did. Rewrite it about the content everyone in the room was taught.`,
  },
];

/**
 * @param {object[]} questions authored questions (post-normalisation)
 * @param {{language?:string, digest?:object, lessonSummary?:string, quizId?:string}} ctx
 *        `lessonSummary` is checked only when the caller passes it — the same
 *        opt-in the validator's D4 checks use, so a legacy caller sees exactly
 *        today's behaviour.
 * @returns {{index:number|null, code:string, message:string}[]}
 */
function pedagogyDefects(questions, ctx = {}) {
  const qs = Array.isArray(questions) ? questions : [];
  const { language, digest, lessonSummary, quizId } = ctx;
  const out = [];
  qs.forEach((q, i) => {
    if (!q || typeof q !== 'object') return;
    RULES.forEach((rule) => {
      if (rule.test(q, language)) out.push({ index: i, code: rule.code, message: rule.message(i) });
    });
  });
  out.push(...genderedTeacherDefects(qs, { language, lessonSummary, quizId }));
  const mix = levelMixDefect(qs, digest);
  if (mix) out.push(mix, ...levelLiftDefects(qs, digest));
  return out;
}

/**
 * The questions to LIFT when the set has too few at understand/apply — one
 * per missing higher-order question, so the targeted rewrite can raise them
 * instead of the whole quiz dying on a complaint that names no question
 * (production, 2026-09-07: a science lesson failed its third attempt on
 * "only 3 of 8 … at least 4 must be", every question individually valid).
 * Recall questions on an SLO the lesson reached at understand or above come
 * first (lifting them costs nothing against the at-or-below rule), then the
 * rest — the same order the requirement itself was computed in.
 */
function levelLiftDefects(questions, digest) {
  const qs = Array.isArray(questions) ? questions : [];
  const slos = (digest && Array.isArray(digest.slos)) ? digest.slos : [];
  if (!qs.length || !slos.length) return [];
  const taught = new Map(slos.map((s) => [s.id, LEVELS[s.taught_level] ?? 1]));
  const higher = qs.filter((q) => (LEVELS[q && q.level] ?? 0) >= 1).length;
  const free = qs.filter((q) => (taught.has(q && q.slo_id) ? taught.get(q.slo_id) : 1) >= 1).length;
  const budget = Math.floor(qs.length * (1 - AT_OR_BELOW_SHARE));
  const required = Math.min(Math.ceil(qs.length / 2), Math.min(qs.length, free + budget));
  const missing = required - higher;
  if (missing <= 0) return [];
  const recall = qs.map((q, i) => ({ q, i })).filter(({ q }) => (LEVELS[q && q.level] ?? 0) === 0);
  const tl = ({ q }) => (taught.has(q && q.slo_id) ? taught.get(q.slo_id) : 1);
  recall.sort((a, b) => tl(b) - tl(a) || a.i - b.i);
  return recall.slice(0, missing).map(({ q, i }) => {
    const reached = ['recall', 'understand', 'apply'][tl({ q })] || 'understand';
    // Two rules meet on this question and they must not read as a
    // contradiction. On a lesson whose SLOs were all taught at "recall" the
    // set still needs a few questions at "understand", and the neighbouring
    // rule allows exactly that — ONE level above the taught level, for a
    // minority of the set. Saying only "ask it at understand" sent the model
    // oscillating on production (2026-09-07, quiz f5d625e9: over-corrected to
    // "apply" on one attempt, back to too-few on the next, no quiz).
    const free = reached !== 'recall';
    const why = free
      ? `its own SLO was taught at "${reached}", so asking it at "understand" costs nothing`
      : 'the lesson reached only "recall" for its SLO, and ONE level above the taught level is allowed for a minority of the set — this is one of those questions';
    return {
      index: i,
      code: 'PEDAGOGY_LEVEL_MIX',
      message: `q${i}: PEDAGOGY_LEVEL_MIX — ${why}. Ask the SAME idea at "understand" (level: "understand"): which of these belongs to the group, which one does NOT, what happens next, or why the lesson's own example turned out that way. Lift ONLY the questions named here — at most ${missing} of the ${qs.length} — and leave every other question exactly as it is, at its own level.`,
    };
  });
}

module.exports = {
  pedagogyDefects,
  genderedTeacherDefects,
  genderedTeacherForms,
  levelMixDefect,
  levelLiftDefects,
  requiredHigherOrder,
  countRecall,
  teacherAsSubject,
  unanswerable,
  optionsAreBareNumbers,
  isBareNumber,
  LEVELS,
  AT_OR_BELOW_SHARE,
};
