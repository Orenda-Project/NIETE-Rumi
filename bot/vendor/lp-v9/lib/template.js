// LP-HTML v8 — lp_doc -> a self-contained, two-page A4 HTML document.
//
// The look is the proven one (canva-build/samples/lp_page-*.png): navy #0B2545,
// amber #F2A20C, leaf #1F7A4D, Inter, cards not tables, chips not prose.
// The ANATOMY is the one the teachers recognised in v7-1 (research 03 §3): lettered
// O/I/D/A/C/H section bars with minutes on the right, an "OPEN WITH THIS QUESTION"
// hook box, ⚠ warnings, board notes, GUIDED/INDEPENDENT tags, Support/Extension
// cards, and an A–H support page that is explicitly not read aloud.
//
// Laws this file must not break:
//   D4  body >= 18px at 794px page width (operator, 2026-09-01: 16.5 was still not
//       readable on a phone); labels/chips >= 14px; body leading >= 1.55 and NEVER tightened
//       to pay for the type; single column body; no side-by-side
//       BODY TEXT (side-by-side CARDS are the approved v7-1 pattern and are fine).
//   R2  the SLO is at the top, verbatim, with its page.
//   M3  the hook is a provocation, rendered as the loudest box on the page.
//   R6  Urdu: dir=rtl, Nastaliq, unitless line-height >= 2.0 — NEVER a px
//       line-height, which clips Nastaliq's descenders.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { rich, esc, display, displayChem, setRtlProse, setUrduInline } = require("./rich");
const { LABELS } = require("./overlay");
const { fontCss, katexCss, REPO_ROOT } = require("./fonts");
const { toV3 } = require("./migrate");
const { questionIndex } = require("./questions");
const { prunePending } = require("./pending");

// ── diagram-type badge: the enum is OURS, the badge is the TEACHER'S ─────────
// The figure badge used to print `spec.type` raw, under `text-transform:uppercase`, so the
// 2026-09-02 ICT sample set shipped "CHEM_EQUATION", "FREE_BODY", "GRAPH" and
// "LEAF_CROSS_SECTION" to classrooms. A diagram type is an internal registry key; the badge is
// a teacher-facing label and must read as one, in the DOCUMENT's language.
//
// Every canonical type AND every alias gets its own row on purpose. A doc may name either —
// `leaf_cross_section` is an alias and it is in the shipped ICT set today — and the alias is
// usually the more specific word, so it earns a more specific label than its canonical type
// ("Cross-section", not "Cell"). test/print_quality.js enumerates the diagram engine's OWN
// registry against this table, so a new type cannot ship without a label.
const DIAGRAM_LABELS = {
  atom:               { en: "Atom",            ur: "ایٹم" },
  bohr:               { en: "Bohr model",      ur: "بور ماڈل" },
  electron_shells:    { en: "Electron shells", ur: "برقیوں کے خول" },
  dot_and_cross:      { en: "Dot and cross",   ur: "نقطہ و صلیب خاکہ" },
  cell:               { en: "Cell",            ur: "خلیہ" },
  leaf_cross_section: { en: "Cross-section",   ur: "مقطع" },
  heart_loop:         { en: "Circulation",     ur: "دورانِ خون" },
  bio_schematic:      { en: "Biology diagram", ur: "حیاتیاتی خاکہ" },
  dna_helix:          { en: "DNA helix",       ur: "ڈی این اے مرغولہ" },
  rna_helix:          { en: "RNA helix",       ur: "آر این اے مرغولہ" },
  nucleic_acid_helix: { en: "Nucleic acid",    ur: "نیوکلک ایسڈ" },
  helix:              { en: "Helix",           ur: "مرغولہ" },
  chem_equation:      { en: "Equation",        ur: "مساوات" },
  equation:           { en: "Equation",        ur: "مساوات" },
  reaction:           { en: "Reaction",        ur: "تعامل" },
  circuit:            { en: "Circuit",         ur: "برقی دور" },
  circuit_diagram:    { en: "Circuit",         ur: "برقی دور" },
  flow:               { en: "Flow",            ur: "مرحلہ وار خاکہ" },
  process:            { en: "Process",         ur: "عمل" },
  chain:              { en: "Chain",           ur: "سلسلہ" },
  fraction_bar:       { en: "Bar model",       ur: "پٹی نما ماڈل" },
  bar_model:          { en: "Bar model",       ur: "پٹی نما ماڈل" },
  tape_diagram:       { en: "Bar model",       ur: "پٹی نما ماڈل" },
  free_body:          { en: "Force diagram",   ur: "قوتوں کا خاکہ" },
  fbd:                { en: "Force diagram",   ur: "قوتوں کا خاکہ" },
  force_diagram:      { en: "Force diagram",   ur: "قوتوں کا خاکہ" },
  vector:             { en: "Vectors",         ur: "سمتیہ خاکہ" },
  geometry:           { en: "Geometry",        ur: "ہندسہ" },
  construction:       { en: "Construction",    ur: "ہندسی تشکیل" },
  graph:              { en: "Graph",           ur: "گراف" },
  plot:               { en: "Graph",           ur: "گراف" },
  function_plot:      { en: "Graph",           ur: "گراف" },
  grid:               { en: "Grid",            ur: "خانہ دار جدول" },
  area_model:         { en: "Area model",      ur: "رقبے کا ماڈل" },
  hundred_square:     { en: "Hundred square",  ur: "سو خانوں کا مربع" },
  illustrative:       { en: "Illustration",    ur: "تصویری وضاحت" },
  ai_art:             { en: "Illustration",    ur: "تصویری وضاحت" },
  placeholder:        { en: "Illustration",    ur: "تصویری وضاحت" },
  labelled_figure:    { en: "Labelled figure", ur: "نشان زد تصویر" },
  textbook_figure:    { en: "Book figure",     ur: "کتاب کی تصویر" },
  photo_labels:       { en: "Labelled figure", ur: "نشان زد تصویر" },
  mindmap:            { en: "Mind map",        ur: "ذہنی نقشہ" },
  concept_map:        { en: "Concept map",     ur: "تصوراتی نقشہ" },
  molecule:           { en: "Molecule",        ur: "سالمہ" },
  smiles:             { en: "Molecule",        ur: "سالمہ" },
  structure:          { en: "Structure",       ur: "ساخت" },
  numberline:         { en: "Number line",     ur: "عددی خط" },
  number_line:        { en: "Number line",     ur: "عددی خط" },
  // "Panels" was the SHAPE, not the point: it told the teacher how the SVG is laid out, which is
  // the one thing she can already see. Its own Urdu has always said موازنہ — comparison — so the
  // English was the outlier, not the translation. The badge names what the figure is FOR.
  panels:             { en: "Comparison",      ur: "موازنہ" },
  comparison:         { en: "Comparison",      ur: "موازنہ" },
  compare:            { en: "Comparison",      ur: "موازنہ" },
  punnett:            { en: "Punnett square",  ur: "پنیٹ مربع" },
  genetics:           { en: "Genetics",        ur: "جینیات" },
  cross:              { en: "Genetic cross",   ur: "جینیاتی کراس" },
  ray_diagram:        { en: "Ray diagram",     ur: "شعاعی خاکہ" },
  optics:             { en: "Optics",          ur: "بصریات" },
  lens:               { en: "Lens",            ur: "عدسہ" },
  mirror:             { en: "Mirror",          ur: "آئینہ" },
  timeline:           { en: "Timeline",        ur: "زمانی خط" },
  chronology:         { en: "Timeline",        ur: "زمانی خط" },
};

/**
 * The teacher-facing badge for a diagram type, in `lang`. Returns "" for an unknown type —
 * the caller prints NO badge rather than leaking the enum, because an unlabelled figure is a
 * cosmetic gap and a printed enum is a defect a teacher sees.
 */
function diagramLabel(type, lang = "en") {
  const row = DIAGRAM_LABELS[String(type ?? "").trim().toLowerCase()];
  if (!row) return "";
  return row[lang === "ur" ? "ur" : "en"] || row.en || "";
}

// ── section identity: letter, palette, order ────────────────────────────────
const SECTION_META = {
  objectives: { letter: "O", cls: "s-o" },
  warmup: { letter: "W", cls: "s-w" },
  introduction: { letter: "I", cls: "s-i" },
  development: { letter: "D", cls: "s-d" },
  activity: { letter: "A", cls: "s-a" },
  conclusion: { letter: "C", cls: "s-c" },
  homework: { letter: "H", cls: "s-h" },
};

/* ── THE TYPE SCALE (v9.2, 2026-09-06) ────────────────────────────────────────
   Operator: *"could we please increase the font on the lesson plan even further to
   ensure its readability? Currently, it's very small, and it's very hard to read.
   Please increase the size by 1 or 2 pt, or figure out what makes it readable if one
   is holding a phone at an arm's length distance."*

   Every font-size below is still written at its v9.1 value and multiplied by ONE
   number on the way out, so the ladder stays proportional and the next move is one
   constant rather than sixty edits. The operator asked in POINTS; 1 CSS pt = 4/3 px,
   so the v9.1 18px body was 13.5pt and the v9.2 21px body is 15.75pt — his "1 or 2 pt",
   rounded UP to the number the rest of the bot already uses (see the note below the
   constants).

   WHAT DOES NOT SCALE, and why:
     · padding, radii, borders and the --sp-N spacing ladder. v9.1's rule stands —
       no narrower gutters and no horizontal-density tricks to pay for the type.
       Leading is UNITLESS, so it grows with the type for free.
     · the KaTeX stylesheet. It is concatenated AFTER the scale is applied; its own
       px rules are internal typesetting geometry and multiplying them corrupts the
       maths. This is why the scale is applied to our block alone and not to the
       whole returned sheet.
     · the diagram engine's label floor. It lives in diagrams/lib/svg.js and sizes
       labels against the FIGURE's column, not the page's body scale. It moves in
       its own change, gated by the overlap sweep.

   READABILITY.md (prod_golive_2026-09-06/07_font) carries the measurement this
   number is chosen against, including the honest statement that NO step of one or two
   points reaches the arm's-length floor: at 21px the body still arrives at 66% of the
   critical print size for fluent reading, and closing the rest needs a phone-first page,
   which is priced there and is the operator's call, not this file's. */
const BODY_PX_V91 = 18;    // the v9.1 body — 13.5pt
const BODY_PX     = 21;    // v9.2 — 15.75pt, i.e. +2.25pt
const TYPE_SCALE  = BODY_PX / BODY_PX_V91;     // 1.1666…

/* WHY 21 AND NOT 20.67 (= a flat +2pt). Because 21 is not this file's number to pick.
   `bot/shared/templates/niete-brand.js` in NIETE-Rumi already declares
   `TYPE_FLOOR = { body: 21, small: 16.5, label: 15.5 }` as THE type floor for every
   teacher-facing rendered artefact, shipped for the quiz PDFs on the same evidence and the
   same arithmetic used here (an A4 page opened on a phone is scaled by 390/794 = 0.4912
   before anyone reads it). Two PDFs that arrive from the same bot on the same day must not
   disagree about what "readable" means — that is exactly how one artefact came to run at
   11px while another ran at 9.5px and both believed they were fine.

   The vendored engine deliberately does NOT `require` that token: `bot/vendor/lp-v9` is a
   vendored copy with a documented divergence list, and reaching into the host app's brand
   module would be a divergence upstream can never carry. So the NUMBER is shared and the
   CODE is not, and this comment is the join. If the token moves, this constant moves with
   it — `tests/lp612/type-scale.test.js` asserts the two agree, so they cannot drift silently. */

/** THE ONE ROUNDING, AND IT IS TWO DECIMAL PLACES ON PURPOSE.
 *
 *  Chrome's `getComputedStyle().fontSize` — which is what render_lp.js's probe reads and
 *  compares against BODY_FLOOR_PX — serialises to 2 dp. A stylesheet written at 3 dp is
 *  therefore read back SHORTER than it was written (`19.333px` in, `19.33px` out), and the
 *  floor check then fails EVERY render on nothing but a rounding artefact. Measured, not
 *  reasoned: the first +1pt corpus render died with
 *  "TYPE FLOOR: smallest body text is 19.33px (<19.333px)".
 *
 *  So there is exactly one place a scaled px is computed, it rounds the way the browser
 *  rounds, and both the stylesheet and the floors go through it. */
const scaledPx = (px) => +(px * TYPE_SCALE).toFixed(2);

/* ── THE PAGE (v9.3, 2026-09-07, bd-oak77.16) ─────────────────────────────────
   v9.2 took the type as far as A4 will carry it and 07_font measured, honestly, where
   that lands: an A4 page box opened in WhatsApp is fit to a ~390 CSS-px screen, so every
   size on it is multiplied by 390/794 = 0.4912 before a teacher reads it, and the 21px
   body arrives at 0.930 mm of x-height — 7.99 arcmin at 40 cm, 67% of the 12-arcmin
   critical print size for fluent reading (Legge & Bigelow 2011).

     apparent x-height (mm) = font_px x 0.5411 x (390 / PAGE.w) x 0.16667

   There are exactly two terms and the type is spent. THIS one is the page. At the shipped
   21px body the floor needs a page 528px wide or narrower; 520 measures 1.431 mm =
   12.30 arcmin on a real production lesson re-rendered from its stored document
   (prod_golive_2026-09-06/15_phone_page/DESIGN.md section 3).

   WHY 2000 TALL, and why that is not a typo. Page count is set by page AREA, so a narrow
   page that keeps A4's proportions is simply A4 with 31.5px type — the arm 07_font priced
   at 2,261 pages, a 36-page lesson. Height is the term that buys the area back. Measured
   over 62 documents AND all 116 lessons production has delivered, 520x2000 costs FEWER
   pages than today (1,136 against 1,577 on production traffic, median 14 -> 10), flags 1
   document over cap where the live geometry flags 72, and produces zero layout defects.
   Every candidate height from 1040 to 2380 is in DESIGN.md section 4 with its numbers.

   Total scroll length is NOT set by this: it is set by the type and the column, and it
   roughly doubles because the type is 1.5x bigger in the hand. That is the honest cost of
   the change and no page size avoids it. A taller page reduces it (fewer page bottoms left
   ragged), which is the other reason 2000 wins over 1470.

   WHAT THIS COSTS ON PAPER. Printed fit-to-page on A4 this page scales 0.561 and lands as
   a 77 x 297 mm column using 37% of the sheet, its type at 14.5 arcmin — legible, wasteful.
   The answer to that is a SECOND render of the same stored document at `a4`, which is why
   this is a shaped object with a named format and not five loose numbers: the printable
   variant is a parameter, not a rewrite. Priced in DESIGN.md section 7 (bd-oak77.19).

   The rollback is one variable and no deploy: LP_612_TEMPLATE_VERSION=v9.2. */
const PAGE_FORMATS = Object.freeze({
  /** v9.2 and before. Kept, named, and unused by the delivery path — it is the printable
   *  variant's geometry and the reference the phone page's derivations are stated against. */
  a4: Object.freeze({
    name: "a4", w: 794, h: 1123, padX: 21, padT: 10, padB: 4, oneColumn: false,
  }),
  /** v9.3 — what a teacher receives. */
  phone: Object.freeze({
    name: "phone", w: 520, h: 2000, padX: 21, padT: 10, padB: 4, oneColumn: true,
  }),
});

/** The page this build lays out on. Defaults to `phone` — what a teacher receives, and what
 *  v9.3 means — and is changed ONLY by `buildHtml`'s `format` option, never by an env switch.
 *
 *  VENDOR DIVERGENCE (SYNC §3.14). This was `const PAGE = PAGE_FORMATS.phone`, with the note
 *  that a printable render "changes this by passing a format, once the parameter exists". This
 *  is that parameter. The reason it was refused before still stands and is now enforced rather
 *  than avoided: a service that flips geometry silently would put two layouts in the render
 *  cache under one key, so the format is an EXPLICIT argument that the caller must name, and
 *  `buildHtml` returns the geometry it actually used (`page`) so a caller can key its cache on
 *  it instead of assuming. Same state discipline as `setRtlProse`/`setUrduInline` above:
 *  `buildHtml` is synchronous, so two documents cannot interleave. */
let PAGE = PAGE_FORMATS.phone;

/** The A4 reference for anything whose apparent size on the phone must be stated against the
 *  page it was chosen for. */
const PAGE_A4 = PAGE_FORMATS.a4;

/** Scale a length that was chosen against the A4 measure so its APPARENT size on the phone is
 *  unchanged by the page. Used for the diagram engine's label floor, which sizes labels against
 *  the figure's own column and would otherwise refuse 99 of 116 real lessons a figure. */
const pageScaled = (pxAtA4) => +(pxAtA4 * (PAGE.w / PAGE_A4.w)).toFixed(2);

/** Multiply every `font-size: <n>px` in a stylesheet by the type scale, and nothing else.
 *  `em`/unitless values scale with their parent for free and are left alone. */
function scaleTypeCss(sheet, k) {
  if (!(k > 0) || k === 1) return sheet;
  const f = k === TYPE_SCALE ? scaledPx : (px) => +(px * k).toFixed(2);
  return sheet.replace(/font-size:(\s*)([\d.]+)px/g,
    (_m, sp, n) => `font-size:${sp}${f(Number(n))}px`);
}

function css(rtl, fonts, katex, urduScript) {
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  const sheet = `
@page { size: ${PAGE.w}px ${PAGE.h}px; margin: 0; }
:root{
  /* VENDOR DIVERGENCE (SYNC §3.15). THE NIETE BRAND LAYER. Operator: "keep the HTML good parts
     like the moves colours, etc, keep the kie.ai NIETE colours thouggh". Two instructions, and
     they pull on different things, so they are held apart here:
       the MOVES  are a SYSTEM -- seven bands, seven colours, each ≥15 dE from the other six and
                  ≥4.5:1 under its white name. That system is v9's and it stays, untouched.
       the BRAND  is which colours the system is drawn in. The navy, the green and the tints are
                  now kie.ai's, read off the rendered G4 English page: ink #303749, green #43A477
                  with #298157 for its dark, green tint #DEF4E7, slate tint #E6E9EE.
     Only the two brand-bearing bands moved (development navy, activity green); rose, teal, plum,
     amber and grey are move colours with no kie.ai counterpart and are unchanged. Both floors were
     re-measured after the swap: every band still clears white (activity is the new floor at 4.80),
     and the closest pair is 19.3 dE (development/homework, was 21.2 intro/homework).
     --amber stays #F2A20C for the I-DO tag -- operator: "in the amber colour like the html".
     kie.ai's #FFD05E was held out of the palette until a rule consumed it. SYNC §3.16 is
     that rule: it is --board-gold, and it prints ONLY as the WRITE ON THE BOARD heading, on
     the navy bar (8.16:1). It is never offered on white, where it measures 1.45:1. */
  --navy:#303749; --navy2:#2A3550; --amber:#F2A20C; --amber-soft:#FDEBC8;
  --ink:#1a2233; --mut:#5b6472; --line:#e5e9f0; --leaf:#298157; --warn:#B4531F;
  --board-gold:#FFD05E;
  --page-w:${PAGE.w}px; --page-h:${PAGE.h}px;
  /* THE SURFACE LADDER (v9.4, bd-a8veu.23). Operator, on the PDF review: "the readability of the
     LP should be better with colour blocks and formatting of text and font to hold the eye."

     A census of this sheet before the ladder: NINETEEN distinct pale tints, seven solid fills,
     seventeen border treatments and ELEVEN corner radii, every one a hex literal written at the
     block that wanted it. .askb was #F5F8FC, .say #F7F9FC, .seq #F6F8FC, .kw #EEF2F8 and .cite
     #EAF0F8 — five colours no reader can tell apart, five borders that all say "a box", and no
     rank for the eye to follow. Nothing there was wrong on its own; the problem was the sum.

     So a block now picks a ROLE, never a colour:
       teach   the teacher explains, asks, scripts, cites   blue
       do      the pupils work, and the answer is right     green
       watch   a warning, a misconception, a re-teach       terracotta
       note    a resource, an aside, an offer, a warm-up    amber
       quiet   neutral furniture, rows and metadata         grey
     Each role brings a FILL, a HAIRLINE and an INK for the label that sits on it. On top of the
     five sit the page's own white and the two emphasis surfaces that were already tokens (navy
     for a landmark block, amber-soft for the outcome box) — those are L1 and stay loud on purpose.

     FILL, LINE AND CASE ONLY. No padding, no margin, no border width and no font-size moves in
     this pass: the teach part renders at 99-100% of its four-page cap, so one added pixel per
     block buys a page. Translucent overlays (rgba) on the navy and amber BANDS are deliberately
     NOT roles — they are chrome painted on a solid, not a surface of their own. */
  --s-teach:#F2F6FC; --s-teach-line:#CBD8E8; --s-teach-ink:var(--navy2);
  --s-do:#DEF4E7;    --s-do-line:#B5E3C9;    --s-do-ink:#14603A;
  --s-watch:#FCEDE6; --s-watch-line:#F2C4AD; --s-watch-ink:var(--warn);
  --s-note:#FFF8E8;  --s-note-line:#F0DFB4;  --s-note-ink:#8A5F04;
  --s-quiet:#EDEFF3; --s-quiet-line:#E6E9EE; --s-quiet-ink:#414A57;
  /* THE THREE BAND FILLS WITH NO ROLE BEHIND THEM. Most bands wear the solid form of a role ink
     (see .s-* below), but there are seven moves and only five role inks, so three moves have to
     carry a colour of their own. Operator, on the seven-band strip: "what about the moves being
     different coloured in the LP?" — they were not. Objectives and Warm-up were the SAME
     --s-note-ink amber, byte for byte, and Introduction's --navy2 sat 8.8 dE from Development's
     --navy, which at band size under a white badge is one navy, not two. Four of seven bands were
     two browns and two navies. Warm-up takes the rose and Introduction the teal; DEVELOPMENT KEEPS
     THE NAVY, because it is the spine of the lesson and the kie.ai ink is the darkest, strongest band
     on the page — the one a teacher flipping seven pages aims at. Each of the three clears 4.5:1
     against the white name and minutes the band prints (rose 6.56, teal 6.31, plum 7.46), and the
     closest pair among all seven is 19.3 dE apart. readability-blocks.test.js holds both. */
  --band-c:#584A93;
  --band-w:#9E3B52;
  --band-i:#0F6A73;
  /* WE DO'S OWN BAND -- VENDOR DIVERGENCE (bd-f6opy, SYNC 3.23). The operator asked the three
     GRADUAL-RELEASE MOVES to be three colours, and the moves are not the seven sections above:
     they are I DO inside development and WE DO / YOU DO inside activity, so they read navy,
     green and green. Splitting the activity band gives WE DO a band of its own, which needs a
     fill that is not any of the seven already on the page.

     SHE ASKED FOR TEAL AND THIS IS A BLUE, DELIBERATELY: --band-i is already teal and is the
     Introduction band on pages 1-3, so a teal WE DO band on page 8 would make one hue mean two
     things to a teacher flipping the plan. Chosen by searching the band family's OWN character
     rather than for maximum distance -- the family means L* 39.0 and chroma 32.3, and a first
     search that maximised dE returned an electric #0028E4 belonging to no palette here. This one
     measures L* 38.9, chroma 32.4, hue 271.2deg, 6.73:1 against the white name it prints, and
     23.6 dE from its nearest neighbour. readability-blocks.test.js holds it with the rest. */
  --band-we:#2E5E90;
  /* THREE RADII, down from eleven. --r-1 rows and small chips, --r-2 blocks and boxes, --r-pill
     anything shaped as a pill. A circle is a SHAPE, not a radius choice, and keeps its 50%. */
  --r-1:6px; --r-2:9px; --r-pill:999px;
  /* THE SPACING SCALE (v8.1). One ladder, five rungs, used for every vertical gap on the
     page. Before this the gaps were ad-hoc 1-5px values chosen per block and the operator's
     verdict was that "the sections and boxes are on top of each other". Vertical rhythm is
     applied ONLY as margin-top on a .pad atom (see .pad > .sp-N below), so the packer can
     charge for it exactly — a gap the packer cannot see is a clipped page. */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px;
}
*{ box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html,body{
  /* bd-jdtdl — the LABEL PACK and the BODY LANGUAGE are independent. An Urdu-medium lesson is
     authored in Urdu and may be served with the English chrome, and Inter has no Arabic glyphs:
     the face has to be reachable whenever the DOCUMENT carries Urdu, not only when lang=ur.
     Under RTL it leads, as R6 requires.
     Under LTR it goes SECOND — after Inter, BEFORE the Latin fallbacks — and the order is the
     whole fix. Appending it to the tail was measured and does nothing: CSS fallback is
     per-character, so it stops at the first family that HAS the glyph, and Arial is that
     family on any host whose Arial carries Arabic (macOS does). On the Linux container Arial
     resolves to LiberationSerif, which has no Arabic and draws .notdef — the operator's boxes.
     Second place keeps Latin on Inter (Inter has every Latin glyph, so it never falls through)
     and sends Arabic script to Nastaliq on every host, which is what "only nastaliq" means. */
  font-family:${rtl ? `'Noto Nastaliq Urdu',` : ""}'Inter'${!rtl && urduScript ? `,'Noto Nastaliq Urdu'` : ""},'Helvetica Neue',Arial,sans-serif;
  color:var(--ink);
  /* unitless: scales with font-size. A px line-height clips Nastaliq descenders. */
  line-height:${rtl ? "2.05" : "1.55"};
  font-size:18px;
}
body{ background:#fff; }
${!rtl && urduScript ? `
/* bd-b8ypq — an ENGLISH page that quotes Urdu. bd-jdtdl reached the face above; these two rules
   are its metrics. lib/rich.js wraps each Arabic run in .ar, so only the lines that actually
   carry Nastaliq take the tall line box and the page keeps its 1.55 rhythm everywhere else —
   lifting the whole page for one honorific costs ~50% of its vertical budget and overruns the
   packer (render_lp.js:94-117).
   2.05 is exactly what an RTL page uses, and the operator confirmed those render correctly.
   Nastaliq's 99th-percentile glyph paints 1.944em, so 2.05 contains it; the ﷺ ligature alone
   paints 3.190em — measured over every glyph in ../fonts/NotoNastaliqUrdu.ttf — which no
   affordable line box holds, and which overflows even its own font's 2.50em content box. It is
   drawn far larger than the script around it by design, so .61em still leaves ~1.95em of ink:
   larger than the Latin beside it, and inside the run's own box. */
.ar{ line-height:2.05; }
.ar-lig{ font-size:0.61em; }
` : ""}
.page{ width:var(--page-w); height:var(--page-h); position:relative; background:#fff;
       page-break-after:always; overflow:hidden; }
.page:last-child{ page-break-after:auto; }
.pad{ padding:${PAGE.padT}px ${PAGE.padX}px ${PAGE.padB}px; height:100%; display:flex; flex-direction:column; }
/* Every direct child of .pad is an ATOM the packer measured. Rhythm is margin-top ONLY —
   margin-bottom would double up between neighbours and margins never collapse between flex
   items, so one-sided margins are the only shape whose sum equals the stack height. The
   first atom on a page loses its margin (it is against the page padding already). */
.pad > .sp-1{ margin-top:var(--sp-1); }
.pad > .sp-2{ margin-top:var(--sp-2); }
.pad > .sp-3{ margin-top:var(--sp-3); }
.pad > .sp-4{ margin-top:var(--sp-4); }
.pad > .sp-5{ margin-top:var(--sp-5); }
.pad > :first-child{ margin-top:0; }

/* ── header ─────────────────────────────────────────────────────────────── */
/* Urdu needs more top padding than Latin: Nastaliq's honorific ligatures (ﷺ) and its tall
   marks reach far above the x-height, and at 7px the ﷺ in a chapter title sat on the hero's
   own top edge. Measured on the G10 Urdu sample, not guessed. */
/* ── EVERY REMAINING SIDE-BY-SIDE PAIR, COLLAPSED ON THE PHONE PAGE (v9.3, bd-oak77.16) ──
   Found by rendering the whole type sweep at 390px and READING it, not by grepping for display:flex.
   At the phone page's 478px measure each of these gives its halves ~230px, and the masthead
   pair is worse than that: .hero .h-meta is flex:0 1 auto, so it shrank to ~110px and
   printed "Ch. 1 · Matrices and Determinants p.24-25 · 40 min" down five lines while stealing
   the width from the title — the exact pathology the h-meta comment above records at 794px,
   reappearing one page size down. .p2head was worse again: eight lines of wrapped meta.
   Stacking is the fix and it costs nothing measurable: the corpus page count is unchanged. */
.hero{ background:var(--navy); color:#fff; border-radius:var(--r-2); padding:${rtl ? "12px" : "8px"} 14px ${rtl ? "9px" : "8px"};
       ${PAGE.oneColumn ? "display:block;" : "display:flex; justify-content:space-between; align-items:flex-start; gap:18px;"} }
.hero .kicker{ color:var(--amber); font-weight:800; letter-spacing:.13em; font-size:14px;
       text-transform:uppercase; line-height:1.3; }
/* The TITLE COLUMN. flex:1 1 auto with min-width:0 is load-bearing: without the min-width a
   flex item's floor is its own min-content width, which for a title is the longest WORD — that
   is how the column got down to 166px and printed "The / biological / method / —" one word per
   line on the G9 Bio plan. */
.hero .h-col{ flex:1 1 auto; min-width:0; }
.hero .h-title{ font-size:28.5px; font-weight:800; line-height:${rtl ? "1.7" : "1.05"}; margin-top:3px; }
.hero .h-sub{ color:#c9d4e6; font-size:16.5px; margin-top:2px; font-weight:500; line-height:${rtl ? "1.9" : "1.35"}; }
/* The META COLUMN. It was flex:0 0 auto — "take your max-content width and NEVER shrink",
   and its max-content width is the CHIP ROW laid out on one line. So the board badge — an
   author-written string with no length cap — silently set the whole header's column split. The
   longer the badge, the narrower the title: measured at a 794px page with a 76-char title,
   badge 0 chars -> title 66% of the hero and 3 lines; 35 chars ("reviewed GOOD") -> 44%/4
   lines; 49 -> 29%/7; 63 -> 23%/9 AND 50px of the badge hanging off the hero; 82 -> 119px off,
   past the page edge and over the chapter line. Hence: the meta column may shrink, and may
   never take more than 46% of the hero. */
.hero .h-meta{ text-align:${PAGE.oneColumn ? start : end}; font-size:14.5px; color:#c9d4e6; line-height:${rtl ? "1.9" : "1.55"};
       flex:0 1 auto; min-width:0; max-width:${PAGE.oneColumn ? "100%" : "46%"};${PAGE.oneColumn ? " margin-top:6px;" : ""} }
.hero .h-meta b{ color:#fff; }
.hero .chips{ display:flex; gap:5px; justify-content:flex-${PAGE.oneColumn || rtl ? "start" : "end"}; margin-top:5px; flex-wrap:wrap; }
/* A chip whose text cannot wrap cannot shrink, so a capped column would have overflowed
   instead. The badge wraps INSIDE its pill; overflow-wrap covers the pathological single long
   token that would otherwise still push out. */
.hero .tchip{ background:rgba(242,162,12,.17); border:1.5px solid var(--amber); color:#FFD98A;
       font-size:14px; font-weight:800; letter-spacing:.06em; padding:3px 9px; border-radius:var(--r-pill);
       max-width:100%; white-space:normal; overflow-wrap:anywhere; line-height:1.35;
       text-align:${end}; }
/* Chrome on the navy, not a surface: fill AND line are the same white the hero text is, held back
   to a wash. A fixed slate hex here had to be re-picked by hand every time the navy moved. */
.hero .tchip.plain{ background:rgba(255,255,255,.10); border-color:rgba(255,255,255,.35); color:#dbe5f3; }
.brand{ display:inline-flex; align-items:center; gap:5px; margin-top:5px; justify-content:flex-${rtl ? "start" : "end"}; }
.brand .dot{ width:8px; height:8px; border-radius:50%; background:var(--amber); }
.brand .dot.b{ background:#fff; }
.brand span{ font-weight:800; font-size:17.5px; letter-spacing:.02em; color:#fff; }

/* ── section bars (O I D A C H) ─────────────────────────────────────────── */
.bar{ display:flex; align-items:center; gap:8px; border-radius:var(--r-1); padding:4px 11px; margin:0; }
.bar .badge{ flex:0 0 auto; width:20px; height:20px; border-radius:50%; color:#fff;
      font-size:16.5px; font-weight:800; display:flex; align-items:center; justify-content:center;
      line-height:1; background:rgba(255,255,255,.22); }
.bar .nm{ font-size:17.5px; font-weight:800; letter-spacing:.02em; line-height:${rtl ? "1.8" : "1.3"}; }
.bar .mins{ margin-${start}:auto; font-size:15.5px; font-weight:800; letter-spacing:.03em; }
.bar .nm,.bar .mins{ color:#fff; }
/* THE MOVE TAG — VENDOR DIVERGENCE (bd-hlk39, SYNC 3.28). Operator: "Explanation header with
   an I Do tag on the extreme right to understand the moves". The band names the PHASE of the
   lesson; the move is what the teacher DOES inside it, so it rides the same strip as a badge
   and keeps the reading-end edge for itself. Amber over navy is not a new idea: it is the same
   pill, the same hue and the same 5.63:1 ink as the I DO tag on the worked-example box this
   bar introduces (.pri .exq .tag) — one badge family read twice, at two scales.
   The .mins + .mv rule is load-bearing: .mins already owns the edge via margin-inline-start:auto,
   and two auto margins in a flex row SPLIT the free space, which would leave the minutes
   floating mid-band. With a move present the minutes keep the auto and the pill takes the
   gap, so a bar with no move is byte-identically the bar it always was. */
.bar .mv{ flex:0 0 auto; margin-${start}:auto; background:var(--amber); color:var(--navy);
      border-radius:var(--r-pill); padding:2px 9px; font-size:14px; font-weight:800;
      letter-spacing:.08em; text-transform:uppercase; }
.bar .mins + .mv{ margin-${start}:0; }
/* The band is a SOLID block of the section's own colour — the same hue its badge already wore,
   only now carrying the band instead of a 20px disc inside it. It was a pale wash before, and it
   lost: the first thing inside Activity is a solid green "WE DO" pill, so the label outranked the
   landmark it sat under. A teacher flipping a seven-page plan for "Development" has these seven
   bands and nothing else to catch. Fill and weight only — the padding and the type sizes above are
   untouched, because the teach part renders at 99-100% of its four-page cap and one added pixel
   per section buys a fifth page. The badge stops being a second solid and becomes a translucent
   white chip, which reads on a dark navy fill and on a mid amber one alike. */
.s-o{ background:var(--s-note-ink); }
.s-w{ background:var(--band-w); }
.s-i{ background:var(--band-i); }
.s-d{ background:var(--navy); }
.s-a{ background:var(--leaf); }
.s-c{ background:var(--band-c); }
.s-h{ background:var(--mut); }
/* A BRAND-NEW CLASS NO OTHER BLOCK EMITS, so it needs no .pri gate: only the primary path asks
   for it, and a G6-12 plan that never emits it renders byte-identically. */
.s-we{ background:var(--band-we); }

.contstrip{ display:flex; align-items:baseline; gap:7px; font-size:15.5px; font-weight:800; color:var(--navy);
      border-bottom:2px solid var(--line); padding-bottom:5px; }
.contstrip span{ font-weight:600; color:var(--mut); font-size:14px; }
/* the repeated section bar on a page that opens mid-section. Same bar, muted, with the
   section's name suffixed "…continued" — so a continuation page is never an orphan. */
.bar.cont{ opacity:.9; }
.bar.cont .mins{ font-weight:600; }
/* Measure mode (pass 1). The page box is fixed-height and .pad is a flex column whose
   footer carries margin-top:auto — so a naive measurement reads that distributed free space
   as the footer's margin and over-reports every part. Releasing BOTH heights fixes that:
   a content-height flex container has no free space, so margin-top:auto resolves to 0.
   .pad MUST STAY display:flex here. Switching it to block also switched margin collapsing
   back on, and a .sec whose first .bar carries margin-top:3px and whose last .blk carries
   margin-bottom:2px then measured 5px SHORTER than it renders — 5px per section, which is
   how a page packed to 1107px came out 9-15px over and clipped. Measured, not reasoned:
   live [132,182,100,255,449] vs block-mode [132,182,97,250,444] on the G10 maths page. */
body.measuring .page{ height:auto; overflow:visible; }
body.measuring .pad{ height:auto; }
/* margin-top:auto on .foot is SLACK, not height: in the live layout it absorbs whatever the
   page has left over. So the packer must charge zero for it, not a guessed 8px.
   .mats WAS IN THIS RULE AND HAD NO BUSINESS BEING HERE (bd-c3le6). It carries no auto margin
   — grep it: its only margin-top is the sp-4 spacing class, 16px, applied like every other
   atom's. Releasing it did not cancel slack; it cancelled a real 16px the live layout charges,
   so the packer believed the materials strip was 16px shorter than it prints and any page that
   ended on it overflowed by up to one spacing step. That is d15's 3px, d10's 9px and d03's
   11px — three whole lessons discarded after five revision rounds each. Measured on d10's t6:
   +16 on this one atom, 0 on the other fifteen. */
body.measuring .foot{ margin-top:0; }
.sec{ break-inside:avoid; display:flex; flex-direction:column; gap:var(--sp-2); }
.split{ ${PAGE.oneColumn ? "display:block;" : "display:flex; gap:var(--sp-3); align-items:flex-start;"} }
.split > div{ display:flex; flex-direction:column; gap:var(--sp-2); }
${PAGE.oneColumn ? ".split > div + div{ margin-top:var(--sp-2); }" : ""}
.secrow{ ${PAGE.oneColumn ? "display:block;" : "display:flex; gap:var(--sp-3); align-items:flex-start;"} }
.secrow > .sec{ flex:1 1 0; min-width:0; }
.blk{ margin:0; }
p{ font-size:18px; }
.lbl{ font-weight:800; font-size:14px; line-height:1.35; letter-spacing:.09em; text-transform:uppercase; }
/* ONE label rule used to serve two different jobs. "Differentiation" heads a GROUP of three cards;
   "If stuck" names one of those cards. "Common mistakes and the question you ask back" heads a
   group; "What pupils write" is a leaf inside it. Printed identically, the reader has to work out
   the nesting from position alone. The .g variant is that missing level: navy ink and an amber rule
   on the INLINE-START edge. Start edge, not left — an Urdu plan puts it on the right. It is inline-
   direction geometry on purpose: a rule down the side and a little indent cost zero vertical
   pixels, and there are none to spend. Size and leading stay exactly as the leaf's, so the
   hierarchy is carried by colour and the mark, never by making one label bigger than another.
   This replaces four hand-written style="color:..." attributes at the call sites.
   NOTE: no backticks in here. This whole sheet is one template literal. */
.lbl.g{ color:var(--navy2); border-${start}:3px solid var(--amber); padding-${start}:7px; }

/* ── SLO ────────────────────────────────────────────────────────────────── */
/* The outcome box is L1 and deliberately NOT a pale role: --amber-soft is a full tone deeper than
   --s-note, and the 6px amber edge is the loudest mark on page one. It is the one thing a teacher
   must not miss, so it is allowed to outrank every note-coloured block below it. */
.slo{ background:var(--amber-soft); border-${start}:6px solid var(--amber); border-radius:var(--r-2);
      padding:8px 14px; }
.slo .lbl{ color:var(--s-note-ink); }
.slo p{ font-size:18.5px; line-height:${rtl ? "2.0" : "1.55"}; margin-top:1px; font-weight:600; color:#3a2c0a; }
.slo .src{ font-size:14.5px; color:#7d6425; margin-top:2px; font-weight:600; }
.crit{ font-size:17px; color:#6B5312; margin-top:1px; font-weight:600; }
.objhd{ display:flex; align-items:center; gap:6px; margin-top:var(--sp-2); font-size:14px; font-weight:800;
      letter-spacing:.09em; text-transform:uppercase; color:var(--s-note-ink); }
.objhd .badge{ width:18px; height:18px; border-radius:50%; background:var(--amber); color:#3a2c0a;
      font-size:14px; display:flex; align-items:center; justify-content:center; line-height:1; }
.objs{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.objs li{ font-size:18px; margin:0; }
.objs li::marker{ color:var(--amber); font-weight:800; }

/* ── warm-up ────────────────────────────────────────────────────────────── */
.wu{ display:flex; flex-direction:column; gap:var(--sp-1); }
/* A question row is a BLOCK with two floated corners, not a flex line (bd-a8veu.5). As a flex
   line the chip was flex:0 0 auto — an unshrinkable column reserved for the whole height of
   the row — so the question wrapped into a ribbon beside it and the space under the chip stayed
   blank. Worst case measured at 520px: a 372.8px chip on a 478px row left the question 70.1px
   and the row 261.4px tall. Floated, the question flows the full measure and wraps back under
   the chip: 1865.6px -> 1326.5px over the fixture's 11 rows. flow-root contains the floats so
   a row whose text is shorter than its chip cannot leak one into the next row. */
.wu .it{ display:flow-root; border:1px solid var(--s-note-line); background:var(--s-note);
      border-radius:var(--r-1); padding:3px 10px; }
.wu .n{ float:${start}; margin-${end}:9px; font-weight:800; color:var(--s-note-ink); font-size:16.5px; }
.wu .q{ font-size:18px; }
.wu .a{ color:var(--leaf); font-weight:700; }
/* L3. This tag ("revision", "recall") repeats on every row of the warm-up, so at the block label's
   own volume — 800, uppercase, tracked — a five-row warm-up printed five extra shouts in the
   margin. Sentence case at 700 is metadata a teacher reads once. Same 14px: the ladder is weight
   and case, never size, and lowercase is also the narrower of the two, so the float shrinks. */
.wu .kind{ float:${end}; margin-${start}:9px; font-size:14px; font-weight:700; letter-spacing:.02em;
      color:var(--mut); }

/* ── blocks ─────────────────────────────────────────────────────────────── */
.hook{ background:var(--navy); color:#fff; border-radius:var(--r-2); padding:9px 14px; }
.hook .lbl{ color:var(--amber); }
.hook .q{ font-size:19px; font-weight:700; line-height:${rtl ? "1.95" : "1.55"}; margin-top:3px; }
.hook .lf{ font-size:16px; color:#c9d4e6; margin-top:3px; line-height:${rtl ? "1.9" : "1.55"}; }
/* Ask, script and board are all the TEACH role, and they used to be #F5F8FC, #F7F9FC and #EFF1F4 —
   three fills nobody can tell apart, doing the job of telling them apart. What actually separates
   them is the EDGE: ask carries the solid navy rule because it is the one a teacher has to say out
   loud; the script carries the same rule held back to the hairline tone; the board is quiet grey,
   because it is a note about the wall, not about the lesson. */
.askb{ border-${start}:4px solid var(--navy2); background:var(--s-teach); border-radius:var(--r-2); padding:7px 13px; }
.askb .lbl{ color:var(--s-teach-ink); }
.askb .q{ font-size:18.5px; font-weight:700; color:var(--navy2); }
.askb .lf{ font-size:16.5px; color:var(--mut); margin-top:2px; }
.say{ border-${start}:4px solid var(--s-teach-line); background:var(--s-teach); border-radius:var(--r-2); padding:7px 13px; }
.say .lbl{ color:var(--s-teach-ink); }
.say .t{ font-size:18px; color:#173355; }
.watch{ background:var(--s-watch); border:1px solid var(--s-watch-line); border-radius:var(--r-2); padding:7px 12px; }
.watch .lbl{ color:var(--s-watch-ink); }
.watch .t{ font-size:18px; color:#5a2f18; }
/* VENDOR DIVERGENCE (SYNC §3.16). WRITE ON THE BOARD IS NOT ON THE SURFACE LADDER.
   Operator: *"the write on the board should be rendered, it cant be in html? heading colour anf
   formatting should be differenyt / its a block of text that should show clearly how it should be
   ordered rather than give a script of what to draw and how"*.

   Every other block on the page is a tinted fill under a bare coloured label -- that is the ladder,
   and it is what made this one read as one more note to skim. This block is the only one that
   describes a PHYSICAL OBJECT in the room, so it is drawn as one, inverted on both axes the ladder
   uses:
     FILL   white inside a 2px navy frame, where the ladder is a tint inside a 1px hairline. It is
            the surface she writes ON, so it takes the colour of a surface, not of a category.
     LABEL  gold on a filled navy bar, where every other .lbl in the sheet is bare text sitting on
            the block's own fill. No other label in the document has a bar, which is the difference
            visible from across the room -- and it is the one place --board-gold may print.
   The ORDER is the numbered gutter down the start edge: a chip is a panel's place in the build, so
   the board shows its own order instead of a sentence describing one. The two columns inside a panel
   align every gloss, which is what turns a word wall back into a word LIST.

   This block therefore does move padding and border width, which the ladder forbids -- that rule
   exists so a RECOLOUR cannot cost a page, and this is a commissioned re-shaping, not a recolour.
   Its page cost was measured rather than assumed, over all 38 lessons of the G4 Ch9 corpus and both
   trees: teach 259 -> 268 phone pages, +9, +3.5%. Ten lessons grew by one; one LOST one, because
   dropping the draw script (see boardPlanAtoms) bought back more than the taller board cost. Full
   working in SYNC.md §3.16. */
.board{ background:#fff; border:2px solid var(--navy); border-radius:var(--r-2); padding:0; }
.board .lbl{ color:var(--board-gold); background:var(--navy); display:block; padding:2px 13px; }
.board .t{ font-size:18px; color:#2b3341; padding:6px 13px 7px; }
.board .bd{ padding:5px 13px 6px; }
.board .btitle{ font-weight:800; font-size:18px; color:var(--navy); text-transform:uppercase;
   letter-spacing:.04em; border-bottom:1px solid var(--line); padding-bottom:2px; }
.board .bp{ display:grid; grid-template-columns:18px minmax(0,1fr); gap:0 7px; margin-top:4px; }
/* bd-i44jn: the joint between two boards. Centred because it belongs to neither column. */
.board .bcon{ text-align:center; font-weight:800; font-size:15px; color:var(--warn);
  letter-spacing:.04em; margin-top:5px; }
/* bd-vxmj1: unitless, per R6 -- a px leading does not survive scaleTypeCss, and the
   law bans it outright. 1.5 is the same 18px box at this font-size. */
.board .bn{ background:var(--navy); color:#fff; font-size:12px; font-weight:800; text-align:center;
   line-height:1.5; border-radius:var(--r-pill); }
.board .bhd{ font-weight:800; font-size:16.5px; color:var(--navy2); text-transform:uppercase;
   letter-spacing:.05em; }
/* NOTHING RUNS OFF THE SHEET -- VENDOR DIVERGENCE (SYNC §3.19), bd-59vvo. A max-content track
   sizes the term column to the LONGEST term and refuses to shrink, and a bare 1fr floors at the
   gloss's own min-content -- so a board
   whose terms are whole sentences ("Jojo _____ to eat pizza on Fridays.") laid itself out wider
   than the page and printed the entire gloss column off the right edge. fit-content(50%) caps the
   term column and lets it wrap; minmax(0,1fr) lets the gloss shrink to the space actually left.
   Both tracks together can now never exceed the panel, which is the property a board must have:
   this is the one block the teacher copies onto a real board, so a clipped column is a lost one. */
.board .bb{ display:grid; grid-template-columns:fit-content(50%) minmax(0,1fr);
   gap:1px 10px; font-size:18px; }
.board .bk{ font-weight:800; color:var(--navy); }
.board .bg{ color:#2b3341; }
.board .bx{ grid-column:1 / -1; color:#2b3341; }
.kwrow{ display:flex; flex-wrap:wrap; gap:var(--sp-1); margin-top:var(--sp-1); }
/* A key word sits on the grey key-words card, so the chip goes WHITE: a pale chip on a pale card is
   not a chip. White is the page, not a role, which is why it stays a literal here.

   IT IS A ROW, NOT A PILL (bd-3wjme). Operator, on grade 8 history: "vocab boxes not fitting
   properly". This was --r-pill. A 999px radius is correct at exactly ONE line height. A humanities
   key word's meaning is a clause — "a system where Muslim voters choose Muslim representatives in a
   vote held only among Muslims" — so the entry wraps to four lines, the radius clamps to half the
   box height, and each end becomes a full semicircle that curves away from the text it is supposed
   to enclose. The first and last lines run out past the border. That is the "not fitting".

   This is a LOOK fix and only a look fix. Measured at the card's real 424px inner column, on the
   two entries off her page 1: 250.8px before, 250.8px after. Identical, and it was always going to
   be — border-radius does not touch line boxes, so the curve never narrowed the text column. Do not
   reach for this rule to win a page.

   A grow (flex:1 1 auto) was tried here and REMOVED after measuring: it buys nothing on a long
   meaning, which already fills its line on its own, and it forces four two-word meanings to one per
   line instead of packing them. Leave the entry sized to its content and let .kwrow do the wrapping.
   No min-width:0 either, on purpose: this box WRAPS, so its automatic min size is the longest word,
   and letting it shrink past that would push that word outside the border. */
.kw{ background:#fff; border:1px solid var(--s-quiet-line); border-radius:var(--r-1);
      padding:2px 11px; font-size:16.5px; }
.kw b{ color:var(--navy2); font-weight:800; }
.kw i{ color:var(--mut); font-style:normal; }
.kp{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.kp li{ font-size:18px; margin:0; }
.kp li::marker{ color:var(--navy2); }
/* VENDOR DIVERGENCE (SYNC 3.26), bd-z4xkl -- THE BIG IDEA. A TEACH role on the surface ladder (blue), not a bespoke colour:
   it is teacher-facing explanation, the same family as ASK and SAY, and it reads as the thing
   to understand before the amber I DO model directly beneath it. */
.bigidea{ border:1px solid var(--s-teach-line); border-${start}:4px solid var(--navy2);
  background:var(--s-teach); border-radius:var(--r-2); padding:7px 13px; }
.bigidea > .lbl{ color:var(--s-teach-ink); }
.bigidea .bip{ margin:var(--sp-1) 0 0; font-size:18px; }
.bigidea .bil{ display:block; font-size:15.5px; font-weight:800; letter-spacing:.05em;
  text-transform:uppercase; color:var(--s-teach-ink); }
/* VENDOR DIVERGENCE (SYNC 3.27), bd-c74u3 -- KIE.AI'S PEDAGOGICAL-HEART TREATMENT, PRIMARY ONLY.
   Operator, on the first G1-5 render beside a kie.ai plan: *"the pedagogical heart was rendered
   differently in kie.ai, can we take that formatting?"* -- "pedagogical heart" is kie.ai's own
   'role' for this block. It prints the three paragraphs UNLABELLED under a lightbulb card; the
   rule above prints three uppercase lines over ~80 words, so on a primary page three of the
   block's ~7 lines were furniture -- on the page that same operator had called "too much text
   dump". The label is kept and run INLINE as a lead-in: the same page economy without losing
   the signpost, and clause 2 of primary-big-idea.test.js (the label prints, from LABELS,
   never hardcoded in the renderer) still holds. G6-12 is untouched -- there the block sits on
   a denser page whose reader scans for the sub-heading, and the labelled-blank law leans on
   those labels standing clear of the prose. NOT taken: kie.ai's per-subject hue (bd-z4xkl put
   this surface on the TEACH rung of the ladder deliberately, and that is a decision about the
   whole ladder, not this block) and its fixed ~22% share of page 1 (our page is flow-laid, and
   a height floor on one block is how every other block gets squeezed). */
.pri .bigidea .bil{ display:inline; letter-spacing:0; text-transform:none; }
/* ASCII colon, not an em dash: the separator is the one character here that no LABELS entry
   supplies, so it has to be one that cannot be missing from the page's own font subset. */
.pri .bigidea .bil::after{ content:":\u00a0"; }
/* Drawn, not a glyph -- the same reason the .mi checkbox is drawn. A lightbulb emoji is exactly
   the codepoint that lands as a tofu box on a teacher's phone. */
.bigidea .bimark{ width:1em; height:1em; vertical-align:-.13em; margin-${end}:7px;
  fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round;
  stroke-linejoin:round; }
/* bd-a8veu.21 — N cases that share attributes, as a shape instead of as repeated sentences.
   The sizes here are SOURCE sizes: every font-size in this sheet is multiplied by TYPE_SCALE
   (1.1667) on the way out, so 18px emits at 21px = BODY_FLOOR_PX, and 14px emits at 16.33px =
   CHIP_FLOOR_PX. Do NOT shrink them to buy height. The renderer's in-page type probe checks
   BODY_SEL/CHIP_SEL, and neither list matches td or th, so a table can silently ship below the
   floor — the first version of this block did exactly that, and its -42.5% "win" was small type
   beating big type, not a table beating prose.
   THIS BLOCK IS FOR SCANNABILITY, NOT FOR PAGE COUNT, and the numbers here are the ones that
   survived content-matching both sides. -17.7% was the second artefact: that rig quietly dropped a
   column of facts from the table while leaving them in the prose baseline. Matched fact-for-fact,
   a 3-column table is height-NEUTRAL (-2.5% on a real grade-6 key-points list). It saves height
   only when every cell is one or two words (-23% to -25%) and LOSES at three or four words
   (+13.1%) or at sentence length (+11.7%). The mechanism is a row is as tall as its tallest cell,
   so one wrapping cell costs the whole row a line: at this 478px column a 3-column row holds one
   line to ~14 characters per cell, a 2-column row to ~24. Past that the table is the taller shape.
   A 4th column is +13.1% WORSE than the prose even before that (schema caps columns at 3).
   table-layout:auto, measured: the columns genuinely want different widths — a one-word TYPE
   column beside a longer WHERE column — and auto beat fixed 728.9 to 785.6. */
.tbl{ border-collapse:collapse; width:100%; margin-top:var(--sp-1); table-layout:auto; }
/* L3. A header row already announces itself by sitting on top of a ruled column of data; it does
   not also need caps, tracking and the block label's weight. Demoted, the eye goes to the CELLS,
   which is the whole reason the table block exists. */
.tbl th{ font-size:14px; font-weight:700; letter-spacing:.02em;
  text-align:${start}; color:var(--mut); padding:3px 7px; border-bottom:1px solid var(--s-quiet-line); }
.tbl td{ font-size:18px; line-height:1.35; padding:5px 7px; vertical-align:top;
  text-align:${start}; border-bottom:1px solid var(--line); }
.tbl tbody tr:nth-child(odd){ background:var(--s-quiet); }
.tbl td:first-child{ font-weight:700; color:var(--navy2); }
/* The two worked examples are a pair with different jobs — I DO is modelled at the board, WE DO is
   solved with the class — and the we-do box already said so, tinted green to match its green tag.
   The i-do box carried an AMBER tag on a grey hairline, so the pair read as "one coloured box and
   one unstyled box" rather than as two steps of a gradual release. It now wears its own tag's
   amber on the same 1px border and the same padding: colour only, no height. */
.exq{ border:1px solid var(--s-note-line); border-radius:var(--r-2); padding:6px 11px; background:var(--s-note); }
.exq.we{ border-color:var(--s-do-line); background:var(--s-do); }
/* L1 and staying loud: I DO / WE DO is the gradual-release step, the one badge on the page that
   names WHO is holding the pen. Solid fill, caps, tracked. */
.exq .tag{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.08em;
      text-transform:uppercase; padding:3px 10px; border-radius:var(--r-pill); color:#fff; background:var(--amber); }
.exq.we .tag{ background:var(--leaf); }
.exq h4{ font-size:18px; color:var(--navy); margin-top:var(--sp-1); line-height:${rtl ? "1.85" : "1.45"}; }
.exq .prompt{ font-size:18px; margin-top:var(--sp-1); }
.exq .setup{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.exq .setup li{ font-size:18px; margin:0; }
.exq ol{ margin:var(--sp-1) 0 0; padding-${start}:21px; }
.exq ol li{ font-size:18px; margin:0; }
.exq .res{ margin-top:var(--sp-1); font-size:18px; color:var(--leaf); font-weight:700; }
/* THE BOX CLOSES ON ITS CHECK (SYNC §3.29). One hairline in the box's own family, so the
   check reads as part of this card and not as a new one: a full border would make it a
   second box, and no rule at all would make it a fourth line of script. The label sits on
   its own line at the .tag scale, which is the size the teacher already scans for. */
.exq .cfu{ margin-top:var(--sp-1); padding-top:5px; border-top:1px solid var(--s-note-line);
  font-size:18px; line-height:1.4; }
.exq.we .cfu{ border-top-color:var(--s-do-line); }
.exq .cfu .cl{ display:block; font-size:14px; font-weight:800; letter-spacing:.08em;
  text-transform:uppercase; color:var(--s-note-ink); }
.exq.we .cfu .cl{ color:var(--s-do-ink); }
/* A SPLIT EXAMPLE, PAINTED AS ONE CARD (SYNC 3.18). The pieces butt at sp-0, so the seam is
   only the 2px gap .scr already draws between two turns -- 2px of amber against amber. Each
   piece opens the edge it shares with the next and zeroes the padding there. */
.exq.pc{ border-radius:0; }
.exq.pc-a{ border-bottom:0; border-radius:var(--r-2) var(--r-2) 0 0; padding-bottom:0; }
.exq.pc-m{ border-top:0; border-bottom:0; padding-top:2px; padding-bottom:0; }
.exq.pc-z{ border-top:0; border-radius:0 0 var(--r-2) var(--r-2); padding-top:2px; }
/* ...AND SAYS SO WHEN A PAGE BREAK LANDS ON A SEAM. .foot is every page's last child, so a
   piece sitting second-to-last is the one the break cut; a piece following the continuation
   strip or a repeated section bar is the one it resumed on. A dashed edge means "this card
   goes on"; a card that genuinely ended still closes solid, because .pc-z is excluded.
   The dash is the SURFACE'S OWN INK, not its hairline: --s-note-line on --s-note is amber on
   amber, and the first render of this showed the card simply stopping above the footer.
   THE SEAM COSTS 5px AND THE PACKER DOES NOT KNOW IT (bd-sor95). Which piece lands on a page
   edge is decided after the atoms are measured, so whatever these rules add is spent on a page
   already full: 2px of border and 3px of padding, and no more. */
.pad > .exq.pc:not(.pc-z):nth-last-child(2){
  border-bottom:2px dashed var(--s-note-ink); border-radius:0 0 var(--r-2) var(--r-2); padding-bottom:3px; }
.pad > .contstrip + .exq.pc:not(.pc-a),
.pad > .bar + .exq.pc:not(.pc-a){
  border-top:2px dashed var(--s-note-ink); border-radius:var(--r-2) var(--r-2) 0 0; padding-top:3px; }
.pad > .exq.we.pc:not(.pc-z):nth-last-child(2){ border-bottom-color:var(--s-do-ink); }
.pad > .contstrip + .exq.we.pc:not(.pc-a),
.pad > .bar + .exq.we.pc:not(.pc-a){ border-top-color:var(--s-do-ink); }

/* ══ THE THREE MOVES, THREE HUES AND THREE BOXES -- VENDOR DIVERGENCE (bd-f6opy, SYNC 3.23) ══
   OPERATOR: *"what about all the moves being of different colours?"*, and on the option costed
   for her: *"All three get the same shape: solid pill inside its own tinted box."*

   WHAT WAS THERE. I DO was a solid amber pill in an amber .exq box; WE DO a solid green pill in
   a green .exq.we box; YOU DO a PALE-GREEN OUTLINE pill and no box at all -- .pr declares
   neither a border nor a background, so the one move a teacher hunts for was the only one with
   no surface. And both halves of activity sat under the same green .s-a band, across five pages.

   WE DO moves onto the --s-teach blue family so the release reads amber -> blue -> green. FILL
   AND HAIRLINE ONLY: no padding and no border WIDTH changes here, so the repaint costs zero
   vertical pixels and every page below it stays where it was.

   EVERY RULE IS UNDER .pri, because .exq.we and .pr are both surfaces G6-12 emits. .pri goes on
   <html> for grade 1-5 alone, so the grade 9 control renders byte-identically. */
.pri .exq.we{ background:var(--s-teach); border-color:var(--s-teach-line); }
/* THE NAME IS LEGIBLE ON ITS OWN FILL, which is not the same as "the name is white". I DO's
   amber carries white at 2.11:1 -- a 14px bold tracked label, so WCAG asks 4.5 of it -- and it
   has done since v9. WE DO's blue carries white at 6.73:1 and YOU DO's leaf at 4.80:1, so those
   two keep the ink they had and only I DO's changes, to the house navy, at 5.63:1. Gated on
   .pri, so a G6-12 pill is the pill it always was. */
.pri .exq .tag{ color:var(--navy); }
.pri .exq.we .tag{ background:var(--band-we); color:#fff; }
/* THE RESULT LINE TAKES ITS OWN BOX'S FAMILY. .exq .res is leaf green everywhere, which read as
   "this is the answer" back when green meant nothing else. Now green means YOU DO, so a green
   sentence inside the amber I DO card or the blue WE DO card says the wrong move in the middle of
   the right one -- the same confusion as the shared band, moved down into the box. Each card's
   result now prints in the card's own ink; YOU DO's answers stay leaf green, because there green
   IS the move. */
.pri .exq .res{ color:var(--s-note-ink); }
.pri .exq.we .res{ color:var(--band-we); }
.pri .exq.we .cfu{ border-top-color:var(--s-teach-line); }
.pri .exq.we .cfu .cl{ color:var(--band-we); }
.pri .pad > .exq.we.pc:not(.pc-z):nth-last-child(2){ border-bottom-color:var(--s-teach-ink); }
.pri .pad > .contstrip + .exq.we.pc:not(.pc-a),
.pri .pad > .bar + .exq.we.pc:not(.pc-a){ border-top-color:var(--s-teach-ink); }

/* YOU DO GETS THE BOX IT NEVER HAD -- AND IT IS *ONE* BOX. A practice list is already split one
   item per atom (24 of them in the longest corpus lesson), so a frame on .pr alone would draw 24
   boxes stacked with rhythm showing between them. It reuses .exq's split-card idiom (SYNC 3.18)
   exactly: the pieces open the edge they share, zero the padding there, and butt at sp-0, so N
   pieces paint what one card paints.

   THE HEIGHT IS PAID FOR ONCE, NOT PER ITEM. pc-m/pc-z take padding-top:4px, which is precisely
   the sp-1 rhythm margin the item atoms used to carry and no longer do -- so the only net cost
   over a whole list is pc-a's 6px top, pc-z's 6px bottom and the two hairlines: 14px, the same
   14px a single un-split box would have cost. The 11px side padding narrows the text column by
   22px, which is the real price and is measured over the corpus, not guessed. */
.pri .blk.pr{ border:1px solid var(--s-do-line); background:var(--s-do);
      padding:6px 11px; border-radius:var(--r-2); }
/* A list of one or two items never splits (see blockAtoms), so the frame lives on the block and
   the seam classes below only ever OPEN it. Same specificity, declared after: .pc wins. */
.pri .pr.pc{ border-radius:0; }
.pri .pr.pc-a{ border-bottom:0; border-radius:var(--r-2) var(--r-2) 0 0; padding-bottom:0; }
.pri .pr.pc-m{ border-top:0; border-bottom:0; padding-top:4px; padding-bottom:0; }
.pri .pr.pc-z{ border-top:0; border-radius:0 0 var(--r-2) var(--r-2); padding-top:4px; }
/* ...and says so when a page break lands on a seam -- see the .exq.pc pair above for the whole
   argument. The ink is the surface's own, --s-do-ink on --s-do: green on green. */
.pri .pad > .pr.pc:not(.pc-z):nth-last-child(2){
  border-bottom:2px dashed var(--s-do-ink); border-radius:0 0 var(--r-2) var(--r-2); padding-bottom:3px; }
.pri .pad > .contstrip + .pr.pc:not(.pc-a),
.pri .pad > .bar + .pr.pc:not(.pc-a){
  border-top:2px dashed var(--s-do-ink); border-radius:var(--r-2) var(--r-2) 0 0; padding-top:3px; }
/* The pill becomes the solid form of the box it sits in, like the other two moves. */
.pri .pr .tag{ background:var(--leaf); color:#fff; border-color:var(--leaf); }
/* VENDOR DIVERGENCE (SYNC §3.17) -- the teacher's script, one row per turn. See script().

   ONLY THE EXCEPTIONS ARE MARKED. 682 of the 954 turns this renderer is handed are plain
   speech -- 71.5%. Boxing them would spend a border on five rows in seven and leave the eye
   nothing to land on, which is the text dump again with lines drawn on it. So a
   SAY row is bare text in quotes and costs nothing, and the five kinds that are NOT her
   voice -- the action, the question, the frame, the sum, the named routine -- each carry one
   mark. Fill, line and case only (the v9.4 surface ladder): no new size, no new font.

   The quote marks are HERE and not in the string, because the same string is what Stage E
   reads aloud and what the WhatsApp body prints, and neither wants punctuation furniture. */
.scr{ display:flex; flex-direction:column; gap:2px; margin-top:var(--sp-1); }
.tn{ display:flow-root; font-size:18px; line-height:${rtl ? "1.85" : "1.4"}; }
.tn .tx{ display:inline; }
/* L3. The head is a column label, not content: it appears only on a block whose script
   actually supplies an answer, and it names the two edges once. */
.tn.hd{ display:flex; justify-content:space-between; align-items:baseline; font-size:14px;
      font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--mut);
      border-bottom:1px solid var(--line); padding-bottom:2px; margin-bottom:2px; }
.tn.hd .rp{ margin:0; text-align:${end}; }
/* Her words. The only kind that gets quotes, which is how the row reads as speech. */
.tn.k-say .tx::before{ content:"${rtl ? '‘' : '“'}"; color:var(--mut); }
.tn.k-say .tx::after{ content:"${rtl ? '’' : '”'}"; color:var(--mut); }
/* The action is a stage direction, not a line to read out. Caret, do-green ink, no quotes. */
.tn.k-do{ color:var(--s-do-ink); font-weight:600; }
.tn.k-do .tx::before{ content:"${rtl ? '◂' : '▸'}\u00a0"; }
/* The question is the interaction point -- the row she stops on. Teach-blue rule at the
   reading edge of the text, answer in leaf green underneath (same pairing as .pr). */
.tn.k-ask{ border-${start}:2px solid var(--s-teach-line); padding-${start}:7px; }
.tn.k-ask .tx{ font-weight:700; color:var(--navy2); }
/* A frame is a sentence the CLASS completes, so the row is the card she holds up: white
   inside the tinted box, dashed because the blank is the point. */
.tn.k-frame{ background:#fff; border:1px dashed var(--s-quiet-line); border-radius:var(--r-1);
      padding:2px 9px; color:var(--navy2); font-weight:600; }
/* Digits line up or the sum is harder to read off the page than to do in your head. */
.tn.k-calc{ background:#fff; border:1px solid var(--line); border-radius:var(--r-1);
      padding:2px 9px; font-variant-numeric:tabular-nums; }
/* A named procedure (CUBES is spelled out 13 times over the corpus) is ONE thing she already
   knows, so its steps stay inside one box instead of reading as four unrelated turns. */
.tn.k-routine{ background:#fff; border:1px solid var(--s-quiet-line); border-radius:var(--r-1);
      padding:3px 10px; }
.tn .rn{ display:block; font-size:14px; font-weight:800; letter-spacing:.08em;
      text-transform:uppercase; color:var(--s-quiet-ink); }
.tn .rs{ margin:0; padding-${start}:19px; }
.tn .rs li{ font-size:18px; margin:0; }
/* THE ANSWER IS ON THE ROW, NOT IN A COLUMN -- 7 of the 954 rendered turns supply one, and a
   column would narrow all 954 to serve seven. It hangs at the reading edge under its turn. */
.tn .rp{ margin-top:1px; text-align:${end}; }
.tn .pl{ display:inline-block; font-size:16.5px; font-weight:700; color:var(--leaf);
      background:#fff; border:1px solid var(--s-do-line); border-radius:var(--r-pill);
      padding:0 8px; margin-${start}:5px; }
/* An ASK the script does not answer gets a RULED SPACE, not a guess: the plan does not know
   what this class will say, and a proxy printed here is a lie in the one place she is about
   to check a child against. */
.tn .wait{ display:inline-block; width:108px; border-bottom:1px dashed var(--s-do-line);
      height:15px; vertical-align:-2px; }
.tn .pref{ float:${end}; margin-${start}:8px; font-size:14px; font-weight:700; color:var(--mut);
      background:#fff; border:1px solid var(--line); border-radius:var(--r-1); padding:0 5px; }
.pr .tag{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.08em;
      text-transform:uppercase; padding:3px 10px; border-radius:var(--r-pill); background:var(--s-do);
      color:var(--s-do-ink); border:1px solid var(--s-do-line); }
.pr .items{ margin-top:var(--sp-1); display:flex; flex-direction:column; gap:var(--sp-2); }
/* VENDOR DIVERGENCE (SYNC §3.16) -- see practiceItem for why the row split. The answer row is
   indented to the question's text column and hung off a hairline, so the pair reads as one item
   with two parts rather than as two items. */
.pr .it{ display:flow-root; }
.pr .qr{ display:flow-root; }
.pr .n{ float:${start}; margin-${end}:8px; font-weight:800; color:var(--navy2); font-size:16.5px; min-width:17px; }
.pr .q{ font-size:18px; }
.pr .ref{ float:${end}; margin-${start}:8px; font-size:14px; font-weight:700; color:var(--mut);
   background:#fff; border:1px solid var(--s-do-line); border-radius:var(--r-1); padding:0 5px; }
.pr .arow{ margin-${start}:25px; margin-top:2px; border-${start}:2px solid var(--s-do-line); padding-${start}:7px; }
.pr .al{ font-size:14px; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
   color:var(--s-do-ink); margin-${end}:6px; }
.pr .a{ color:var(--leaf); font-weight:700; font-size:18px; }
/* L3 — same demotion as .wu .kind, same reason: one per practice item, several per page. */
.pr .tier{ float:${end}; margin-${start}:8px; font-size:14px; font-weight:700; letter-spacing:.02em;
      color:var(--mut); }
.se{ ${PAGE.oneColumn ? "display:block;" : "display:flex; gap:var(--sp-3);"} }
${PAGE.oneColumn ? ".se > div + div{ margin-top:var(--sp-2); }" : ""}
.se > div{ flex:1 1 0; border-radius:var(--r-2); padding:7px 13px; border:1px solid; }
.se .sup{ background:var(--s-teach); border-color:var(--s-teach-line); }
.se .sup .lbl{ color:var(--s-teach-ink); }
.se .ext{ background:var(--s-do); border-color:var(--s-do-line); }
.se .ext .lbl{ color:var(--s-do-ink); }
.se p{ font-size:18px; margin-top:var(--sp-1); }

/* ── figures ────────────────────────────────────────────────────────────── */
/* --fig-wide is the FIGURE-WIDENING REPAIR (bd-oak77.14). A full-width diagram whose smallest
   label misses the 13.5px floor by a hair used to LOSE THE WHOLE LESSON — on 2026-09-06 the first
   Urdu tap on production died on 13.25px against 13.5px, on a figure that was already in a
   full-width row so the renderer's own advice ("give it a full-width row") had nothing left to
   give. The 14px it wanted was sitting in this rule: the figure's own padding and border, and
   then the page's 21px side margin.

   So the figure grows symmetrically by the SMALLEST amount that clears the floor, and never past
   the paper. It is a negative inline margin rather than zeroing the padding and border, because
   the frame is part of the figure's identity and dropping it is a visible change, where widening
   the border box is not. The property is absent on every figure that fits, so this rule is a no-op for them.

   NOTE FOR ANYONE EDITING THIS STYLESHEET: it lives inside a JS template literal. No backticks. */
figure.dg{ border:1.5px solid var(--line); border-radius:var(--r-2); padding:9px 11px; break-inside:avoid;
      margin-left:calc(-1 * var(--fig-wide, 0px)); margin-right:calc(-1 * var(--fig-wide, 0px)); }
/* A crop lifted from the textbook wears the teach hairline, so "this came from the book" is a
   colour the teacher can learn once. Width unchanged — the 1.5px frame is load-bearing geometry
   here (see --fig-wide above), so only its colour moves. */
figure.dg.book{ border-color:var(--s-teach-line); }
figure.dg .ftop{ display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--sp-1); gap:8px; }
/* NOT uppercase. The badge carries a human label now ("Equation", "Force diagram"), and
   uppercasing a human label is what made "chem_equation" read as the enum CHEM_EQUATION in the
   first place. Nastaliq gets no tracking either — letter-spacing breaks Urdu joining. */
figure.dg .ftag{ background:var(--navy); color:#fff; font-size:14px; font-weight:800;
      letter-spacing:${rtl ? "0" : ".02em"};
      padding:3px 10px; border-radius:var(--r-pill); }
figure.dg .fsrc{ color:var(--leaf); font-weight:800; font-size:14px; }
/* NO blanket max-height on an SVG. An SVG with a viewBox scales by min(boxW/vbW, boxH/vbH),
   so a fixed 118px clamp did not "fit" a diagram — it SHRANK it, and every label inside it,
   to whatever fraction 118px was of its natural height. That is what put mindmap, punnett and
   grid labels at ~3px on a phone: the clamp, not the diagram types' own font sizes. Each
   figure now carries its OWN computed max-height (the slot in which its smallest label still
   renders >= 13.5px).

   A raster book crop cannot be measured that way -- its labels are baked pixels, not text nodes
   the sizer can find -- so it keeps a flat clamp. But the clamp was 200px on the reasoning that
   "a raster has no vector type to crush", and that reasoning was wrong: downscaling crushes a
   crop's printed labels exactly as it crushed the vector ones. Measured on the 2026-09-05
   representative batch (bd-8lifl), six crops across five lessons were unreadable at their own
   labels -- the Grade 6 Geography world map printed at under half the column with ~2.5pt
   labels, on a figure whose content was otherwise correct. CROP_MAX_H is the lever; raising it
   costs paper, not lessons (an over-cap document still delivers, bd-vjk68). */
figure.dg svg{ display:block; width:100%; height:auto; max-height:var(--fig-h, none); margin:0 auto; }
figure.dg img{ display:block; width:100%; height:auto; max-height:${CROP_MAX_H}px;
      object-fit:contain; margin:0 auto; }
figure.dg figcaption{ text-align:center; font-size:15.5px; color:var(--mut); font-weight:600; margin-top:var(--sp-1);
      line-height:${rtl ? "1.9" : "1.5"}; }
figure.dg .legend{ background:var(--s-teach); border-radius:var(--r-2); padding:6px 11px; margin-top:var(--sp-2); font-size:16.5px; }
figure.dg .legend .lbl{ color:var(--s-teach-ink); display:block; margin-bottom:2px; }
.mathb{ background:var(--s-do); border:1px solid var(--s-do-line); border-radius:var(--r-2); padding:8px 12px; line-height:1.45;
      text-align:center; }
.mathb .katex{ font-size:1.24em; }
.mathb figcaption{ font-size:15.5px; color:#3F6B53; margin-top:2px; }
/* Maths and chemistry are ALWAYS left-to-right, even inside an RTL page. Without
   BOTH direction:ltr and unicode-bidi:isolate, Chrome reorders a display equation under
   dir=rtl and "\ce{C + O2 -> CO2}" paints as "2C + O 2 <- CO". Verified on the Urdu
   sample: the equation was mirrored before this rule and correct after.
   unicode-bidi:isolate alone is NOT enough, and direction:ltr alone is NOT enough. */
.katex, .katex-display, .katex *{ direction:ltr; unicode-bidi:isolate; }
.katex-display{ text-align:center; }
/* Latin runs inside Urdu prose — element symbols, SLO codes, page numbers — need the same
   isolation or the surrounding RTL run swallows their punctuation. */
${rtl ? ".katex-html, .mathb{ text-align:center; }" : ""}
.katex{ font-size:1.03em; }
.tex-err{ color:#9B2C2C; font-weight:700; }

/* ── v9 furniture ───────────────────────────────────────────────────────── */
/* The sequence strip (spec §5): where this LP sits, what is next, and the next checkpoint.
   It rides directly under the hero because "where am I in the chapter" is the first thing a
   teacher asks of a plan she did not write.
   It flows as TEXT, not as a row of boxes: a flex container makes every child atomic, so a
   phrase that does not fit jumps to the next line whole and leaves the rest of its line blank —
   and an arrow, being a child of its own, gets stranded on a line by itself (bd-a8veu.2). In
   ordinary inline flow the phrases wrap word by word and pack continuously. The arrow's gap is
   PADDING rather than a space, so there is no break opportunity between a phrase's last word
   and the arrow that terminates it.

   Each leg then takes a LINE OF ITS OWN (bd-a8veu.15). Operator: "the current and next and
   checkpoint statements should be on new lines, like a new paragraph." They are four independent
   facts — where she was, what she is teaching, what follows, when it is assessed — and a teacher
   scanning for today's lesson should not have to read a sentence to find it.

   The blocks are made with a DIRECT-CHILD combinator, and that is load-bearing: .arrow is nested
   inside a leg, and a display:block reaching it would make it a box of its own again, which is
   precisely the stranding bd-a8veu.2 removed. Within its own line a leg is still ordinary text
   and still wraps word by word.
   (No backticks anywhere in this sheet: the whole stylesheet is one JS template literal, and a
   backtick in a comment ends it. See bd-a8veu.19 for the sibling trap.) */
.seq{ background:var(--s-quiet); border:1px solid var(--s-quiet-line); border-radius:var(--r-2); padding:5px 12px;
      font-size:16px; line-height:1.5; color:var(--mut); }
.seq > span{ display:block; }
.seq > span + span{ margin-top:3px; }
.seq b{ color:var(--navy2); font-weight:800; }
.seq .now{ color:var(--navy); font-weight:800; }
.seq .arrow{ color:var(--amber); font-weight:800; padding:0 5px; }
/* An objective's own SLO code — spec §3 O wants one PER OBJECTIVE, not one per plan. */
.slocode{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.05em; color:var(--s-note-ink);
      background:rgba(242,162,12,.20); border-radius:var(--r-pill); padding:1px 8px; margin-${start}:6px; white-space:nowrap; }
.bythe{ font-size:17px; color:#6B5312; margin-top:2px; font-weight:600; }
/* Development's textbook citation. Reviewer sign-off 7: no page, no pass.
   L3: it appears beside every development step, and "Textbook page 63" is an address, not a
   heading. Sentence case at 700 keeps it findable without letting it compete with the step. */
.cite{ display:inline-block; font-size:14px; font-weight:700; letter-spacing:.01em;
      color:var(--s-teach-ink); background:var(--s-teach); border-radius:var(--r-pill); padding:2px 9px; }
/* THE RESOURCES CARD — page 1's at-a-glance panel (bd-a8veu.6). Operator: "the 1st page
   quickly tells the teacher where they are at, what they are teacing, the SLO, the resources,
   videos and key words of this lesson." The hero says where, the sequence strip says what is
   next, the outcome box says the SLO; this box says what she has to have in her hand. Its
   three rows were previously three different places in the document — the video here, the
   materials folded into the muted italic pacing sentence at the very END of the teach part,
   and the key words mid-page inside the Introduction.
   ONE box, not three: each row was already its own bordered strip or labelled block, so
   collapsing them into one panel costs one border instead of three and reads as one answer to
   one question.

   FOUR BLOCKS, NOT FOUR ROWS (bd-a8veu.16). Operator: "Materials, Pacing and Key words should be
   spaced as their own blocks on page 1, with slightly different colours and formats to hold the
   eye like Video does." Collapsing the three into one panel was the right call for PLACEMENT and
   the wrong one for READING: four facts of four different kinds — what to bring, how long it
   takes, what the words mean, what to play — arrived as four undifferentiated rows, and only the
   video, which had kept its icon and its amber link, was findable at a glance. He is naming the
   video as the standard the other three should meet.

   So each of the four takes its own icon and its own pale tint, and the panel stops drawing a box
   of its own: a box of boxes reads as clutter and spends a border to say nothing. The tints are
   deliberately CLOSE to one another — "slightly different", his word — so page 1 reads as one
   card of four parts rather than four unrelated widgets. Radius, padding and the icon gutter are
   shared for the same reason; only fill and label colour vary.

   The panel is still the ATOM, so nothing about pagination moves: the four travel together and
   still land on page 1. */
.rescard{ display:flex; flex-direction:column; gap:var(--sp-1); }
.rescard > div{ font-size:16.5px; border-radius:var(--r-2); padding:6px 11px;
      display:flex; gap:8px; align-items:baseline; }
.rescard .ico{ flex:0 0 auto; }
.rescard .lbl{ font-weight:700; flex:0 0 auto; }
/* The four tints are now the four ROLES, re-derived rather than flattened — bd-a8veu.16 asked for
   four different colours and it still gets four, but each one is a colour that means the same
   thing everywhere else in the plan. Materials is what the class DOES with its hands (do/green),
   pacing is the teacher's own plan (teach/blue), key words are reference (quiet/grey — which also
   retires the page's lone purple, a hue used exactly once and standing for nothing), and the video
   is an offer (note/amber, unchanged, because it is the one the operator held up as the standard). */
.rmat{ background:var(--s-do); border:1px solid var(--s-do-line); }
.rmat .lbl{ color:var(--s-do-ink); }
.rpace{ background:var(--s-teach); border:1px solid var(--s-teach-line); }
.rpace .lbl{ color:var(--s-teach-ink); }
/* Key words keep their stacked label-over-row shape — the meanings need the width — so the icon
   sits beside the whole block rather than on the label's line. min-width:0 is what lets the
   flex item shrink below its content; without it the meanings overflow the 478px column. */
.rkw{ background:var(--s-quiet); border:1px solid var(--s-quiet-line); }
.rkw .blk{ min-width:0; flex:1 1 auto; }
.rkw .lbl.g, .rkw > .lbl{ color:var(--s-quiet-ink); margin-top:0; }
/* The video block. Amber, matching its own link, so it reads as an offer rather than as part of
   the lesson body.
   NAMED .vres, not .res or .vid: BOTH of those are already taken (.res is the KaTeX result block,
   .vid was the old inline video block). A colliding class silently inherits someone else's box. */
.vres{ display:flex; gap:8px; align-items:baseline; background:var(--s-note); border:1px solid var(--s-note-line); }
.vres .ico{ flex:0 0 auto; }
.vres .lbl{ color:var(--s-note-ink); font-weight:700; flex:0 0 auto; }
/* The visible run is the video's TITLE (bd-a8veu.4), so this is a one-line clamp and no longer a
   url rule: word-break:break-all would hyphenate a title mid-word, and a long YouTube title on a
   478px column is three lines of furniture on a page that is already at its cap. min-width:0 is
   what lets a flex item shrink below its content — without it the row simply overflows. */
.vres a{ color:var(--s-note-ink); text-decoration:underline;
      min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* ══ PRIMARY PAGE 1 -- VENDOR DIVERGENCE (bd-vbs5w, SYNC §3.20) ══════════════════════════════════════════════════════════
   Operator, on the first HTML render of a G1-5 plan: "why cant p1 be like kie.ai? its more
   visual, and concise / materials should be indented bullets that go from left to right, no
   blank spaces / you didnt create a table for videos after materials / the kie.ai rendering
   should be adopted here with a larger font, possible or not?"

   Yes. The image path drew better FURNITURE than this one — a numbered day rail, a three-column
   journey/today/coming-up band, the to-prepare list as a row of checkboxes, the key words as a
   table — and none of it needed an image model. It is grid CSS, and grid CSS can carry it at
   BODY_PX where a raster could not be enlarged at all.

   WHY THIS IS SAFE FOR G6-12. The .pri class is on the root element for a grade 1-5 document
   and nowhere else
   (see isPrimary), so the two rules below that re-open an existing box cannot be reached by a
   secondary plan. Everything else is a NEW class no other block emits — the additive-field
   pattern, applied to the stylesheet.

   THE ONE THING THE PHONE CANNOT DO. Three columns at 21px on a 478px page is ~160px each,
   which is not readable at any weight. So TODAY takes the full width and the other two share a
   two-column grid beneath it; A4 gets the true three columns. That is the only place "adopt
   kie.ai" is answered with something other than kie.ai.
   (No backticks in this sheet — the whole stylesheet is one JS template literal.) */
.pri .rescard > div{ font-size:19px; padding:8px 12px; flex-wrap:wrap; align-items:baseline; }
/* THE LABEL STOPS BEING A LEFT GUTTER, which is the measurement behind her "no blank spaces".
   G6-12's row is icon + bold label + one short value on one line, and on a 478px column that
   label column eats 135px -- so every primary row was laid out inside 343px and wrapped four,
   five, six times: the to-prepare chips stacked one per line, the pending video message ran to
   103px, and the key-word meanings had 230px to say a sentence in. Measured on English_seg6,
   page 1's furniture cost 477px more than the row it replaced, and 354px of that was this
   gutter. Here the icon and the label take a line of their own and the CONTENT takes the full
   width beneath -- which is also the shape kie.ai drew, a heading over a row of boxes. */
.pri .rescard > div > .lbl{ font-size:14px; font-weight:800; letter-spacing:.06em;
      text-transform:uppercase; }
.pri .rkw .kwtab{ flex:1 0 100%; }
/* The running time stays on the LABEL line, where the flex auto-margin can still push it to the
   end; it is the one thing on the row that is read before the title, not after it. */
.pri .vres .dur{ font-size:17px; }
/* THE DAY RAIL. It REPLACES the .seq text stack, whose middle leg was the string "Day 6 of 10" —
   a rail and a sentence saying one thing twice is the duplication the whole page-1 rework is
   about. Circles, not a progress bar: the number has to be readable, because "which day am I on"
   is the first question a teacher asks and a filled proportion does not answer it. */
.drail{ display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
.drail .d{ flex:0 0 auto; width:30px; height:30px; border-radius:50%; display:flex;
      align-items:center; justify-content:center; font-size:15px; font-weight:800;
      color:var(--mut); background:var(--s-quiet); border:1px solid var(--line); }
.drail .d.done{ color:var(--s-do-ink); background:var(--s-do); border-color:var(--s-do-line); }
.drail .d.on{ width:34px; height:34px; font-size:17px;
      color:#fff; background:var(--leaf); border-color:var(--leaf); }
/* JOURNEY SO FAR | TODAY | COMING UP. The three periods are the same three the sequence object carries for
   G6-12 — previous, this, next — given the operator's own column names and the kie.ai weighting:
   today is the loud one (solid leaf, gold label, 23px), the other two are quiet context. The
   checkpoint rides in COMING UP because it is the next thing that is not a day. */
.band{ display:grid; gap:var(--sp-1); grid-template-columns:${PAGE.oneColumn ? "1fr 1fr" : "1fr 1.2fr 1fr"}; }
.band > div{ border-radius:var(--r-2); padding:8px 11px; min-width:0; }
.band > div .lbl{ display:block; font-size:13px; font-weight:800; letter-spacing:.06em;
      text-transform:uppercase; }
.band > div .t{ font-size:19px; line-height:1.35; font-weight:600; margin-top:2px; }
.band > .jrn{ background:var(--s-do); border:1px solid var(--s-do-line); }
.band > .jrn .lbl{ color:var(--s-do-ink); }
.band > .jrn .t{ color:var(--s-do-ink); font-weight:500; }
.band > .today{ background:var(--leaf); border:1px solid var(--leaf); }
.band > .today .lbl{ color:var(--board-gold); }
.band > .today .t{ color:#fff; font-size:23px; font-weight:800; }
.band > .up{ background:var(--s-quiet); border:1px solid var(--s-quiet-line); }
.band > .up .lbl{ color:var(--s-quiet-ink); }
.band > .up .t{ color:var(--mut); font-weight:500; }
.band .cp, .band .dtext{ display:block; margin-top:4px; font-size:15px; font-weight:700; }
.band > .up .cp{ color:var(--navy2); }
.band > .today .dtext{ color:var(--board-gold); }
${PAGE.oneColumn ? ".band > .today{ grid-column:1 / -1; order:-1; }" : ""}
/* TO PREPARE. Operator: "materials should be indented bullets that go from left to right, no
   blank spaces". A middle-dot join was one long sentence that wrapped ragged and read as
   indented text; these are chips that flow, so the last line is short and nothing is centred or
   spread. The box is drawn in CSS: a checkbox character would be a font dependency on a page
   that already ships its own subset. */
.mlist{ display:flex; flex-wrap:wrap; justify-content:flex-start; gap:5px 12px;
      min-width:0; flex:1 1 auto; }
.mi{ display:inline-flex; align-items:baseline; gap:7px; font-size:19px; font-weight:600;
      color:var(--s-do-ink); white-space:nowrap; }
.mi::before{ content:""; display:inline-block; flex:0 0 auto; width:13px; height:13px;
      border:2px solid var(--s-do-ink); border-radius:var(--r-1); }
/* KEY WORDS AS A TABLE. Six words were printing as six full-width boxes, which is six borders
   spent saying "these are words". Two tracks: the term takes what it needs up to 45% and the
   meaning takes the rest, so NEITHER MAY EXCEED THE PANEL — the same rule the board's two
   tracks answer. The .kr row is display:contents so a row is a row semantically without becoming a
   nested grid; the hairlines go on the cells, which is what a border-collapsed table would do. */
.kwtab{ display:grid; grid-template-columns:fit-content(45%) minmax(0, 1fr);
      margin-top:var(--sp-1); background:#fff; border:1px solid var(--s-quiet-line);
      border-radius:var(--r-1); overflow:hidden; }
.kwtab .kr{ display:contents; }
.kwtab .kr > *{ padding:5px 10px; border-top:1px solid var(--s-quiet-line);
      font-size:19px; line-height:1.35; min-width:0; overflow-wrap:break-word; }
.kwtab .kr:first-child > *{ border-top:0; }
.kwtab .kr > b{ color:var(--navy); font-weight:800; background:var(--s-quiet); }
.kwtab .kr > span{ color:var(--ink); }
/* ONE OPENING BOX -- VENDOR DIVERGENCE (bd-usirc, SYNC §3.22).
   Operator: "thgere should be 1 opening box that first has a warm up that helps kids settle and
   prepare for activating prior knowledge / then the actual hook to engage students with a
   provocation". Two atoms draw the one box, because an atom never splits and the warm-up and the
   hook together are taller than A4's content box -- so only the ENDS are rounded and the seam
   between them is square, which is the rule a split worked example already follows (SYNC §3.18).
   A band that is both ends is a whole box again. */
.pri .opn{ border-radius:0; }
.pri .opn.ofirst{ border-radius:var(--r-2) var(--r-2) 0 0; }
.pri .opn.olast{ border-radius:0 0 var(--r-2) var(--r-2); }
.pri .opn.ofirst.olast{ border-radius:var(--r-2); }
/* The pale half carries the frame; the hook's navy ground is the other half's own. The seam
   keeps its hairline: the packer may break between the two atoms, and a band left open at the
   bottom would print half a rectangle at the foot of a sheet. Closed on all four sides, with
   the shared corners squared, a split reads as continued rather than as unfinished. */
.pri .blk.wu.opn{ background:#fff; border:1px solid var(--s-teach-line); padding:5px 9px 7px; }
/* THE PRIMARY VIDEO ROW (bd-nsv74, narrowed in bd-s429u): the link, and under it a description of
   what the clip covers. The description takes a line of its own -- it is a sentence, median 101
   characters across the catalogue, so sharing the baseline row would squeeze the title it is
   explaining -- so the row wraps, which it can only do on primary: G6-12's is a single-line card
   row, never gets a description, and stays exactly as wide as it was. */
.pri .vres{ flex-wrap:wrap; }
/* Full width, so it is a line under the link rather than a column beside it. */
.pri .vres .vwhy{ flex:1 0 100%; color:var(--s-note-ink); font-size:16px; font-style:italic; min-width:0; }
.vres .dur{ flex:0 0 auto; margin-${start}:auto; font-size:16px; font-weight:800;
      color:var(--s-note-ink); font-variant-numeric:tabular-nums; }
.vid{ display:flex; gap:8px; align-items:baseline; background:var(--s-teach); border:1px solid var(--s-teach-line);
      border-radius:var(--r-2); padding:6px 12px; font-size:16.5px; }
.vid .lbl{ color:var(--navy2); flex:0 0 auto; }
.vid a{ color:var(--navy2); font-weight:700; text-decoration:none; }
.vid .why{ color:var(--mut); }
/* Conclusion: the board-phrased checkpoint, its mark scheme, the exit ticket, the re-teach rule. */
.ck{ background:var(--navy); color:#fff; border-radius:var(--r-2); padding:7px 13px; }
.ck .lbl{ color:var(--amber); }
.ck .q{ font-size:18.5px; font-weight:700; margin-top:2px; line-height:${rtl ? "1.9" : "1.55"}; }
.ck ul{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.ck li{ font-size:18px; color:#d7e0ee; }
.exit{ border:1px solid var(--s-do-line); background:var(--s-do); border-radius:var(--r-2); padding:6px 12px; }
.exit .lbl{ color:var(--s-do-ink); }
.exit .it{ display:flex; gap:8px; align-items:baseline; font-size:18px; }
.exit .a{ color:var(--leaf); font-weight:700; }
.reteach{ background:var(--s-watch); border:1px solid var(--s-watch-line); border-radius:var(--r-2); padding:6px 12px; }
.reteach .lbl{ color:var(--s-watch-ink); }
.reteach .t{ font-size:18px; color:#5a2f18; }
/* Homework as DATA. Each item wears its [SLO, K/U/A] tag; NO answer is printed here — the
   answers live in reference F, which is the whole point of defect class E. */
.hw{ display:flex; flex-direction:column; gap:var(--sp-1); }
.hw .it{ display:flow-root; border:1px solid var(--s-quiet-line); background:var(--s-quiet);
      border-radius:var(--r-1); padding:4px 11px; }
.hw .n{ float:${start}; margin-${end}:9px; font-weight:800; color:var(--mut); font-size:16.5px; }
.hw .q{ font-size:18px; }
/* L3. This is the [SLO, K/U/A] code — the single most repeated string in the plan, once per
   homework item. At 800 it was a column of shouting in the margin of every row. */
.hw .tag{ float:${end}; margin-${start}:9px; font-size:14px; font-weight:700; letter-spacing:.02em;
      color:var(--s-quiet-ink); background:#fff; border-radius:var(--r-pill); padding:1px 8px; white-space:nowrap; }
.hw .src{ color:var(--mut); font-size:15.5px; }
/* An inline matrix is promoted to display style (lib/rich.js). Give it room to breathe so it
   does not crowd the line it sits in. */
.mtx{ display:inline-block; vertical-align:middle; margin:0 2px; }
/* THE TEACHER NOTE. Distractor codes are data the teacher needs and a pupil must never read
   beside the option — so they are never painted in .op. Same for a resolved question ref.
   lint's DISTRACTOR_VISIBLE asserts every code is inside one of these. */
.tnote{ display:block; font-size:14.5px; color:#7d6425; background:var(--s-note); border-radius:var(--r-1);
      padding:4px 10px; margin-top:var(--sp-1); line-height:${rtl ? "1.8" : "1.5"}; }
.tnote b{ color:var(--s-note-ink); }
.refq{ display:block; font-size:16px; color:var(--navy2); font-weight:600; margin-bottom:2px; }

/* ── page-1 foot ────────────────────────────────────────────────────────── */
.mats{ padding-top:0; }
.matbox{ background:var(--s-do); border:1px solid var(--s-do-line); border-radius:var(--r-2); padding:7px 13px;
      font-size:16.5px; display:flex; gap:9px; align-items:baseline; }
.matbox .lbl{ color:var(--s-do-ink); flex:0 0 auto; }
.cont{ margin-top:0; font-size:14px; color:var(--mut); font-style:${rtl ? "normal" : "italic"};
      border-top:1px solid var(--line); padding-top:var(--sp-2); line-height:${rtl ? "1.9" : "1.55"}; }

/* ── page 2 ─────────────────────────────────────────────────────────────── */
.p2head{ ${PAGE.oneColumn ? "display:block;" : "display:flex; justify-content:space-between; align-items:center; gap:12px;"}
      border-bottom:3px solid var(--navy); padding-bottom:var(--sp-2); }
/* The pill rides INSIDE the meta line (bd-a8veu.9), ahead of the locator, so it needs the gap
   the flex row used to give it as a sibling. A trailing margin in the READING direction, not a
   literal one: on the Urdu page that gap belongs on the left. vertical-align centres the 14px
   badge against the 15.5px meta it now shares a line box with, so neither one lifts the line.
   It is beside the META and not the TITLE on purpose: the badge costs 133px of whatever line it
   sits on, the meta is short and fixed in shape, and the title is the one piece here that has
   to be free to wrap across the full measure. */
.p2head .pill{ background:var(--navy); color:#fff; font-size:14px; font-weight:800; letter-spacing:.11em;
      text-transform:uppercase; padding:5px 14px; border-radius:var(--r-pill); flex:0 0 auto;
      display:inline-block; vertical-align:middle; margin-${end}:9px; }
/* The eyebrow leads, so the space between the two pieces hangs off the TITLE now. */
.p2head .t{ font-size:20.5px; font-weight:800; color:var(--navy); line-height:${rtl ? "1.8" : "1.3"};${PAGE.oneColumn ? " margin-top:var(--sp-1);" : ""} }
.p2head .r{ font-size:15.5px; color:var(--mut); font-weight:600; text-align:${PAGE.oneColumn ? start : end}; line-height:${rtl ? "1.85" : "1.45"}; }
.p2sec{ break-inside:avoid; }
.p2bar{ display:flex; align-items:center; gap:7px; margin:0; }
.p2bar .badge{ flex:0 0 auto; width:21px; height:21px; border-radius:var(--r-1); background:var(--navy); color:#fff;
      font-size:15.5px; font-weight:800; display:flex; align-items:center; justify-content:center; line-height:1; }
.p2bar .nm{ font-size:17px; font-weight:800; color:var(--navy); letter-spacing:.03em;
      text-transform:uppercase; line-height:${rtl ? "1.8" : "1.35"}; }
.p2bar .rule{ flex:1 1 auto; height:2px; background:var(--line); }
/* ONE COLUMN on the phone page (v9.3). A .grid3 cell at the 478px measure is 154px — about
   seven characters a line — and .grid2's is 231px. This is a LAYOUT change, not a scale one:
   no size rescues a seven-character column. Measured over the 62 documents it SAVES 27 pages
   rather than costing them, because a three-column grid at a phone measure wraps its cells so
   hard that the row is taller than the same cards stacked. DESIGN.md section 5(b). */
.grid2{ display:grid; grid-template-columns:${PAGE.oneColumn ? "1fr" : "1fr 1fr"}; gap:var(--sp-2); }
.grid3{ display:grid; grid-template-columns:${PAGE.oneColumn ? "1fr" : "1fr 1fr 1fr"}; gap:var(--sp-2); }
/* A GROUP SHORT OF ITS COLUMNS fills the measure instead of reserving blank page beside
   itself -- VENDOR DIVERGENCE (bd-ip4xh, SYNC 3.30). One mistake card in a three-column grid drew at a third of the A4
   width with two thirds white; the operator's complaint was "no blank spaces". Emitted by
   gridRows ONLY when the whole group is one short row, and never on the phone, where
   oneColumn has already made every grid a single column. */
.grid2.n1, .grid3.n1{ grid-template-columns:1fr; }
.grid3.n2{ grid-template-columns:1fr 1fr; }
.card{ border:1px solid var(--line); border-radius:var(--r-1); padding:3px 10px; background:#fff; }
.card .lbl{ color:var(--s-teach-ink); display:block; margin-bottom:var(--sp-1); }
.card p{ font-size:18px; }
.card .a{ color:var(--leaf); font-weight:700; }
.card.mk{ background:var(--s-quiet); }
.mis{ border:1px solid var(--line); border-radius:var(--r-2); overflow:hidden; }
.mis .x{ background:var(--s-watch); padding:4px 10px; }
.mis .x .lbl{ color:var(--s-watch-ink); display:block; }
.mis .x p{ font-size:18px; color:#5a2f18; }
.mis .v{ background:var(--s-do); padding:4px 10px; }
.mis .v .lbl{ color:var(--s-do-ink); display:block; }
.mis .v p{ font-size:18px; color:#14472F; }
.mcq{ border:1px solid var(--line); border-radius:var(--r-2); padding:4px 10px; margin:0; }
.mcq .q{ font-size:18px; font-weight:700; color:var(--s-teach-ink); }
.mcq .opts{ display:flex; flex-wrap:wrap; gap:var(--sp-1); margin-top:var(--sp-1); }
.mcq .op{ font-size:16px; border:1px solid var(--s-quiet-line); border-radius:var(--r-1); padding:2px 8px; background:var(--s-quiet); }
.mcq .op.ok{ border-color:var(--s-do-line); background:var(--s-do); font-weight:700; color:var(--s-do-ink); }
.mcq .op .dc{ color:var(--s-watch-ink); font-size:14px; font-weight:700; }
.srq{ background:var(--navy); color:#fff; border-radius:var(--r-2); padding:6px 12px; }
.srq .lbl{ color:var(--amber); }
.srq .q{ font-size:18.5px; font-weight:700; margin-top:var(--sp-1); line-height:${rtl ? "1.9" : "1.55"}; }
.ms{ background:var(--s-do); border:1px solid var(--s-do-line); border-radius:var(--r-2); padding:6px 12px; margin-top:0; }
.ms .lbl{ color:var(--s-do-ink); display:block; }
.ms ul{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.ms li{ font-size:18px; margin:0; }
/* The one box on the page whose POINT is that it is empty: the dashed frame stays 1.5px where
   the solid frames standardised down to 1px, because a dash reads lighter than a rule of the
   same width and this is the box a teacher has to see as space to write in. */
.erq{ border:1.5px dashed var(--s-teach-line); border-radius:var(--r-2); padding:6px 12px; margin-top:0; }
.erq .lbl{ color:var(--s-teach-ink); display:block; }
.erq .q{ font-size:18px; font-weight:700; margin:var(--sp-1) 0 var(--sp-2); }
.erq .part{ display:flex; gap:8px; font-size:18px; align-items:baseline; }
.erq .part .mk{ flex:0 0 auto; margin-${start}:auto; color:var(--amber); font-weight:800; font-size:15.5px; }
.how{ font-size:15.5px; color:var(--mut); display:block; margin-top:var(--sp-1); }
.ord{ margin:0; padding-${start}:21px; }
.ord li{ font-size:18px; margin:0; line-height:1.55; }
/* .nxt went with the Next period / Not going today section (bd-a8veu.20) — the last
   selector that used it was deleted in the same commit. */
.coach{ background:var(--navy); color:#fff; border-radius:var(--r-2); padding:6px 12px; }
.coach .lbl{ color:var(--amber); display:block; }
.coach p{ font-size:18px; }
.coach .ask{ margin-top:var(--sp-1); } .coach .ask .lbl{ display:inline; margin-inline-end:6px; }
/* K-5 sets its offer strip in "small type — deliberately the quietest section of the page". v9
   CANNOT: the 18px body floor is the operator's readability ask and render_lp.js fails the build
   below it (caught at 15px on the first render of this strip). So the strip is made quiet with
   COLOUR, not size — every word on a v9 page is 18px or it does not ship. */
.coach .offer{ margin-top:var(--sp-1); color:#DCE6F2; }
/* The footer is pinned to the page floor by margin-top:auto, so its LAST LINE is the last
   painted pixel on every page. Under RTL the Nastaliq face hangs its descenders below the
   line box and the wordmark ran 4px past the page's inner bottom on every single Urdu page.
   A bottom padding lifts the text off the floor and — because the packer measures the
   footer's real box in the probe — is charged for exactly. */
/* STACKED, not a two-column row (v9.3, bd-oak77.16). The row was built for a 752px measure:
   at the phone page's 478px its left half wraps to three or four lines and the strip goes
   74px -> 188px ON EVERY PAGE — measured on cell_c06 — which is more than a whole page of
   furniture over a 16-page lesson and is what pushed 29 of 62 documents into OVERFLOW with
   overflowingSections EMPTY: nothing of the lesson clipped, only the strip that prints
   "page 6 of 14" over the line, and 16-78px of it, past bd-c3le6's 12px absorber. Stacked,
   each half gets the full column and the strip measures 74px again. Same words, same order,
   no string touched. */
.foot{ margin-top:auto; padding-top:var(--sp-2); padding-bottom:${rtl ? "7px" : "1px"};
      border-top:1px solid var(--line);
      display:block; color:var(--mut);
      font-size:14px; line-height:${rtl ? "1.75" : "1.4"}; }
.foot b{ color:var(--navy); font-weight:700; }
/* TWO LINE BOXES, STRUCTURALLY — operator: "footer to take no more than 2 lines pls". Stacked
   halves are two lines only while each half FITS the 478px column, and the left half holds a
   chapter title of unknown length, so no amount of shortening the string can guarantee it. A
   nowrap block has exactly one line box whatever it holds; overflow+ellipsis is what keeps that
   from running off the page edge instead. Clamping only ever SHRINKS the measured strip, so the
   packer's page budget cannot lose a pixel to this. No padding, no line-height, no font-size. */
.foot .fl{ min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.foot .fr{ text-align:${start}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.foot .wm{ font-weight:800; color:var(--brand, var(--navy)); }
${rtl ? `
/* ── mixed-script prose under RTL (the 2026-09 audit, class D3) ──────────────
   Each prose run follows ITS OWN first strong character
   (unicode-bidi:plaintext), so an embedded English sentence lays out LTR with
   its punctuation at the correct end while Urdu prose stays RTL — base
   direction per paragraph, isolates per atom. This is also the video-title fix:
   a Latin title inside RTL chrome takes its own direction instead of
   scrambling. Emitted ONLY under RTL, so the English stylesheet stays
   byte-identical. KaTeX is untouched: its own rule above already carries
   direction:ltr + unicode-bidi:isolate, which is stronger. */
p, li, figcaption,
.h-title, .h-sub, .say .t, .watch .t, .board .t, .reteach .t,
.hook .q, .hook .lf, .askb .q, .askb .lf, .srq .q, .ck .q, .erq .q,
.wu .q, .pr .q, .hw .q, .mcq .q, .exq h4, .exq .prompt,
.tn .tx, .tn .pl, .tn .rn,
.exit .it > span, .vres a, .tnote, .crit, .bythe, .how, .refq{ unicode-bidi:plaintext; }

/* ── NASTALIQ LEADING (bd-vxmj1) ─────────────────────────────────────────────
   Law R6 at the top of this file has always said Urdu leading is unitless and
   >= 2.0. It was written down and not enforced, and the sheet broke it two ways:
   rules that DID branch but sat under the floor ('.hook .q' at 1.95 -- the
   loudest box on page 1 and the longest run of Urdu prose in the plan), and
   rules that never branched at all, so a Latin 1.35 was applied to Nastaliq.
   The operator saw the result on the first G3 Urdu plan rendered from live ICT
   traces: "the urdu nastaliq script is overlapping on pages" ... "some places
   its too congested".

   It is one block rather than 28 edited numbers because the failure mode is a
   rule that FORGETS to branch, and a helper you must remember to call does not
   catch the rule that forgot. Emitted last and under RTL only, so it wins on
   equal specificity and the English sheet stays byte-identical.

   Two floors, because one does not fit. R6's 2.0 is the value below which the
   face clips; it is not the value at which a PARAGRAPH reads. Nastaliq's ink box
   runs past 3em once a line carries the common descenders, so a caption that
   survives at 2.0 is a paragraph that collides at 2.0. Prose gets 2.4; short
   furniture keeps R6's own floor. urdu-nastaliq-leading.test.js holds both
   against the sheet that ships. This costs pages, and the Urdu plan is already
   past its soft target -- the page target is a target and the renderer says so
   in its own warning. Overlapping script is a defect, and a defect is not paid
   for with a target. */
body, .hook .q, .hook .lf, .slo p, .tn, .ck .q, .srq .q, .exq h4, .exq .cfu,
.band > div .t, .ord li, .tbl td, .cont, .tnote, .seq, .mathb,
.kwtab .kr > *, figure.dg figcaption{ line-height:2.4; }
.hero .kicker, .hero .h-title, .hero .h-sub, .hero .h-meta, .hero .tchip,
.bar .nm, .lbl, .p2head .t, .p2head .r, .p2bar .nm, .foot{ line-height:2.05; }
` : ""}`;
  return `${fonts}\n${katex}\n${scaleTypeCss(sheet, TYPE_SCALE)}`;
}

// ── geometry the figure sizer needs ─────────────────────────────────────────
// .pad is padded PAGE.padX each side inside a PAGE.w page; figure.dg adds 10px padding either
// side plus a 1.5px border. On A4 that made a full-width diagram's drawing box 729px; on the
// v9.3 phone page it is 455px. ONE definition, derived from ONE page object — the two legibility
// gates were 2px apart for as long as this number was written down twice (bd-oak77.14).
let PAGE_INNER_W = PAGE.w - PAGE.padX * 2;
/* The flat height clamp on a raster book crop. See the note above `figure.dg img`. */
const CROP_MAX_H = 320;

const FIG_CHROME = 10 * 2 + 3;          // figure.dg padding + border
let FULL_COL = PAGE_INNER_W - FIG_CHROME;  // 727
const SPLIT_GAP = 9;
/** The legibility floor inside a figure, AT THE A4 MEASURE it was chosen against, and the drawing
 *  box it was chosen for. A figure's labels scale with ITS COLUMN, not with the page. */
const DIAGRAM_MIN_PX_A4 = 13.5;
const FULL_COL_A4 = PAGE_A4.w - PAGE_A4.padX * 2 - FIG_CHROME;   // 729
/* And the same floor on this page. IT MUST SCALE, AND IT MUST SCALE BY THE COLUMN.

   That it must scale at all is not a preference: `requiredBox()` sizes a figure so its smallest
   label clears this floor in the FIGURE's own column, so holding 13.5 on a 455px drawing box means
   the drawing can no longer shrink to fit. Measured over the 116 lessons production has actually
   delivered, that is 159 BLOCKING lint failures across 101 of them — `FIGURE` is not on
   `ADVISORY_CODES`, so each one is a revision round the ladder spends and a lesson it can lose.

   That it must scale by FULL_COL and not by PAGE.w is the part that is easy to get wrong, and it
   cost this lane a measurement to find. The two ratios are NOT the same, because `padX` and
   `FIG_CHROME` are absolute pixels that did not shrink with the page: 520/794 = 0.6549 but
   455/729 = 0.6242. Scaling by the page gives 8.84, which is apparent-size-neutral on the screen
   but 5% STRICTER than A4 relative to the column a figure actually gets — and it rejects figures
   A4 accepts: 26 blocking failures across 25 documents against today's 8 across 8. Scaling by the
   column gives 8.43 and reproduces today's set EXACTLY — 8 across 8, the same documents.

   WHAT THAT COSTS, SAID PLAINLY: a diagram's smallest label arrives on the phone about 5% smaller
   than it does today (6.32 phone px against 6.63). That is the price of keeping the 21px gutters,
   which this lane deliberately did not narrow, and it is a 5% change to a mark already sitting at
   43% of the reading floor. ACCEPTANCE-neutrality is what protects a teacher's lesson; the 5% is
   bd-oak77.15's to win back, and DESIGN.md section 5(c) says why that needs simpler diagrams
   rather than a bigger floor. */
let DIAGRAM_MIN_PX = +(DIAGRAM_MIN_PX_A4 * (FULL_COL / FULL_COL_A4)).toFixed(2);
/**
 * How far a FULL-WIDTH figure may grow, per side, to rescue its own labels — bd-oak77.14.
 *
 * The page is 794px with 21px of padding a side, so 21 is the hard ceiling: one pixel more and
 * the drawing runs off the paper, which is a worse defect than the one being fixed. The first
 * 11.5 of it is the figure's own chrome (`FIG_CHROME / 2`); the rest is margin the page can
 * spare. 18 leaves 3px of true paper margin on each side at full stretch and buys a full-width
 * figure 765px of drawing box against FULL_COL's 729 — enough for every FIGURE TOO SMALL either
 * production or staging has ever emitted (worst recorded: 743px needed, 2026-09-06).
 *
 * ONLY FULL-WIDTH FIGURES. Inside a `split` the 9px SPLIT_GAP is not ours to spend and anything
 * past it lands on the neighbouring column, so a narrow-column figure is left as a defect — which
 * the never-fail delivery policy then ships with a flag rather than losing (see
 * lp612-render-policy.service.js). That is the same advice the defect string has always given
 * ("give it a full-width row"), enforced instead of suggested.
 */
let FIG_GROW_MAX = PAGE.padX - 3;

/**
 * THE PRIMARY DIAGRAM FLOOR, AND WHY IT IS A SECOND NUMBER — VENDOR DIVERGENCE (SYNC 3.24), bd-u9vji.
 *
 * Operator: *"diagrams get phone-specific fix, labels should be phone-first"*.
 *
 * DIAGRAM_MIN_PX above is an ACCEPTANCE gate: it is set exactly where it reproduces today's
 * blocking-failure set, and its own comment says plainly what that costs a phone reader -- a mark
 * "already sitting at 43% of the reading floor". For grades 6-12 that trade is the right one,
 * because the diagram is one surface among many on a page the teacher reads at a desk. For grades
 * 1-5 it is not: the diagram REPLACES the prose it illustrates (d0_diagram.py), so an unreadable
 * label is not a degraded figure, it is a deleted paragraph.
 *
 * 15.5 is not a new number. It is `TYPE_FLOOR.label` from `bot/shared/templates/niete-brand.js`,
 * the floor every chip on the page already honours. A diagram label is type; it gets the type floor.
 *
 * PHONE-FIRST IS ARITHMETIC, not a preference. Narrowing the canvas to
 * `minFont * PHONE_FULL_COL / 15.5` makes `colPx / vbW` a constant, so the figure renders at the
 * SAME pixel height on both surfaces and A4 shows exactly what the phone will deliver -- which is
 * what "A4 to review, phone to deliver" asked for. Anchoring on A4's own 729px column instead
 * would put labels at 24.8px and make the tallest measured diagram want 1400px of height on a
 * 1109px page. An atom never splits, so that is a failed render, not a bigger label.
 */
const PRIMARY_DIAGRAM_MIN_PX = 15.5;
/** The phone drawing box, named as a constant because the shim is anchored on it in BOTH formats.
 *  Deliberately not `FULL_COL`: that moves with `setPageFormat`, and a figure whose size depends on
 *  which surface built it is the divergence this whole change exists to remove. */
const PHONE_FULL_COL = PAGE_FORMATS.phone.w - PAGE_FORMATS.phone.padX * 2 - FIG_CHROME;   // 455
/** The height budget a narrowed figure must fit, measured on the SHORTER of the two pages. A4 is
 *  1109px of content against the phone's 1986, so A4 is the binding constraint, and using it in
 *  both formats is what keeps the two renders identical. Minus the figure's own chrome. */
const PRIMARY_FIG_MAX_H = PAGE_A4.h - PAGE_A4.padT - PAGE_A4.padB - FIG_CHROME;            // 1086

/**
 * The canvas width at which THIS drawing's smallest label reaches the primary floor on a phone.
 *
 * Read off the SVG rather than assumed, so the shim is type-agnostic: `data-min-font` is whatever
 * token the builder actually used, not the 12.5 the three measured corpus diagrams happened to
 * share. Returns null when there is nothing to do -- no engine, no viewBox, or a canvas already
 * narrow enough. It NEVER widens: a diagram the author drew small is a diagram the author drew small.
 */
function primaryCanvasWidth(svg) {
  const rb = requiredBoxFn();
  if (!rb) return null;
  let box;
  try { box = rb(svg, { minPx: PRIMARY_DIAGRAM_MIN_PX }); } catch (_) { return null; }
  if (!(box.minFont > 0) || !(box.vbW > 0)) return null;
  const want = Math.floor((box.minFont * PHONE_FULL_COL) / PRIMARY_DIAGRAM_MIN_PX);
  return want > 0 && want < box.vbW ? want : null;
}

/**
 * Re-draw a primary diagram on a phone-first canvas — VENDOR DIVERGENCE (SYNC 3.24), bd-u9vji.
 *
 * THREE OUTCOMES, and every one of them is recorded:
 *
 *   FIGURE_NARROWED          the canvas narrowed and the smallest label now clears 15.5px on a
 *                            phone. The figure is measured against the primary floor from here on.
 *   FIGURE_NARROWED_PARTIAL  the label could not reach 15.5px without making the figure taller
 *                            than a page, so it took the narrowest canvas that DOES fit. Strictly
 *                            bigger type than today, measured against TODAY's floor, because
 *                            judging a best-effort against the target it knowingly missed would
 *                            turn an improved figure into a failed lesson.
 *   FIGURE_NARROW_DECLINED   nothing was gained. The ORIGINAL drawing and the ORIGINAL floor are
 *                            kept, which is today's behaviour byte for byte, and the reason is
 *                            named so a drifting diagram engine shows up as a number rather than
 *                            as a quietly worse page.
 *
 * The back-off walks from the narrowest canvas outward in thirds — narrowest first, because the
 * narrowest canvas is the largest label, and the first one that fits wins. Bounded at three
 * renders, so a lesson with three diagrams costs at most nine extra engine calls.
 *
 * MEASURED, NEVER ASSUMED (rule 16). A diagram type that ignores `spec.width` hands back the same
 * viewBox; that is detected by re-measuring the returned SVG, not by consulting a list of types
 * that honour the key.
 */
function primaryRedraw(spec, svg, render) {
  const rb = requiredBoxFn();
  const want = primaryCanvasWidth(svg);
  const nothing = { svg, floorPx: DIAGRAM_MIN_PX, repair: null };
  if (!rb || !want) return nothing;
  const M = (v) => rb(v, { minPx: PRIMARY_DIAGRAM_MIN_PX, colPx: PHONE_FULL_COL });
  let before;
  try { before = M(svg); } catch (_) { return nothing; }

  const span = before.vbW - want;
  const cands = [want, Math.round(want + span / 3), Math.round(want + (2 * span) / 3)];
  let best = null;
  let reason = "too-tall-at-every-width";
  for (const w of cands) {
    let alt;
    try { alt = render({ ...spec, width: w }); } catch (_) { reason = "engine-error"; break; }
    if (typeof alt !== "string" || !/<svg/i.test(alt)) { reason = "engine-error"; break; }
    let box;
    try { box = M(alt); } catch (_) { reason = "engine-error"; break; }
    if (!(box.vbW < before.vbW)) { reason = "type-ignores-width"; break; }
    if (box.minHeightPx <= PRIMARY_FIG_MAX_H) { best = { w, box, svg: alt }; break; }
  }

  const common = {
    specType: (spec && spec.type) || null,
    caption: spec && spec.caption ? String(spec.caption).slice(0, 60) : null,
    fromWidthPx: before.vbW,
    targetFloorPx: PRIMARY_DIAGRAM_MIN_PX,
    renderedPxBefore: before.renderedPx,
  };
  if (!best) {
    return { ...nothing, repair: { code: "FIGURE_NARROW_DECLINED", reason, ...common,
      floorPx: DIAGRAM_MIN_PX, renderedPxAfter: before.renderedPx } };
  }
  const full = best.box.renderedPx >= PRIMARY_DIAGRAM_MIN_PX;
  const floorPx = full ? PRIMARY_DIAGRAM_MIN_PX : DIAGRAM_MIN_PX;
  return {
    svg: best.svg,
    floorPx,
    repair: { code: full ? "FIGURE_NARROWED" : "FIGURE_NARROWED_PARTIAL", ...common,
      widthPx: best.w, floorPx, renderedPxAfter: best.box.renderedPx },
  };
}

let _requiredBox = null;
function requiredBoxFn() {
  if (_requiredBox !== null) return _requiredBox;
  try {
    _requiredBox = require("../diagrams/lib/svg").requiredBox;
  } catch (_) {
    _requiredBox = false;   // engine absent — fall back to the diagram's natural size
  }
  return _requiredBox;
}

/**
 * The CSS slot one rendered SVG needs.
 *
 * Returns `{ maxHeightPx, renderedPx, legible, tooTall }`. `maxHeightPx` is
 * max(minHeightPx, natural) — the height at which the smallest label still clears the
 * floor — so the clamp can never be the thing that crushes the type. `legible:false`
 * means the COLUMN is too narrow, which no height can fix: the figure has to go
 * full-width, and if it is already full-width that is a document defect, not a layout one.
 */
function figureSlot(svg, colPx, minPx) {
  const rb = requiredBoxFn();
  // bd-u9vji: the floor is an ARGUMENT so a primary figure can be measured against the type floor
  // without a module-level mode flag. Defaulted at CALL time, so `setPageFormat` still moves it.
  const floor = minPx == null ? DIAGRAM_MIN_PX : minPx;
  if (!rb) return { maxHeightPx: null, renderedPx: null, legible: true, tooTall: false };
  let box;
  try {
    box = rb(svg, { minPx: floor, colPx });
  } catch (_) {
    return { maxHeightPx: null, renderedPx: null, legible: true, tooTall: false };
  }
  // The clamp is minHeightPx: the SMALLEST box in which the smallest label still clears the
  // floor. A max-height only ever shrinks, so this leaves a naturally-short figure alone and
  // caps a tall one at exactly-legible rather than letting it eat a page. Clamping ANY lower
  // is what the old fixed 118px did.
  const maxHeightPx = box.minHeightPx;
  return {
    maxHeightPx,
    renderedPx: box.renderedPx,
    minWidthPx: box.minWidthPx,
    legible: box.renderedPx == null || box.renderedPx >= floor,
    tooTall: maxHeightPx > PAGE_CONTENT_H,
    floorPx: floor,
  };
}

/**
 * THE SLOT, AFTER TRYING TO RESCUE IT — bd-oak77.14.
 *
 * `figureSlot` answers "does this figure fit legibly in this column". This answers the question
 * that actually decides whether a teacher gets her lesson: "and if not, can we simply give it
 * more room?" A full-width figure that misses the floor by a few pixels is a LAYOUT problem with
 * a layout answer; treating it as a document defect is what threw away a finished 12-page lesson
 * on 2026-09-06 for a label 0.25px under the line.
 *
 * The growth is the SMALLEST that clears the floor, never the maximum available, and it is
 * re-MEASURED with the same `requiredBox` rather than assumed — "it should fit now" is a
 * hypothesis (rule 16), and the widened slot is the thing the browser will actually lay out.
 *
 * @param {string} svg
 * @param {number} colPx        the drawing box this figure has today
 * @param {number} maxGrowPx    how much it may take PER SIDE (0 = not allowed to grow)
 * @returns the `figureSlot` shape for the box it ends up with, plus:
 *   `growPx`            what it took per side (0 when it needed nothing, or could not be saved)
 *   `renderedPxBefore`  the size its smallest label rendered at BEFORE (null when it fitted)
 *   `neededPx`          the width it asked for
 *   `triedGrowPx`       set when a rescue was attempted and failed — the message says so
 */
function figureFit(svg, colPx, maxGrowPx, minPx) {
  const base = figureSlot(svg, colPx, minPx);
  if (base.legible || !base.minWidthPx || !(maxGrowPx > 0)) return { ...base, growPx: 0 };
  // Per side, and at least 1px — a sub-pixel deficit still needs a whole pixel of margin.
  const need = Math.max(1, Math.ceil((base.minWidthPx - colPx) / 2));
  if (need > maxGrowPx) return { ...base, growPx: 0, triedGrowPx: maxGrowPx };
  const widened = figureSlot(svg, colPx + 2 * need, minPx);
  // Measured, not assumed. If the widened box still does not clear the floor (it can happen when
  // `minWidthPx` was rounded down against a viewBox this figure does not honour), report the
  // ORIGINAL defect rather than shipping a widening that bought nothing.
  if (!widened.legible) return { ...base, growPx: 0, triedGrowPx: maxGrowPx };
  return {
    ...widened,
    growPx: need,
    renderedPxBefore: base.renderedPx,
    neededPx: base.minWidthPx,
  };
}

// ── block renderers ─────────────────────────────────────────────────────────

const FIGCACHE = path.join(__dirname, "..", ".figcache");

/** Tonal cleanup for a faint textbook scan. Cached by content hash; falls back to the
 *  raw crop (with a warning) if Pillow is missing, because a faint figure beats none. */
function cleanedFigure(srcPath, warn) {
  try {
    const raw = fs.readFileSync(srcPath);
    const key = crypto.createHash("sha1").update(raw).update("clean_figure.v1").digest("hex").slice(0, 16);
    fs.mkdirSync(FIGCACHE, { recursive: true });
    const out = path.join(FIGCACHE, `${key}.jpg`);
    if (!fs.existsSync(out)) {
      execFileSync("python3", [path.join(__dirname, "clean_figure.py"), srcPath, out], { stdio: "pipe" });
    }
    return out;
  } catch (e) {
    warn(`figure cleanup skipped for ${path.basename(srcPath)} (${String(e.message).split("\n")[0]}) — using the raw scan`);
    return srcPath;
  }
}

function dataUri(relOrAbs, docDir) {
  const cands = [
    path.isAbsolute(relOrAbs) ? relOrAbs : null,
    path.resolve(REPO_ROOT, relOrAbs),
    path.resolve(docDir, relOrAbs),
  ].filter(Boolean);
  for (const p of cands) {
    if (fs.existsSync(p)) {
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
      return { uri: `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`, path: p };
    }
  }
  return null;
}

/**
 * The teacher's script, one row per turn — VENDOR DIVERGENCE (SYNC §3.17).
 *
 * Measured over the 38-lesson G4 Ch9 primary corpus, a move's script printed as 228
 * paragraphs of a median 10 sentences each. Parsed (curriculum/g1-5-resegment/d0_script.py)
 * the same words are 1,203 turns, and a turn is a row: the teacher reads down a column
 * instead of finding her place inside a paragraph. No word is dropped in either direction.
 *
 * 954 of those 1,203 reach THIS function, and the gap is not a loss. D0 scripts the I-Do and
 * We-Do moves; You-Do's steps become `practice` items, where the question already is the row.
 * The same wiring adds 68 dialogue frames that no `say` string contains. Counts below are the
 * 954 -- the population that is actually laid out.
 *
 * THE RESPONSE IS ON THE ROW, NOT IN A COLUMN. The operator chose a two-column
 * call-and-response, and the corpus then said 7 of 954 turns (0.73%) carry an answer the
 * script actually supplies. A column reserved down the page would narrow all 954 rows to
 * serve seven, so the answer rides its own row at the reading edge and the heads appear only
 * on a block that has one. An ASK with no supplied answer gets a ruled waiting space: the
 * plan does not know what the class will say, and printing a guess there would be a lie in
 * the one place she is about to check a child against.
 *
 * Speech carries its quote marks in CSS, not in the text. The operator's ruling was "keep
 * the quote, chip the action": the marks are what make a row read as her words, but stored
 * in the string they would ride into Stage E's voicenotes and the WhatsApp body, which want
 * the sentence and not its punctuation furniture.
 */
function scriptRows(b, rich, L) {
  const ts = Array.isArray(b.turns) ? b.turns : null;
  if (!ts || !ts.length) {
    // Every G6-12 document takes this branch, so their render is unchanged by
    // construction rather than by promise (tests/lp612 holds that as a control).
    return `<ol>${(b.steps || []).map((s) => `<li>${rich(s)}</li>`).join("")}</ol>`;
  }
  const answered = ts.some((t) => Array.isArray(t.expect) && t.expect.length);
  const pills = (t) =>
    Array.isArray(t.expect) && t.expect.length
      ? `<div class="rp">${t.expect.map((e) => `<span class="pl">${rich(e)}</span>`).join("")}</div>`
      : t.kind === "ask"
        ? `<div class="rp"><span class="wait"></span></div>`
        : "";
  const body = (t) =>
    t.kind === "routine"
      ? `${t.name ? `<span class="rn">${rich(t.name)}</span>` : ""}<ol class="rs">${(t.parts || [])
          .map((p) => `<li>${rich(p)}</li>`).join("")}</ol>`
      : `<span class="tx">${rich(t.text || "")}</span>${
          t.ref ? `<span class="pref">${rich(t.ref)}</span>` : ""}`;
  const head = answered
    ? `<div class="tn hd"><span class="tx">${esc(L.teacher)}</span><div class="rp">${esc(L.classSays)}</div></div>`
    : "";
  // `k-` prefixed: three of the six kind names are already v9 BLOCK classes -- `.say` is
  // the blue say-aloud box with a 4px rule and 13px of padding -- and an unprefixed kind
  // would have put every line of speech inside one.
  const rows = ts.map((t) => `<div class="tn k-${esc(t.kind)}">${body(t)}${pills(t)}</div>`);
  return { head, rows };
}

/**
 * The script as ONE `.scr` box -- what a block prints when it is not being split. Every
 * G6-12 document takes `scriptRows`'s flat-`<ol>` branch and reaches here with a string,
 * so their markup is byte-identical to before this split existed.
 */
function script(b, rich, L) {
  const r = scriptRows(b, rich, L);
  if (typeof r === "string") return r;
  return `<div class="scr">${r.head}${r.rows.join("")}</div>`;
}

/**
 * VENDOR DIVERGENCE (SYNC §3.29). The check the modelling closes on.
 *
 * Operator's primary page map: *"worked example should be better formatted ending with a
 * CFU like usual"*. The check is not new -- primary Stage-C authors `cfuExplain`, and D0
 * used to file it as a stand-alone `ask` block in the CONCLUSION, which printed it pages
 * after the modelling it checks. ONE HOME PER SOURCE FIELD, and the home is this box.
 *
 * A FIELD, not a sixteenth `kind:"ask"` turn. A turn is separated from the one above it by
 * the 2px gap `.scr` draws, so it reads as one more line of speech rather than as the box
 * closing; and a field travels in `pc-z` when the card splits, so an example that breaks
 * over a page still ends on its check.
 *
 * The label is `L.askPlain` -- the one the teacher already reads above this exact string
 * today. Reusing it means the Urdu is free and the string did not change its name when it
 * changed its seat. Only `worked_example` carries `cfu` in the schema, so the `faded_example`
 * call site below can never fire.
 */
function cfuRow(b, rich, L) {
  return b.cfu ? `<div class="cfu"><span class="cl">${esc(L.askPlain)}</span>${rich(b.cfu)}</div>` : "";
}

/* bd-c74u3. THE BIG IDEA'S MARK -- kie.ai's lightbulb, drawn rather than typed. `.mi` already
   settled the principle ("a checkbox character would be a font dependency on a page that already
   ships its own subset"), and a lightbulb is the worse bet of the two: the emoji is outside every
   subset we ship and lands as a tofu box. Sized in `em` and stroked in `currentColor`, so it
   inherits the label's size and the TEACH ink and never needs a colour of its own. Decorative --
   the label beside it already names the surface -- hence aria-hidden. */
const BI_MARK = '<svg class="bimark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<path d="M9.5 18.5h5M10.5 21.5h3M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.7.5 1.1 1.2 1.3 2l.1.3h5l.1-.3'
  + 'c.2-.8.6-1.5 1.3-2A6.5 6.5 0 0 0 12 2.5Z"/></svg>';

function makeBlockRenderer(ctx) {
  const L = ctx.L;
  const AR = arrowFor(ctx);
  // Pulled out of R.practice so the ATOMISER can re-use them verbatim: a long practice list
  // may be split between its items across a page break (v8.1), and a second copy of the item
  // markup would drift from this one the first time either is touched.
  const practiceTag = (b) =>
    b.title || (b.mode === "guided" ? L.guided : b.mode === "independent" ? L.independent : L.practice);
  /* VENDOR DIVERGENCE (SYNC §3.16). Operator: *"the practice sectionbs are too texty, how
     can we render appropriately on html?"*

     The question and its answer used to share one flowing line, joined by an arrow. On the
     G6-12 corpus that reads fine, because the answer is usually a number or a phrase. On the
     primary corpus it does not: measured over 306 problems the question runs to a median 14
     words and the answer to a median 21 (max 116), so the arrow fell somewhere mid-paragraph
     and the teacher had to parse a sentence to find out where her answer started.

     Same words, same order, two rows: the task she reads out, then the answer she is listening
     for, under it and labelled. `ref` prints as a chip rather than inline, because the citation
     is how she finds the page, not part of the question -- it was arriving glued to the front of
     93 of those prompts and pushing the question itself onto the second line. */
  const practiceItem = (it, i) => `<div class="it"><div class="qr"><span class="n">${i + 1}.</span>
            <span class="q">${rich(it.q)}</span>
            ${it.ref ? `<span class="ref">${esc(it.ref)}</span>` : ""}
            ${it.tier && it.tier !== "core" ? `<span class="tier">${esc(L.tier[it.tier] || it.tier)}</span>` : ""}</div>
            <div class="arow"><span class="al">${esc(L.answer)}</span><span class="a">${rich(it.a)}</span></div></div>`;
  const R = {
    paragraph: (b) => `<div class="blk"><p>${rich(b.text)}</p></div>`,

    say: (b) => `<div class="blk say"><div class="lbl">${esc(L.say)}</div>
      <div class="t">&ldquo;${rich(b.text)}&rdquo;</div></div>`,

    ask: (b) =>
      b.hook
        ? `<div class="blk hook"><div class="lbl">${esc(L.ask)}</div>
           <div class="q">${rich(b.question)}</div>
           ${b.look_for ? `<div class="lf"><b>${esc(L.lookFor)}:</b> ${rich(b.look_for)}</div>` : ""}</div>`
        : `<div class="blk askb"><div class="lbl">${esc(L.askPlain)}</div>
           <div class="q">${rich(b.question)}</div>
           ${b.look_for ? `<div class="lf"><b>${esc(L.lookFor)}:</b> ${rich(b.look_for)}</div>` : ""}</div>`,

    watch_out: (b) => `<div class="blk watch"><div class="lbl">&#9888; ${esc(L.watch)}</div>
      <div class="t">${rich(b.text)}</div></div>`,

    /* VENDOR DIVERGENCE (SYNC §3.16). `panels` is the board LAID OUT; `text` is the flat
       fallback and is still what every reader outside the renderer addresses.

       The bug this fixes is small and it cost the whole block: `boardWork.content` is authored
       as a laid-out board -- blank-line groups, each with its own heading, in the order they go
       up -- and it went into `text` as one string. HTML collapses a newline to a space, so 38
       authored boards printed as 38 paragraphs. The layout was in the data the whole time; the
       renderer dropped it on the floor. See d0_board.py for the parse. */
    board: (b) => {
      const panels = b.panels || [];
      if (!panels.length) {
        return `<div class="blk board"><div class="lbl">${esc(L.board)}</div>
      <div class="t">${rich(b.text)}</div></div>`;
      }
      const row = (r) =>
        r.term
          ? `<span class="bk">${rich(r.term)}</span><span class="bg">${rich(r.gloss)}</span>`
          : `<span class="bx">${rich(r.text)}</span>`;
      // VENDOR DIVERGENCE (bd-i44jn, SYNC §3.21). A CONNECTOR JOINS TWO BOARDS AND IS A ROW
      // OF NEITHER. The author of English_seg6 drew a finished box, an arrow reading
      // "-> APPLY THE CLUE ->", then a second finished box. Printed as a row it read as
      // something to write INSIDE the second board, which is the opposite of the
      // relationship drawn. It prints between the two numbered panels, where the teacher
      // chalks it. Additive: a panel without one emits nothing, so G6-12 is untouched.
      const joint = (pn) =>
        pn.connector ? `<div class="bcon">${rich(pn.connector)}</div>` : "";
      // The chip is the panel's place in the build, so it counts panels, not rows.
      const panel = (pn, i) => `${joint(pn)}<div class="bp"><span class="bn">${i + 1}</span>
        <div>${pn.label ? `<div class="bhd">${rich(pn.label)}</div>` : ""}
        <div class="bb">${pn.rows.map(row).join("")}</div></div></div>`;
      return `<div class="blk board"><div class="lbl">${esc(L.board)}</div>
      <div class="bd">${b.title ? `<div class="btitle">${rich(b.title)}</div>` : ""}
      ${panels.map(panel).join("")}</div></div>`;
    },

    keywords: (b) => `<div class="blk"><div class="lbl g">${esc(L.keywords)}</div>
      <div class="kwrow">${b.items
        .map((k) => `<span class="kw"><b>${rich(k.word)}</b> <i>— ${rich(k.meaning)}</i></span>`)
        .join("")}</div></div>`,

    /* VENDOR DIVERGENCE (SYNC 3.26). THE BIG IDEA. kie.ai gives its `bigIdea` -- role
       "pedagogical-heart" -- about 22% of page 1; the HTML profile had no equivalent, so
       one third of it lived in Key fact, one third in Watch for this slip, and the third --
       the distinction the textbook never makes explicit -- lived nowhere. Three NAMED
       paragraphs rather than an `items` array, because the failure this surface exists to
       prevent is an author writing three restatements of the outcome: a missing distinction
       has to print as a labelled blank, not vanish into a shorter list. */
    big_idea: (b) => {
      const label = b.title === undefined ? L.bigIdea : b.title;
      // bd-7l7ne. The labelled blank above is the 6-12 law and still holds there: an EMPTY string
      // is an author's omission and prints as a blank so it gets written. A MISSING key is a
      // different thing -- only the primary prune removes one, and a label with nothing behind it
      // is the apology the operator asked us to stop printing.
      const para = (key, text) =>
        text === undefined || text === null
          ? ""
          : `<p class="bip"><span class="bil">${esc(L[key])}</span>${rich(text || "")}</p>`;
      const paras = para("biDistinction", b.distinction) + para("biMisconception", b.misconception)
        + para("biDemo", b.demo);
      if (!paras) return "";
      // bd-c74u3. kie.ai marks this card with a lightbulb. Our surfaces are otherwise told apart
      // by colour alone, and this is the one the teacher is meant to find first; primary only,
      // for the same reason the inline lead-in is -- it is the crowded page that needs an anchor.
      const mark = ctx.primary ? BI_MARK : "";
      return `<div class="blk bigidea">${label ? `<div class="lbl g">${mark}${rich(label)}</div>` : ""}
      ${paras}</div>`;
    },

    key_points: (b) => {
      const label = b.title === undefined ? L.keyPoints : b.title;
      // bd-7l7ne -- `items` is required by the schema and only the primary prune can remove it.
      // A heading over an empty list is not a lesson surface, so the block goes with it.
      const items = b.items || [];
      if (!items.length) return "";
      return `<div class="blk">${label ? `<div class="lbl g">${rich(label)}</div>` : ""}
      <ul class="kp"${label ? "" : ' style="margin-top:0"'}>${items.map((i) => `<li>${rich(i)}</li>`).join("")}</ul></div>`;
    },

    /* bd-a8veu.21 — the same facts, one attribute name instead of one per sentence. A ragged
       row is PADDED, never dropped and never shifted left: the author is a model, and a short
       row must cost one empty cell rather than a whole lost case. */
    table: (b) => {
      const label = b.title === undefined ? "" : b.title;
      const cells = (r) =>
        b.columns.map((_, i) => `<td>${rich(r[i] == null ? "" : r[i])}</td>`).join("");
      return `<div class="blk">${label ? `<div class="lbl g">${rich(label)}</div>` : ""}
      <table class="tbl"><thead><tr>${b.columns.map((c) => `<th>${rich(c)}</th>`).join("")}</tr></thead>
      <tbody>${b.rows.map((r) => `<tr>${cells(r)}</tr>`).join("")}</tbody></table></div>`;
    },

    /* VENDOR DIVERGENCE (SYNC §3.17). `script(b)` prints `turns` when the document
       carries them and falls back to the flat `<ol>` of `steps` when it does not, which
       is every G6-12 document. Same block, same tag, same box -- only the inside of the
       body changes, and only for a document that asked for it. */
    worked_example: (b) => `<div class="blk exq">
      <span class="tag">${rich(b.title || L.worked)}</span>
      ${b.prompt ? `<div class="prompt">${rich(b.prompt)}</div>` : ""}
      ${script(b, rich, L)}
      ${b.result ? `<div class="res">${rich(b.result)}</div>` : ""}${cfuRow(b, rich, L)}</div>`,

    /* VENDOR DIVERGENCE (SYNC §3.16). `prompt` carries the WE-DO setup -- how the pairs sit,
       what the teacher does while they talk -- and printed as one run-on line. Splitting it on
       its authored separator gives one instruction per row, which is how she performs it. */
    faded_example: (b) => `<div class="blk exq we">
      <span class="tag">${rich(b.title || L.faded)}</span>
      ${b.prompt ? `<ul class="setup">${b.prompt.split(" \u00b7 ").map((x) => `<li>${rich(x)}</li>`).join("")}</ul>` : ""}
      ${script(b, rich, L)}
      ${b.answer ? `<div class="res">${esc(L.answer)}: ${rich(b.answer)}</div>` : ""}</div>`,

    practice: (b) => `<div class="blk pr"><span class="tag">${rich(practiceTag(b))}</span>
        <div class="items">${b.items.map(practiceItem).join("")}</div></div>`,

    support_extension: (b) => `<div class="blk se">
      <div class="sup"><div class="lbl">${esc(L.support)}</div><p>${rich(b.support)}</p></div>
      <div class="ext"><div class="lbl">${esc(L.extension)}</div><p>${rich(b.extension)}</p></div></div>`,

    diagram: (b, colPx) => {
      let svg;
      try {
        svg = ctx.renderDiagram(b.spec);
        if (typeof svg !== "string" || !/<svg/i.test(svg)) throw new Error("renderDiagram did not return an SVG");
      } catch (e) {
        ctx.warn(`diagram type "${b.spec && b.spec.type}" did not render: ${e.message}`);
        svg = ctx.placeholder(b.spec || { type: "?" });
      }
      ctx.vectorFigure = true;   // the phone gate's pixel proxy scores SVG hairlines as type
      // PHONE-FIRST LABELS, primary only — VENDOR DIVERGENCE (SYNC 3.24), bd-u9vji. Gated on
      // `ctx.primary` (grade 1-5 off `provenance.grade`, never a caller flag) AND on the author
      // having left `width` unset, because a width in the spec is a decision someone already took.
      // G6-12 never enters this branch, so it is untouched by construction.
      let figFloor = DIAGRAM_MIN_PX;
      if (ctx.primary && b.spec && b.spec.width == null) {
        const redrawn = primaryRedraw(b.spec, svg, ctx.renderDiagram);
        svg = redrawn.svg;
        figFloor = redrawn.floorPx;
        if (redrawn.repair) ctx.figureRepair(redrawn.repair);
      }
      // The slot is COMPUTED, never a magic number. See figureSlot()/figureFit().
      const col = colPx == null ? FULL_COL : colPx;
      // bd-oak77.14: a FULL-WIDTH figure may take up to FIG_GROW_MAX px a side to rescue its own
      // labels. A figure in a narrower column may not — the space beside it belongs to the other
      // column (see FIG_GROW_MAX). `col >= FULL_COL` rather than `=== ` so a future wider page
      // does not silently switch the repair off.
      const slot = figureFit(svg, col, col >= FULL_COL ? FIG_GROW_MAX : 0, figFloor);
      const label = `"${(b.spec && b.spec.type) || "?"}"${b.spec && b.spec.caption ? ` (${String(b.spec.caption).slice(0, 40)})` : ""}`;
      if (slot.growPx) {
        // RECORDED, always. A repair that leaves no trace is a regression mask (rule 24(b)): if
        // this starts firing on half the corpus, the diagram engine has drifted and this number
        // is the thing that says so, not a clean-looking render.
        ctx.figureRepair({
          code: "FIGURE_WIDENED",
          specType: (b.spec && b.spec.type) || null,
          caption: b.spec && b.spec.caption ? String(b.spec.caption).slice(0, 60) : null,
          colPx: Math.round(col),
          growPx: slot.growPx,
          neededPx: slot.neededPx,
          renderedPxBefore: slot.renderedPxBefore,
          renderedPxAfter: slot.renderedPx,
          floorPx: figFloor,
        });
      }
      if (!slot.legible) {
        ctx.figureProblem(`FIGURE TOO SMALL: diagram ${label} renders its smallest label at ` +
          `${slot.renderedPx}px in a ${Math.round(col)}px column (floor ${figFloor}px). ` +
          `It needs ${slot.minWidthPx}px of width — ` +
          (slot.triedGrowPx
            ? `the most the page can give it is +${slot.triedGrowPx}px a side, which is still `
              + `short. Simplify it, or split it into two smaller figures.`
            : `give it a full-width row, or simplify it.`));
      } else if (slot.tooTall) {
        ctx.figureProblem(`FIGURE TOO TALL: diagram ${label} needs ${slot.maxHeightPx}px of height to stay ` +
          `readable, which is more than one page (${PAGE_CONTENT_H}px). Split it or simplify it — ` +
          `shrinking it would put its labels below the ${figFloor}px floor.`);
      }
      // The clamp rides a custom property so it lands on the SVG itself — a max-height on the
      // <figure> would clip the drawing instead of scaling it.
      const styleBits = [];
      if (slot.maxHeightPx) styleBits.push(`--fig-h:${slot.maxHeightPx}px`);
      if (slot.growPx) styleBits.push(`--fig-wide:${slot.growPx}px`);
      const cap = styleBits.length ? ` style="${styleBits.join(";")}"` : "";
      // NO outer <figcaption>. The diagram engine's builder owns the caption strip
      // (diagrams/lib/svg.js draws spec.caption inside the SVG, and the L1 placeholder
      // prints it too), so wrapping it again printed every caption TWICE — plain from the
      // SVG, then bold underneath. The caption belongs to the SVG's accessible text; the
      // fix is to stop duplicating it here, never to delete it from the spec.
      // The BADGE, not the enum. `diagramLabel` returns "" for a type it does not know, and an
      // empty badge is the right failure: a missing label is cosmetic, a printed enum is a
      // defect the teacher reads (see DIAGRAM_LABELS).
      const dtag = diagramLabel(b.spec.type, ctx.rtl ? "ur" : "en");
      return `<figure class="dg"${cap}><div class="ftop">
          ${dtag ? `<span class="ftag">${esc(dtag)}</span>` : "<span></span>"}
          ${ctx.stubDiagrams ? `<span class="fsrc" style="color:var(--amber)">&#9679; placeholder</span>` : ""}
        </div>${svg}</figure>`;
    },

    textbook_figure: (b) => {
      // src may be absent while the figure-locator pass has not yet cropped `ref` (L3 ask 6).
      // Fall back to the words, and SAY the crop is missing — never a silently blank box.
      let img = b.src ? dataUri(b.src, ctx.docDir) : null;
      // bd-17mht: the diagram plan names a crop by `ref` and the worker stages
      // it into the render dir as `<ref>.jpg`. Without this, `src` is never
      // populated by anything in the codebase and EVERY book figure silently
      // degraded to the text-only reference below.
      // `ref` reaches us from LLM output, and dataUri() resolves against
      // REPO_ROOT as well as docDir, so a `..` would escape the render dir —
      // refuse anything that is not a plain book/page ref.
      if (!img && typeof b.ref === "string" && /^[A-Za-z0-9_][A-Za-z0-9_\-./]*$/.test(b.ref) && !b.ref.includes("..")) {
        img = dataUri(`${b.ref}.jpg`, ctx.docDir);
      }
      if (img && /\.(jpe?g|png)$/i.test(img.path)) {
        const cleaned = cleanedFigure(img.path, ctx.warn);
        if (cleaned !== img.path) img = dataUri(cleaned, ctx.docDir);
      }
      if (img) ctx.rasterFigure = true;   // the phone gate needs to know a book crop is on the page
      if (!img) {
        ctx.warn(b.src ? `textbook_figure src not found: ${b.src}` : `textbook_figure "${b.ref}" has no crop yet — rendered as a book reference`);
        return `<figure class="dg book"><div class="ftop">
          ${b.figure_label ? `<span class="ftag">${rich(b.figure_label)}</span>` : "<span></span>"}
          <span class="fsrc">&#9679; ${esc(L.figureIn)}${b.page ? `, ${esc(L.page)}${esc(b.page)}` : ""}</span></div>
          ${b.caption ? `<figcaption>${rich(b.caption)}</figcaption>` : ""}
          ${b.legend ? `<div class="legend"><span class="lbl">${esc(L.reading)}</span>${rich(b.legend)}</div>` : ""}</figure>`;
      }
      return `<figure class="dg book">
        <div class="ftop">
          ${b.figure_label ? `<span class="ftag">${rich(b.figure_label)}</span>` : "<span></span>"}
          <span class="fsrc">&#9679; ${esc(L.figureIn)}${b.page ? `, ${esc(L.page)}${esc(b.page)}` : ""}</span>
        </div>
        <img src="${img.uri}" alt="${esc(b.caption || b.figure_label || "textbook figure")}">
        ${b.caption ? `<figcaption>${rich(b.caption)}</figcaption>` : ""}
        ${b.legend ? `<div class="legend"><span class="lbl">${esc(L.reading)}</span>${rich(b.legend)}</div>` : ""}
      </figure>`;
    },

    latex: (b) => `<figure class="blk mathb">${display(b.tex)}
      ${b.caption ? `<figcaption>${rich(b.caption)}</figcaption>` : ""}</figure>`,

    chem: (b) => `<figure class="blk mathb">${displayChem(b.tex)}
      ${b.caption ? `<figcaption>${rich(b.caption)}</figcaption>` : ""}</figure>`,
  };

  R.split = (b, colPx) => {
    const r = b.ratio || 0.5;
    const outer = (colPx || FULL_COL) + FIG_CHROME;     // the split divides the TEXT column
    const wide = outer - SPLIT_GAP;
    // v9.3: stacked, both columns are the full measure, so a figure inside a split is sized
    // for the width it will actually be drawn at. Sizing for a half it no longer occupies is how
    // a legible figure gets clamped to half its height.
    const colW = (grow) => (PAGE.oneColumn ? outer - FIG_CHROME : Math.floor(wide * grow) - FIG_CHROME);

    // A diagram that cannot stay legible in its half is HOISTED to a full-width row under
    // the split rather than silently crushed. Legibility beats the two-column layout — the
    // v7-1 side-by-side pattern exists to save vertical space, not to shrink type.
    const hoisted = [];
    const keep = (blocks, grow) =>
      blocks.filter((x) => {
        if (x.type !== "diagram") return true;
        let svg;
        try { svg = ctx.renderDiagram(x.spec); } catch (_) { return true; }
        if (typeof svg !== "string" || !/<svg/i.test(svg)) return true;
        if (figureSlot(svg, colW(grow)).legible) return true;
        hoisted.push(x);
        return false;
      });
    const left = keep(b.left, r);
    const right = keep(b.right, 1 - r);

    const col = (blocks, grow) =>
      `<div style="flex:${grow} 1 0;min-width:0">${blocks.map((x) => render(x, colW(grow))).join("")}</div>`;
    const row = `<div class="blk split">${col(left, r)}${col(right, 1 - r)}</div>`;
    if (!hoisted.length) return row;
    // A hoisted figure rides in the SAME atom as its split (it is the split's own content), so
    // it carries its rhythm inline rather than as a .pad atom class — but it MUST be inside the
    // atom's single root element. It was a sibling of `row`, and `decorate()` only tags the
    // FIRST root with data-atom, so the packer measured the split and paid nothing for the
    // 490px figure underneath it. On the Urdu smoke doc that put page 1 404px over the page.
    // A page break can still not fall between them: a figure hoisted out of a split belongs to
    // the split, and separating them puts a caption on a page without its columns.
    return `<div class="blk">${row}${hoisted
      .map((x) => `<div style="margin-top:var(--sp-3)">${render(x, colPx || FULL_COL)}</div>`)
      .join("")}</div>`;
  };

  const render = (b, colPx) => {
    const fn = R[b.type];
    if (!fn) {
      ctx.warn(`unknown block type "${b.type}" — skipped`);
      return "";
    }
    return fn(b, colPx == null ? FULL_COL : colPx);
  };
  render.practiceTag = practiceTag;
  render.practiceItem = practiceItem;
  return render;
}

// ── page assembly ───────────────────────────────────────────────────────────
//
// v8.1 — THE PAGINATION CONTRACT CHANGED. v8 packed whole SECTIONS: a section was atomic
// (`break-inside: avoid`), so a development section too tall to join page 1 moved wholesale
// and left a third of that page white. Operator, 2026-08-30: *"this should be fixed and
// dynamic, there's way too much open space."*
//
// A part is now a flat list of ATOMS. An atom is the smallest thing the packer may put on a
// page on its own: a section bar, one block, one practice item. A page break may fall
// between any two atoms EXCEPT where `glue` forbids it:
//   • a section bar is glued to its first block (never orphan a heading);
//   • a practice list's tag is glued to its first item;
//   • a figure and its caption are one element, so they are one atom by construction;
//   • a `split` / half-layout pair is one atom — side-by-side columns cannot straddle a page.
// A page that opens mid-section repeats that section's bar with "…continued", and the
// packer is charged for that bar exactly (measured in the pass-1 probe page, per section).

/** Merge a class onto a fragment's root element and mark it as a packable atom. */
function decorate(html, cls) {
  const m = /^\s*<[a-zA-Z][\w-]*/.exec(html);
  if (!m) return html;
  const head = m[0];
  const rest = html.slice(head.length);
  const cm = /^[^>]*?class="[^"]*"/.exec(rest);
  const withCls = cm
    ? rest.slice(0, cm[0].length).replace(/class="([^"]*)"$/, `class="$1 ${cls}"`) + rest.slice(cm[0].length)
    : ` class="${cls}"` + rest;
  return head + " data-atom" + withCls;
}

/** Mark a fragment's root as a pass-1 probe element (furniture the packer must pay for). */
function probeTag(html, key) {
  const m = /^\s*<[a-zA-Z][\w-]*/.exec(html);
  return m ? html.slice(0, m[0].length) + ` data-probe="${key}"` + html.slice(m[0].length) : html;
}

/**
 * One packable unit.
 * @param html  the fragment (exactly one root element, plus optional trailing siblings that
 *              belong to it and must not be separated from it)
 * @param o.sec   the section key it belongs to (null for page furniture)
 * @param o.first true when this atom IS the section's own bar
 * @param o.glue  true when no page break may fall immediately AFTER it
 * @param o.sp    which rung of the spacing scale supplies its top margin (0-5)
 */
function atom(html, o = {}) {
  const sp = o.sp == null ? 2 : o.sp;
  return { html: decorate(html, `sp-${sp}`), sec: o.sec || null, first: !!o.first,
    glue: !!o.glue, soft: !!o.soft, sp };
}

/** `move` is the gradual-release step printed as a pill at the reading-end edge, after the
 *  minutes — VENDOR DIVERGENCE (bd-hlk39, SYNC 3.28). It arrives from `section.move`, authored
 *  at D0, so the text is the document's in either language and the renderer holds no label for it.
 *  `fill` overrides the section's own band colour -- VENDOR DIVERGENCE (bd-f6opy, SYNC 3.23).
 *  One section may now print TWO bands (activity: WE DO then YOU DO), and the second needs a
 *  hue of its own while keeping the section's letter, because it IS still that section. */
function bar(id, name, minutes, L, extraCls = "", fill = null, move = null) {
  const m = SECTION_META[id];
  const mv = String(move || "").trim();
  return `<div class="bar ${fill || m.cls}${extraCls ? " " + extraCls : ""}" data-sec="${esc(id)}">
    <span class="badge">${m.letter}</span><span class="nm">${rich(name)}</span>
    ${minutes ? `<span class="mins">${minutes} ${esc(L.min)}</span>` : ""}${
      mv ? `<span class="mv">${esc(mv)}</span>` : ""}</div>`;
}

function p2bar(letter, name, extraCls = "") {
  return `<div class="p2bar${extraCls ? " " + extraCls : ""}" data-sec="p2-${esc(letter)}">
    <span class="badge">${esc(letter)}</span><span class="nm">${esc(name)}</span><span class="rule"></span></div>`;
}

/** Rebuild a section's bar for a page that opens in the middle of it. */
/**
 * Bidi furniture (the 2026-09 mixed-script audit).
 *
 * isoAtom — LRI…PDI around a machine atom printed into RTL chrome. «صفحہ 6-7»
 * paints «7-6» without it (UAX#9 W2/W4/N1: digits after an Arabic-class letter
 * become Arabic Numbers, the hyphen only re-joins EUROPEAN numbers, and the two
 * halves then order RTL). Applied to printed_pages wherever chrome prints it,
 * and to the outcome box's Latin citation atoms. Identity under LTR, so the
 * English render is byte-identical.
 *
 * arrowFor — sequence/answer arrows point WITH the reading direction. Paired
 * brackets auto-mirror under bidi; arrows never do, so an RTL page must emit
 * its own.
 */
const isoAtom = (html, ctx) => (ctx.rtl ? `⁦${html}⁩` : html);
const arrowFor = (ctx) => (ctx.rtl ? "&larr;" : "&rarr;");

/** FSI…PDI — a FIRST-STRONG isolate for an atom whose language is unknowable at
 *  template time (the verbatim SLO quote: English on an EN-medium book, Urdu on
 *  a UR-medium one). The run takes its own direction and keeps its own
 *  punctuation inside, instead of shedding it into the surrounding paragraph. */
const isoQuote = (html, ctx) => (ctx.rtl ? `⁨${html}⁩` : html);

function contBarHtml(key, ctx, secIndex) {
  const info = secIndex[key];
  const L = ctx.L;
  if (!info) return "";
  const name = `${esc(info.title)} &middot; ${esc(L.continued)}`;
  if (info.kind === "p2") {
    return `<div class="p2bar cont" data-sec="p2-${esc(info.letter)}">
      <span class="badge">${esc(info.letter)}</span><span class="nm">${name}</span><span class="rule"></span></div>`;
  }
  const m = SECTION_META[info.id];
  // `info.move` repeats the pill on resume (bd-hlk39): a teacher who lands on page 4 mid-
  // EXPLANATION needs to know which move she is in, which is the entire reason the tag exists.
  // Same reasoning as `info.fill` below, and the same place to carry it.
  const mv = String(info.move || "").trim();
  // `info.fill` for a sub-band (bd-f6opy): a page resuming inside YOU DO must repaint YOU DO's
  // green and say YOU DO's name, not the WE DO band that opened the section five pages earlier.
  return `<div class="bar ${info.fill || m.cls} cont" data-sec="${esc(info.id)}">
    <span class="badge">${m.letter}</span><span class="nm">${name}</span>${
      mv ? `<span class="mv">${esc(mv)}</span>` : ""}</div>`;
}

function contStripHtml(doc, ctx) {
  const p = doc.provenance;
  const L = ctx.L;
  return `<div class="contstrip">${rich(p.topic)} <span>&middot; ${esc(L.grade)} ${p.grade} ${rich(p.subject)} &middot; ${esc(L.continued)}</span></div>`;
}

/**
 * The page footer — v8.1, and the reason this function exists.
 *
 * v8 printed `grade_11_chemistry · PK_G11_CHEM_CH4_MOLE_RATIO … lp_doc 2.0` in the
 * support-page footer. Operator: *"isn't this an internal ref?"* — it is. `lesson_id`,
 * `book_stem` and `schema_version` are OUR keys, and a teacher reading a lesson plan has no
 * use for any of them. They move to the PDF's Info dictionary (lib/pdfmeta.js) and to
 * <stem>.render.json; the page gets words instead:
 *
 *   left   Grade 11 Chemistry · Ch. 4 Stoichiometry · pp. 82-84
 *   right  NIETE Teaching Assistant · page 3 of 5
 *
 * The wordmark lives HERE and not in the hero kicker: "GRADE 9 · CHEMISTRY — NIETE TEACHING
 * ASSISTANT" wrapped onto two lines and pushed the lesson title down every single page.
 * Render-law 13 still holds — no brand in the document means no brand text at all.
 *
 * 2026-09-13 — THE LAST INTERNAL REF, AND THE DOUBLE-PRINTED CHAPTER. Operator: *"the footer
 * contains v2026-09-01 pls remove that tag from the footer as well"*, and *"footer to take no
 * more than 2 lines pls"*. Those are one defect in two halves.
 *
 * `provenance.version` is the date OUR author run stamped the document. It is the same class of
 * key as `lesson_id` and `book_stem`, which is exactly what this function was written in v8.1 to
 * clear off the page, and it has no business surviving the sweep that removed them. It is still
 * carried — pdfmeta.js puts it in the Info dictionary and <stem>.render.json records it — it
 * simply stops printing. "As well" is her word, and it is right: the tag is off the first page
 * already, so this strip was the only place left that showed it.
 *
 * And the strip was over two lines before the date was counted at all. Every authored document
 * has `provenance.chapter` ALREADY ending in `chapter_title` — "Ch. 1 · Matrices and
 * Determinants" beside "Matrices and Determinants" — and this line appended the title anyway, so
 * the left half read "Ch. 1 · Matrices and Determinants — Matrices and Determinants", ran past
 * the 478px column and wrapped. Since v9.3 the halves are STACKED, so a wrap is a THIRD line.
 * Say the chapter once; append the title only for the document whose chapter really is bare
 * ("Ch. 1"), where dropping it would lose the only words naming the lesson's chapter.
 * The nowrap clamp on `.foot .fl` / `.foot .fr` holds the other end — see the sheet.
 */
function footerHtml(doc, ctx, n, total) {
  const p = doc.provenance;
  const L = ctx.L;
  const named = p.chapter_title && !String(p.chapter || "").includes(p.chapter_title);
  const chapter = named ? `${rich(p.chapter)} &mdash; ${rich(p.chapter_title)}` : rich(p.chapter || p.chapter_title);
  const left = `${esc(L.grade)} ${p.grade} ${rich(p.subject)} &middot; ${chapter} &middot; ${esc(L.pp)}${isoAtom(esc(p.printed_pages), ctx)}`;
  const brand = p.brand && p.brand.name ? `<span class="wm">${esc(p.brand.name)}</span> &middot; ` : "";
  return `<div class="foot"><div class="fl">${left}</div><div class="fr">${brand}${esc(L.pageOf(n, total))}</div></div>`;
}

/**
 * G1-5, read off the page truth that produced the document — never off a flag a caller passes,
 * because the profile that applies is a property of the plan, not of the invocation.
 *
 * VENDOR DIVERGENCE (bd-vbs5w, SYNC §3.20). `render_lp.js` has used this rule since the primary
 * page cap landed; page 1's primary furniture needs the same rule, and two copies of a grade
 * test is how a plan ends up capped as primary and laid out as secondary. It lives here because
 * `render_lp` requires this module and not the reverse.
 */
function isPrimary(doc) {
  const g = doc && doc.provenance && doc.provenance.grade;
  return Number.isInteger(g) && g >= 1 && g <= 5;
}

function page1(doc, ctx, secIndex) {
  const L = ctx.L;
  const p = doc.provenance;
  const blk = makeBlockRenderer(ctx);
  // VENDOR DIVERGENCE (bd-vbs5w, SYNC §3.20) — G1-5 gets kie.ai's page-1 furniture. Read off the document, so a plan cannot be
  // capped as primary by render_lp and laid out as secondary here.
  const PRIMARY = isPrimary(doc);
  // v9: the warm-up is INSIDE the introduction, so the introduction's badge already carries
  // its minutes and the pacing line is exactly one number per section. The line must sum to
  // period_minutes — spec §4, and lint's PACING_SUM is the gate.
  const pacing = doc.sections.map((s) => `${s.minutes}`);
  const pacingSum = pacing.reduce((a, b) => a + Number(b), 0);

  // RENDER-LAW 13. The brand is the DEPLOYMENT's, and it comes from the document — never
  // from this file. Absent brand = no brand text at all (white-label), which is the correct
  // default: a teacher in an ICT government school must not read the authoring house's
  // product name on her lesson plan. v8.1 moved the wordmark OUT of this kicker (it wrapped
  // onto a second line on every page) and into the footer.
  //
  // RENDER-LAW 14 (bd-ydz6z). The chips row carries `board_weight` and nothing else. `lp_type`
  // (STEM-2, LL-1, RECALL …) is OUR authoring taxonomy — it picks the Development/Activity
  // internals before a word is written, and a teacher can neither act on it nor look it up. Same
  // defect class the v8.1 footer fixed (`PK_G11_CHEM_CH4_MOLE_RATIO`) and bd-w56zx's
  // `previous: grade_10_urdu.p1c01.r990`: an internal key may live in the document and in the PDF
  // Info dictionary, never on a page a teacher carries into a classroom. `board_weight` is the
  // opposite — it says what the topic is worth in the exam she is preparing them for — so it
  // stays; and where it too is absent (grades 6-8, outside FBISE's examining remit) the row is
  // not painted at all rather than left as an empty gapped flex box under the page line.
  const hero = `<div class="hero">
    <div class="h-col">
      <div class="kicker">${esc(L.grade)} ${p.grade} &middot; ${rich(p.subject)}</div>
      <div class="h-title">${rich(p.topic)}</div>
    </div>
    <div class="h-meta">
      <div>${rich(p.chapter)}</div>
      <div>${esc(L.page)}${isoAtom(esc(p.printed_pages), ctx)} &middot; <b>${doc.period_minutes} ${esc(L.min)}</b></div>
      ${doc.board_weight ? `<div class="chips">
        <span class="tchip plain">${rich(doc.board_weight)}</span>
      </div>` : ""}
    </div>
  </div>`;

  // ── O · LEARNING OUTCOME — ONE BOX, ONE VOICE (bd-a8veu.14) ──────────────
  // Spec §2: "Outcome and objectives are one box — not two stacked blocks." v8 printed the
  // verbatim SLO as the box and the objectives as a list beneath it, which read as two.
  // v9 led with the OUTCOME, then the ✓ line, then the curriculum SLO, then the objectives —
  // which is FOUR statements of one sentence, and on a real grade 6 render the first objective
  // was a character-for-character copy of the outcome.
  //
  // Operator, three times, most recently 2026-09-12: *"The learning outcomess are still stated
  // 3 ways, only the first ones are needed, the curriculum SLO isnt needed neither is the
  // learning outcomes, its just repetition."*
  //
  // So the box paints the outcome and the ✓ line, and nothing else. The ✓ line stays because it
  // is the only place the assessment task and its mark split appear — it says what the outcome
  // is WORTH, it does not restate it.
  //
  // `doc.slo` and `doc.objectives.items` are untouched in the schema: the linter still gates on
  // them, the author still writes them, `slo.code` still titles this box. They stop being PAINTED.
  //
  // WHY THIS LIVES HERE AND NOT IN A BRIEF: bd-a8veu.3 answered this same complaint by editing
  // four author briefs and the linter — zero renderer lines (93e948cf). An author-side rule only
  // fires on a genuine re-author; it cannot reach a stored document, and a template-version bump
  // re-renders stored documents on purpose, for zero model spend. A defect you can see on the
  // page is a renderer defect. Guarded by tests/lp612/outcome-one-voice-render.test.js.
  const O = doc.objectives;
  const sloBox = `<div class="slo">
    <div class="lbl">${esc(L.outcome)}${doc.slo.code ? ` &middot; ${rich(doc.slo.code)}` : ""}</div>
    <p>${rich(O.outcome)}</p>
    ${O.by_the_end ? `<div class="bythe"><b>&#10003;</b> ${rich(O.by_the_end)}</div>` : ""}
  </div>`;

  /**
   * THE RESOURCES LINE — the video, at the top of page 1.
   *
   * Operator, on his first staging pull: *"YT link didnt appear in my lesson? Isnt it supposed to?
   * Somewhere at the top perhaps? In resources?"* It had been printed inside Development, partway
   * down the plan, wrapped around the video's own title. A teacher scanning her plan before class
   * does not find it there.
   *
   * This is a MOVE and not an addition. The same `sections[<development>].video` — written
   * mechanically by the author service from `segment.yt`, never by the model — renders in exactly
   * ONE place. A second copy of the same link on the same document is a defect that costs a page,
   * which is what the coaching-corner version was.
   *
   * COMPACT on purpose: ONE line, not the title/channel/duration/why paragraph the old block
   * printed. Page 1 is the busiest page in the document and this is furniture, so it may cost a
   * LINE, not a paragraph — the page-count gate is real and the teach part is often at its cap.
   *
   * bd-a8veu.4: that line SAYS THE TITLE, and used to say the video id. The operator's own plan
   * printed `youtu.be/7E3NQRBDNXY` — eleven characters of base64, out of which nobody can tell a
   * demonstration from a read-aloud of the same passage. His item 4 is that the picks are
   * re-reads; the pick itself is made upstream by the YouTube swarm and is not ours to change
   * from here, but a teacher who can SEE what she is about to play can skip a bad one before she
   * plays it to a class. It stays one line because the clamp is now CSS (`.vres a`), not a hope
   * that the title is short: a 90-character title on a 478px column would otherwise be three
   * lines of furniture. The url is not lost — it is the href, which is the only part of it she
   * ever used.
   */
  const shortVideoUrl = (v) => {
    if (!v || !v.url) return null;
    const m = /(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(String(v.url));
    if (m) return `youtu.be/${m[1]}`;
    return String(v.url).replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  };

  // VENDOR DIVERGENCE (bd-vbs5w, SYNC §3.20): the label is a parameter because primary's row is a TABLE OF ITS OWN ("you didnt
  // create a table for videos after materials") and titles itself as one, while G6-12's is one
  // row of the resources card and keeps the bare L.video it has always had.
  const videoRow = (label) => {
    const dev = (doc.sections || []).find((x) => x && x.id === "development");
    const v = dev && dev.video;
    const short = shortVideoUrl(v);
    if (!short) return "";
    const href = String(v.url || "");
    // Only http(s) becomes a tap target. The picks come from our own ranker, but an anchor built
    // out of stored data is an anchor someone would eventually like to control.
    if (!/^https?:\/\//i.test(href)) return "";
    // An isolate around the VISIBLE run: an RTL paragraph reorders an embedded latin run into
    // something a teacher cannot read, which is the fix the phone number already carries.
    // The title when there is one, the short url when there is not. `parseYt` requires a title on
    // anything written today, but stored rows predate it, and a video line with no visible run is
    // worse than an id.
    const shownLabel = String(v.title || "").trim() || short;
    // FIRST STRONG (U+2068), not the LRI (U+2066) this carried while the visible run was always a
    // url: the run is now a title, and on an Urdu plan that title is Urdu, which an LRI reverses.
    const shown = ctx.rtl ? `\u2068${shownLabel}\u2069` : shownLabel;
    // PRIMARY also gets the running time. It is four characters and it answers the question the
    // title cannot -- whether the clip fits the period she is planning; G6-12's row is one line
    // of a card already at its page cap, so it stays title-only there.
    const dur = PRIMARY && v.duration ? `<span class="dur">${esc(String(v.duration))}</span>` : "";
    // PRIMARY also gets WHAT THE VIDEO COVERS (bd-nsv74, narrowed in bd-s429u). OPERATOR:
    // *"for the video, just its URL and a description of what it entails is enough."* bd-nsv74
    // shipped the spec's third column too -- a `Match: high|medium|low` pill -- and she cut it.
    // `v.confidence` still rides on the document: it is what ranked the candidates at harvest
    // time, so it is the join's own provenance and dropping it from the schema would lose that.
    // It is simply never painted.
    //
    // The description is VERBATIM and UNLABELLED. Verbatim because spec/05-media.md is explicit
    // -- *"not optional and is not generated prose. It quotes what the video says"* -- and a
    // teacher who can read what the clip actually covers can tell us we picked wrong, which is
    // the job the grade was doing less well. Unlabelled because a second label on a row that
    // already says "Video resource" spends a line's width saying nothing.
    //
    // Both stay off G6-12's row, which is deliberately one compact line on a card already at its
    // page cap (tests/lp612/video-resources-slot.test.js).
    const whyText = PRIMARY ? String(v.why || "").trim() : "";
    const why = whyText ? `<span class="vwhy">${esc(whyText)}</span>` : "";
    return `<div class="vres"><span class="ico">&#128250;</span><span class="lbl">${esc(label)}</span><a href="${esc(href)}">${esc(shown)}</a>${dur}${why}</div>`;
  };
  const resourcesLine = videoRow(L.video);

  /**
   * THE RESOURCES CARD \u2014 everything the teacher must have in her hand, in one box on page 1.
   *
   * Operator, on the v9.3 pull: *"Key words should come on the 1st page, so teachers have their
   * materials listed, videos, and key words. So the 1st page quickly tells the teacher where they
   * are at, what they are teacing, the SLO, the resources, videos and key words of this lesson"*.
   *
   * The hero already says WHERE, the sequence strip says what comes before and after, the outcome
   * box says the SLO. The three things he names were the three that were scattered: the video was
   * here already, the materials were folded into the muted 14px pacing sentence at the very END of
   * the teach part (four pages away from the bell), and the key words were a block buried mid-page
   * inside the Introduction.
   *
   * Like the video move above, this is a MOVE and not an addition \u2014 each of the three renders in
   * exactly ONE place. `sectionAtoms` drops the hoisted keywords block, and the tail keeps only
   * `L.continues`, the one sentence that is true only at the end.
   *
   * The key words move in the RENDERER ONLY. `lint_lp.js`'s VOCAB_PAGE reads the DOCUMENT \u2014 it
   * wants a `keywords` block among the introduction's blocks, carrying a textbook page \u2014 so the
   * lp_doc shape, the author brief, and every `ur_overlay` pointer are untouched by this.
   */
  const kwHoisted = (() => {
    const intro = (doc.sections || []).find((x) => x && x.id === "introduction");
    if (!intro || !Array.isArray(intro.blocks)) return null;
    return intro.blocks.find((b) => b && b.type === "keywords") || null;
  })();

  /** PRIMARY'S FOURTH PANEL -- VENDOR DIVERGENCE (SYNC 3.25), bd-6s5u7.
   *
   *  OPERATOR: *"go ahead with the shim, and move the board to page 1"*, and in her page map:
   *  *"finally there should be a write on the board section here with all the relevant things
   *  that will go on the board"* -- "here" being the page that carries the other three tables.
   *
   *  It was measured on printed page TWO. The board is what a primary teacher sets up BEFORE the
   *  lesson, so it belongs with the other set-up furniture, not four atoms downstream behind the
   *  hook and the warm-up on a sheet she has to turn to while holding chalk.
   *
   *  THE SAME HOIST AS THE KEY WORDS DIRECTLY ABOVE: the block is found by its TYPE inside the
   *  Introduction -- never by an index and never by `board-plan`, which is D0's id and not a
   *  contract -- `sectionAtoms` drops it, and the DOCUMENT keeps it exactly where `lint_lp.js`,
   *  the schema, the author briefs and every `ur_overlay` pointer address it. The board in the
   *  CONCLUSION is a different board and is not touched.
   */
  const bdHoisted = (() => {
    if (!PRIMARY) return null;
    const intro = (doc.sections || []).find((x) => x && x.id === "introduction");
    if (!intro || !Array.isArray(intro.blocks)) return null;
    return intro.blocks.find((b) => b && b.type === "board") || null;
  })();

  /** PRIMARY's third table. Same block, same words, two tracks instead of one box per word —
   *  six key words were six full-width bordered rows, which is six borders spent saying "these
   *  are words".
   *
   *  The label is a SIBLING of the table, not a grandchild inside a `.blk`: it has to be a direct
   *  child of the panel for the one primary rule that takes the label off the left gutter to
   *  reach it, and the meanings are the row on this page that needs the width most -- 230px to
   *  define "present simple tense" was six lines. */
  const kwTable = (b) => `<span class="lbl">${esc(L.keywords)}</span>
    <div class="kwtab">${(b.items || [])
      .map((k) => `<div class="kr"><b>${rich(k.word)}</b><span>${rich(k.meaning)}</span></div>`)
      .join("")}</div>`;

  // Each of the four is its own BLOCK, with its own icon and its own tint (bd-a8veu.16) — see the
  // .rescard comment in the stylesheet for why. The icon leads, the way the video's already did;
  // the label's trailing colon goes with the row, because a block boundary already separates the
  // label from what it labels and a colon on top of it is a mark doing nothing.
  const resourceRows = (() => {
    const rows = [];
    if (!PRIMARY && resourcesLine) rows.push(resourcesLine);
    if (doc.materials && doc.materials.length) {
      // PRIMARY: chips that flow left to right, each drawing its own checkbox — her "indented
      // bullets that go from left to right, no blank spaces". The middle-dot join stays for
      // G6-12, where materials are two or three addresses and not a kit to lay out.
      rows.push(PRIMARY
        ? `<div class="rmat"><span class="lbl">${esc(L.toPrepare)}</span><div class="mlist">${doc.materials.map((m) => `<span class="mi">${rich(m)}</span>`).join("")}</div></div>`
        : `<div class="rmat"><span class="ico">&#129520;</span><span class="lbl">${esc(L.materials)}</span><span>${doc.materials.map((m) => rich(m)).join(" &middot; ")}</span></div>`);
    }
    // PRIMARY: her second table, printed only when there IS a video (bd-jka9b). It used to fall
    // back to "design pending — no video mapped yet" on an unmapped day, on the reasoning that a
    // blank row would read as "no video needed" rather than "not chosen yet". Two things were
    // wrong with that. The reason given was false — the videos sheet was never 403 to the build
    // account, and the SLO join now reads it (bd-v2ikv) — and the note was aimed at us, not at
    // her. OPERATOR, verbatim: *"what is pending is not relevant for Primary."* So an unmapped day
    // prints no video row at all, which is what G6-12 has always done.
    if (PRIMARY) {
      const vr = videoRow(L.videoRes);
      if (vr) rows.push(vr);
    } else {
      // The pacing SUM is a third statement of a number page 1 already carries in the hero and
      // every section bar carries again on its own line. Primary's page 1 is the one she called
      // "more visual, and concise", so on primary it goes; G6-12's card is unchanged.
      rows.push(`<div class="rpace"><span class="ico">&#9201;</span><span class="lbl">${esc(L.pacing)}</span><span>${pacing.join(" + ")} = ${pacingSum} ${esc(L.min)}</span></div>`);
    }
    if (kwHoisted) {
      rows.push(`<div class="rkw"><span class="ico">&#128273;</span>${PRIMARY ? kwTable(kwHoisted) : blk(kwHoisted, FULL_COL)}</div>`);
    }
    return rows;
  })();
  const resourcesCard = `<div class="rescard">${resourceRows.join("")}</div>`;

  // The sequence strip (spec §5), directly under the masthead. Arrows point
  // WITH the reading direction — see arrowFor.
  //
  // Each arrow closes the phrase it leads AWAY from, inside that phrase's own span and with no
  // whitespace before it: an arrow that is a sibling of the phrases is a box of its own, and a
  // box of its own is what gets pushed onto an empty line (bd-a8veu.2). The only break
  // opportunities in the strip are the single spaces BETWEEN phrases, which is where a break
  // belongs. The arrow before `next` therefore rides at the end of `.now`, and only when there
  // is a next period for it to point at.
  //
  // Each leg is a BLOCK (`.seq > span`, bd-a8veu.15) — four statements, four lines. The arrows
  // stay because the stack is the only thing that says these four lines are one sequence and not
  // four unrelated facts; the checkpoint's leading `&middot;` goes, because a separator between
  // two things that no longer share a line is a stray mark.
  const AR = arrowFor(ctx);
  const arrow = `<span class="arrow">${AR}</span>`;
  // ── PRIMARY: the rail and the band replace the strip entirely -- §3.20 ────────────────
  // The strip's four legs say the same four things the band's three columns and the rail say,
  // so on a primary plan the strip does not print at all — one home per source field, on the
  // printed page. `sequence.this` is "Day 6 of 10" for a primary plan (D0 writes it), which is
  // exactly what the rail draws; when the rail cannot draw it, that string prints as the small
  // line inside TODAY, so the day count is never lost and never doubled.
  const sq = doc.sequence || null;
  const railable = PRIMARY && sq
    && Number.isInteger(sq.day) && Number.isInteger(sq.of)
    && sq.of >= 2 && sq.of <= 12 && sq.day >= 1 && sq.day <= sq.of;
  const drail = railable
    ? `<div class="drail">${Array.from({ length: sq.of }, (_, i) => {
        const n = i + 1;
        return `<span class="d${n === sq.day ? " on" : n < sq.day ? " done" : ""}">${n}</span>`;
      }).join("")}</div>`
    : "";
  const bandCell = (cls, label, inner) =>
    `<div class="${cls}"><span class="lbl">${esc(label)}</span><div class="t">${inner}</div></div>`;
  const band = PRIMARY && sq
    ? `<div class="band">${bandCell("jrn", L.journey, sq.previous ? rich(sq.previous) : esc(L.journeyNone))}${bandCell(
        "today", L.today,
        `${rich(p.topic)}${!railable && sq.this ? `<span class="dtext">${rich(sq.this)}</span>` : ""}`
      )}${bandCell(
        "up", L.comingUp,
        `${sq.next ? rich(sq.next) : ""}${sq.checkpoint ? `<span class="cp">${esc(L.seqCheck)}: ${rich(sq.checkpoint)}</span>` : ""}`
      )}</div>`
    : "";

  const seq = !PRIMARY && doc.sequence
    ? `<div class="seq">${doc.sequence.previous ? `<span><b>${esc(L.seqPrev)}:</b> ${rich(doc.sequence.previous)}${arrow}</span>` : ""}
       <span class="now">${rich(doc.sequence.this)}${doc.sequence.next ? arrow : ""}</span>
       ${doc.sequence.next ? `<span><b>${esc(L.seqNext)}:</b> ${rich(doc.sequence.next)}</span>` : ""}
       ${doc.sequence.checkpoint ? `<span><b>${esc(L.seqCheck)}:</b> ${rich(doc.sequence.checkpoint)}</span>` : ""}</div>`
    : "";

  // The warm-up is ONE ROW inside the Introduction (spec §2) — not a section, not a band of
  // its own. The scaffold item comes first and says so; prior knowledge alone is not a warm-up.
  const warmupBody = (wu) => `<div class="blk wu"><div class="lbl g">${esc(L.warmup)}</div>${wu.items
    .map(
      (it, i) => `<div class="it"><span class="n">${i + 1}.</span>
        <span class="q">${rich(it.q)} <span class="a">${AR} ${rich(it.a)}</span></span>
        <span class="kind">${esc(L.kind[it.kind] || it.kind)}${it.from ? ` &middot; ${rich(it.from)}` : ""}</span></div>`
    )
    .join("")}</div>`;

  /* VENDOR DIVERGENCE (bd-usirc, SYNC §3.22). THE OPENING IS ONE BOX: SETTLE, THEN PROVOKE.
   * The warm-up and the hook are one move in a classroom and were two boxes on the page, far
   * enough apart that the corpus render ended page 1 on the warm-up and opened page 2 on the
   * hook. They stay TWO ATOMS -- an atom never splits, and the pair is ~920px against A4's
   * 1063px box -- and gain the classes that draw one frame around both, with no rhythm margin
   * on the seam so the bands touch. Primary only; a G6-12 plan keeps two independent blocks. */
  const intro = (doc.sections || []).find((s) => s.id === "introduction") || {};
  const openWarm = PRIMARY && !!intro.warmup;
  const openHook = PRIMARY ? (intro.blocks || []).find((b) => b.type === "ask" && b.hook) : null;
  // Appends to the FIRST class attribute, which is the atom root's -- the same place `decorate`
  // puts the rhythm class. String.replace with a string pattern replaces one occurrence.
  const openBand = (html, first, last) =>
    html.replace('class="', 'class="opn' + (first ? " ofirst" : "") + (last ? " olast" : "") + " ");

  // ── the per-section EXTRAS the closed heading system requires ────────────
  // These are section-level DATA, not blocks: the warm-up row (I), the textbook citation and
  // the video (D), the checkpoint / exit ticket / re-teach rule (C), the tagged homework (H).
  // They render in a fixed position inside their section so a teacher finds them in the same
  // place in every plan — which is the whole point of a closed heading system.
  const flowHost = flowHosts(doc);
  const before = (s) => {
    const out = [];
    if (s.id === "introduction" && s.warmup) {
      // SOFT, not glued. `glue` would forbid the break outright and measured at +7 pages over
      // the 38-lesson corpus; `soft` only outranks front-loading, so the box stays whole
      // wherever staying whole is free and yields where it is not. When it does yield, each
      // band is still a closed rectangle -- see the seam note in the stylesheet.
      const html = openWarm ? openBand(warmupBody(s.warmup), true, !openHook) : warmupBody(s.warmup);
      out.push({ html, sp: 2, glue: false, soft: !!openHook });
    }
    if (s.id === "development" && s.textbook_page) {
      out.push({ html: `<div class="blk"><span class="cite">${esc(L.fromBook)} ${esc(L.page)}${rich(s.textbook_page)}</span></div>`, sp: 1, glue: true });
    }
    return out;
  };
  const after = (s) => {
    const out = [];
    // The video used to print HERE, mid-Development. It now renders once, in the resources
    // line at the top of page 1 — see resourcesLine. Do not re-add it here: two copies of one
    // link on one document is the defect that cost a page on the part already at its cap.
    //
    // bd-a8veu.7: the board plan lands here, at the END of the Introduction — the brief's
    // canonical section closes on its own `board` note, so the picture of the finished board
    // sits directly under the sentence that tells the teacher what to write. See boardPlanAtoms.
    // On PRIMARY both halves of the board are hoisted together (SYNC 3.25). Splitting them --
    // the panels to write on page 1, the picture of the finished board four atoms later -- would
    // be worse than the defect being fixed: one board, described twice, a page turn apart.
    if (s.id === "introduction" && !PRIMARY) out.push(...boardPlanAtoms(doc, ctx));
    // bd-a8veu.10: the two groups that used to stand alone in Reference land where they are
    // used — mistakes at the close of the teaching, differentiation at the close of the
    // practice, after the items it differentiates. `page2()` no longer paints either unless
    // this document has no host for it. See flowHosts.
    const P2 = doc.page2 || {};
    if (s.id === flowHost.mistakes) out.push(...groupAtoms(L.p2Mistakes, (P2.mistakes || []).map((m) => misCard(m, L))));
    if (s.id === flowHost.differentiation && P2.differentiation) {
      out.push(...groupAtoms(L.p2Diff, diffCards(P2.differentiation, L)));
    }
    if (s.id === "conclusion") {
      if (s.checkpoint) {
        const c = s.checkpoint;
        out.push({ html: `<div class="blk ck"><div class="lbl">${esc(L.checkpoint)}${c.marks ? ` &middot; ${c.marks} ${esc(L.marks)}` : ""}</div>
          <div class="q">${rich(c.question)}</div>
          <ul>${(c.mark_scheme || []).map((m) => `<li>${rich(m)}</li>`).join("")}</ul></div>`, sp: 3 });
      }
      if (s.exit_ticket) {
        out.push({ html: `<div class="blk exit"><div class="lbl">${esc(L.exitTicket)}</div>${s.exit_ticket
          .map((x, i) => `<div class="it"><span>${i + 1}.</span><span>${rich(x.q)} <span class="a">${AR} ${rich(x.a)}</span></span></div>`)
          .join("")}</div>`, sp: 2 });
      }
      if (s.reteach_rule) {
        out.push({ html: `<div class="blk reteach"><div class="lbl">${esc(L.reteach)}</div><div class="t">${rich(s.reteach_rule)}</div></div>`, sp: 2 });
      }
    }
    if (s.id === "homework" && s.homework) {
      // NO ANSWERS HERE. Defect class E: the reviewed plan printed the answer beside the
      // question, so the homework taught nothing. The answers live in reference F.
      //
      // bd-x4xxm: ONE ATOM PER ITEM, on the YOU-DO practice precedent in blockAtoms() above.
      // As one atom this list was the teach part's tallest tail block (median 348px, max 421px)
      // and it stranded the last teach page at 43% on every teach-side packing failure in the
      // 2026-09-03 study. The split is visually lossless: `.hw` is a flex column whose only
      // separation is `gap:var(--sp-1)`, each `.hw .it` carries its own border and background,
      // and `.blk` is `margin:0` with no box of its own — so N one-item wrappers paint exactly
      // what one N-item wrapper painted, with the 4px gap returning as the atom's sp-1 margin.
      //
      // THE TAG IS THE BLOOM'S LEVEL ALONE. Operator, 2026-09-13: "HW has O1,O2 type marking
      // with Blooms tag, the tag can remain, but the O1 type objective tagging should be gone".
      // [K] / [U] / [A] tells a teacher what the question asks a student to DO, which is the
      // reason the tag is on the page at all. `slo_code` is a curriculum key -- `M-09-A-07` on a
      // maths plan, `O1` on hers -- and it is OURS, the same class of internal ref this document
      // was cleared of in v8.1 and again in the footer today. The item still CARRIES `slo_code`:
      // the objectives band reads it and lint_lp.js's coverage rules check against it. It simply
      // stops printing beside the question.
      const hwItem = (it, i) => `<div class="it"><span class="n">${i + 1}.</span>
          <span class="q">${rich(it.text)}${it.source && (it.source.page || it.source.questions || it.source.paper)
            ? ` <span class="src">(${[it.source.paper, it.source.questions, it.source.page ? `${L.page}${it.source.page}` : null].filter(Boolean).map((x) => rich(x)).join(", ")})</span>` : ""}</span>
          <span class="tag">[${esc(it.level)}]${it.marks ? ` ${it.marks}${esc(L.markAbbr)}` : ""}</span></div>`;
      s.homework.items.forEach((it, i) => {
        out.push({ html: `<div class="blk hw">${hwItem(it, i)}</div>`, sp: i === 0 ? 2 : 1 });
      });
    }
    return out;
  };

  // A half section sits in a two-column secrow (gap --sp-3), so its figures get half the width.
  const HALF_COL = Math.floor((PAGE_INNER_W - 12) / 2) - FIG_CHROME;
  const whole = (s, colPx) => `<div class="sec">${bar(s.id, s.title || L[s.id], s.minutes, L, "", null, s.move)}
      ${before(s).map((x) => x.html).join("\n")}
      ${(s.blocks || []).map((b) => blk(b, colPx)).join("\n")}
      ${after(s).map((x) => x.html).join("\n")}</div>`;

  // Which blocks get the wider rung: the loudest boxes on the page, and anything with a
  // picture in it. "Breathing room" is not one uniform gap — it is a hierarchy.
  const LOUD = new Set(["diagram", "textbook_figure", "watch_out", "latex", "chem"]);

  /* VENDOR DIVERGENCE (SYNC §3.18). A WORKED OR FADED EXAMPLE IS THE ONLY BLOCK BIGGER THAN
     A PAGE, and that is what was printing content-free pages.

     Measured over the 30 Latin G4 Ch9 lessons: `.exq.we` has a median height of 1490px and a
     max of 2500px against a 1986px page box, and ALL 30 exceed the 493px a page typically has
     left at its foot. `.exq` is 723px median, 50 of 60 over. Together they are 45.7 pages of
     the corpus's 256. As ONE atom such a block demands a page of its own and overflows it, and
     the section bar glued in front of it then cannot join it -- so `glue`'s stand-alone escape
     hatch strands the bar on a page by itself. English_seg6 p6, English_seg10 p5, Maths_seg11
     p5, Maths_seg9 p7 and Science_seg2 p6 each printed a continuation strip, a section bar and
     the footer over an otherwise empty sheet, 6% full. The never-orphan-a-heading rule was
     producing the most orphaned heading the document can hold.

     packAtoms is not at fault: it is an exact DP and is page-optimal FOR THE ATOMS IT IS GIVEN.
     It cannot put half a block in a hole because there was no half block. So the fix is atom
     granularity, exactly as `practice` (v8.1) and `homework` (bd-x4xxm) already do it.

     WHERE IT MAY BREAK, which is a pedagogy decision and not a layout one (operator,
     2026-09-17): between TURNS, never between a prompt and the thing that answers it. A turn's
     `expect` pills live inside that turn's own `.tn`, so an `ask` can never be separated from
     its response row -- the seam is only ever the 2px gap `.scr` already draws. The tag and the
     setup stay glued to turn 1 so a page can never open on a bare line of speech, and the
     closing `res`/`answer` travels in the same atom as the last turn so the result can never be
     stranded from the work that produced it.

     PAINTS AS ONE CARD. `.blk` is `margin:0` with no box of its own; the box is `.exq`. The
     pieces carry `.pc-a` / `.pc-m` / `.pc-z`, which open the borders and radii at the seams and
     zero the padding there, so N pieces butting at sp-0 paint what one card painted. The only
     difference is the 2px `.scr` gap at a seam, which is 2px of amber against 2px of amber.
     When a break DOES fall at a seam the two `.pad`-level rules below draw a dashed edge, so a
     card that continues overleaf says so and a card that ended still closes solid. */
  const exqAtoms = (b) => {
    const r = scriptRows(b, rich, L);
    const we = b.type === "faded_example" ? " we" : "";
    const tag = `<span class="tag">${rich(b.title || (we ? L.faded : L.worked))}</span>`;
    const setup = !b.prompt ? ""
      : we ? `<ul class="setup">${b.prompt.split(" \u00b7 ").map((x) => `<li>${rich(x)}</li>`).join("")}</ul>`
        : `<div class="prompt">${rich(b.prompt)}</div>`;
    const tail = (we
      ? (b.answer ? `<div class="res">${esc(L.answer)}: ${rich(b.answer)}</div>` : "")
      : (b.result ? `<div class="res">${rich(b.result)}</div>` : "")) + cfuRow(b, rich, L);
    const piece = (cls, inner, o) => ({ html: `<div class="blk exq${we} pc ${cls}">${inner}</div>`, ...o });
    const last = r.rows.length - 1;
    const out = [piece("pc-a", `${tag}${setup}<div class="scr">${r.head}${r.rows[0]}</div>`,
      { sp: 2, glue: true })];
    for (let i = 1; i < last; i++) out.push(piece("pc-m", `<div class="scr">${r.rows[i]}</div>`, { sp: 0 }));
    out.push(piece("pc-z", `<div class="scr">${r.rows[last]}</div>${tail}`, { sp: 0 }));
    return out;
  };

  const blockAtoms = (b, colPx) => {
    // Four turns is where a script first has a seam worth having: three rows or fewer already
    // fit the median 347px tail whole, so splitting them would buy nothing and cost a seam.
    if ((b.type === "worked_example" || b.type === "faded_example")
        && Array.isArray(b.turns) && b.turns.length >= 4) {
      return exqAtoms(b);
    }
    if (b.type === "practice" && Array.isArray(b.items) && b.items.length >= 3) {
      // YOU-DO lists are the one body block that may break BETWEEN items (operator, v8.1) —
      // the tag stays glued to item 1 so a page never opens on a bare numbered line.
      //
      // PRIMARY PAINTS THE PIECES AS ONE CARD (bd-f6opy, SYNC 3.23). YOU DO had no surface of its
      // own, and a box per item would be 24 boxes in the longest corpus lesson. The `.pc-*` seam
      // classes and the sp-0 butt are `.exq`'s idiom (SYNC 3.18) reused verbatim; G6-12 emits
      // neither, so it renders exactly as it did.
      const seam = (cls) => (PRIMARY ? ` pc ${cls}` : "");
      const last = b.items.length - 1;
      const out = [{
        html: `<div class="blk pr${seam("pc-a")}"><span class="tag">${rich(blk.practiceTag(b))}</span>
          <div class="items">${blk.practiceItem(b.items[0], 0)}</div></div>`,
        sp: 2, glue: true,
      }];
      for (let i = 1; i <= last; i++) {
        out.push({
          html: `<div class="blk pr${seam(i === last ? "pc-z" : "pc-m")}"><div class="items">${blk.practiceItem(b.items[i], i)}</div></div>`,
          sp: PRIMARY ? 0 : 1,
        });
      }
      return out;
    }
    if (openHook && b === openHook) {
      // sp 0 is the seam: the hook band sits directly on the warm-up band. With no warm-up above
      // it the hook IS the whole box, and takes the loud rhythm it has always had.
      return [{ html: openBand(blk(b, colPx), !openWarm, true), sp: openWarm ? 0 : 3 }];
    }
    const loud = (b.type === "ask" && b.hook) || LOUD.has(b.type);
    return [{ html: blk(b, colPx), sp: loud ? 3 : 2 }];
  };

  /* ONE BAND PER MOVE -- VENDOR DIVERGENCE (bd-f6opy, SYNC 3.23).
     OPERATOR: *"Split the shared 'We Do / You Do' green band into two bands so each move is its
     own landmark."* One green band spanned five pages and told her nothing about which half of
     it she was in: the half where the class practises together, or the half where the children
     work alone. They are two moves and a teacher navigates by them.

     MATCHED ON THE BLOCK GRAMMAR, NEVER ON AN INDEX. The opening block of the second band is the
     first whose id reads `you-do` once punctuation is stripped -- which catches `you-do-task`,
     the "set the task going" instruction that LAUNCHES the independent work and therefore belongs
     under its band, as well as `youdo` and `you-do`. A plan whose activity has no you-do block at
     all, or which opens on one, keeps the single band it has always had.

     EACH BAND CARRIES ITS OWN MOVE'S MINUTES, off that move's own block, so the numbers stay the
     real ones the author wrote (5 and 7, not a halved 12). NO WORD IS DELETED: the section title
     was the concatenation "We Do / You Do" and the split prints BOTH halves, each over the half
     of the section it names.

     `whole()` is deliberately untouched -- it renders only a `layout:"half"` pair in two columns,
     and no primary plan in the corpus sets `layout` at all. */
  const YOU_SUB = "activity:you";
  const moveSplit = (s) => {
    if (!PRIMARY || s.id !== "activity") return null;
    const key = (b) => String(b.id || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const at = (s.blocks || []).findIndex((b) => key(b).startsWith("youdo"));
    if (at <= 0) return null;
    const minsOf = (pre, type) => {
      const b = (s.blocks || []).find((x) => key(x).startsWith(pre) && (!type || x.type === type));
      return b && b.minutes;
    };
    return { at, we: minsOf("wedo"), you: minsOf("youdo", "practice") };
  };

  const sectionAtoms = (s, colPx) => {
    const id = s.id;
    const split = moveSplit(s);
    const title = split ? L.weDo : (s.title || L[id]);
    const fill = split ? "s-we" : null;
    secIndex[id] = { kind: "p1", id, title, fill, move: s.move };
    const out = [atom(bar(id, title, split ? split.we : s.minutes, L, "", fill, s.move),
      { sec: id, first: true, glue: true, sp: 4 })];
    let sec = id;
    for (const x of before(s)) out.push(atom(x.html, { sec, glue: x.glue, soft: x.soft, sp: x.sp }));
    // bd-7l7ne -- `blocks` is required by the schema, and the ONLY thing that removes it is the
    // primary prune emptying it. The section is still here because something else in it is real:
    // on the G3 Maths sample the Check bar survives on its authored exit ticket while its one
    // wholly-pending list goes. Read it defensively, like every other painter on this path.
    for (const b of s.blocks || []) {
      // the key words are printed once, in the resources card at the top of the page
      if (kwHoisted && b === kwHoisted) continue;
      // and the board is printed once, as the last panel of the set-up furniture (SYNC 3.25)
      if (bdHoisted && b === bdHoisted) continue;
      if (split && b === (s.blocks || [])[split.at]) {
        // The sub-band is a FIRST atom under its own continuation key, so the packer probes and
        // charges for its height like any other bar, and a page resuming here repaints YOU DO.
        secIndex[YOU_SUB] = { kind: "p1", id, title: L.youDo };
        out.push(atom(bar(id, L.youDo, split.you, L), { sec: YOU_SUB, first: true, glue: true, sp: 4 }));
        sec = YOU_SUB;
      }
      for (const a of blockAtoms(b, colPx)) out.push(atom(a.html, { sec, glue: a.glue, soft: a.soft, sp: a.sp }));
    }
    // `glue` is forwarded here exactly as it is for before(s) above. No atom from after()
    // sets it today, so this changes nothing — but the asymmetry was a trap: an atom that
    // declared glue would have had it dropped on the floor, silently, and now that the
    // packer chooses its breaks freely a dropped glue is a split a reader sees.
    for (const x of after(s)) out.push(atom(x.html, { sec, glue: x.glue, soft: x.soft, sp: x.sp }));
    return out;
  };

  // The hero and the sequence strip are the page's masthead: a break under either of them
  // would print a sheet carrying a title and nothing else. Greedy could never do that — it
  // fills first — so neither was ever marked. An exact packer has to be told.
  const A = [atom(hero, { sp: 0, glue: true })];
  if (seq) A.push(atom(seq, { sp: 2, glue: true }));
  // Both are masthead too, and both are glued for the same reason the strip is: a break under
  // either would print a sheet carrying a title and nothing else.
  if (drail) A.push(atom(drail, { sp: 2, glue: true }));
  if (band) A.push(atom(band, { sp: 2, glue: true }));
  A.push(atom(sloBox, { sp: 2 }));
  // Directly under the outcome box: the first thing after "what the pupil can do".
  //
  // PRIMARY: THREE PANELS, THREE ATOMS, because an atom never splits and her page map says
  // "this should all be on page 1". As one atom the whole 570px card moved together: on A4
  // (inner box 1063px) page 1 ran out at ~505px and every panel went to page 2, leaving half
  // the review sheet blank with the to-prepare list on the next one. They are already three
  // separate surfaces on the page -- own tint, own icon, own label -- so only the wrapper was
  // holding them together; each keeps its own `.rescard` root, so no style rule moves, and
  // `sp: 1` reproduces the `gap:var(--sp-1)` the wrapper used to draw between them.
  //
  // G6-12 STAYS ONE ATOM. Its rows are one-liners that read as a single card of addresses, and
  // a break between two of them would be a page turn in the middle of a list.
  if (PRIMARY) {
    resourceRows.forEach((r, i) => A.push(atom(`<div class="rescard">${r}</div>`, { sp: i ? 1 : 2 })));
  } else {
    A.push(atom(resourcesCard, { sp: 2 }));
  }

  // WRITE ON THE BOARD closes the set-up furniture -- SYNC 3.25, bd-6s5u7. Her page map puts it
  // "finally", after the three tables, which is also the order the teacher works in: she reads
  // what to prepare, then she picks up the chalk. The panels first and the finished board under
  // them, the order they had inside the Introduction, so nothing about the pair reads differently
  // for having moved. `glue` is left to `boardPlanAtoms`' own atoms, which already carry it.
  if (bdHoisted) {
    A.push(atom(blk(bdHoisted, FULL_COL), { sp: 2 }));
    for (const x of boardPlanAtoms(doc, ctx)) A.push(atom(x.html, { glue: x.glue, sp: x.sp }));
  }

  // consecutive layout:"half" sections share one two-column band. Each keeps its own
  // lettered bar, so the closed heading vocabulary survives; only the stacking goes away.
  // A band is ONE atom: two columns cannot straddle a page break.
  for (let i = 0; i < doc.sections.length; i++) {
    const s = doc.sections[i];
    const n = doc.sections[i + 1];
    if (!PAGE.oneColumn && s.layout === "half" && n && n.layout === "half") {
      A.push(atom(`<div class="secrow">${whole(s, HALF_COL)}${whole(n, HALF_COL)}</div>`, { sp: 4 }));
      i++;
    } else {
      A.push(...sectionAtoms(s, FULL_COL));
    }
  }

  // The materials and the pacing moved UP into the resources card; what stays here is the one
  // sentence that is only true at the end of the teach part — the next sheet is planning material.
  const mats = `<div class="mats">
    <div class="cont">${esc(L.continues)}</div>
  </div>`;
  A.push(atom(mats, { sp: 4 }));

  return { part: "teach", atoms: A };
}

/** Strip an author's own leading "1." / "2)" / "۳۔" — the <ol> supplies the number.
 *  Without this the board plan printed "1. 1. Draw the leaf". */
function unnumber(s) {
  return String(s ?? "").replace(/^\s*[0-9\u0660-\u0669\u06F0-\u06F9]{1,2}\s*[.)\u06D4\u060C:\u2013-]\s+/, "");
}

/**
 * The board plan — the FINAL STATE of the board plus the order to build it — as teach-part atoms.
 *
 * bd-a8veu.7. This pair used to print as REFERENCE SECTION A, on the sheet whose own masthead
 * tells the teacher not to read it in class, four pages from the chalk. The author brief calls
 * `page2.board_final` "the single most requested artefact a teacher asked for" and requires the
 * diagram — and a plan for a board is worth nothing once the board is built. It belongs under the
 * Introduction's own ON THE BOARD note, where the teacher first picks up the chalk: she sees what
 * she is building toward before she starts laying it out.
 *
 * This is a MOVE, not a copy. `page2()` no longer emits the section at all, and `S` paints nothing
 * for a section whose bodies are all empty, so the support index closes up and B becomes A by
 * itself (render-law 15). Nothing outside `page2()` keys off the letter. The DOCUMENT is untouched:
 * `page2.board_final` is still where the schema, lint, the author briefs and every `ur_overlay`
 * pointer address it — exactly as the key words stayed in `introduction.blocks` when they were
 * hoisted into the resources card for bd-a8veu.6.
 *
 * The figure carries `glue`, so the order can never be stranded on the next sheet — the whole use
 * of the pair, and the reason the old section A comment existed.
 */
/** Does this document print its board in build order, rather than describe one? */
function laidOutBoard(doc) {
  return (doc.sections || []).some((s) => (s.blocks || []).some(
    (b) => b && b.type === "board" && Array.isArray(b.panels) && b.panels.length > 0));
}

function boardPlanAtoms(doc, ctx) {
  const L = ctx.L;
  const B = (doc.page2 && doc.page2.board_final) || null;
  if (!B) return [];
  const out = [];

  if (B.diagram) {
    let svg;
    try {
      svg = ctx.renderDiagram(B.diagram);
    } catch (e) {
      ctx.warn(`board plan diagram did not render: ${e.message}`);
      svg = ctx.placeholder(B.diagram);
    }
    ctx.vectorFigure = true;
    // PHONE-FIRST LABELS, primary only -- VENDOR DIVERGENCE (SYNC 3.24), bd-u9vji. The board plan
    // is the SECOND place a figure is emitted, and it was found by measuring rather than reading:
    // the shim narrowed the block diagram to 340px and the page still reported 185, because that
    // was this figure. A floor that holds at one emission site and not the other prints two sizes
    // of the same alphabet on one lesson. Same gate as R.diagram -- primary, and only where the
    // author left `width` unset.
    let boardFloor = DIAGRAM_MIN_PX;
    if (ctx.primary && B.diagram.width == null) {
      const redrawn = primaryRedraw(B.diagram, svg, ctx.renderDiagram);
      svg = redrawn.svg;
      boardFloor = redrawn.floorPx;
      if (redrawn.repair) ctx.figureRepair(redrawn.repair);
    }
    // Same repair as R.diagram (bd-oak77.14) — this figure is always full-width, so it always
    // qualifies. A second copy of the sizing rule that silently omitted the widening would fail
    // for a defect the rest of the teach page recovers from.
    const slot = figureFit(svg, FULL_COL, FIG_GROW_MAX, boardFloor);
    if (slot.growPx) {
      ctx.figureRepair({
        code: "FIGURE_WIDENED",
        specType: B.diagram.type || null,
        caption: null,
        colPx: FULL_COL,
        growPx: slot.growPx,
        neededPx: slot.neededPx,
        renderedPxBefore: slot.renderedPxBefore,
        renderedPxAfter: slot.renderedPx,
        floorPx: boardFloor,
      });
    }
    const styleBits = [];
    if (slot.maxHeightPx) styleBits.push(`--fig-h:${slot.maxHeightPx}px`);
    if (slot.growPx) styleBits.push(`--fig-wide:${slot.growPx}px`);
    const style = styleBits.length ? ` style="${styleBits.join(";")}"` : "";
    // board_final.caption is a SEPARATE authored string from the diagram spec's own caption
    // (which the SVG already prints). Print it only when it says something different.
    const cap = B.caption && B.caption !== B.diagram.caption ? B.caption : null;
    const fig = `<figure class="dg"${style}>${svg}${cap ? `<figcaption>${rich(cap)}</figcaption>` : ""}</figure>`;
    // A bare `.blk` label, NOT the `.blk board` box: that box carries 13px of side padding, and
    // `figureFit` has already sized the SVG against the full column. Boxing it here would crop
    // the widening the repair just granted.
    out.push({ html: `<div class="blk"><div class="lbl">${esc(L.p2Board)}</div>${fig}</div>`, sp: 2, glue: true });
  }

  // VENDOR DIVERGENCE (SYNC §3.16) -- the plan is dropped when the board itself is on the page.
  //
  //   *"its a block of text that should show clearly how it should be ordered rather than give a
  //    script of what to draw and how"*  (operator)
  //
  // `board_final.draw_order` is a script FOR a board: "Draw the five-line cinquain ladder and the
  // grammar choice arrows". It earns its space while the board is only described. It stops earning
  // it the moment the board is PRINTED in build order -- which is what a `board` block carrying
  // `panels` is, and it prints a few centimetres above this atom, inside the same Introduction.
  // Two accounts of one board, one of them prose, is exactly the wall she was reading.
  //
  // Suppressed at the RENDERER, not at D0: `page2.board_final` is a required property, and a grade
  // band that stopped emitting it would be asking the schema to bend for one band. The field stays
  // in the document for lint and for Stage C; it simply has nowhere left to print. The rule is not
  // primary-specific either -- any doc whose flow lays its board out gets the same drop.
  const order = laidOutBoard(doc) ? [] : (B.draw_order || []);
  if (order.length) {
    out.push({
      html: `<div class="card"><span class="lbl">${esc(B.diagram ? L.drawOrder : L.p2Board)}</span>
      <ol class="ord">${order.map((d) => `<li>${rich(unnumber(d))}</li>`).join("")}</ol></div>`,
      sp: 1,
    });
  }
  return out;
}

/**
 * bd-a8veu.10 — WHERE the two in-flow reference groups are allowed to land.
 *
 * Operator: *"common mistakes should be in the part where its needed much like how its in
 * opening, not stand alone as reference. Differentiation should also be part of practice where
 * students are going to do work, not in reference"*.
 *
 * The host is LOOKED UP, never hardcoded at the emission site, for two reasons. Differentiation
 * is addressed to "where students are going to do work", which is a property of the BLOCKS a
 * section carries (`practice` / `faded_example`), not of its id — a plan that puts its practice
 * in Development rather than Activity still gets it in the right place. And a null host is a
 * real answer: it means "there is nowhere in the flow for this", and the group stays in
 * Reference. Content may move; it may never vanish.
 *
 * @returns {{mistakes: string|null, differentiation: string|null}} section ids, or null
 */
function flowHosts(doc) {
  const secs = doc.sections || [];
  const practice = secs.find((s) => (s.blocks || []).some((b) => b.type === "practice" || b.type === "faded_example"));
  return {
    mistakes: secs.some((s) => s.id === "development") ? "development" : null,
    differentiation: practice ? practice.id : null,
  };
}

/** One authored misconception: what the pupil writes, and the question you ask back. */
const misCard = (m, L) => {
  // bd-7l7ne -- the halves are painted independently because the primary prune can take one and
  // leave the other: on the G3 Maths sample the question the teacher asks back is authored and
  // only what the pupil writes is pending. Half a card is worth keeping; a labelled blank is not.
  const x = m.pupil_says == null ? ""
    : `<div class="x"><span class="lbl">&#10007; ${esc(L.pupilSays)}</span><p>${rich(m.pupil_says)}</p></div>`;
  const v = m.you_ask == null ? ""
    : `<div class="v"><span class="lbl">&#10003; ${esc(L.youAsk)}</span><p>${rich(m.you_ask)}</p></div>`;
  return x || v ? `<div class="mis">
      ${x}
      ${v}</div>` : "";
};

/** The three differentiation cards, in the order a teacher reaches for them mid-practice. */
const diffCards = (D, L) => [
  ["stuck", D.stuck], ["barrier", D.barrier], ["early", D.early],
]
  // bd-7l7ne -- a missing key means the primary prune took that card; the other two still print,
  // and `gridRows` already sizes a short row (render-law 15), so nothing downstream has to know.
  .filter(([, text]) => text != null)
  .map(([key, text]) => `<div class="card"><span class="lbl">${esc(L[key])}</span><p>${rich(text)}</p></div>`);

/**
 * A labelled card group as FLOW atoms — the shape `gridRows` gives the support page, plus the
 * label the section bar used to supply.
 *
 * ONE CARD PER ATOM, because `PAGE.oneColumn` makes a row a card and a break may never fall
 * inside a row: three cards in one atom would force all three onto a fresh page. The LABEL rides
 * in the same atom as card 1 — the YOU-DO precedent in `blockAtoms` — so a page can never open
 * on a bare card with no statement of what it is a card of.
 *
 * A bare `.blk` wrapper, not a boxed one: `.blk` is `margin:0` with no box, so the label sits on
 * the group with nothing drawn around it. It is a `.lbl.g`, not a plain `.lbl` — this label heads
 * three sibling cards that carry plain `.lbl`s of their own, and without the group level the
 * heading and its own children print identically.
 */
/**
 * A card grid, emitted ONE ROW PER ATOM instead of one atom for the whole grid.
 *
 * bd-x4xxm. A grid of N cards used to be a single atom, so the packer had nowhere legal to
 * break inside it and had to push the whole block to a fresh page. Measured on the 24 real
 * lessons of the 2026-09-03 study, that stranded up to 453px — nearly half a page — right
 * before section F, whose homework_key grid is the tallest thing on the support page
 * (median 496px, max 853px). Twelve of the twenty over-cap parts in that study held LESS
 * content than their own cap allows; the content fitted and the BREAKS were in the wrong
 * places.
 *
 * Splitting by ROW is visually lossless, and that is why the row is the chosen cut:
 *   • `.grid2` / `.grid3` are `display:grid` with `gap:var(--sp-2)`, and CSS grid sizes each
 *     row to its own tallest card — so N separate one-row grids lay out identically to one
 *     N-card grid at the same container width;
 *   • the row gap the split removes is put straight back as the atom's own top margin, and
 *     `.pad > .sp-2` is the same 8px that gap was;
 *   • a break still may never fall INSIDE a row — two columns cannot straddle a page break —
 *     which is exactly what keeping each row whole preserves.
 *
 * This is the cut already shipped for the two structures either side of these: YOU-DO
 * practice items and the exam bank's MCQs are each their own atom for this identical reason.
 * The inconsistency was the bug; nothing here changes what is on the page.
 *
 * @param cls     "grid2" | "grid3" — the class carries the column count
 * @param cards   already-rendered card HTML, one string per card
 * @param firstSp the rung the FIRST row sits at (it follows the section bar, not a gap)
 */
// VENDOR DIVERGENCE (bd-ip4xh, SYNC 3.30): this was nested inside `page2`. `groupAtoms` needs
// the same row rule, and the two are in scopes that do not enclose one another, so it lives at
// module level. A `function` declaration, not a `const`, so hoisting keeps either call order legal.
function gridRows(cls, cards, firstSp = 1) {
  // v9.3: on a one-column page a "row" is a card. Keeping 3-per-row would emit three
  // stacked cards inside ONE atom, and a break may never fall inside a row — the packer
  // would have to push all three to a fresh page.
  const perRow = PAGE.oneColumn ? 1 : (cls === "grid3" ? 3 : 2);
  // A ROW SHORT OF ITS COLUMNS prints the columns it does not fill as blank page — a single
  // mistake card took a third of the A4 measure and left two thirds white beside it. When the
  // WHOLE group is one short row, the grid sizes itself to the cards it actually holds. A
  // multi-row group keeps the fixed count: a trailing card stretched to full width under full
  // rows above it breaks the column rhythm that is what makes a grid readable at a glance.
  const rowCls = cards.length < perRow ? `${cls} n${cards.length}` : cls;
  const out = [];
  for (let i = 0; i < cards.length; i += perRow) {
    out.push({ html: `<div class="${rowCls}">${cards.slice(i, i + perRow).join("")}</div>`,
               sp: i === 0 ? firstSp : 2 });
  }
  return out;
}

function groupAtoms(label, cards) {
  if (!cards.length) return [];
  // VENDOR DIVERGENCE (bd-ip4xh, SYNC 3.30): ONE ROW PER ATOM, not one card per atom. This used to wrap every card in its
  // own `.grid3`, which on A4 is a three-column grid holding one card: the card took a third
  // of the measure and the other two thirds printed blank, three times over for the three
  // differentiation cards. That shape is right on the PHONE, where `PAGE.oneColumn` makes a
  // row a card -- and `gridRows` already draws exactly that distinction for the support page,
  // so the rule is borrowed rather than restated. The operator's words for what it cost:
  // *"no blank spaces"*.
  //
  // The LABEL still rides row 1 -- the YOU-DO precedent in `blockAtoms` -- so a page can never
  // open on a bare card with no statement of what it is a card of.
  return gridRows("grid3", cards, 3).map((r, i) => (i === 0
    ? { ...r, html: `<div class="blk"><div class="lbl g">${esc(label)}</div>${r.html}</div>` }
    : r));
}

function page2(doc, ctx, secIndex) {
  const L = ctx.L;
  const P = doc.page2;
  // bd-a8veu.10: a group with a host in the flow is NOT painted here. See flowHosts.
  const hosts = flowHosts(doc);
  const p = doc.provenance;
  const A = [];
  /**
   * A support-page section: its bar (glued to its first body atom) then its body atoms.
   *
   * The support page runs ONE RUNG TIGHTER than the teach page, deliberately. It is dense
   * reference matter a teacher scans between periods — an index, not prose read aloud while
   * standing in front of a class — and it carries eight section bars plus the exam bank
   * inside a hard 2-page cap. The operator's "too close" verdict was about the teach page's
   * stacked boxes (the hook / say / board / watch run), and that is where the full 8/12/16
   * rhythm goes. Loosening this page by one rung costs it a THIRD page, which is worse for
   * the same teacher.
   *
   * RENDER-LAW 15 (bd-s19g8). The LETTER is assigned here, in emission order, rather than
   * written at the call site. Sections B (`model_answers`) and F (`homework_key`) are optional
   * now — the operator: *"we didnt need model answers"*, *"homework key goes too"* — and a
   * support page that ran A, C, D, E, G, H would read as a printing fault rather than as a
   * deliberate omission. Nothing outside this function keys off the letter (`p2-B` appears in
   * no other file), so the index is free to close up. A section whose bodies are all empty is
   * not painted at all: `S` emits nothing, bar included, rather than leaving a lettered rule
   * over an empty grid.
   */
  let nS = 0;
  const S = (name, bodies) => {
    const present = bodies.filter(Boolean);
    if (!present.length) return;
    const letter = String.fromCharCode(65 + nS++);
    const key = `p2-${letter}`;
    secIndex[key] = { kind: "p2", letter, title: name };
    A.push(atom(p2bar(letter, name), { sec: key, first: true, glue: true, sp: 2 }));
    present.forEach((b) => {
      const html = typeof b === "string" ? b : b.html;
      // A body may now declare its own `glue`. It could not before, and it did not need to
      // while the packer was greedy: greedy breaks as LATE as it can, so it only ever
      // separated two adjacent body atoms when the second genuinely did not fit. An exact
      // packer chooses its breaks freely, so every adjacency a reader depends on has to be
      // stated rather than left to that accident. See section A below.
      A.push(atom(html, {
        sec: key,
        sp: typeof b === "string" ? 1 : b.sp == null ? 1 : b.sp,
        glue: typeof b === "string" ? false : !!b.glue,
      }));
    });
  };



  // THE REFERENCE HEADER IS A RUNNING HEAD, NOT A SECOND COVER (bd-a8veu.9). An eyebrow and a
  // name, bounded at three line boxes:
  //
  //     REFERENCE  Grade 6 Geography · p.63–64
  //     Forests of Pakistan
  //
  // It used to run to four lines, and five once the topic wrapped, because three separate
  // things each took a whole line of a 478px column and none of them filled it. The pill sat
  // alone on a line that was 352.8px blank — 74% of the measure for a nine-letter badge. The
  // meta carried a hard `<br>`, a break that cannot be taken back: it cost a line whether the
  // text needed one or not. And the half after that break repeated the chapter, which the hero
  // on page 1 already prints in full.
  //
  // WHAT DECIDES THE ARRANGEMENT is the arithmetic of the phone measure, not taste. The type
  // ships scaled (20.5px of title renders at 23.92px), so the column holds ~36 characters of
  // title per line and the pill costs 133px of whatever line it sits on. Put the pill beside
  // the TITLE and a long topic loses a third of its first line and runs to three lines on its
  // own, blowing the budget; put it beside the META — which is short, fixed in shape, and
  // never needs the whole measure — and it costs nothing at all. That leaves the title the
  // full width on both of its lines, which is what holds the bound: one line of furniture that
  // cannot grow, plus two lines of topic.
  //
  // The meta carries the LOCATOR and nothing else. `Not read aloud in class` was the other
  // casualty of the arithmetic, and it is the right one to lose: it is advice rather than
  // identity, and a page badged REFERENCE — whose contents are model answers, an exam bank and
  // the mistakes to expect — is not a thing anyone reads to a class. Grade, subject and pages
  // are what re-identify these sheets once they are printed and shuffled.
  const p2head = `<div class="p2head">
      <div class="r"><span class="pill">${esc(L.supportPage)}</span>${esc(L.grade)} ${p.grade} ${rich(p.subject)} &middot; ${esc(L.page)}${isoAtom(esc(p.printed_pages), ctx)}</div>
      <div class="t">${rich(p.topic)}</div>
    </div>`;
  // The support page's masthead, glued for the same reason as the teach page's hero.
  A.push(atom(p2head, { sp: 0, glue: true }));

  // bd-a8veu.7: SECTION A WAS THE BOARD PLAN, and it is gone from here. The diagram and the
  // draw-order card now print at the end of the Introduction, where the teacher picks up the
  // chalk — see boardPlanAtoms. Do not re-add them here: two copies of one board is the same
  // defect the video hoist fixed, on a part that is already over its page cap. The letters
  // close up by themselves because `S` assigns them in emission order (render-law 15), so what
  // follows is now section A.
  //
  // bd-ir1aq: THE MODEL-ANSWER SECTION IS NOT EMITTED AT ALL, whatever the doc carries.
  // Operator, twice — *"Section B in the reference section is not needed"*, then *"why does
  // reference pages still have model answers? I just wanted HW answers"*. bd-s19g8 only took
  // `model_answers` out of the four author briefs, which is a soft constraint on the model: an
  // LP already cached, or one whose author round emitted the key anyway, kept printing it. The
  // refusal has to live here, where the page is actually built.
  //
  // The key is NOT deleted from stored docs and NOT dropped from the schemas, deliberately. A
  // cached Urdu doc whose `ur_overlay` points at `/page2/model_answers/…` would make
  // `pointerSet()` throw and `renderDoc()` refuse the whole lesson with OVERLAY_INVALID; and
  // `page2` is `additionalProperties: false`, so an undeclared key would turn every stored doc
  // that carries one into a SCHEMA failure. The corpus keeps validating, the renderer ignores
  // the key, and `lp612-author.worker.js` strips it (with its overlay pointers) from new docs.
  //
  // `Q` stays — the homework key, section F below, resolves its refs through it.
  const Q = questionIndex(doc);

  // bd-a8veu.10: MISTAKES AND DIFFERENTIATION NORMALLY PRINT IN THE FLOW, not here — the
  // pupil-says/you-ask pair at the end of Development where the misconception surfaces, the
  // three differentiation cards at the end of the section that carries the practice. See
  // flowHosts and the `after(s)` hook. What is left here is the FALLBACK: an LP with no
  // Development section, or none carrying a practice block, still gets its group printed, in
  // Reference, exactly as it was printed before. `S` paints nothing for an empty body list, so
  // the support index closes up on its own (render-law 15) when the flow takes the group.
  S(L.p2Mistakes, hosts.mistakes ? [] : gridRows("grid3", (P.mistakes || []).map((m) => misCard(m, L))));

  S(L.p2Diff, hosts.differentiation || !P.differentiation
    ? []
    : [`<div class="grid3">
    ${diffCards(P.differentiation, L).join("\n    ")}</div>`]);

  const eb = P.exam_bank || {};
  const letterOf = (i) => "ABCDE"[i];
  const isAnswer = (opt, i, ans) =>
    ans != null && (String(ans).trim() === opt.trim() || String(ans).trim().toUpperCase() === letterOf(i));
  // The exam bank is the tallest thing on the support page and the one that used to force a
  // third page. Each MCQ is its own atom, so it may break between questions.
  //
  // DEFECT CLASS D. v8 printed each distractor code in a `.dc` span INSIDE the option chip, so
  // a pupil looking over the teacher's shoulder — or a teacher who photocopies the reference
  // page as a worksheet, which is exactly what happens — reads "B. 4×4 [multiplies the
  // orders]". The code is still DATA and it is still on the page; it moves into ONE teacher
  // note under the question, styled as a note. lint's DISTRACTOR_VISIBLE asserts that no code
  // is ever painted inside `.op`.
  const mcqAtoms = (eb.mcq || []).map(
    (q) => {
      const wrong = q.options.map((o, i) => ({ o, i })).filter(({ o, i }) => !isAnswer(o, i, q.answer));
      const notes = (q.distractor_codes || [])
        .map((c, k) => (wrong[k] ? `<b>${letterOf(wrong[k].i)}</b> ${rich(c)}` : null))
        .filter(Boolean);
      return { html: `<div class="mcq"><div class="q">${rich(q.q)}</div>
      <div class="opts">${q.options
        .map((o, i) => `<span class="op${isAnswer(o, i, q.answer) ? " ok" : ""}"><b>${letterOf(i)}.</b> ${rich(o)}</span>`)
        .join("")}</div>
      ${notes.length ? `<span class="tnote"><b>${esc(L.teacherNote)}</b> ${esc(L.distractors)}: ${notes.join(" &middot; ")}</span>` : ""}</div>`, sp: 1 };
    }
  );

  // "Board phrasing" belongs to grades 9-12 only. FBISE's examining remit starts at SSC, and
  // the author brief forbids framing anything on a middle-school plan as board practice.
  const srqLabel = p.grade != null && p.grade >= 9 ? L.srq : L.srqEarly;
  const srqHtml = eb.srq
    ? `<div class="split">
       <div style="flex:1 1 0;min-width:0"><div class="srq"><div class="lbl">${esc(srqLabel)}${eb.srq.marks ? ` &middot; ${eb.srq.marks} ${esc(L.marks)}` : ""}</div>
       <div class="q">${rich(eb.srq.q)}</div></div></div>
       <div style="flex:1 1 0;min-width:0"><div class="ms"><span class="lbl">${esc(L.markScheme)}</span>
       <ul>${eb.srq.mark_scheme.map((m) => `<li>${rich(m)}</li>`).join("")}</ul></div></div></div>`
    : null;

  const erqHtml = eb.erq_skeleton
    ? `<div class="erq"><span class="lbl">${esc(L.erq)}</span>
       ${eb.erq_skeleton.q ? `<div class="q">${rich(eb.erq_skeleton.q)}</div>` : ""}
       ${(eb.erq_skeleton.parts || [])
         .map(
           (pt) => `<div class="part"><span>${rich(pt.heading)}${pt.note ? ` — <i style="color:var(--mut)">${rich(pt.note)}</i>` : ""}</span>
           ${pt.marks ? `<span class="mk">${pt.marks} ${esc(L.marks)}</span>` : ""}</div>`
         )
         .join("")}</div>`
    : null;

  // bd-a8veu.18 — THE SECTION IS PRINTED FOR SSC ONLY. Operator: "Section B in the reference
  // section is not needed." The heading names FBISE, and FBISE's examining remit starts at SSC, so
  // on a grade 6-8 plan it names a board that does not examine her pupils — over questions the
  // rule two screens up was careful not to call board practice. The document is unchanged: the
  // bank stays in the schema, the briefs keep ordering one, and lint keeps its 6-8 warn. This is
  // only what we PAINT, so a stored middle-school lesson re-renders without it at no model cost.
  //
  // Polarity differs from `srqLabel` on purpose. A missing grade there falls toward the label that
  // claims LESS; here it falls toward printing, because withholding a whole section on an absent
  // field would silently strip SSC lessons whose provenance never carried one.
  //
  // `S` assigns the support-page letter in emission order (render-law 15), so C becomes B by
  // itself and the index closes up with no gap.
  const fbiseGrade = p.grade == null || p.grade >= 9;
  S(L.p2Exam, !fbiseGrade ? [] : [
    mcqAtoms.length ? { html: `<div class="lbl g">${esc(L.mcq)}</div>`, sp: 1 } : null,
    ...mcqAtoms,
    srqHtml ? { html: srqHtml, sp: 2 } : null,
    erqHtml ? { html: erqHtml, sp: 2 } : null,
    eb.how_marked ? `<span class="how"><b>${esc(L.howMarked)}:</b> ${rich(eb.how_marked)}</span>` : null,
  ]);

  // F — the homework worked in full, when the LP carries a key. Like B, each entry resolves its
  // `ref` back to the item as the homework section states it, so the teacher never has to hold
  // two pages side by side. F is the tallest structure on the support page — median 496px, max
  // 853px across the study's 24 lessons — and therefore the single biggest source of stranded
  // space. It splits by row, and when `homework_key` is absent (bd-s19g8) it is not painted.
  S(L.p2Hw, gridRows("grid2", (P.homework_key || [])
    .filter((h) => h.answer != null)  // bd-7l7ne: the primary prune can take the answer itself
    .map((h) => {
      const it = h.ref ? Q.get(h.ref) : null;
      return `<div class="card mk"><span class="lbl">${h.ref ? esc(h.ref) : ""}${h.marks ? ` &middot; ${h.marks} ${esc(L.marks)}` : ""}</span>
      <span class="refq">${it ? rich(it.q) : (h.item ? rich(h.item) : esc(L.refMissing))}</span>
      <p class="a">${rich(h.answer)}</p></div>`;
    })));

  // bd-a8veu.20 — NEXT PERIOD / NOT GOING TODAY IS NO LONGER PAINTED. Operator, on a grade-6
  // English plan: "inside Reference, A is not at all needed since on Page 1 it is already
  // present, so pls remove the whole thing." The page-1 twin is the sequence strip at :1694,
  // which prints `Next: <doc.sequence.next>` directly under the hero — the same fact as
  // `page2.next_period`, one page earlier, where a teacher meets it before she teaches rather
  // than after. Reference was re-stating it at the far end of the plan.
  //
  // `S` assigns the letter in emission order (render-law 15), so the coaching corner takes the
  // freed slot with no gap — which is the space the operator said it needed.
  //
  // THE DOCUMENT IS UNCHANGED. `next_period` and `not_going` stay required in both schemas,
  // the briefs keep ordering them, and lint keeps its rules: this is only what we PAINT, so a
  // stored lesson re-renders without the section at no model cost. `not_going` therefore still
  // travels with every plan and is one `S(...)` away if it is ever wanted back on the page.

  // The coaching corner, on the K-5 pattern (operator, 2026-09-02): something from THIS
  // lesson, then a question she asks herself, then the offer of real coaching. The offer is
  // FURNITURE — the number lives in the label pack and nowhere else, so it cannot drift document
  // to document and costs nothing against the word budget. K-5 learned the last step the hard
  // way: a CTA that does not say what comes BACK is just a request (FEEDBACK_LEDGER #13).
  S(L.p2Coach, [`<div class="coach">${P.coaching_lookfor == null ? "" : `<p>${rich(P.coaching_lookfor)}</p>`}
    ${P.coaching_reflection ? `<p class="ask"><span class="lbl">${esc(L.coachAsk)}</span>${rich(P.coaching_reflection)}</p>` : ""}
    <p class="offer">1 ${esc(L.coachOffer)} ${arrowFor(ctx)} 2 ${esc(L.coachSend)} ${arrowFor(ctx)} 3 ${esc(L.coachBack)}</p></div>`]);

  return { part: "support", atoms: A };
}

// The page box, in CSS px: A4 at 96dpi, less .pad's own padding.
let PAGE_CONTENT_H = PAGE.h - PAGE.padT - PAGE.padB;

/**
 * Lay the next build out on a named page format — the ONE place the geometry changes.
 *
 * VENDOR DIVERGENCE (SYNC §3.14). Every derived length below was a `const` computed once at
 * module load. They are the SAME expressions, re-evaluated together, so a format change can
 * never leave half the geometry on the old page — which is the defect that made this worth a
 * function instead of five assignments at the call site. `FIG_CHROME`, `FULL_COL_A4` and
 * `DIAGRAM_MIN_PX_A4` are absolute or A4-referenced and deliberately do NOT move.
 */
function setPageFormat(name) {
  const fmt = PAGE_FORMATS[name];
  if (!fmt) {
    const e = new Error(`unknown page format "${name}" — known: ${Object.keys(PAGE_FORMATS).join(", ")}`);
    e.code = "BAD_FORMAT";   // so the CLI reports it like any other bad input, not as a crash
    throw e;
  }
  PAGE = fmt;
  PAGE_INNER_W = PAGE.w - PAGE.padX * 2;
  FULL_COL = PAGE_INNER_W - FIG_CHROME;
  DIAGRAM_MIN_PX = +(DIAGRAM_MIN_PX_A4 * (FULL_COL / FULL_COL_A4)).toFixed(2);
  FIG_GROW_MAX = PAGE.padX - 3;
  PAGE_CONTENT_H = PAGE.h - PAGE.padT - PAGE.padB;
  return PAGE;
}

/** The spacing scale, exported so a test can assert there is exactly ONE ladder. */
const SPACING = { sp1: 4, sp2: 8, sp3: 12, sp4: 16, sp5: 24 };

/**
 * Wrap a part's atoms into explicit .page boxes at the given break indices.
 * `breaks` is a list of atom indices that START a new page. Empty = one page.
 * Every page carries a footer; a continuation page also carries the "…continued" strip and,
 * when it opens mid-section, that section's bar repeated.
 */
function paginate(part, atoms, breaks, ctx, doc, secIndex, pageFrom, pageTotal) {
  const strip = contStripHtml(doc, ctx);
  const groups = [];
  let cur = [];
  atoms.forEach((a, i) => {
    if (breaks.includes(i) && cur.length) { groups.push(cur); cur = []; }
    cur.push(a);
  });
  if (cur.length) groups.push(cur);
  const tag = part === "teach" ? "t" : "s";
  return groups
    .map((g, i) => {
      const head = i === 0
        ? ""
        : strip + (g[0].sec && !g[0].first ? contBarHtml(g[0].sec, ctx, secIndex) : "");
      return `<div class="page" id="${tag}${i + 1}" data-part="${part}"><div class="pad">
      ${head}${g.map((a) => a.html).join("\n")}${footerHtml(doc, ctx, pageFrom + i, pageTotal)}
    </div></div>`;
    })
    .join("\n");
}

/**
 * Build the complete self-contained HTML document.
 * @returns {{html:string, warnings:string[], fontReport:object, atoms:object, probeKeys:string[]}}
 */
function buildHtml(input, opts = {}) {
  // ONE LAYOUT, ONE SHAPE. A 2.0 document is lifted into the 3.0 shape here rather than given
  // its own code path — two layout paths is how a fix lands in one of them. See lib/migrate.js.
  const doc = toV3(input);
  // VENDOR DIVERGENCE (SYNC §3.14). FIRST, before css() or any atom is measured — every length
  // below this line is read off the page that is chosen here.
  setPageFormat(opts.format || "phone");
  const lang = opts.lang || doc.provenance.medium || "en";
  const rtl = lang === "ur";
  /** bd-jdtdl — DOES THIS DOCUMENT CONTAIN URDU, whatever chrome it is being served with?
   *  An Urdu-medium lesson (Urdu, Pak Studies Urdu, Islamiat) is authored in Urdu script and
   *  is routinely served at lang=en, which used to mean no Nastaliq face and no Nastaliq in
   *  the stack — so every Urdu codepoint printed .notdef. The face is 1.1 MB of base64, so it
   *  is embedded on evidence rather than always: Arabic, Arabic Supplement, and the
   *  presentation-forms blocks Urdu actually uses. */
  const urduScript = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(
    JSON.stringify(doc),
  );
  // Every build sets the prose pipeline's direction for itself (see lib/rich.js
  // — buildHtml is synchronous, so two documents cannot interleave).
  setRtlProse(rtl);
  /** bd-b8ypq — the face without its metrics. An RTL page is already wholly on the Nastaliq
   *  branch (line-height 2.05, the taller .hero and .foot paddings) and renders correctly. An
   *  LTR page carrying Urdu got the face from bd-jdtdl and none of that, so its Arabic runs
   *  paint into a 1.55 line box and land on their neighbours. Only the runs that carry Arabic
   *  are lifted — taking the whole page to 2.05 for one ﷺ costs ~50% of its vertical budget. */
  setUrduInline(!rtl && urduScript);
  const L = LABELS[rtl ? "ur" : "en"];
  const warnings = [];
  const figureProblems = [];
  /** bd-oak77.14 — every figure the layout had to WIDEN to keep legible. `[]` on a clean
   *  document, never absent: "we looked and there was nothing" is a different fact from "we did
   *  not look" (rule 24(b)). */
  const figureRepairs = [];

  let renderDiagram, stubDiagrams = false;
  try {
    const mod = require("../diagrams");
    renderDiagram = mod.renderDiagram;
    stubDiagrams = !!mod.IS_STUB;
  } catch (e) {
    warnings.push(`diagrams/ module not loadable (${e.message}) — every diagram renders as a placeholder`);
    stubDiagrams = true;
  }
  // L1's own placeholder — deliberately NOT sourced from diagrams/, so a broken or
  // absent diagram engine still yields a visible, labelled, reported box rather than
  // a silently blank figure. "It rendered" must never be inferred from "nothing threw".
  const placeholder = (spec) => {
    const label = esc((spec && (spec.alt || spec.caption || spec.type)) || "diagram");
    const lines = (label.match(/.{1,46}(\s|$)/g) || [label]).slice(0, 2);
    return `<svg viewBox="0 0 600 170" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="598" height="168" rx="10" fill="#f6f8fc" stroke="#e5e9f0" stroke-width="2" stroke-dasharray="7 6"/>
      <text x="300" y="60" text-anchor="middle" font-size="15" font-weight="700" letter-spacing="1.6" fill="#0B2545">DIAGRAM &#183; ${esc(String((spec && spec.type) || "?").toUpperCase())}</text>
      ${lines.map((l, i) => `<text x="300" y="${92 + i * 22}" text-anchor="middle" font-size="15" fill="#5b6472">${l.trim()}</text>`).join("")}
      <text x="300" y="150" text-anchor="middle" font-size="13" fill="#F2A20C" font-weight="700">not rendered &#8212; see render warnings</text>
    </svg>`;
  };

  const ctx = {
    L,
    rtl,
    lang,
    docDir: opts.docDir || process.cwd(),
    renderDiagram: renderDiagram || ((s) => { throw new Error("no diagram engine"); }),
    // bd-u9vji. Read off `provenance.grade` here, ONCE, so no block renderer has to reach for the
    // document -- the same seam `page1` already uses for its primary furniture.
    primary: isPrimary(doc),
    placeholder,
    stubDiagrams,
    warn: (m) => warnings.push(m),
    figureProblem: (m) => figureProblems.push(m),
    figureRepair: (r) => figureRepairs.push(r),
    rasterFigure: false,
    vectorFigure: false,
  };

  const fonts = fontCss({ urdu: rtl || urduScript });
  if (fonts.missing.length) warnings.push(`font file(s) not embedded, falling back to system: ${fonts.missing.join(", ")}`);

  // bd-7l7ne -- GRADES 1-5 ONLY. Operator: "what is pending is not relevant for Primary."
  // `lib/pending.js` carries the whole rule and the reasoning; the gate is `ctx.primary`, read off
  // `provenance.grade`, so a 6-12 document never enters it and `content` is `doc` by reference.
  // Every drop becomes a build warning, because a silent drop and an authoring gap look identical
  // from the outside.
  const pruned = ctx.primary ? prunePending(doc) : { doc, dropped: [] };
  for (const what of pruned.dropped) warnings.push(`primary: dropped design-pending ${what}`);
  const content = pruned.doc;

  const secIndex = {};
  const teach = page1(content, ctx, secIndex);
  const support = page2(content, ctx, secIndex);
  const breaks = opts.breaks || { teach: [], support: [] };
  const teachPages = (breaks.teach || []).length + 1;
  const supportPages = (breaks.support || []).length + 1;
  const total = teachPages + supportPages;

  // The measure pass carries a THROWAWAY page holding every piece of page FURNITURE the
  // packer has to pay for but which is not an atom: the "…continued" strip, the footer that
  // now sits on every page, and one repeated bar PER SECTION (their heights differ — a long
  // section name wraps). Charging a guessed height instead is how v8 overflowed every
  // continuation page by exactly the strip's height.
  const probeKeys = Object.keys(secIndex);
  const contProbe = opts.probeCont
    ? `<div class="page" data-part="__probe"><div class="pad">${probeTag(contStripHtml(doc, ctx), "__strip")}
       ${probeKeys.map((k) => probeTag(contBarHtml(k, ctx, secIndex), k)).join("\n")}
       ${probeTag(footerHtml(doc, ctx, 8, 8), "__foot")}</div></div>\n`
    : "";

  const brandHex = doc.provenance.brand && doc.provenance.brand.primary_hex;
  const html = `<!doctype html>
<html lang="${rtl ? "ur" : "en"}" dir="${rtl ? "rtl" : "ltr"}"${isPrimary(doc) ? ' class="pri"' : ""}>
<head>
<meta charset="utf-8">
<title>${rich(doc.provenance.topic)} &middot; ${esc(L.grade)} ${doc.provenance.grade} ${rich(doc.provenance.subject)}</title>
<meta name="subject" content="lesson_id=${esc(doc.lesson_id)}">
<meta name="keywords" content="${esc(doc.provenance.book_stem)}; lp_doc ${esc(doc.schema_version)}; ${esc(doc.lp_type)}">
<style>${css(rtl, fonts.css, katexCss(), urduScript)}</style>
</head>
<body${brandHex ? ` style="--brand:${esc(brandHex)}"` : ""}>
${contProbe}${paginate("teach", teach.atoms, breaks.teach || [], ctx, doc, secIndex, 1, total)}
${paginate("support", support.atoms, breaks.support || [], ctx, doc, secIndex, teachPages + 1, total)}
</body>
</html>`;

  return {
    html, warnings, figureProblems, figureRepairs, fontReport: fonts,
    atoms: {
      teach: teach.atoms.map((a) => ({ sec: a.sec, first: a.first, glue: a.glue, soft: a.soft })),
      support: support.atoms.map((a) => ({ sec: a.sec, first: a.first, glue: a.glue, soft: a.soft })),
    },
    probeKeys,
    // An atom's `sec` is a KEY, and on the support page it is only a bar letter ("p2-D"). The
    // renderer has to be able to say "Practice" when it tells the author which section to cut
    // from, so the human title of every indexed section travels with the layout.
    secTitles: Object.fromEntries(Object.entries(secIndex).map(([k, v]) => [k, v.title])),
    childCounts: { teach: teach.atoms.length, support: support.atoms.length },
    hasRasterFigure: ctx.rasterFigure,
    hasVectorFigure: ctx.vectorFigure,
    pageContentHeight: PAGE_CONTENT_H,
    // VENDOR DIVERGENCE (SYNC §3.14) — the geometry this build actually used.
    page: PAGE,
  };
}

// VENDOR DIVERGENCE (SYNC §3.14). The six lengths `setPageFormat` moves are exported as GETTERS,
// not as values. `module.exports = { PAGE }` copies the number once, at require time, so after
// the format became selectable every consumer would have been frozen on the default page —
// which is exactly the bug `lint_lp.js` would have had, since it destructures FULL_COL and
// DIAGRAM_MIN_PX lazily inside a function and would otherwise measure diagrams against a page
// the document was not built on. A getter reads the live binding at property-access time.
//
// This does NOT rescue a consumer that destructures at require time — destructuring calls the
// getter once, there and then. `render_lp.js` is that consumer, and it is fixed the only way
// that works: the geometry is passed to it as an argument off `buildHtml`'s return value.
module.exports = { buildHtml, setPageFormat, isPrimary, TYPE_SCALE, BODY_PX, BODY_PX_V91, scaledPx, scaleTypeCss, SECTION_META,
  PAGE_A4, PAGE_FORMATS, pageScaled, DIAGRAM_MIN_PX_A4,
  FIG_CHROME, FULL_COL_A4,
  PRIMARY_DIAGRAM_MIN_PX, PHONE_FULL_COL, PRIMARY_FIG_MAX_H,
  SPACING, DIAGRAM_LABELS, diagramLabel };

for (const [k, read] of Object.entries({
  PAGE: () => PAGE,
  PAGE_INNER_W: () => PAGE_INNER_W,
  PAGE_CONTENT_H: () => PAGE_CONTENT_H,
  DIAGRAM_MIN_PX: () => DIAGRAM_MIN_PX,
  FULL_COL: () => FULL_COL,
  FIG_GROW_MAX: () => FIG_GROW_MAX,
})) {
  Object.defineProperty(module.exports, k, { get: read, enumerable: true });
}
