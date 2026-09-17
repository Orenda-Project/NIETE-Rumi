/**
 * Fixtures for the bd-yhd16 Urdu-chrome reuse gate — shared by the unit suite and the E2E.
 *
 * The only interesting axis is `chrome`: whether the stored `ur_overlay` carries the provenance
 * pointers bd-x3dn6 added to `overlayTargets()`. A document authored before that fix does not,
 * which is why 82 ready Urdu renders in production still print an English title.
 */

const path = require('path');

const { overlayDefects } = require(path.join(
  __dirname, '..', '..', '..', 'bot', 'vendor', 'lp-v9', 'lint_lp.js',
));

const SEG_ID = 'grade_6_history.c01.p005-006';

const SEGMENT = {
  segment_id: SEG_ID,
  book_stem: 'grade_6_history',
  grade: 6,
  subject: 'History',
  subtopic_title: 'The Indus Valley Civilisation',
  printed_page_start: 5,
  printed_page_end: 6,
  language: 'en',
  is_religious: false,
};

/** The WhatsApp body shape bd-uu4lr defined, so the one_screen guard is NOT what fires here. */
const SHAPED = [
  '*Objective* Students name three features of the Indus Valley cities and say why each mattered.',
  '*Warm-up* Ask what a city needs to work at all; take three answers onto the board.',
  '*Worked example* Read the drainage paragraph together and mark the two claims it makes.',
  '*Practice* In pairs, sort six finds into "planning", "trade" and "craft", then swap and check.',
  '*Misconception* A ruined city is not a failed city. Name two reasons a city is abandoned.',
  '*Exit* Each student writes one feature and one reason it mattered on a slip before leaving.',
].join('\n\n');

const PROSE = 'Ask the class to read the paragraph aloud and underline the two claims it makes.';

const EN_TOPIC = 'The Indus Valley Civilisation: planning, drainage and trade';
const UR_TOPIC = 'وادیِ سندھ کی تہذیب: منصوبہ بندی، نکاسی اور تجارت';

/**
 * A stored Urdu document from an ENGLISH-medium book. `chrome` chooses whether the provenance
 * pointers the widened gate offers are present — which is the whole difference between a
 * pre-bd-x3dn6 document and a post-bd-x3dn6 one.
 */
const storedUrduDoc = ({ chrome, medium = 'en' } = {}) => {
  const doc = {
    lesson_id: SEG_ID,
    schema_version: '2.0',
    template_version: 'v9.2',
    provenance: {
      medium,
      topic: EN_TOPIC,
      chapter: 'Chapter 1 — The first cities',
      publisher: 'Punjab Curriculum and Textbook Board',
    },
    one_screen: SHAPED,
    materials: ['blackboard'],
    objectives: ['name three features of the Indus Valley cities'],
    sections: [{ id: 'introduction', minutes: 5, blocks: [{ type: 'teacher_says', text: PROSE }] }],
    page2: { practice: [] },
    ur_overlay: {},
  };
  // Every body pointer the gate offers is already Urdu — coverage is not the defect under test.
  for (const ptr of overlayDefects.targets(doc)) {
    if (ptr.startsWith('/provenance/')) continue;
    doc.ur_overlay[ptr] = 'اردو متن';
  }
  if (chrome) {
    doc.ur_overlay['/provenance/topic'] = UR_TOPIC;
    doc.ur_overlay['/provenance/chapter'] = 'باب ۱ — پہلے شہر';
  }
  return doc;
};

const docKey = (tv, lang) => `lp612/${tv}/${lang}/${SEG_ID}.lp.json`;
const storedAt = (tv, lang, doc) => ({ [docKey(tv, lang)]: JSON.stringify(doc) });

module.exports = {
  SEG_ID, SEGMENT, SHAPED, PROSE, EN_TOPIC, UR_TOPIC, storedUrduDoc, docKey, storedAt,
};
