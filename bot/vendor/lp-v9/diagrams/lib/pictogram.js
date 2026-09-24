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

// ─── VENDOR DIVERGENCE — see SYNC.md §3.18 ───────────────────────────────────
// Two MANIPULATIVES, drawn here as geometry rather than taken from OpenMoji.
//
// A grade 1-5 maths lesson counts with counters and tiles far more than with
// any noun: across the ICT grade 1-5 maths slide scripts the token `counter`
// alone appears 2,317 times, `dot` 604, `sq`/`square`/`tile` 347, `bead` 58,
// `marble` 59 — and the set had none of them, so a quiz could not draw the
// objects the class actually counted. OpenMoji has no counter (its "black
// circle" is an emoji of a circle), and a counter is not art: it is a disc.
//
// A third, `stick`, overrides the OpenMoji glyph of that name (see below).
//
// Painted like the ten-frame's own counters (count_frame.js): an accent disc
// with an ink rim, so a counter looks the same in every type that draws one.
// The tile is a square in the cool token, so a row of tiles never reads as a
// row of counters. Neither is licensed from anyone; both are listed by
// `names()` beside the OpenMoji roster, and `build_pictograms.js` never
// touches them (it rewrites only `index.json`).
const LOCAL_GLYPHS = {
  counter: '<circle data-ov="skip" cx="36" cy="36" r="26" fill="var(--amber, #F2A20C)" stroke="currentColor" stroke-width="3"/>'
    + '<circle data-ov="skip" cx="36" cy="36" r="15" fill="none" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="3"/>',
  tile: '<rect data-ov="skip" x="11" y="11" width="50" height="50" rx="5" fill="var(--cool, #1B6CA8)" fill-opacity="0.8" stroke="currentColor" stroke-width="3"/>',
  // A counting STICK — the thin stick a class bundles into tens, painted like
  // base_ten's loose sticks. It REPLACES the OpenMoji glyph filed under "stick",
  // which is that set's "wood": a log, never what a maths lesson counted.
  stick: '<rect data-ov="skip" x="31" y="5" width="10" height="62" rx="5" fill="var(--clay, #B5651D)" stroke="currentColor" stroke-width="2.5"/>',
  // ─── VENDOR DIVERGENCE — see SYNC.md §3.20 ─────────────────────────────────
  // Three things the grade 1-5 maths lessons count that OpenMoji has no glyph
  // for (a DATE, a SAMOSA, a BANGLE), drawn here in OpenMoji's own line-art
  // manner — outline only, currentColor ink, stroke 2, round caps — so a row of
  // them sits beside the OpenMoji nouns as one set. `data-part` names each
  // stroke so a test can hold the drawing to what makes it that thing.
  //
  // A date: a plump oval with its cap and stem at the top and three wrinkles
  // across it — the wrinkles are what keep it from reading as a bean, a seed
  // or an egg.
  date: [
    `<path data-part="body" ${SKIP} d="M45.4,14.8 C52.8,17.8 54.6,30.6 49.4,43.4 C44.3,56.2 34.1,64.2 26.6,61.2 C19.2,58.2 17.4,45.4 22.6,32.6 C27.7,19.8 37.9,11.8 45.4,14.8 Z"/>`,
    `<path data-part="cap" ${SKIP} d="M37.7,16.6 Q46.3,12.5 49.7,21.4"/>`,
    `<path data-part="stem" ${SKIP} d="M45.6,14.4 L48.6,10.7"/>`,
    `<path data-part="wrinkle" ${SKIP} d="M32.7,24.8 Q38.8,31 42.7,28.8"/>`,
    `<path data-part="wrinkle" ${SKIP} d="M26.6,33.1 Q35.1,40.3 39.8,38.4"/>`,
    `<path data-part="wrinkle" ${SKIP} d="M23.9,43.9 Q30.9,50.5 35.2,48.5"/>`,
  ].join(""),
  // A samosa: a plump triangle — sides that bulge, corners that round — with
  // the seam where the pastry was folded shut, its pinch marks, and the
  // blisters of fried pastry. A straight-sided triangle read as a tent.
  samosa: [
    `<path data-part="body" ${SKIP} d="M36,10.5 C31,10.5 11.5,46 11.5,53.5 C11.5,58.5 15,61 20,61 L52,61 C57,61 60.5,58.5 60.5,53.5 C60.5,46 41,10.5 36,10.5 Z"/>`,
    `<path data-part="seam" ${SKIP} d="M36,11.5 C33.5,28 32,45 31,61"/>`,
    `<path data-part="pinch" ${SKIP} d="M32.2,24 L36.4,25.2 M31.3,34 L35.5,35 M30.7,44 L34.9,44.8 M30.2,53.5 L34.4,54.1"/>`,
    `<circle data-part="blister" data-ov="skip" cx="44" cy="40" r="1.6" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    `<circle data-part="blister" data-ov="skip" cx="48.5" cy="51" r="1.6" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    `<circle data-part="blister" data-ov="skip" cx="21.5" cy="50" r="1.6" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
  ].join(""),
  // A bangle: a thin band tilted towards the reader — its rim, the hole through
  // it, the band's depth at the front, and the dots worked into the band — so
  // it reads as a bracelet, not as a ring with a stone or a tyre.
  bangle: [
    `<ellipse data-part="rim" ${SKIP} cx="36" cy="32" rx="28" ry="15"/>`,
    `<ellipse data-part="hole" ${SKIP} cx="36" cy="32" rx="24" ry="11.5"/>`,
    `<path data-part="band" ${SKIP} d="M8,32 L8,36 C8,44.3 20.5,51 36,51 C51.5,51 64,44.3 64,36 L64,32"/>`,
    `<circle data-part="bead" data-ov="skip" cx="20" cy="46.3" r="1.5" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    `<circle data-part="bead" data-ov="skip" cx="36" cy="49" r="1.5" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
    `<circle data-part="bead" data-ov="skip" cx="52" cy="46.3" r="1.5" fill="currentColor" stroke="currentColor" stroke-width="1"/>`,
  ].join(""),
};

// The lesson's own words for those two things. A slide script writes the same
// counter as [dot], [bead], [marble] or [circle], and a tile as [sq] or
// [square]; an author reading the lesson will reach for the lesson's word.
// Resolved here, once, so every type that draws a pictogram accepts them —
// never listed in `names()`, which stays the roster of distinct pictures.
const ALIASES = {
  dot: "counter", bead: "counter", marble: "counter", circle: "counter",
  sq: "tile", square: "tile",
  // VENDOR DIVERGENCE (SYNC.md §3.20): the lessons' other words for the objects
  // added there — a biscuit is the cookie, a toffee, candy or laddu is a sweet,
  // a pebble is the stone.
  biscuit: "cookie", candy: "sweet", toffee: "sweet", laddu: "sweet", pebble: "stone",
};

/** 'Red Apple' / 'red-apple' / ' apple ' all address the same glyph; an alias addresses its picture. */
function key(name) {
  const k = String(name == null ? "" : name).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return Object.prototype.hasOwnProperty.call(ALIASES, k) ? ALIASES[k] : k;
}

/** Every pictogram name, sorted. This IS the roster an author is shown. */
function names() {
  return [...new Set([...Object.keys(INDEX.glyphs), ...Object.keys(LOCAL_GLYPHS)])].sort();
}

function has(name) {
  const k = key(name);
  return Object.prototype.hasOwnProperty.call(INDEX.glyphs, k)
    || Object.prototype.hasOwnProperty.call(LOCAL_GLYPHS, k);
}

/** The glyph's inner markup (no <svg> wrapper), cached. */
function inner(name) {
  const k = key(name);
  if (cache.has(k)) return cache.get(k);
  if (Object.prototype.hasOwnProperty.call(LOCAL_GLYPHS, k)) {
    cache.set(k, LOCAL_GLYPHS[k]);
    return LOCAL_GLYPHS[k];
  }
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
