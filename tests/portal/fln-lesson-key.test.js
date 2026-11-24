'use strict';
/**
 * bd-chz35n.26 — the stable lesson + skill key of a Reading Hour / Numeracy (FLN) plan: book, unit, lesson no. and
 * FLN skill, made from the bundle's placement rows. Pure: no I/O.
 */
const K = require('../../bot/shared/services/fln-lesson-key');

const row = (o) => ({
  lp_id: 10152, subject: 'rh-ur', grade: 1, level: 1, strand: 'daily', chapter_no: 1,
  chapter_title_en: 'Letters of the alphabet and their sounds', pos: 2, shelf: 'core', ...o,
});

describe('lessonKeyOf', () => {
  test('one placement → book, unit, lesson no., skill, grades and a parseable key', () => {
    const k = K.lessonKeyOf('10152', [row()]);
    expect(k).toEqual({
      v: 1, key: 'fln1:rh-ur:daily:u1:l2:letter_sounds:p10152', plan_id: '10152', book: 'rh-ur', grades: [1],
      strand: 'daily', unit_no: 1, unit: 'Letters of the alphabet and their sounds', lesson_no: 2,
      skill: 'letter_sounds', certain: true,
    });
    expect(K.parseLessonKey(k.key)).toEqual({
      v: 1, book: 'rh-ur', strand: 'daily', unit_no: 1, lesson_no: 2, skill: 'letter_sounds', plan_id: '10152',
    });
  });

  test('a plan in two grades keys on the lower grade; certain only when every placement agrees', () => {
    const same = K.lessonKeyOf(9, [row({ lp_id: 9, grade: 2 }), row({ lp_id: 9, grade: 1 })]);
    expect(same.grades).toEqual([1, 2]);
    expect(same.certain).toBe(true);
    const moved = K.lessonKeyOf(9, [row({ lp_id: 9, grade: 2, pos: 7 }), row({ lp_id: 9, grade: 1, pos: 3 })]);
    expect(moved.lesson_no).toBe(3);
    expect(moved.certain).toBe(false);
  });

  test('skills follow the unit title per subject; an unlisted or mixed unit has no skill', () => {
    const skill = (subject, title) => K.lessonKeyOf(1, [row({ lp_id: 1, subject, chapter_title_en: title })]).skill;
    expect(skill('rh-en', 'Phoneme to Grapheme')).toBe('letter_sounds');
    expect(skill('rh-en', 'Consonant Blends')).toBe('word_reading');
    expect(skill('rh-en', 'Understanding Simple Inference')).toBe('fluency_comprehension');
    expect(skill('rh-ur', 'Two- to many-syllable words')).toBe('word_reading');
    expect(skill('rh-ur', 'Recognising letter sounds (fluency, comprehension)')).toBeNull();
    expect(skill('num', 'Number Sense')).toBe('number_sense');
    expect(skill('num', 'Addition')).toBe('addition');
    expect(skill('num', 'Mental Math/Estimation')).toBe('mental_math');
    expect(skill('num', 'Something New')).toBeNull();
    expect(K.lessonKeyOf(1, [row({ lp_id: 1, chapter_title_en: 'Something New' })]).key).toBe('fln1:rh-ur:daily:u1:l2:none:p1');
  });

  test('nothing to key: no rows, only hidden rows, or a bad id', () => {
    expect(K.lessonKeyOf('10152', [])).toBeNull();
    expect(K.lessonKeyOf('10152', [row({ shelf: 'hidden' })])).toBeNull();
    expect(K.lessonKeyOf('abc', [row()])).toBeNull();
  });
});

describe('parseLessonKey / bookForSubject', () => {
  test('rejects anything that is not a v1 key', () => {
    expect(K.parseLessonKey('grade_1_urdu_ch1_seg1')).toBeNull();
    expect(K.parseLessonKey(null)).toBeNull();
    expect(K.parseLessonKey('fln1:rh-ur:daily:u1:l2:bogus_skill:p1')).toBeNull();
  });
  test('a quiz subject names its FLN book', () => {
    expect(K.bookForSubject('urdu')).toBe('rh-ur');
    expect(K.bookForSubject('english')).toBe('rh-en');
    expect(K.bookForSubject('maths')).toBe('num');
    expect(K.bookForSubject('science')).toBeNull();
  });
});
