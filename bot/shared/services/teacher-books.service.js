'use strict';
/**
 * teacher-books — which BOOKS a teacher's Grade 1-5 lesson menu holds (bd-97daxo.4, book-first).
 *
 * THE RULE. A region may name its books: region_features.book_keys (V1.9.2), a list of lp_catalog.json book
 * keys. A teacher whose region names books sees exactly those books. Everyone else gets null, and every catalog
 * read takes null as "today's ICT list" (every book that is not opt_in). So a sector teacher, a teacher with no
 * region, and the deployment-wide 'niete' row all get the menu they had before this file existed.
 *
 * WHY BOOKS, NOT A CURRICULUM. The operator, 2 Nov: "map the lesson plans not to GB region but to books". GB uses
 * NBF books for English, Urdu, Maths and Science (Amena's GB Curriculum Matrix) and ICT's English-medium GK and
 * Social Studies and ICT's Islamiat. #4091 tagged books with a curriculum and fell back to ICT per grade+subject,
 * which handed GB the Urdu-medium GK it does not use. A list cannot leak: a subject whose book is not on it is
 * not on her menu.
 *
 * NEVER THROWS, AND FAILS OPEN TO null. A teacher must always get a menu; the ICT one is the one every teacher
 * had before. The cost of a failed read is a GB teacher seeing ICT's books for a minute, which is exactly what she
 * sees today. (region-registry fails CLOSED, because it decides whose data a dashboard shows.)
 *
 * COST. The regions that name books are read once a minute. While none does (every environment until the GB row
 * is set), a teacher is never looked up at all: the menu costs exactly the reads it did before.
 */

const { logToFile } = require('../utils/logger');
const { getUserRegion } = require('../utils/region');
const { regionKey } = require('./region-registry');

const TTL_MS = 60 * 1000;
let _cache = null; // { at, byKey: Map<regionKey, string[]> }

const defaultClient = () => require('../config/supabase');

function asKeys(v) {
  if (!Array.isArray(v)) return null;
  return v.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim());
}

/** Map of region key (and display name key) → its book list, for the regions that name one. Throws on a read error. */
async function shelves(client) {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.byKey;
  const { data, error } = await client.from('region_features').select('region, display_name, book_keys');
  if (error) throw new Error(error.message || String(error));
  const byKey = new Map();
  for (const row of data || []) {
    const keys = row && asKeys(row.book_keys);
    if (!keys) continue;
    for (const name of [row.region, row.display_name]) if (regionKey(name)) byKey.set(regionKey(name), keys);
  }
  _cache = { at: Date.now(), byKey };
  return byKey;
}

/** The book list a region names, or null (none named, unknown region, any error). Never throws. */
async function bookKeysForRegion(region, { client } = {}) {
  const key = regionKey(region);
  if (!key) return null;
  try {
    return (await shelves(client || defaultClient())).get(key) || null;
  } catch (err) {
    logToFile('[teacher-books] region_features unreadable — ICT list', { region, error: err && err.message });
    return null;
  }
}

/** The book list of a teacher's region (users.region), or null. Never throws. */
async function bookKeysForUser(userId, { client } = {}) {
  if (!userId) return null;
  const db = client || defaultClient();
  try {
    if (!(await shelves(db)).size) return null; // no region names books: no lookup, today's menu
  } catch (err) {
    logToFile('[teacher-books] region_features unreadable — ICT list', { userId, error: err && err.message });
    return null;
  }
  let region = null;
  try {
    const { data, error } = await db.from('users').select('region').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object') return null;
    region = getUserRegion(data);
  } catch (err) {
    logToFile('[teacher-books] users.region unreadable — ICT list', { userId, error: err && err.message });
    return null;
  }
  return bookKeysForRegion(region, { client: db });
}

/**
 * The assessment generator reads ICT's books (`textbooks` curriculum 'ict'): English, Urdu, Maths, Science, and
 * the Urdu-medium General Knowledge and Social Studies (their textbook_toc titles are Urdu). Which catalog book
 * each one is, by the catalog's subject key.
 */
const ASSESSMENT_BOOK_SUBJECT = {
  english: 'english',
  urdu: 'urdu',
  maths: 'math',
  math: 'math',
  science: 'general_science',
  general_science: 'general_science',
  general_knowledge: 'general_knowledge_ur',
  social_studies: 'social_studies_ur',
  islamiat: 'islamiat',
};

/**
 * May a teacher with this book list be offered an assessment on (grade, subject)? Assessments are keyed by
 * book: yes when she has no list, for Grades 6-12 (her list is a Grade 1-5 list), or when the ICT book the
 * generator reads is on her list. Her region's own books (GB's NBF books) are offered by assessmentOfferedFor,
 * which also checks the book is loaded. Pure and synchronous.
 */
function assessmentOffered(grade, subject, bookKeys) {
  if (!Array.isArray(bookKeys)) return true;
  if (!gradeCovered(grade, bookKeys)) return false;
  if (!(Number(grade) >= 1 && Number(grade) <= 5)) return true;
  const subjectKey = ASSESSMENT_BOOK_SUBJECT[String(subject || '').trim().toLowerCase()];
  if (!subjectKey) return false;
  const Catalog = require('./lp-v8-catalog.service');
  const book = Catalog.bookFor(Number(grade), subjectKey, null);
  return Boolean(book && bookKeys.includes(book.book_key || book.stem));
}

/** The book-key subject of a generator subject: `gb_g5_maths`, `gb_g5_science` (the textbooks.subject codes). */
const OWN_BOOK_SUBJECT = { math: 'maths', general_science: 'science' };

/**
 * Does her list name her region's OWN book for this grade and subject — a `<prefix>_g<N>_<subject>` key such as
 * `gb_g5_maths` (bd-6nskfq.1)? Pure. Says nothing about whether that book is loaded.
 */
function ownBookListed(grade, subject, bookKeys) {
  if (!Array.isArray(bookKeys)) return false;
  const s = String(subject || '').trim().toLowerCase();
  const re = new RegExp(`^[a-z]+_g${Number(grade)}_${OWN_BOOK_SUBJECT[s] || s}$`);
  return bookKeys.some((k) => re.test(String(k)));
}

/**
 * assessmentOffered, plus her own curriculum's book (bd-6nskfq.1): a G1-5 subject is also offered when her list
 * names her own book for it AND her curriculum (not ICT) holds that textbook — the generator then reads her book
 * (book-curriculum). A listed book that is not loaded offers nothing, so she is never handed ICT's book under her
 * own book's name; a failed read offers nothing for the same reason. An ICT teacher costs no read.
 */
async function assessmentOfferedFor(grade, subject, bookKeys, curriculum, { client } = {}) {
  if (assessmentOffered(grade, subject, bookKeys)) return true;
  const BookCurriculum = require('./book-curriculum.service');
  const c = BookCurriculum.normalise(curriculum);
  if (c === BookCurriculum.ICT || !ownBookListed(grade, subject, bookKeys)) return false;
  try {
    return await BookCurriculum.hasTextbook(c, grade, subject, { client });
  } catch (err) {
    logToFile('[teacher-books] textbooks unreadable — subject not offered', { grade, subject, curriculum: c, error: err && err.message });
    return false;
  }
}

/** The grade a book key is for: the catalog's own grade, else the key's `grade_7_` / `gb_g7_` prefix. */
function gradeOfKey(key) {
  const Catalog = require('./lp-v8-catalog.service');
  const book = Catalog.catalog().books.find((b) => (b.book_key || b.stem) === key);
  if (book) return Number(book.grade);
  const m = /^(?:grade_(\d{1,2})_|[a-z]+_g(\d{1,2})_)/.exec(String(key || ''));
  return m ? Number(m[1] || m[2]) : null;
}

/**
 * Does her book list cover this grade (operator, 6 Nov)? No list covers every grade, as today. A list covers
 * exactly the grades of its books: GB names Grades 1-5 books only (its Afaq books for 6+ are not ready), so a GB
 * teacher of Grade 6+ gets no lesson plans, no question papers and no book features — and is told so
 * (gradeNotCoveredMessage), never handed ICT's books instead.
 */
function gradeCovered(grade, bookKeys) {
  if (!Array.isArray(bookKeys)) return true;
  const g = Number(grade);
  return bookKeys.some((k) => gradeOfKey(k) === g);
}

const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => UR_DIGITS[Number(d)]);

/** The polite refusal, in her language: kind 'lp' (lesson plans) or 'exam' (question papers). Urdu digits in Urdu. */
function gradeNotCoveredMessage(kind, grade, language) {
  const { resolveUx, clampLanguage } = require('../config/ux-strings');
  const lang = clampLanguage(language);
  const key = kind === 'exam' ? 'examGradeNotForRegionBooks' : 'lpGradeNotForRegionBooks';
  return resolveUx(key, { language: lang, params: { grade: lang === 'ur' ? urDigits(grade) : String(grade) } });
}

/** Her stored language (users.preferred_language), or null. Never throws. Teacher-addressed text reads it now. */
async function languageForUser(userId, { client } = {}) {
  if (!userId) return null;
  try {
    const { data, error } = await (client || defaultClient()).from('users').select('preferred_language').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data && data.preferred_language) || null;
  } catch (err) {
    logToFile('[teacher-books] users.preferred_language unreadable', { userId, error: err && err.message });
    return null;
  }
}

function _clearCache() {
  _cache = null;
}

module.exports = {
  bookKeysForRegion,
  bookKeysForUser,
  assessmentOffered,
  assessmentOfferedFor,
  ownBookListed,
  gradeCovered,
  gradeNotCoveredMessage,
  languageForUser,
  ASSESSMENT_BOOK_SUBJECT,
  _clearCache,
};
