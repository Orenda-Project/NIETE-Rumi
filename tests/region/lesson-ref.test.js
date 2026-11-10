'use strict';
/**
 * bd-97daxo.16 — one reader for every lesson-id shape NIETE serves (bot/shared/utils/lesson-ref.js).
 *
 * Four parsers (lp-engagement, coach-school-card, coaching subject-resolution, lp-quiz-digest) knew only ICT's
 * `grade_<n>_…` ids, so a Gilgit-Baltistan lesson fell out of every grade and subject breakdown:
 *   v9 book-first lane   gb_g<n>_<subject>_ch[R]<m>_seg<k>      (bot/data/lp_catalog.json, niete_lp_assets)
 *   v10 lane             nbf_snc_grade_<n>_<subject>.<rest>     (niete_lp612_segments, curriculum nbf_snc)
 * ICT's own ids must read EXACTLY as before — the sweep below runs every ICT id in the committed catalogue through
 * the four regexes this replaces and through the helper, and they must agree id by id.
 */

const fs = require('fs');
const path = require('path');
const { parseLessonRef } = require('../../bot/shared/utils/lesson-ref');

const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bot/data/lp_catalog.json'), 'utf8'));
/** Every lesson id in the committed catalogue, by walking it (the shape is the builder's, not this test's). */
function catalogIds() {
  const ids = new Set();
  const walk = (n) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (typeof n.lesson_id === 'string') ids.add(n.lesson_id);
    Object.values(n).forEach(walk);
  };
  walk(CATALOG.books);
  return [...ids];
}
const IDS = catalogIds();
const ICT_IDS = IDS.filter((id) => id.startsWith('grade_'));
const GB_IDS = IDS.filter((id) => id.startsWith('gb_'));

// The four regexes this helper replaces, verbatim from origin/sandbox before bd-97daxo.16.
const OLD = {
  engagementK5: /^grade_(\d{1,2})_(.+?)_ch\d+_seg\d+b?$/i,
  engagementG612: /^grade_(\d{1,2})_(?:\d{1,2}_)?([a-z0-9_]+?)\./i,
  schoolCard: /^grade_(\d+)_(.+?)_ch\d+_seg/,
  corpus: /^grade_(\d+)_(.+?)_ch\d+_seg\d+b?$/i,
  quizDigest: /^grade_\d+_(.+?)_ch\d+/,
};

describe('parseLessonRef — the shapes', () => {
  it.each([
    // ICT K-5 catalogue ids
    ['grade_4_math_ch8_seg3', { grade: 4, subject: 'math', shape: 'catalogue', prefix: null }],
    ['grade_4_social_studies_en_ch5_seg2', { grade: 4, subject: 'social_studies_en', shape: 'catalogue', prefix: null }],
    ['grade_3_urdu_ch3_seg1b', { grade: 3, subject: 'urdu', shape: 'catalogue', prefix: null }],
    // ICT 6-12 segment ids (a combined grade_9_10_ book reads as its first grade)
    ['grade_8_mathematics.c05.p071-073', { grade: 8, subject: 'mathematics', shape: 'segment', prefix: null }],
    ['grade_9_10_chemistry_experiment.c01.p026-028', { grade: 9, subject: 'chemistry_experiment', shape: 'segment', prefix: null }],
    ['grade_7_english.s903', { grade: 7, subject: 'english', shape: 'segment', prefix: null }],
    // GB v9, the book-first lane (a region's book prefix; chR<m> is a revision chapter)
    ['gb_g1_english_ch1_seg1', { grade: 1, subject: 'english', shape: 'catalogue', prefix: 'gb' }],
    ['gb_g2_english_chR4_seg902', { grade: 2, subject: 'english', shape: 'catalogue', prefix: 'gb' }],
    ['gb_g5_science_ch3_seg9', { grade: 5, subject: 'science', shape: 'catalogue', prefix: 'gb' }],
    // GB v10, the segment lane (a curriculum prefix, as lp612-lifecycle reads it)
    ['nbf_snc_grade_3_maths.c04.s002', { grade: 3, subject: 'maths', shape: 'segment', prefix: 'nbf_snc' }],
    ['nbf_snc_grade_2_urdu.c07.s005', { grade: 2, subject: 'urdu', shape: 'segment', prefix: 'nbf_snc' }],
    // a curriculum's catalogue book (build-lp-catalog: `<curriculum>_grade_<n>_<subject>` stems)
    ['nbf_snc_grade_3_maths_ch1_seg1', { grade: 3, subject: 'maths', shape: 'catalogue', prefix: 'nbf_snc' }],
  ])('%s', (ref, want) => {
    expect(parseLessonRef(ref)).toEqual(want);
  });

  it('junk is null, never a partial', () => {
    for (const junk of [null, undefined, 42, {}, '', '  ', 'nonsense', 'grade_x_urdu_ch1_seg1', 'urdu_ch1', 'gb_g1_english',
      'grade_4_urdu_ch10_seg2bb', 'W']) {
      expect(parseLessonRef(junk)).toBeNull();
    }
  });

  it('kind k5: a catalogue id, or a curriculum segment (GB lists its K-5 segments AS lesson ids); never an ICT segment', () => {
    expect(parseLessonRef('gb_g1_english_ch1_seg1', { kind: 'k5' })).toMatchObject({ grade: 1, subject: 'english' });
    expect(parseLessonRef('nbf_snc_grade_3_maths.c04.s002', { kind: 'k5' })).toMatchObject({ grade: 3, subject: 'maths' });
    expect(parseLessonRef('grade_8_mathematics.c05.p071-073', { kind: 'k5' })).toBeNull();
  });

  it('kind g612: a segment id only', () => {
    expect(parseLessonRef('nbf_snc_grade_3_maths.c04.s002', { kind: 'g612' })).toMatchObject({ grade: 3, subject: 'maths' });
    expect(parseLessonRef('grade_8_mathematics.c05.p071-073', { kind: 'g612' })).toMatchObject({ grade: 8, subject: 'mathematics' });
    expect(parseLessonRef('gb_g1_english_ch1_seg1', { kind: 'g612' })).toBeNull();
    expect(parseLessonRef('grade_4_math_ch8_seg3', { kind: 'g612' })).toBeNull();
  });

  it('an unknown kind reads nothing', () => {
    expect(parseLessonRef('grade_4_math_ch8_seg3', { kind: 'fln' })).toBeNull();
  });
});

describe('the committed catalogue', () => {
  it('holds both regions\' ids (the sweep below is not vacuous)', () => {
    expect(ICT_IDS.length).toBeGreaterThan(3000);
    expect(GB_IDS.length).toBeGreaterThan(2000);
  });

  it('every GB lesson id reads as a grade 1-5 lesson with a subject', () => {
    for (const id of GB_IDS) {
      const p = parseLessonRef(id, { kind: 'k5' });
      expect([id, p && p.grade >= 1 && p.grade <= 5 && !!p.subject]).toEqual([id, true]);
    }
  });

  it('every ICT lesson id reads exactly as each of the four old parsers read it', () => {
    for (const id of ICT_IDS) {
      const p = parseLessonRef(id, { kind: 'k5' });
      const e = OLD.engagementK5.exec(id);
      expect([id, p ? [p.grade, p.subject] : null]).toEqual([id, e ? [Number(e[1]), e[2]] : null]);
      const c = OLD.schoolCard.exec(id);
      expect([id, p ? [String(p.grade), p.subject] : null]).toEqual([id, c ? [c[1], c[2]] : null]);
      const k = OLD.corpus.exec(id);
      expect([id, p ? [String(p.grade), p.subject] : null]).toEqual([id, k ? [k[1], k[2]] : null]);
      const q = OLD.quizDigest.exec(id);
      expect([id, p ? p.subject : null]).toEqual([id, q ? q[1] : null]);
      // and no ICT K-5 id was ever a 6-12 segment
      expect([id, parseLessonRef(id, { kind: 'g612' })]).toEqual([id, OLD.engagementG612.exec(id) ? 'segment' : null]);
    }
  });

  it('ICT 6-12 segment ids read exactly as the old 6-12 parser read them', () => {
    for (const id of ['grade_10_urdu.p1c01.p007-012.tafheem', 'grade_12_computer_science.c05.p126-128',
      'grade_9_pak_studies_english.c01.p001-002', 'grade_7_english.s903', 'grade_8_mathematics.c05.p071-073',
      'grade_6_general_science.c09.p113-113', 'grade_9_10_chemistry_experiment.c01.p026-028', 'grade_11_physics.r990']) {
      const p = parseLessonRef(id, { kind: 'g612' });
      const m = OLD.engagementG612.exec(id);
      expect([id, p ? [p.grade, p.subject] : null]).toEqual([id, m ? [Number(m[1]), m[2]] : null]);
      expect([id, parseLessonRef(id, { kind: 'k5' })]).toEqual([id, null]);
    }
  });
});
