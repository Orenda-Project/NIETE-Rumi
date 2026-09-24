'use strict';
/**
 * Transcript quiz — pass 2, the AUTHOR.
 *
 * Writes N three-option questions from the digest plus the transcript
 * passages around each SLO's evidence. Every rule the prompt states is ALSO
 * enforced by transcript-quiz-validator.js; the prompt exists to make the
 * first attempt pass, the validator exists because it sometimes will not.
 *
 * On a retry the validator's complaints are appended, so the model fixes
 * what actually failed instead of re-rolling blind.
 */

const { completeJson } = require('./transcript-quiz-llm');
const { LANG_NAME, canonicalSubject } = require('./transcript-quiz-language');
const { ALLOWED_TYPES, EARLY_YEARS_TYPES, CORE_TYPES, minimalSpecBlock } = require('./transcript-quiz-figure');
const { names: pictogramNames } = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
const { MOLECULE_DICTIONARY } = require('./transcript-quiz-figure-science');
const { multiContract, multiFlowId } = require('./transcript-quiz-multi');
const { requiredHigherOrder } = require('./transcript-quiz-pedagogy');
const { peopleRule } = require('./transcript-quiz-people');
const { scrubPupils, PUPILS_RULE } = require('./transcript-quiz-pupils');
const {
  languageRule, questionContract, retryNote, languageAgain, SELECTED_BECAUSE_RULE, RELIGIOUS_CONTENT_RULE, DISTINCT_QUESTIONS_RULE,
  GENDER_NEUTRAL_RULE, LP_SUMMARY_VOICE, SUMMARY_TRUTH_RULE, summaryTruthEnabled,
} = require('./transcript-quiz-contract');
const { logEvent } = require('../../utils/structured-logger');

const DEFAULT_QUESTIONS = 8;

/**
 * The FIGURE contract.
 *
 * A figure is a diagram SPEC, not a picture: the model picks a type from the
 * allowlist and fills its numbers, and a deterministic engine draws it. The
 * allowlist and every minimal spec below are GENERATED from the engine's own
 * manifest at require time — a hand-copied list drifts the day a type changes
 * its required fields, and the model is then taught a shape the validator
 * rejects on every attempt.
 *
 * Every rule here is also enforced deterministically in
 * transcript-quiz-validator.js. The prompt exists to make attempt 1 pass.
 */
/** Grade 1-5 (and KG/prep, however the band is spelled). */
function isEarlyYears(gradeBand) {
  const g = String(gradeBand || '').toLowerCase();
  if (/\b(kg|k|prep|nursery|ecce|katchi)\b/.test(g)) return true;
  const nums = (g.match(/\d+/g) || []).map(Number);
  return nums.length > 0 && nums.every((n) => n <= 5);
}

/**
 * The block that opens the option space for a young class (round 5).
 *
 * The fifteen 6-12 types draw quantity, structure and process; before round 5 a
 * grade-1 phonics, spelling, counting, time or pattern lesson could reach none
 * of them, and the prompt told a language teacher to leave "figure" null. The
 * operator: "the computation of pictures can come in handy at any stage… an
 * image of a cat is shown and then c _ t is written in big alphabets and the
 * child has to pick what goes in the fill in the blank." The eight early-years
 * types are that stage. This block is shown ONLY for a grade 1-5 lesson: on a
 * grade 9 chemistry quiz it would be tokens spent teaching a model shapes it
 * must not use.
 */
function earlyYearsBlock(pictogramRoster, n, { maths = false } = {}) {
  // A grade 1-5 MATHS class aims for at least three (the density target), so
  // "pick the 4 the picture earns and write the rest as text" — read after a
  // lesson taught as a method — was the line that let a fractions quiz come
  // back with none. The cap is the same; the floor is stated beside it.
  const halfTail = maths
    ? `For THIS maths class that means three or four picture questions — no fewer than three, no more than ${Math.floor(n / 2)} — and the rest as text.`
    : `Pick the ${Math.floor(n / 2)} questions the picture genuinely earns and write the rest as text.`;
  return `
EARLY YEARS (this class is grade 1-5, so these types are open to you as well).
A picture is worth far more to a six-year-old than to a fifteen-year-old: a child who cannot yet read a long stem can still count apples, read a clock, or see which letter is missing. Reach for one of these whenever the lesson counted, sounded out, spelled, timed, compared, sorted or continued something.
- word_blank — phonics and spelling. A pictogram of the thing, and its word with a letter hidden. English: {"type":"word_blank","word":"cat","blanks":[1],"picto":"cat"} draws a cat and "c _ t"; the options are the letters. URDU: pass the whole word, {"type":"word_blank","word":"کتاب","blanks":[2],"picto":"book"} — it is drawn as separate letter tiles with an empty tile where the letter is missing, because Nastaliq joins and an underscore inside a word reshapes its neighbours. "blanks" is REQUIRED and is never empty: it is a list of 0-based positions into the letters of "word" (کتاب is ک=0, ت=1, ا=2, ب=3), counted on the whole word, and at least one but never all of them. A word the pictogram set has NOT got is still a word_blank: leave "picto" out entirely and the word is drawn as letter tiles on its own — {"type":"word_blank","word":"park","blanks":[3]} — which is a real phonics question and far better than dropping the question. Never swap in a different picture's name to get a picture.
- count_objects — counting and comparing, and ONLY that: the question must be HOW MANY, how many more, or which row has more. {"type":"count_objects","picto":"apple","count":7}; two rows to compare: {"rows":[{"picto":"apple","count":5,"label":"سیب"},{"picto":"banana","count":3,"label":"کیلے"}]}; equal groups for sharing/multiplying: {"picto":"star","count":12,"group":4}. To ask about a PART of a set ("what fraction of the pencils are coloured?", "how many red apples?"), draw that part as its own row that LOOKS different — its own colour {"picto":"pencil","count":2,"color":"warn"} beside {"picto":"pencil","count":3}, or its own picture; rows that look alike cannot show which things the question means, and the picture is thrown away. At least 2 things — one of something is not a count. To ask which WORD a picture matches, use the match type, never this.
- count_frame — a ten-frame ({"type":"count_frame","count":7}) or tally marks ({"model":"tally","count":12}).
- clock — telling the time. {"type":"clock","time":"3:30"}. The hands are geared correctly and the time is never printed.
- pattern — what comes next. {"type":"pattern","items":["circle","square","circle","square","?"]}, or numerals ({"text":"2"} …), or pictograms ({"picto":"sun"}). Exactly one "?". A colour pattern names its colours from THIS list and no other — ink, accent, leaf, cool, warn, plum, clay — as a bare word: {"shape":"circle","color":"warn"}. There is no var(--red), no var(--green), no "blue": an invented colour renders as nothing and the question is thrown away.
- match — the child picks the pair. {"type":"match","left":[{"picto":"cat"},{"picto":"dog"}],"right":[{"text":"dog"},{"text":"cat"}]} draws P/Q down one side and 1/2 down the other and JOINS NOTHING; your three options are the candidate pairings ("P-2", "P-1", "Q-2") — never A/B, which are the letters of the answer buttons.
- money — coins and notes. {"type":"money","currency":"Rs","items":[{"value":10,"kind":"coin"},{"value":5,"kind":"coin","count":2}]}. Each piece shows its own value, so never ask which piece is worth what — ask for the total, the number of pieces, or the swap.
- compare_size — longer/shorter, taller/shorter, heavier/lighter. {"type":"compare_size","model":"length","items":[{"label":"سرخ ربن","size":5},{"label":"ہرا ربن","size":8}]}, "height" for vertical bars, or {"model":"balance","left":{"picto":"apple","count":3},"right":{"picto":"apple","count":1}}. "size" is relative and is never printed. An item may name a colour from the same list (ink, accent, leaf, cool, warn, plum, clay) as a bare word — and if the label names a colour, the bar must be that colour or it contradicts its own label.
- base_ten — place value, drawn the way the class built it: loose sticks for ones, bundles of ten sticks for tens, big bundles for hundreds, a block of ten big bundles for thousands — or, with "model":"blocks", unit cubes, rods, flats and cubes. {"type":"base_ten","hundreds":3,"tens":4,"ones":2}; a four-digit number adds "thousands" (up to 9). The number is never printed and a 0 is an empty column, so ask what number the picture shows, how many tens it has, or what the tens are worth.
- COUNTERS AND TILES are what a maths class counts with: "counter" (a round counter — the lesson's counters, dots, beads and marbles) and "tile" (a square — its tiles and squares) are pictograms like any other, e.g. {"type":"count_objects","picto":"counter","count":7}.
PICTOGRAM NAMES — a picture of a thing comes from this fixed set and NOTHING ELSE. NEVER INVENT A PICTOGRAM NAME: a name that is not on this list fails the question outright. The set will not have every word your lesson used. When it does not, choose a word from the lesson that IS on the list, or write that question without a figure — those are the only two options (word_blank has a third: keep it and leave "picto" out, and the letters are drawn on their own).
${pictogramRoster}
Reuse the older types for a young class too: numberline for before/after and ordering, fraction_bar and grid for part-whole, geometry for naming a shape, flow or timeline for a sequence of steps.
THE HALF RULE STILL HOLDS HERE. At most half of the ${n} questions may carry a picture — for ${n} questions that is ${Math.floor(n / 2)} at the very most. These types are easy to reach for and a quiz that draws on five of eight is thrown away whole. ${halfTail}
`;
}

/**
 * The picture questions a grade 1-5 maths lesson HAS (fix of the live grade 4
 * fractions case). A lesson taught as a METHOD — cross multiplication, equal
 * denominators, carrying — gave the model no question it could see a picture
 * for, so it wrote eight method questions and drew nothing, twice. Every recipe
 * here passes the figure gates as written: the picture is read, never labelled
 * with the answer, and able to produce it (FIGURE_MISMATCH).
 */
const EARLY_MATHS_RECIPES = `PICTURE QUESTIONS A GRADE 1-5 MATHS LESSON HAS. Even a lesson taught as a METHOD (cross multiplication, equal denominators, carrying, borrowing) rests on an idea a child can SEE, and the picture questions are about that idea:
- FRACTIONS. One bar, some parts shaded, no label: "What fraction of the bar is shaded?" («تصویر میں پٹی کا کتنا حصہ رنگا ہوا ہے؟») — the options three fractions of DIFFERENT amounts: never 2/8 beside 1/4, because both read a bar of 2 in 8 right. Three bars named "P", "Q", "R": "Which bar shows $\\frac{2}{3}$?" — the options "P", "Q", "R", and the three bars show three DIFFERENT amounts, never 1/2 beside 3/6 (every option is on the picture, so nothing is given away; the feedback says "bar P", «پٹی P»). Two bars of the same length, unlabelled: "Both bars are the same length. What fraction of the bar with MORE shaded is shaded?" — the stem names no fraction, so the child reads both off the picture. A grid: "What fraction of the squares are shaded?" An improper fraction or a mixed number is drawn as whole bars and a part bar — 7/4 is {"parts":4,"shaded":4} then {"parts":4,"shaded":3} — never one bar with more shaded than parts; a "which bar shows" set uses proper fractions only.
- PLACE VALUE. base_ten: "What number do the sticks show?", "How many tens are there?"
- COUNTING, ADDING, TAKING AWAY. count_objects or count_frame: "How many counters are there altogether?", "How many more apples than bananas are there?"
- TIMES AND SHARING. count_objects with "group": "How many groups of 4 are there?"
- ORDER. A numberline with points "P", "Q", "R": "Which point is at 7?"
- A STEP OF A PROCEDURE is a TEXT question: a cross product ("what is 2 × 5?"), a fraction rewritten over a new denominator, a carried ten, the next line of a working. No picture shows its answer, and a picture beside it is thrown away (FIGURE_MISMATCH). Write those as text, and take your picture questions from this list.`;

function figureContract({ subject, gradeBand, nQuestions = DEFAULT_QUESTIONS } = {}) {
  const drawable = ['maths', 'science', 'genk', 'other'].includes(String(subject || '').toLowerCase());
  const early = isEarlyYears(gradeBand);
  // A grade 1-5 lesson in ANY subject can now be drawn — the early-years types
  // are exactly the ones a language or general-knowledge lesson needs, and the
  // K-5 coverage count says so: `match` serves 360 of the corpus's segments and
  // `word_blank` 257, and both of those live in English and Urdu periods, not
  // in maths (the option-space study).
  // A grade 9 quiz is never shown the ten-frame; a grade 1 quiz is shown both
  // halves, because a young class still counts on a number line and shades a
  // grid.
  const offered = early ? ALLOWED_TYPES : CORE_TYPES;
  // A grade 1-5 MATHS quiz aims for at least three pictures (the validator's
  // figureDensity; the generate step adds pictures once when it falls short),
  // and may draw a picture that MODELS the stem's own numbers.
  const earlyMaths = early && canonicalSubject(subject) === 'maths';
  const requirement = earlyMaths
    ? `THIS LESSON IS DRAWABLE (maths, grade 1-5). A young class learns maths through the picture — the objects, then the picture of them, then the sum — so write AT LEAST THREE picture questions of the ${nQuestions}, and never more than ${Math.floor(nQuestions / 2)}. PLAN THE PICTURES FIRST: before you write a single question, choose three pictures from what the lesson drew — counters, tiles, bundles of sticks, fraction bars, a number line — and for each write the question a child answers by LOOKING at it (PICTURE QUESTIONS A GRADE 1-5 MATHS LESSON HAS, below). Only then write the other questions. Build each picture question AROUND its picture.

${EARLY_MATHS_RECIPES}`
    : drawable || early
    ? `THIS LESSON IS DRAWABLE (${subject || 'language'}${early ? ', grade 1-5' : ''}). Write at least ONE picture question — two or three when the lesson has ${early ? 'counting, letters or sounds, spelling, the clock, money, a pattern, a sorting or matching activity, shapes, ' : ''}fractions, a number line, shapes, measurement, a graph, a circuit, a sequence of steps, parts of a cell, atoms or an equation. Build the question AROUND the picture: decide the drawing first, then ask what it shows. Zero pictures is acceptable only when nothing in the lesson can be drawn with the allowed types.`
    : `This subject (${subject || 'language'}) rarely needs a picture; leave "figure" null unless the lesson genuinely asks the child to read something off a drawing.`;
  return `PICTURE QUESTIONS.
A question may carry a "figure": a diagram SPEC that a deterministic drawing engine renders into the picture the child sees ABOVE the stem, with the options under it. You are choosing a shape and its numbers, not describing an image.

${requirement}

WHEN a figure is right:
  (a) the child must READ something off the picture to answer: a position, a shaded part, a shape, a plotted point, a circuit, a sequence of steps. Use "figure_role": "read_off".
  (b) the class is grade 1–5 and the question asks the child to count or compare objects. Use "figure_role": "count_compare".
${earlyMaths ? `  (c) THIS grade 1-5 maths class may also see a picture that MODELS the numbers the stem states — the pictorial step the lesson itself used: two fraction bars beside "which is larger, 2/3 or 3/5?", two rows of counters beside "3 + 4 = ?", bundles and sticks beside "34 + 12". Use "figure_role": "model". The stem keeps its numbers; the picture still never shows the answer — no option's text, no total, no result.
` : ''}${earlyMaths
    ? 'WHEN a figure is wrong: a definition, recall of a word or term, decoration, or a step of a procedure (a cross product, a rewritten fraction, a carried ten) — no picture shows that answer. Write those as text, and write your three or four picture questions as (a)-(c) and the list above.'
    : 'WHEN a figure is wrong: a definition, recall of a word or term, or decoration. If the question can be answered without looking at the picture, there is no figure.'}

HARD RULES
- The figure must NOT contain the answer. No option's text may appear in the picture — UNLESS every option's appears (a "which point is at −3? P / Q / R" number line is fine, because naming all three gives nothing away). Do not write the fraction, the total, the percentage or the result anywhere in the spec (no "title" or "caption" that states it).
- At most half of the questions may carry a figure.
- Labels are written in the quiz language; numerals, units, formulae and chemical species stay in English letters and read left-to-right (LTR) even in an Urdu figure. A term may stay in English letters, but a person's name in a label is written in the quiz language (حرا کی بوتل, not Hira کی بوتل).
- A stem that promises a picture must carry one. If the stem says "in the picture" or "تصویر میں", the question needs a "figure".
- Use the SIMPLEST spec that answers the question. Long labels and crowded scales collide and the whole question is thrown away.
- The engine draws MATHEMATICS AND SCIENCE, never pictures of things: never draw a scene, an object, an animal, a person or a place with geometry shapes (a "farm" of rectangles and circles renders as a blank). If the question needs a photo of a real thing, there is no figure.
- A jump arc must not land on the answer: "3 + 4 = ?" with an arc from 3 to 7 shows the child the 7. Draw the dot at 3 and ask where a jump of 4 lands, with no arc — or draw the arc and ask how long the jump was.
- EARN THE FIGURE: the stem must not state the numbers the picture shows. "A bar has 4 parts and 1 is shaded — which fraction?" needs no picture; "تصویر میں کتنا حصہ رنگا ہوا ہے؟" does. The child must READ the picture to answer.${earlyMaths ? ' The one exception is a "model" picture, (c) above.' : ''}
- geometry is for MATHEMATICS lessons only, and its kinds are exactly: triangle, polygon, circle (keys c, r), angle/rightangle (vertex, a, b), line/segment (from, to), point (at) — there is no "text", "rectangle" or "arrow" kind; a shape with the wrong keys vanishes.
- Column arithmetic is NO picture: write a column sum as ONE typeset expression in the stem (COLUMN SUMS, in the question rules above). Long division and other written working stay as digits in the stem.
- A figure must be able to PRODUCE the answer: if the answer is 4 (12 shared into 3), the drawing shows 12 things in 3 equal groups, not 9 cells with 3 shaded. A science process is a flow; a sequence in time is a timeline; a comparison of amounts is a fraction_bar or a grid.
- Colours: use only the tokens named in the minimal specs; never invent one (var(--sand), var(--brown) do not exist and render as nothing).
- SCIENCE MUST BE TRUE. A drawing is checked against the world, not only against the engine: a chem_equation must BALANCE (set "balanced": false only when the question is asking the child to balance it); an atom's element must be one the engine knows (H to Ca, plus Fe, Cu, Zn, Br, I) or carry an explicit "Z" and "shells", because an unknown symbol is drawn as a different element wearing that label; a cell may only label parts the chosen kind has (an animal cell has no wall, no chloroplast, no large vacuole).
- A dot-and-cross bonding picture ("mode":"dot_cross") takes a "partner" OBJECT ({"element":"Cl"}) and a NUMERIC "transfer" — a string for either is silently dropped and the engine draws a different element, or a charge nobody chose. It is for MAIN-GROUP elements only: never Fe, Cu or Zn, whose shells in the engine are a simplification their real ion charge does not follow from. In an ionic pair the transfer is the donor's outer electrons AND what the acceptor needs to reach eight — the same number both ways (Na to Cl is 1; Mg to O is 2).
- molecule draws only these formulas, and you write ONLY the "formula" — the structure is filled in from a fixed table, never from a SMILES you write: ${Object.keys(MOLECULE_DICTIONARY).join(', ')}.

WORKED EXAMPLES (spec next to the question it serves):
1. fraction_bar, read_off — stem "تصویر میں روٹی کا کتنا حصہ رنگا ہوا ہے؟", options ["$\\\\frac{3}{4}$", "$\\\\frac{1}{4}$", "$\\\\frac{4}{3}$"], correct 0,
   "figure": {"type":"fraction_bar","bars":[{"parts":4,"shaded":3}]}   (no label on the bar — the label would be the answer)
2. numberline, read_off — stem "Which point is at −3?", options ["P", "Q", "R"], correct 0,
   "figure": {"type":"numberline","from":-5,"to":5,"step":1,"points":[{"at":-3,"label":"P"},{"at":1,"label":"Q"},{"at":4,"label":"R"}]}
3. grid, count_compare — stem "تصویر میں کتنے خانے رنگے ہوئے ہیں؟", options ["12", "8", "20"], correct 0,
   "figure": {"type":"grid","rows":4,"cols":5,"shaded":12}

${early ? earlyYearsBlock(pictogramNames().join(', '), nQuestions, { maths: earlyMaths }) : ''}
ALLOWED TYPES — nothing else is accepted (${offered.join(', ')}):
${minimalSpecBlock(offered)}`;
}

/** The opening, the passages around each SLO's evidence, and the close. */
function excerptsFor(transcript, digest, width = 1200) {
  const t = String(transcript || '');
  const parts = [t.slice(0, 1500)];
  (digest?.slos || []).slice(0, 6).forEach((s) => {
    const q = String(s.evidence_quote || '').slice(0, 60);
    const needle = q.slice(0, 30);
    const i = needle ? t.indexOf(needle) : -1;
    if (i >= 0) parts.push(t.slice(Math.max(0, i - width / 2), i + width / 2));
  });
  parts.push(t.slice(-1200));
  // the children the recording names are never read by the author (transcript-quiz-pupils)
  return scrubPupils(parts.join('\n---\n'), digest && digest.pupil_tokens);
}

const TRANSCRIPT_SUMMARY_RULE = `LESSON SUMMARY. Also return a top-level "lesson_summary": 2-3 sentences, in the quiz language (follow the same Urdu/English style rules above), written TO THE TEACHER (not the child), in the SECOND PERSON — "you": say what you taught and in the order you taught it, naming your own examples and numbers from the lesson. Do not summarise the quiz — summarise the LESSON.

TWO SHORT LINES FOR THE SHEET. Also return, in the same language and the same second-person address:
- "lesson_summary_short": ONE sentence, at most 25 words — what you taught, with your own first example. No list, no second sentence.`;
/** The recording's summary rule, with the truth rule while its switch is on (read per prompt). */
const transcriptSummaryRule = () => (summaryTruthEnabled() ? `${TRANSCRIPT_SUMMARY_RULE}\n\n${SUMMARY_TRUTH_RULE}` : TRANSCRIPT_SUMMARY_RULE);

/**
 * The lp_v8 twin: the teacher PLANNED this lesson; nobody heard it taught. The
 * voice (the lesson as the subject, never a teacher-verb) is the contract's
 * LP_SUMMARY_VOICE, shared with the targeted rewrite.
 */
const LP_SUMMARY_RULE = `LESSON SUMMARY. Also return a top-level "lesson_summary": 2-3 sentences, in the quiz language (follow the same Urdu/English style rules above), written TO THE TEACHER (not the child). ${LP_SUMMARY_VOICE} Do not summarise the quiz — summarise the LESSON PLAN.

TWO SHORT LINES FOR THE SHEET. Also return, in the same language and the same voice:
- "lesson_summary_short": ONE sentence, at most 25 words — what today's lesson plans to teach, with the plan's own first example, opening the same way ("Today's lesson plans …" / «آج کے سبق میں …»). No list, no second sentence.`;

/**
 * The picture rule, restated at the END of a grade 1-5 maths prompt — the way
 * the language rule is (languageAgain). Stated once at the top of a ~230-line
 * picture section, it lost to the lines after it.
 */
function picturesAgain({ subject, gradeBand, n }) {
  if (!(isEarlyYears(gradeBand) && canonicalSubject(subject) === 'maths')) return '';
  return `\n\nPICTURES, AGAIN (grade 1-5 maths): no fewer than three and no more than ${Math.floor(n / 2)} of the ${n} questions carry a picture the child READS to answer — what fraction of the bar is shaded, which bar shows a fraction, what number the sticks show, how many counters there are. Choose those pictures before you write the questions; a step of a procedure stays text. A quiz of text questions only is sent back.\n`;
}

/** The digest as the author reads it: the children's hashes are for the checks, not the model. */
function digestForPrompt(digest) {
  if (!digest || typeof digest !== 'object') return digest;
  const { pupil_tokens: pupilTokens, ...rest } = digest;   // eslint-disable-line no-unused-vars
  return rest;
}

function buildAuthorPrompt({
  digest, excerpts, language, n = DEFAULT_QUESTIONS, gradeBand, previousErrors = null,
  // PLAN_R5 D4. Asking for a question we cannot deliver is worse than not
  // asking: a set question rendered as a single-select picker is unanswerable.
  // Defaulted by the CALLER from the Flow id, not read here, so a test can ask
  // for either prompt without touching the environment.
  allowMulti = false,
  // PLAN_R8 §3.2 — an lp_v8 quiz has no transcript. When `lessonPlan` is given
  // the prompt reads the PLANNED lesson in the excerpts' place, and says so:
  // "excerpts of the transcript" over a lesson plan would have the model
  // inventing classroom talk, and the summary it writes to the teacher says
  // "you planned", never "you taught".
  lessonPlan = null,
  // Part B — an lp_v8 lesson's own manipulatives (lp-quiz-digest lessonDrewBlock):
  // the counters, bundles and tiles the class saw, so a picture draws those.
  lessonDrew = '',
}) {
  const lp = Boolean(lessonPlan);
  // How many of the n may actually be above bare recall on THIS lesson. A flat
  // "half" is unreachable when every SLO was taught at recall, and the model
  // reaches it by tagging questions two levels above — which the validator
  // rejects, costing the whole quiz. See requiredHigherOrder().
  const nHigher = requiredHigherOrder(n, digest);
  const rule = languageRule(language);
  const retry = retryNote(previousErrors, language, n);
  // The language rule is restated in the tail of the prompt on every attempt.
  // `retryNote` already opens with it, so this is the attempt-1 half only.
  const langAgain = retry ? '' : languageAgain(language);
  return `You are writing a short WhatsApp quiz for the children who sat in ONE real lesson. ${lp ? 'You have the lesson digest and the LESSON PLAN the teacher taught from — there is no recording of the class, so never invent what was said in it.' : 'You have the lesson digest and excerpts of the transcript.'} The quiz is taken one question at a time on a phone: a stem, three tappable options, then feedback.

QUIZ LANGUAGE: ${LANG_NAME[language] || 'Urdu'}. ${rule}

WHAT TO WRITE — exactly ${n} questions.

THE SLOs DRIVE THE QUESTIONS. The digest's "slos" are what these children were meant to LEARN; the ${lp ? 'lesson plan' : 'transcript'} supplies the level the teacher pitched it at, the examples used and the words used. Write the question the SLO asks for, dressed in the lesson's own material. The lesson is where the question comes FROM, never what the question is ABOUT.
- Cover EVERY SLO in the digest at least once (tag each question with the SLO's exact "id"). Spread the rest across the SLOs the lesson spent most time on.
- ANSWERABLE BY ANY CHILD WHO UNDERSTOOD THE CONCEPT — whatever that particular child was personally asked to do, which group they sat in, whether they were called to the board, whether they were listening at that minute. If answering needs to know what one child or one group was told, no answer can be just to the rest, and the question is unusable.
- NEVER COUNT MENTIONS. A stem asking how many things were mentioned, named, discussed or talked about, with bare numbers as the options, tests how many times something was said — not what it is. Ask the child to PICK the thing instead. (Counting what a PICTURE shows is a different thing and is welcome.)
- THE SUBJECT OF THE QUESTION IS THE CONCEPT, never the teacher, the class or your group, and never classroom logistics: no "what did the teacher call it", "which one was used in class", "what were you asked to draw", who was at the board, which page, what homework.
- At least ${nHigher} of the ${n} questions tagged "understand" or "apply", never bare recall: which of these belongs / which does NOT / what happens when / why did the lesson's own example turn out that way / use the idea on a new case. Put those questions on the SLOs this lesson taught at "understand" or "apply", so they sit AT the level the lesson taught rather than above it.
- Levels, hard: at least 60% of the questions at or below their own SLO's "taught_level", and NEVER more than ONE level above it. On an SLO taught at "recall", "understand" is the ceiling and "apply" is not allowed. That rule wins over the line above — ${nHigher} is already what it leaves room for on this lesson.
- Question 1 must be the easiest, so a nervous child gets one right first. EASIEST MEANS A PICK: ask the child to identify the plainest thing the lesson taught ("Which of these is a type of matter?", "ان میں سے کون سا نقشے کی ایک قسم ہے؟") — never a count of how many things were mentioned or how many kinds there are. That count is the question this slot keeps attracting, and it is thrown away every time.
- Use the lesson's OWN examples, numbers, words, objects and stories (from "examples_used" and the excerpts) as the MATERIAL of the question. A child should recognise the class in the quiz.
- ${DISTINCT_QUESTIONS_RULE}

GOOD vs BAD — same lesson, same knowledge, and the good one is the one a child learns from:
  BAD  "How many types of matter did the teacher mention?"  3 / 2 / 4
  GOOD "Which of these is a type of matter?"  gas / speed / weight
  BAD  "Which atom did the teacher ask your group to draw?"  Oxygen / Carbon / Boron
  GOOD "An atom has 6 protons. Which element is it?"  Carbon / Oxygen / Boron
  BAD  "What did madam call the middle of the atom?"  nucleus / shell / orbit
  GOOD "Where in an atom are the protons found?"  in the nucleus / in the outer shell / outside the atom
  BAD  "استاد نے matter کی کتنی قسمیں بتائیں؟"  ۳ / ۲ / ۴
  GOOD "ان میں سے کون سی matter کی ایک قسم ہے؟"  gas / رفتار / وزن

${questionContract({ gradeBand })}

${lp ? LP_SUMMARY_RULE : transcriptSummaryRule()}
- "checks_summary": ONE sentence, at most 30 words, beginning with what this quiz checks — the skills, not the question count (e.g. "This quiz checks whether the class can tell a proper fraction from an improper one and compare two with the same denominator."). Never name the teacher or the children; no gendered forms.

${SELECTED_BECAUSE_RULE}
${GENDER_NEUTRAL_RULE}
${RELIGIOUS_CONTENT_RULE}
${PUPILS_RULE}
${peopleRule(digest, language)}

${figureContract({ subject: digest && digest.subject, gradeBand, nQuestions: n })}
${lessonDrew ? `${lessonDrew}\n` : ''}${multiContract({ allowMulti, n })}${langAgain}${retry}${picturesAgain({ subject: digest && digest.subject, gradeBand, n })}

Return ONLY this JSON object:
{ "lesson_summary": "", "lesson_summary_short": "", "checks_summary": "",
  "questions": [
  { "slo_id": "S1", "level": "recall|understand|apply", "question": "", "options": ["", "", ""], "correct_index": 0,
    "explanation": "", "selected_because": "", "distractor_misconceptions": { "1": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "1": "", "2": "" } },
    "figure": null, "figure_role": null },
  { "slo_id": "S2", "level": "understand", "question": "…تصویر میں…", "options": ["", "", ""], "correct_index": 1,
    "explanation": "", "selected_because": "", "distractor_misconceptions": { "0": "", "2": "" },
    "option_feedback": { "correct": "", "wrong": { "0": "", "2": "" } },
    "figure": { "type": "fraction_bar", "bars": [ { "parts": 4, "shaded": 3 } ] }, "figure_role": "read_off" } ] }
(In this example the correct option is index 0, so the wrong keys are "1" and "2". If correct_index is 1 the keys are "0" and "2"; if it is 2 the keys are "0" and "1".)
Omit "figure" and "figure_role", or leave them null, on every question that does not need a picture. When a question does carry one, "figure" is a spec object of the form shown in ALLOWED TYPES — e.g. "figure": {"type":"fraction_bar","bars":[{"parts":4,"shaded":3}]}, "figure_role": "read_off".

LESSON DIGEST:
${JSON.stringify(digestForPrompt(digest), null, 0)}

${lp ? `THE LESSON PLAN (what the class was to learn, the worked example, the mistake it expects, the shape of the practice):
${lessonPlan}` : `TRANSCRIPT EXCERPTS (the passages around each SLO's evidence, plus the opening and closing of the lesson):
${excerpts}`}`;
}

/**
 * @returns {Promise<{questions:object[], model:string, costUsd:number|null, latencyMs:number}>}
 */
async function author({
  digest, transcript, language, n = DEFAULT_QUESTIONS, gradeBand = null, previousErrors = null,
  quizId = null, allowMulti = Boolean(multiFlowId()), lessonPlan = null, lessonDrew = '',
}) {
  const excerpts = lessonPlan ? '' : excerptsFor(transcript, digest);
  const prompt = buildAuthorPrompt({
    digest, excerpts, language, n, gradeBand, previousErrors, allowMulti, lessonPlan, lessonDrew,
  });
  const { json, model, costUsd, latencyMs } = await completeJson({ prompt, label: 'transcript_quiz.author' });
  const questions = Array.isArray(json?.questions) ? json.questions : [];
  const lessonSummary = typeof json?.lesson_summary === 'string' ? json.lesson_summary : '';
  // bd-2yyry.7 — the two one-liners for the pre-send sheet. A missing or
  // over-long one is null: the template then falls back to its own cap.
  const oneLine = (v, maxWords) => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t) return null;
    return t.split(/\s+/).length > maxWords ? null : t;
  };
  const extras = {
    lesson_summary_short: oneLine(json?.lesson_summary_short, 40),
    checks_summary: oneLine(json?.checks_summary, 40),
  };
  logEvent('transcript_quiz.author_done', {
    quizId, model, costUsd, latencyMs, questions: questions.length, language, retry: Boolean(previousErrors),
    lessonSummary: Boolean(lessonSummary), shortSummary: Boolean(extras.lesson_summary_short), checksSummary: Boolean(extras.checks_summary),
  });
  return {
    questions, model, costUsd, latencyMs, lessonSummary, extras,
  };
}

// languageRule / questionContract / retryNote are deliberately NOT re-exported
// here: several suites mock this service wholesale, so anything another module
// requires FROM it is undefined at runtime while every test stays green. They
// live in, and are imported from, transcript-quiz-contract.js.
module.exports = { author, buildAuthorPrompt, excerptsFor, DEFAULT_QUESTIONS };
