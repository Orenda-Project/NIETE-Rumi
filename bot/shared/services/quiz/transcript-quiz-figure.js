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
 *     → renderFigurePng()    1080px, fonts embedded, white ground
 *     → uploadFigure()       one R2 object per question
 *     → quiz_questions.media.question_image, render_pattern 'P3'
 *
 * The child then gets ONE interactive message per question: image header, stem
 * body, three reply buttons — never a picture after the options, never a
 * picture the question does not need.
 *
 * Pure and synchronous down to renderFigurePng (the engine is synchronous), so
 * the validator can run the render gate inline.
 */

const path = require('path');
const { renderDiagram, checkOverlaps } = require('../../../vendor/lp-v9/diagrams');
const MANIFEST = require('../../../vendor/lp-v9/diagrams/types_manifest.json');
const { fontCss } = require('../../../vendor/lp-v9/lib/fonts');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

/**
 * The types that survive a 1080px-wide picture on a mid-range Android phone AND
 * are safe to hand a flash-tier model. Order is the order the author sees them.
 *
 * Deliberately excluded, and why:
 *   illustrative     a brief for an image generator, not a drawing
 *   labelled_figure  needs a raster we do not have for a lesson transcript
 *   mindmap          leaks by construction — the branches ARE the answer
 *   molecule         SMILES from a flash model is a gamble
 *   panels           prose in a box; a child reads it as text, not a picture
 *   dna_helix        decorative, nothing to read off it
 */
const ALLOWED_TYPES = [
  'numberline', 'fraction_bar', 'grid', 'geometry', 'graph', 'chem_equation', 'circuit',
  'free_body', 'atom', 'punnett', 'ray_diagram', 'flow', 'timeline', 'cell',
];

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

/** Keys whose value is a structural enum, not label text a child reads. */
const STRUCTURAL_KEYS = new Set([
  'type', 'lang', 'kind', 'mode', 'style', 'color', 'colour', 'engine', 'layout',
  'direction', 'orientation', 'labelFormat', 'bond', 'shape', 'element',
]);

const R2_PREFIX = 'transcript_quizzes';
const PNG_WIDTH = 1080;
// WhatsApp shows an interactive message's image header at about 1.91:1 and
// crops whatever does not fit (a 1080x158 bar lost its right end on the
// operator's phone). A canvas of exactly that shape is never cropped; the
// drawing is centred inside it.
const PNG_HEIGHT = 565;

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

/** The manifest's minimal spec for a type, with this lane's defaults applied. */
function minimalSpecFor(type) {
  const entry = MANIFEST.types.find((m) => m.type === type);
  if (!entry) throw new FigureError('FIGURE_TYPE', `no manifest entry for "${type}"`);
  return { ...(TYPE_DEFAULTS[type] || {}), ...entry.minimal_spec };
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
 * @returns {string}
 */
function minimalSpecBlock() {
  return ALLOWED_TYPES.map((type) => {
    const entry = MANIFEST.types.find((m) => m.type === type);
    const req = (entry.required || []).join(', ') || '—';
    const limits = limitsFor(type).map((l) => `\n    · ${l}`).join('');
    return `- ${type} — ${entry.for}\n  required: ${req}\n  minimal: ${JSON.stringify(minimalSpecFor(type))}`
      + (limits ? `\n  limits:${limits}` : '');
  }).join('\n');
}

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
  const merged = { ...(TYPE_DEFAULTS[type] || {}), ...spec, type, lang: language === 'ur' ? 'ur' : 'en' };

  let svg;
  try {
    svg = renderDiagram(merged);
  } catch (err) {
    throw new FigureError('FIGURE_RENDER',
      `the ${type} figure could not be drawn: ${String(err.message).split('\n')[0]}`);
  }
  // Named FIGURE_OVERLAP, not FIGURE_RENDER: the retry prompt quotes these
  // codes back to the model, and "the engine threw" and "the engine drew it
  // with two labels on top of each other" are different things to fix. Same
  // gate the LP lane runs as DIAGRAM_OVERLAP; transcript-quiz-figure-gates.js
  // exposes it as a defect object for callers that do not want the throw.
  const overlaps = checkOverlaps(svg);
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
const MATHS_ONLY_TYPES = new Set(['geometry']);

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
function figureMismatch(spec, options, correctIndex) {
  const type = canonicalType(spec && spec.type);
  const correct = norm((Array.isArray(options) ? options : [])[Number(correctIndex)]);
  if (!correct) return null;
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(correct);
  const whole = /^\d+$/.test(correct) ? Number(correct) : null;
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
      if (bars.some((b) => Number(b.shaded) < 0 || Number(b.shaded) > Number(b.parts))) return 'shaded must be between 0 and parts';
      return null;
    }
    case 'numberline':
      return n(spec.points) + n(spec.arcs) + n(spec.intervals) + n(spec.rays) ? null : 'a number line needs at least one point, arc, interval or ray';
    case 'timeline':
      return n(spec.events) >= 2 ? null : 'a timeline needs at least 2 events';
    case 'flow':
      return n(spec.steps) >= 2 ? null : 'a flow needs at least 2 steps';
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
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack);
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
function stripStrayLabels(spec, { stem, options } = {}) {
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
    logEvent('transcript_quiz.figure_label_stripped', { type, key: pathKey || key, value, reason: verdict.reason });
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
            logEvent('transcript_quiz.figure_label_stripped', { type, key: pathKey, value: pl, reason: verdict.reason });
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
        logEvent('transcript_quiz.figure_label_stripped', { type, key: pathKey, value: entry[2], reason: verdict.reason });
        entry[2] = ''; // blank in place — [row, col] still address the cell
      });
    }
  }

  return { spec: cleaned, stripped };
}

// ─── picture ─────────────────────────────────────────────────────────────────

const tokenCss = () => Object.entries(NIETE_TOKENS).map(([k, v]) => `--${k}:${v};`).join('');

/**
 * Wrap an SVG in a self-contained page sized for a phone: 1080px wide, white
 * ground, the vendored fonts embedded as base64 (a font fetched at render time
 * is the tofu bug), and the diagram palette bound to the NIETE tokens.
 * @param {string} svg
 * @param {string} language
 * @returns {string} HTML
 */
function figureHtml(svg, language) {
  const { css, missing } = fontCss({ urdu: true });
  if (missing.length) logToFile('⚠️ transcript quiz figure: font face missing', { missing });
  const ur = language === 'ur';
  return `<html lang="${ur ? 'ur' : 'en'}"><head><meta charset="utf-8"><style>
${css}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#FFFFFF}
.fig{${tokenCss()}
  width:${PNG_WIDTH}px;height:${PNG_HEIGHT}px;background:#FFFFFF;padding:36px 32px;
  display:flex;align-items:center;justify-content:center;
  font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:var(--ink);
  direction:ltr;unicode-bidi:isolate;}
.fig svg{display:block;width:auto;height:auto;max-width:100%;max-height:100%}
.fig [lang="ur"]{font-family:'Noto Nastaliq Urdu','Noto Naskh Arabic',serif;line-height:normal}
</style></head><body><div class="fig">${svg}</div></body></html>`;
}

/**
 * The PNG a child receives. deviceScaleFactor 1 at 1080px is already retina on
 * a phone and keeps the object small enough that the per-send media upload is
 * not the slow part of a question.
 * @param {string} svg
 * @param {string} language
 * @returns {Promise<Buffer>}
 */
async function renderFigurePng(svg, language) {
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const png = await htmlToImage(figureHtml(svg, language), {
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
  NIETE_TOKENS,
  MATHS_ONLY_TYPES,
  unknownColourToken,
  figureMismatch,
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
  stripStrayLabels,
  figureLeaksAnswer,
  svgText,
  figureHtml,
  renderFigurePng,
  uploadFigure,
  PNG_WIDTH,
  PNG_HEIGHT,
  R2_PREFIX,
};
