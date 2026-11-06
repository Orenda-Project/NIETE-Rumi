'use strict';
/**
 * bd-5jmnfj.38.31 — the free-mode paper for grades 6-12: its rules and its size.
 *
 * Pure: no I/O. The G1-5 free prompt is reused as the base and this block is added before its
 * safety policies, so a G1-5 paper never sees any of it. The panel of 2026-11-06 blocked G7 General
 * Science ch1 and G8 Urdu ch4 for keys without marking points (A7c), long stems (A2d), a load near
 * 180% of the time (A5g), the key being the longest option (A7a), MCQs giving away short answers
 * (A5b) and implausible distractors (A7b); each rule below answers one of those.
 */

// Words per sentence and per MCQ stem (panel A2d), and the minutes a free paper is sized to (A5g).
const BANDS = [
  { upTo: 8, sentence: 14, mcqStem: 25, minutes: 60 },
  { upTo: 10, sentence: 17, mcqStem: 35, minutes: 75 },
  { upTo: 12, sentence: 20, mcqStem: 45, minutes: 90 },
];

// Planning minutes per item by type: read, think and write at G6-8 speed. Anything not listed is
// a constructed item of about one short answer.
const MINUTES = { srq: 5, erq: 13, grammar: 4, comprehension: 6, essay: 15 };
const OBJECTIVE_MINUTES = 1;
const OTHER_MINUTES = 5;
const REVIEW_MINUTES = 5;
// The share of the printed time the load may fill (A5g): a 60-minute paper is planned to 51 minutes.
const LOAD_SHARE = 0.85;

// A7b on the a3 G8 Urdu paper: "meaning of X" items whose three distractors were all the key's opposite.
const MEANING_RULE = 'When an MCQ asks for the meaning or a quality of a word, no distractor is the opposite of the key (for "plenty", never "little" or "scarce"): use meanings a student could really confuse with it, such as a related word with a different sense, a word that looks or sounds alike, or the meaning the word has in another context.';

// A7c on the a4 G8 Urdu key: written items carried points only. Every written item also gets a
// holistic band, an accept line and a do-not-accept line; free-secondary-scheme checks them.
const SCHEME_RULE = 'Every item that is not an MCQ also carries "mark_bands": 2 or 3 levels, full / partial / none, each with its marks and what an answer at that level does (for 3 marks: [{"marks": "3", "descriptor": "full: ..."}, {"marks": "1-2", "descriptor": "partial: ..."}, {"marks": "0", "descriptor": "none: ..."}]); "accept": one line of other correct answers to accept; and "reject": one line of a likely wrong or incomplete answer that earns no mark.';

function bandOf(grade) {
  const n = Number(grade);
  return BANDS.find((b) => n <= b.upTo) || BANDS[BANDS.length - 1];
}

function isObjective(t) {
  return t.category === 'objective' || t.id === 'mcq';
}

function minutesOf(t) {
  if (isObjective(t)) return OBJECTIVE_MINUTES;
  return MINUTES[t.id] || OTHER_MINUTES;
}

function plannedMinutes(types) {
  return types.reduce((s, t) => s + minutesOf(t) * (Number(t.count) || 0), REVIEW_MINUTES);
}

/**
 * Moves items one at a time from the slowest constructed type that has more than one, onto the
 * first objective type, until the plan fits LOAD_SHARE of the band's minutes, so the time the paper
 * prints (printedMinutes) is within the band. The total count is kept, and no
 * type the teacher picked drops below one. A paper that fits, or has no objective type to move
 * items onto, comes back as it was.
 */
function sizeTypes(types, grade) {
  const budget = Math.floor(bandOf(grade).minutes * LOAD_SHARE);
  const target = types.findIndex(isObjective);
  if (target < 0 || plannedMinutes(types) <= budget) return { types, moved: 0 };
  const out = types.map((t) => ({ ...t, count: Number(t.count) || 0 }));
  let moved = 0;
  while (plannedMinutes(out) > budget) {
    const from = out
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !isObjective(t) && t.count > 1)
      .sort((a, b) => minutesOf(b.t) - minutesOf(a.t))[0];
    if (!from) break;
    from.t.count -= 1;
    out[target].count += 1;
    moved += 1;
  }
  return { types: out, moved };
}

function rulesBlock(grade, lessonTitle) {
  const b = bandOf(grade);
  const lesson = lessonTitle
    ? `\n- The lesson is "${lessonTitle}". At least two items ask about it by name: its main idea, event, process or person, not only its vocabulary or grammar.`
    : '';
  return `

### GRADES 6-12 RULES (Grade ${Number(grade)}; these override anything above that disagrees)
LENGTH
- Every sentence a student reads is at most ${b.sentence} words. An MCQ stem is at most ${b.mcqStem} words. Split a long stem into two short sentences, or cut the scene-setting.
MARKS AND SIZE
- MCQ 1 mark. Short answer 3 marks, answered in 2 to 4 short sentences. Extended answer 6 marks in labelled parts (a), (b), (c) of 2 marks each: never one open essay. Grammar 3 marks.
- The paper is sat in ${b.minutes} minutes. Keep it small enough to finish, check and review in that time.
MCQ OPTIONS
- Four options of about the same length and the same grammatical form. The correct answer is NOT the longest option: if it is, shorten it or lengthen a distractor.
- Spread the correct letter across the paper: no letter for more than a third of the MCQs, never the same letter three times in a row.
- Every distractor is a misconception a Grade ${Number(grade)} student really holds, or a real mix-up of two terms from the lesson. No opposites of the key written to be obviously wrong, no jokes, no "all of the above", "none of the above", "always", "never" or "only".
- ${MEANING_RULE}
ONE FACT, ONE ITEM
- Test each fact once. No item may state, print or hint at the answer to another item, and no MCQ may give away the answer to a short answer. Check the whole paper for this before you return it.
- At least one item asks about the main subject of the lesson: its main idea, event, process or person by name.${lesson}
MARKING (every item that is not an MCQ)
- Add "marking_points": [{"point": "<what earns the mark>", "marks": <number>}], one entry per mark or part, summing exactly to the item's marks.
- ${SCHEME_RULE}
- In a subject other than a language, the accept line also accepts a correct answer written in Urdu or English.`;
}

/** The base system prompt with the rules block placed before the safety policies, which stay last. */
function withRules(baseSystem, safety, grade, lessonTitle) {
  const block = rulesBlock(grade, lessonTitle);
  if (safety && baseSystem.endsWith(safety)) {
    return baseSystem.slice(0, baseSystem.length - safety.length) + block + safety;
  }
  return baseSystem + block;
}

/** The note sent back with a draft that broke a rule: one line per problem, by question number. */
function fixNote(issues) {
  const lines = issues.map((i) => `- ${i.n ? `Q${i.n}` : 'Whole paper'}: ${i.text}`);
  return [
    'Your paper breaks these GRADES 6-12 RULES:',
    ...lines,
    'Fix each one and return the whole paper as the same JSON object, every item included.',
  ].join('\n');
}

/**
 * The distractor review (free-secondary-review.js): each MCQ with its options and key, and the reply
 * wanted. A distractor rated 1 sends its item to the targeted rewrite.
 */
function reviewPrompt(mcqs, grade) {
  return [
    `You are checking the multiple-choice questions of a Grade ${grade} paper in Pakistan before it is printed.`,
    `For each MCQ, rate every wrong option (distractor) from 1 to 3 for how likely a Grade ${grade} student who holds a common misconception about the topic is to choose it:`,
    '3 = such a student would likely choose it; 2 = some students might; 1 = no student who studied the lesson would choose it (plainly wrong, off the topic, silly, or a giveaway).',
    'Also say whether the key is the longest option or stands out from the others by its length or detail.',
    'Return JSON only: {"items":[{"n":<question number>,"distractors":[{"option":"a","rating":1,"why":"..."}],"longest_key":false}]}',
    '',
    ...mcqs.map((m) => `Q${m.n}: ${m.question}\n${m.options.join('\n')}\nKey: ${m.key}`),
  ].join('\n');
}

module.exports = { MEANING_RULE, SCHEME_RULE, LOAD_SHARE, bandOf, sizeTypes, plannedMinutes, rulesBlock, withRules, fixNote, reviewPrompt };
