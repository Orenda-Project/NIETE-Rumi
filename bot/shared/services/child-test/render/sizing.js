/**
 * Child-test stimulus — sizes, and what they come to on a phone (bd-s1oo0.2).
 *
 * WhatsApp cannot show an opened image while a voice note records, so the card has to be read
 * INSIDE the chat bubble. A bubble image is about 65–75% of the screen width; the width is the
 * whole constraint (the image is scaled to it), so what decides legibility is the type size as a
 * fraction of the card width. All sizes here are CSS px on a 540 px card rendered at 2x
 * (1080 px PNG).
 *
 * Glyph proportions were MEASURED (2026-10-02, headless Chromium, ink rows at 100 px):
 *   Andika x-height  = 0.50 em ('x' → 50 px); cap/digit height = 0.72 em ('H' → 72 px)
 *   Nastaliq body    = 0.44 em (dotless beh 'ٮ' → 44 px; 'ر' → 47 px) — the Urdu stand-in for
 *                      x-height: the height of a letter body with no ascender, dot or tail.
 */

const PHONE = { label: '6.1-inch phone (64.9 mm screen width)', screenWidthMm: 64.9 };
const BUBBLE = { fraction: 0.68, low: 0.65, high: 0.75 };
const CARD_CSS_WIDTH = 540;
const DEVICE_SCALE = 2;
const MAX_ASPECT = 1.2; // height / width — keeps a card inside the bubble without a crop

const GLYPH = { latin: { xEm: 0.5, capEm: 0.72 }, urdu: { xEm: 0.44 } };
const LINE_HEIGHT = { latin: 1.4, urdu: 1.85 };

// font-size in CSS px, per grade, per script, per part
const TYPE = {
  3: { story: { english: 78, urdu: 88 }, words: { english: 84, urdu: 96 }, letters: { english: 96, urdu: 110 }, numbers: 88, sums: 60 },
  5: { story: { english: 64, urdu: 72 }, words: { english: 76, urdu: 88 }, letters: { english: 90, urdu: 100 }, numbers: 84, sums: 56 },
};
// story lines per chat card (the browser splits the story by rendered line, balanced)
const STORY_LINES = { 3: { english: 4, urdu: 3 }, 5: { english: 5, urdu: 4 } };

function mmPerCssPx(fraction = BUBBLE.fraction) {
  return (PHONE.screenWidthMm * fraction) / CARD_CSS_WIDTH;
}

function scriptOf(block) {
  return block === 'urdu' ? 'urdu' : 'latin';
}

function fontPx(grade, block, part) {
  const t = TYPE[grade];
  if (!t) throw new Error(`child-test render: no type scale for grade ${grade}`);
  if (part === 'numbers' || part === 'sums') return t[part];
  const lang = block === 'urdu' ? 'urdu' : 'english';
  const p = t[part];
  if (!p) throw new Error(`child-test render: no type size for part ${part}`);
  return p[lang];
}

/**
 * How big the letters are on the phone, at bubble width.
 * For digits (numbers, sums) the measure is digit height (= cap height), for Latin text the
 * x-height, for Urdu the letter-body height.
 */
function legibility({ grade, block, part = 'story', fraction = BUBBLE.fraction }) {
  const px = fontPx(grade, block, part);
  const digits = part === 'numbers' || part === 'sums';
  const em = digits ? GLYPH.latin.capEm : GLYPH[scriptOf(block)].xEm;
  const xPx = px * em;
  const r = (f) => Math.round(xPx * mmPerCssPx(f) * 100) / 100;
  return {
    grade, block, part, fontPx: px,
    measure: digits ? 'digit height' : scriptOf(block) === 'urdu' ? 'letter-body height' : 'x-height',
    xHeightPx: Math.round(xPx * 10) / 10,
    xHeightMm: r(fraction),
    xHeightMmRange: [r(BUBBLE.low), r(BUBBLE.high)],
    bubbleFraction: fraction,
    phone: PHONE.label,
  };
}

module.exports = {
  PHONE, BUBBLE, CARD_CSS_WIDTH, DEVICE_SCALE, MAX_ASPECT, GLYPH, LINE_HEIGHT, TYPE, STORY_LINES,
  mmPerCssPx, fontPx, legibility, scriptOf,
};
