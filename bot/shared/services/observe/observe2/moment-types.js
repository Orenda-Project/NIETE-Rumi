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

// ---------------------------------------------------------------- FICO17 v6 (bd-qix9oh.64)
// A v6 visit (rubric 'fico17_v6') reads prompt v3: the v5 types with their labels, plus the spec §8.2 types
// and the F2/F4 types the v6 rules count (CONTRACTS §4.1). Every new label is at most 22 code points, so the
// minute fits in front of it ("12:41 · ") within 30. v5 visits never see these.
const TYPES_V6 = {
  ...TYPES,
  explain: {
    ...TYPES.explain,
    resource_shown: 'resource only shown', resource_used: 'children used resource',
    // §8.2 gives 'child explained with it', 23 code points: one over its own cap.
    resource_explained: 'child explains with it', why_handed: 'why handed to children',
    child_builds_link: 'child built on link', link_mentioned: 'link only mentioned',
    term_not_explained: 'term not explained', child_used_term: 'child used the term',
  },
};
const GROUP_OF_V6 = Object.fromEntries(GROUPS.flatMap((g) => Object.keys(TYPES_V6[g]).map((t) => [t, g])));

// The v2 definitions, with the spec §8.1 lines in place of the old ones for probe, reasoning, long_answer,
// beyond, choice and life_link, D5's "not a question" sentence after content_q, and the new types at the end
// of EXPLAINING. Spec text is kept on one line each, word for word.
const V3_LINES = {
  probe: ["- probe: the teacher asks a why or how-do-you-know question about the same child's answer they just gave. A new question to the class, or to another child, does not count."],
  reasoning: ["- reasoning: a child gives reasoning in their own words: says why, compares two things, uses a rule on a new case, or explains a choice. Finishing the teacher's sentence, or repeating a reason the teacher already gave, is long_answer, not reasoning."],
  long_answer: ["- long_answer: a child gives an answer longer than a phrase that only repeats what was said or read, or finishes the teacher's sentence"],
  beyond: ['- beyond: a child gives their own example, or links the idea to something else, that the teacher did not say first'],
  content_q: [
    '- content_q: a child asks a question about the content',
    '  Not a question: asking permission ("May I answer?"), asking for a repeat ("Say it again", "Sorry, what?"), repeating the teacher\'s question ("Why?"), or an unsure answer ("Is it twelve?").',
  ],
  choice: ["- choice: the children get a real choice about how to do the work or how to explain it, and are allowed to follow it; or the teacher takes up a child's idea and the lesson follows it"],
  life_link: [
    '- life_link: the teacher explains a link to daily life, another subject, or an earlier lesson',
    '- link_mentioned: the teacher mentions a link to daily life, another subject or an earlier lesson without explaining it',
    '- child_builds_link: a child adds to, asks about, or explains in their own words a link the teacher made',
    '  A child\'s own new link, one the teacher did not make first, is beyond, not child_builds_link.',
    '- term_not_explained: the teacher uses a subject word without explaining it, or uses different words for the same thing',
    '- child_used_term: a child uses a subject word in their own answer, or the teacher has the children say it',
    '- resource_shown: the teacher names a book, the board, a chart, or an object only to show or tell, and does not ask children to use it',
    '- resource_used: the teacher asks the children to use a book, the board, or an object themselves, and says how it connects to the idea',
    '- resource_explained: the teacher asks a child to explain using a book, chart or object, and builds on what the child says',
    "- why_handed: the teacher turns a child's question into a short lesson that goes further, or asks the children to give the reason why a rule or step works",
  ],
};
const TYPE_GUIDE_V3 = (() => {
  const out = [];
  let skip = false;
  for (const line of TYPE_GUIDE) {
    const head = /^- (\w+):/.exec(line);
    if (head) skip = Boolean(V3_LINES[head[1]]);
    else if (!line.startsWith('  ')) skip = false;
    if (head && V3_LINES[head[1]]) out.push(...V3_LINES[head[1]]);
    else if (!skip) out.push(line);
  }
  return out;
})();

// Room evidence (CONTRACTS §4.3, spec §5.6): what the transcript shows for four of the six indicators the
// coach sets on v6. No confirm screen and no rule: the COMBINED screens show it. D4 uses hedged/unprompted.
const ROOM_KINDS = {
  C3: ['name_called', 'pair_talk', 'everyone_write', 'random_pick'],
  C5: ['signal'],
  C7: ['pairs_or_groups', 'shared_task', 'product', 'roles', 'report_back'],
  D3: ['child_agrees_or_adds', 'second_child_named_to_agree'],
};

const isV6Rubric = (rubric) => rubric === 'fico17_v6';
/** The types (by group) a visit on this rubric reads: 'fico17' (v5) or 'fico17_v6'. */
const typesFor = (rubric) => (isV6Rubric(rubric) ? TYPES_V6 : TYPES);
const groupOfFor = (rubric) => (isV6Rubric(rubric) ? GROUP_OF_V6 : GROUP_OF);
/** The type definitions the prompts carry for this rubric. */
const guideFor = (rubric) => (isV6Rubric(rubric) ? TYPE_GUIDE_V3 : TYPE_GUIDE);

module.exports = {
  TYPES, GROUPS, GROUP_OF, TYPE_GUIDE,
  TYPES_V6, GROUP_OF_V6, TYPE_GUIDE_V3, ROOM_KINDS, typesFor, groupOfFor, guideFor,
};
