// Pictograms — the early-years half of the engine's vocabulary.
//
// A pictogram is a line drawing of a concrete noun (a cat, an apple, a bus).
// The 6-12 roster needs none: a Bohr atom is drawn from its own numbers. A
// grade-1 question cannot be — "how many apples?" needs apples, "which letter
// is missing from c_t?" needs the cat that tells the child the word. So this
// module is what `count_objects`, `word_blank`, `pattern`, `match`,
// `count_frame` and `clock` draw with.
//
// It is DATA, not generation: 139 vendored OpenMoji line-art glyphs on a fixed
// 0 0 72 72 grid (assets/pictograms/), built and normalised by
// assets/pictograms/build_pictograms.js, which documents every normalisation
// step. Nothing here fetches, and a name the set lacks THROWS — the calling
// type surfaces it as a render error with the roster attached, so the author is
// told which nouns exist instead of being handed a blank box.
//
// Attribution rides with the picture: `descLine()` is written into the figure's
// own <desc> by every type that draws one (CC BY-SA 4.0 requires the credit to
// travel with the work, and a figure is delivered as a bare PNG to a phone —
// there is no page around it to carry a footnote).

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "assets", "pictograms");
const INDEX = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
const GRID = 72; // every glyph's viewBox is asserted to be "0 0 72 72" at build time

/** OpenMoji draws at stroke-width 2 on a 72 grid. Below this many user units a
 *  stroke greys out on a 360 dp phone, so it is thickened as the glyph shrinks. */
const MIN_STROKE_UNITS = 1.7;

const cache = new Map();

// VENDOR DIVERGENCE (SYNC.md §3.17): glyphs this deployment draws itself instead
// of the vendored OpenMoji line art, because the line art does not read as the
// noun at a child's phone size.
//
// THE BACKPACK (`bag`, `bag_school`). OpenMoji's black backpack is an arch with
// a bar across it and a loop on top — no straps, no pocket — and a counting
// question showing three of them ("تصویر میں کتنے بستے ہیں؟") was read as three
// lanterns or birdcages. This one is drawn to the same contract as every built
// glyph (72-unit grid, currentColor ink, stroke 2, round caps, data-ov="skip")
// with the four things that make the silhouette a school bag: a rounded body,
// the two shoulder straps bowing out at its sides, a carry handle, and a front
// pocket with its flap and tab. `data-part` names each piece so a test can hold
// the drawing to that description.
const SKIP = 'data-ov="skip" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"';
const BACKPACK = [
  `<path data-part="strap" ${SKIP} d="M19,27 C12.5,31 11,45 13,56 C13.6,59.2 15.6,61 18.5,61"/>`,
  `<path data-part="strap" ${SKIP} d="M53,27 C59.5,31 61,45 59,56 C58.4,59.2 56.4,61 53.5,61"/>`,
  `<path data-part="handle" ${SKIP} d="M31,17 V12 A3,3 0 0 1 34,9 H38 A3,3 0 0 1 41,12 V17"/>`,
  `<path data-part="body" ${SKIP} d="M19,60 V31 A14,14 0 0 1 33,17 H39 A14,14 0 0 1 53,31 V60 A4,4 0 0 1 49,64 H23 A4,4 0 0 1 19,60 Z"/>`,
  `<path data-part="pocket" ${SKIP} d="M25,42 H47 V55 A3,3 0 0 1 44,58 H28 A3,3 0 0 1 25,55 Z"/>`,
  `<path data-part="flap" ${SKIP} d="M25,42 C29,49 43,49 47,42"/>`,
  `<path data-part="tab" ${SKIP} d="M36,47 V51"/>`,
].join("");
const OWN_GLYPHS = { bag: BACKPACK, bag_school: BACKPACK };

/** 'Red Apple' / 'red-apple' / ' apple ' all address the same glyph. */
function key(name) {
  return String(name == null ? "" : name).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Every pictogram name, sorted. This IS the roster an author is shown. */
function names() {
  return Object.keys(INDEX.glyphs).sort();
}

function has(name) {
  return Object.prototype.hasOwnProperty.call(INDEX.glyphs, key(name));
}

/** The glyph's inner markup (no <svg> wrapper), cached. */
function inner(name) {
  const k = key(name);
  if (cache.has(k)) return cache.get(k);
  if (Object.prototype.hasOwnProperty.call(OWN_GLYPHS, k) && has(k)) {
    cache.set(k, OWN_GLYPHS[k]);
    return OWN_GLYPHS[k];
  }
  const entry = INDEX.glyphs[k];
  if (!entry) {
    // BOUNDED on purpose. The full roster is already in the author prompt, and
    // this message is quoted verbatim into the retry — pasting all 255 names
    // back at the model spends the retry's budget on something it has, and
    // buries the one fact it needs. A near-miss is offered instead, since the
    // model's misses are near ones ("pig" when the set had "pig_face").
    const near = names().filter((n) => n.includes(k) || k.includes(n)).slice(0, 6);
    throw new Error(
      `unknown pictogram "${name}" — it is not one of the ${names().length} nouns in the set`
      + (near.length ? ` (did you mean: ${near.join(", ")}?)` : "")
    );
  }
  const raw = fs.readFileSync(path.join(DIR, "svg", entry.file), "utf8");
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  cache.set(k, body);
  return body;
}

/** The line CC BY-SA 4.0 asks for, written into the figure's <desc>. */
function descLine() {
  return `Pictograms: OpenMoji ${INDEX.version} (CC BY-SA 4.0), openmoji.org`;
}

/**
 * Draw one pictogram into `svg`, its 72x72 grid scaled to fit `size` and its
 * top-left corner at (x, y).
 *
 * The glyph's own elements all carry data-ov="skip" (set at build time): the
 * pictogram's FOOTPRINT is the thing layout must respect, and the caller
 * reserves that box — a cat's whiskers are not rules running through a label.
 * Callers therefore keep labels outside the box they passed here, and the
 * engine's collision contract still holds for everything the type itself draws.
 *
 * @param {object} svg   an Svg builder
 * @param {number} x     left of the glyph box
 * @param {number} y     top of the glyph box
 * @param {number} size  the box is size x size user units
 * @param {string} name  a name from names()
 * @param {{color?: string}} [o]
 * @returns {object} svg, for chaining
 */
function drawPictogram(svg, x, y, size, name, o = {}) {
  const s = size / GRID;
  let body = inner(name);
  // A literal colour, substituted here rather than inherited. This SVG is
  // screenshotted standalone; a `currentColor` that depends on an ancestor's
  // `color` is a colour that can come back black on one renderer and right on
  // another. The build normalises every paint to currentColor precisely so
  // that this one substitution owns the decision.
  const color = o.color || "var(--ink, #1A1A1A)";
  body = body.replace(/currentColor/g, color);
  // Keep the ink visible as the glyph shrinks: OpenMoji strokes at 2 units on
  // the 72 grid, which is 2*s in the diagram's own units.
  const bump = Math.max(1, MIN_STROKE_UNITS / (2 * s));
  if (bump > 1) {
    body = body.replace(/stroke-width="([\d.]+)"/g, (m, w) => `stroke-width="${+(Number(w) * bump).toFixed(3)}"`);
  }
  const r2 = (v) => Math.round(v * 1000) / 1000;
  return svg.add(`<g transform="translate(${r2(x)},${r2(y)}) scale(${r2(s)})">${body}</g>`);
}

module.exports = { names, has, key, inner, drawPictogram, descLine, GRID, INDEX };
