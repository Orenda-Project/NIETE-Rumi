'use strict';
/**
 * Child test v3 (bd-s1oo0.50.3, lane L37) — the per-task prompts.
 *
 * Each is the prompt lane R8 measured on the May 2026 audio (golive/lanes/R8/script/tasks.py), ported
 * word for word apart from the item list, which comes from the v3 bank: LETTERS + LETTER_ROWS (R8 letters,
 * row-by-row arm), FLUENCY_SUMS (R8 blfl1, one operation per task in v3), ORAL_ITEMS (R8 idnummag, used for
 * every untimed EGMA task with its own item list), LISTENING (R8 arm "q", transcript). NUMBER_ID is new
 * (R8 had no number task); it follows FLUENCY_SUMS and adds the EGMA "hundred" rule (EGMA Toolkit pp.35–36).
 * Word lists (words, nonwords) use prompts.STORY verbatim, as story.js does.
 *
 * No prompt carries a name: item text, transcripts and audio only. "The child".
 */

const UR_NAMES = {
  'ا': 'الف', 'آ': 'الف مد', 'ب': 'بے', 'پ': 'پے', 'ت': 'تے', 'ٹ': 'ٹے', 'ث': 'ثے', 'ج': 'جیم', 'چ': 'چے',
  'ح': 'حے (بڑی حے)', 'خ': 'خے', 'د': 'دال', 'ڈ': 'ڈال', 'ذ': 'ذال', 'ر': 'رے', 'ڑ': 'ڑے', 'ز': 'زے',
  'س': 'سین', 'ش': 'شین', 'ص': 'صاد', 'ض': 'ضاد', 'ط': 'طوئے', 'ظ': 'ظوئے', 'ع': 'عین', 'غ': 'غین',
  'ف': 'فے', 'ق': 'قاف', 'ک': 'کاف', 'گ': 'گاف', 'ل': 'لام', 'م': 'میم', 'ن': 'نون', 'ں': 'نون غنہ',
  'و': 'واؤ', 'ہ': 'ہے (چھوٹی ہے)', 'ء': 'ہمزہ', 'ی': 'چھوٹی یے', 'ے': 'بڑی یے', 'ؤ': 'واؤ ہمزہ', 'ئ': 'یے ہمزہ',
};

const itemSchema = (name, extra = {}, verdicts = ['c', 'w', 'n', 's']) => ({
  name,
  schema: {
    type: 'object', additionalProperties: false, required: ['found', ...Object.keys(extra), 'items'],
    properties: {
      found: { type: 'boolean' }, ...extra,
      items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'heard', 'v', 'conf'],
        properties: { i: { type: 'integer' }, heard: { type: 'string' }, v: { type: 'string', enum: verdicts }, conf: { type: 'number' } } } },
    },
  },
});

const ROWS_SCHEMA = {
  name: 'letters_rows',
  schema: {
    type: 'object', additionalProperties: false, required: ['found', 'rows'],
    properties: {
      found: { type: 'boolean' },
      rows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['row', 'heard', 'v', 'conf'],
        properties: { row: { type: 'integer' }, heard: { type: 'string' }, v: { type: 'array', items: { type: 'string', enum: ['c', 'w', 's'] } }, conf: { type: 'number' } } } },
    },
  },
};

const LANG = { ur: 'Urdu', en: 'English' };

// ---------------------------------------------------------------- letters (R8 letters_spec, letters_r_spec)
function lettersHead({ grade, lang, n }) {
  const ur = lang === 'ur';
  const eg = ur ? ' (e.g. الف، بے، جیم; "یے" alone is acceptable for ی and ے, "ہمزہ" for ء)' : ' (upper or lower case is the same letter)';
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed ${LANG[lang]} LETTER IDENTIFICATION task of an EGRA reading test, recorded on a phone. The child names the letters on a printed card of ${n} letters, 10 per row, reading ${ur ? 'right to left' : 'left to right'} row by row, for up to 60 seconds. An adult assessor gives the instructions, may do one or two practice letters first, then says start; when the minute ends (or the child finishes) the assessor says stop. The clip may begin with the instructions and end with the start of the next task: judge only the child's timed run through this card.
Marking rules the assessor used: the child says each letter's NAME${eg}; a clear letter SOUND for that letter also counts. A self-correction counts as correct. A letter named wrongly, or passed over while the child keeps going, is WRONG. If the child stalls for about 3 seconds the assessor points to the next letter and the stalled letter is WRONG. Every position after the last letter the child reached is SKIPPED. Practice letters before the timed run do not count.
`;
}

function LETTERS({ grade, lang, items }) {
  const ur = lang === 'ur';
  const card = items.map((L, i) => `${i + 1}: ${L}${ur ? ` (${UR_NAMES[L] || L})` : ''}`).join(' ');
  return `${lettersHead({ grade, lang, n: items.length })}The printed card in reading order (position: letter${ur ? ' (its name)' : ''}):
${card}
For EVERY position 1-${items.length} return v = "c" (correct), "w" (wrong) or "s" (skipped / not reached), heard = what the child said for that letter ("" if skipped), and conf = your confidence 0-1 in that verdict. found = whether the clip contains the child naming letters from this card at all.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "letters_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}
const LETTERS_SCHEMA = itemSchema('letters', { last_attempted: { type: 'integer' }, letters_correct: { type: 'integer' } });

function LETTER_ROWS({ grade, lang, items, perRow = 10 }) {
  const ur = lang === 'ur';
  const rows = [];
  for (let r = 0; r * perRow < items.length; r += 1) {
    rows.push(`Row ${r + 1}: ${items.slice(r * perRow, (r + 1) * perRow).map((L) => (ur ? `${L}(${UR_NAMES[L] || L})` : L)).join(' ')}`);
  }
  return `${lettersHead({ grade, lang, n: items.length })}The printed card, ${rows.length} rows of ${perRow} letters (letter(name)):
${rows.join('\n')}
Work row by row. Children often pause or slip at the end of a row; keep track of which row the child is on. For EVERY row 1-${rows.length} return heard = what the child said for that row, in order ("" if the child never reached it), v = exactly ${perRow} verdicts for the row's letters in order ("c" correct, "w" wrong, "s" skipped / not reached), and conf = your confidence 0-1 in that row's verdicts. found = whether the clip contains the child naming letters from this card.
Return ONLY JSON: {"found": true, "rows": [{"row": 1, "heard": "...", "v": ["c", ...], "conf": 0.9}, ...]}`;
}

// ---------------------------------------------------------------- level-1 fluency (R8 blfl1)
const OP = { '+': { name: 'ADDITION', ur: 'جمع', en: 'plus', word: 'additions' }, '-': { name: 'SUBTRACTION', ur: 'تفریق', en: 'minus', word: 'subtractions' } };

function sumText(it) {
  if (it.prompt) return String(it.prompt).replace(/\s+/g, '');
  return `${it.a}${it.op || '+'}${it.b}`;
}

function FLUENCY_SUMS({ grade, op, items }) {
  const o = OP[op] || OP['+'];
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed EGMA ${o.name} (level 1) task with an adult assessor, recorded on a phone. The child answers ${items.length} printed ${o.word} aloud, in order, for up to 60 seconds. The child may read each sum aloud before answering ("one ${o.en} four, five" / "ایک ${o.ur} چار، پانچ") or say only the answers; numbers may be in Urdu, Punjabi or English words or digits. The assessor says start, may say "next" / "اگلا" to move the child on after a pause, and says stop when the minute ends. The clip may begin with the instructions and practice items: judge only the timed run.
The ${items.length} sums in order, with answers:
${items.map((it, i) => `${i + 1}. ${sumText(it)} = ${it.answer}`).join('\n')}
For EVERY sum 1-${items.length}: v = "c" if the child's final answer equals the answer; "w" if the child gave a different answer, said they do not know, or was moved on without answering; "s" if the child never reached it before the stop. Self-corrections count. heard = the child's answer as heard ("" if none), conf = your confidence 0-1. found = whether the clip contains this task at all.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "sums_correct": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}
const FLUENCY_SCHEMA = itemSchema('fluency', { last_attempted: { type: 'integer' }, sums_correct: { type: 'integer' } });

function NUMBER_ID({ grade, items }) {
  return `A child in a Pakistani government school (grade ${grade}) is doing the timed EGMA NUMBER IDENTIFICATION task with an adult assessor, recorded on a phone. The child reads ${items.length} printed numbers aloud, in order, for up to 60 seconds; numbers may be said in Urdu, Punjabi or English words. The assessor says start, may say "next" / "اگلا" to move the child on after a pause, and says stop when the minute ends. The clip may begin with the instructions: judge only the timed run.
Marking rules (EGMA): a number is correct only if the child says the whole number with its place value. A three-digit number must include the word "hundred" / «سو»: for 731, "seven hundred thirty-one" / «سات سو اکتیس» is correct; "seven thirty-one" / «سات اکتیس» or "seven three one" is WRONG. Reading the digits one by one is WRONG for any number of two or more digits. Self-corrections count.
The ${items.length} numbers in order:
${items.map((n, i) => `${i + 1}. ${n}`).join('\n')}
For EVERY number 1-${items.length}: v = "c" (correct), "w" (wrong, said they do not know, or moved on without answering), "s" (never reached before the stop). heard = what the child said ("" if none), conf = your confidence 0-1. found = whether the clip contains this task at all.
Return ONLY JSON: {"found": true, "last_attempted": <int>, "items": [{"i": 1, "heard": "...", "v": "c|w|s", "conf": 0.9}, ...]}`;
}
const NUMBER_ID_SCHEMA = itemSchema('number_id', { last_attempted: { type: 'integer' } });

// ---------------------------------------------------------------- untimed EGMA (R8 idnummag)
const ORAL_WHAT = {
  discrimination: 'NUMBER DISCRIMINATION task (the child says which of two numbers is bigger; the child must SAY the bigger number: pointing, or "this one", is not an answer)',
  missing: 'MISSING NUMBER task (the child says the number that goes in the blank; saying the whole sequence and then the answer is fine)',
  add2: 'ADDITION (level 2) task (harder sums shown on a card; the child may use paper and pencil)',
  sub2: 'SUBTRACTION (level 2) task (harder subtractions shown on a card; the child may use paper and pencil)',
  word_problems: 'WORD PROBLEMS task (the assessor reads each problem aloud; the child may use counters, fingers or paper)',
};

function ORAL_ITEMS({ grade, kind, questions }) {
  return `A child in a Pakistani government school (grade ${grade}) is doing the EGMA ${ORAL_WHAT[kind] || 'maths task'} with an adult assessor, recorded on a phone. The assessor shows a printed card and asks each question aloud (in Urdu, Punjabi or English); the child answers aloud. Numbers may be said in Urdu, Punjabi or English words, or as digits. The clip may begin with the end of the previous task and end with the start of the next one. The questions, in the order asked, with the correct answer:
${questions.map((q, i) => `${i + 1}. ${q.text} -> ${q.answer}`).join('\n')}
For each question judge the CHILD's final answer: v = "c" (correct), "w" (a different answer, or the child says they do not know), "n" (no audible answer from the child: silence, or the child only points), "s" (the question was never asked, e.g. the assessor stopped the task). Self-corrections count. heard = the child's answer as heard ("" if none), conf = your confidence 0-1. found = whether the clip contains this task at all.
Return ONLY JSON: {"found": true, "items": [{"i": 1, "heard": "...", "v": "c|w|n|s", "conf": 0.9}, ...]}  (i = question number 1-${questions.length} as listed)`;
}
const ORAL_SCHEMA = itemSchema('oral_items');

// ---------------------------------------------------------------- listening (R8 LISTEN_Q, transcript arm)
function LISTENING({ lang, grade, passage, questions, transcript }) {
  return `You are marking an oral LISTENING-comprehension test in ${LANG[lang]} for a grade ${grade} child in Pakistan. The assessor reads this short passage aloud to the child (the child does not read it), then asks the ${questions.length} questions below, one at a time, and the child answers aloud:
PASSAGE: ${passage}
QUESTIONS (in order), with the accepted answer:
${questions.map((q, i) => `${i + 1}. ${q.prompt} -> ${(q.accept || []).join(' / ') || '-'}`).join('\n')}
Below is a timestamped, diarised speech-to-text transcript of the assessor reading the passage, asking the questions and the child answering. Speech-to-text errors are possible; judge the meaning. A question is "c" (correct) if the child's answer conveys the accepted information in any language or wording; "w" if it is incorrect, off-topic, or the child says they do not know; "n" if the child gives no audible answer; "s" if the question was never asked. heard = the child's answer as heard, conf = your confidence 0-1. found = whether the questions are in the transcript at all.
Return ONLY JSON: {"found": true, "items": [{"i": 1, "heard": "...", "v": "c|w|n|s", "conf": 0.9}, ...]}  (i = question number 1-${questions.length})
TRANSCRIPT:
${transcript}`;
}

module.exports = {
  UR_NAMES, LETTERS, LETTERS_SCHEMA, LETTER_ROWS, ROWS_SCHEMA, FLUENCY_SUMS, FLUENCY_SCHEMA, NUMBER_ID, NUMBER_ID_SCHEMA,
  ORAL_ITEMS, ORAL_SCHEMA, ORAL_WHAT, LISTENING, sumText, itemSchema,
};
