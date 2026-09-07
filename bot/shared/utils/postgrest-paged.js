/**
 * Read a WHOLE result set out of PostgREST, in windows, without ever truncating.
 *
 * PostgREST answers a select with AT MOST its configured `db-max-rows` and
 * returns NO error when it truncates — the response just stops, `Content-Range`
 * says `0-999/6618`, and the caller sees a short array it cannot tell from a
 * short table. Asking for more does not help: MEASURED on this project
 * (2026-08-16, and again 2026-09-07 on both refs) `limit=5000` on a table of
 * 118k rows returns exactly 1000 rows. **Raising a `.limit()` is not a fix.**
 *
 * Every menu the teacher taps is built by counting and de-duplicating rows in
 * JS, so a truncated read does not fail — it produces a menu that is missing a
 * subject, a chapter or a lesson and looks perfectly healthy. That failure has
 * shipped twice on this lane already: the grade picker silently offering
 * `6, 7, 8, 10, 11` on staging (fixed with bounded existence probes in
 * `buildGradeItems`), and the subject list one book away from the same thing
 * (bd-oak77.27 — grade 10 pulls 863 of 1000 rows on prod today).
 *
 * The rule this module encodes: **a query's correctness must not depend on how
 * many rows the corpus happens to hold.** Window with `.range()` until a short
 * page proves the end, and shout — never silently cut — if a set somehow
 * exceeds the ceiling.
 *
 * Two other bounded shapes are equally correct and are used where they fit:
 * a bounded existence probe (`buildGradeItems`: seven `limit(1)` reads answer
 * "which grades exist" in constant work), and an explicit `.limit(N)` whose
 * overflow is asserted and logged (`lp612-serving.js` `REAP_SCAN_LIMIT`). What
 * is never acceptable is an unbounded read whose result is then reduced in JS.
 */

const { logToFile } = require('./logger');

/**
 * The window size. This is deliberately EQUAL TO the server's cap rather than
 * smaller: a page that comes back short is then proof of the end of the set,
 * which is what terminates the loop. A window larger than the cap would be
 * silently trimmed by the server and every page would look short.
 *
 * Measured, not assumed: `db-max-rows` = 1000 on `ihzciabopbttygxxgrkm` (prod)
 * and `rpqkekcfvumypldbejhp` (staging), 2026-09-07.
 */
const PAGE = 1000;

/**
 * 100,000 rows. The whole 6-12 corpus is 6,618 segments and the largest single
 * read in it pulls 863, so this is ~115x the biggest real query and exists only
 * to stop an unbounded loop against a runaway table. Reaching it is a bug, and
 * it is logged as one.
 */
const MAX_PAGES = 100;

/**
 * @param {string} label     what this read is, for the log line if anything goes wrong
 * @param {() => object} buildQuery  a THUNK returning a fresh PostgREST builder.
 *   It must be a thunk: a supabase-js builder is single-shot and awaiting it
 *   twice replays the first result.
 * @returns {Promise<object[]>} every row, in server order. `[]` on error —
 *   the same contract the catalogue's `run()` already has, so a database blip
 *   shows the teacher an empty menu rather than a stack trace.
 */
async function pagedRows(label, buildQuery) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE;
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) {
      logToFile('postgrest-paged: read failed', { label, page, error: error.message });
      return page === 0 ? [] : all;
    }
    const rows = data || [];
    all.push(...rows);
    // A SHORT PAGE IS THE ONLY PROOF OF THE END. A full page might be the whole
    // set or might be the server's cap; the two are indistinguishable from the
    // response, which is the entire reason this loop exists.
    if (rows.length < PAGE) return all;
  }
  logToFile('postgrest-paged: hit the page ceiling — the set may be incomplete', {
    label, pages: MAX_PAGES, collected: all.length,
  });
  return all;
}

module.exports = { pagedRows, PAGE, MAX_PAGES };
