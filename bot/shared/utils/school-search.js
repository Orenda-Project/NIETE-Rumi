/**
 * bd-bfagiy — the one rule for searching schools (and anything named like one).
 *
 * School names here carry punctuation and spaces ("IMSG (I-V) I-10/3"), so a plain "contains" missed what coaches
 * type: "i103", "I 10 3", "IMSG I10". The rule:
 *   · compare with case, spaces and punctuation dropped (letters and digits only; Urdu letters are letters, so they stay);
 *   · each word of the query may sit anywhere in the names, in any order;
 *   · codes (EMIS, an ext id) match the whole query only, never a stray word;
 *   · best first — 0 the whole of a name or code, 1 its start, 2 inside it, 3 the words found apart; null = no match.
 *
 * Pure, no requires: the bot and the portal server (dashboard/) both load it. The portal page holds a copy in
 * portal/src/portal/lib/schoolSearch.ts; both run tests/fixtures/school-search-cases.json, so change both or neither.
 */

/** The text a search compares: lower case, letters and digits only (accents and Urdu marks dropped too). */
function searchText(value) {
  return String(value == null ? '' : value).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The query's words, each in search text; empty ones (only punctuation) dropped. */
function queryWords(query) {
  return String(query == null ? '' : query).split(/[\s,;]+/).map(searchText).filter(Boolean);
}

/**
 * How well `fields` matches `query`: 0 exact, 1 start, 2 inside, 3 words apart, null no match (a blank query is 0).
 * fields = { names: [...], codes: [...] }; any entry may be null.
 */
function schoolMatchRank(fields, query) {
  const whole = searchText(query);
  if (!whole) return 0;
  const names = ((fields && fields.names) || []).map(searchText).filter(Boolean);
  const all = names.concat(((fields && fields.codes) || []).map(searchText).filter(Boolean));
  if (all.some((t) => t === whole)) return 0;
  if (all.some((t) => t.startsWith(whole))) return 1;
  if (all.some((t) => t.includes(whole))) return 2;
  const words = queryWords(query);
  if (words.length > 1 && words.every((w) => names.some((t) => t.includes(w)))) return 3;
  return null;
}

/** Does it match at all. */
function schoolMatches(fields, query) {
  return schoolMatchRank(fields, query) !== null;
}

/** Rank 3: the query's words found apart. Shown only when nothing holds the query whole ("School 5" is not School 15). */
const WORDS_APART = 3;

/**
 * The items that match, best first; ties keep the list's own order. Words found apart count only when no item holds
 * the query whole. A blank query keeps every item, in order.
 */
function searchSchools(items, query, fieldsOf) {
  if (!searchText(query)) return [...(items || [])];
  const hits = (items || [])
    .map((item, i) => ({ item, i, rank: schoolMatchRank(fieldsOf(item), query) }))
    .filter((x) => x.rank !== null);
  const closer = hits.some((x) => x.rank < WORDS_APART);
  return hits
    .filter((x) => !closer || x.rank < WORDS_APART)
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.item);
}

module.exports = { searchText, queryWords, schoolMatchRank, schoolMatches, searchSchools };
