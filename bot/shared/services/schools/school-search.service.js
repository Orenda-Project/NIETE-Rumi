'use strict';
/**
 * Find a school from what a teacher types — for the registration Flow's school step (bd-x7aprz.2).
 *
 * The operator, 2026-10-16: she can only CHOOSE an existing school, never add one, and she has to
 * be able to search for it. So this reads the `schools` table (446 real rows on prod, EMIS-keyed,
 * populated from fde_production) and nothing else, and offers only rows that exist and are not
 * `is_probable_test`.
 *
 * What she types is rarely what the row says. The free-text column this replaces held 522
 * spellings of 465 schools ('IMSG(VI-X) G7/2' vs 'IMSG (VI-X) G-7/2'). So matching is done on
 * folded text: lowercase, accents dropped, brackets and commas as spaces, hyphens, slashes and
 * dots removed inside a word ('G-7/2' and 'G7/2' are both 'g72'). The school's prefix is also
 * searchable spelled out ('IMSG' = Islamabad Model School for Girls) and so is its sector, so
 * "model school girls g 9/1" and "tarnol" both find a school. One typo in a long word is
 * forgiven ('bhara kahu' for 'Bhara Kau').
 *
 * An EMIS typed exactly ranks first. Nothing matched is an empty list — never a guess.
 *
 * The 446 rows are read once and kept for ten minutes: a search runs inside Meta's ~10 s Flow
 * data_exchange budget, and the table changes only when a coach adds a school.
 */

const { logToFile } = require('../../utils/logger');

const CACHE_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 10;
const COLUMNS = 'id, name, region, emis, is_probable_test';

// The ICT school-name prefixes, spelled out. Only for matching; never shown.
const PREFIXES = Object.freeze({
  imsg: 'islamabad model school girls',
  imsb: 'islamabad model school boys',
  ims: 'islamabad model school',
  imcg: 'islamabad model college girls',
  imcb: 'islamabad model college boys',
  ghs: 'government high school',
});

// Words that carry no signal on their own in a school search.
const STOPWORDS = new Set(['for', 'of', 'the', 'and', 'in', 'at', 'no', 'number']);

let cache = { at: 0, rows: null };

function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Words of a text: brackets and commas split, hyphens/slashes/dots join. 'IMSG (VI-X) G-7/2' → ['imsg','vix','g72']. */
function words(s) {
  return fold(s)
    .replace(/[()[\]{},;:'"“”‘’]/g, ' ')
    .replace(/[-/\\.]/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}

/** One run of letters and digits — what substring matching is done against. */
function compact(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '');
}

/** At most one edit apart (insert, delete or substitute). Cheap, bounded. */
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length; const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (la > lb) i += 1;
    else if (lb > la) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

function indexRow(row) {
  const nameWords = words(row.name);
  const spelled = PREFIXES[nameWords[0]] || '';
  const all = [...nameWords, ...words(spelled), ...words(row.region)];
  return { row, words: all, text: compact([row.name, spelled, row.region].join(' ')), emis: String(row.emis == null ? '' : row.emis).trim() };
}

async function loadRows() {
  if (cache.rows && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const supabase = require('../../config/supabase');
  const { data, error } = await supabase.from('schools').select(COLUMNS);
  if (error) {
    logToFile('⚠️ school search: could not read schools', { error: error.message }, 'error');
    return cache.rows || [];
  }
  const rows = (data || []).filter((r) => r && r.id && r.name && r.is_probable_test !== true).map(indexRow);
  cache = { at: Date.now(), rows };
  return rows;
}

function scoreRow(ix, queryWords, queryCompact) {
  if (queryCompact && ix.emis && ix.emis === queryCompact) return { score: 1000, matched: queryWords.length };
  let score = 0; let matched = 0;
  for (const w of queryWords) {
    if (ix.text.includes(w)) { score += w.length; matched += 1; continue; }
    if (w.length >= 5 && ix.words.some((x) => withinOneEdit(w, x))) { score += w.length - 1; matched += 1; }
  }
  if (queryCompact.length >= 3 && ix.text.includes(queryCompact)) score += 5;
  if (/^\d{3,}$/.test(queryCompact) && ix.emis.startsWith(queryCompact)) score += 50;
  return { score, matched };
}

/**
 * Schools matching what she typed, best first.
 * @param {string} query
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<{id:string,name:string,region:?string,emis:?string}>>}
 */
async function searchSchools(query, { limit = DEFAULT_LIMIT } = {}) {
  const queryWords = words(query).filter((w) => !STOPWORDS.has(w));
  const queryCompact = compact(query);
  if (!queryWords.length || queryCompact.length < 2) return [];
  const need = Math.max(1, Math.ceil(queryWords.length * 0.6));
  const rows = await loadRows();
  return rows
    .map((ix) => ({ ix, ...scoreRow(ix, queryWords, queryCompact) }))
    .filter((r) => r.score > 0 && (r.score >= 1000 || r.matched >= need))
    .sort((a, b) => (b.score - a.score) || (b.matched - a.matched) || (a.ix.row.name.length - b.ix.row.name.length))
    .slice(0, limit)
    .map(({ ix }) => ({ id: ix.row.id, name: ix.row.name, region: ix.row.region || null, emis: ix.row.emis || null }));
}

/** The school with this id if it is a real (non-test) school she may pick, else null. Never trusts the client. */
async function findPickableSchool(id) {
  const key = String(id == null ? '' : id).trim();
  if (!key) return null;
  const rows = await loadRows();
  const hit = rows.find((ix) => String(ix.row.id) === key);
  return hit ? { id: hit.row.id, name: hit.row.name, region: hit.row.region || null, emis: hit.row.emis || null } : null;
}

function _resetCache() { cache = { at: 0, rows: null }; }

module.exports = { searchSchools, findPickableSchool, _resetCache };
