'use strict';
/**
 * Video-quiz child scorecard — bd-2474.
 *
 * Designed in mockups/out/scorecard_src.html against a system font stack,
 * which only renders correctly on a machine that HAS "-apple-system"/"Segoe
 * UI" installed. Playwright runs headless on the Railway container (Linux),
 * where neither exists — same trap the class-report template already solves
 * by embedding Lexend as base64 @font-face rather than trusting the system.
 * This template follows that exact precedent instead of the mockup's raw
 * font stack, so what a child sees in production matches what was reviewed.
 */

const fs = require('fs');
const path = require('path');

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
      // NIETE branding (2026-08-04): the white-on-transparent N/ن monogram
      // from the niete-brand skill, replacing the Rumi mark for this fork.
      // Never AI-generate or redraw the brand mark (short-video skill rule
      // 9b — Omni fuses the two dots into a face every time; same risk
      // applies to redrawing the NIETE monogram).
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

/**
 * pct -> (stars out of 5, badge label). round(pct/20) reproduces the
 * approved mockup exactly (12/15 = 80% -> 4 stars, "SUPER!"). Badge tier
 * reuses the same 80/60 split finish() already computes for its text
 * message (mastered/developing/needs_practice) rather than inventing a
 * second scale.
 */
function starsAndBadge(pct) {
  const stars = Math.max(0, Math.min(5, Math.round(pct / 20)));
  const badge = pct >= 80 ? 'SUPER!' : pct >= 60 ? 'NICE!' : 'KEEP GOING!';
  return { stars, badge };
}

/**
 * bd-2477 #4 / bd-2480 — the operator's own fallback for "GIF might be too
 * heavy": vary the card's palette by score tier instead of animating. Same
 * single static-frame render as today (zero new RAM/CPU cost).
 *
 * bd-2480: the first pass (mastered/developing/needs_practice all within a
 * ~15-value navy hue band, #001F3F/#001730/#001325) was imperceptible at a
 * glance — operator: "I dont see any real background color change?" Widened
 * the jump so each tier reads as a genuinely different card, not a shade of
 * the same one: mastered stays a vivid, saturated blue (the celebratory
 * default); developing drops to a flatter slate blue-gray; needs_practice
 * drops further to a near-charcoal neutral — visibly calmer, never harsh
 * (no red). The accent stays gold-family throughout (rumi-brand's "ONE warm
 * accent" rule) even as the canvas itself moves further from navy.
 */
function tierPalette(pct) {
  if (pct >= 80) {
    return { bgFrom: '#1D57A6', bgTo: '#3B7FD1', accent: '#F5B301', star: '#9fb8db' };
  }
  if (pct >= 60) {
    return { bgFrom: '#2C3E52', bgTo: '#44586D', accent: '#D9A233', star: '#7e8fa0' };
  }
  return { bgFrom: '#16181D', bgTo: '#2B2F38', accent: '#B98B3D', star: '#4a4f57' };
}

// bd-2477 #2: the Unicode star characters (&#9733;/&#9734;) rendered as
// tofu/missing-glyph boxes in production. Lexend has no coverage for the
// Miscellaneous Symbols block, so the browser fell back to a system symbol
// font that exists on macOS (where this was first verified) but not on the
// Railway Linux container that actually renders it. An inline SVG shape has
// no font dependency at all, so it can never hit this trap again.
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
 * @param {string} d.topic - quiz topic (the video's title)
 * @param {number} d.correct
 * @param {number} d.total
 * @param {number} d.pct
 * @param {string} [d.grade]
 * @param {string} [d.subject]
 * @param {string} [d.takerName] - bd-2481: the quiz-taker's name (a teacher's
 *   own name for a video_solo attempt, or the name a child gave when joining
 *   a shared class link). Omitted entirely when unknown — never renders a
 *   literal "undefined"/"null".
 * @returns {string} HTML for htmlToImage (selector '.card', width 540)
 */
function renderScorecardHtml(d) {
  const a = assets();
  const {
    topic = 'Quiz', correct = 0, total = 0, pct = 0, grade = '', subject = '', takerName = null,
  } = d || {};
  const { stars, badge } = starsAndBadge(pct);
  const palette = tierPalette(pct);
  const footLabel = [grade, subject].filter(Boolean).join(' ') || 'Taleemabad';

  const logoImg = a.nieteMark
    ? `<img class='logo' src='data:image/png;base64,${a.nieteMark}' alt='NIETE'>` : '';
  const nameHtml = takerName ? `<div class='name'>${esc(takerName)}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset='utf-8'><style>
  @font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend})}
  @font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
  * { margin:0; box-sizing:border-box; font-family:'Lexend',sans-serif; }
  body { width:540px; height:400px; }
  .card { width:100%; height:100%; background:linear-gradient(160deg,${palette.bgFrom} 0%,${palette.bgTo} 100%);
    color:#fff; padding:34px 38px; display:flex; flex-direction:column; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; }
  .t1 { font-size:15px; letter-spacing:2.5px; color:${palette.accent}; font-weight:800; }
  .logo { width:56px; height:auto; opacity:.96; display:block; }
  .name { font-size:16px; font-weight:600; color:#cfe0ee; margin-top:10px; }
  .t2 { font-size:30px; font-weight:800; margin-top:8px; }
  .score { font-size:76px; font-weight:800; margin:14px 0 2px; }
  .score span { font-size:30px; font-weight:400; color:#9fb3c8; }
  .stars { display:flex; gap:6px; margin-bottom:10px; }
  .foot { margin-top:auto; display:flex; justify-content:space-between; align-items:flex-end; }
  .foot .n { font-size:15px; color:#cfe0ee; }
  .badge { background:${palette.accent}; color:#3b2b00; font-weight:800; font-size:14px;
    padding:7px 16px; border-radius:18px; }
  </style></head><body><div class='card'>
  <div class='hdr'><div class='t1'>QUIZ COMPLETE</div>${logoImg}</div>
  ${nameHtml}
  <div class='t2'>${esc(topic)}</div>
  <div class='score'>${correct}<span>/${total}</span></div>
  <div class='stars'>${starsHtml(stars, palette)}</div>
  <div class='foot'><div class='n'>${esc(footLabel)}</div>
  <div class='badge'>${esc(badge)}</div></div></div></body></html>`;
}

module.exports = renderScorecardHtml;
module.exports.starsAndBadge = starsAndBadge;
module.exports.tierPalette = tierPalette;
