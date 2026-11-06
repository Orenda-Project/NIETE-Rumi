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
// The same items at the lighter marks a paper takes when converting is not enough (a7 ruling, step c):
// a 2-mark short answer, a 3-mark extended answer, a 2-mark grammar item.
const LIGHT_MINUTES = { srq: 3, erq: 7, grammar: 3, comprehension: 4, essay: 10 };
const LIGHT_OTHER_MINUTES = 3;
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

function minutesOf(t, light) {
  if (isObjective(t)) return OBJECTIVE_MINUTES;
  if (light) return LIGHT_MINUTES[t.id] || LIGHT_OTHER_MINUTES;
  return MINUTES[t.id] || OTHER_MINUTES;
}

function plannedMinutes(types, light) {
  return types.reduce((s, t) => s + minutesOf(t, light) * (Number(t.count) || 0), REVIEW_MINUTES);
}

/**
 * Fits the plan to LOAD_SHARE of the band's minutes without cutting a single item (the a7 ruling on
 * A5e: the a6 G7 request of 20 had been shrunk to 8). The MCQ count stays as asked; extended answers
 * become short answers one at a time while the paper is over, keeping at least one; if it is still
 * over, the paper is "light": lower marks and demand per written item (rulesBlock). The total never
 * drops; a paper still over after that prints its real, larger time (printedMinutes). A paper that
 * fits comes back as it was.
 */
function sizeTypes(types, grade) {
  const budget = Math.floor(bandOf(grade).minutes * LOAD_SHARE);
  if (plannedMinutes(types) <= budget) return { types, converted: 0, light: false };
  const out = types.map((t) => ({ ...t, count: Number(t.count) || 0 }));
  const erq = out.find((t) => t.id === 'erq');
  let converted = 0;
  if (erq && erq.count > 1) {
    let srq = out.find((t) => t.id === 'srq');
    if (!srq) {
      srq = { id: 'srq', count: 0, category: 'subjective' };
      out.splice(out.indexOf(erq), 0, srq);
    }
    while (plannedMinutes(out) > budget && erq.count > 1) {
      erq.count -= 1;
      srq.count += 1;
      converted += 1;
    }
  }
  return { types: out, converted, light: plannedMinutes(out) > budget };
}

function rulesBlock(grade, lessonTitle, opts = {}) {
  const b = bandOf(grade);
  const marks = opts.light
    ? 'MCQ 1 mark. Short answer 2 marks, answered in 1 or 2 short sentences, one point each. Extended answer 3 marks in labelled parts (a), (b), (c) of 1 mark each: never one open essay. Grammar 2 marks.'
    : 'MCQ 1 mark. Short answer 3 marks, answered in 2 to 4 short sentences. Extended answer 6 marks in labelled parts (a), (b), (c) of 2 marks each: never one open essay. Grammar 3 marks.';
  const lesson = lessonTitle
    ? `\n- The lesson is "${lessonTitle}". At least two items ask about it by name: its main idea, event, process or person, not only its vocabulary or grammar.`
    : '';
  const levels = opts.levels
    ? `\n- The level plan for this paper, by section and item number:\n${opts.levels}\n- Write each item, and each part, at the level this plan gives it, and tag it so. If what you wrote demands another level, rewrite it until it demands the planned one. A book activity or worked example reproduced counts as Remember.`
    : '';
  return `

### GRADES 6-12 RULES (Grade ${Number(grade)}; these override anything above that disagrees)
LENGTH
- Every sentence a student reads is at most ${b.sentence} words. An MCQ stem is at most ${b.mcqStem} words. Split a long stem into two short sentences, or cut the scene-setting.
MARKS AND SIZE
- ${marks}
- The paper is sat in ${b.minutes} minutes. Keep it small enough to finish, check and review in that time.
MCQ OPTIONS
- Four options of about the same length and the same grammatical form. The correct answer is NOT the longest option: if it is, shorten it or lengthen a distractor.
- Spread the correct letter across the paper: no letter for more than a third of the MCQs, never the same letter three times in a row.
- Every distractor is a misconception a Grade ${Number(grade)} student really holds, or a real mix-up of two terms from the lesson. No opposites of the key written to be obviously wrong, no jokes, no "all of the above", "none of the above", "always", "never" or "only".
- ${MEANING_RULE}
ONE FACT, ONE ITEM
- Test each fact once. No item may state, print or hint at the answer to another item, and no MCQ may give away the answer to a short answer. Check the whole paper for this before you return it.
- At least one item asks about the main subject of the lesson: its main idea, event, process or person by name.${lesson}
THINKING LEVELS
- Every item carries "blooms": Remember, Understand, Apply, Analyze, Evaluate or Create: the level it really demands, on every item, not the level you were asked for.
- An item in labelled parts also carries "part_levels": one level per part, in order (for parts (a), (b), (c): "part_levels": ["Understand", "Apply", "Create"]). Tag each part by what that part demands.
- Of the paper's marks, aim for about 30% Remember, 30% Understand, 20% Apply, 10% Analyze or Evaluate and 10% Create. Create can be one small item or one part: design, propose or write something new from the lesson. Apply means using the lesson in a new situation the book does not describe; at least one written item does that.${levels}
MARKING (every item that is not an MCQ)
- Add "marking_points": [{"point": "<what earns the mark>", "marks": <number>}], one entry per mark or part, summing exactly to the item's marks.
- ${SCHEME_RULE}
- A marking point never awards marks for something the stem already prints: if the stem names the word class, tense or form, do not award a mark for identifying it.
- In a subject other than a language, the accept line also accepts a correct answer written in Urdu or English.`;
}

/** The base system prompt with the rules block placed before the safety policies, which stay last. */
function withRules(baseSystem, safety, grade, lessonTitle, opts) {
  const block = rulesBlock(grade, lessonTitle, opts);
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

const fieldText = (v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object'
  ? `${x.point || x.descriptor || ''} (${x.marks})` : String(x))).join('; ') : String(v || ''));

/** One item as the reviewer reads it: an MCQ with its options and key, a written item with its scheme. */
function reviewItem(m) {
  const head = `Q${m.n}: ${m.question}`;
  const level = `Tagged level: ${m.blooms || 'none'}${Array.isArray(m.part_levels) && m.part_levels.length ? `; parts: ${m.part_levels.join(', ')}` : ''}`;
  if (Array.isArray(m.options)) return `${head}\n${m.options.join('\n')}\nKey: ${m.key}\n${level}`;
  return [head, `Answer: ${m.answer || ''}`, `Marking points: ${fieldText(m.marking_points)}`,
    `Bands: ${fieldText(m.mark_bands)}`, `Accept: ${fieldText(m.accept)}`, `Do not accept: ${fieldText(m.reject)}`, level].join('\n');
}

/**
 * The item review (free-secondary-review.js): every item with its key or scheme, and the reply wanted.
 * A distractor rated 1, and every yes, sends its item to the targeted rewrite.
 */
function reviewPrompt(entries, grade) {
  return [
    `You are checking the items of a Grade ${grade} paper in Pakistan before it is printed.`,
    `For each MCQ, rate every wrong option (distractor) from 1 to 3 for how likely a Grade ${grade} student who holds a common misconception about the topic is to choose it:`,
    '3 = such a student would likely choose it; 2 = some students might; 1 = no student who studied the lesson would choose it (plainly wrong, off the topic, silly, or a giveaway).',
    'Also say whether the key is the longest option or stands out from the others by its length or detail.',
    'Then answer three yes/no questions for each MCQ:',
    '- two_correct: is more than one option defensibly correct, from the lesson or from the common meaning of the words? (Exactly one option may be right.)',
    '- odd_key: is the key the odd one out of the four, for example the one positive option against three near-synonyms or three negatives?',
    '- stem_grammar: does any option fail to complete the stem grammatically, so that stem and option do not read as one sentence?',
    'For EVERY item, MCQ or written:',
    '- level_off: is the item, or each part, really at its tagged level? A book activity or worked example reproduced counts as Remember; recalling a definition is Remember however it is worded. List each item or part that is not, with the level it really demands ([] when all are right).',
    '- self_answer: does the stem contain part of its own answer (a term, a name or a phrase the answer or the key needs)?',
    'For every written item (not an MCQ):',
    '- scheme_conflict: do the accept line, the do-not-accept line and the bands contradict each other (one awards what another refuses), or does the accept line or a band accept a wrong answer?',
    'Return JSON only: {"items":[{"n":<question number>,"distractors":[{"option":"a","rating":1,"why":"..."}],"longest_key":false,"two_correct":false,"odd_key":false,"stem_grammar":false,"level_off":[{"part":"b","tagged":"Apply","really":"Remember"}],"self_answer":false,"scheme_conflict":false,"why":"<one line on any yes>"}]}',
    'For a written item leave out distractors, longest_key, two_correct, odd_key and stem_grammar. For an item not in parts, "part" is null.',
    '',
    ...entries.map(reviewItem),
  ].join('\n');
}

module.exports = { MEANING_RULE, SCHEME_RULE, LOAD_SHARE, bandOf, sizeTypes, plannedMinutes, rulesBlock, withRules, fixNote, reviewPrompt };
