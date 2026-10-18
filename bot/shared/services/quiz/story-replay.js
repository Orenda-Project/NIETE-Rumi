'use strict';
/**
 * The replay slice: one sentence or one word of a storybook page, played as a time slice of the page's own take, so a
 * child hears the same voice the book reads in and no new audio is made.
 *
 * replaySlice(page, { sentence } | { word }) -> { clip, s_ms, e_ms } | null
 *   page: the page's timing record (pNN.json): { audio: { url | key }, words: [{ i, t, s_ms, e_ms }] }
 *   sentence: 0-based; a sentence ends at a word ending in . ! ? … ۔ or ؟ (a closing quote or bracket after it allowed),
 *     and the page's last words form the last sentence
 *   word: the word's index i on the page
 * null when there is nothing safe to play: no such sentence or word, no clip, or times that are missing or reversed.
 */
const END = /[.!?…۔؟]["'”’»)\]]*$/;
const ok = (v) => typeof v === 'number' && Number.isFinite(v);

function replaySlice(page, at = {}) {
  const clip = page && page.audio && (page.audio.url || page.audio.key);
  const words = page && Array.isArray(page.words) ? [...page.words].sort((a, b) => a.i - b.i) : [];
  if (!clip || !words.length || !at) return null;
  let span = null;
  if (Number.isInteger(at.word)) {
    const w = words.find((x) => x.i === at.word);
    span = w ? [w, w] : null;
  } else if (Number.isInteger(at.sentence) && at.sentence >= 0) {
    let k = 0; let first = words[0];
    for (let j = 0; j < words.length && !span; j += 1) {
      const last = j === words.length - 1 || END.test(String(words[j].t || '').trim());
      if (!last) continue;
      if (k === at.sentence) span = [first, words[j]];
      k += 1; first = words[j + 1];
    }
  }
  if (!span || !ok(span[0].s_ms) || !ok(span[1].e_ms) || span[1].e_ms <= span[0].s_ms) return null;
  return { clip, s_ms: Math.round(span[0].s_ms), e_ms: Math.round(span[1].e_ms) };
}

module.exports = { replaySlice };
