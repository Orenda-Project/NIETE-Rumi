/**
 * bd-b7txa — ACCEPT-AND-NORMALISE the Latin honorific abbreviation the books print.
 *
 * THE RULING. Asked on 2026-09-23 whether a Latin PBUH/SAW should satisfy the religious gate, the
 * reviewer of record for gate G5c answered "Yes it should". Shown that the only way to make it
 * satisfy the gate AS WRITTEN is to delete PBUH/SAW from `ABBREV_RE` — reversing her own
 * 2026-09-17 "must be our stamp" and the bd-6tfw6 "go on option 1" tuning, both quoted verbatim in
 * `bot/vendor/lp-v9/lint_lp.js` — she ruled: "go with your recommendation". This is that
 * recommendation.
 *
 * WHAT IT IS. A document NORMALISATION that runs immediately before the gate, alongside the other
 * `sanitize*` passes in `lp612-author.service.js`. A Latin honorific abbreviation sitting against a
 * Prophet name is rewritten to the stamp:
 *
 *     Hazrat Muhammad (PBUH)   ->   Hazrat Muhammad ﷺ
 *     Hazrat Muhammad (SAW)    ->   Hazrat Muhammad ﷺ
 *
 * The gate then passes it on its EXISTING rule. Both halves of the ruling survive: the line is no
 * longer treated as unsaluted, and what the teacher receives carries the stamp rather than the
 * abbreviation.
 *
 * WHAT IT IS NOT. It is not a change to the gate, and it does not clear anything. `ABBREV_RE` is
 * untouched; an abbreviation this function leaves alone is still refused, so the gate stays the
 * backstop rather than the thing being relaxed. FAIL-CLOSED, as brief §4c / G5c requires.
 *
 * WHY ADJACENCY IS LOAD-BEARING AND NOT DECORATION. "SAW" is also the past tense of "see", and
 * `ABBREV_RE` matches `\b(PBUH|SAW|SAWW)\b` case-SENSITIVELY for exactly that reason. A blind
 * normaliser would turn "THE BOY SAW A BIRD" into scripture. So:
 *   - the rewrite fires only against a Prophet token the gate itself recognises;
 *   - it is case-sensitive, because it must never rewrite text the gate would not have refused;
 *   - bare (unenclosed) SAW is deliberately NOT rewritten — only the unambiguous PBUH/SAWW are.
 *
 * SCOPE, measured rather than assumed: 2 occurrences in the whole Grades 6-12 page-truth corpus —
 * grade_9_mathematics p.258 and grade_10_pak_studies_english p.016, both parenthesised, both
 * immediately after the name. A CHAINED form ("Muhammad Rasulullah (PBUH)") does not occur and is
 * not handled; if one ever appears the gate refuses it and we hear about it, which is the right
 * failure direction. Write-up: `08_Grades 6-12 LP Build/_b7txa_latin_honorific_2026-09-23/`.
 */

// The same five spellings `TRANSLIT_PROPHET_RE` matches, and no more — this function may not
// recognise a name the gate does not.
const PROPHET = '(?:Muhammad|Mohammad|Muhammed|Rasool|Rasul)';
// The books print these dotted, spaced and undotted.
const PBUH = 'P\\.?\\s?B\\.?\\s?U\\.?\\s?H\\.?';
const SAW = 'S\\.?\\s?A\\.?\\s?W\\.?W?\\.?';
// Enclosed: both tokens, because the brackets themselves mark it as an aside and not a verb.
const ENCLOSED = `[(\\[]\\s*(?:${PBUH}|${SAW})\\s*[)\\]]`;
// Bare: only what cannot be an English word. `SAW` is left to the gate on purpose.
const BARE = `\\b(?:${PBUH}|SAWW)\\b`;
const LATIN_HONORIFIC_RE = new RegExp(`\\b(${PROPHET})\\b\\s*(?:${ENCLOSED}|${BARE})`, 'g');

/**
 * Fields the gate itself excludes from enforcement, and which this function must therefore leave
 * exactly as written (`lint_lp.js`, check "Enforcement asks 'must we refuse to DELIVER this'"):
 *   • text_verbatim        — quoted from the curriculum WORD FOR WORD. Rewriting an immutable
 *                            quote is the defect, not the fix.
 *   • human_review_reason  — an internal routing note, never read by a teacher.
 * `provenance`, `revisions` and `notes` are bookkeeping for the same reason.
 */
const SKIP_KEYS = new Set(['text_verbatim', 'human_review_reason', 'provenance', 'revisions', 'notes']);

const normalizeString = (s) => s.replace(LATIN_HONORIFIC_RE, (_m, name) => `${name} ﷺ`);

/**
 * Rewrite every teacher-facing string in `doc`, in place.
 *
 * @param {object} doc a lesson-plan document; anything else is returned untouched
 * @returns {object} the same document
 */
function normalizeLatinHonorific(doc) {
  if (!doc || typeof doc !== 'object') return doc;

  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (typeof node[i] === 'string') node[i] = normalizeString(node[i]);
        else walk(node[i]);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
      if (SKIP_KEYS.has(k)) continue;
      if (typeof node[k] === 'string') node[k] = normalizeString(node[k]);
      else walk(node[k]);
    }
  };

  walk(doc);
  return doc;
}

module.exports = { normalizeLatinHonorific };
