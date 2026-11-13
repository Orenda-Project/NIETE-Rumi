'use strict';
/**
 * bd-97daxo.16 — the coach's school card reads a Gilgit-Baltistan lesson opened in the app into its grade and
 * subject, as it reads ICT's. The card's app opens are niete_lp_opens 'k5' rows; a GB teacher's carry
 * gb_g<n>_<subject>_ch[R]<m>_seg<k> (v9) or, on the v10 lane, the nbf_snc segment id the app lists as the lesson.
 * The return contract is the card's: grade a string, subject the id's own token.
 */

const Card = require('../../dashboard/services/coach-school-card.service');

const at = (day, hh) => `${day}T${hh}:00:00.000Z`;
const open = (id, day, planRef) => ({ id, user_id: 'u', at: at(day, '05'), plan_ref: planRef });

describe('lessonPlansOf — app opens of GB lessons', () => {
  const plans = Card.lessonPlansOf([], [
    open('o1', '2026-11-02', 'gb_g1_english_ch1_seg1'),
    open('o2', '2026-11-03', 'gb_g5_science_ch3_seg9'),
    open('o3', '2026-11-04', 'gb_g2_english_chR4_seg902'),
    open('o4', '2026-11-05', 'nbf_snc_grade_3_maths.c04.s002'),
    open('o5', '2026-11-06', 'grade_3_math_ch4_seg1'),
  ]);
  const byRef = (r) => plans.find((p) => p.ref === r);

  it.each([
    ['gb_g1_english_ch1_seg1', '1', 'english'],
    ['gb_g5_science_ch3_seg9', '5', 'science'],
    ['gb_g2_english_chR4_seg902', '2', 'english'],
    ['nbf_snc_grade_3_maths.c04.s002', '3', 'maths'],
    // ICT, unchanged
    ['grade_3_math_ch4_seg1', '3', 'math'],
  ])('%s → grade %s, %s', (r, grade, subject) => {
    expect(byRef(r)).toMatchObject({ grade, subject });
  });
});
