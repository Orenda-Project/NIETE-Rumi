'use strict';
/**
 * Assessment Question-Type Config.
 *
 * Returns the list of question types applicable for a given
 * {subject, grade, category} triple.
 *
 * Source of truth: `docs/question-types-ict.md` in Orenda-Project/UG_EG.
 * Every type below appears there; category (objective vs subjective) is
 * per-subject (e.g. "Brief Answers" is OBJECTIVE for Eng/Urdu but SUBJECTIVE
 * for Science). Grade gating mirrors the doc's per-subject grade bands.
 *
 * When UG_EG adds a new type, add it here AND to the client service's
 * `OBJECTIVE_TYPES` / `SUBJECTIVE_TYPES` sets in
 * `assessment-generator-client.service.js` (otherwise the client silently
 * drops it when partitioning by category).
 */

// Per-subject { objective: [...ids], subjective: [...ids] } lifted directly
// from docs/question-types-ict.md. When a subject splits subjective types by
// grade band (Eng/Urdu do), we use `subjectiveByGrade: { '1-2': [...], '3-5': [...] }`.
const SUBJECT_CONFIG = {
  Eng: {
    objective: [
      'MCQs', 'MSQs', 'Fill in the Blanks', 'Missing Letters', 'True/False',
      'Match the Column', 'Circle the Correct Answer', 'Rewrite Sentences',
      'Brief Answers', 'Listening', 'Speaking', 'Reading',
    ],
    subjectiveByGrade: {
      '1-2': ['Word Meanings', 'Word Sentences', 'Comprehension Passage', 'Rewriting', 'Story Completion', 'Simple Writing'],
      '3-5': ['Word Meanings', 'Word Sentences', 'Comprehension Passage', 'Letter Writing', 'Application Writing', 'Story Writing', 'Essay Writing', 'Paragraph Writing', 'Picture Description'],
    },
    grades: [1, 2, 3, 4, 5],
  },
  Urdu: {
    objective: [
      'MCQs', 'MSQs', 'Fill in the Blanks', 'Missing Letters', 'True/False',
      'Match the Column', 'Circle the Correct Answer', 'Rewrite Sentences',
      'Brief Answers', 'Listening', 'Speaking', 'Reading',
    ],
    subjectiveByGrade: {
      '1-2': ['Word Meanings', 'Word Sentences', 'Comprehension Passage', 'Rewriting', 'Story Completion', 'Simple Writing'],
      '3-5': ['Word Meanings', 'Word Sentences', 'Comprehension Passage', 'Letter Writing', 'Application Writing', 'Story Writing', 'Essay Writing', 'Paragraph Writing', 'Picture Description'],
    },
    grades: [1, 2, 3, 4, 5],
  },
  Maths: {
    objective: ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Mental Math (Viva)', 'Sequences'],
    subjective: ['Short Questions', 'Restricted Response Question', 'Word Problems', 'Graphs & Geometric Problems'],
    grades: [1, 2, 3, 4, 5],
  },
  SST: {
    objective: ['MCQs', 'Fill in the Blanks', 'True/False', 'Match the Column'],
    subjective: ['Short Questions', 'Long Question', 'Mind Map', 'Flow Chart'],
    grades: [4, 5], // SST is grades 4-5 only per UG_EG doc
  },
  Islamiat: {
    objective: ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Match the Column', 'Listening', 'Reading'],
    subjective: ['Short Questions', 'Long Question'],
    grades: [1, 2, 3, 4, 5],
  },
  Science: {
    objective: ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False'],
    subjective: ['Brief Answers', 'Mind Map', 'Flow Chart', 'Label the Diagram', 'Logical Reasoning'],
    grades: [4, 5], // Science is grades 4-5 only per UG_EG doc
  },
  GenK: {
    objective: ['MCQs', 'MSQs', 'Fill in the Blanks', 'True/False', 'Match the Column'],
    subjective: ['Short Questions', 'Long Question', 'Mind Map'],
    grades: [1, 2, 3], // GenK is grades 1-3 only per UG_EG doc
  },
};

// Flat catalogue of every unique type id → display title. Used for `isSupported`
// membership checks and title lookup. Titles use a lightly polished form
// (spaces around slashes) for the WhatsApp Flow UI.
const TYPE_TITLES = {
  'MCQs':                          'MCQs',
  'MSQs':                          'MSQs',
  'Fill in the Blanks':            'Fill in the Blanks',
  'Missing Letters':               'Missing Letters',
  'True/False':                    'True / False',
  'Match the Column':              'Match the Column',
  'Circle the Correct Answer':     'Circle the Correct Answer',
  'Rewrite Sentences':             'Rewrite Sentences',
  'Brief Answers':                 'Brief Answers',
  'Listening':                     'Listening',
  'Speaking':                      'Speaking',
  'Reading':                       'Reading',
  'Word Meanings':                 'Word Meanings',
  'Word Sentences':                'Word Sentences',
  'Comprehension Passage':         'Comprehension Passage',
  'Rewriting':                     'Rewriting',
  'Story Completion':              'Story Completion',
  'Simple Writing':                'Simple Writing',
  'Letter Writing':                'Letter Writing',
  'Application Writing':           'Application Writing',
  'Story Writing':                 'Story Writing',
  'Essay Writing':                 'Essay Writing',
  'Paragraph Writing':             'Paragraph Writing',
  'Picture Description':           'Picture Description',
  'Mental Math (Viva)':            'Mental Math (Viva)',
  'Sequences':                     'Sequences',
  'Short Questions':               'Short Questions',
  'Restricted Response Question':  'Restricted Response Question',
  'Word Problems':                 'Word Problems',
  'Graphs & Geometric Problems':   'Graphs & Geometric Problems',
  'Long Question':                 'Long Question',
  'Mind Map':                      'Mind Map',
  'Flow Chart':                    'Flow Chart',
  'Label the Diagram':             'Label the Diagram',
  'Logical Reasoning':             'Logical Reasoning',
};

const DEFAULT_COUNT_PER_TYPE = 3;
const MAX_COUNT_PER_TYPE = 20;

/**
 * Return the list of `{ id, title }` for the checkbox group,
 * partitioned by {subject, grade, category}.
 *
 * Enforces the grade-band gating from `docs/question-types-ict.md` (e.g. SST
 * is grades 4-5 only, GenK is grades 1-3 only, Eng/Urdu subjective diverges
 * between grades 1-2 and 3-5).
 *
 * @param {object} args
 * @param {string} args.subject           e.g. 'Eng', 'Maths'
 * @param {string|number} args.grade      1..5
 * @param {'objective'|'subjective'} args.category
 * @returns {Array<{id: string, title: string}>}
 */
function getQuestionTypes({ subject, grade, category }) {
  if (!['objective', 'subjective'].includes(category)) return [];
  const cfg = SUBJECT_CONFIG[subject];
  if (!cfg) return [];

  const gradeNum = parseInt(String(grade), 10);
  if (!Number.isFinite(gradeNum)) return [];
  if (Array.isArray(cfg.grades) && !cfg.grades.includes(gradeNum)) return [];

  let ids = [];
  if (category === 'objective') {
    ids = cfg.objective || [];
  } else {
    if (cfg.subjectiveByGrade) {
      const band = gradeNum <= 2 ? '1-2' : '3-5';
      ids = cfg.subjectiveByGrade[band] || [];
    } else {
      ids = cfg.subjective || [];
    }
  }

  return ids
    .filter((id) => TYPE_TITLES[id])
    .map((id) => ({ id, title: TYPE_TITLES[id] }));
}

/**
 * Any type id that appears anywhere in SUBJECT_CONFIG is supported (i.e. UG_EG
 * accepts it per `docs/question-types-ict.md`). The endpoint uses this to gate
 * user-picked type ids before submitting.
 */
function isSupported(id) {
  return Object.prototype.hasOwnProperty.call(TYPE_TITLES, id);
}

module.exports = {
  getQuestionTypes,
  isSupported,
  DEFAULT_COUNT_PER_TYPE,
  MAX_COUNT_PER_TYPE,
  // exposed for tests / diagnostics
  _internal: { SUBJECT_CONFIG, TYPE_TITLES },
};
