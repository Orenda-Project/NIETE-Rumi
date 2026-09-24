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
 * THE TYPE FLOOR for every teacher-facing rendered artefact (PLAN_R5 D6,
 * raised by PLAN_R6 D4).
 *
 * Not a house preference — a measured readability floor, taken whole from the
 * 6-12 lesson plans, which arrived at it the hard way. Their body type went
 * 16.5px -> 18px on 2026-09-01 because 16.5 still could not be read on a phone
 * ("the LP body type is still not readable on a phone — make it larger"), and
 * the page cap was allowed to grow instead: the floor is the hard constraint,
 * the page count is what gives. See
 * `.claude/skills/curriculum-baked-lesson-plans/scripts/lp_html/lint_lp.js`
 * (BODY 18 / CHIP 14) and its `phone_gate.py` (rasterise -> 390px -> look).
 *
 * Measured in CSS px at a 794px A4 page width, which is what both of this
 * repo's teacher artefacts render at.
 *
 *   body   every block of running text the teacher reads: a stem, an option, a
 *          summary, a guidance sentence, a name, a score.
 *   small  captions and chips — subordinate text, still read.
 *   label  the absolute floor. NOTHING in the document may be smaller,
 *          section labels and letter markers included.
 *
 * WHY 21 AND NOT 18. An A4 page is 794 CSS px wide and a phone opening it
 * full-width gives it 390, so every glyph on the page is multiplied by
 * 390/794 = 0.4912 before anyone reads it. 18px body was 8.8px in the hand;
 * the operator read the live pre-send PDF at that size and said it was "still
 * a bit small… make it a little bigger, without affecting the design". 21 /
 * 16.5 / 15.5 is +17% on all three and lands body at 10.3px on the phone.
 * The A4 page and the layout are unchanged — only the type and the boxes
 * drawn around individual glyphs grew.
 *
 * Urdu needs about 15% more than Latin at the same apparent size, because
 * Nastaliq's x-height sits low in its em box. That bump is `RTL_TYPE_SCALE`
 * and the numbers it produces are `TYPE_FLOOR_UR`, exported here rather than
 * recomputed per template: the pre-send PDF was scaling Urdu by 1.15 while the
 * class report scaled it by 1.055 (19px against an 18px body), and neither
 * file could see the other — the same drift the floor itself exists to stop.
 *
 * One object, exported once, because three templates each carrying their own
 * idea of "readable" is exactly how the report came to run at 11px while the
 * PDF ran at 9.5px and both believed they were fine.
 */
const TYPE_FLOOR = { body: 21, small: 16.5, label: 15.5 };

/** Nastaliq at the same nominal size reads smaller; RTL scales UP from the
 *  floor, never down towards it. */
const RTL_TYPE_SCALE = 1.15;

const round1 = (n) => Math.round(n * 10) / 10;
const TYPE_FLOOR_UR = {
  body: round1(TYPE_FLOOR.body * RTL_TYPE_SCALE),    // 24.2px
  small: round1(TYPE_FLOOR.small * RTL_TYPE_SCALE),  // 19px
  label: round1(TYPE_FLOOR.label * RTL_TYPE_SCALE),  // 17.8px
};

/**
 * The two steps ABOVE the body floor that both teacher documents share, so a
 * question stem in the pre-send PDF and a missed-question heading in the class
 * report are the same size on the same page of the same teacher's phone.
 * Ratios preserved from the round-5 design (stem 21/18, name 19/18) so raising
 * the floor moves the whole scale without redrawing it.
 */
const TYPE_STEP = {
  headline: round1(TYPE_FLOOR.body * (21 / 18)),   // 24.5px — a question stem / a missed question
  name: round1(TYPE_FLOOR.body * (19 / 18)),       // 22.2px — the teacher's name, a reteach sentence
};
const TYPE_STEP_UR = {
  headline: round1(TYPE_STEP.headline * RTL_TYPE_SCALE),  // 28.2px
  name: round1(TYPE_STEP.name * RTL_TYPE_SCALE),          // 25.5px
};

/**
 * Display headings grow more slowly than body type on purpose: a hero title
 * was already comfortably legible on a phone at 30px (14.7px in the hand), so
 * matching body's +17% would swell it without helping anyone read anything.
 * PLAN_R6 D4: headings and eyebrows +12%.
 */
const HEAD_SCALE = 1.12;

/**
 * Leading for LATIN type is optical, and larger type needs proportionally less
 * of it. `leadingAt(r)` converts a ratio tuned at the old 18px floor into the
 * one that keeps the same absolute gap between baselines at the 21px floor:
 *
 *     newRatio = 1 + (oldRatio - 1) / (21 / 18)
 *
 * It is NOT right for Nastaliq, which is where it used to be applied (1.85 ->
 * 1.73, 1.72 -> 1.62, 1.5 -> 1.43, 1.9 -> 1.77). Nastaliq's line needs a fixed
 * multiple of its size, set by the font's ink — see NASTALIQ below — and every
 * one of those shrunken ratios printed Urdu lines on top of each other. The
 * templates still write those ratios into their base stylesheet: with the Urdu
 * spacing switched on (the default, urduSpacingV2 below) a block of NASTALIQ
 * rules is appended over them; switched off, they are what renders.
 */
const TYPE_GROWTH = 21 / 18;
const leadingAt = (oldRatio) => Math.round((1 + (oldRatio - 1) / TYPE_GROWTH) * 100) / 100;

/**
 * NASTALIQ SPACING — set from the font's measured INK, not by eye, and the same
 * multiple at every size.
 *
 * "Right now it's on top of each other." Every quiz surface draws Urdu in Noto
 * Nastaliq Urdu. One line of it inks from 1.3-2.0 em above its baseline (the
 * tall ک گ ل ٹ, and the stacked joins that climb from right to left) to 0.4-0.7
 * em below it (the tails of ے ں ی and the bowls of ح ع م). Two lines therefore
 * need a baseline pitch of about ascent + descent — 2.2-2.5 em — or the second
 * line's strokes run into the first line's tails. That is a property of the
 * typeface, not of the size, so it is a ratio that does NOT fall as the type
 * grows (the leadingAt() mistake above).
 *
 * The numbers were measured on 1,000 real Urdu quiz stems and 2,750 real options
 * set in each surface's own style, reading the ink of each rendered line pixel
 * by pixel (tests/quiz/helpers/line-ink.js does the same in the tests):
 *
 *   leading.regular  2.4   at most 1% of real line pairs come within 0.05 em
 *                          (at the old 1.43-1.77, 51-77% did; at 2.0, 8-18%)
 *   leading.bold     2.5   Bold Nastaliq climbs higher and hangs lower: stems,
 *                          the correct option, answer chips — at most 2% (at
 *                          the old 1.73, 77% of stem line pairs touched)
 *
 * What it costs is mostly NOT the pitch: one line of Nastaliq inks ~2.5 em top
 * to bottom whatever its line-height, so a box that holds one line whole (an
 * option row, a chip) is that tall at any pitch. Measured on the 8-question
 * Urdu pre-send PDF, 2.3 and 2.4 print the same number of pages.
 *
 *   ink              how far the p98 of that text reaches above/below the
 *                    baseline, per face — what a BOX around one line has to
 *                    hold so its border never cuts through a letter.
 *
 *   startRoom        a word that BEGINS with ک or گ carries a stroke that
 *                    overhangs the start of its own text by up to 0.45 em
 *                    (Bold; 0.38 Regular; the most on any real quiz line). A
 *                    box that clips sideways — the ellipsis on a name — cut it
 *                    off, so «کشف» printed as «لشف». A clipped Urdu label keeps
 *                    this much room on its start side.
 *
 * Where the baseline sits: the face's own line box is 2.5 em (hhea ascent
 * 1.904 + descent 0.596). Chromium centres that box in the CSS line box, so on
 * line-height L the baseline is L/2 + BASELINE_SHIFT below the top of the line
 * and L/2 - BASELINE_SHIFT above its bottom.
 */
const NASTALIQ = Object.freeze({
  BASELINE_SHIFT: (1.904 - 0.596) / 2,   // 0.654 em
  leading: Object.freeze({ regular: 2.4, bold: 2.5 }),
  startRoom: 0.5,   // em
  ink: Object.freeze({
    regular: Object.freeze({ ascent: 1.87, descent: 0.6 }),
    bold: Object.freeze({ ascent: 2.05, descent: 0.69 }),
  }),
});

/**
 * THE URDU SPACING KILL SWITCH. Opt-OUT, read at render time, never cached.
 *
 * QUIZ_URDU_SPACING_V2 unset (or any other value): every quiz surface draws Urdu
 * on the NASTALIQ spacing. 'false' / '0' / 'off' / 'no': every quiz surface
 * renders exactly as it did before that spacing existed — the teacher sheet,
 * the class report, the question card, the scorecard and the class card each
 * append their spacing as ONE block over an unchanged stylesheet, so switching
 * it off drops the block and nothing else. One variable, no deploy.
 *
 * Opt-out because the default has to be the fix: an opt-in flag would leave the
 * Urdu lines on top of each other on any service where nobody set it.
 * @returns {boolean}
 */
function urduSpacingV2() {
  const v = String(process.env.QUIZ_URDU_SPACING_V2 == null ? '' : process.env.QUIZ_URDU_SPACING_V2).trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(v);
}

/**
 * The padding (em of the box's own font size) a box needs above and below
 * Nastaliq set on `lineHeight` so the ink stays `clear` em inside its edges —
 * an option row's border, a chip's fill, a clipped label. Where the line box
 * already holds the ink the answer is just the clearance.
 * @param {number} lineHeight  the unitless line-height the text is set on
 * @param {'regular'|'bold'} [weight]
 * @param {number} [clear=0.08]
 * @returns {{top:number, bottom:number}}  em, rounded to 0.01
 */
function nastaliqPad(lineHeight, weight = 'regular', clear = 0.08) {
  const ink = NASTALIQ.ink[weight] || NASTALIQ.ink.regular;
  const above = lineHeight / 2 + NASTALIQ.BASELINE_SHIFT;   // line top -> baseline
  const below = lineHeight / 2 - NASTALIQ.BASELINE_SHIFT;   // baseline -> line bottom
  const r = (n) => Math.round(Math.max(0, n) * 100) / 100;
  return { top: r(ink.ascent - above + clear), bottom: r(ink.descent - below + clear) };
}

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

/**
 * The script a piece of text is WRITTEN in — not the language it was chosen
 * in. `'ur'` when any Perso-Arabic letter is present, `'en'` otherwise.
 *
 * The two are independent facts and conflating them is the bug this exists to
 * kill: a child types "Ali" into an Urdu quiz and a child types "عائشہ" into
 * an English one, and both are ordinary. Keying a name's font and direction
 * off the quiz's language puts Latin letters through Nastaliq metrics (which
 * lays them out as if they joined) and Perso-Arabic through a Latin-first
 * stack, which on the render container has no glyphs for it at all.
 *
 * The class is deliberately LETTERS only. The Arabic block also carries
 * punctuation (، ؛ ؟) and Eastern-Arabic digits (۰۱۲۳), and those turn up
 * inside otherwise-Latin strings — a date or a score should not flip a whole
 * element into Nastaliq.
 */
const PERSO_ARABIC_LETTER = /[\u0620-\u064A\u066E-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FF\u0750-\u077F\u08A0-\u08BD\uFB50-\uFDFB\uFE70-\uFEFC]/;

function scriptOf(text) {
  return PERSO_ARABIC_LETTER.test(String(text === null || text === undefined ? '' : text)) ? 'ur' : 'en';
}

/** The writing direction that follows from scriptOf(). */
function dirOf(text) { return scriptOf(text) === 'ur' ? 'rtl' : 'ltr'; }

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

module.exports = {
  PALETTE, FONTS, TYPE_FLOOR, TYPE_FLOOR_UR, RTL_TYPE_SCALE, TYPE_STEP, TYPE_STEP_UR, HEAD_SCALE,
  leadingAt, NASTALIQ, nastaliqPad, urduSpacingV2,
  headFamily, bodyFamily, scriptOf, dirOf,
  latticeSvg, diamondSvg, diamondPath, lockup,
};
