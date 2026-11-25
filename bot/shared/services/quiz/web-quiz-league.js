'use strict';
/**
 * Which league a school board is (bd-97daxo.34.7, Amena 23 Nov 2026): GB schools rank in
 * their own league, not ICT's; only grades 6-10 can be compared with ICT, since the books
 * are the same. A GB viewer's board holds GB schools only (every grade); an ICT viewer's
 * board holds ICT schools plus a GB school counted only for its grade 6-10 plays. Pure.
 */
const GB_REGION = 'gilgit-baltistan';

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

/** A GB school (or a GB teacher's region string): region Gilgit-Baltistan. */
function isGb(school) {
  return Boolean(school) && norm(school.region) === GB_REGION;
}

/** A quiz grade ('7', '6-8', 'Grade 9') wholly inside 6-10. Unknown or any grade outside: false. */
function comparableGrade(grade) {
  const nums = (String(grade == null ? '' : grade).match(/\d+/g) || []).map(Number);
  return nums.length > 0 && nums.every((n) => n >= 6 && n <= 10);
}

/** 'gb' or 'ict': the viewer's school decides; with no school, the teacher's own region. */
function leagueOf(school, teacherRegion) {
  if (school) return isGb(school) ? 'gb' : 'ict';
  return norm(teacherRegion) === GB_REGION ? 'gb' : 'ict';
}

/** A play of `school` at `grade` counts on `league`'s board. */
function playInLeague(league, school, grade) {
  if (league === 'gb') return isGb(school);
  return !isGb(school) || comparableGrade(grade);
}

/** A school with no points is listed as still to start only on its own league's board. */
function schoolInLeague(league, school) {
  return league === 'gb' ? isGb(school) : !isGb(school);
}

module.exports = { isGb, comparableGrade, leagueOf, playInLeague, schoolInLeague };
