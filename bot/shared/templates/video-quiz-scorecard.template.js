'use strict';
/**
 * The child's scorecard — the picture that arrives when she finishes a quiz.
 *
 * Three things this file exists to get right, all learned the hard way:
 *
 *  1. NOTHING MAY DEPEND ON A SYSTEM FONT OR A SYMBOL GLYPH. The card is
 *     rendered headless on a Linux container with no fonts installed. Every
 *     face is embedded as base64, and the stars are drawn as SVG paths rather
 *     than typed as star characters — a font that has no glyph for a character
 *     paints an empty box, and the machine this was designed on quietly hid
 *     that by substituting one of its own fonts.
 *  2. THE CARD SPEAKS THE QUIZ'S LANGUAGE, BUT A NAME KEEPS ITS OWN SCRIPT.
 *     The eyebrow, the badge and the message come from the catalog in the
 *     language she just answered in. Her NAME and the TOPIC are text somebody
 *     wrote, so they follow scriptOf() instead: "Ali" typed into an Urdu quiz
 *     is Latin and left-to-right, "عائشہ" typed into an English quiz is
 *     Nastaliq and right-to-left. Keying either off the quiz language runs
 *     Latin letters through Nastaliq metrics or Perso-Arabic through a
 *     Latin-first stack that has no glyphs for it.
 *  3. IT IS THE ONE THING SHE KEEPS. Everything else the quiz sends is a
 *     message that scrolls away; this is a picture. So the score gets a real
 *     treatment (a ring filled to the percentage), the stars get to be the
 *     hero row rather than a footnote, and her name gets the size.
 *
 * Brand: NIETE (niete-brand skill) — the tier grounds are the brand's own two
 * colours, the ground texture is the book's diamond lattice at whisper
 * density, and the mark is the file, never a redrawing.
 */

const fs = require('fs');
const path = require('path');
const { PALETTE, FONTS, latticeSvg, diamondSvg, dirOf } = require('./niete-brand');
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

const TIER_KEY = {
  mastered: 'vqTierMastered',
  developing: 'vqTierDeveloping',
  needs_practice: 'vqTierNeedsPractice',
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

/** Trailing sentence punctuation, Latin and Urdu, for comparing two strings
 *  that say the same thing with different stops. */
const TRAILING_STOPS = /[!?.,؟۔،\s]+$/;

/**
 * The one line of encouragement, from the catalog, in the quiz's language.
 *
 * The card carries BOTH the short badge word and the full tier sentence, and
 * the catalog builds the sentence by extending the badge ("Nicely done" ->
 * "Nicely done — a little more practice and you'll have it."). Printing both
 * verbatim stutters, so where the sentence opens with exactly the badge the
 * pill keeps that clause and the line takes the rest — the two read as one
 * sentence with its opening set in a pill. Where the two say the same thing
 * outright (Urdu "زبردست!"), the line is dropped and the pill speaks alone.
 *
 * No new catalog keys: this is a presentation rule over the strings the
 * caption already uses, so the picture and the text under it stay in step.
 */
function tierMessage(pct, language = 'en') {
  const lang = clampLanguage(language);
  const full = resolveUx(TIER_KEY[tierFor(pct)], { language: lang });
  const badge = resolveUx(BADGE_KEY[tierFor(pct)], { language: lang });
  const bare = (s) => String(s || '').replace(TRAILING_STOPS, '').trim().toLowerCase();
  if (bare(full) === bare(badge)) return '';
  const parts = String(full).split(/\s*[—–]\s*/);
  if (parts.length > 1 && bare(parts[0]) === bare(badge)) {
    const rest = parts.slice(1).join(' — ').trim();
    return rest.replace(/^[a-z]/, (c) => c.toUpperCase());
  }
  // No dash, but the sentence still OPENS with the badge ("Brilliant!" /
  // "Brilliant work!"). There is no clean remainder to take, so the pill
  // speaks alone rather than the card saying the word twice in a row.
  if (bare(full).startsWith(`${bare(badge)} `)) return '';
  return full;
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
 *
 * `ring`/`glow`/the filled stars are separate from `accent` on purpose. The lowest tier's badge
 * is the calm muted green, but a muted green ring and muted green stars on a
 * charcoal ground read as switched-off — the celebration is the part a child
 * who scored 4/10 needs most, so the ring and the stars take the pale green instead; only the badge pill,
 * which carries dark ink, stays the muted green.
 */
function tierPalette(pct) {
  if (pct >= 80) {
    return {
      bgFrom: PALETTE.greenDeep, bgTo: PALETTE.green, accent: '#FFFFFF',
      ring: '#FFFFFF', glow: 'rgba(255,255,255,.6)',
      star: 'rgba(255,255,255,.45)', badgeInk: '#1F5F3E',
    };
  }
  if (pct >= 60) {
    return {
      bgFrom: PALETTE.slate, bgTo: PALETTE.slateLight, accent: PALETTE.green,
      ring: PALETTE.green, glow: 'rgba(71,186,125,.65)',
      star: 'rgba(255,255,255,.35)', badgeInk: '#123D28',
    };
  }
  return {
    bgFrom: PALETTE.charcoal, bgTo: PALETTE.charcoalLight, accent: PALETTE.greenMuted,
    ring: PALETTE.greenPale, glow: 'rgba(169,227,196,.5)',
    star: 'rgba(255,255,255,.3)', badgeInk: '#0E3320',
  };
}

const STAR_PATH = 'M12 2.6l2.95 6.28 6.9.86-5.05 4.78 1.33 6.82L12 17.86l-6.13 3.38 '
  + '1.33-6.82L2.15 9.74l6.9-.86z';

const STAR_SIZE = 44;

function starSvg(filled, palette) {
  return `<svg class="star${filled ? ' star--filled' : ''}" viewBox="0 0 24 24" `
    + `width="${STAR_SIZE}" height="${STAR_SIZE}">`
    + `<path d="${STAR_PATH}" fill="${filled ? palette.ring : 'none'}" `
    + `stroke="${filled ? palette.ring : palette.star}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

function starsHtml(stars, palette) {
  return Array.from({ length: 5 }, (_, i) => starSvg(i < stars, palette)).join('');
}

/**
 * The score as a ring filled to the percentage — the "how close am I to full
 * marks" reading a bare fraction makes a child do in her head. Drawn with a
 * dash offset rather than an arc path so the geometry stays exact at any
 * percentage and there is no large-arc-flag branch to get wrong at 50%.
 */
const RING_R = 60;
const RING_C = 2 * Math.PI * RING_R;

function gaugeSvg(pct, palette) {
  const shown = Math.max(0, Math.min(100, Number(pct) || 0));
  const offset = RING_C * (1 - shown / 100);
  return `<svg class='gauge' viewBox='0 0 140 140' aria-hidden='true'>`
    + `<circle class='ring-track' cx='70' cy='70' r='${RING_R}' fill='none' `
    + `stroke='rgba(255,255,255,.17)' stroke-width='10'/>`
    + `<circle class='ring-fill' cx='70' cy='70' r='${RING_R}' fill='none' `
    + `stroke='${palette.ring}' stroke-width='10' stroke-linecap='round' `
    + `stroke-dasharray='${RING_C.toFixed(2)}' stroke-dashoffset='${offset.toFixed(2)}' `
    + `transform='rotate(-90 70 70)'/></svg>`;
}

/**
 * @param {object} d
 * @param {string} d.topic - the lesson the quiz came from
 * @param {number} d.correct
 * @param {number} d.total
 * @param {number} d.pct
 * @param {string} [d.subject] - printed in the caption under the topic; the
 *        grade is deliberately never printed, since a shared class link can
 *        reach a child in any year.
 * @param {string} [d.takerName] - omitted entirely when unknown, never
 *        rendered as a literal "undefined"/"null".
 * @param {string} [d.language] - the QUIZ's language: the child reads the card
 *        in whatever language she just answered in. It does NOT decide the
 *        script of her name or of the topic — see scriptOf().
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
  const message = tierMessage(pct, language);
  const palette = tierPalette(pct);
  const eyebrow = resolveUx('vqScorecardEyebrow', { language });
  const shownPct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));

  const logoImg = a.nieteMark
    ? `<img class='logo' src='data:image/png;base64,${a.nieteMark}' alt='NIETE'>` : '';
  // Her own script, not the quiz's.
  const nameHtml = takerName
    ? `<div class='name content' dir='${dirOf(takerName)}'>${esc(takerName)}</div>` : '';
  const topicHtml = `<span class='topic content' dir='${dirOf(topic)}'>${esc(topic)}</span>`;
  const subjectHtml = subject
    ? `<span class='sep'>&middot;</span><span class='subj content' dir='${dirOf(subject)}'>${esc(subject)}</span>`
    : '';
  const messageHtml = message
    ? `<div class='msg content' dir='${dir}'>${esc(message)}</div>` : '';
  // The brand book's lattice, at the whisper density it uses behind content —
  // drawn, so it stays crisp, rather than a stretched crop of a page raster.
  const lattice = latticeSvg({ id: 'niete-lattice-card', line: '#ffffff', opacity: 0.085 });
  // The nuqta pair from the book's audience lockups, as the eyebrow's rule.
  const nuqtas = diamondSvg({ size: 6, fill: 'rgba(255,255,255,.75)', stroke: 'rgba(255,255,255,.75)', width: 0 })
    + diamondSvg({ size: 6, fill: 'rgba(255,255,255,.45)', stroke: 'rgba(255,255,255,.45)', width: 0 });

  return `<!DOCTYPE html><html lang='${language}'><head><meta charset='utf-8'><style>
  @font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend})}
  @font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
  @font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
  @font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold})}
  * { margin:0; box-sizing:border-box; font-family:${FONTS.bodyLatin}; }
  /* Anything a child wrote or was taught follows the script it was WRITTEN in,
     which is not always the quiz's language. The card is a poster with one
     anchor — mark on the right, everything read on the left — so an Urdu line
     still SHAPES right-to-left but is set flush left with the score and the
     stars. Right-aligning it instead left the name and topic floating away
     from every other element on the card. */
  .content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:1.85;text-align:left}
  .content[dir="ltr"]{font-family:${FONTS.bodyLatin};line-height:1.35;text-align:left}
  body { width:540px; height:400px; }
  .card { width:100%; height:100%; background:linear-gradient(158deg,${palette.bgFrom} 0%,${palette.bgTo} 100%);
    color:#fff; padding:24px 30px 26px; display:flex; flex-direction:column; position:relative; overflow:hidden; }
  /* A soft light from behind the gauge — the only non-flat thing on the card,
     and the reason the ring reads as lit rather than printed. */
  .card::after { content:''; position:absolute; width:340px; height:340px; right:-90px; top:-110px;
    border-radius:50%; background:radial-gradient(circle,rgba(255,255,255,.13) 0%,rgba(255,255,255,0) 70%); }
  .lattice { position:absolute; left:0; top:0; width:100%; height:100%; }
  .card > *:not(.lattice) { position:relative; z-index:1; }
  .hdr { display:flex; justify-content:space-between; align-items:center; }
  .t1 { font-size:${RTL ? '13px' : '11.5px'}; letter-spacing:${RTL ? '0' : '2.6px'}; color:#fff; font-weight:800; opacity:.78;
    display:flex; align-items:center; gap:5px;
    font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin}; }
  .t1 .dia { margin-top:1px; }
  .logo { width:46px; height:auto; opacity:.96; display:block; }
  .main { display:flex; align-items:center; gap:16px; margin-top:14px; }
  .who { flex:1 1 auto; min-width:0; }
  .name { font-size:36px; line-height:1.12; font-weight:800; letter-spacing:-.6px; color:#fff; }
  .name[dir="rtl"] { font-size:31px; line-height:1.5; letter-spacing:0; }
  .cap { margin-top:12px; font-size:13px; opacity:.72; display:flex; flex-wrap:wrap;
    align-items:baseline; gap:6px; }
  .cap .sep { opacity:.55; }
  .cap .content[dir="rtl"] { line-height:1.7; }
  .gauge-col { flex:0 0 140px; position:relative; width:140px; height:140px;
    display:flex; align-items:center; justify-content:center; }
  .gauge { position:absolute; left:0; top:0; width:140px; height:140px; }
  .gnum { position:relative; text-align:center; }
  /* A fraction reads left-to-right in every language — never mirror it. */
  .score { font-size:38px; line-height:1; font-weight:800; direction:ltr; unicode-bidi:isolate;
    font-family:${FONTS.bodyLatin}; }
  .score span { font-size:18px; font-weight:400; color:rgba(255,255,255,.6); }
  .pct { margin-top:5px; font-size:11.5px; letter-spacing:1.6px; font-weight:800; opacity:.62;
    direction:ltr; unicode-bidi:isolate; font-family:${FONTS.bodyLatin}; }
  /* The hero row. Five shapes, lit — the part of the card a child reads first
     and the part she is being congratulated with. */
  /* Centred in whatever room is left between the score block and the
     foot, so the card breathes evenly instead of stranding a hole. */
  .stars { display:flex; justify-content:center; align-items:center; gap:12px;
    margin:auto 0; }
  .star--filled { filter:drop-shadow(0 0 9px ${palette.glow}); }
  .foot { padding-top:4px; display:flex; align-items:center; gap:11px; }
  .badge { background:${palette.accent}; color:${palette.badgeInk}; font-weight:800; font-size:${RTL ? '15px' : '14px'};
    padding:7px 15px; border-radius:16px; white-space:nowrap; flex:0 0 auto;
    font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin}; }
  .msg { font-size:${RTL ? '14.5px' : '13.5px'}; color:#fff; opacity:.86; flex:1 1 auto; min-width:0; }
  .msg[dir="rtl"] { line-height:1.7; }
  </style></head><body><div class='card'>
  ${lattice}
  <div class='hdr'><div class='t1'>${esc(eyebrow)}${nuqtas}</div>${logoImg}</div>
  <div class='main'>
    <div class='who'>${nameHtml}
      <div class='cap'>${topicHtml}${subjectHtml}</div>
    </div>
    <div class='gauge-col'>${gaugeSvg(pct, palette)}
      <div class='gnum'><div class='score'>${correct}<span>/${total}</span></div>
      <div class='pct'>${shownPct}%</div></div>
    </div>
  </div>
  <div class='stars'>${starsHtml(stars, palette)}</div>
  <div class='foot'><div class='badge'>${esc(badge)}</div>${messageHtml}</div>
  </div></body></html>`;
}

module.exports = renderScorecardHtml;
module.exports.starsAndBadge = starsAndBadge;
module.exports.tierMessage = tierMessage;
module.exports.tierPalette = tierPalette;
module.exports.tierFor = tierFor;
