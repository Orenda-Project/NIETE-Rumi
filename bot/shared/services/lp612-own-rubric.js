'use strict';
/**
 * bd-snkn32.46 — the rubric the own-plan reviewer reads (pure: no I/O beyond requiring a data file).
 *
 * The data (`../data/lp-own-rubric-v3.json`) is the lesson-plan reviewer rubric v3 vendored as-is: each check's id,
 * name, requirement and 1-4 descriptors, for the 42 universal checks (criteria 0-7) and each subject's own checks
 * (criterion 8 + research 9). It was generated from reviewer_rubric_v3.py with RUBRIC_DELTAS B1 applied (ICT period
 * 25-40 min); the generator lives in the bd-snkn32.46 work folder. Before this, the model saw check NAMES only and
 * rated almost everything 3 (≈73%), so plans that passed the production gate at 92-99 failed here.
 *
 * ICT_RULES are the rules the production ICT plans were built to, so the reviewer does not mark a plan down for
 * following them (peer talk, period length, warm-up, book text).
 */
const RUBRIC = require('../data/lp-own-rubric-v3.json');

/** Plan subject → rubric subject key; anything unknown gets the universal checks only. */
const ALIASES = [
  [/^(eng|english)/, 'ENGLISH'], [/^urdu/, 'URDU'], [/^math/, 'MATHS'],
  [/^((general )?science|physics|chemistry|biology)/, 'SCIENCE'],
  [/^(sst|social|history|geography|pakistan studies|civics)/, 'SST'],
  [/^(gk|general knowledge|general_knowledge|generalknowledge)$/, 'GK'], [/^islamiy?at/, 'ISLAMIAT'],
];

/** Pure: the rubric subject of a plan (K5 slide script meta.subject, or 6-12 provenance.subject), else null. */
function subjectOf(plan) {
  let obj = plan;
  if (typeof plan === 'string') {
    try { obj = JSON.parse(plan); } catch { return null; }
  }
  const raw = obj && ((obj.meta && obj.meta.subject) || (obj.provenance && obj.provenance.subject) || obj.subject);
  const s = String(raw || '').toLowerCase().replace(/_/g, ' ').trim();
  if (!s) return null;
  const hit = ALIASES.find(([re]) => re.test(s) || re.test(s.replace(/ /g, '_')));
  return hit ? hit[1] : null;
}

/** The checks for a subject: the universal 42, then that subject's 8x/9x. */
function checksFor(subject) {
  return [...RUBRIC.universal, ...((subject && RUBRIC.subjects[subject]) || [])];
}

/** Every id the model may return for any subject (parseReview keeps only these). */
const ALL_IDS = new Set([...RUBRIC.universal, ...Object.values(RUBRIC.subjects).flat()].map((c) => c.id));

/** Checks whose ICT design makes them unratable: scripted child-to-child exchanges (ICT allows one framed turn). */
const ICT_NOT_ASSESSABLE = ['9E', '9F'];
/** Book text is never given to the reviewer, so 1D (aligned with textbook content) cannot be judged in either band. */
const NO_BOOK_TEXT = ['1D'];

const ICT_RULES = [
  'ICT RULES. These plans are for Islamabad Capital Territory (ICT) government schools. Do not mark a plan down for '
    + 'following these rules:',
  '- Period length: one ICT class period is 25-40 minutes in total. Use that range for 0F and 3A.',
  '- Peer talk (5B): ICT plans have no peer talk in the warm-up or You Do, by design; warm-ups are choral (the whole '
    + 'class answers together). At most one framed neighbour turn in We Do is allowed. So rate 5B like this: one '
    + 'framed neighbour turn in We Do with the words given = 3 (4 if the teacher also hears and uses what pairs said); '
    + 'pair or group talk placed in the warm-up or You Do = 2; no peer talk at all = null (by ICT design, not a gap).',
  '- Warm-up (2L): judge it from the warm-up itself. A choral recall counts as peer-mediated. Linked to earlier '
    + 'learning (a prior lesson, skill or words the class already met) is enough for the prior-SLO link.',
  '- 9E and 9F (scripted pair exchanges) and 1D (alignment with book text, which you are not given): rate null.',
  '- Subject checks whose own requirement says they apply only to one lesson type (e.g. phonics, fluency, dictation): '
    + 'rate null when this lesson is not that type.',
].join('\n');

/** The rubric as the model reads it: one block per check, requirement then the four levels. */
function rubricText(subject) {
  return checksFor(subject).map((c) => `${c.id} ${c.name}\n  Requirement: ${c.req}\n`
    + c.d.map((t, i) => `  ${i + 1}: ${t}`).join('\n')).join('\n');
}

module.exports = { subjectOf, checksFor, rubricText, ALL_IDS, ICT_RULES, ICT_NOT_ASSESSABLE, NO_BOOK_TEXT, RUBRIC };
