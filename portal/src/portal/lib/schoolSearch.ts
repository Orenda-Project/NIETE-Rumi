/**
 * bd-bfagiy — the one rule for searching schools on the portal page (and anything named like one).
 *
 * School names carry punctuation and spaces ("IMSG (I-V) I-10/3"), so a plain "contains" missed what people type:
 * "i103", "I 10 3", "IMSG I10". The rule:
 *   · compare with case, spaces and punctuation dropped (letters and digits only; Urdu letters stay);
 *   · each word of the query may sit anywhere in the names, in any order;
 *   · codes (EMIS) match the whole query only, never a stray word;
 *   · best first — 0 the whole of a name or code, 1 its start, 2 inside it, 3 the words found apart; null = no match.
 *
 * A copy of the server's bot/shared/utils/school-search.js (the portal page cannot load it); both run
 * tests/fixtures/school-search-cases.json, so change both or neither.
 */

type Text = string | null | undefined;
export type SearchFields = { names?: readonly Text[]; codes?: readonly Text[] };

/** The text a search compares: lower case, letters and digits only (accents and Urdu marks dropped too). */
export function searchText(value: Text): string {
  return String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The query's words, each in search text; empty ones (only punctuation) dropped. */
export function queryWords(query: Text): string[] {
  return String(query ?? "").split(/[\s,;]+/).map(searchText).filter(Boolean);
}

/** How well `fields` matches `query`: 0 exact, 1 start, 2 inside, 3 words apart, null no match (a blank query is 0). */
export function schoolMatchRank(fields: SearchFields, query: Text): number | null {
  const whole = searchText(query);
  if (!whole) return 0;
  const names = (fields.names ?? []).map(searchText).filter(Boolean);
  const all = names.concat((fields.codes ?? []).map(searchText).filter(Boolean));
  if (all.some((t) => t === whole)) return 0;
  if (all.some((t) => t.startsWith(whole))) return 1;
  if (all.some((t) => t.includes(whole))) return 2;
  const words = queryWords(query);
  if (words.length > 1 && words.every((w) => names.some((t) => t.includes(w)))) return 3;
  return null;
}

/** Does it match at all. */
export function schoolMatches(fields: SearchFields, query: Text): boolean {
  return schoolMatchRank(fields, query) !== null;
}

/** Rank 3: the query's words found apart. Shown only when nothing holds the query whole ("School 5" is not School 15). */
const WORDS_APART = 3;

/**
 * The items that match, best first; ties keep the list's own order (so sort the list first: never-visited, A to Z…).
 * Words found apart count only when no item holds the query whole. A blank query keeps every item, in order.
 */
export function searchSchools<T>(items: readonly T[], query: Text, fieldsOf: (item: T) => SearchFields): T[] {
  if (!searchText(query)) return [...items];
  const hits = items
    .map((item, i) => ({ item, i, rank: schoolMatchRank(fieldsOf(item), query) }))
    .filter((x): x is { item: T; i: number; rank: number } => x.rank !== null);
  const closer = hits.some((x) => x.rank < WORDS_APART);
  return hits
    .filter((x) => !closer || x.rank < WORDS_APART)
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.item);
}
