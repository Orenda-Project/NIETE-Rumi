'use strict';
/**
 * Web quiz figures: what a question's picture is when the child plays on the
 * web page instead of in WhatsApp.
 *
 * WhatsApp's caps (a 20-character button, a 1024-character body) are why a
 * question with long options or maths is sent there as a CARD — a PNG with the
 * stem and the options painted in — and why a figure is framed with the quiz
 * chrome (counter, mark, lattice). The web page has no such caps: the stem and
 * the options are text on the page, so the card would show the question twice.
 * Here a question's picture is only ever the DRAWING:
 *
 *   media.web.figure.spec  (the v2 item)          ┐ drawn now by the lp-v9 engine,
 *   media.figure           (today's figure spec)  ┘ inline SVG, no chrome
 *   media.question_image   the figure-only PNG — the fallback when a spec will not draw
 *   media.question_card    NEVER (it is a picture of text)
 *
 * The SVG is drawn at read time, never stored: the engine is deterministic, so
 * the child sees the same drawing the WhatsApp child saw, and a renderer fix
 * reaches old quizzes for free.
 *
 * Every SVG that leaves here is checked against an allowlist (safeSvg) because
 * the page puts it inline. Labels come from an author model; the engine escapes
 * them, and the allowlist is the second lock.
 *
 * Pure and synchronous. Never throws: a figure that cannot be made is null.
 */

const { logToFile } = require('../../utils/logger');
const { clampLanguage, resolveUx } = require('../../config/ux-strings');
const { getLanguage } = require('../../config/languages');
const Pictures = require('./pictures');

const dirOf = (lang) => ((getLanguage(lang) || {}).direction === 'rtl' ? 'rtl' : 'ltr');

const CACHE_MAX = 400;
const cache = new Map();

// Tags the engine and the pictogram set emit (measured over every figure spec
// in production), plus the inline HTML the engine puts inside a foreignObject
// for right-to-left labels.
const TAGS = new Set([
  'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'desc', 'title',
  'foreignobject', 'div', 'span', 'b', 'i', 'sup', 'sub', 'br',
]);
const BAD_ATTR = /^(on|href$|xlink:href$|src$|srcset$|action$|formaction$)/i;
const BAD_VALUE = /url\s*\(|javascript:|expression\s*\(|@import|data:text\/html/i;

/** The drawing, if every tag and attribute is on the allowlist; else null. */
function safeSvg(svg) {
  const s = String(svg == null ? '' : svg).trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) return null;
  if (/<!|<\?/.test(s)) return null;
  const tagRe = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(s))) {
    if (!TAGS.has(m[1].toLowerCase())) return null;
    const attrRe = /([^\s=/]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
    let a;
    while ((a = attrRe.exec(m[2]))) {
      if (BAD_ATTR.test(a[1]) || BAD_VALUE.test(a[2])) return null;
    }
  }
  return s;
}

// What the page and the voice say about a figure. Never a count, a shaded
// number or a label value: the picture may be the question, so the words that
// introduce it must not answer it.
const WORDS = {
  fraction_bar: 'Bars', numberline: 'Numberline', clock: 'Clock', money: 'Money', geometry: 'Shape',
  graph: 'Graph', flow: 'Steps', timeline: 'Timeline', word_blank: 'Word',
};

/** [alt, say] for a figure type, from the string catalog. */
const POINTS_AT_PICTURE = /\b(look|picture|diagram|figure|image|shown|drawn)\b|تصویر|شکل|خاکہ|دیکھ/i;

function wordsFor(type, lang) {
  const k = WORDS[type] || 'Picture';
  return [resolveUx(`wqFig${k}Alt`, { language: lang }), resolveUx(`wqFig${k}Say`, { language: lang })];
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** viewBox width and height, so the page can hold the box before the drawing paints. */
function boxOf(svg) {
  const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 0, h: 0 };
}

/**
 * The page draws the engine's nouns in COLOUR (the picture bank): a row of
 * grey outline apples or a line-art cat is hard to read at 360 px. The painter
 * is scoped to this one synchronous render, so the WhatsApp PNG path, which
 * calls the same engine, keeps its line art.
 */
function withColour(fn) {
  let P = null;
  try { P = require('../../../vendor/lp-v9/diagrams/lib/pictogram'); } catch (_) { return fn(); }
  if (typeof P.withPainter !== 'function') return fn();
  return P.withPainter((noun) => Pictures.colorInner(noun), fn);
}

/**
 * Page-only drawing choices. The WhatsApp picture is a 1080x565 card; on the
 * page a figure is as wide as the phone, so a one-bar fraction picture came out
 * 312 x 26 px, a strip a child cannot count parts in. One or two bars are drawn
 * taller here (the spec's own barHeight, and the circle model, are kept). A graph
 * is drawn narrower and a base-ten mat of blocks stacked, so their labels and rods
 * read at phone size. If the page's choice crowds a figure, draw() falls back to
 * the stored spec.
 */
function forPage(spec) {
  if (spec && spec.type === 'fraction_bar' && spec.model !== 'circle' && spec.barHeight == null
    && Array.isArray(spec.bars) && spec.bars.length >= 1 && spec.bars.length <= 2) {
    return { ...spec, barHeight: 120 };
  }
  // A graph drawn 620 wide put its labels at ~7 px in a 344 px box; drawn 380
  // wide the same 13-unit labels are ~12 px. A spec that sets its width keeps it.
  if (spec && spec.type === 'graph' && spec.width == null) return { ...spec, width: PAGE_GRAPH_W };
  // Three flats side by side made a mat ~850 wide, its tens rods ~6 px on the
  // phone; stacked (SYNC.md §3.32) they are ~9 px and every piece is bigger.
  if (spec && spec.type === 'base_ten' && spec.model === 'blocks' && spec.stack == null) return { ...spec, stack: true };
  return spec;
}
const PAGE_GRAPH_W = 380;

/** The engine, through the quiz's own phone-tuned renderer (allowlist, font ladder, overlap gate). */
function draw(rawSpec, lang) {
  const spec = forPage(rawSpec);
  const key = `c|${lang}|${JSON.stringify(spec)}`;
  if (cache.has(key)) return cache.get(key);
  const render = (sp) => withColour(() => require('./transcript-quiz-figure').renderFigureSvg(sp, lang));
  let svg = null;
  try {
    svg = render(spec);
  } catch (err) {
    // The page's own size (a narrower graph, a stacked mat) can crowd a figure the
    // engine draws cleanly as stored: then the page shows the stored drawing.
    if (spec !== rawSpec) {
      try { svg = render(rawSpec); } catch (_) { svg = null; }
    }
    if (!svg) logToFile('⚠️ web quiz: figure not drawn', { type: spec && spec.type, error: String(err.message || err).slice(0, 160) });
  }
  svg = svg ? safeSvg(svg) : null;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, svg);
  return svg;
}

/**
 * The NIETE palette, set as custom properties on the drawing's own root. The
 * engine paints with var(--amber, <default>) etc.; on WhatsApp the PNG frame
 * sets them, and on the page nothing would, so the child would see the
 * engine's default colours instead of the ones the WhatsApp picture has.
 */
let _tokenCss = null;
function tokenCss() {
  if (_tokenCss === null) {
    try {
      const { NIETE_TOKENS } = require('./transcript-quiz-figure');
      _tokenCss = Object.entries(NIETE_TOKENS).map(([k, v]) => `--${k}:${v}`).join(';') + ';';
    } catch (_) { _tokenCss = ''; }
  }
  return _tokenCss;
}

function withTokens(svg) {
  const css = tokenCss();
  if (!css) return svg;
  return /^<svg[^>]*\sstyle="/.test(svg)
    ? svg.replace(/^(<svg[^>]*\s)style="/, `$1style="${css}`)
    : svg.replace(/^<svg/, `<svg style="${css}"`);
}

function withLabel(svg, alt) {
  const label = escAttr(alt);
  return /^<svg[^>]*\saria-label="/.test(svg)
    ? svg.replace(/^(<svg[^>]*\s)aria-label="[^"]*"/, `$1aria-label="${label}"`)
    : svg.replace(/^<svg/, `<svg aria-label="${label}"`);
}

// A review of the question's picture against its stem and key (media.picture_check,
// written by the picture review). A picture that contradicts the key (the key says
// the cat slept, the picture shows it awake) or ignores the question (asks who lived
// in the forest, shows only trees) is never shown on the page, drawn or as a file.
// WhatsApp does not read it.
const PICTURE_HIDDEN = new Set(['contradicts', 'ignores']);
function pictureHidden(media) {
  const c = media && media.picture_check;
  return Boolean(c && PICTURE_HIDDEN.has(c.verdict));
}

/**
 * The figure the page shows for one quiz_questions row, or null.
 * @returns {null | {kind:'svg', svg, type, w, h, alt, say, dir} | {kind:'img', src:'question_image', type, alt, say, dir}}
 */
function figureFor(row) {
  const media = (row && row.media) || {};
  if (pictureHidden(media)) return null;
  // A WhatsApp match question plays as the page's tap-to-match; its lettered drawing is not shown too.
  if (!(media.web && media.web.v === 2) && matchItem(row)) return null;
  const lang = clampLanguage(media.language);
  const dir = dirOf(lang);
  const v2 = media.web && media.web.figure && typeof media.web.figure === 'object' ? media.web.figure : null;
  const spec = (v2 && v2.spec) || (media.figure && typeof media.figure === 'object' ? media.figure : null);
  const type = spec ? String(spec.type || '') : '';
  const [defAlt, defSay] = wordsFor(type, lang);
  const alt = (v2 && typeof v2.alt === 'string' && v2.alt.trim()) || defAlt;
  // A stem that already points at the picture ("Look at the picture…", "تصویر میں…")
  // gets no second pointer: the child would hear the same words twice.
  const stem = String((media.web && media.web.stem) || (row && row.question_text) || '');
  const say = (v2 && typeof v2.say === 'string' && v2.say.trim()) || (POINTS_AT_PICTURE.test(stem) ? null : defSay);

  if (spec) {
    const svg = draw(spec, lang);
    if (svg) {
      const out = { kind: 'svg', svg: withTokens(withLabel(svg, alt)), type, ...boxOf(svg), alt, say, dir };
      if (v2 && Array.isArray(v2.hotspots)) out.hotspots = v2.hotspots;
      return out;
    }
  }
  if (media.question_image) return { kind: 'img', src: 'question_image', type: type || null, alt, say, dir };
  return null;
}

/**
 * A picture option: a roster pictogram, a small engine drawing, or a GLYPH tile
 * (a letter or a mark — بّ, c_t — drawn big in the page's own font, for the
 * early literacy lessons whose answers are marks, not things), as SVG.
 *
 * The NAME is what the voice says and the screen reader reads, so it must be in
 * the quiz language: the item's own word for the option (`word`, normally the
 * option text) wins; the roster's English name is used only for an English quiz.
 *
 * Never emoji, never model-written SVG. null when it cannot be drawn or named —
 * the option then stays a word, never a blank or an English voice on Urdu.
 */
function optionPic(pic, language, { word } = {}) {
  if (!pic || typeof pic !== 'object') return null;
  const lang = clampLanguage(language);
  const said = (typeof pic.say === 'string' && pic.say.trim()) || (typeof word === 'string' && word.trim()) || '';
  if (pic.kind === 'pictogram') {
    try {
      const P = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
      const colour = Pictures.colorInner(P.key(pic.name));
      if (!colour && !P.has(pic.name)) return null;
      // The roster names are English words: they may be spoken only on an English quiz.
      const rosterName = (lang === 'en' && String(pic.name).replace(/_/g, ' ')) || '';
      // An emoji option has no word in any language (the picture IS the option,
      // and "which one is a leaf?" must not be answered by a caption): it is
      // drawn unnamed, and the page names its button by shape for screen readers.
      const name = pic.unnamed ? '' : said || rosterName;
      if (!name && !pic.unnamed) return null;
      const body = colour || P.inner(pic.name).replace(/currentColor/g, 'var(--ink, #1A1A1A)');
      const label = name ? ` aria-label="${escAttr(name)}"` : ' aria-hidden="true"';
      const svg = safeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.GRID} ${P.GRID}" role="img"${label}>${body}</svg>`);
      return svg ? { svg, name, alt: name } : null;
    } catch (_) {
      return null;
    }
  }
  if (pic.kind === 'glyph') {
    // Sent as TEXT: the page sets it in its own Nastaliq at tile size. Drawn
    // inside an SVG the marks (shadda, zer) clipped at the tile's edge.
    const text = String(pic.text == null ? '' : pic.text).trim();
    if (!text || [...text].length > 4) return null;
    const name = said || text;
    return { kind: 'glyph', glyph: text, text, name, alt: name, dir: dirOf(lang) };
  }
  if (pic.kind === 'figure' && pic.spec && typeof pic.spec === 'object') {
    const svg = draw(pic.spec, lang);
    if (!svg) return null;
    const name = said || String(pic.name || wordsFor(String(pic.spec.type || ''), lang)[0]);
    return { svg: withTokens(withLabel(svg, name)), name, alt: name };
  }
  return null;
}

/**
 * The last step of an E2 question: every option whose `pic` is still a stored
 * description ({kind, name|text|spec}) is drawn now, named in the quiz language
 * (o.name, else the option's text). One that cannot be drawn loses its pic and
 * stays a word. A pic that is already a drawing ({svg}) is left alone. Runs
 * after every writer of `options`, so it does not matter which one filled them.
 */
function drawOptionPics(options, language) {
  for (const o of Array.isArray(options) ? options : []) {
    if (!o || !o.pic || typeof o.pic !== 'object' || o.pic.svg || o.pic.glyph) continue;
    const drawn = optionPic(o.pic, language, { word: o.name || o.text });
    if (drawn) o.pic = drawn;
    else delete o.pic;
  }
  return options;
}

/**
 * What a picture option is CALLED on the page and by the voice. The importer
 * stored the WhatsApp list label: "1. Table" (the number is the list row, the
 * page has its own letter badge) or, when no name was ever recorded,
 * "Picture 1". A placeholder is no name: the picture is the option, and the
 * voice must never say "Picture 1".
 * @returns {string|null}
 */
function pictureOptionName(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t || /^(picture|sound|تصویر|آواز)\s*\d+$/i.test(t)) return null;
  return t.replace(/^\d+\s*[.)]\s*/, '').trim() || null;
}

/**
 * A WhatsApp match question as the page's own tap-to-match. On WhatsApp the figure
 * draws lettered rows (cat, dog, cow) and numbered partners (meow, woof, moo), and
 * each option is a code for a whole pairing ("A-1, B-2, C-3"; "P-1, Q-2, R-3" once
 * the page renames the handles). On the page the child links the pairs: the left
 * tiles are each row's letter and picture, the options are the partners, and the
 * key is the pairing the correct code names. Null unless every option decodes into
 * one full pairing and the correct one is among them; then the row plays as today.
 * Read by web-quiz-items webOf, so E2 and the grader see the same item.
 */
const PAIR = /([A-DP-S])\s*[-–—:=→]\s*([1-4١-٤۱-۴])/g;
const HANDLES = { A: 0, B: 1, C: 2, D: 3, P: 0, Q: 1, R: 2, S: 3 };
const digit = (d) => Number(String(d).replace(/[١-٤]/, (c) => c.charCodeAt(0) - 0x0660).replace(/[۱-۴]/, (c) => c.charCodeAt(0) - 0x06f0));
function decodePairing(text, n) {
  const pairs = [...String(text || '').matchAll(PAIR)];
  if (pairs.length !== n) return null;
  const to = new Array(n).fill(null);
  const letters = new Array(n).fill(null);
  for (const [, L, d] of pairs) {
    const row = HANDLES[L];
    const k = digit(d) - 1;
    if (row >= n || k < 0 || k >= n || to[row] !== null) return null;
    to[row] = k; letters[row] = L;
  }
  return new Set(to).size === n ? { to, letters } : null;
}
const entryOf = (e) => (e && typeof e === 'object' ? { picto: e.picto ? String(e.picto) : null, text: e.text != null ? String(e.text) : null }
  : { picto: null, text: e == null ? null : String(e) });
function matchItem(row) {
  const media = (row && row.media) || {};
  const spec = media.figure && typeof media.figure === 'object' && !Array.isArray(media.figure) ? media.figure : null;
  if (!spec || String(spec.type) !== 'match' || spec.handles === false) return null;
  const left = Array.isArray(spec.left) ? spec.left.map(entryOf) : [];
  const right = Array.isArray(spec.right) ? spec.right.map(entryOf) : [];
  const n = left.length;
  if (n < 3 || n > 4 || right.length !== n) return null;
  const codes = [row.option_a, row.option_b, row.option_c, row.option_d].map((t) => (t == null ? '' : String(t).trim()));
  const used = codes.map((t, i) => [t, i]).filter(([t]) => t);
  if (used.length < 2) return null;
  const decoded = used.map(([t]) => decodePairing(t, n));
  if (decoded.some((d) => !d)) return null;
  const ci = 'ABCD'.indexOf(String(row.correct_option || '').trim().toUpperCase());
  const at = used.findIndex(([, i]) => i === ci);
  if (at < 0) return null;
  const { to, letters } = decoded[at];
  const SL = ['A', 'B', 'C', 'D'];
  const name = (e) => (e.text && e.text.trim()) || (e.picto ? e.picto.replace(/_/g, ' ') : '');
  // A plain word the picture bank knows is a picture too (the engine draws it so).
  const pictoOf = (e) => e.picto || (e.text && hasPicto(e.text) ? e.text.trim() : null);
  return {
    v: 2, type: 'match', from: 'whatsapp_match',
    stem: String(row.question_text || ''),
    left: left.map((e, i) => {
      const p = pictoOf(e);
      return { text: letters[i], ...(p ? { pic: { kind: 'pictogram', name: p, say: name(e) } } : {}), name: name(e) };
    }),
    // The partners keep their numbers, as the letters stay on the rows: the stem,
    // the why and the feedback were written about "A" and "1" ("so A goes with 1").
    options: right.map((e, j) => {
      const p = pictoOf(e);
      const word = e.text && !hasPicto(e.text) ? e.text.trim() : (p ? '' : name(e));
      return { slot: SL[j], text: word ? `${j + 1}. ${word}` : String(j + 1), name: name(e), ...(p ? { pic: { kind: 'pictogram', name: p, say: name(e) } } : {}) };
    }),
    key: to.map((k) => SL[k]).join(','),
    why: String(row.explanation || '').trim() || null,
    fb_right: null,
  };
}
function hasPicto(word) {
  try { return require('../../../vendor/lp-v9/diagrams/lib/pictogram').has(String(word).trim()); } catch (_) { return false; }
}

/**
 * A figure that names its own parts A-D (a match figure's row handles, a
 * labelled diagram) collides with the page's A/B/C answer badges: "B" in the
 * picture is not answer B. The authoring gate already renames them for new
 * items (transcript-quiz-figure relabelLetterParts); older rows were written
 * before it. The same pure rename is applied here, to the figure AND every
 * text the page shows (stem, options, why, feedback), so they keep agreeing.
 * Answer slots are untouched. A v2 item's own figure was written after the gate.
 */
function withPartLetters(row) {
  const media = (row && row.media) || {};
  const spec = media.figure && typeof media.figure === 'object' && !Array.isArray(media.figure) ? media.figure : null;
  if (!spec || (media.web && media.web.figure && media.web.figure.spec)) return row;
  let r;
  try {
    r = require('./transcript-quiz-figure').relabelLetterParts({
      figure: spec,
      question: row.question_text,
      options: [row.option_a, row.option_b, row.option_c, row.option_d],
      explanation: row.explanation,
      option_feedback: row.option_feedback,
    });
  } catch (e) {
    logToFile('⚠️ web-quiz: figure part letters kept', { error: e.message });
    return row;
  }
  if (!r || !r.renamed) return row;
  const q = r.question;
  const [a, b, c, d] = q.options;
  return {
    ...row,
    question_text: q.question, option_a: a, option_b: b, option_c: c, option_d: d,
    explanation: q.explanation, option_feedback: q.option_feedback === undefined ? row.option_feedback : q.option_feedback,
    media: { ...media, figure: q.figure },
  };
}

module.exports = { pictureHidden, matchItem, figureFor, optionPic, drawOptionPics, pictureOptionName, withPartLetters, safeSvg, wordsFor };
