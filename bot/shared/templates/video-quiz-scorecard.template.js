'use strict';
/**
 * The child's scorecard — the picture that arrives when she finishes a quiz.
 *
 * Two things this file exists to get right, both learned the hard way:
 *
 *  1. NOTHING MAY DEPEND ON A SYSTEM FONT OR A SYMBOL GLYPH. The card is
 *     rendered headless on a Linux container with no fonts installed. Every
 *     face is embedded as base64, and the stars are drawn as SVG paths rather
 *     than typed as star characters — a font that has no glyph for a character
 *     paints an empty box, and the machine this was designed on quietly hid
 *     that by substituting one of its own fonts.
 *  2. THE CARD SPEAKS THE QUIZ'S LANGUAGE. An Urdu quiz has to end on an Urdu
 *     card, with the child's own name in her own script. Both font families
 *     are therefore always named, and the name and topic carry their own
 *     direction.
 *
 * Brand: NIETE (niete-brand skill) — the tier grounds are the brand's own two
 * colours, the mark is the file, never a redrawing.
 */

const fs = require('fs');
const path = require('path');
const { PALETTE, FONTS, diamondPath } = require('./niete-brand');
const { resolveUx, clampLanguage } = require('../config/ux-strings');

let _assets = null;

function readBase64(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs).toString('base64') : '';
  } catch { return ''; }
}

function assets() {
  if (!_assets) {
    _assets = {
      lexend: readBase64('fonts/Lexend-Regular.ttf'),
      lexendBold: readBase64('fonts/Lexend-Bold.ttf'),
      nastaliq: readBase64('fonts/NotoNastaliqUrdu-Regular.ttf'),
      nastaliqBold: readBase64('fonts/NotoNastaliqUrdu-Bold.ttf'),
      // The white-on-transparent N/ن monogram from the brand assets. Never
      // AI-generated and never redrawn — image models reliably mangle a mark
      // they are asked to reproduce from a description.
      nieteMark: readBase64('assets/niete-mark-white-transparent.png'),
    };
  }
  return _assets;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RTL_LANGS = new Set(['ur']);

const BADGE_KEY = {
  mastered: 'vqBadgeMastered',
  developing: 'vqBadgeDeveloping',
  needs_practice: 'vqBadgeNeedsPractice',
};

function tierFor(pct) {
  return pct >= 80 ? 'mastered' : pct >= 60 ? 'developing' : 'needs_practice';
}

/**
 * pct -> (stars out of 5, badge word). round(pct/20) reproduces the approved
 * mockup exactly (12/15 = 80% -> 4 stars). The badge comes from the shared
 * string catalog in the quiz's language, so the card and the caption sent with
 * it can never end up saying different things.
 */
function starsAndBadge(pct, language = 'en') {
  const stars = Math.max(0, Math.min(5, Math.round(pct / 20)));
  const badge = resolveUx(BADGE_KEY[tierFor(pct)], { language: clampLanguage(language) });
  return { stars, badge };
}

/**
 * The card's ground, by how she did.
 *
 * Three tiers, three genuinely different cards — the operator's own fallback
 * for "an animated card would be too heavy": vary the colour instead. Within
 * the NIETE palette that is green for mastered, navy-slate for developing and
 * a calm charcoal for needs-practice. Never red, never harsh: a child who
 * scored low gets a quieter card, not a warning.
 *
 * The steps are deliberately far apart in brightness. A first attempt at this
 * idea on another product kept all three inside one narrow hue band and read
 * as the same card at a glance.
 */
function tierPalette(pct) {
  if (pct >= 80) {
    return { bgFrom: PALETTE.greenDeep, bgTo: PALETTE.green, accent: '#FFFFFF', star: 'rgba(255,255,255,.45)', badgeInk: '#1F5F3E' };
  }
  if (pct >= 60) {
    return { bgFrom: PALETTE.slate, bgTo: PALETTE.slateLight, accent: PALETTE.green, star: 'rgba(255,255,255,.35)', badgeInk: '#123D28' };
  }
  return { bgFrom: PALETTE.charcoal, bgTo: PALETTE.charcoalLight, accent: PALETTE.greenMuted, star: 'rgba(255,255,255,.3)', badgeInk: '#0E3320' };
}

const STAR_PATH = 'M12 2.6l2.95 6.28 6.9.86-5.05 4.78 1.33 6.82L12 17.86l-6.13 3.38 '
  + '1.33-6.82L2.15 9.74l6.9-.86z';

function starSvg(filled, palette) {
  return `<svg class="star${filled ? ' star--filled' : ''}" viewBox="0 0 24 24" width="30" height="30">`
    + `<path d="${STAR_PATH}" fill="${filled ? palette.accent : 'none'}" `
    + `stroke="${filled ? palette.accent : palette.star}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

function starsHtml(stars, palette) {
  return Array.from({ length: 5 }, (_, i) => starSvg(i < stars, palette)).join('');
}

/**
 * @param {object} d
 * @param {string} d.topic - the lesson the quiz came from
 * @param {number} d.correct
 * @param {number} d.total
 * @param {number} d.pct
 * @param {string} [d.subject] - printed small at the foot; the grade is
 *        deliberately never printed, since a shared class link can reach a
 *        child in any year.
 * @param {string} [d.takerName] - omitted entirely when unknown, never
 *        rendered as a literal "undefined"/"null".
 * @param {string} [d.language] - the QUIZ's language: the child reads the card
 *        in whatever language she just answered in.
 * @returns {string} HTML for htmlToImage (selector '.card', width 540)
 */
function renderScorecardHtml(d) {
  const a = assets();
  const {
    topic = 'Quiz', correct = 0, total = 0, pct = 0, subject = '', takerName = null,
  } = d || {};
  const language = clampLanguage((d && d.language) || 'en');
  const RTL = RTL_LANGS.has(language);
  const dir = RTL ? 'rtl' : 'ltr';
  const { stars, badge } = starsAndBadge(pct, language);
  const palette = tierPalette(pct);
  const eyebrow = resolveUx('vqScorecardEyebrow', { language });

  const logoImg = a.nieteMark
    ? `<img class='logo' src='data:image/png;base64,${a.nieteMark}' alt='NIETE'>` : '';
  const nameHtml = takerName ? `<div class='name content' dir='${dir}'>${esc(takerName)}</div>` : '';
  const footHtml = subject ? `<div class='n content' dir='${dir}'>${esc(subject)}</div>` : `<div class='n'></div>`;
  // A diamond, the brand's nuqta, sits behind the score as a quiet ground mark.
  const ghost = `<svg class='ghost' viewBox='0 0 200 200' aria-hidden='true'>`
    + `<path d='${diamondPath(100, 100, 96)}' fill='none' stroke='rgba(255,255,255,.13)' stroke-width='2'/></svg>`;

  return `<!DOCTYPE html><html lang='${language}'><head><meta charset='utf-8'><style>
  @font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend})}
  @font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
  @font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
  @font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold})}
  * { margin:0; box-sizing:border-box; font-family:${FONTS.bodyLatin}; }
  /* Anything a child wrote or was taught follows the quiz's own script. The
     card is a poster with one anchor — mark and badge on the right, everything
     read on the left — so an Urdu line still SHAPES right-to-left but is set
     flush left with the score and the stars. Right-aligning it instead left
     the name and topic floating away from every other element on the card. */
  .content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:1.85;text-align:left}
  .content[dir="ltr"]{font-family:${FONTS.bodyLatin}}
  body { width:540px; height:400px; }
  .card { width:100%; height:100%; background:linear-gradient(160deg,${palette.bgFrom} 0%,${palette.bgTo} 100%);
    color:#fff; padding:28px 34px; display:flex; flex-direction:column; position:relative; overflow:hidden; }
  .ghost { position:absolute; width:250px; height:250px; right:-40px; bottom:-60px; }
  .card > *:not(.ghost) { position:relative; z-index:1; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; }
  .t1 { font-size:15px; letter-spacing:${RTL ? '0' : '2.5px'}; color:#fff; font-weight:800; opacity:.85;
    font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin}; }
  .logo { width:56px; height:auto; opacity:.96; display:block; }
  /* Nastaliq needs vertical room, but a display line is not a paragraph:
     the shared 1.85 overflowed this fixed 540x400 frame and clipped the badge. */
  .name { font-size:${RTL ? '18px' : '16px'}; line-height:${RTL ? '1.6' : '1.3'}; font-weight:600; color:#EAF3EE; margin-top:8px; }
  .t2 { font-size:${RTL ? '24px' : '30px'}; line-height:${RTL ? '1.65' : '1.2'}; font-weight:800; margin-top:6px; }
  /* A fraction reads left-to-right in every language — never mirror it. */
  .score { font-size:72px; line-height:1.05; font-weight:800; margin:12px 0 2px; direction:ltr; unicode-bidi:isolate;
    font-family:${FONTS.bodyLatin}; }
  .score span { font-size:30px; font-weight:400; color:rgba(255,255,255,.62); }
  .stars { display:flex; gap:6px; margin-bottom:10px; }
  .foot { margin-top:auto; display:flex; justify-content:space-between; align-items:flex-end; gap:12px; }
  .foot .n { font-size:15px; line-height:${RTL ? '1.6' : '1.3'}; color:#EAF3EE; opacity:.85; }
  .badge { background:${palette.accent}; color:${palette.badgeInk}; font-weight:800; font-size:15px;
    padding:7px 16px; border-radius:18px; white-space:nowrap;
    font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin}; }
  </style></head><body><div class='card'>
  ${ghost}
  <div class='hdr'><div class='t1'>${esc(eyebrow)}</div>${logoImg}</div>
  ${nameHtml}
  <div class='t2 content' dir='${dir}'>${esc(topic)}</div>
  <div class='score'>${correct}<span>/${total}</span></div>
  <div class='stars'>${starsHtml(stars, palette)}</div>
  <div class='foot'>${footHtml}
  <div class='badge'>${esc(badge)}</div></div></div></body></html>`;
}

module.exports = renderScorecardHtml;
module.exports.starsAndBadge = starsAndBadge;
module.exports.tierPalette = tierPalette;
module.exports.tierFor = tierFor;
