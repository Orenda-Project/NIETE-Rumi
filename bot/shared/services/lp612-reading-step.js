'use strict';
/**
 * bd-zrdvmi.39 — ICT feedback sheet, Lesson Plan row 528: "اس میں ریڈنگ کا وقت شامل نہیں ہے"
 * (there is no reading TIME in it). bd-zrdvmi.17 put the rule in every brief; the staging code
 * then wrote a reading step for that very lesson with who/pages/what-to-look-for and no minutes.
 * A brief rule the model may skip is not a fix, so the ladder checks it here.
 *
 * A reading lesson (the three skill types below, ~520 segments) must have, BEFORE its first
 * question step, a block that is about the reading and says how many minutes. A miss is a
 * `READING_TIME:` defect in the lint vocabulary (`CODE: message`), so it buys a revision round.
 * Pure: no I/O.
 */

const READING_SKILLS = new Set(['tafheem', 'reading_comprehension', 'buland_khwani']);

/** Block types that are the lesson's question / practice steps. */
const QUESTION_TYPES = new Set(['worked_example', 'faded_example', 'practice']);

const READS = /پڑھ|\bread/i;
const NUM = '(?:\\d+|[۰-۹]+|[٠-٩]+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty'
  + '|ایک|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|دس|بارہ|پندرہ|بیس)';
const MINUTES = new RegExp(`(?:^|[^\\p{L}])${NUM}(?:\\s*(?:-|–|تا|to)\\s*${NUM})?\\s*(?:منٹ|min)`, 'iu');

/** Every string inside a block, joined. */
function textOf(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => textOf(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => textOf(n, out));
  return out.join(' ');
}

const timed = (b) => (typeof b.minutes === 'number' && b.minutes > 0) || MINUTES.test(textOf(b));

/**
 * @param {object} doc        the lp_doc
 * @param {string} skillType  the segment's skill_type
 * @returns {string[]} zero or one `READING_TIME: …` defect
 */
function readingStepDefects(doc, skillType) {
  if (!READING_SKILLS.has(skillType) || !doc || !Array.isArray(doc.sections)) return [];
  for (const sec of doc.sections) {
    for (const b of sec.blocks || []) {
      if (!b || typeof b !== 'object') continue;
      if (READS.test(textOf(b)) && timed(b)) return [];
      if (QUESTION_TYPES.has(b.type)) {
        return [`READING_TIME: this is a reading lesson (${skillType}). Before the first question step, give the `
          + 'reading its own step that states the minutes (for example "پڑھائی (۸ منٹ)" / "Reading (8 minutes)"), '
          + 'who reads (teacher models, then pupils), which pages, and one thing pupils look for while reading.'];
      }
    }
  }
  return [`READING_TIME: this is a reading lesson (${skillType}) and it has no timed reading step before the questions.`];
}

module.exports = { READING_SKILLS, readingStepDefects };
