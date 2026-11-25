'use strict';
/**
 * The stable lesson + skill key of a Reading Hour / Numeracy (FLN) plan (bd-chz35n.26): what lets an eval join a
 * Grades 1-2 plan, the quiz made after it and a child's tested skill. Teachers never see it. Pure: no I/O.
 *
 *   fln1:<book>:<strand>:u<unit_no>:l<lesson_no>:<skill|none>:p<plan_id>
 *
 *   book       the FLN subject: rh-en (Reading Hour English), rh-ur (Reading Hour Urdu), num (Numeracy)
 *   unit_no    the bundle's chapter_no, lesson_no its `pos`, both from the placement row of the LOWEST served grade
 *              (a plan can sit in several grades; `grades` lists them, `certain` says every placement agrees)
 *   skill      from the unit title, the program's own label for what the unit teaches, named in the child-test
 *              vocabulary (letter sounds, words, story/comprehension, number sense, operations). A title not in
 *              SKILLS, or one that mixes skills, has no skill: `none` is honest, a guess is not.
 *
 * The key is written when the plan is SERVED (portal open row) so it records what the teacher had, even after the
 * bundle moves a lesson in a later version. The plan id stays the anchor (`p<id>`).
 */

const SKILLS = Object.freeze({
  'rh-en': {
    'Phoneme to Grapheme': 'letter_sounds',
    'Phoneme Grapheme: Basic A-Z+': 'letter_sounds',
    'Short and Long Vowel Sounds': 'word_reading',
    'Consonant Digraphs (h-brothers)': 'word_reading',
    'Consonant Blends': 'word_reading',
    'Consonant Blends and R-Controlled Vowel Sounds': 'word_reading',
    'Fluency and Comprehension Through Stories': 'fluency_comprehension',
    'Fluency and Comprehension with Phonics Progression': 'fluency_comprehension',
    'Understanding Simple Inference': 'fluency_comprehension',
    'Understanding Common Inference': 'fluency_comprehension',
  },
  'rh-ur': {
    'Letters of the alphabet and their sounds': 'letter_sounds',
    'Two- to many-letter words': 'word_reading',
    'Two- to many-syllable words': 'word_reading',
    'Letter sounds and combined sounds': 'word_reading',
    'Vowel letters': 'word_reading',
    'Compound words': 'word_reading',
    'Prefixes and suffixes': 'word_reading',
    'Homophones': 'word_reading',
    'Fluency and comprehension through stories': 'fluency_comprehension',
    // 'Recognising letter sounds (fluency, comprehension)' mixes letter sounds with fluency: deliberately absent.
  },
  num: {
    'Number Sense': 'number_sense',
    'Place Value': 'number_sense',
    'Addition': 'addition',
    'Subtraction': 'subtraction',
    'Multiplication': 'multiplication',
    'Division': 'division',
    'Fractions': 'fractions',
    'Decimals': 'decimals',
    'Estimation': 'mental_math',
    'Mental Math': 'mental_math',
    'Mental Math/Estimation': 'mental_math',
  },
});

const SKILL_NAMES = new Set(Object.values(SKILLS).flatMap((m) => Object.values(m)));
const BOOKS = Object.freeze(['rh-en', 'rh-ur', 'num']);
const ID_RX = /^\d{1,9}$/;
const KEY_RX = /^fln1:(rh-en|rh-ur|num):(daily|extended):u(\d{1,3}):l(-?\d{1,4}):([a-z_]+):p(\d{1,9})$/;
const SERVED = new Set(['core', 'additional']);

const BOOK_OF_SUBJECT = Object.freeze({ urdu: 'rh-ur', english: 'rh-en', maths: 'num', math: 'num' });

/** A quiz's canonical subject (transcript-quiz-language canonicalSubject) → its FLN book, or null. */
function bookForSubject(subject) {
  return BOOK_OF_SUBJECT[String(subject || '').trim().toLowerCase()] || null;
}

function skillOf(book, unitTitle) {
  const m = SKILLS[book];
  return (m && Object.prototype.hasOwnProperty.call(m, unitTitle) && m[unitTitle]) || null;
}

/**
 * @param {string|number} planId
 * @param {object[]} rows the bundle's placement rows for this plan (any shelf; only served rows count)
 * @returns {object|null}
 */
function lessonKeyOf(planId, rows) {
  const id = String(planId == null ? '' : planId);
  if (!ID_RX.test(id)) return null;
  const served = (rows || []).filter((r) => r && SERVED.has(r.shelf) && BOOKS.includes(r.subject)
    && String(r.lp_id) === id && Number.isInteger(Number(r.chapter_no)) && Number.isInteger(Number(r.pos)));
  if (!served.length) return null;
  const sorted = served.slice().sort((a, b) => Number(a.grade) - Number(b.grade)
    || (a.strand === 'daily' ? -1 : 0) - (b.strand === 'daily' ? -1 : 0));
  const r = sorted[0];
  const unitNo = Number(r.chapter_no);
  const lessonNo = Number(r.pos);
  const unit = r.chapter_title_en || null;
  const skill = skillOf(r.subject, unit);
  const sig = (x) => [x.subject, x.strand, Number(x.chapter_no), x.chapter_title_en || null, Number(x.pos)].join('|');
  const certain = served.every((x) => sig(x) === sig(r));
  const grades = [...new Set(served.map((x) => Number(x.grade)).filter(Number.isFinite))].sort((a, b) => a - b);
  return {
    v: 1,
    key: `fln1:${r.subject}:${r.strand}:u${unitNo}:l${lessonNo}:${skill || 'none'}:p${id}`,
    plan_id: id,
    book: r.subject,
    grades,
    strand: r.strand,
    unit_no: unitNo,
    unit,
    lesson_no: lessonNo,
    skill,
    certain,
  };
}

/** A v1 key string back into its parts, or null when it is not one. */
function parseLessonKey(key) {
  const m = typeof key === 'string' ? KEY_RX.exec(key) : null;
  if (!m) return null;
  const skill = m[5] === 'none' ? null : m[5];
  if (skill && !SKILL_NAMES.has(skill)) return null;
  return { v: 1, book: m[1], strand: m[2], unit_no: Number(m[3]), lesson_no: Number(m[4]), skill, plan_id: m[6] };
}

/** The lp-hint window around a recorded lesson: 36 h before to 6 h after (transcript-quiz-digest lpHintFor). */
const BEFORE_MS = 36 * 60 * 60 * 1000;
const AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * The one keyed FLN plan of `book` among a teacher's opens (rows already inside the window, or `at` given to bound
 * them here), or null when there are none or two or more. Pure: the backfill uses the same rule.
 */
function pickFlnLesson(rows, { book, at = null }) {
  const lo = at ? new Date(new Date(at).getTime() - BEFORE_MS).toISOString() : null;
  const hi = at ? new Date(new Date(at).getTime() + AFTER_MS).toISOString() : null;
  const latest = new Map(); // key → newest opened_at
  for (const r of rows || []) {
    const parsed = parseLessonKey(r && r.lesson_key);
    if (!parsed || parsed.book !== book) continue;
    const when = new Date(r.opened_at).toISOString();
    if (lo && (when < lo || when > hi)) continue;
    if (!latest.has(r.lesson_key) || when > latest.get(r.lesson_key)) latest.set(r.lesson_key, when);
  }
  if (latest.size !== 1) return null;
  const [[key, openedAt]] = [...latest];
  return { ...parseLessonKey(key), key, opened_at: openedAt, match: 'only_plan_in_window' };
}

module.exports = { SKILLS, lessonKeyOf, parseLessonKey, bookForSubject, pickFlnLesson, BEFORE_MS, AFTER_MS };
