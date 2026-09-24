'use strict';
/**
 * Isolate each English (Latin-script) PHRASE inside right-to-left HTML.
 *
 * An Urdu document sets every Latin run in its own left-to-right isolate
 * (<span class="ltr">, direction:ltr + unicode-bidi:isolate) so the reader
 * meets it left to right. The run has to be the whole phrase. Two isolates
 * side by side are laid out right to left like any two neighbours in an RTL
 * paragraph, so a phrase cut in two reads back to front. That is what "&" and
 * "·" did: "Comparing & ordering unlike fractions" printed as "ordering unlike
 * & Comparing", and "quiz · forward" as "forward · quiz". Nothing else in the
 * phrase is re-ordered by this — only what counts as one run.
 *
 * So punctuation that sits BETWEEN two Latin words joins them: whitespace, "·"
 * (as the character or &middot; / &#183;), "&" (as &amp;, which is how an
 * escaped "&" arrives), and the dash and arrow a title joins its parts with —
 * "—" (U+2014), "–" (U+2013) and "→" (U+2192), as the literal characters. The
 * lesson-plan catalog names a lesson "Chapter 1 Assessment Worksheet — 'Hello
 * World!'" or "… (hook) → Coloured-Water Investigation"; 330 of its 1,390
 * English names carry one, and a quiz written from that lesson in Urdu prints the
 * name in an Urdu document, where it read second half first. Hyphens, slashes,
 * apostrophes, commas and full stops already belong to a run through the
 * caller's `token` class. A joiner only ever joins two LATIN runs: a dash
 * between an English phrase and Urdu text ends the phrase, as before.
 *
 * Tags are never entered, and an entity is never cut: entities are swapped
 * for private-use placeholders before runs are matched and restored after, so
 * a run can neither start inside "&amp;" (the "&<span>amp</span>;" bug the main
 * bot once had) nor end in the middle of one. An entity that is not a joiner
 * (&mdash;, &larr;, …) still ends a run, as before.
 *
 * @param {string} html   escaped HTML (text and tags)
 * @param {object} opts
 * @param {string} opts.token        regex class of the characters inside a word run
 * @param {boolean} [opts.leadingParen] a run may open with "("
 * @param {string} [opts.start]      regex class a run may START with (default: a Latin
 *                                   letter or a digit; the coaching card starts on letters only)
 * @param {boolean} [opts.requireLetter] leave a run with no Latin letter in it (a bare
 *                                   score, "70", "31/40") exactly as it was — the hero
 *                                   report's rule, so its numeric chrome never moves
 */
const JOINER_ENTITIES = { '&amp;': '\uE000', '&middot;': '\uE001', '&#183;': '\uE002' };
const JOINER_BACK = Object.fromEntries(Object.entries(JOINER_ENTITIES).map(([e, c]) => [c, e]));
const OPAQUE_BASE = 0xE100;
const ENTITY = /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g;
const JOIN = '[\\s\\u00B7\\u2013\\u2014\\u2192\\uE000-\\uE002]';

function wrapText(text, run, requireLetter) {
  const opaque = [];
  const masked = text.replace(ENTITY, (e) => {
    if (JOINER_ENTITIES[e]) return JOINER_ENTITIES[e];
    opaque.push(e);
    return String.fromCharCode(OPAQUE_BASE + opaque.length - 1);
  });
  return masked
    .replace(run, (m) => (requireLetter && !/[A-Za-z]/.test(m) ? m : `<span class="ltr">${m}</span>`))
    .replace(/[\uE000-\uE002]/g, (c) => JOINER_BACK[c])
    .replace(/[\uE100-\uF8FF]/g, (c) => opaque[c.charCodeAt(0) - OPAQUE_BASE]);
}

function wrapLatinRuns(html, {
  token, leadingParen = false, start = '[A-Za-z0-9]', requireLetter = false,
}) {
  const run = new RegExp(`${leadingParen ? '\\(?' : ''}${start}${token}*(?:${JOIN}+${token}+)*`, 'g');
  return String(html).split(/(<[^>]+>)/)
    .map((seg) => (seg.startsWith('<') ? seg : wrapText(seg, run, requireLetter)))
    .join('');
}

module.exports = { wrapLatinRuns };
