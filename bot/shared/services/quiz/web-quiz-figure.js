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
  fraction_bar: { en: ['Fraction bars', 'Look at the bars.'], ur: ['کسر کی پٹیاں', 'پٹیوں کو دیکھیں۔'] },
  numberline: { en: ['A number line', 'Look at the number line.'], ur: ['عددی لکیر', 'عددی لکیر کو دیکھیں۔'] },
  clock: { en: ['A clock face', 'Look at the clock.'], ur: ['گھڑی', 'گھڑی کو دیکھیں۔'] },
  money: { en: ['Coins and notes', 'Look at the money.'], ur: ['سکے اور نوٹ', 'پیسوں کو دیکھیں۔'] },
  geometry: { en: ['A shape drawing', 'Look at the shape.'], ur: ['شکل', 'شکل کو دیکھیں۔'] },
  graph: { en: ['A graph', 'Look at the graph.'], ur: ['گراف', 'گراف کو دیکھیں۔'] },
  flow: { en: ['Steps in order', 'Look at the steps.'], ur: ['مراحل', 'مراحل کو دیکھیں۔'] },
  timeline: { en: ['A timeline', 'Look at the timeline.'], ur: ['وقت کی لکیر', 'وقت کی لکیر کو دیکھیں۔'] },
  word_blank: { en: ['A picture and a word with a missing letter', 'Look at the picture and the word.'], ur: ['تصویر اور لفظ', 'تصویر اور لفظ کو دیکھیں۔'] },
  _: { en: ['A picture', 'Look at the picture.'], ur: ['تصویر', 'تصویر کو دیکھیں۔'] },
};

function wordsFor(type, lang) {
  const w = WORDS[type] || WORDS._;
  return w[lang === 'ur' ? 'ur' : 'en'];
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
  const lang = media.language === 'ur' ? 'ur' : 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  const v2 = media.web && media.web.figure && typeof media.web.figure === 'object' ? media.web.figure : null;
  const spec = (v2 && v2.spec) || (media.figure && typeof media.figure === 'object' ? media.figure : null);
  const type = spec ? String(spec.type || '') : '';
  const [defAlt, defSay] = wordsFor(type, lang);
  const alt = (v2 && typeof v2.alt === 'string' && v2.alt.trim()) || defAlt;
  const say = (v2 && typeof v2.say === 'string' && v2.say.trim()) || defSay;

  if (spec) {
    const svg = draw(spec, lang);
    if (svg) {
      const out = { kind: 'svg', svg: withLabel(svg, alt), type, ...boxOf(svg), alt, say, dir };
      if (v2 && Array.isArray(v2.hotspots)) out.hotspots = v2.hotspots;
      return out;
    }
  }
  if (media.question_image) return { kind: 'img', src: 'question_image', type: type || null, alt, say, dir };
  return null;
}

/**
 * A picture option: a roster pictogram or a small engine drawing, as SVG.
 * Never emoji, never model-written SVG. null when it cannot be drawn — the
 * option then stays a word, never a blank button.
 */
function optionPic(pic, language) {
  if (!pic || typeof pic !== 'object') return null;
  const lang = language === 'ur' ? 'ur' : 'en';
  if (pic.kind === 'pictogram') {
    try {
      const P = require('../../../vendor/lp-v9/diagrams/lib/pictogram');
      if (!P.has(pic.name)) return null;
      const body = P.inner(pic.name).replace(/currentColor/g, 'var(--ink, #1A1A1A)');
      const name = String(pic.say || pic.name).replace(/_/g, ' ');
      const svg = safeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.GRID} ${P.GRID}" role="img" aria-label="${escAttr(name)}">${body}</svg>`);
      return svg ? { svg, name, alt: name } : null;
    } catch (_) {
      return null;
    }
  }
  if (pic.kind === 'figure' && pic.spec && typeof pic.spec === 'object') {
    const svg = draw(pic.spec, lang);
    if (!svg) return null;
    const name = String(pic.name || pic.say || wordsFor(String(pic.spec.type || ''), lang)[0]);
    return { svg: withLabel(svg, name), name, alt: name };
  }
  return null;
}

module.exports = { figureFor, optionPic, safeSvg, wordsFor };
