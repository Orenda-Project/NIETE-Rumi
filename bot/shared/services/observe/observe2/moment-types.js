'use strict';

/**
 * /observe2 — the moment types: the label the check shows for each, and the definitions the model reads.
 *
 * One home for both, so the moments prompt (moments.js) and the label check (label-check.js) judge a
 * moment by the same words (bd-eal7zn.8). rules.js reads the type names; changing one changes the levels.
 */

// Type → the short label the check shows after the minute ("12:41 · open question"); each fits the
// 30-code-point radio label with the minute in front.
const TYPES = {
  ask: {
    open_q_one: 'open question', open_q_choral: 'answered in chorus', probe: "'why' follow-up",
    reasoning: 'child explained why', long_answer: 'longer answer', beyond: 'went beyond the ask',
    content_q: "child's own question", proc_q: "'which page' question", beyond_q: 'question beyond lesson',
  },
  wrong: {
    wrong_reason: 'reason for the error', wrong_fixed: 'child fixed it', wrong_ignored: 'wrong answer left',
    strategy: 'tried a new way', praise_effort: 'praise for effort', praise_generic: "'well done' only",
    mistake_useful: 'mistake put to use', disagree: 'disagreement welcomed', hedged: 'tried while unsure',
    unprompted: 'tried without asking',
  },
  work: { choice: 'a real choice', handover: 'children led a part' },
  explain: {
    content_error: 'content error', term_defined: 'word explained', why_explained: 'why it works',
    life_link: 'link to real life',
  },
};
const GROUPS = Object.keys(TYPES);
const GROUP_OF = Object.fromEntries(GROUPS.flatMap((g) => Object.keys(TYPES[g]).map((t) => [t, g])));

// The type definitions, one line per prompt line, as the moments prompt has carried them since v2.
const TYPE_GUIDE = [
  'ASKING — the teacher\'s questions, the children\'s answers and questions:',
  '- open_q_one: the teacher asks a question with more than one good answer (why, how, what do you think, give an',
  '  example, make a sentence) and one child answers. "What is a noun?", "how many?", "which is bigger?", "what did',
  '  we read yesterday?" have one right answer: they are NOT open.',
  '  TEST: could two children give two different answers that are both right? If not, it is closed:',
  '  do not pick it as a moment; count it in closed_q. Most questions in these lessons are closed.',
  '- open_q_choral: the same kind of open question, answered by the class together',
  '- probe: right after a child\'s answer, the teacher asks that child (or the class) why or how ("why do you think',
  '  so?", "how did you find it?"). A new question, a question the teacher answers, or "understood?" is NOT a probe.',
  '- reasoning: a child gives a reason ("because ...") in their own words',
  '- long_answer: a child answers in a full sentence of their own, without a reason. Reading from the book or the',
  '  board is NOT an answer.',
  '- beyond: a child goes beyond what was asked with a link or example of their own',
  '- content_q: a child asks a question about the content',
  '- proc_q: a child asks only about procedure ("which page?", "in the copy?")',
  '- beyond_q: a child asks a question that goes beyond the lesson',
  '',
  'WRONG ANSWERS — what happens when a child is wrong, and how safe it is to be wrong:',
  '- wrong_reason: after a child\'s wrong answer, the teacher explains why it is wrong',
  '- wrong_fixed: a child corrects their own wrong answer (quote the wrong answer — the correction)',
  '- wrong_ignored: a wrong answer is passed over with no reason ("no, anyone else?")',
  '- strategy: after a wrong answer, the teacher tries a new way (an example, a picture, a simpler question).',
  '  Moving on to the next exercise is NOT a strategy.',
  '- praise_effort: specific praise for effort or thinking ("you checked your work and found the mistake")',
  '- praise_generic: general praise ("good", "shabash", "well done")',
  '- mistake_useful: the teacher uses a child\'s mistake to teach the class',
  '- disagree: the teacher welcomes a child disagreeing',
  '- hedged: a child answers while openly unsure ("maybe", "I think", "shayad")',
  '- unprompted: a child tries without being asked, or keeps trying after a wrong answer',
  '',
  'WORKING — while the children work:',
  '- choice: the children decide something that matters (which task, how to show their work, who to work with)',
  '  and act on it. An instruction to work in pairs or groups is NOT a choice; picking which of two words to say',
  '  is NOT a real choice.',
  '- handover: a child runs part of the lesson: leads the class, asks the class questions, explains to the class,',
  '  leads a group\'s report. Answering, reading aloud or writing on the board when called is NOT a handover.',
  '  TEST: is a child doing the teacher\'s job for the whole class? A child doing the task they were given is not.',
  '',
  'EXPLAINING — the teacher\'s content:',
  '- content_error: the teacher says something factually wrong and it is not corrected',
  '- term_defined: the teacher explains or defines a subject word (not only names it)',
  '- why_explained: the teacher explains why a method or fact works, not only how. A moral lesson or a plain',
  '  definition is NOT this.',
  '  TEST: does the teacher give the reason ("because", "so that", "that is why") about the content?',
  '  The steps of a method, a definition or a general remark are not a reason.',
  '- life_link: the teacher links the content to the children\'s daily life or to another subject. The story in',
  '  the lesson, a moral or a memory trick is NOT a life link.',
];

module.exports = { TYPES, GROUPS, GROUP_OF, TYPE_GUIDE };
