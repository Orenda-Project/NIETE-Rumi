/**
 * bd-gr4fy.5.13 — the corpus's time anchors, spelled the way a teacher reads them.
 *
 * A moment's approx_time_phrase is copied into the reflective question the teacher hears. Haiku 4.5 wrote
 * «کریب» for «قریب» ("about") in Urdu anchors: 45 times in 8 production corpora, 0 times in any transcript,
 * and it reached 7 of 68 questions. The prompt now gives Nastaliq examples (language-profiles.js), and this
 * keeps the guarantee where a model ignores them. PURE, and deliberately narrow: only the anchor field, only
 * Urdu, only a whole word. A quote is evidence of what was said, so what_happened is never touched.
 */

// «کریب» is not an Urdu word; in a time anchor it is always «قریب».
const URDU_ANCHOR_FIXES = [[/(^|[\s،؛(])کریب(?=$|[\s،؛)])/gu, '$1قریب']];

function fixAnchor(phrase) {
  return URDU_ANCHOR_FIXES.reduce((s, [re, to]) => s.replace(re, to), phrase);
}

/**
 * @param {object} corpus  the parsed corpus (mutated in place and returned)
 * @param {string} languageCode  the transcript language code
 * @returns {object} the same corpus
 */
function normaliseCorpus(corpus, languageCode) {
  if (!corpus || typeof corpus !== 'object' || languageCode !== 'ur') return corpus;
  for (const key of ['significant_moments', 'collective_moments']) {
    for (const moment of Array.isArray(corpus[key]) ? corpus[key] : []) {
      if (moment && typeof moment.approx_time_phrase === 'string') {
        moment.approx_time_phrase = fixAnchor(moment.approx_time_phrase);
      }
    }
  }
  return corpus;
}

module.exports = { normaliseCorpus };
