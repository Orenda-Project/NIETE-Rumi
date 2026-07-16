'use strict';
/**
 * Assessment Question-Type Config.
 *
 * Returns the list of question types applicable for a given
 * {subject, grade, objectiveOrSubjective} triple.
 *
 * DEVIATION NOTE (2026-07-16, bd-2033):
 * Umama's spec listed a fuller catalogue — MCQs, MSQs, Fill-in-Blanks, T/F,
 * Match-the-Column, Brief, Word Problems, Comprehension Passage. The upstream
 * UG_EG microservice (`assessment-generator-client.service.js`) currently only
 * accepts three type IDs: `MCQs`, `Fill in the Blanks`, `Brief Answers`.
 *
 * Rather than expose types in the Flow that the upstream would then reject,
 * we (a) offer the *supported* subset today, (b) still partition per subject
 * so the list stays relevant (e.g. Maths hides `Comprehension Passage`),
 * (c) keep the full catalogue in `FULL_CATALOGUE` so we can turn types on
 * as UG_EG accepts them without touching this file's shape.
 *
 * When UG_EG adds a new type, also update:
 *   - `OBJECTIVE_TYPES` / `SUBJECTIVE_TYPES` in `assessment-generator-client.service.js`
 *   - remove the type from `NOT_YET_SUPPORTED_BY_UPSTREAM` below
 */

// The full catalogue Umama asked for. `supported: false` types are hidden
// today but flip to `true` when UG_EG accepts them.
const FULL_CATALOGUE = {
  MCQs:                     { title: 'MCQs',                     category: 'objective',  supported: true  },
  'Fill in the Blanks':     { title: 'Fill in the Blanks',       category: 'objective',  supported: true  },
  MSQs:                     { title: 'MSQs',                     category: 'objective',  supported: false },
  'True/False':             { title: 'True / False',             category: 'objective',  supported: false },
  'Match the Column':       { title: 'Match the Column',         category: 'objective',  supported: false },
  'Brief Answers':          { title: 'Brief Answers',            category: 'subjective', supported: true  },
  'Word Problems':          { title: 'Word Problems',            category: 'subjective', supported: false },
  'Comprehension Passage':  { title: 'Comprehension Passage',    category: 'subjective', supported: false },
};

// Which types are relevant for each subject. Absence = universal.
// Grades 1-5 use the same catalogue today (Umama's brief did not gate by
// grade, only by subject + objective/subjective).
const SUBJECT_RELEVANCE = {
  Eng:      ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Brief Answers', 'Comprehension Passage'],
  Urdu:     ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Brief Answers', 'Comprehension Passage'],
  Maths:    ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Brief Answers', 'Word Problems'],
  Science:  ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Brief Answers'],
  Islamiat: ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Brief Answers'],
  SST:      ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Brief Answers'],
  GenK:     ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Brief Answers'],
};

const DEFAULT_COUNT_PER_TYPE = 3;
const MAX_COUNT_PER_TYPE = 20;

/**
 * Return the list of `{ id, title }` for the checkbox group,
 * partitioned by {subject, category}. Only `supported: true` types
 * are returned today.
 *
 * @param {object} args
 * @param {string} args.subject           e.g. 'Eng', 'Maths'
 * @param {string|number} args.grade      1..5 (currently unused for gating)
 * @param {'objective'|'subjective'} args.category
 * @returns {Array<{id: string, title: string}>}
 */
function getQuestionTypes({ subject, grade, category }) {
  if (!['objective', 'subjective'].includes(category)) return [];
  const relevantIds = SUBJECT_RELEVANCE[subject] || Object.keys(FULL_CATALOGUE);
  const out = [];
  for (const id of relevantIds) {
    const meta = FULL_CATALOGUE[id];
    if (!meta) continue;
    if (meta.category !== category) continue;
    if (!meta.supported) continue;
    out.push({ id, title: meta.title });
  }
  return out;
}

function isSupported(id) {
  const meta = FULL_CATALOGUE[id];
  return Boolean(meta && meta.supported);
}

module.exports = {
  getQuestionTypes,
  isSupported,
  DEFAULT_COUNT_PER_TYPE,
  MAX_COUNT_PER_TYPE,
  // exposed for tests / diagnostics
  _internal: { FULL_CATALOGUE, SUBJECT_RELEVANCE },
};
