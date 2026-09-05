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
};

/** Keys whose value is a structural enum, not label text a child reads. */
const STRUCTURAL_KEYS = new Set([
  'type', 'lang', 'kind', 'mode', 'style', 'color', 'colour', 'engine', 'layout',
  'direction', 'orientation', 'labelFormat', 'bond', 'shape', 'element',
]);

const R2_PREFIX = 'transcript_quizzes';
const PNG_WIDTH = 1080;

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
 * The allowlist block the author prompt carries: one line per type, its
 * one-line purpose, and a minimal spec that is GENERATED from the engine
 * manifest rather than hand-copied, so the prompt can never teach a shape the
 * engine no longer accepts.
 * @returns {string}
 */
function minimalSpecBlock() {
  return ALLOWED_TYPES.map((type) => {
    const entry = MANIFEST.types.find((m) => m.type === type);
    const req = (entry.required || []).join(', ') || '—';
    return `- ${type} — ${entry.for}\n  required: ${req}\n  minimal: ${JSON.stringify(minimalSpecFor(type))}`;
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
  const overlaps = checkOverlaps(svg);
  if (overlaps.length) {
    const pair = overlaps[0];
    throw new FigureError('FIGURE_RENDER',
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
function figureLeaksAnswer(spec, options, correctIndex, svg = null) {
  if (!spec || typeof spec !== 'object') return false;
  const opts = (Array.isArray(options) ? options : []).map(norm);
  const correct = opts[Number(correctIndex)];
  if (!correct) return false;

  const visible = [...specStrings(spec), ...(svg ? svgText(svg) : [])].map(norm).filter(Boolean);
  const joined = visible.join(' | ');
  const tokens = new Set(joined.split(/[\s|,;:()[\]"'’“”]+/).filter(Boolean));
  const shows = (text) => !!text && (text.length >= 4 ? joined.includes(text) : tokens.has(text));

  if (!shows(correct)) return false;
  return !opts.every((o) => shows(o));
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
  width:${PNG_WIDTH}px;background:#FFFFFF;padding:36px 32px;
  font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:var(--ink);
  direction:ltr;unicode-bidi:isolate;}
.fig svg{display:block;width:100%;height:auto}
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
  ALLOWED_TYPES,
  TYPE_DEFAULTS,
  FigureError,
  canonicalType,
  minimalSpecFor,
  minimalSpecBlock,
  renderFigureSvg,
  figureLeaksAnswer,
  svgText,
  figureHtml,
  renderFigurePng,
  uploadFigure,
  PNG_WIDTH,
  R2_PREFIX,
};
