'use strict';
/**
 * The child's scorecard — the picture that arrives when she finishes a quiz.
 *
 * Four things this file exists to get right, all learned the hard way:
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
 *  3. THE GROUND IS NOT A SECOND SCORE. Every child gets the same card. An
 *     earlier version gave each tier its own background — green at the top,
 *     charcoal at the bottom — and side by side the charcoal card reads as
 *     switched off: the child who did least well receives the least
 *     attractive picture, which is a punishment wearing a design's clothes.
 *     How she did lives in the three places she can actually read it and the
 *     caption can repeat: how many stars are lit, which word is in the chip,
 *     and how far round the ring is filled.
 *  4. IT IS THE ONE THING SHE KEEPS. Everything else the quiz sends is a
 *     message that scrolls away; this is a picture. So the score gets a real
 *     treatment, the stars get to be the hero row rather than a footnote, and
 *     her name gets the size.
 *
 * LAYOUT. One edge, and two exceptions. Every block — eyebrow, name, topic,
 * score, stars, subject — sits on the card's start edge, in one column, in
 * reading order. Exactly two things hang off the far edge: the mark at the top
 * and the badge chip at the bottom. Urdu is not "the same card with the text
 * pushed left"; it is the exact mirror, so the CARD carries `dir` and every
 * row flips with it. An earlier version force-aligned every block left in both
 * languages and split the card down the middle besides — name left, ring
 * right, stars centred, chip bottom-left — so no two elements shared an edge.
 *
 * Brand: NIETE (niete-brand skill) — the ground is the book's two colours in
 * one gradient, the texture is its diamond lattice at whisper density, and the
 * mark is the file, never a redrawing.
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
 * The one line of encouragement, from the catalog, in the quiz's language —
 * the badge's clause removed so the two do not stutter.
 *
 * The card itself no longer prints this line: the chip carries the word and
 * the WhatsApp caption directly under the picture carries the whole sentence
 * (vqScoreCaption interpolates the same vqTier* string), so printing it a
 * third time inside the card said one thing three ways in 400 pixels. The
 * rule is kept and exported because it is the de-duplication the caption side
 * needs and the only place the badge/sentence relationship is written down.
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
 * The card's colours. One set, for every score.
 *
 * GROUND — the book's navy-slate held across the top 28% and then run into the
 * book's green, mirrored with the card so the navy always sits under the
 * eyebrow, the name and the mark and the green always arrives under the score,
 * the stars and the chip. (A CSS gradient does not follow `dir`, so an Urdu
 * card without the mirrored angle got the two ends the wrong way round.)
 *
 * Three grounds were rendered on this layout and looked at before this one was
 * picked — see renders/round4/scorecard/v4_ground_{a,b,c}.png in the project
 * folder. Green alone is louder and gives a low score a card that reads as
 * over-praise. Navy alone, with the green arriving only as the bloom, splits
 * into a grey half and a green half with a visible seam down the middle, and
 * at any score reads as the lights being off — which is what the charcoal tier
 * was rejected for. Navy into green is the one that is calm at 1/8 and still
 * celebratory at 8/8, which is the whole point of having one ground.
 *
 * ACCENT — one warm amber, used for the lit stars and the badge chip. The
 * NIETE book has no warm colour at all, which is exactly why this one is
 * declared here as an accent and nowhere near the brand module: the ground,
 * the lattice, the ring and the mark are the brand, and the amber is the
 * two-percent of the card that says "well done" in a way that green sitting on
 * green cannot. It is deliberately not the Rumi card's #F5B301 — that card is
 * another product's and borrowing its hex is how this one quietly becomes it.
 *
 * RING — white. The ring is the measurement, the stars are the celebration;
 * giving them the same colour made the score row and the star row read as one
 * undifferentiated band of amber.
 */
const ACCENT = '#FFC94A';

function cardPalette() {
  return {
    bgFrom: PALETTE.slate,
    bgTo: PALETTE.greenDeep,
    bgEnd: PALETTE.green,
    accent: ACCENT,
    ring: '#FFFFFF',
    glow: 'rgba(255,201,74,.62)',
    bloom: 'rgba(71,186,125,.55)',
    star: 'rgba(255,255,255,.42)',
    badgeInk: PALETTE.slate,
  };
}

/**
 * The hero size for a name, stepped down by how long it is.
 *
 * "Muhammad Abdul Rehman" at 38 px overran the card and rendered as "Muhammad
 * Abdul Reh…". A child's own name is the one thing here that must not be cut
 * off — it is the reason she keeps the picture — so the type gets smaller
 * instead. Measured in CODE POINTS and against the NAME's own script: Nastaliq
 * runs wider per character than Lexend at the same px, and a name's script is
 * not necessarily the quiz's.
 */
function nameFontPx(name, scriptRtl) {
  const n = Array.from(String(name === null || name === undefined ? '' : name)).length;
  if (scriptRtl) return n > 18 ? 26 : n > 12 ? 30 : 34;
  return n > 20 ? 28 : n > 15 ? 33 : 38;
}

const STAR_PATH = 'M12 2.6l2.95 6.28 6.9.86-5.05 4.78 1.33 6.82L12 17.86l-6.13 3.38 '
  + '1.33-6.82L2.15 9.74l6.9-.86z';

const STAR_SIZE = 42;

function starSvg(filled, palette) {
  return `<svg class="star${filled ? ' star--filled' : ''}" viewBox="0 0 24 24" `
    + `width="${STAR_SIZE}" height="${STAR_SIZE}">`
    + `<path d="${STAR_PATH}" fill="${filled ? palette.accent : 'none'}" `
    + `stroke="${filled ? palette.accent : palette.star}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
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
const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

function gaugeSvg(pct, palette) {
  const shown = Math.max(0, Math.min(100, Number(pct) || 0));
  const offset = RING_C * (1 - shown / 100);
  return `<svg class='gauge' viewBox='0 0 100 100' aria-hidden='true'>`
    + `<circle class='ring-track' cx='50' cy='50' r='${RING_R}' fill='none' `
    + `stroke='rgba(255,255,255,.22)' stroke-width='8'/>`
    + `<circle class='ring-fill' cx='50' cy='50' r='${RING_R}' fill='none' `
    + `stroke='${palette.ring}' stroke-width='8' stroke-linecap='round' `
    + `stroke-dasharray='${RING_C.toFixed(2)}' stroke-dashoffset='${offset.toFixed(2)}' `
    + `transform='rotate(-90 50 50)'/></svg>`;
}

/**
 * @param {object} d
 * @param {string} d.topic - the lesson the quiz came from
 * @param {number} d.correct
 * @param {number} d.total
 * @param {number} d.pct
 * @param {string} [d.subject] - printed at the foot under the stars; the
 *        grade is deliberately never printed, since a shared class link can
 *        reach a child in any year.
 * @param {string} [d.takerName] - omitted entirely when unknown, never
 *        rendered as a literal "undefined"/"null".
 * @param {string} [d.language] - the QUIZ's language: the child reads the card
 *        in whatever language she just answered in. It decides which edge the
 *        card is built on. It does NOT decide the script of her name or of the
 *        topic — see scriptOf().
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
  const edge = RTL ? 'right' : 'left';
  const { stars, badge } = starsAndBadge(pct, language);
  const nameDir = dirOf(takerName);
  const namePx = nameFontPx(takerName, nameDir === 'rtl');
  const palette = cardPalette();
  const eyebrow = resolveUx('vqScorecardEyebrow', { language });
  const shownPct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));

  const logoImg = a.nieteMark
    ? `<img class='logo' src='data:image/png;base64,${a.nieteMark}' alt='NIETE'>` : '';
  // Her own script, not the quiz's — but the card's edge, not the script's.
  const nameHtml = takerName
    ? `<div class='name content align' dir='${nameDir}'>${esc(takerName)}</div>` : '';
  const topicHtml = `<div class='topic content align' dir='${dirOf(topic)}'>${esc(topic)}</div>`;
  const subjectHtml = subject
    ? `<span class='subj content' dir='${dirOf(subject)}'>${esc(subject)}</span>`
    : `<span class='subj'></span>`;
  // The brand book's lattice, at the whisper density it uses behind content —
  // drawn, so it stays crisp, rather than a stretched crop of a page raster.
  const lattice = latticeSvg({ id: 'niete-lattice-card', line: '#ffffff', opacity: 0.085 });
  // The nuqta pair from the book's audience lockups, as the eyebrow's rule.
  // They are emitted AFTER the words and the row carries the card's direction,
  // so they trail the words in both scripts. Laid out left-to-right regardless
  // of language, they arrived first in Urdu and read as two specks of dirt in
  // front of the sentence.
  const nuqtas = diamondSvg({
    size: 7, fill: PALETTE.greenPale, stroke: PALETTE.greenPale, width: 0, className: 'dia nuqta',
  }) + diamondSvg({
    size: 7, fill: PALETTE.greenPale, stroke: PALETTE.greenPale, width: 0, className: 'dia nuqta faint',
  });

  return `<!DOCTYPE html><html lang='${language}'><head><meta charset='utf-8'><style>
  @font-face{font-family:'Lexend';font-weight:400;src:url(data:font/ttf;base64,${a.lexend})}
  @font-face{font-family:'Lexend';font-weight:800;src:url(data:font/ttf;base64,${a.lexendBold})}
  @font-face{font-family:'NastaliqUrdu';font-weight:400;src:url(data:font/ttf;base64,${a.nastaliq})}
  @font-face{font-family:'NastaliqUrdu';font-weight:700;src:url(data:font/ttf;base64,${a.nastaliqBold})}
  * { margin:0; box-sizing:border-box; font-family:${FONTS.bodyLatin}; }
  /* Anything a child wrote or was taught follows the script it was WRITTEN in,
     which is not always the quiz's language: that decides the font and the
     bidi direction. Which EDGE the block hangs off is the card's, not the
     text's — otherwise a Latin name inside an Urdu card floats away from every
     other element on it. So .content sets the face, .align sets the edge, and
     a name carries both. */
  .content[dir="rtl"]{font-family:${FONTS.bodyUrdu};line-height:1.8}
  .content[dir="ltr"]{font-family:${FONTS.bodyLatin};line-height:1.3}
  .card .align { text-align:${edge}; }
  body { width:540px; height:400px; }
  .card { width:100%; height:100%; background:linear-gradient(${RTL ? '203deg' : '157deg'},${palette.bgFrom} 0%,${palette.bgFrom} 28%,${palette.bgTo} 86%,${palette.bgEnd} 100%);
    color:#fff; padding:24px 30px 22px; display:flex; flex-direction:column; position:relative; overflow:hidden; }
  /* Two lights, and the reason the ground is not flat.
     The GREEN one sits on the far side, low: it is what fills the half of the
     card the single column of text does not use, and it turns the navy-to-green
     run from a muddy interpolation into light arriving over a dark ground.
     The WHITE one is small and sits behind the score and the stars, on the
     content's own side. Both are placed with logical insets, so they mirror
     with the card rather than staying on a fixed physical corner. */
  .card::before { content:''; position:absolute; width:560px; height:560px;
    inset-inline-end:-170px; bottom:-250px;
    border-radius:50%; background:radial-gradient(circle,${palette.bloom} 0%,rgba(71,186,125,0) 70%); }
  .card::after { content:''; position:absolute; width:360px; height:360px;
    inset-inline-start:-120px; bottom:-140px;
    border-radius:50%; background:radial-gradient(circle,rgba(255,255,255,.14) 0%,rgba(255,255,255,0) 68%); }
  .lattice { position:absolute; left:0; top:0; width:100%; height:100%; }
  .card > *:not(.lattice) { position:relative; z-index:1; }
  .hdr { display:flex; justify-content:space-between; align-items:center; flex:0 0 auto; }
  .t1 { direction:${dir}; font-size:${RTL ? '20px' : '16px'}; letter-spacing:${RTL ? '0' : '2.4px'};
    color:${PALETTE.greenPale}; font-weight:800; display:flex; align-items:center; gap:6px;
    font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin}; line-height:1.5; }
  .t1 .nuqta { flex:0 0 auto; margin-bottom:${RTL ? '5px' : '1px'}; }
  .t1 .faint { opacity:.55; }
  .logo { width:44px; height:auto; opacity:.96; display:block; flex:0 0 auto; }
  .name { font-size:${namePx}px; line-height:1.1; font-weight:800; letter-spacing:-.7px; color:#fff;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .name[dir="rtl"] { line-height:1.4; letter-spacing:0; }
  .topic { font-size:20px; opacity:.85; margin-top:5px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .topic[dir="rtl"] { font-size:22px; }
  /* The score row: the fraction at the size it deserves, the percentage beside
     it inside a ring filled to the same number. */
  .scorerow { display:flex; align-items:center; gap:20px; flex:0 0 auto; }
  /* A fraction reads left-to-right in every language — never mirror it. */
  .score { font-size:62px; line-height:1; font-weight:800; direction:ltr; unicode-bidi:isolate;
    font-family:${FONTS.bodyLatin}; letter-spacing:-1.5px; }
  .score span { font-size:27px; font-weight:400; color:rgba(255,255,255,.7); letter-spacing:-.5px; }
  .gauge-col { flex:0 0 100px; position:relative; width:100px; height:100px;
    display:flex; align-items:center; justify-content:center; }
  .gauge { position:absolute; left:0; top:0; width:100px; height:100px; }
  .pct { position:relative; font-size:18px; letter-spacing:.4px; font-weight:800; opacity:.9;
    direction:ltr; unicode-bidi:isolate; font-family:${FONTS.bodyLatin}; }
  /* The hero row. Five shapes, lit — the part of the card a child reads first
     and the part she is being congratulated with. It starts on the same edge
     as every other block; centring it was the last thing on the card that did
     not line up with anything else. */
  .stars { display:flex; align-items:center; gap:11px; flex:0 0 auto;
    /* The star path is inset ~2/24 of its own box, so a star row set flush to
       the padding edge LOOKS indented next to the fraction and the subject
       line, which have almost no side bearing. Pulled back by that much, in
       the logical direction so it mirrors. */
    margin-inline-start:-3.5px; }
  .star--filled { filter:drop-shadow(0 0 10px ${palette.glow}); }
  .foot { display:flex; justify-content:space-between; align-items:center; gap:12px; flex:0 0 auto; }
  .subj { font-size:16px; opacity:.78; min-width:0; overflow:hidden;
    white-space:nowrap; text-overflow:ellipsis; }
  .subj[dir="rtl"] { font-size:19.5px; }
  .badge { background:${palette.accent}; color:${palette.badgeInk}; font-weight:800;
    font-size:${RTL ? '19.5px' : '16px'};
    padding:${RTL ? '4px 18px 7px' : '8px 17px'}; border-radius:17px; white-space:nowrap; flex:0 0 auto;
    font-family:${RTL ? FONTS.bodyUrdu : FONTS.bodyLatin}; line-height:1.45; }
  /* The gaps between the six blocks, shared out by the column itself, so the
     card breathes the same whether the name is one short Latin word or a long
     Nastaliq one. */
  .gap { flex:1 1 auto; min-height:6px; }
  </style></head><body><div class='card' dir='${dir}'>
  ${lattice}
  <div class='hdr'><div class='t1'>${esc(eyebrow)}${nuqtas}</div>${logoImg}</div>
  <div class='gap'></div>
  ${nameHtml}${topicHtml}
  <div class='gap'></div>
  <div class='scorerow'><div class='score'>${correct}<span>/${total}</span></div>
    <div class='gauge-col'>${gaugeSvg(pct, palette)}<div class='pct'>${shownPct}%</div></div>
  </div>
  <div class='gap'></div>
  <div class='stars'>${starsHtml(stars, palette)}</div>
  <div class='gap'></div>
  <div class='foot'>${subjectHtml}<div class='badge'>${esc(badge)}</div></div>
  </div></body></html>`;
}

module.exports = renderScorecardHtml;
module.exports.starsAndBadge = starsAndBadge;
module.exports.tierMessage = tierMessage;
module.exports.cardPalette = cardPalette;
module.exports.tierFor = tierFor;
module.exports.nameFontPx = nameFontPx;
