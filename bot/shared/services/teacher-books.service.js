'use strict';
/**
 * teacher-books — which BOOKS a teacher's Grade 1-5 lesson menu holds (bd-97daxo.4, book-first).
 *
 * THE RULE. A region may name its books: region_features.book_keys (V1.8.12), a list of lp_catalog.json book
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
 * generator reads is on her list. GB's NBF books have no assessment content yet, so their subjects are not
 * offered (separate bead). Pure and synchronous.
 */
function assessmentOffered(grade, subject, bookKeys) {
  if (!Array.isArray(bookKeys)) return true;
  if (!(Number(grade) >= 1 && Number(grade) <= 5)) return true;
  const subjectKey = ASSESSMENT_BOOK_SUBJECT[String(subject || '').trim().toLowerCase()];
  if (!subjectKey) return false;
  const Catalog = require('./lp-v8-catalog.service');
  const book = Catalog.bookFor(Number(grade), subjectKey, null);
  return Boolean(book && bookKeys.includes(book.book_key || book.stem));
}

function _clearCache() {
  _cache = null;
}

module.exports = {
  bookKeysForRegion,
  bookKeysForUser,
  assessmentOffered,
  ASSESSMENT_BOOK_SUBJECT,
  _clearCache,
};
