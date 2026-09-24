'use strict';
/**
 * Transcript quiz — PICTURE QUESTIONS.
 *
 * A picture question is a normal three-option question that carries a `figure`:
 * a deterministic diagram spec the vendored 6-12 diagram engine
 * (bot/vendor/lp-v9/diagrams) turns into an SVG. Nothing here is generative —
 * the model chooses a type and its numbers, the engine draws it, and every
 * drawing is the same drawing every time.
 *
 * The chain a figure walks:
 *
 *   author emits {type, …spec}
 *     → canonicalType()      is it on the phone-safe allowlist?
 *     → renderFigureSvg()    does the engine draw it, with zero label collisions?
 *     → figureLeaksAnswer()  does the picture already say the answer?
 *     → renderFigurePng()    1080x565, fonts embedded, framed with the quiz chrome
 *     → uploadFigure()       one R2 object per question
 *     → quiz_questions.media.question_image, render_pattern 'P3'
 *
 * The child then gets ONE interactive message per question: image header, stem
 * body, three reply buttons — never a picture after the options, never a
 * picture the question does not need. The picture carries the same chrome as a
 * question card — "Question n of N" and the NIETE mark — so a picture question
 * looks like the rest of the quiz (see FRAME below).
 *
 * Pure and synchronous down to renderFigurePng (the engine is synchronous), so
 * the validator can run the render gate inline.
 */

const path = require('path');
const { renderDiagram, checkOverlaps } = require('../../../vendor/lp-v9/diagrams');
const { SIZE } = require('../../../vendor/lp-v9/diagrams/lib/tokens');
const MANIFEST = require('../../../vendor/lp-v9/diagrams/types_manifest.json');
const { fontCss } = require('../../../vendor/lp-v9/lib/fonts');
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');
const { logEvent } = require('../../utils/structured-logger');

/**
 * The types that survive a 1080px-wide picture on a mid-range Android phone AND
 * are safe to hand a flash-tier model. Order is the order the author sees them.
 *
 * Deliberately excluded, and why:
 *   illustrative     a brief for an image generator, not a drawing
 *   labelled_figure  needs a raster we do not have for a lesson transcript
 *   mindmap          leaks by construction — the branches ARE the answer
 *   panels           prose in a box; a child reads it as text, not a picture
 *   dna_helix        decorative, nothing to read off it
 */
const ALLOWED_TYPES = [
  'numberline', 'fraction_bar', 'grid', 'geometry', 'graph', 'chem_equation', 'circuit',
  'free_body', 'atom', 'punnett', 'ray_diagram', 'flow', 'timeline', 'cell', 'molecule',
  // ── the early-years half of round 5 ────────────────────────
  // The fifteen above are the 6-12 lesson-plan roster: they draw quantity,
  // structure and process, and a grade-1 phonics or counting lesson could not
  // reach any of them. The operator: "the computation of pictures can come in
  // handy at any stage — fill in the blanks, or phonics questions, or spelling
  // questions, or questions where an image of a cat is shown and then c _ t is
  // written in big alphabets". These eight are that stage, drawn by our own
  // engine over a vendored open-licence pictogram set
  // (bot/vendor/lp-v9/diagrams/assets/pictograms, CC BY-SA 4.0). Coverage was
  // counted, not guessed: across the ICT K-5 segmentation `match` alone serves
  // 360 segments and `word_blank` 257, against 121 for every existing drawable
  // type put together (the option-space study).
  'word_blank', 'count_objects', 'count_frame', 'clock', 'pattern', 'match', 'money', 'compare_size',
  // Place value, drawn the way the class built it — bundles of sticks, or flats,
  // rods and cubes. The grade 1-5 slide scripts draw it on nearly every
  // place-value page and no other type could (a "1 hundred" or a "0 tens" is
  // not something count_objects will draw).
  'base_ten',
];

/**
 * The early-years types, on their own. They are offered to the AUTHOR only for a
 * grade 1-5 lesson: a grade 9 chemistry quiz has no use for a ten-frame, and
 * every type in the prompt is tokens spent plus one more shape the model can
 * reach for wrongly. They stay on ALLOWED_TYPES for every grade, because the
 * validator's job is to accept a legal figure, not to re-litigate the grade.
 */
const EARLY_YEARS_TYPES = [
  'word_blank', 'count_objects', 'count_frame', 'clock', 'pattern', 'match', 'money', 'compare_size',
  'base_ten',
];

/** ALLOWED_TYPES minus the early-years types — the 6-12 roster. */
const CORE_TYPES = ALLOWED_TYPES.filter((t) => !EARLY_YEARS_TYPES.includes(t));

/**
 * `molecule` was off this list because "SMILES from a flash model is a gamble":
 * a SMILES that will not parse degrades silently to a formula card, and one
 * that parses to the WRONG structure is drawn as confidently as the right one.
 * Round 4 re-admits it with the gamble removed — the model may only name a
 * formula from a fixed dictionary in transcript-quiz-figure-science.js, and the
 * SMILES (or the ionic flag) is then written by CODE, not by the model
 * (PLAN_R4 D7f).
 */

/**
 * Per-type spec defaults for the PHONE lane.
 *
 * The engine is designed for a 750px lesson-plan column. Where a manifest
 * minimal spec depends on that column to fit its labels, the difference shows
 * up as a clipped label — which checkOverlaps reports as a collision against
 * the paper. `geometry` is the live case: without a height its side label hangs
 * off the left edge. Anything the author sets wins over these.
 */
const TYPE_DEFAULTS = {
  geometry: { height: 340 },
  // A fraction bar prints "3/4" beside itself, computed from shaded/parts, with
  // no label anywhere in the spec. On a quiz that IS the answer, and reading
  // only the spec would certify it as hidden. Off by default here; an author
  // who genuinely wants the value shown can set showLabels back on, and the
  // leak check then reads it off the drawing.
  fraction_bar: { showLabels: false },
  // Same story for a hundred square: it builds its own readout
  // ("37/100 = 37% = 0.37") from rows/cols/shaded. An empty legend suppresses
  // it; an author who wants it can pass one.
  grid: { legend: '' },
};

/**
 * Set on every quiz figure whatever the author wrote. The stem and the options
 * print numerals 0-9 in every language (the contract), so a figure's numbers
 * do too: the engine's Urdu-page default draws a fraction bar's values in Urdu
 * digits, and on staging a remade grade 4 Urdu quiz showed "۲/۹" in the bar
 * beside "2/9" in the stem. (numberline already draws Latin digits unless told
 * otherwise; this keeps it that way.)
 */
const QUIZ_FIXED = {
  fraction_bar: { urduDigits: false },
  numberline: { urduDigits: false },
};

/**
 * A bar name that only repeats the value drawn beside it is dropped, at draw
 * time (the stored spec is untouched). The same staging figure labelled every
 * bar twice — the value in the gutter and the same fraction as its name —
 * because the author named each bar with its own fraction and turned the
 * values on. With the values off (the quiz default) the name is the only label
 * and is kept; whether it may show is the leak check's business.
 */
function withoutRepeatedBarNames(merged) {
  if (canonicalType(merged.type) !== 'fraction_bar' || !Array.isArray(merged.bars)) return merged;
  const unitMode = merged.model === 'unit' || !!merged.unitLabel;
  const valuesShown = merged.showLabels === true || (merged.showLabels !== false && !unitMode);
  if (!valuesShown) return merged;
  const flat = (s) => norm(s).replace(/\s+/g, '');
  const bars = merged.bars.map((b) => {
    if (!b || typeof b !== 'object' || typeof b.label !== 'string' || !b.label.trim()) return b;
    const shaded = Array.isArray(b.shaded) ? b.shaded.length : Number(b.shaded);
    const value = b.value !== undefined && b.value !== '' ? String(b.value) : `${shaded}/${Number(b.parts)}`;
    if (flat(b.label) !== flat(value)) return b;
    const { label, ...rest } = b; // eslint-disable-line no-unused-vars
    return rest;
  });
  return { ...merged, bars };
}

/**
 * Defaults that depend on the QUIZ LANGUAGE. A place-value mat's column heads
 * are words a child reads, so they come from the string catalog like every
 * other child-facing word (root rule 20), never from the engine's own
 * fallback. Anything the author sets wins; the stored spec is never changed,
 * so the teacher PDF's re-draw injects the same heads again.
 */
function languageDefaults(type, language) {
  if (type !== 'base_ten') return {};
  const { resolveUx } = require('../../config/ux-strings');
  const lang = clampLanguage(language);
  return {
    labels: {
      thousands: resolveUx('tqPlaceThousands', { language: lang }),
      hundreds: resolveUx('tqPlaceHundreds', { language: lang }),
      tens: resolveUx('tqPlaceTens', { language: lang }),
      ones: resolveUx('tqPlaceOnes', { language: lang }),
    },
  };
}

/** Keys whose value is a structural enum, not label text a child reads. */
const STRUCTURAL_KEYS = new Set([
  'type', 'lang', 'kind', 'mode', 'style', 'color', 'colour', 'engine', 'layout',
  'direction', 'orientation', 'labelFormat', 'bond', 'shape', 'element',
  // Early-years keys that are INSTRUCTIONS to the engine, not text on the
  // picture. Each one would otherwise raise a false leak against the very
  // question its type exists to ask: `time: "3:30"` against the option "3:30"
  // on a clock that deliberately prints nothing, `word: "cat"` against the
  // option "cat" on a word_blank that shows only "c _ t", `picto: "cat"`
  // against the option "cat" on a matching grid that draws a cat and names
  // nothing. What the picture actually SAYS is still checked, on the rendered
  // SVG, which is the authority.
  'model', 'numerals', 'time', 'word', 'letters', 'picto',
]);

const R2_PREFIX = 'transcript_quizzes';
const PNG_WIDTH = 1080;
// WhatsApp shows an interactive message's image header at about 1.91:1 and
// crops whatever does not fit (a 1080x158 bar lost its right end on the
// operator's phone). A canvas of exactly that shape is never cropped; the
// drawing is centred inside it.
const PNG_HEIGHT = 565;

/**
 * THE FRAME. A figure that does not need a whole question card arrived as a
 * bare white canvas with a small drawing in it — no counter, no mark, the one
 * question in the quiz that did not look like the quiz. It now carries the
 * card's chrome in a band across the top: the counter at the start edge, the
 * NIETE mark at the end, over the card's lattice.
 *
 * The canvas stays exactly 1080x565 (the header shape above). The band lives in
 * what used to be the top and bottom padding (36px each), so the drawing's box
 * shrinks from 1016x493 to FIG_BOX — a height-bound drawing loses under 2% of
 * its size, a wide one nothing. FIG_BOX is the ONE statement of that box: the
 * label-size gate (transcript-quiz-figure-gates) measures against it, so the
 * gate and the picture can never disagree about how big a label is drawn.
 */
const FRAME = { padTop: 12, band: 50, gap: 4, padBottom: 14, padX: 32 };
const FIG_BOX = Object.freeze({
  w: PNG_WIDTH - 2 * FRAME.padX,
  h: PNG_HEIGHT - FRAME.padTop - FRAME.band - FRAME.gap - FRAME.padBottom,
});

/** NIETE tokens, mapped onto the engine's palette slots. No Rumi navy, no gold. */
const NIETE_TOKENS = {
  navy: '#333748',       // structure, axes, headings
  navy2: '#4B5168',
  amber: '#47BA7D',      // the ACCENT slot — NIETE green
  'amber-soft': '#E4F5EC',
  leaf: '#2F9C66',
  'leaf-soft': '#E4F5EC',
  warn: '#9B2C2C',
  'warn-soft': '#F7E7E7',
  'warn-line': '#D9A2A2',
  cool: '#3E6E9E',
  plum: '#6B3FA0',
  clay: '#B5651D',
  teal: '#14524F',
  ink: '#232735',        // body text
  mut: '#6B7280',
  faint: '#9AA3AD',
  line: '#D7DBE1',
};

class FigureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FigureError';
    this.code = code;
  }
}

// ─── the allowlist ───────────────────────────────────────────────────────────

/**
 * Resolve a type name or alias to its canonical allowlisted type.
 * Built from the engine's OWN manifest, so an alias the engine adds later is
 * resolved here without an edit — and an alias of an excluded type
 * ("concept_map" for mindmap) still returns null.
 * @param {string} name
 * @returns {string|null}
 */
function canonicalType(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  const entry = MANIFEST.types.find((m) => m.type === t || (m.aliases || []).includes(t));
  if (!entry) return null;
  return ALLOWED_TYPES.includes(entry.type) ? entry.type : null;
}

/**
 * The manifest's minimal spec for a type, with this lane's defaults applied —
 * and its part names given this lane's names (compare_size's manifest example
 * names its ribbons "A" and "B", which on a quiz card are option letters).
 */
function minimalSpecFor(type) {
  const entry = MANIFEST.types.find((m) => m.type === type);
  if (!entry) throw new FigureError('FIGURE_TYPE', `no manifest entry for "${type}"`);
  const spec = { ...(TYPE_DEFAULTS[type] || {}), ...entry.minimal_spec };
  // the quiz lane sets a match's handle letters itself; the model is not asked to
  const { handleLetters, ...shown } = relabelLetterParts({ figure: spec }).question.figure; // eslint-disable-line no-unused-vars
  return shown;
}

/**
 * A manifest `limits` line written for the LESSON-PLAN lane, not for this one.
 *
 * The manifest is one document serving two renderers. Its limits mix two kinds
 * of sentence: facts about the ENGINE ("`shaded` is a COUNT of cells, not a
 * list of coordinates"; "the built-in element table is H-Ca plus Fe/Cu/Zn/Br/I,
 * anything else needs explicit Z/shells") — which are exactly what stops a
 * model drawing something silently wrong — and facts about the LP PAGE (a lint
 * rule's code, an A4 column width, a PR number, the LP author brief's own
 * section numbering). The second kind is noise in a WhatsApp quiz prompt: it
 * costs tokens and names machinery the model cannot act on.
 */
const LP_ONLY_LIMIT = /lint_lp\.js|visual_check|author brief|A4|750px|794|column|PR #|bd-[a-z0-9]|blocking defect|serving repo|SS\d|§\d/i;

/** The manifest's limits for a type, minus the lines that are about the LP page. */
function limitsFor(type) {
  const entry = MANIFEST.types.find((m) => m.type === type);
  return ((entry && entry.limits) || []).filter((l) => !LP_ONLY_LIMIT.test(String(l)));
}

/**
 * The allowlist block the author prompt carries: one entry per allowed type —
 * what it is FOR, its REQUIRED keys, a MINIMAL spec, and the engine's own
 * LIMITS — every field GENERATED from the engine manifest rather than
 * hand-copied, so the prompt can never teach a shape the engine no longer
 * accepts, and can never omit a gotcha the engine documents.
 *
 * The limits are the half that was missing before round 4: they are where the
 * engine says `shaded` is a count and not a coordinate list, that an off-table
 * element silently draws as a different atom, and that a `+` welded to a
 * species is read as a charge. A model that is not told those writes a spec
 * that renders happily and teaches the wrong thing.
 *
 * Locked by a snapshot test (tests/quiz/transcript-quiz-author-figure.test.js)
 * so a manifest re-vendor shows up as a visible prompt change, never a silent
 * one.
 * @param {string[]} [types] the subset to describe; defaults to every allowed type
 * @returns {string}
 */
function minimalSpecBlock(types = ALLOWED_TYPES) {
  return types.map((type) => {
    const entry = MANIFEST.types.find((m) => m.type === type);
    const req = (entry.required || []).join(', ') || '—';
    const limits = limitsFor(type).map((l) => `\n    · ${l}`).join('');
    return `- ${type} — ${entry.for}\n  required: ${req}\n  minimal: ${JSON.stringify(minimalSpecFor(type))}`
      + (limits ? `\n  limits:${limits}` : '');
  }).join('\n');
}

// ─── phone font scale ────────────────────────────────────────────────────────

/**
 * Run `fn` (synchronous) with every `SIZE.*` entry temporarily multiplied by
 * `k`, restoring the originals in `finally` — even if `fn` throws.
 *
 * Every diagram type reads `SIZE.xxx` as a live property lookup on the one
 * object `lib/tokens.js` exports (confirmed by reading every type file: e.g.
 * `atom.js`/`free_body.js`/`circuit.js` do `o.size ?? SIZE.small` at call
 * time, and `lib/svg.js`'s `text()`/`toString()` read `SIZE.label`/`SIZE.title`
 * the same way). `bio_schematic.js` (the `cell` type) was the one exception —
 * it snapshotted `SIZE.small` into a module-level `const LSIZE` the first time
 * the engine's type registry required it, which no runtime mutation of `SIZE`
 * could ever reach; fixed in this round to read `SIZE.small` live like every
 * other type (see the comment there).
 *
 * `renderDiagram` is documented "Pure and SYNCHRONOUS: no network, no async"
 * (bot/vendor/lp-v9/diagrams/index.js), so the mutation window never spans an
 * await and never leaks across a concurrent render — this module has no other
 * caller of `renderDiagram` that could interleave with it.
 *
 * @param {number} k
 * @param {() => any} fn synchronous
 * @returns {any} fn()'s return value
 */
function withFontScale(k, fn) {
  const keys = Object.keys(SIZE);
  const orig = {};
  keys.forEach((key) => { orig[key] = SIZE[key]; });
  try {
    keys.forEach((key) => { SIZE[key] = orig[key] * k; });
    return fn();
  } finally {
    keys.forEach((key) => { SIZE[key] = orig[key]; });
  }
}

/**
 * Per-type label-size multiplier applied automatically by `renderFigureSvg`,
 * quiz lane only — never touches the LP lane, which never calls
 * `withFontScale`. A type not listed here (any LP-only type outside
 * `ALLOWED_TYPES`) gets `1`, i.e. unscaled.
 *
 * Chosen from the k-sweep at {1.0, 1.6, 2.0, 2.4} in
 * `renders/round4/figures/phone_scale/RESULTS.md` (gitignored project-folder
 * evidence, not shipped): the largest k with zero `checkOverlaps` pairs and
 * zero `checkDegenerate` rows on the 1080x565 quiz canvas. The gates in
 * transcript-quiz-figure-gates.js run on the SCALED svg, so a k this table
 * got wrong still fails loudly instead of shipping quietly.
 *
 * Five types (`atom`, `cell`, `circuit`, `ray_diagram`, `graph`) already fail
 * `checkOverlaps` at the very next step, k=1.6, on the manifest's own minimal
 * spec — their labels sit close enough to their own lines/plates that ANY
 * growth collides. They are 1 here (unscaled) and stay at their pre-round-4
 * phone size (roughly 5-7dp); RESULTS.md lists them as unsolved and open for
 * lane F to decide whether they leave the phone allowlist.
 *
 * `fraction_bar` swept clean to 2.4 on the manifest's minimal spec (and its
 * circle model with no per-bar label), but existing shipped content broke
 * that at k=1.6: a circle-model bar with a per-bar NAME label in Urdu
 * (transcript-quiz-figure-circle.test.js's "علی" case) collides at 1.6 and
 * above — the sweep only ever tried one spec per type, and this type's own
 * test suite has a denser one. Left at 1 (unscaled) rather than risk bouncing
 * that legitimate content with a fresh FIGURE_OVERLAP.
 *
 * `geometry` swept clean to 2.4 on its minimal spec but the shipped
 * degenerate-sliver fixture (transcript-quiz-figure-gate-wiring.test.js, a
 * near-flat triangle with 3 side labels) picks up a NEW overlap at 2.4 that
 * it does not have at 2.0 — dialled back to 2.0 (still 12.57dp, comfortably
 * over the 10dp target) once that was found.
 *
 * `free_body` (1.6→9.0dp), `punnett` (2.0→9.4dp) and `timeline` (2.4→7.0dp,
 * flat past k=1.6 — its viewBox grows with the scale as fast as its font
 * does) are improved but still under the 10dp target; every other listed
 * type clears 10dp.
 *
 * @see the round-4 and round-5 phone-scale sweeps
 */
/**
 * The step-down ladder. `PHONE_FONT_SCALE` is a CEILING, not a setting:
 * `renderFigureSvg` starts there and steps down until `checkOverlaps` is
 * clean.
 *
 * Round 4 chose one k per type by sweeping the manifest's MINIMAL spec, and
 * applied it to every figure of that type. The round-5 sweep re-ran it against
 * every example each type's own module ships and found eight correct,
 * engine-authored drawings that the quiz lane REJECTS today purely because of
 * their type's scale — grid_area_model_ur alone collides 18 ways at k=2.4 and
 * zero ways at k=1 (the round-5 phone-scale sweep). A rejected figure
 * is a dropped question.
 *
 * Lowering the table instead would have been the wrong fix: it shrinks every
 * simple figure of that type to protect the dense minority. The ladder keeps
 * the ceiling for a sparse spec and gives a dense one a smaller type instead of
 * the bin, and each step-down is logged so a type whose ceiling is wrong for
 * most real content shows up as an event rather than as silence.
 */
const SCALE_LADDER = [2.4, 2.0, 1.6, 1.3, 1.0];

const PHONE_FONT_SCALE = {
  numberline: 2.0,
  // Raised from 1.0: at 1.0 a bar's name read about 7.7px on the
  // phone. Short names (P, Q, R, a numeral) clear 2.4 with no collision; a long
  // Urdu name or the circle model still collides above 1.0, and the ladder
  // steps those down to where they drew before.
  fraction_bar: 2.4,
  grid: 2.4,
  geometry: 2.0, // dialled back from the sweep's 2.4 — see the comment above
  graph: 1.0, // unsolved
  chem_equation: 2.4,
  // Raised from 1.0: a component's letter read about 6.9px on the
  // phone. Short labels clear 1.6; longer ones step down on the ladder.
  circuit: 2.0,
  free_body: 1.6, // improved, still under 10dp
  atom: 1.0, // unsolved
  punnett: 2.0, // improved, still under 10dp
  ray_diagram: 1.0, // unsolved
  flow: 2.4,
  timeline: 2.4, // improved, still under 10dp
  cell: 1.0, // unsolved
  molecule: 2.4,
  // The early-years types are typed for a child, not for an A4 column: their
  // own SIZE tokens are already 20-54 units (a word_blank letter is 54), so
  // every one of them clears the floor unscaled and scaling them further only
  // makes their labels collide with their own tiles. Measured per type in
  // the round-5 phone-scale sweep.
  // `word_blank`, `count_frame` and `pattern` type their content with explicit
  // sizes rather than SIZE tokens (a word_blank letter is 54 units by spec), so
  // scaling reaches only their title/caption strips — 1 is the honest value,
  // not a cautious one. The other five do read SIZE, and their ceilings are the
  // largest k that swept clean on their own examples.
  word_blank: 1.0,
  count_objects: 1.6,
  count_frame: 1.0,
  clock: 1.6,
  pattern: 1.0,
  match: 1.6,
  money: 2.4,
  compare_size: 1.6,
  // Its column heads are the only text, drawn well clear of every piece.
  base_ten: 1.6,
};

// ─── render ──────────────────────────────────────────────────────────────────

/**
 * Draw one figure spec, in the quiz language, and gate it on the engine's own
 * collision contract. Any overlap is a fail: a label sitting on a line or
 * hanging off the paper is unreadable on a phone, and the child cannot ask.
 *
 * @param {object} spec  {type, …} as the author emitted it — never mutated
 * @param {string} language 'ur' | 'en'
 * @returns {string} an <svg>…</svg> fragment
 * @throws {FigureError} code FIGURE_TYPE | FIGURE_RENDER, message one line
 */
function renderFigureSvg(spec, language) {
  if (!spec || typeof spec !== 'object') {
    throw new FigureError('FIGURE_TYPE', 'the figure is not an object');
  }
  const type = canonicalType(spec.type);
  if (!type) {
    throw new FigureError('FIGURE_TYPE',
      `figure type "${spec.type}" is not allowed — use one of: ${ALLOWED_TYPES.join(', ')}`);
  }
  const merged = withoutRepeatedBarNames({
    ...(TYPE_DEFAULTS[type] || {}), ...languageDefaults(type, language), ...spec, ...(QUIZ_FIXED[type] || {}), type, lang: clampLanguage(language),
  });
  const ceiling = PHONE_FONT_SCALE[type] || 1;
  const ladder = [...new Set([ceiling, ...SCALE_LADDER])].filter((k) => k <= ceiling).sort((a, b) => b - a);

  let svg = null;
  let overlaps = null;
  let used = ceiling;
  for (const k of ladder) {
    let candidate;
    try {
      candidate = k === 1 ? renderDiagram(merged) : withFontScale(k, () => renderDiagram(merged));
    } catch (err) {
      // The engine throwing is a property of the SPEC, not of the type size —
      // it throws identically at every k — so there is nothing to step down to.
      throw new FigureError('FIGURE_RENDER',
        `the ${type} figure could not be drawn: ${String(err.message).split('\n')[0]}`);
    }
    svg = candidate;
    used = k;
    overlaps = checkOverlaps(candidate);
    if (!overlaps.length) break;
  }
  if (used !== ceiling) {
    logEvent('transcript_quiz.figure_scale_stepped_down', {
      type, ceiling, used, clean: overlaps.length === 0,
    });
  }
  // Named FIGURE_OVERLAP, not FIGURE_RENDER: the retry prompt quotes these
  // codes back to the model, and "the engine threw" and "the engine drew it
  // with two labels on top of each other" are different things to fix. Same
  // gate the LP lane runs as DIAGRAM_OVERLAP; transcript-quiz-figure-gates.js
  // exposes it as a defect object for callers that do not want the throw.
  // Reaching here means the drawing collides with ITSELF even unscaled, which
  // is a bad spec and not a bad type size.
  if (overlaps.length) {
    const pair = overlaps[0];
    throw new FigureError('FIGURE_OVERLAP',
      `the ${type} figure has ${overlaps.length} unreadable label(s) — ${pair.kind} between ${pair.a} and ${pair.b}; simplify it or shorten the labels`);
  }
  return svg;
}

// ─── the leak rule ───────────────────────────────────────────────────────────

const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

/** Every string a reader actually SEES in the rendered SVG. */
function svgText(svg) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>|<foreignObject\b[^>]*>([\s\S]*?)<\/foreignObject>/g;
  let m = re.exec(String(svg || ''));
  while (m) {
    out.push(String(m[1] ?? m[2] ?? '').replace(/<[^>]*>/g, ' '));
    m = re.exec(String(svg || ''));
  }
  return out;
}

/** trim + lowercase + one alphabet for digits + one run of whitespace. */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every human-readable string in a spec, structural enums excluded. */
function specStrings(node, key = null, out = []) {
  if (typeof node === 'string') {
    if (!STRUCTURAL_KEYS.has(key)) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v) => specStrings(v, key, out));
    return out;
  }
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([k, v]) => specStrings(v, k, out));
  }
  return out;
}

/**
 * The same spec with `fn` applied to every human-readable string (the ones
 * specStrings reads), structural enums untouched. Pure: returns a new spec.
 */
function mapSpecStrings(node, fn, key = null) {
  if (typeof node === 'string') return STRUCTURAL_KEYS.has(key) ? node : fn(node);
  if (Array.isArray(node)) return node.map((v) => mapSpecStrings(v, fn, key));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, mapSpecStrings(v, fn, k)]));
  }
  return node;
}

/**
 * Does the picture already say the answer?
 *
 * True when the correct option's text appears in the figure — UNLESS every
 * option's text appears, which is the legal labelled case: "which point is at
 * −3? A / B / C" needs A, B and C on the number line, and naming all three
 * gives nothing away.
 *
 * Reads the SPEC and, when the rendered SVG is passed, the DRAWING. Several
 * types compute a label the spec never mentions (a fraction bar prints "3/4"
 * from shaded/parts), so a spec-only check certifies an answer as hidden while
 * the picture says it out loud.
 *
 * A short option (under four characters — "3", "A", "½") must match a WHOLE
 * label; a longer one may appear anywhere. Without that, the option "3" leaked
 * against a "30" on a graph axis. Deliberately conservative in the other
 * direction: a false leak costs one retry, a missed one costs the question.
 *
 * @param {object} spec
 * @param {string[]} options  the three option texts, in stored order
 * @param {number} correctIndex
 * @param {string} [svg]  the rendered figure, when it is already drawn
 * @returns {boolean}
 */
/**
 * A figure must carry something to read off before it earns its slot. A real
 * generation drew a 3x1 grid with nothing shaded to stand for "rows of
 * numbers": three empty boxes over a whole page, telling the child nothing.
 * Returns null when the spec is informative, otherwise a one-line reason.
 */
const GEOMETRY_KINDS = new Set(['triangle', 'polygon', 'circle', 'angle', 'rightangle', 'line', 'segment', 'point']);
const GEOMETRY_KEYS = {
  triangle: ['points'], polygon: ['points'], circle: ['c', 'r'], angle: ['vertex', 'a', 'b'],
  rightangle: ['vertex', 'a', 'b'], line: ['from', 'to'], segment: ['from', 'to'], point: ['at'],
};
/** Only mathematics draws shapes; every other subject that reached for geometry drew a scene. */
const MATHS_ONLY_TYPES = new Set(['geometry', 'base_ten']);

/** A colour token the page never defines paints grey (or nothing). */
function unknownColourToken(spec) {
  const found = new Set();
  JSON.stringify(spec).replace(/var\(--([a-z0-9-]+)/gi, (m, name) => { if (!(name in NIETE_TOKENS)) found.add(name); return m; });
  return found.size ? [...found] : null;
}

/**
 * Can the drawing PRODUCE the correct option? A grid of 9 cells with 3 shaded
 * cannot answer "12 shared into 3" (4); a bar of 4 parts with 3 shaded cannot
 * answer "1/2". Returns a one-line reason when it cannot, else null.
 */
// ─── part names are never the option letters ─────────────────────────────────

/**
 * The places a figure names a part the child may be asked to pick: a bar, a
 * point, a vertex, a component, a ribbon, a row. Each entry is [holder, key].
 */
function partLabelSlots(spec) {
  const out = [];
  const each = (list, key) => (Array.isArray(list) ? list : []).forEach((x) => {
    if (x && typeof x === 'object' && typeof x[key] === 'string') out.push([x, key]);
  });
  switch (canonicalType(spec && spec.type)) {
    case 'fraction_bar': each(spec.bars, 'label'); break;
    case 'numberline': each(spec.points, 'label'); break;
    case 'circuit': each(spec.cells, 'label'); each(spec.components, 'label'); break;
    case 'compare_size': each(spec.items, 'label'); each([spec.left, spec.right], 'label'); break;
    case 'count_objects': each(spec.rows, 'label'); break;
    case 'geometry': (Array.isArray(spec.shapes) ? spec.shapes : []).forEach((sh) => {
      if (!sh || typeof sh !== 'object') return;
      if (typeof sh.label === 'string') out.push([sh, 'label']);
      if (Array.isArray(sh.labels)) sh.labels.forEach((_, k) => { if (typeof sh.labels[k] === 'string') out.push([sh.labels, k]); });
    }); break;
    default: break;
  }
  return out;
}

/** Pictures that already carry numbers (fractions, a scale, lengths, volts) name parts P, Q, R, S. */
const LETTER_NAMED_TYPES = new Set(['fraction_bar', 'numberline', 'geometry', 'circuit']);
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const PART_LETTERS = ['P', 'Q', 'R', 'S'];
const PART_NUMBERS = ['1', '2', '3', '4'];
const BIDI = /[\u200e\u200f\u2066-\u2069]/g;
// "A goes with 2", "A is the cat": a verb after the letter makes it a name, not the article
const LABEL_VERB_AFTER = /^\s+(is|are|was|goes|go|has|have|and|or|with|matches|match|shows|show|sits|means|belongs|pairs|comes|stands)\b/;
const PART_NOUN_BEFORE = /(bars?|points?|rows?|ribbons?|components?|parts?|shapes?|labels?|lines?|sides?|vertex|vertices|angles?|symbols?|پٹی|پٹیوں|نقطہ|نقطے|قطار|حصہ|شکل|علامت)\s*$/i;

/**
 * Rename every standalone option letter in `text` by `map`, outside maths
 * spans. An English "A" that opens a phrase ("A bar split into…") is an article,
 * not a label, and is left alone. `groups` also renames runs like "AB" / "ABC"
 * (a side, a triangle) for the lettered types.
 */
function renameLetters(text, map, { groups = false } = {}) {
  if (typeof text !== 'string' || !text) return text;
  const letters = Object.keys(map).join('');
  const single = new RegExp(`(^|[^\\p{L}\\p{N}\\\\])([${letters}])(?=([^\\p{L}\\p{N}]|$))`, 'gu');
  const run = new RegExp(`(^|[^\\p{L}\\p{N}\\\\])([${letters}]{2,3})(?=([^\\p{L}\\p{N}]|$))`, 'gu');
  const outside = (chunk) => {
    let t = chunk.replace(single, (m, pre, L, _post, offset, whole) => {
      const after = whole.slice(offset + m.length);
      const before = whole.slice(0, offset + pre.length);
      // "A bar", "A fraction" is the article — unless a part noun names it ("bar A has…")
      if (L === 'A' && /^\s+[a-z]/.test(after) && !PART_NOUN_BEFORE.test(before) && !LABEL_VERB_AFTER.test(after)) return m;
      return `${pre}${map[L]}`;
    });
    if (groups) t = t.replace(run, (m, pre, word) => `${pre}${[...word].map((L) => map[L]).join('')}`);
    return t;
  };
  return text.split(/(\$[^$]*\$)/).map((chunk, k) => (k % 2 ? chunk : outside(chunk))).join('');
}

/**
 * A figure that names its parts A-D gets new names, and so does every field of
 * the question that uses them — so the picture, the WhatsApp text, the card
 * and the teacher's PDF, all drawn from this one question, agree. The card
 * marks its three options A, B and C; a part called B that is option C is a
 * child tapping the wrong letter for the right answer (staging, a circuit
 * question). Pure: returns a new question, or the same one.
 * @returns {{question:object, renamed:object|null}}
 */
function relabelLetterParts(q) {
  if (!q || typeof q !== 'object' || !q.figure || typeof q.figure !== 'object' || Array.isArray(q.figure)) return { question: q, renamed: null };
  const type = canonicalType(q.figure.type);
  // «پٹی P», "Bar A", "bar 2" name the part with its noun. The label gate
  // strips a shape word from a fraction bar and takes the whole label with it
  // (replay, grade 4 Urdu: the options named bars P, Q, R that the picture
  // no longer named), so the label keeps only the name.
  if (partLabelSlots(q.figure).some(([h, k]) => bareName(h[k]) !== h[k])) {
    const figure = JSON.parse(JSON.stringify(q.figure));
    partLabelSlots(figure).forEach(([h, k]) => { h[k] = bareName(h[k]); });
    q = { ...q, figure }; // eslint-disable-line no-param-reassign
  }
  let map;
  let figure;
  if (type === 'match') {
    // The match engine DRAWS its own handle letters down one column (A, B, C
    // by default) and the options are pairings of them ("A-2"): the card read
    // "A: A-2". The engine takes its letters from `handleLetters` (a NIETE
    // divergence, vendor SYNC.md 3.21); the quiz lane always names them P, Q,
    // R, S, and renames every A-D the question uses for the rows it has.
    if (q.figure.handles === false) return { question: q, renamed: null };
    const rows = Math.min(OPTION_LETTERS.length, Array.isArray(q.figure.left) ? q.figure.left.length : OPTION_LETTERS.length);
    map = Object.fromEntries(OPTION_LETTERS.slice(0, rows).map((L, k) => [L, PART_LETTERS[k]]));
    figure = { ...JSON.parse(JSON.stringify(q.figure)), handleLetters: [...PART_LETTERS] };
  } else {
    const probe = partLabelSlots(q.figure);
    const used = [...new Set(probe.map(([h, k]) => String(h[k]).replace(BIDI, '').trim()).filter((l) => OPTION_LETTERS.includes(l)))];
    if (!used.length) return { question: q, renamed: null };
    const target = LETTER_NAMED_TYPES.has(type) ? PART_LETTERS : PART_NUMBERS;
    map = Object.fromEntries(used.map((L) => [L, target[OPTION_LETTERS.indexOf(L)]]));
    figure = JSON.parse(JSON.stringify(q.figure));
    partLabelSlots(figure).forEach(([h, k]) => {
      const l = String(h[k]).replace(BIDI, '').trim();
      if (map[l]) h[k] = map[l];
    });
  }
  const opts = { groups: type === 'geometry' };
  const rn = (t) => renameLetters(t, map, opts);
  const rnMap = (o) => (o && typeof o === 'object' && !Array.isArray(o)
    ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, rn(v)])) : o);
  const fb = q.option_feedback && typeof q.option_feedback === 'object' ? q.option_feedback : null;
  return {
    renamed: map,
    question: {
      ...q,
      figure,
      question: rn(q.question),
      options: Array.isArray(q.options) ? q.options.map(rn) : q.options,
      explanation: rn(q.explanation),
      selected_because: rn(q.selected_because),
      distractor_misconceptions: rnMap(q.distractor_misconceptions),
      ...(fb ? { option_feedback: { ...fb, correct: rn(fb.correct), wrong: rnMap(fb.wrong) } } : {}),
    },
  };
}

const PART_NOUN = '(?:bar|point|row|ribbon|component|part|strip|پٹی|نقطہ|قطار|حصہ)';
const NOUN_THEN_NAME = new RegExp(`^${PART_NOUN}\\s*([A-Z]|[1-9])$`, 'i');
const NAME_THEN_NOUN = new RegExp(`^([A-Z]|[1-9])\\s*${PART_NOUN}$`, 'i');

/** "Bar P" / «پٹی P» / "P bar" → "P"; anything else unchanged. */
function bareName(label) {
  if (typeof label !== 'string') return label;
  const t = label.replace(BIDI, '').trim();
  const m = NOUN_THEN_NAME.exec(t) || NAME_THEN_NOUN.exec(t);
  return m ? m[1].toUpperCase() : label;
}

/**
 * Options that pick a part by name ("P", "bar Q", «پٹی 2») over a picture that
 * names no part: the child is asked for a name that is not there. Returns the
 * names asked for, or null.
 */
function unnamedParts(spec, options) {
  if (!spec || typeof spec !== 'object' || partLabelSlots(spec).some(([h, k]) => String(h[k] || '').trim())) return null;
  if (!['fraction_bar', 'numberline', 'circuit', 'compare_size', 'count_objects', 'geometry'].includes(canonicalType(spec.type))) return null;
  const names = (Array.isArray(options) ? options : []).map((o) => {
    const t = String(o || '').replace(BIDI, '').trim();
    const m = NOUN_THEN_NAME.exec(t) || /^([P-S])$/.exec(t);
    return m ? m[1].toUpperCase() : null;
  });
  const named = names.filter(Boolean);
  return named.length >= 2 ? named : null;
}

/**
 * A fraction-bar set whose options pick bars by name, with a bar that has no
 * name. Replay (grade 4 Urdu): "which is an improper fraction? P / Q / R" over
 * P 2/4, Q 3/3, an unnamed 2/2 and R 1/2 — the model drew R's 3/2 as a whole
 * bar and a half and named only the half, so R read as 1/2 while 3/2 is
 * improper too (a second right answer). Returns the 1-based number of the
 * first unnamed bar, or null.
 */
function unnamedBarInNamedSet(spec, options) {
  if (!spec || canonicalType(spec.type) !== 'fraction_bar' || !Array.isArray(spec.bars) || spec.bars.length < 2) return null;
  const named = spec.bars.map((b) => Boolean(b && typeof b.label === 'string' && b.label.trim()));
  if (!named.some(Boolean) || named.every(Boolean)) return null;
  const picks = (Array.isArray(options) ? options : []).filter((o) => namesAPart(spec, o)).length;
  if (picks < 2) return null;
  return named.indexOf(false) + 1;
}

/**
 * An improper fraction written as ONE bar — {"parts": 3, "shaded": 5} for 5/3,
 * the spec a replay of the proper/improper fractions chapter showed the model
 * writing — is redrawn as whole bars and a part bar (3/3 and 2/3), the way
 * the lesson draws it. Only a picture of that one bar: a bar that is one of
 * several (a "which bar shows 5/3?" set) cannot be split without losing which
 * bars belong together, so it is left for FIGURE_EMPTY to refuse with the
 * same instruction. Pure; returns the same spec when there is nothing to do.
 */
function expandImproperBar(spec) {
  if (!spec || canonicalType(spec.type) !== 'fraction_bar' || !Array.isArray(spec.bars) || spec.bars.length !== 1) return spec;
  const [bar] = spec.bars;
  const parts = Math.round(Number(bar && bar.parts));
  const shaded = Math.round(Number(bar && bar.shaded));
  if (!(parts >= 2) || !(shaded > parts) || Array.isArray(bar.shaded) || shaded > parts * 5) return spec;
  const whole = Math.floor(shaded / parts);
  const rest = shaded - whole * parts;
  const { label, value, ...plain } = bar; // eslint-disable-line no-unused-vars
  const bars = [
    ...Array.from({ length: whole }, (_, k) => ({ ...plain, parts, shaded: parts, ...(k === 0 && label ? { label } : {}) })),
    ...(rest ? [{ ...plain, parts, shaded: rest }] : []),
  ];
  return { ...spec, bars };
}

/** Does `answer` name one of the figure's parts ("P", "bar 2", «پٹی Q»)? Then it is a pick, not a quantity. */
function namesAPart(spec, answer) {
  const names = new Set(partLabelSlots(spec).map(([h, k]) => norm(String(h[k]).replace(BIDI, ''))).filter(Boolean));
  if (!names.size) return false;
  const a = norm(String(answer || '').replace(BIDI, '')).replace(/^(bar|point|row|ribbon|پٹی|نقطہ|قطار)\s*/, '').replace(/\s*(bar|پٹی)$/, '').trim();
  return names.has(a);
}

/**
 * Two options of the same AMOUNT under a part-whole picture. A fraction_bar or
 * grid question must produce its key literally (figureMismatch: a bar of 2 in
 * 8 answers "2/8", not "1/4"), so a second option equal in value to the key is
 * a second right reading of the same picture — a child who reads the bar as
 * 1/4 is right and would be told otherwise. Without a picture the same pair is
 * a fair question ("which is in lowest terms?"), so only these two types are
 * checked. Returns a one-line reason, else null.
 */
function equalAmountOptions(spec, options, correctIndex) {
  const type = canonicalType(spec && spec.type);
  if (type !== 'fraction_bar' && type !== 'grid') return null;
  const raw = Array.isArray(options) ? options.map((o) => String(o == null ? '' : o)) : [];
  const opts = raw.map(norm);
  const ci = Number(correctIndex);
  const same = (a, b) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
  const value = (s) => {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s || '');
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
  };
  const key = value(opts[ci]);
  if (key !== null) {
    const twin = opts.find((o, k) => k !== ci && same(value(o), key));
    return twin ? `"${opts[ci]}" and "${twin}" are the same amount — a child who reads the picture either way is right` : null;
  }
  // "Which bar shows 3/6?" answered with the bars' own labels: two option bars
  // of the same amount (1/2 and 3/6) are two right answers on the same picture
  // (live, grade 3 Urdu, a lesson on equivalent fractions).
  if (type !== 'fraction_bar') return null;
  const byLabel = new Map((Array.isArray(spec.bars) ? spec.bars : [])
    .filter((b) => b && typeof b.label === 'string' && b.label.trim())
    .map((b) => [norm(b.label), b]));
  if (!byLabel.size) return null;
  const barOf = (o) => byLabel.get(o.replace(/[\u200e\u200f\u2066-\u2069]/g, '').replace(/^(bar|پٹی)\s*/, '').replace(/\s*(bar|پٹی)$/, '').trim()) || null;
  const amount = (b) => {
    const parts = Number(b.parts);
    const shaded = Array.isArray(b.shaded) ? b.shaded.length : Number(b.shaded);
    return parts > 0 && Number.isFinite(shaded) ? shaded / parts : null;
  };
  const keyBar = barOf(opts[ci] || '');
  if (!keyBar) return null;
  const k2 = opts.findIndex((o, k) => { const b = barOf(o); return k !== ci && b && b !== keyBar && same(amount(b), amount(keyBar)); });
  return k2 >= 0 ? `${raw[ci].trim()} and ${raw[k2].trim()} show the same amount — a child who reads the picture either way is right` : null;
}

/** The colours a count_objects row may be drawn in (the engine's own palette tokens). */
const NIETE_ROW_COLOURS = new Set(['ink', 'accent', 'leaf', 'cool', 'warn', 'plum', 'clay']);
/** A stem that asks about colour or shading ("coloured", "shaded", «رنگین», «رنگے») — or a colour by name. */
const COLOUR_WORDS = /\b(colou?r(?:ed|s)?|shaded|red|blue|green|yellow|orange|purple|pink|black|white|brown)\b|رنگ|سرخ|لال|نیل|ہر[ےی]|پیل|کال[ےی]|سفید/i;

/**
 * ONE THING, OR NONE, IS A COUNT ONLY WHEN THE CHILD IS ASKED TO COUNT IT.
 *
 * The drawing engine refused any count under 2 (a round-6 session drew ONE
 * goat and asked which word the picture matched — a vocabulary prompt wearing
 * a counting type). That floor also refused the grade 1 lesson on the numbers
 * 0 to 4, whose own examples are one car and an empty circle, and a sandbox
 * quiz on it failed three attempts running (24 Sep 2026). The engine now draws
 * 1, and 0 as an empty tray (SYNC.md 3.23); the goat is refused HERE, where the
 * question is known: a row of 0 or 1 needs a number for its key, or a stem
 * that asks how many / which has more / which has none.
 */
const COUNT_ASK = /\b(how many|how much|count(?:s|ed|ing)?|number|more|fewer|less|least|most|fewest|none|zero|empty|nothing|equal)\b|کتن[اےی]|گن|تعداد|زیادہ|صفر|خالی|نہیں|عدد|برابر/i;
function singleThingNotACount(spec, options, correctIndex, stem = '') {
  if (canonicalType(spec && spec.type) !== 'count_objects') return null;
  const list = Array.isArray(spec.rows) && spec.rows.length ? spec.rows : [{ count: spec.count, picto: spec.picto }];
  const small = list.find((r) => r && r.count !== '' && r.count != null && Number.isFinite(Number(r.count)) && Number(r.count) < 2);
  if (!small) return null;
  const key = norm((Array.isArray(options) ? options : [])[Number(correctIndex)]);
  if (/^\d+$/.test(key) || COUNT_ASK.test(String(stem || ''))) return null;
  const what = String(small.picto || spec.picto || 'thing');
  return `"${what}" is drawn ${Number(small.count) === 0 ? 'as an empty tray' : 'once'} but the question does not ask how many — one thing (or none) is a count only when the child counts it; to ask which WORD a picture matches, use match`;
}

/** A count_objects picture that is ONE empty tray and nothing else: sparse on purpose (SYNC.md 3.23). */
function drawsEmptySet(spec) {
  if (canonicalType(spec && spec.type) !== 'count_objects') return false;
  const list = Array.isArray(spec.rows) && spec.rows.length ? spec.rows : [{ count: spec.count }];
  return list.every((r) => r && r.count !== '' && r.count != null && Number(r.count) === 0);
}

function figureMismatch(spec, options, correctIndex, stem = '') {
  const type = canonicalType(spec && spec.type);
  const correct = norm((Array.isArray(options) ? options : [])[Number(correctIndex)]);
  if (!correct) return null;
  // "Which bar shows 2/3?" answered "2" means bar 2, not the number two.
  if (namesAPart(spec, correct)) return null;
  // A key written as a sum ("3 × 5 = 15") is checked by its result: bars of
  // 3/4 and 2/5 keyed "3 × 5 = 15" passed a replay because the key was not a
  // bare number.
  const eq = /=\s*(\d+(?:\s*\/\s*\d+)?)$/.exec(correct);
  const answer = eq ? eq[1].replace(/\s+/g, '') : correct;
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(answer);
  const whole = /^\d+$/.test(answer) ? Number(answer) : null;
  if (frac === null && whole === null) return null; // a word answer is not checked here
  if (type === 'fraction_bar') {
    const bars = Array.isArray(spec.bars) ? spec.bars : [];
    const shaded = bars.reduce((a, b) => a + (Number(b.shaded) || 0), 0);
    const parts = bars.reduce((a, b) => a + (Number(b.parts) || 0), 0);
    const per = bars.map((b) => [Number(b.parts), Number(b.shaded)]);
    const reachable = new Set();
    per.forEach(([p, sh]) => { reachable.add(`${sh}/${p}`); reachable.add(`${p - sh}/${p}`); reachable.add(String(sh)); reachable.add(String(p)); reachable.add(String(p - sh)); });
    reachable.add(`${shaded}/${parts}`); reachable.add(String(shaded)); reachable.add(String(parts)); reachable.add(String(bars.length));
    if (bars.length > 1 && per.every(([p]) => p === per[0][0])) reachable.add(`${shaded}/${per[0][0]}`);
    const key = frac ? `${Number(frac[1])}/${Number(frac[2])}` : String(whole);
    return reachable.has(key) ? null : `the picture cannot produce the answer "${correct}" (it shows ${shaded} of ${parts} parts)`;
  }
  if (type === 'count_objects') {
    // Counters beside a sum they cannot show were passing as a "model": rows of
    // 2 and 5 beside "what is 2 × 5?" (10), rows of 4, 3 and 6 beside an LCM of
    // 12 (the fractions replays). What a counters picture CAN produce:
    const list = Array.isArray(spec.rows) && spec.rows.length ? spec.rows : [{ count: spec.count, picto: spec.picto }];
    const rowsIn = list.filter((r) => Math.floor(Number(r && r.count) || 0) > 0);
    const counts = rowsIn.map((r) => Math.floor(Number(r.count)));
    // An empty tray (an explicit count of 0, SYNC.md 3.23) produces 0 — and a
    // picture of nothing but an empty tray produces nothing else.
    const empties = list.filter((r) => r && r.count !== '' && r.count != null && Number(r.count) === 0).length;
    if (!counts.length) {
      if (!empties) return null;
      return whole === 0 ? null : `the picture cannot produce the answer "${correct}" (it shows an empty tray — none)`;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    // Can the child SEE which things a row is? Only when it looks different:
    // its own picture, its own colour, or its own name. Staging: "the set of
    // coloured pencils" over five identical pencils in rows of 2 and 3, keyed
    // 2/5 — the share was "reachable" and nothing in the picture was coloured.
    const look = (r) => [String(r.picto || spec.picto || ''), String(r.color && NIETE_ROW_COLOURS.has(String(r.color)) ? r.color : 'ink'), String(r.label || '').trim()].join('|');
    const looks = rowsIn.map(look);
    const seen = (i) => looks.filter((l) => l === looks[i]).length === 1;
    // A question that names a colour or a shading asks the child to find the
    // coloured things: every row it counts must be one the child can pick out.
    const colourAsked = COLOUR_WORDS.test(String(stem || ''));
    // (a colour question is never answered by the number of rows)
    const reachable = new Set([String(total), ...(colourAsked ? [] : [String(counts.length)]), ...(empties ? ['0'] : [])]);
    counts.forEach((c, i) => {
      const visible = seen(i);
      if (!colourAsked || visible || counts.length === 1) reachable.add(String(c));
      if (visible && counts.length > 1) reachable.add(`${c}/${total}`);
      counts.forEach((d, j) => { if (j !== i && c > d && (!colourAsked || (visible && seen(j)))) reachable.add(String(c - d)); });
    });
    if (counts.length === 1) {
      const n = counts[0];
      const group = Math.floor(Number(spec.group) || 0);
      if (group > 1) { // ringed into equal lots: how many lots, how many in each, what is left
        reachable.add(String(group));
        reachable.add(String(Math.floor(n / group)));
        if (n % group) reachable.add(String(n % group));
        reachable.add(`1/${Math.floor(n / group)}`);
      }
      const perRow = Math.floor(Number(spec.perRow) || 0) || (group > 1 ? group : Math.min(5, n));
      reachable.add(String(perRow)); // an array: its columns and its rows
      reachable.add(String(Math.ceil(n / perRow)));
    }
    const key = frac ? `${Number(frac[1])}/${Number(frac[2])}` : String(whole);
    if (reachable.has(key)) return null;
    const alike = counts.length > 1 && looks.some((_, i) => !seen(i));
    return alike || (colourAsked && counts.length === 1)
      ? `the picture cannot produce the answer "${correct}": its things all look the same, so the child cannot see which part the question counts — give that row its own colour ("color": "warn") or its own picture`
      : `the picture cannot produce the answer "${correct}" (it shows ${counts.join(' and ')} things)`;
  }
  if (type === 'base_ten') {
    // A place-value mat answers "what number?", "how many tens?", "what is the
    // tens worth?" and "how many pieces in all?" — and nothing else.
    const [th, h, t, o] = ['thousands', 'hundreds', 'tens', 'ones'].map((k) => Math.max(0, Math.floor(Number(spec[k]) || 0)));
    const value = 1000 * th + 100 * h + 10 * t + o;
    const reachable = new Set([value, th, h, t, o, 1000 * th, 10 * t, 100 * h, th + h + t + o].map(String));
    const shows = `${th ? `${th} thousands, ` : ''}${h} hundreds, ${t} tens and ${o} ones`;
    return whole !== null && reachable.has(String(whole)) ? null
      : `the picture cannot produce the answer "${correct}" (it shows ${shows})`;
  }
  if (type === 'grid') {
    const rows = Number(spec.rows) || 0; const cols = Number(spec.cols) || 0;
    const shaded = Array.isArray(spec.shaded) ? spec.shaded.length : (Number(spec.shaded) || 0);
    const total = rows * cols;
    const reachable = new Set([String(shaded), String(total), String(total - shaded), String(rows), String(cols),
      `${shaded}/${total}`, `${total - shaded}/${total}`, `${shaded}/${rows}`, `${shaded}/${cols}`]);
    if (total) reachable.add(String(Math.round((shaded / total) * 100)));
    const key = frac ? `${Number(frac[1])}/${Number(frac[2])}` : String(whole);
    return reachable.has(key) ? null : `the picture cannot produce the answer "${correct}" (a ${rows} x ${cols} grid with ${shaded} shaded)`;
  }
  return null;
}


/**
 * How many things the drawing actually paints. The engine skips shapes it
 * does not know and text nodes it cannot place without throwing, so a spec can
 * "render" to a white rectangle. Counts drawn primitives that carry a fill or
 * a stroke, ignoring the paper.
 */
function svgInkCount(svg) {
  const str = String(svg || '');
  const tags = str.match(/<(rect|circle|ellipse|line|polyline|polygon|path|text|foreignObject)\b[^>]*>/g) || [];
  let count = 0;
  tags.forEach((t) => {
    if (/(fill|stroke)="none"/.test(t) && !/stroke="(?!none)/.test(t) && !/fill="(?!none)/.test(t)) return;
    if (/<rect\b/.test(t) && /width="100%"/.test(t)) return; // the paper
    count += 1;
  });
  return count;
}

function figureEmptyReason(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const type = canonicalType(spec.type);
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  const shadedCount = (v) => (Array.isArray(v) ? v.length : (Number(v) || 0));
  switch (type) {
    case 'grid': {
      const rows = Number(spec.rows) || 0; const cols = Number(spec.cols) || 0;
      if (rows < 2 || cols < 2) return 'a grid needs at least 2 rows and 2 columns';
      if (rows * cols > 100) return 'a grid larger than 10 x 10 is unreadable on a phone';
      if (shadedCount(spec.shaded) < 1 && shadedCount(spec.shaded2) < 1) return 'a grid with no shaded cell shows nothing';
      return null;
    }
    case 'fraction_bar': {
      const bars = Array.isArray(spec.bars) ? spec.bars : [];
      if (!bars.length) return 'a fraction bar needs at least one bar';
      if (bars.some((b) => !(Number(b.parts) >= 2))) return 'every bar needs at least 2 parts';
      const over = bars.find((b) => Number(b.shaded) > Number(b.parts));
      if (over) return `a bar has ${Number(over.shaded)} shaded of ${Number(over.parts)} parts: an improper fraction is drawn as whole bars and a part bar ({"parts":${Number(over.parts)},"shaded":${Number(over.parts)}} then {"parts":${Number(over.parts)},"shaded":${Number(over.shaded) % Number(over.parts) || Number(over.parts)}}), never one bar`;
      if (bars.some((b) => Number(b.shaded) < 0)) return 'shaded must be between 0 and parts';
      return null;
    }
    case 'numberline':
      return n(spec.points) + n(spec.arcs) + n(spec.intervals) + n(spec.rays) ? null : 'a number line needs at least one point, arc, interval or ray';
    case 'timeline': {
      if (n(spec.events) < 2) return 'a timeline needs at least 2 events';
      // An event's words live in `label`. Written as `title` — the key `flow`
      // uses for the same idea — the dates still draw and the events vanish,
      // which looks finished and says nothing (both round-5 reviewers).
      const wordless = (spec.events || []).filter((e) => !String((e && e.label) ?? '').trim()).length;
      return wordless ? `${wordless} timeline event(s) have no "label" — that is the key the event's words go in; a "title" on an event is dropped and the date is drawn alone` : null;
    }
    case 'flow': {
      if (n(spec.steps) < 2) return 'a flow needs at least 2 steps';
      // A step's words live in `title` (with optional `lines`). Written as
      // `label`, the engine draws the box and drops every word: three empty
      // rectangles joined by arrows, and eight painted primitives, so even the
      // ink count passes it.
      const wordless = (spec.steps || []).filter((st) => {
        const t = String((st && st.title) ?? '').trim();
        const lines = Array.isArray(st && st.lines) ? st.lines.filter((l) => String(l ?? '').trim()) : [];
        return !t && !lines.length;
      }).length;
      return wordless ? `${wordless} flow step(s) have no "title" — that is the key the step's words go in; a "label" on a step is dropped and the box is drawn empty` : null;
    }
    case 'circuit':
      return n(spec.cells) >= 2 ? null : 'a circuit needs at least 2 components';
    case 'geometry': {
      const shapes = Array.isArray(spec.shapes) ? spec.shapes : [];
      if (!shapes.length) return 'a geometry figure needs at least one shape';
      // The engine draws MATHEMATICS. A rectangle-plus-circles "scene" of real
      // things, with colour tokens the page never defines, rendered blank.
      const bad = shapes.find((sh) => !GEOMETRY_KINDS.has(String(sh && sh.kind || '').toLowerCase()));
      if (bad) return `unknown geometry shape kind "${bad && bad.kind}" — only ${[...GEOMETRY_KINDS].join(', ')} are drawn`;
      // The engine drops a shape that lacks the keys its kind reads (a circle
      // given center/radius instead of c/r vanishes) — say so instead.
      const missing = shapes.map((sh) => {
        const kind = String(sh.kind).toLowerCase();
        const need = GEOMETRY_KEYS[kind] || [];
        const lack = need.filter((k) => sh[k] === undefined);
        return lack.length ? `${kind} needs ${need.join(' + ')}` : null;
      }).filter(Boolean);
      if (missing.length) return `a shape is missing the keys its kind needs: ${missing.join('; ')}`;
      const mathematical = shapes.some((sh) => n(sh.labels) || n(sh.sides) || n(sh.angles) || sh.label || (sh.radius !== undefined && (sh.label || sh.radiusLabel)));
      return mathematical ? null : 'geometry must carry labelled points, sides or angles — it draws mathematics, never a scene of objects';
    }
    case 'graph':
      return n(spec.functions) + n(spec.points) + n(spec.segments) ? null : 'a graph needs a function, points or segments';
    case 'free_body':
      return n(spec.forces) >= 1 ? null : 'a free-body diagram needs at least one force';
    default:
      return null;
  }
}

function figureLeaksAnswer(spec, options, correctIndex, svg = null) {
  if (!spec || typeof spec !== 'object') return false;
  const opts = (Array.isArray(options) ? options : []).map(norm);
  const correct = opts[Number(correctIndex)];
  if (!correct) return false;

  const visible = [...specStrings(spec), ...(svg ? svgText(svg) : [])].map(norm).filter(Boolean);
  const joined = visible.join(' | ');
  // Two splits, unioned. The coarse one keeps "3/4" whole, so a fraction option
  // still matches its own label; the fine one also breaks on / = %, so the 37
  // inside a grid's "37/100 = 37% = 0.37" readout is found as well.
  const tokens = new Set([
    ...joined.split(/[\s|,;:()[\]"'’“”]+/),
    ...joined.split(/[\s|,;:/=%()[\]"'’“”]+/),
  ].filter(Boolean));
  const shows = (text) => !!text && (text.length >= 4 ? joined.includes(text) : tokens.has(text));

  // A jump arc that LANDS on the answer shows it by geometry, not by text:
  // "3 + 4 = ?" with an arc from 3 to 7 is answered by the arrowhead.
  const type = canonicalType(spec.type);
  if (type === 'numberline' && Array.isArray(spec.arcs)) {
    const lands = spec.arcs.map((a) => norm(String(a && a.to)));
    if (lands.includes(correct)) return true;
  }
  // A grid whose row or column count IS the answer has already done the
  // sharing for the child ("12 flowers in 3 vases" drawn as 3 rows of 4).
  if (type === 'grid' && /^\d+$/.test(correct)) {
    if ([spec.rows, spec.cols].map((v) => norm(String(v))).includes(correct)) return true;
  }

  if (!shows(correct)) return false;
  // "Every option appears" is an exemption for LETTER HANDLES (a labelled
  // A/B/C choice), never for options filed inside the drawing — a flow chart
  // that prints the answer under one heading and the distractors under the
  // other is an answer key, even though all three words are on it.
  const handles = opts.every((o) => [...o].length <= 3);
  return !(handles && opts.every((o) => shows(o)));
}

/**
 * The numbers a figure is MADE of. A stem that already states them does not
 * need the picture (nine of twelve corpus figures were decorative for exactly
 * this reason): "a bar has 4 parts and 1 is shaded — which fraction?" asks
 * the child to read nothing.
 */
function figureDefiningNumbers(spec) {
  const type = canonicalType(spec && spec.type);
  const nums = [];
  const push = (v) => { if (v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v))) nums.push(String(Number(v))); };
  const fromLabel = (label) => (String(label || '').match(/-?\d+(?:\.\d+)?/g) || []).forEach(push);
  switch (type) {
    case 'fraction_bar': (spec.bars || []).forEach((b) => { push(b.parts); push(b.shaded); }); break;
    case 'grid': push(spec.shaded); break;
    case 'numberline':
      (spec.points || []).forEach((p) => push(p && p.at));
      (spec.arcs || []).forEach((a) => { push(a && a.from); push(a && a.to); fromLabel(a && a.label); });
      break;
    case 'geometry': (spec.shapes || []).forEach((sh) => (sh.sides || []).forEach(fromLabel)); break;
    case 'timeline': (spec.events || []).forEach((e) => fromLabel(e && e.date)); break;
    // The counts, not the zeros: "0" matches inside half the numbers a stem can
    // mention, and a stem that says "no tens" states nothing the mat is made of.
    case 'base_ten': ['thousands', 'hundreds', 'tens', 'ones'].forEach((k) => { if (Number(spec[k]) > 0) push(spec[k]); }); break;
    default: break;
  }
  return [...new Set(nums)];
}

/**
 * True when the stem restates enough of the figure's defining numbers that
 * the picture adds nothing: all of them for a one-bar fraction, otherwise two
 * or more.
 */
function figureIsRedundant(spec, stem) {
  const nums = figureDefiningNumbers(spec);
  if (!nums.length) return false;
  const text = norm(stem);
  const inStem = nums.filter((v) => new RegExp(`(^|[^\\d.])${v.replace('.', '\\.')}(?![\\d.])`).test(text));
  const need = canonicalType(spec.type) === 'fraction_bar' ? nums.length : Math.min(2, nums.length);
  return inStem.length >= need;
}

// ─── the label gate ──────────────────────────────────────────────────────────

/**
 * A shape name is never a legitimate label on a bar or a grid — the type
 * already draws the shape, so the word can only be a stray leftover from an
 * author who wrote what a hand-drawn diagram would have been called on the
 * board. Both scripts; `fixTransliterations` maps سرکل→circle, and the
 * stripper runs on either side of that fixer depending on language, so both
 * forms must be caught.
 */
const SHAPE_NAMES = new Set([
  'circle', 'circles', 'bar', 'bars', 'strip', 'square', 'rectangle', 'triangle', 'pizza', 'roti',
  'chapati', 'cake', 'chocolate', 'apple', 'orange', 'shape', 'whole',
  'دائرہ', 'دائرے', 'سرکل', 'بار', 'پٹی', 'مربع', 'مستطیل', 'مثلث', 'پیزا', 'روٹی', 'چپاتی', 'کیک',
  'چاکلیٹ', 'سیب', 'شکل', 'ہول',
].map(norm));

/** Single-letter handles and the units a label is allowed to carry bare. */
const UNITS = new Set(['cm', 'm', 'km', 'mm', 'kg', 'g', 's', 'min', 'hr', 'ml', 'l', '%', 'v', 'ω', '°c']);

/** Whitespace-separated content words, punctuation trimmed off each end. */
function contentTokens(str) {
  return String(str)
    .split(/\s+/)
    .map((t) => t.replace(/^["'“”‘’(),.:;!?]+|["'“”‘’(),.:;!?]+$/g, ''))
    .filter(Boolean);
}

function isNumericToken(tok) {
  const t = norm(tok);
  return /^-?\d+(\.\d+)?%?$/.test(t) || /^\d+\s*\/\s*\d+$/.test(t);
}

function isHandleOrUnit(tok) {
  const t = norm(tok);
  return /^[a-z]$/.test(t) || UNITS.has(t);
}

/** Is `tok` present, on a word boundary, in the question the child reads? */
function inQuestion(tok, haystack) {
  const t = norm(tok);
  if (!t) return true;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack)) return true;
  return sameNameOtherScript(t, haystack);
}

// ─── one name, two scripts ───────────────────────────────────────────────────
// A bar named «حرا کی بوتل» under a stem that wrote "‏Hira کی بوتل" lost its
// label: "حرا" is not "Hira" to a string match (a replay, grade 4 Urdu). A
// person's name written in both scripts keeps the same CONSONANTS — ح ر / h r,
// ا ح م د / (a) h m d, س ا ر ہ / s (a) r (a) — so a label word in one script
// counts as used by the question when a word in the other script has the same
// consonant skeleton. Vowels, the silent ع, and w/v/y (which Urdu writes with
// و / ی, letters that are just as often vowels) are left out on both sides.
const URDU_CONSONANT = {
  'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ط': 't', 'ث': 's', 'س': 's', 'ص': 's', 'ج': 'j', 'چ': 'c',
  'ح': 'h', 'ہ': 'h', 'ھ': 'h', 'خ': 'x', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ز': 'z', 'ض': 'z', 'ظ': 'z',
  'ژ': 'z', 'ر': 'r', 'ڑ': 'r', 'ش': 'S', 'غ': 'g', 'ف': 'f', 'ق': 'k', 'ک': 'k', 'گ': 'g', 'ل': 'l',
  'م': 'm', 'ن': 'n', 'ں': 'n',
};
function urduSkeleton(word) {
  const letters = [...String(word)].filter((ch) => /\p{Script=Arabic}/u.test(ch));
  // a word-final ہ is the vowel "a" («سارہ» Sara), not an h
  if (letters.length > 1 && letters[letters.length - 1] === 'ہ') letters.pop();
  return letters.map((ch) => URDU_CONSONANT[ch] || '').join('');
}
function latinSkeleton(word) {
  return String(word).toLowerCase()
    .replace(/sh/g, 'S').replace(/kh/g, 'x').replace(/gh/g, 'g').replace(/ch/g, 'c').replace(/ph/g, 'f')
    .replace(/q/g, 'k').replace(/[^a-zS]/g, '')
    .replace(/[aeiouywv]/g, '')
    .replace(/(.)\1+/g, '$1');
}
function sameNameOtherScript(tok, haystack) {
  const urdu = /\p{Script=Arabic}/u.test(tok);
  const mine = urdu ? urduSkeleton(tok).replace(/(.)\1+/g, '$1') : latinSkeleton(tok);
  if (!mine) return false;
  const words = String(haystack).split(/[^\p{L}]+/u).filter(Boolean);
  return words.some((w) => {
    const other = /\p{Script=Arabic}/u.test(w);
    if (other === urdu) return false;
    return (other ? urduSkeleton(w).replace(/(.)\1+/g, '$1') : latinSkeleton(w)) === mine;
  });
}

/**
 * Judge one label string against the question it belongs to.
 * @returns {{keep: true} | {keep: false, reason: 'shape_name'|'not_in_question'}}
 */
function judgeLabel(str, { haystack, blockShapeNames }) {
  const toks = contentTokens(str);
  if (!toks.length) return { keep: true }; // '' is a deliberate suppression, not a stray word
  if (blockShapeNames && toks.some((t) => SHAPE_NAMES.has(norm(t)))) {
    return { keep: false, reason: 'shape_name' };
  }
  const allPass = toks.every((t) => isNumericToken(t) || isHandleOrUnit(t) || inQuestion(t, haystack));
  return allPass ? { keep: true } : { keep: false, reason: 'not_in_question' };
}

/**
 * Strip a figure spec of any label that is neither a value the type computes
 * nor a word the question itself uses (PLAN_R4 D7a). A shape name is stripped
 * from a `fraction_bar` or a `grid` unconditionally — the operator's case was
 * a stem that named the shape ("روٹی") and STILL got a labelled bar back, so
 * the in-question exemption never applies to a shape word on those two types.
 *
 * Scoped to an explicit per-type key list, not a blanket walk: a `numberline`,
 * `timeline`, `flow`, `circuit`, `free_body`, `punnett`, `atom`, `ray_diagram`,
 * `cell`, `chem_equation` or `graph`'s point/step/cell/force labels ARE the
 * drawing's content and are left untouched.
 *
 * @param {object} spec
 * @param {{stem: string, options: string[]}} ctx
 * @returns {{spec: object, stripped: {key: string, value: string, reason: string}[]}}
 */
function stripStrayLabels(spec, { stem, options, redact = (v) => v } = {}) {
  if (!spec || typeof spec !== 'object') return { spec, stripped: [] };
  const type = canonicalType(spec.type) || spec.type;
  const haystack = norm([stem, ...(Array.isArray(options) ? options : [])].join(' '));
  const blockShapeNames = type === 'fraction_bar' || type === 'grid';
  const stripped = [];
  const cleaned = JSON.parse(JSON.stringify(spec));

  const consider = (holder, key, pathKey) => {
    const value = holder[key];
    if (typeof value !== 'string') return;
    const verdict = judgeLabel(value, { haystack, blockShapeNames });
    if (verdict.keep) return;
    stripped.push({ key: pathKey || key, value, reason: verdict.reason });
    // the label can be a person's name: the caller's redactor hashes it (D4)
    logEvent('transcript_quiz.figure_label_stripped', { type, key: pathKey || key, value: redact(value), reason: verdict.reason });
    delete holder[key];
  };

  ['title', 'caption', 'note'].forEach((key) => consider(cleaned, key, key));

  if (type === 'fraction_bar') {
    ['totalLabel', 'unitLabel'].forEach((key) => consider(cleaned, key, key));
    if (Array.isArray(cleaned.bars)) {
      cleaned.bars.forEach((bar, i) => {
        if (!bar || typeof bar !== 'object') return;
        ['label', 'value'].forEach((key) => consider(bar, key, `bars[${i}].${key}`));
        if (Array.isArray(bar.partLabels)) {
          bar.partLabels.forEach((pl, j) => {
            if (typeof pl !== 'string') return;
            const verdict = judgeLabel(pl, { haystack, blockShapeNames });
            if (verdict.keep) return;
            const pathKey = `bars[${i}].partLabels[${j}]`;
            stripped.push({ key: pathKey, value: pl, reason: verdict.reason });
            logEvent('transcript_quiz.figure_label_stripped', { type, key: pathKey, value: redact(pl), reason: verdict.reason });
            bar.partLabels[j] = ''; // blank in place — position maps to a bar segment
          });
        }
      });
    }
  }

  if (type === 'grid') {
    if (cleaned.legend !== '') consider(cleaned, 'legend', 'legend');
    if (Array.isArray(cleaned.cellText)) {
      cleaned.cellText.forEach((entry, i) => {
        if (!Array.isArray(entry) || typeof entry[2] !== 'string') return;
        const verdict = judgeLabel(entry[2], { haystack, blockShapeNames });
        if (verdict.keep) return;
        const pathKey = `cellText[${i}]`;
        stripped.push({ key: pathKey, value: entry[2], reason: verdict.reason });
        logEvent('transcript_quiz.figure_label_stripped', { type, key: pathKey, value: redact(entry[2]), reason: verdict.reason });
        entry[2] = ''; // blank in place — [row, col] still address the cell
      });
    }
  }

  return { spec: cleaned, stripped };
}

// ─── picture ─────────────────────────────────────────────────────────────────

const tokenCss = () => Object.entries(NIETE_TOKENS).map(([k, v]) => `--${k}:${v};`).join('');

/**
 * Wrap an SVG in a self-contained page sized for a phone: 1080x565, white
 * ground, the vendored fonts embedded as base64 (a font fetched at render time
 * is the tofu bug), and the diagram palette bound to the NIETE tokens.
 *
 * Framed (see FRAME): a band with "Question n of N" at the reading-start edge
 * and the NIETE mark at the other — the question card's own counter string,
 * mark and lattice (quiz-picture-chrome), laid out in the quiz language's
 * direction. The DRAWING stays left-to-right whatever the language; a fraction
 * bar is not mirrored. Without a number the band still carries the mark, so the
 * drawing's box is the same size either way.
 *
 * @param {string} svg
 * @param {string} language
 * @param {{questionNumber?: number, total?: number}} [opts]
 * @returns {string} HTML
 */
function figureHtml(svg, language, { questionNumber = null, total = null } = {}) {
  const { css, missing } = fontCss({ urdu: true });
  if (missing.length) logToFile('⚠️ transcript quiz figure: font face missing', { missing });
  const ur = language === 'ur';
  const Chrome = require('./quiz-picture-chrome');
  const counter = questionNumber && total
    ? `<div class="counter">${escHtml(Chrome.paintedCounter(questionNumber, total, language))}</div>`
    : '<div class="counter"></div>';
  const mark = Chrome.markB64() ? `<div class="mark"><img src="data:image/png;base64,${Chrome.markB64()}"></div>` : '';
  // The question card's own counter type (26px Latin, 30px Nastaliq on the same
  // 1080px canvas), so the two kinds of question picture print the number alike.
  const counterFont = ur
    ? "font-family:'Noto Nastaliq Urdu','NastaliqUrdu','Noto Naskh Arabic',serif;font-size:30px;letter-spacing:0;"
    : "font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:26px;letter-spacing:.08em;text-transform:uppercase;";
  return `<html lang="${ur ? 'ur' : 'en'}"><head><meta charset="utf-8"><style>
${css}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#FFFFFF}
.fig{${tokenCss()}
  width:${PNG_WIDTH}px;height:${PNG_HEIGHT}px;background:#FFFFFF;
  padding:${FRAME.padTop}px ${FRAME.padX}px ${FRAME.padBottom}px;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  position:relative;overflow:hidden;
  font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:var(--ink);
  direction:ltr;unicode-bidi:isolate;}
.fig svg{display:block;width:auto;height:auto;max-width:100%;max-height:100%}
.fig svg.lattice{position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;max-height:none;opacity:.07;pointer-events:none}
.top{width:100%;height:${FRAME.band}px;margin-bottom:${FRAME.gap}px;flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;position:relative}
.top[dir="rtl"]{direction:rtl}
.counter{${counterFont}font-weight:600;color:#47BA7D;line-height:${FRAME.band}px;white-space:nowrap}
.mark{width:${FRAME.band}px;height:${FRAME.band}px;background:#333748;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto}
.mark img{width:${FRAME.band - 6}px;height:${FRAME.band - 6}px;display:block}
.box{width:${FIG_BOX.w}px;height:${FIG_BOX.h}px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;position:relative}
.box > svg{background:#FFFFFF}
.fig [lang="ur"]{font-family:'Noto Nastaliq Urdu','Noto Naskh Arabic',serif;line-height:normal}
</style></head><body><div class="fig">
<svg class="lattice" viewBox="0 0 1080 1400" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#47BA7D" stroke-width="1.5">${Chrome.latticePaths()}</g></svg>
<div class="top" dir="${ur ? 'rtl' : 'ltr'}">${counter}${mark}</div>
<div class="box">${svg}</div>
</div></body></html>`;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The PNG a child receives. deviceScaleFactor 1 at 1080px is already retina on
 * a phone and keeps the object small enough that the per-send media upload is
 * not the slow part of a question.
 * @param {string} svg
 * @param {string} language
 * @param {{questionNumber?: number, total?: number}} [opts] painted into the frame
 * @returns {Promise<Buffer>}
 */
async function renderFigurePng(svg, language, opts = {}) {
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const png = await htmlToImage(figureHtml(svg, language, opts), {
    width: PNG_WIDTH, deviceScaleFactor: 1, selector: '.fig',
  });
  if (!png || !png.length) throw new FigureError('FIGURE_RENDER', 'the figure screenshot came back empty');
  return png;
}

/**
 * One R2 object per question, keyed so a re-generation overwrites rather than
 * accumulates, and so the media-id cache in sendImageWithButtons has a stable
 * key to hash.
 * @returns {Promise<string>} the URL stored in quiz_questions.media.question_image
 */
async function uploadFigure({ teacherId, quizId, index, png }) {
  const { uploadBuffer } = require('../../storage/r2');
  const key = path.posix.join(R2_PREFIX, String(teacherId), String(quizId), `q${index}.png`);
  return uploadBuffer(png, key, 'image/png');
}

module.exports = {
  singleThingNotACount,
  drawsEmptySet,
  NIETE_TOKENS,
  EARLY_YEARS_TYPES,
  CORE_TYPES,
  MATHS_ONLY_TYPES,
  unknownColourToken,
  languageDefaults,
  figureMismatch,
  equalAmountOptions,
  relabelLetterParts,
  partLabelSlots,
  unnamedParts,
  unnamedBarInNamedSet,
  expandImproperBar,
  svgInkCount,
  figureIsRedundant,
  figureDefiningNumbers,
  GEOMETRY_KINDS,
  figureEmptyReason,
  ALLOWED_TYPES,
  TYPE_DEFAULTS,
  FigureError,
  canonicalType,
  minimalSpecFor,
  minimalSpecBlock,
  limitsFor,
  renderFigureSvg,
  withFontScale,
  PHONE_FONT_SCALE,
  SCALE_LADDER,
  stripStrayLabels,
  figureLeaksAnswer,
  svgText,
  specStrings,
  mapSpecStrings,
  figureHtml,
  renderFigurePng,
  uploadFigure,
  PNG_WIDTH,
  PNG_HEIGHT,
  FIG_BOX,
  R2_PREFIX,
};
