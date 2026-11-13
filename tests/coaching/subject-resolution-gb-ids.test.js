'use strict';
/**
 * bd-97daxo.16 — a coaching session linked to a Gilgit-Baltistan lesson knows its subject.
 *
 * The corpus key of the plan she taught from (niete_lp_assets.lesson_id, carried in _fidelity_ref) encodes the
 * grade and subject. For GB that key is gb_g<n>_<subject>_ch[R]<m>_seg<k> (v9); parseCorpusLessonId read only
 * ICT's grade_<n>_…, so a GB session fell to "subject not confirmed" and FICO's subject-tagged rows stayed out.
 */

const {
  parseCorpusLessonId,
  resolveLessonSubject,
} = require('../../bot/shared/services/coaching/subject-resolution');

describe('parseCorpusLessonId — GB keys', () => {
  it.each([
    ['gb_g1_english_ch1_seg1', { subject: 'english', grade: '1' }],
    ['gb_g4_maths_ch6_seg991', { subject: 'maths', grade: '4' }],
    ['gb_g2_urdu_ch19_seg7', { subject: 'urdu', grade: '2' }],
    ['gb_g5_science_ch3_seg9', { subject: 'science', grade: '5' }],
    ['gb_g2_english_chR4_seg902', { subject: 'english', grade: '2' }],
    // GB's v10 lane lists its segments as lesson ids
    ['nbf_snc_grade_3_maths.c04.s002', { subject: 'maths', grade: '3' }],
  ])('%s', (lessonId, want) => {
    expect(parseCorpusLessonId(lessonId)).toEqual(want);
  });

  it('unchanged: an ICT 6-12 segment id is not a corpus key', () => {
    expect(parseCorpusLessonId('grade_8_mathematics.c05.p071-073')).toBeNull();
  });
});

describe('resolveLessonSubject — tier 2 from a GB corpus key', () => {
  it('a session linked to a GB Science lesson resolves to science (medium, from the key)', () => {
    const r = resolveLessonSubject({ lesson_plan_structured: { _fidelity_ref: { lesson_id: 'gb_g5_science_ch3_seg9' } } });
    expect(r).toMatchObject({ code: 'science', grade: '5', confidence: 'medium', source: 'corpus_lesson_id', group: 'science' });
  });
});
