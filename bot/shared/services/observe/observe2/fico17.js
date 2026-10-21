'use strict';

/**
 * FICO ICT — the 17 indicators the impact team's workbook defines (Sections C, D and F), as the
 * coach meets them in /observe2. Plain words only: the coach never sees a code such as C1.
 *
 * - MOMENTS groups the 17 into four moments every lesson has; Rumi's findings after the seal are
 *   shown in this order.
 * - PLAIN gives each indicator's four levels as short phrases read off the workbook descriptors,
 *   each within WhatsApp's 30-code-point option-title cap.
 * - ROW is the indicator's plain name; PRIORITY is how it reads as "work on first"; FOCUS adds the
 *   lesson plan's steps to those choices (Section B, R14).
 */

const CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'D1', 'D2', 'D3', 'D4', 'D5', 'F1', 'F2', 'F3', 'F4'];

const CORE = ['C1', 'C2', 'C6', 'D1', 'D2'];

const MOMENTS = [
  { id: 'ask', name: 'Asking', question: 'When the teacher asks, who answers, and how?', codes: ['C1', 'C3', 'D1', 'D2', 'D5'] },
  { id: 'wrong', name: 'Wrong answers', question: 'When a child gets it wrong, what happens next?', codes: ['C2', 'C6', 'D4'] },
  { id: 'work', name: 'Working', question: 'When children work, what do they do?', codes: ['C4', 'C5', 'C7', 'C8', 'D3'] },
  { id: 'explain', name: 'Explaining', question: 'How well does the teacher explain?', codes: ['F1', 'F2', 'F3', 'F4'] },
];

const PLAIN = {
  C1: ['No real questions asked', 'Yes/no or chorus answers only', 'Open questions, one child each', "Plus a 'why' and a follow-up"],
  C2: ['Wrong answers ignored', 'Marked wrong, little reason', 'Explained why, twice or more', 'Child fixed it; new way shown'],
  C3: ['Only raised hands answered', 'A quiet child picked once', 'Quiet children picked often', 'Varied ways, silent child in'],
  C4: ['Teacher decided everything', 'Choices on small things only', 'A real choice, acted on', 'Children led part of it'],
  C5: ['Took long, no clear signal', 'Signal given, but took long', 'Changed within a minute', 'Children knew what came next'],
  C6: ['Flat or dismissive', 'Praise only for right answers', 'Praised effort, 2+ times', 'Mistakes used, disagreement OK'],
  C7: ['No pair or group task', 'Sat together, worked alone', 'Made one thing together', 'Had roles and reported back'],
  C8: ['None used, though needed', 'Only the teacher used them', 'Children used them', 'Children explained with them'],
  D1: ['One-word answers only', 'Longer answers, no reasoning', '2+ children explained why', 'A child went beyond the ask'],
  D2: ['1-2 children, or none', '3 to 5 children', '6+ across the lesson', '6+, and new voices later'],
  D3: ['No child spoke to another', 'Spoke, but no one replied', 'Replied to each other 2+ times', 'Disagreed, then agreed'],
  D4: ['No one tried', 'Tried only when sure', '2+ tried while unsure', 'Tried unasked, kept going'],
  D5: ['No child asked anything', "Only 'which page' questions", 'A question about the content', '2+, one beyond the lesson'],
  F1: ['Wrong content left standing', 'A slip not corrected', 'All accurate', 'Accurate, misconceptions met'],
  F2: ['Everyday words only', 'Terms used, not explained', 'Terms used and defined', 'Children made to use them'],
  F3: ["'Do it this way' only", 'Some why, mostly memorising', 'Explained why it works', 'Children reasoned it out'],
  F4: ['No links to life or subjects', 'Link mentioned, not explained', 'Link explained clearly', 'Children made their own links'],
};

const EXTRA = [['NA', 'N/A · No chance to see it'], ['IE', "IE · Couldn't tell"]];

const ROW = {
  C1: "The teacher's questions", C2: 'When an answer was wrong', C3: 'Who got to answer',
  C4: "Children's choices", C5: 'Switching activities', C6: 'Safe to be wrong', C7: 'Group work',
  C8: 'Books and materials', D1: "Children's reasoning", D2: 'How many children spoke',
  D3: 'Children answering each other', D4: 'Trying when unsure', D5: "Children's own questions",
  F1: 'Accuracy of content', F2: 'Subject words', F3: 'Explaining why', F4: 'Links to real life',
};

const PRIORITY = {
  C1: 'Questions that make them think', C2: 'Helping when a child is wrong', C3: 'Picking quiet children too',
  C4: 'Giving children real choices', C5: 'Smooth switches of activity', C6: 'Making it safe to be wrong',
  C7: 'Real group work', C8: 'Children using materials', D1: 'Children explaining why',
  D2: 'More children speaking', D3: 'Children talking to each other', D4: 'Children trying when unsure',
  D5: 'Children asking questions', F1: 'Getting the content right', F2: 'Using subject words',
  F3: 'Explaining why it works', F4: 'Linking to real life',
};

// Thinking (FICO pilot sheet R16, the ICT lead, 14 Oct: critical thinking was not explicit). No new scored
// indicator: six of the 17 already score it, by the workbook's descriptors. What the teacher does: C1
// (a question needing reasoning, probed), F3 (why it works; children reason it out), F4 (links;
// children make their own). What the children do: D1 (reasoning, not restating), D4 (trying when
// unsure), D5 (their own content questions). Grouped under this name where the coach and the record
// read them; the sections and their sums are unchanged.
const THINKING = { name: 'Thinking', teacher: ['C1', 'F3', 'F4'], children: ['D1', 'D4', 'D5'] };
THINKING.codes = [...THINKING.teacher, ...THINKING.children];

// "Work on first" may also be the lesson plan's own steps (FICO pilot sheet R14, the ICT lead, 14 Oct:
// "Follow the Lesson Plan Structure" was missing). That is Section B, the plan fidelity, not a C, D
// or F indicator, so its id is no code and nothing reads it as one (analysis.js, brief.js and the
// target resolver handle it by name). Its title fits the 30-code-point option cap.
const PLAN_FOCUS = 'plan';

// Coaching focus areas (FICO pilot sheet R20 and R21, two coaches, 16 Oct): what coaches coach on that no
// one of the 17 names. Like the plan's steps they are not scored: no level, no section sum, no V4 bars. Each
// id is no code, and every reader asks isCoachingFocus before reading a pick as an indicator. What the brief
// shows for each (what was seen, the next step) is in focus-areas.js and strings.js.
//   wait    C1 L1 is the rubric's own line on it: "provides the answer immediately without pausing".
//   manage  the workbook names C5 "Classroom Management", but the live form scores only its switch half,
//           so this is a focus of its own whose "what you saw" reads C5's level.
//   rules   C5 L4: "states or signals the expectation before it's needed".
//   warmup, close   the 5-step plan's first and last steps, coachable with or without a plan.
const COACHING_FOCUS = {
  wait: 'Wait time after a question',
  manage: 'Classroom management',
  rules: 'Classroom rules',
  warmup: 'An engaging warm-up',
  close: 'Effective lesson closure',
};
const FOCUS = { ...PRIORITY, [PLAN_FOCUS]: "Following the plan's steps", ...COACHING_FOCUS };
// The picks with no C, D or F row: the plan's steps and the coaching focus areas.
const NOT_SCORED = [PLAN_FOCUS, ...Object.keys(COACHING_FOCUS)];
const isCoachingFocus = (id) => Object.prototype.hasOwnProperty.call(COACHING_FOCUS, String(id || ''));
// The FICO section a non-scored pick is told under, in the report narrative's prompt only (it is a label
// there, never a score). The plan is Section B. The others are teaching practices, never Section B: the
// narrative drops a Section B target when the recording is a different lesson from the plan, and a warm-up
// or a closure can be coached without one.
const FOCUS_DOMAIN = {
  [PLAN_FOCUS]: 'lesson_plan_fidelity',
  ...Object.fromEntries(Object.keys(COACHING_FOCUS).map((id) => [id, 'high_leverage_practices'])),
};
// The line under a choice in the lists, where the title alone was not recognised (R20, R21: "Classroom
// Structure / LP Fidelity", "Following the 5-step Lesson Plan", "Assigning and managing group work"), or
// where two choices sit close (switches and classroom management). Within the 300-code-point cap.
const FOCUS_DESCRIPTION = {
  [PLAN_FOCUS]: 'The whole 5-step lesson plan: warm-up, explanation, guided practice, independent practice and wrap-up. Lesson plan fidelity and classroom structure.',
  C7: 'Assigning and managing group work: a task the group must do together, with roles and a report back.',
  C5: 'Moving from one activity to the next quickly, with a clear signal.',
  wait: 'Giving children a few seconds to think after a question, before anyone answers.',
  manage: 'Routines for attention and for switching tasks, discipline, and a calm room ready to learn.',
  rules: 'Setting class rules with the children and making sure every child knows them.',
  warmup: "A short opening activity that gets every child thinking and links to today's topic.",
  close: 'Ending well: the children recap what they learned and the teacher checks it, e.g. with an exit ticket.',
};
// The list follows the four moments, so related choices sit together: wait time after the asking ones,
// classroom management and rules after switches (C5). The lesson's structure comes last: the plan's steps,
// then its first and last step.
const BESIDE = { D5: ['wait'], C5: ['manage', 'rules'] };
const FOCUS_ORDER = [...MOMENTS.flatMap((m) => m.codes).flatMap((c) => [c, ...(BESIDE[c] || [])]), PLAN_FOCUS, 'warmup', 'close'];

// Up to two more beside the first pick, optional. "Nothing else" lets a coach undo a pick: a
// WhatsApp Dropdown cannot be cleared once chosen.
const ALSO_NONE = 'none';
const MAX_ALSO = 2;

/** The "also work on" picks as kept: known choices, none repeated, never the first pick, at most two. */
function pickAlso(ids, first) {
  const out = [];
  for (const id of ids || []) {
    const v = String(id || '');
    if (!FOCUS[v] || v === first || out.includes(v)) continue;
    out.push(v);
  }
  return out.slice(0, MAX_ALSO);
}

module.exports = {
  CODES, CORE, MOMENTS, PLAIN, EXTRA, ROW, PRIORITY, THINKING,
  PLAN_FOCUS, COACHING_FOCUS, NOT_SCORED, isCoachingFocus, FOCUS_DOMAIN, FOCUS, FOCUS_DESCRIPTION, FOCUS_ORDER,
  ALSO_NONE, MAX_ALSO, pickAlso,
};
