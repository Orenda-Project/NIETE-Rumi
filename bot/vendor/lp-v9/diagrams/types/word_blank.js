// word_blank — a picture of a thing, and the word for it with a letter missing.
//
// The phonics / spelling / fill-in-the-blank instrument. The picture says WHICH
// word (a cat), the letters say what the child already has (c _ t), and the
// options are the letters that could go in the gap. Nothing in the drawing may
// be the answer, so the missing letter is never printed anywhere.
//
// TWO STYLES, and the script decides which one is safe.
//
//   inline (default for Latin) — the word as one run of big letters with "_"
//     where a blank is. This is the form a teacher writes on the board.
//
//   tiles (FORCED for Urdu, available for Latin) — one box per letter, laid out
//     right-to-left for Urdu. Nastaliq JOINS: بلی is three letters that change
//     shape according to their neighbours, so deleting the ل and printing
//     "ب_ی" does not show a Urdu reader "the word with one letter missing" — it
//     shows two isolated letters and an underscore, and worse, the letters that
//     remain are drawn in the WRONG FORMS (a ب that should be initial renders
//     isolated). The qaida's own answer to this is the letter row: each حرف in
//     its isolated form, in order, which is how a grade-1 child is taught to
//     spell in the first place. So an Urdu word_blank is always a letter row,
//     and the blank is an empty box rather than an underscore glyph (an
//     underscore in an RTL run is a bidi trap of its own).
//
// A letter is a GRAPHEME, not a code point: an Urdu combining mark (زبر زیر
// پیش, U+064B-U+0652) rides with the letter it sits on, and a Latin digraph the
// author wants treated as one sound ("sh", "ch") can be passed explicitly in
// `letters`.
//
// Spec
//   word     "cat" | "بلی"                  the whole word, with nothing removed
//   blanks   [1]                            0-based indices of the letters to hide
//   letters  ["c","a","t"]                  optional explicit split (digraphs)
//   picto    "cat"                          optional pictogram name (lib/pictogram.js)
//   style    "inline" | "tiles"             default inline for Latin, tiles for Urdu
//   lang     "en" | "ur"

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");
const { drawPictogram, descLine, has: hasPictogram, names: pictogramNames } = require("../lib/pictogram");

// Combining marks that are part of the letter before them, never a letter of
// their own: Arabic diacritics, the superscript alef, and the Qur'anic marks.
const COMBINING = /[ً-ٰٟۖ-ۭؐ-ؚ‌‍]/;

/** Split a word into graphemes: a combining mark rides with its base letter. */
function splitLetters(word) {
  const out = [];
  for (const ch of String(word ?? "")) {
    if (out.length && COMBINING.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

function render(spec) {
  const isUr = spec.lang === "ur" || hasUrdu(String(spec.word ?? ""));
  const letters = Array.isArray(spec.letters) && spec.letters.length
    ? spec.letters.map((l) => String(l))
    : splitLetters(spec.word);
  if (!letters.length) throw new Error("word_blank: `word` is required");
  const blanks = new Set(
    (Array.isArray(spec.blanks) ? spec.blanks : [spec.blanks])
      .map((b) => Number(b))
      .filter((b) => Number.isInteger(b) && b >= 0 && b < letters.length)
  );
  if (!blanks.size) throw new Error("word_blank: `blanks` must name at least one letter index to hide");
  if (blanks.size >= letters.length) throw new Error("word_blank: every letter is blank — leave the child something to read");
  const style = isUr ? "tiles" : (spec.style === "tiles" ? "tiles" : "inline");

  const picto = spec.picto ? String(spec.picto) : null;
  if (picto && !hasPictogram(picto)) {
    throw new Error(`word_blank: unknown pictogram "${picto}" — the set is: ${pictogramNames().join(", ")}`);
  }

  // Deliberately large. This is a grade 1-2 instrument delivered as a 1080px
  // picture inside a 1.91:1 WhatsApp image header; the letters ARE the content,
  // not a label on it. A tall, narrow body letterboxes inside that header and
  // every glyph shrinks with it, so the default layout puts the picture BESIDE
  // the word (`row`) rather than above it — measured: the same word_blank is
  // 2.2x larger on the phone in row than in stack.
  const LETTER = spec.letterSize ?? 54;
  const PICTO = spec.pictoSize ?? 168;
  const PAD = 18;
  const GAP = 34;

  // ── the letter block ──────────────────────────────────────────────────────
  let blockW;
  let blockH;
  let paint; // (svg, x, y) draws the block with its top-left at (x, y)

  if (style === "inline") {
    const shown = letters.map((l, i) => (blanks.has(i) ? "_" : l)).join(" ");
    blockW = Math.ceil(measure(shown, LETTER, { weight: 700 }) * 1.06);
    blockH = LETTER * 1.35;
    paint = (svg, x, y) => {
      svg.text(x + blockW / 2, y + LETTER, shown, {
        size: LETTER, weight: 700, anchor: "middle", fill: C.ink, letterSpacing: "0.06em",
      });
    };
  } else {
    // One box per letter. The tile is sized from the SAME estimator the Urdu
    // foreignObject uses (measure/urduBoxH via svg.text with no w/h): a tile
    // sized by eye clipped every Nastaliq letter to its bottom third, because
    // Noto Nastaliq's line box at 54px is ~2.6x the point size and the glyph
    // body sits high inside it. Never hand-size a box that holds Urdu.
    const urW = Math.max(measure("ب", LETTER, { lang: "ur" }) * 1.25 + LETTER, LETTER * 3);
    const TILE = isUr ? Math.ceil(urW) + 8 : Math.max(LETTER * 1.55, 78);
    const TGAP = 14;
    blockW = letters.length * TILE + (letters.length - 1) * TGAP;
    blockH = TILE;
    paint = (svg, x, y) => {
      letters.forEach((letter, i) => {
        // Urdu reads right-to-left: letter 0 is the RIGHT-most tile.
        const slot = isUr ? letters.length - 1 - i : i;
        const tx = x + slot * (TILE + TGAP);
        const blank = blanks.has(i);
        svg.rect(tx, y, TILE, TILE, {
          rx: 10,
          fill: C.paper,
          stroke: blank ? C.accent : C.rule,
          sw: blank ? 2.6 : 1.6,
          dash: blank ? "7 6" : undefined,
        });
        if (blank) return; // an empty box IS the question; never print the answer
        svg.text(tx + TILE / 2, y + TILE / 2, letter, {
          size: LETTER, weight: 700, anchor: "middle", baseline: "middle", fill: C.ink,
        });
      });
    };
  }

  // ── the frame ─────────────────────────────────────────────────────────────
  const layout = picto ? (spec.layout === "stack" ? "stack" : "row") : "stack";
  let bodyW;
  let bodyH;
  let pictoAt = null;
  let blockAt;
  if (layout === "row") {
    bodyW = PAD * 2 + PICTO + GAP + blockW;
    bodyH = PAD * 2 + Math.max(PICTO, blockH);
    // The picture sits on the side the reader starts from.
    const pictoX = isUr ? bodyW - PAD - PICTO : PAD;
    const blockX = isUr ? PAD : PAD + PICTO + GAP;
    pictoAt = [pictoX, (bodyH - PICTO) / 2];
    blockAt = [blockX, (bodyH - blockH) / 2];
  } else {
    bodyW = PAD * 2 + Math.max(blockW, picto ? PICTO : 0);
    bodyH = PAD * 2 + (picto ? PICTO + GAP : 0) + blockH;
    if (picto) pictoAt = [(bodyW - PICTO) / 2, PAD];
    blockAt = [(bodyW - blockW) / 2, PAD + (picto ? PICTO + GAP : 0)];
  }

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title, caption: spec.caption, source: spec.source, note: spec.note,
    lang: isUr ? "ur" : "en", spec,
  });
  if (picto) {
    svg.add(`<desc>${descLine()}</desc>`);
    drawPictogram(svg, pictoAt[0], pictoAt[1], PICTO, picto, { color: C.ink });
  }
  paint(svg, blockAt[0], blockAt[1]);
  return svg.toString();
}

module.exports = {
  type: "word_blank",
  aliases: ["missing_letter", "fill_the_blank_word", "phonics_word"],
  summary: "A pictogram of a thing above its word with one or more letters hidden — phonics, spelling, missing-letter.",
  render,
  examples: [
    {
      name: "word_blank_cat_en",
      spec: { type: "word_blank", word: "cat", blanks: [1], picto: "cat" },
    },
    {
      name: "word_blank_apple_tiles_en",
      spec: { type: "word_blank", word: "apple", blanks: [0], picto: "apple", style: "tiles" },
    },
    {
      name: "word_blank_billi_ur",
      spec: { type: "word_blank", word: "بلی", blanks: [1], picto: "cat", lang: "ur" },
    },
  ],
  splitLetters,
};
