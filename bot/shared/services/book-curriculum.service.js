'use strict';
/**
 * book-curriculum — which curriculum's BOOK a teacher gets (bd-97daxo.4 / .5).
 *
 * THE RULE. A teacher gets the book of her region's curriculum where that curriculum has one for
 * the grade and subject, and ICT's book otherwise. Gilgit-Baltistan's region row says
 * curriculum_key 'nbf_snc' (V1.8.6): GB uses National Book Foundation books for grades 1-5 Maths,
 * English and Urdu and grades 4-5 Science, and ICT's books for everything else. Which grade+subject
 * pairs differ is NOT listed in code — it is whichever books are loaded tagged 'nbf_snc' (textbooks
 * rows, lp_catalog.json entries, niete_lp612_segments rows, assessment_topics rows). Until they are,
 * every GB teacher gets ICT's book; adding one later is data only.
 *
 * WHERE "HER REGION'S CURRICULUM" COMES FROM. Only a REGISTRY region (region-registry.js: a
 * region_features row with an organization). The deployment-wide 'niete' row carries
 * curriculum_key 'punjab_snc_2020' and no organization; a naive read of region_features by the
 * user's region would land on it for every teacher whose users.region is null (DEFAULT_REGION is
 * 'niete' on the deployments) and move ~4.7k teachers onto the Punjab SNC book.
 *
 * TWO STEPS, SO A SYNCHRONOUS STORE CAN USE THE SAME RULE.
 *   1. curriculumForUser / curriculumForRegion — the TEACHER's curriculum ('nbf_snc' or 'ict'), read at
 *      the edge (a Flow, an internal API route, the worker) and handed to the book services.
 *   2. chooseCurriculum(teacherCurriculum, has) — per grade+subject: hers where the store has a
 *      book, else 'ict'. The stores call it (textbooks, niete_lp612_segments) or apply the same
 *      rule inline (the static lp_catalog.json, which cannot await).
 *   curriculumFor({ region, grade, subject, has }) is the two composed.
 *
 * 'ict' NEVER ASKS. An ICT teacher (every teacher today) costs no store lookup and her queries are
 * the ones she ran before; that is how "byte-for-byte unchanged for every existing user" holds.
 *
 * FAILS OPEN to 'ict' on any error — unlike region-registry, which fails closed because it decides
 * whose data a dashboard shows. A teacher must always get a book.
 */

const { logToFile } = require('../utils/logger');
const { getUserRegion } = require('../utils/region');
const Registry = require('./region-registry');

const ICT = 'ict';

const defaultClient = () => require('../config/supabase');

/** A teacher curriculum, normalised: anything empty or not a string is ICT. */
function normalise(curriculum) {
  const c = typeof curriculum === 'string' ? curriculum.trim().toLowerCase() : '';
  return c || ICT;
}

/** The curriculum of a region value, as the registry names it; 'ict' for anything else. Never throws. */
async function curriculumForRegion(region, { client } = {}) {
  if (!Registry.regionKey(region)) return ICT;
  try {
    return normalise(await Registry.curriculumKeyForRegion(client || defaultClient(), region));
  } catch (err) {
    logToFile('[book-curriculum] registry unreadable — ICT books', { region, error: err && err.message });
    return ICT;
  }
}

/** The curriculum of a teacher, from users.region. No id, no row, no region → 'ict'. Never throws. */
async function curriculumForUser(userId, { client } = {}) {
  if (!userId) return ICT;
  const db = client || defaultClient();
  let region = null;
  try {
    const { data, error } = await db.from('users').select('region').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ICT;
    region = getUserRegion(data);
  } catch (err) {
    logToFile('[book-curriculum] users.region unreadable — ICT books', { userId, error: err && err.message });
    return ICT;
  }
  return curriculumForRegion(region, { client: db });
}

/**
 * Her curriculum where the store has it, else 'ict'. `has(curriculum)` answers for one grade and
 * subject; it is never called for ICT, and a throw is ICT.
 */
async function chooseCurriculum(curriculum, has) {
  const c = normalise(curriculum);
  if (c === ICT || typeof has !== 'function') return ICT;
  try {
    return (await has(c)) ? c : ICT;
  } catch (err) {
    logToFile('[book-curriculum] book store unreadable — ICT book', { curriculum: c, error: err && err.message });
    return ICT;
  }
}

/** The whole rule: region → her curriculum → this grade+subject's book curriculum. Never throws. */
async function curriculumFor({ region, grade, subject, has, client } = {}) {
  const c = await curriculumForRegion(region, { client });
  return chooseCurriculum(c, (k) => has(k, grade, subject));
}

/** The curricula a list for her may draw from, hers first: ['ict'] or ['nbf_snc', 'ict']. */
function curriculaFor(curriculum) {
  const c = normalise(curriculum);
  return c === ICT ? [ICT] : [c, ICT];
}

/** A row's curriculum; a row that does not say is ICT's. */
const curriculumOf = (row) => normalise(row && row.curriculum);

/**
 * The same rule over rows already read from both curricula: per key (a subject, a grade), her
 * curriculum's rows where any exist and ICT's otherwise. Rows of any third curriculum are dropped.
 */
function preferPerKey(rows, keyOf, curriculum) {
  const c = normalise(curriculum);
  const hers = new Set();
  if (c !== ICT) for (const r of rows || []) if (curriculumOf(r) === c) hers.add(keyOf(r));
  return (rows || []).filter((r) => {
    const rc = curriculumOf(r);
    if (rc === c) return true;
    return rc === ICT && !hers.has(keyOf(r));
  });
}

/** Does `textbooks` hold a book of this curriculum for the grade and subject? Throws on a read error. */
async function hasTextbook(curriculum, grade, subject, { client } = {}) {
  const { data, error } = await (client || defaultClient())
    .from('textbooks').select('id')
    .eq('curriculum', curriculum).eq('grade', Number(grade)).eq('subject', subject)
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length > 0 : Boolean(data);
}

/** The curriculum of the textbook she gets for this grade and subject. Never throws. */
function textbookCurriculum(curriculum, grade, subject, { client } = {}) {
  return chooseCurriculum(curriculum, (k) => hasTextbook(k, grade, subject, { client }));
}

module.exports = {
  ICT,
  normalise,
  curriculumFor,
  curriculumForRegion,
  curriculumForUser,
  chooseCurriculum,
  curriculaFor,
  curriculumOf,
  preferPerKey,
  hasTextbook,
  textbookCurriculum,
};
