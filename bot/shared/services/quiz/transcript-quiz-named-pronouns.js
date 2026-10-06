'use strict';
/**
 * A PRONOUN THAT BELONGS TO A NAMED CHARACTER (quiz_author_gates_v2).
 *
 * The teacher's gender is not a fact this system holds, so the pipeline strips
 * it from the lesson plan (lp-quiz-digest degender) and flags it in a question
 * (transcript-quiz-pedagogy PEDAGOGY_GENDERED_TEACHER). Both did it to EVERY
 * English pronoun, so the plan's "Ahmed WAS WRITING his letter" reached the
 * author as "their letter", and "Zainab has Rs. 452. She spends…" was flagged as
 * the teacher and "repaired" into "The teacher spends…". The rule is for the
 * teacher and the child being addressed — never for a named character in the
 * content.
 *
 * A pronoun is the named character's when a person's name comes before it in
 * the SAME sentence: a capitalised word that is not one of the words a sentence
 * of teacher prose starts with ("She says…", "Ask her…", "The teacher…"). A
 * pronoun with no name before it in its sentence is left to the teacher rule.
 */

// Capitalised words that are not a person's name at the head of (or inside) a sentence of plan or quiz prose.
const NOT_A_NAME = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'then', 'now', 'next', 'first', 'after', 'before', 'when', 'while', 'if',
  'ask', 'say', 'says', 'tell', 'write', 'read', 'look', 'show', 'let', 'point', 'draw', 'count', 'use', 'give', 'take', 'put',
  'make', 'have', 'do', 'remind', 'model', 'explain', 'discuss', 'invite', 'call', 'pick', 'hold', 'note', 'step', 'check',
  'it', 'they', 'we', 'you', 'i', 'he', 'she', 'her', 'his', 'him', 'our', 'your', 'their', 'there', 'here',
  'teacher', 'teachers', 'class', 'students', 'student', 'children', 'child', 'pupils', 'learners', 'everyone', 'each', 'every',
  'some', 'many', 'one', 'two', 'three', 'what', 'which', 'who', 'why', 'how', 'where', 'yes', 'no', 'good', 'great', 'well',
  'example', 'answer', 'question', 'problem', 'practice', 'homework', 'today', 'yesterday', 'tomorrow', 'in', 'on', 'at', 'for',
  'with', 'by', 'from', 'to', 'of', 'and', 'or', 'but', 'so', 'is', 'are', 'was', 'were', 'can', 'will', 'should', 'must',
  'english', 'urdu', 'maths', 'science', 'pakistan', 'islamabad', 'earth', 'sun', 'moon', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam',
]);
const SENTENCE_END = /[.!?\n]/;

/**
 * Is the pronoun at `index` in `text` preceded by a person's name — in its own sentence, or
 * (`lookback: 1`) in the sentence before it, as a word problem goes: "Bunty has 20 toys. He lifts
 * 7 onto the shelf." The plan text keeps the default (same sentence): there, "Ask Ali to read. She
 * praises him." is the teacher.
 */
function namedAntecedent(text, index, { lookback = 0 } = {}) {
  const s = String(text ?? '');
  let start = 0;
  let ends = 0;
  for (let k = index - 1; k >= 0; k -= 1) {
    if (SENTENCE_END.test(s[k])) {
      if (ends === lookback) { start = k + 1; break; }
      ends += 1;
    }
  }
  const before = s.slice(start, index);
  const caps = before.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  return caps.some((w) => !NOT_A_NAME.has(w.toLowerCase()));
}

module.exports = { namedAntecedent };
