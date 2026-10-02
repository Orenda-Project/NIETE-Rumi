'use strict';

/**
 * FICO ICT — the 17 indicators the impact team's workbook defines (Sections C, D and F), as the
 * coach meets them in /observe2. Plain words only: the coach never sees a code such as C1.
 *
 * - MOMENTS groups the 17 into four moments every lesson has; Rumi's findings after the seal are
 *   shown in this order.
 * - PLAIN gives each indicator's four levels as short phrases read off the workbook descriptors,
 *   each within WhatsApp's 30-code-point option-title cap.
 * - ROW is the indicator's plain name; PRIORITY is how it reads as "work on first".
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

module.exports = { CODES, CORE, MOMENTS, PLAIN, EXTRA, ROW, PRIORITY };
