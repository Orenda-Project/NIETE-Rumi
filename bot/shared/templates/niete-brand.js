'use strict';
/**
 * The NIETE visual kit shared by every teacher/child-facing rendered artefact.
 *
 * One place for the palette, the two font stacks and the two geometric motifs
 * (the diamond taken from the logo's nuqta, and the lattice the brand book
 * builds out of it), so the PDF, the class report and the child scorecard
 * cannot drift into three slightly different greens or three slightly
 * different diamonds.
 *
 * FONT STACKS ARE ALWAYS DUAL. Keying a font-family on ONE language is the
 * bug this module exists to make impossible: a teacher whose interface is in
 * English can be sent a quiz written in Urdu, and if the Urdu content lands on
 * a Latin-only face the browser has no glyphs to draw. A desktop quietly
 * substitutes a system font so it looks fine locally; the render container has
 * no system fonts at all and paints empty boxes. Both families are therefore
 * always named, in the order the element's own language wants them.
 */

/** Book palette. No gold, no coral, no other product's navy. */
const PALETTE = {
  slate: '#333748',        // the dark ground
  slateLight: '#4B5168',   // raised slate (tier grounds, tints)
  green: '#47BA7D',        // the accent — the logo's N
  greenDeep: '#2F9C66',    // the saturated end of a green gradient
  greenMuted: '#3E8F63',   // green calmed down for the lowest tier
  greenPale: '#A9E3C4',    // green on a dark ground (eyebrows, labels)
  greenWash: '#E4F5EC',    // green on a light ground (pills, panels)
  charcoal: '#2A2C31',     // the calmest ground
  charcoalLight: '#45484F',
  ink: '#232735',
  muted: '#5A6272',
};

/**
 * Font stacks. `latin`/`urdu` differ only in which family is asked for FIRST —
 * both always list both, so neither script can ever fall through to nothing.
 */
const FONTS = {
  headLatin: "'Fraunces','NastaliqUrdu',serif",
  headUrdu: "'NastaliqUrdu','Fraunces',serif",
  bodyLatin: "'Lexend','NastaliqUrdu',sans-serif",
  bodyUrdu: "'NastaliqUrdu','Lexend',sans-serif",
};

function headFamily(rtl) { return rtl ? FONTS.headUrdu : FONTS.headLatin; }
function bodyFamily(rtl) { return rtl ? FONTS.bodyUrdu : FONTS.bodyLatin; }

/** A diamond = the logo's nuqta = a square rotated 45°. */
function diamondPath(cx, cy, r) {
  return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;
}

/**
 * The lattice, drawn rather than pasted.
 *
 * The brand book ships the pattern only as page rasters, so a fixed image
 * would be a low-resolution crop stretched to whatever box it lands in. Drawn
 * as a tiling SVG pattern it stays crisp at any size and the density can be
 * turned down to the "whisper" the book uses behind content, as opposed to the
 * loud version it uses on promotional covers.
 *
 * @param {object} o
 * @param {string} [o.id] unique per document — two patterns sharing an id in
 *        one document would resolve to whichever was parsed first.
 * @param {string} [o.line] stroke colour; per the book, one colour per ground.
 * @param {number} [o.opacity]
 */
function latticeSvg({ id = 'niete-lattice', line = PALETTE.green, opacity = 0.16, className = 'lattice' } = {}) {
  const big = diamondPath(60, 60, 60);
  const corners = [diamondPath(0, 0, 60), diamondPath(120, 0, 60), diamondPath(0, 120, 60), diamondPath(120, 120, 60)].join('');
  const mid = [diamondPath(60, 0, 15), diamondPath(0, 60, 15), diamondPath(120, 60, 15), diamondPath(60, 120, 15)].join('');
  const cluster = [diamondPath(30, 30, 8), diamondPath(90, 30, 8), diamondPath(30, 90, 8), diamondPath(90, 90, 8)].join('');
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" aria-hidden="true">`
    + `<defs><pattern id="${id}" width="120" height="120" patternUnits="userSpaceOnUse">`
    + `<g fill="none" stroke="${line}" stroke-width="1" opacity="${opacity}">`
    + `<path d="${big}"/><path d="${corners}"/><path d="${mid}"/><path d="${cluster}"/>`
    + `</g></pattern></defs>`
    + `<rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
}

/**
 * A single diamond marker — the brand's replacement for a round bullet AND for
 * the tick/circle glyphs an option list would otherwise use. Drawn, never
 * typed: a symbol character depends on a font that covers it, which is exactly
 * how a previous card ended up printing empty boxes where its stars should be.
 */
function diamondSvg({ size = 10, fill = 'none', stroke = PALETTE.green, width = 1.4, className = 'dia' } = {}) {
  const r = size / 2;
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`
    + `<path d="${diamondPath(r, r, r - width / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/></svg>`;
}

/**
 * The book's audience lockup — a letterspaced descriptor line with two green
 * diamond nuqtas after it. Urdu has no case and letterspacing breaks its
 * joining, so the Urdu form is set plainly; that difference is in the CSS the
 * caller writes, this only builds the markup.
 */
function lockup(text, { className = 'lockup', dotColor = PALETTE.green } = {}) {
  const dots = `${diamondSvg({ size: 7, fill: dotColor, stroke: dotColor, width: 0, className: 'dia nuqta' })}`
    + `${diamondSvg({ size: 7, fill: dotColor, stroke: dotColor, width: 0, className: 'dia nuqta' })}`;
  return `<div class="${className}"><span>${text}</span>${dots}</div>`;
}

module.exports = { PALETTE, FONTS, headFamily, bodyFamily, latticeSvg, diamondSvg, diamondPath, lockup };
