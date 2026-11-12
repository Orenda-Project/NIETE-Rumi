'use strict';
/**
 * Gilgit-Baltistan's lesson-plan sheet: Amena's "GB Curriculum Matrix" (bd-97daxo.14).
 *
 * WHAT AMENA MUST KEEP STABLE (the sync stops, naming it, if any of these moves):
 *   - the tab names below and their header labels;
 *   - Segment IDs (gb_g1_english.c01.s001): the key of everything. A changed id is a removal plus an addition;
 *   - one row per Segment ID in All Segments, and one day row per grade + Day # in each subject tab.
 * SAFE TO CHANGE: row and column order, topic titles, the PDFs themselves (a re-rendered PDF is a new version).
 */
module.exports = {
  key: 'gb',
  sheetId: '1zgAEzGAlVRKU86RBfGLn13-OvqY0viQ5T8vDtxahX-4',
  region: 'gilgit-baltistan',          // region_features.region the book list is written to (--books)
  bookPrefix: 'gb',                    // every GB book key and lesson id starts gb_; nothing else is ever touched
  publisher: 'NBF',

  segmentsTab: 'All Segments + SLOs',
  booksTab: 'Books',
  skillsTab: 'Skill Taxonomy',
  // Subject tab → the Subject value All Segments and the Skill Taxonomy use for it.
  subjectTabs: {
    'English G1-G5': 'English',
    'Urdu G1-G5': 'Urdu',
    'Maths G1-G5': 'Mathematics',
    'Science G4-G5': 'Science',
  },

  // Slice 1 (GB's own NBF books), by the sheet's Subject. `slug` is the subject part of Amena's ids
  // (gb_g1_maths); `file` the subject word in her PDF filenames (g1_ch1_Maths_seg4…); the rest is what the
  // menu shows, the same as ICT's book of that subject so GB's menu reads like everyone else's.
  subjects: {
    English: { slug: 'english', file: 'English', subject: 'English', subject_key: 'english', rtl: false, language: 'en' },
    Urdu: { slug: 'urdu', file: 'Urdu', subject: 'Urdu', subject_key: 'urdu', rtl: true, language: 'ur' },
    Mathematics: { slug: 'maths', file: 'Maths', subject: 'Math', subject_key: 'math', rtl: false, language: 'en' },
    Science: { slug: 'science', file: 'Science', subject: 'General Science', subject_key: 'general_science', rtl: false, language: 'en' },
  },

  // Slice 2 (ICT's books, taken as is): the Books tab's Subject → the ICT catalog book's subject_key.
  // GK and Social Studies are the English-medium books in GB (operator, 2 Nov: "For GB the people use english
  // versions"); Islamiat is ICT's (the Islamiat tab: "taken as is").
  slice2: {
    'General Knowledge': 'general_knowledge',
    'Social Studies': 'social_studies_en',
    Islamiat: 'islamiat',
  },

  // Grades taught from ICT's 6-12 books, every one of them, taken as is (operator, 11 Nov: "we have till grades 10.
  // Same books as ICT"). GB has no Grades 11-12. --books adds those books to the region's list (bd-qchgya).
  ictGrades: [6, 7, 8, 9, 10],
  // ...except these (operator, 11 Nov: "no tarjuma and no zarai taleem needed in GB"). A book off the list is
  // hidden from her LP menus and her paper menu (TeacherBooks.upperBookOffered, bd-la9f5e).
  ictExclude: [/zari_taleem|zarai_taleem|tarjuma/],
};
