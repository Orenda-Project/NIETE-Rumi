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
function wordsFor(type, lang) {
  const k = WORDS[type] || 'Picture';
  return [resolveUx(`wqFig${k}Alt`, { language: lang }), resolveUx(`wqFig${k}Say`, { language: lang })];
}

function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** viewBox width and height, so the page can hold the box before the drawing paints. */
function boxOf(svg) {
  const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 0, h: 0 };
}

/** The engine, through the quiz's own phone-tuned renderer (allowlist, font ladder, overlap gate). */
function draw(spec, lang) {
  const key = `${lang}|${JSON.stringify(spec)}`;
  if (cache.has(key)) return cache.get(key);
  let svg = null;
  try {
    svg = require('./transcript-quiz-figure').renderFigureSvg(spec, lang);
  } catch (err) {
    logToFile('⚠️ web quiz: figure not drawn', { type: spec && spec.type, error: String(err.message || err).slice(0, 160) });
    svg = null;
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

/**
 * The figure the page shows for one quiz_questions row, or null.
 * @returns {null | {kind:'svg', svg, type, w, h, alt, say, dir} | {kind:'img', src:'question_image', type, alt, say, dir}}
 */
function figureFor(row) {
  const media = (row && row.media) || {};
  const lang = clampLanguage(media.language);
  const dir = dirOf(lang);
  const v2 = media.web && media.web.figure && typeof media.web.figure === 'object' ? media.web.figure : null;
  const spec = (v2 && v2.spec) || (media.figure && typeof media.figure === 'object' ? media.figure : null);
  const type = spec ? String(spec.type || '') : '';
  const [defAlt, defSay] = wordsFor(type, lang);
  const alt = (v2 && typeof v2.alt === 'string' && v2.alt.trim()) || defAlt;
  const say = (v2 && typeof v2.say === 'string' && v2.say.trim()) || defSay;

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
      if (!P.has(pic.name)) return null;
      // The roster names are English words: they may be spoken only on an English quiz.
      const rosterName = (lang === 'en' && String(pic.name).replace(/_/g, ' ')) || '';
      const name = said || rosterName;
      if (!name) return null;
      const body = P.inner(pic.name).replace(/currentColor/g, 'var(--ink, #1A1A1A)');
      const svg = safeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.GRID} ${P.GRID}" role="img" aria-label="${escAttr(name)}">${body}</svg>`);
      return svg ? { svg, name, alt: name } : null;
    } catch (_) {
      return null;
    }
  }
  if (pic.kind === 'glyph') {
    const text = String(pic.text == null ? '' : pic.text).trim();
    if (!text || [...text].length > 4) return null;
    const name = said || text;
    const dir = dirOf(lang);
    const svg = safeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="' + escAttr(name) + '">'
      + '<rect x="2" y="2" width="68" height="68" rx="10" fill="#FFFFFF" stroke="var(--line, #D7DBE1)" stroke-width="2"/>'
      + '<foreignObject x="2" y="2" width="68" height="68"><div xmlns="http://www.w3.org/1999/xhtml" dir="' + dir + '" '
      + 'style="width:68px;height:68px;display:flex;align-items:center;justify-content:center;font-size:40px;line-height:1;color:var(--ink, #232735)">'
      + escText(text) + '</div></foreignObject></svg>');
    return svg ? { svg, name, alt: name } : null;
  }
  if (pic.kind === 'figure' && pic.spec && typeof pic.spec === 'object') {
    const svg = draw(pic.spec, lang);
    if (!svg) return null;
    const name = said || String(pic.name || wordsFor(String(pic.spec.type || ''), lang)[0]);
    return { svg: withTokens(withLabel(svg, name)), name, alt: name };
  }
  return null;
}

module.exports = { figureFor, optionPic, safeSvg, wordsFor };
