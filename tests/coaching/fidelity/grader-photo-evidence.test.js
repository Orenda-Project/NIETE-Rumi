'use strict';
/**
 * bd-b3pop.15 (D34) — photo evidence for the fidelity grader: the rules appended to the brief, and one block per photo.
 * FIDELITY_PHOTO_SECTION_MIRROR=<path to eval10_photo_evidence/prompts/photo_evidence_section.txt> byte-checks the rules.
 */
const fs = require('fs');
const { PHOTO_EVIDENCE_SECTION, buildPhotoEvidenceBlock, normalisePhotoEvidence } = require('../../../bot/shared/services/coaching/fidelity/grader-photo-evidence');

test('the rules: any kind of photo can credit, add-only, absence is never evidence, content must match, [photo N] evidence', () => {
  expect(PHOTO_EVIDENCE_SECTION.startsWith('\n\n## CLASSROOM PHOTO EVIDENCE\n')).toBe(true);
  for (const s of ['ANY kind of photo', 'only ADDS credit', 'never treat something missing from a photo', "THIS lesson's plan", '[photo N]']) {
    expect(PHOTO_EVIDENCE_SECTION).toContain(s);
  }
  const mirror = process.env.FIDELITY_PHOTO_SECTION_MIRROR;
  if (mirror) expect(PHOTO_EVIDENCE_SECTION).toBe('\n\n' + fs.readFileSync(mirror, 'utf8').replace(/\n$/, ''));
});

test('one block per photo, original photo numbers, empty fields left out, lines joined, long writing capped', () => {
  const block = buildPhotoEvidenceBlock([
    { n: 1, kind: 'board', visible_text: 'Multiply\n235 x 10', drawings: 'a place value chart', students: '', learning_materials: ['textbook p.52', 'flashcards'], student_work: '' },
    { n: 3, kind: 'group_or_pair_work', visible_text: '', drawings: '', students: 'four groups working on a chart', learning_materials: [], student_work: 'group 2 chart: 3 x 6 = 18' },
  ]);
  expect(block).toBe('\n\nCLASSROOM PHOTO EVIDENCE (read from the lesson photos by the vision pass; 2 photos):\n'
    + '[photo 1] kind: board\nwriting: Multiply / 235 x 10\ndrawings: a place value chart\nlearning materials: textbook p.52; flashcards'
    + '\n\n[photo 3] kind: group_or_pair_work\nstudents: four groups working on a chart\nstudent work: group 2 chart: 3 x 6 = 18');
  expect(buildPhotoEvidenceBlock([])).toBe('');
  expect(buildPhotoEvidenceBlock([{ n: 1, kind: 'board', visible_text: 'x'.repeat(5000) }]).length).toBeLessThan(1400);
});

test('normalise: a looping transcription collapses; not-a-classroom photos and empty reads are dropped', () => {
  expect(normalisePhotoEvidence([
    { n: 1, kind: 'board', visible_text: '2 3 5\n2 3 5\n2 3 5\n2 3 5\n\n\n\n\nHome work' },
    { n: 2, kind: 'not_a_classroom_photo', visible_text: 'A celebration of your teaching' },
    { n: 3, kind: 'whole_class', visible_text: '', drawings: '', students: '', learning_materials: [], student_work: '' },
  ])).toEqual([{ n: 1, kind: 'board', visible_text: '2 3 5\nHome work', drawings: '', students: '', learning_materials: [], student_work: '' }]);
  expect(normalisePhotoEvidence(null)).toEqual([]);
});
