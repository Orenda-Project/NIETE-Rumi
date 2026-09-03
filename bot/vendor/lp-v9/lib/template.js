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
const { rich, esc, display, displayChem, setRtlProse } = require("./rich");
const { LABELS } = require("./overlay");
const { fontCss, katexCss, REPO_ROOT } = require("./fonts");
const { toV3 } = require("./migrate");
const { questionIndex } = require("./questions");

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
  panels:             { en: "Panels",          ur: "موازنہ" },
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

function css(rtl, fonts, katex) {
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  return `
${fonts}
${katex}
@page { size: A4; margin: 0; }
:root{
  --navy:#0B2545; --navy2:#13315C; --amber:#F2A20C; --amber-soft:#FDEBC8;
  --ink:#1a2233; --mut:#5b6472; --line:#e5e9f0; --leaf:#1F7A4D; --leaf-soft:#E3F3E9;
  --warn:#B4531F; --warn-soft:#FCEDE6; --warn-line:#F2C4AD;
  --page-w:794px; --page-h:1123px;
  /* THE SPACING SCALE (v8.1). One ladder, five rungs, used for every vertical gap on the
     page. Before this the gaps were ad-hoc 1-5px values chosen per block and the operator's
     verdict was that "the sections and boxes are on top of each other". Vertical rhythm is
     applied ONLY as margin-top on a .pad atom (see .pad > .sp-N below), so the packer can
     charge for it exactly — a gap the packer cannot see is a clipped page. */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px;
}
*{ box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
html,body{
  font-family:${rtl ? `'Noto Nastaliq Urdu',` : ""}'Inter','Helvetica Neue',Arial,sans-serif;
  color:var(--ink);
  /* unitless: scales with font-size. A px line-height clips Nastaliq descenders. */
  line-height:${rtl ? "2.05" : "1.55"};
  font-size:18px;
}
body{ background:#fff; }
.page{ width:var(--page-w); height:var(--page-h); position:relative; background:#fff;
       page-break-after:always; overflow:hidden; }
.page:last-child{ page-break-after:auto; }
.pad{ padding:10px 21px 4px; height:100%; display:flex; flex-direction:column; }
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
.hero{ background:var(--navy); color:#fff; border-radius:11px; padding:${rtl ? "12px" : "8px"} 14px ${rtl ? "9px" : "8px"};
       display:flex; justify-content:space-between; align-items:flex-start; gap:18px; }
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
.hero .h-meta{ text-align:${end}; font-size:14.5px; color:#c9d4e6; line-height:${rtl ? "1.9" : "1.55"};
       flex:0 1 auto; min-width:0; max-width:46%; }
.hero .h-meta b{ color:#fff; }
.hero .chips{ display:flex; gap:5px; justify-content:flex-${rtl ? "start" : "end"}; margin-top:5px; flex-wrap:wrap; }
/* A chip whose text cannot wrap cannot shrink, so a capped column would have overflowed
   instead. The badge wraps INSIDE its pill; overflow-wrap covers the pathological single long
   token that would otherwise still push out. */
.hero .tchip{ background:rgba(242,162,12,.17); border:1.5px solid var(--amber); color:#FFD98A;
       font-size:14px; font-weight:800; letter-spacing:.06em; padding:3px 9px; border-radius:20px;
       max-width:100%; white-space:normal; overflow-wrap:anywhere; line-height:1.35;
       text-align:${end}; }
.hero .tchip.plain{ background:rgba(255,255,255,.10); border-color:#5d7194; color:#dbe5f3; }
.brand{ display:inline-flex; align-items:center; gap:5px; margin-top:5px; justify-content:flex-${rtl ? "start" : "end"}; }
.brand .dot{ width:8px; height:8px; border-radius:50%; background:var(--amber); }
.brand .dot.b{ background:#fff; }
.brand span{ font-weight:800; font-size:17.5px; letter-spacing:.02em; color:#fff; }

/* ── section bars (O I D A C H) ─────────────────────────────────────────── */
.bar{ display:flex; align-items:center; gap:8px; border-radius:7px; padding:4px 11px; margin:0; }
.bar .badge{ flex:0 0 auto; width:20px; height:20px; border-radius:50%; color:#fff;
      font-size:16.5px; font-weight:800; display:flex; align-items:center; justify-content:center;
      line-height:1; }
.bar .nm{ font-size:17.5px; font-weight:800; letter-spacing:.02em; line-height:${rtl ? "1.8" : "1.3"}; }
.bar .mins{ margin-${start}:auto; font-size:15.5px; font-weight:800; letter-spacing:.03em; }
.s-o{ background:var(--amber-soft); } .s-o .badge{ background:var(--amber); color:#3a2c0a; } .s-o .nm,.s-o .mins{ color:#8A5F04; }
.s-w{ background:#FBF1DF; } .s-w .badge{ background:#C98A12; } .s-w .nm,.s-w .mins{ color:#8A5F04; }
.s-i{ background:#EAF0F8; } .s-i .badge{ background:var(--navy2); } .s-i .nm,.s-i .mins{ color:var(--navy2); }
.s-d{ background:#E1EAF6; } .s-d .badge{ background:var(--navy); } .s-d .nm,.s-d .mins{ color:var(--navy); }
.s-a{ background:var(--leaf-soft); } .s-a .badge{ background:var(--leaf); } .s-a .nm,.s-a .mins{ color:#14603A; }
.s-c{ background:#ECE8F6; } .s-c .badge{ background:#584A93; } .s-c .nm,.s-c .mins{ color:#4A3E80; }
.s-h{ background:#EFF1F4; } .s-h .badge{ background:#5b6472; } .s-h .nm,.s-h .mins{ color:#414A57; }

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
/* margin-top:auto on .mats/.foot is SLACK, not height: in the live layout it absorbs whatever
   the page has left over. So the packer must charge zero for it, not a guessed 8px. */
body.measuring .mats, body.measuring .foot{ margin-top:0; }
.sec{ break-inside:avoid; display:flex; flex-direction:column; gap:var(--sp-2); }
.split{ display:flex; gap:var(--sp-3); align-items:flex-start; }
.split > div{ display:flex; flex-direction:column; gap:var(--sp-2); }
.secrow{ display:flex; gap:var(--sp-3); align-items:flex-start; }
.secrow > .sec{ flex:1 1 0; min-width:0; }
.blk{ margin:0; }
p{ font-size:18px; }
.lbl{ font-weight:800; font-size:14px; line-height:1.35; letter-spacing:.09em; text-transform:uppercase; }

/* ── SLO ────────────────────────────────────────────────────────────────── */
.slo{ background:var(--amber-soft); border-${start}:6px solid var(--amber); border-radius:9px;
      padding:8px 14px; }
.slo .lbl{ color:#8A5F04; }
.slo p{ font-size:18.5px; line-height:${rtl ? "2.0" : "1.55"}; margin-top:1px; font-weight:600; color:#3a2c0a; }
.slo .src{ font-size:14.5px; color:#7d6425; margin-top:2px; font-weight:600; }
.crit{ font-size:17px; color:#6B5312; margin-top:1px; font-weight:600; }
.objhd{ display:flex; align-items:center; gap:6px; margin-top:var(--sp-2); font-size:14px; font-weight:800;
      letter-spacing:.09em; text-transform:uppercase; color:#8A5F04; }
.objhd .badge{ width:18px; height:18px; border-radius:50%; background:var(--amber); color:#3a2c0a;
      font-size:14px; display:flex; align-items:center; justify-content:center; line-height:1; }
.objs{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.objs li{ font-size:18px; margin:0; }
.objs li::marker{ color:var(--amber); font-weight:800; }

/* ── warm-up ────────────────────────────────────────────────────────────── */
.wu{ display:flex; flex-direction:column; gap:var(--sp-1); }
.wu .it{ display:flex; gap:9px; align-items:baseline; border:1.5px solid #EADFC5; background:#FFFCF5;
      border-radius:6px; padding:3px 10px; }
.wu .n{ flex:0 0 auto; font-weight:800; color:#C98A12; font-size:16.5px; }
.wu .q{ font-size:18px; }
.wu .a{ color:var(--leaf); font-weight:700; }
.wu .kind{ flex:0 0 auto; margin-${start}:auto; font-size:14px; font-weight:800; letter-spacing:.05em;
      text-transform:uppercase; color:#9aa3b0; }

/* ── blocks ─────────────────────────────────────────────────────────────── */
.hook{ background:var(--navy); color:#fff; border-radius:10px; padding:9px 14px; }
.hook .lbl{ color:var(--amber); }
.hook .q{ font-size:19px; font-weight:700; line-height:${rtl ? "1.95" : "1.55"}; margin-top:3px; }
.hook .lf{ font-size:16px; color:#c9d4e6; margin-top:3px; line-height:${rtl ? "1.9" : "1.55"}; }
.askb{ border-${start}:4px solid var(--navy2); background:#F5F8FC; border-radius:8px; padding:7px 13px; }
.askb .lbl{ color:var(--navy2); }
.askb .q{ font-size:18.5px; font-weight:700; color:var(--navy2); }
.askb .lf{ font-size:16.5px; color:var(--mut); margin-top:2px; }
.say{ border-${start}:4px solid #9FB4D0; background:#F7F9FC; border-radius:8px; padding:7px 13px; }
.say .lbl{ color:var(--navy2); }
.say .t{ font-size:18px; color:#173355; }
.watch{ background:var(--warn-soft); border:1px solid var(--warn-line); border-radius:8px; padding:7px 12px; }
.watch .lbl{ color:var(--warn); }
.watch .t{ font-size:18px; color:#5a2f18; }
.board{ background:#EFF1F4; border-${start}:4px solid #8A93A3; border-radius:8px; padding:7px 13px; }
.board .lbl{ color:#414A57; }
.board .t{ font-size:18px; color:#2b3341; }
.kwrow{ display:flex; flex-wrap:wrap; gap:var(--sp-1); margin-top:var(--sp-1); }
.kw{ background:#EEF2F8; border:1.5px solid #DBE3EF; border-radius:16px; padding:2px 11px; font-size:16.5px; }
.kw b{ color:var(--navy2); font-weight:800; }
.kw i{ color:var(--mut); font-style:normal; }
.kp{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.kp li{ font-size:18px; margin:0; }
.kp li::marker{ color:var(--navy2); }
.exq{ border:1px solid var(--line); border-radius:9px; padding:6px 11px; }
.exq.we{ border-color:#BFE3CD; background:#F6FCF8; }
.exq .tag{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.08em;
      text-transform:uppercase; padding:3px 10px; border-radius:14px; color:#fff; background:var(--amber); }
.exq.we .tag{ background:var(--leaf); }
.exq h4{ font-size:18px; color:var(--navy); margin-top:var(--sp-1); line-height:${rtl ? "1.85" : "1.45"}; }
.exq .prompt{ font-size:18px; margin-top:var(--sp-1); }
.exq ol{ margin:var(--sp-1) 0 0; padding-${start}:21px; }
.exq ol li{ font-size:18px; margin:0; }
.exq .res{ margin-top:var(--sp-1); font-size:18px; color:var(--leaf); font-weight:700; }
.pr .tag{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.08em;
      text-transform:uppercase; padding:3px 10px; border-radius:14px; background:var(--leaf-soft);
      color:#14603A; border:1.5px solid #BFE3CD; }
.pr .items{ margin-top:var(--sp-1); display:flex; flex-direction:column; gap:var(--sp-1); }
.pr .it{ display:flex; gap:8px; align-items:baseline; }
.pr .n{ flex:0 0 auto; font-weight:800; color:var(--navy2); font-size:16.5px; min-width:17px; }
.pr .q{ font-size:18px; }
.pr .a{ color:var(--leaf); font-weight:700; }
.pr .tier{ flex:0 0 auto; margin-${start}:auto; font-size:14px; font-weight:800; letter-spacing:.05em;
      text-transform:uppercase; color:#9aa3b0; }
.se{ display:flex; gap:var(--sp-3); }
.se > div{ flex:1 1 0; border-radius:9px; padding:7px 13px; border:1.5px solid; }
.se .sup{ background:#F5F8FC; border-color:#CBD8E8; }
.se .sup .lbl{ color:var(--navy2); }
.se .ext{ background:var(--leaf-soft); border-color:#BFE3CD; }
.se .ext .lbl{ color:#14603A; }
.se p{ font-size:18px; margin-top:var(--sp-1); }

/* ── figures ────────────────────────────────────────────────────────────── */
figure.dg{ border:1.5px solid var(--line); border-radius:10px; padding:9px 11px; break-inside:avoid; }
figure.dg.book{ border-color:#CBD8E8; }
figure.dg .ftop{ display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--sp-1); gap:8px; }
/* NOT uppercase. The badge carries a human label now ("Equation", "Force diagram"), and
   uppercasing a human label is what made "chem_equation" read as the enum CHEM_EQUATION in the
   first place. Nastaliq gets no tracking either — letter-spacing breaks Urdu joining. */
figure.dg .ftag{ background:var(--navy); color:#fff; font-size:14px; font-weight:800;
      letter-spacing:${rtl ? "0" : ".02em"};
      padding:3px 10px; border-radius:16px; }
figure.dg .fsrc{ color:var(--leaf); font-weight:800; font-size:14px; }
/* NO blanket max-height on an SVG. An SVG with a viewBox scales by min(boxW/vbW, boxH/vbH),
   so a fixed 118px clamp did not "fit" a diagram — it SHRANK it, and every label inside it,
   to whatever fraction 118px was of its natural height. That is what put mindmap, punnett and
   grid labels at ~3px on a phone: the clamp, not the diagram types' own font sizes. Each
   figure now carries its OWN computed max-height (the slot in which its smallest label still
   renders >= 13.5px). A raster book crop has no vector type to crush, so it keeps a clamp. */
figure.dg svg{ display:block; width:100%; height:auto; max-height:var(--fig-h, none); margin:0 auto; }
figure.dg img{ display:block; width:100%; height:auto; max-height:200px;
      object-fit:contain; margin:0 auto; }
figure.dg figcaption{ text-align:center; font-size:15.5px; color:var(--mut); font-weight:600; margin-top:var(--sp-1);
      line-height:${rtl ? "1.9" : "1.5"}; }
figure.dg .legend{ background:#F6F8FC; border-radius:8px; padding:6px 11px; margin-top:var(--sp-2); font-size:16.5px; }
figure.dg .legend .lbl{ color:var(--navy2); display:block; margin-bottom:2px; }
.mathb{ background:var(--leaf-soft); border:1.5px solid #BFE3CD; border-radius:10px; padding:8px 12px; line-height:1.45;
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
   teacher asks of a plan she did not write. */
.seq{ display:flex; flex-wrap:wrap; gap:6px 10px; align-items:baseline; background:#F6F8FC;
      border:1.5px solid #E1E7F0; border-radius:9px; padding:5px 12px; font-size:16px; color:var(--mut); }
.seq b{ color:var(--navy2); font-weight:800; }
.seq .now{ color:var(--navy); font-weight:800; }
.seq .arrow{ color:var(--amber); font-weight:800; }
/* An objective's own SLO code — spec §3 O wants one PER OBJECTIVE, not one per plan. */
.slocode{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.05em; color:#8A5F04;
      background:rgba(242,162,12,.20); border-radius:11px; padding:1px 8px; margin-${start}:6px; white-space:nowrap; }
.bythe{ font-size:17px; color:#6B5312; margin-top:2px; font-weight:600; }
/* Development's textbook citation. Reviewer sign-off 7: no page, no pass. */
.cite{ display:inline-block; font-size:14px; font-weight:800; letter-spacing:.04em; text-transform:uppercase;
      color:var(--navy2); background:#EAF0F8; border-radius:11px; padding:2px 9px; }
/* The resources line: one compact row under the outcome box. Amber link on a pale rule so it
   reads as an offer rather than as part of the lesson body. No font-size — it inherits the 18px
   floor render_lp.js enforces.
   NAMED .vres, not .res or .vid: BOTH of those are already taken (.res is the KaTeX result block,
   .vid was the old inline video block). A colliding class silently inherits someone else's box. */
.vres{ display:flex; gap:8px; align-items:baseline; margin-top:var(--sp-2);
      padding:6px 10px; border:1.5px solid #E5E9F0; border-radius:8px; background:#FBFCFE; }
.vres .ico{ flex:0 0 auto; }
.vres .lbl{ color:var(--navy2); font-weight:700; flex:0 0 auto; }
.vres a{ color:#8A5F04; text-decoration:underline; word-break:break-all; }
.vid{ display:flex; gap:8px; align-items:baseline; background:#F5F8FC; border:1.5px solid #CBD8E8;
      border-radius:8px; padding:6px 12px; font-size:16.5px; }
.vid .lbl{ color:var(--navy2); flex:0 0 auto; }
.vid a{ color:var(--navy2); font-weight:700; text-decoration:none; }
.vid .why{ color:var(--mut); }
/* Conclusion: the board-phrased checkpoint, its mark scheme, the exit ticket, the re-teach rule. */
.ck{ background:var(--navy); color:#fff; border-radius:9px; padding:7px 13px; }
.ck .lbl{ color:var(--amber); }
.ck .q{ font-size:18.5px; font-weight:700; margin-top:2px; line-height:${rtl ? "1.9" : "1.55"}; }
.ck ul{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.ck li{ font-size:18px; color:#d7e0ee; }
.exit{ border:1.5px solid #BFE3CD; background:#F6FCF8; border-radius:8px; padding:6px 12px; }
.exit .lbl{ color:#14603A; }
.exit .it{ display:flex; gap:8px; align-items:baseline; font-size:18px; }
.exit .a{ color:var(--leaf); font-weight:700; }
.reteach{ background:var(--warn-soft); border:1px solid var(--warn-line); border-radius:8px; padding:6px 12px; }
.reteach .lbl{ color:var(--warn); }
.reteach .t{ font-size:18px; color:#5a2f18; }
/* Homework as DATA. Each item wears its [SLO, K/U/A] tag; NO answer is printed here — the
   answers live in reference F, which is the whole point of defect class E. */
.hw{ display:flex; flex-direction:column; gap:var(--sp-1); }
.hw .it{ display:flex; gap:9px; align-items:baseline; border:1.5px solid var(--line); background:#FAFBFD;
      border-radius:6px; padding:4px 11px; }
.hw .n{ flex:0 0 auto; font-weight:800; color:#5b6472; font-size:16.5px; }
.hw .q{ font-size:18px; }
.hw .tag{ flex:0 0 auto; margin-${start}:auto; font-size:14px; font-weight:800; letter-spacing:.04em;
      color:#414A57; background:#E7EAEF; border-radius:11px; padding:1px 8px; white-space:nowrap; }
.hw .src{ color:var(--mut); font-size:15.5px; }
/* An inline matrix is promoted to display style (lib/rich.js). Give it room to breathe so it
   does not crowd the line it sits in. */
.mtx{ display:inline-block; vertical-align:middle; margin:0 2px; }
/* THE TEACHER NOTE. Distractor codes are data the teacher needs and a pupil must never read
   beside the option — so they are never painted in .op. Same for a resolved question ref.
   lint's DISTRACTOR_VISIBLE asserts every code is inside one of these. */
.tnote{ display:block; font-size:14.5px; color:#7d6425; background:#FDF6E7; border-radius:6px;
      padding:4px 10px; margin-top:var(--sp-1); line-height:${rtl ? "1.8" : "1.5"}; }
.tnote b{ color:#8A5F04; }
.refq{ display:block; font-size:16px; color:var(--navy2); font-weight:600; margin-bottom:2px; }

/* ── page-1 foot ────────────────────────────────────────────────────────── */
.mats{ padding-top:0; }
.matbox{ background:#F6F8FC; border:1.5px solid #E1E7F0; border-radius:9px; padding:7px 13px;
      font-size:16.5px; display:flex; gap:9px; align-items:baseline; }
.matbox .lbl{ color:var(--navy2); flex:0 0 auto; }
.cont{ margin-top:0; font-size:14px; color:var(--mut); font-style:${rtl ? "normal" : "italic"};
      border-top:1px solid var(--line); padding-top:var(--sp-2); line-height:${rtl ? "1.9" : "1.55"}; }

/* ── page 2 ─────────────────────────────────────────────────────────────── */
.p2head{ display:flex; justify-content:space-between; align-items:center;
      border-bottom:3px solid var(--navy); padding-bottom:var(--sp-2); gap:12px; }
.p2head .pill{ background:var(--navy); color:#fff; font-size:14px; font-weight:800; letter-spacing:.11em;
      text-transform:uppercase; padding:5px 14px; border-radius:16px; flex:0 0 auto; }
.p2head .t{ font-size:20.5px; font-weight:800; color:var(--navy); line-height:${rtl ? "1.8" : "1.3"}; }
.p2head .r{ font-size:15.5px; color:var(--mut); font-weight:600; text-align:${end}; line-height:${rtl ? "1.85" : "1.45"}; }
.p2sec{ break-inside:avoid; }
.p2bar{ display:flex; align-items:center; gap:7px; margin:0; }
.p2bar .badge{ flex:0 0 auto; width:21px; height:21px; border-radius:6px; background:var(--navy); color:#fff;
      font-size:15.5px; font-weight:800; display:flex; align-items:center; justify-content:center; line-height:1; }
.p2bar .nm{ font-size:17px; font-weight:800; color:var(--navy); letter-spacing:.03em;
      text-transform:uppercase; line-height:${rtl ? "1.8" : "1.35"}; }
.p2bar .rule{ flex:1 1 auto; height:2px; background:var(--line); }
.grid2{ display:grid; grid-template-columns:1fr 1fr; gap:var(--sp-2); }
.grid3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:var(--sp-2); }
.card{ border:1px solid var(--line); border-radius:6px; padding:3px 10px; background:#fff; }
.card .lbl{ color:var(--navy2); display:block; margin-bottom:var(--sp-1); }
.card p{ font-size:18px; }
.card .a{ color:var(--leaf); font-weight:700; }
.card.mk{ background:#FAFBFD; }
.mis{ border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.mis .x{ background:#FCEDE6; padding:4px 10px; }
.mis .x .lbl{ color:var(--warn); display:block; }
.mis .x p{ font-size:18px; color:#5a2f18; }
.mis .v{ background:var(--leaf-soft); padding:4px 10px; }
.mis .v .lbl{ color:#14603A; display:block; }
.mis .v p{ font-size:18px; color:#14472F; }
.mcq{ border:1px solid var(--line); border-radius:7px; padding:4px 10px; margin:0; }
.mcq .q{ font-size:18px; font-weight:700; color:var(--navy2); }
.mcq .opts{ display:flex; flex-wrap:wrap; gap:var(--sp-1); margin-top:var(--sp-1); }
.mcq .op{ font-size:16px; border:1px solid var(--line); border-radius:5px; padding:2px 8px; background:#FAFBFD; }
.mcq .op.ok{ border-color:#BFE3CD; background:var(--leaf-soft); font-weight:700; color:#14603A; }
.mcq .op .dc{ color:var(--warn); font-size:14px; font-weight:700; }
.srq{ background:var(--navy); color:#fff; border-radius:8px; padding:6px 12px; }
.srq .lbl{ color:var(--amber); }
.srq .q{ font-size:18.5px; font-weight:700; margin-top:var(--sp-1); line-height:${rtl ? "1.9" : "1.55"}; }
.ms{ background:var(--leaf-soft); border:1px solid #BFE3CD; border-radius:8px; padding:6px 12px; margin-top:0; }
.ms .lbl{ color:#14603A; display:block; }
.ms ul{ margin:var(--sp-1) 0 0; padding-${start}:19px; }
.ms li{ font-size:18px; margin:0; }
.erq{ border:1.5px dashed #C3CCDA; border-radius:9px; padding:6px 12px; margin-top:0; }
.erq .lbl{ color:var(--navy2); display:block; }
.erq .q{ font-size:18px; font-weight:700; margin:var(--sp-1) 0 var(--sp-2); }
.erq .part{ display:flex; gap:8px; font-size:18px; align-items:baseline; }
.erq .part .mk{ flex:0 0 auto; margin-${start}:auto; color:var(--amber); font-weight:800; font-size:15.5px; }
.how{ font-size:15.5px; color:var(--mut); display:block; margin-top:var(--sp-1); }
.ord{ margin:0; padding-${start}:21px; }
.ord li{ font-size:18px; margin:0; line-height:1.55; }
.nxt{ display:flex; gap:var(--sp-2); }
.nxt > div{ flex:1 1 0; border-radius:7px; padding:5px 11px; border:1px solid; }
.nxt .a{ background:#F5F8FC; border-color:#CBD8E8; } .nxt .a .lbl{ color:var(--navy2); display:block; }
.nxt .b{ background:var(--warn-soft); border-color:var(--warn-line); } .nxt .b .lbl{ color:var(--warn); display:block; }
.nxt p{ font-size:18px; }
.coach{ background:var(--navy); color:#fff; border-radius:8px; padding:6px 12px; }
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
.foot{ margin-top:auto; padding-top:var(--sp-2); padding-bottom:${rtl ? "7px" : "1px"};
      border-top:1px solid var(--line);
      display:flex; justify-content:space-between; align-items:baseline; color:var(--mut);
      font-size:14px; gap:14px; line-height:${rtl ? "1.75" : "1.4"}; }
.foot b{ color:var(--navy); font-weight:700; }
.foot .fl{ min-width:0; }
.foot .fr{ text-align:${end}; flex:0 0 auto; white-space:nowrap; }
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
.exit .it > span, .vres a, .tnote, .crit, .bythe, .how, .refq{ unicode-bidi:plaintext; }
` : ""}`;
}

// ── geometry the figure sizer needs ─────────────────────────────────────────
// .pad is padded 22px each side inside a 794px page; figure.dg adds 10px padding either
// side plus a 1.5px border. So a full-width diagram's own drawing box is 727px.
const PAGE_INNER_W = 794 - 21 * 2;      // 752
const FIG_CHROME = 10 * 2 + 3;          // figure.dg padding + border
const FULL_COL = PAGE_INNER_W - FIG_CHROME;  // 727
const SPLIT_GAP = 9;
const DIAGRAM_MIN_PX = 13.5;            // the legibility floor inside a figure

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
function figureSlot(svg, colPx) {
  const rb = requiredBoxFn();
  if (!rb) return { maxHeightPx: null, renderedPx: null, legible: true, tooTall: false };
  let box;
  try {
    box = rb(svg, { minPx: DIAGRAM_MIN_PX, colPx });
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
    legible: box.renderedPx == null || box.renderedPx >= DIAGRAM_MIN_PX,
    tooTall: maxHeightPx > PAGE_CONTENT_H,
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

function makeBlockRenderer(ctx) {
  const L = ctx.L;
  const AR = arrowFor(ctx);
  // Pulled out of R.practice so the ATOMISER can re-use them verbatim: a long practice list
  // may be split between its items across a page break (v8.1), and a second copy of the item
  // markup would drift from this one the first time either is touched.
  const practiceTag = (b) =>
    b.title || (b.mode === "guided" ? L.guided : b.mode === "independent" ? L.independent : L.practice);
  const practiceItem = (it, i) => `<div class="it"><span class="n">${i + 1}.</span>
            <span class="q">${rich(it.q)} <span class="a">${AR} ${rich(it.a)}</span></span>
            ${it.tier && it.tier !== "core" ? `<span class="tier">${esc(L.tier[it.tier] || it.tier)}</span>` : ""}</div>`;
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

    board: (b) => `<div class="blk board"><div class="lbl">${esc(L.board)}</div>
      <div class="t">${rich(b.text)}</div></div>`,

    keywords: (b) => `<div class="blk"><div class="lbl" style="color:var(--navy2)">${esc(L.keywords)}</div>
      <div class="kwrow">${b.items
        .map((k) => `<span class="kw"><b>${rich(k.word)}</b> <i>— ${rich(k.meaning)}</i></span>`)
        .join("")}</div></div>`,

    key_points: (b) => {
      const label = b.title === undefined ? L.keyPoints : b.title;
      return `<div class="blk">${label ? `<div class="lbl" style="color:var(--navy2)">${rich(label)}</div>` : ""}
      <ul class="kp"${label ? "" : ' style="margin-top:0"'}>${b.items.map((i) => `<li>${rich(i)}</li>`).join("")}</ul></div>`;
    },

    worked_example: (b) => `<div class="blk exq">
      <span class="tag">${rich(b.title || L.worked)}</span>
      ${b.prompt ? `<div class="prompt">${rich(b.prompt)}</div>` : ""}
      <ol>${b.steps.map((s) => `<li>${rich(s)}</li>`).join("")}</ol>
      ${b.result ? `<div class="res">${rich(b.result)}</div>` : ""}</div>`,

    faded_example: (b) => `<div class="blk exq we">
      <span class="tag">${rich(b.title || L.faded)}</span>
      ${b.prompt ? `<div class="prompt">${rich(b.prompt)}</div>` : ""}
      <ol>${b.steps.map((s) => `<li>${rich(s)}</li>`).join("")}</ol>
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
      // The slot is COMPUTED, never a magic number. See figureSlot().
      const slot = figureSlot(svg, colPx || FULL_COL);
      const label = `"${(b.spec && b.spec.type) || "?"}"${b.spec && b.spec.caption ? ` (${String(b.spec.caption).slice(0, 40)})` : ""}`;
      if (!slot.legible) {
        ctx.figureProblem(`FIGURE TOO SMALL: diagram ${label} renders its smallest label at ` +
          `${slot.renderedPx}px in a ${Math.round(colPx || FULL_COL)}px column (floor ${DIAGRAM_MIN_PX}px). ` +
          `It needs ${slot.minWidthPx}px of width — give it a full-width row, or simplify it.`);
      } else if (slot.tooTall) {
        ctx.figureProblem(`FIGURE TOO TALL: diagram ${label} needs ${slot.maxHeightPx}px of height to stay ` +
          `readable, which is more than one page (${PAGE_CONTENT_H}px). Split it or simplify it — ` +
          `shrinking it would put its labels below the ${DIAGRAM_MIN_PX}px floor.`);
      }
      // The clamp rides a custom property so it lands on the SVG itself — a max-height on the
      // <figure> would clip the drawing instead of scaling it.
      const cap = slot.maxHeightPx ? ` style="--fig-h:${slot.maxHeightPx}px"` : "";
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
    const colW = (grow) => Math.floor(wide * grow) - FIG_CHROME;

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
  return { html: decorate(html, `sp-${sp}`), sec: o.sec || null, first: !!o.first, glue: !!o.glue, sp };
}

function bar(id, name, minutes, L, extraCls = "") {
  const m = SECTION_META[id];
  return `<div class="bar ${m.cls}${extraCls ? " " + extraCls : ""}" data-sec="${esc(id)}">
    <span class="badge">${m.letter}</span><span class="nm">${rich(name)}</span>
    ${minutes ? `<span class="mins">${minutes} ${esc(L.min)}</span>` : ""}</div>`;
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
  return `<div class="bar ${m.cls} cont" data-sec="${esc(info.id)}">
    <span class="badge">${m.letter}</span><span class="nm">${name}</span></div>`;
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
 *   right  NIETE Teaching Assistant · v2026-08-30 · page 3 of 5
 *
 * The wordmark lives HERE and not in the hero kicker: "GRADE 9 · CHEMISTRY — NIETE TEACHING
 * ASSISTANT" wrapped onto two lines and pushed the lesson title down every single page.
 * Render-law 13 still holds — no brand in the document means no brand text at all.
 */
function footerHtml(doc, ctx, n, total) {
  const p = doc.provenance;
  const L = ctx.L;
  const chapter = p.chapter_title ? `${p.chapter} &mdash; ${rich(p.chapter_title)}` : rich(p.chapter);
  const left = `${esc(L.grade)} ${p.grade} ${rich(p.subject)} &middot; ${chapter} &middot; ${esc(L.pp)}${isoAtom(esc(p.printed_pages), ctx)}`;
  const brand = p.brand && p.brand.name ? `<span class="wm">${esc(p.brand.name)}</span> &middot; ` : "";
  // No invented dates: a doc with no provenance.version simply carries none.
  const ver = p.version ? `v${esc(p.version)} &middot; ` : "";
  return `<div class="foot"><div class="fl">${left}</div><div class="fr">${brand}${ver}${esc(L.pageOf(n, total))}</div></div>`;
}

function page1(doc, ctx, secIndex) {
  const L = ctx.L;
  const p = doc.provenance;
  const blk = makeBlockRenderer(ctx);
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
  const hero = `<div class="hero">
    <div class="h-col">
      <div class="kicker">${esc(L.grade)} ${p.grade} &middot; ${rich(p.subject)}</div>
      <div class="h-title">${rich(p.topic)}</div>
    </div>
    <div class="h-meta">
      <div>${rich(p.chapter)}</div>
      <div>${esc(L.page)}${isoAtom(esc(p.printed_pages), ctx)} &middot; <b>${doc.period_minutes} ${esc(L.min)}</b></div>
      <div class="chips">
        <span class="tchip">${esc(doc.lp_type)}</span>
        ${doc.board_weight ? `<span class="tchip plain">${rich(doc.board_weight)}</span>` : ""}
      </div>
    </div>
  </div>`;

  // ── O · LEARNING OUTCOME & OBJECTIVES — ONE BOX ──────────────────────────
  // Spec §2: "Outcome and objectives are one box — not two stacked blocks." v8 printed the
  // verbatim SLO as the box and the objectives as a list beneath it, which read as two.
  // v9 leads with the OUTCOME (what the pupil can do), then the ✓ line naming the question
  // type and its marks, then the objectives — each wearing its OWN SLO code (spec §3 O).
  const O = doc.objectives;
  const objLi = (o) =>
    `<li>${rich(o.text)}${o.slo_code ? `<span class="slocode">${rich(o.slo_code)}</span>` : ""}` +
    `${o.locally_added ? ` <i style="color:var(--mut)">(${esc(L.locallyAdded)})</i>` : ""}</li>`;
  const sloBox = `<div class="slo">
    <div class="lbl">${esc(L.outcome)}${doc.slo.code ? ` &middot; ${rich(doc.slo.code)}` : ""}</div>
    <p>${rich(O.outcome)}</p>
    ${O.by_the_end ? `<div class="bythe"><b>&#10003;</b> ${rich(O.by_the_end)}</div>` : ""}
    <div class="src">${esc(L.slo)}: ${isoQuote(`&ldquo;${rich(doc.slo.text_verbatim)}&rdquo;`, ctx)} &middot; ${esc(L.page)}${rich(doc.slo.source_page)}${doc.slo.assessment_status ? ` &middot; ${isoAtom(esc(doc.slo.assessment_status), ctx)}` : ""} &middot; ${isoAtom(esc(doc.slo.cognitive_level), ctx)}</div>
    <div class="objhd"><span class="badge">O</span>${esc(L.objectives)}</div>
    <ul class="objs">${O.items.map(objLi).join("")}</ul>
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
   * COMPACT on purpose: the url alone, not the title/channel/duration/why the old block printed.
   * Page 1 is the busiest page in the document and this is furniture, so it may cost a LINE, not a
   * paragraph — the page-count gate is real and the teach part is often at its cap.
   */
  const shortVideoUrl = (v) => {
    if (!v || !v.url) return null;
    const m = /(?:v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(String(v.url));
    if (m) return `youtu.be/${m[1]}`;
    return String(v.url).replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  };

  const resourcesLine = (() => {
    const dev = (doc.sections || []).find((x) => x && x.id === "development");
    const v = dev && dev.video;
    const short = shortVideoUrl(v);
    if (!short) return "";
    const href = String(v.url || "");
    // Only http(s) becomes a tap target. The picks come from our own ranker, but an anchor built
    // out of stored data is an anchor someone would eventually like to control.
    if (!/^https?:\/\//i.test(href)) return "";
    // U+2066 … U+2069 around the VISIBLE run: an RTL paragraph reorders a bare latin url into
    // something a teacher cannot read, which is the fix the phone number already carries.
    const shown = ctx.rtl ? `\u2066${short}\u2069` : short;
    return `<div class="vres"><span class="ico">&#128250;</span><span class="lbl">${esc(L.video)}</span><a href="${esc(href)}">${esc(shown)}</a></div>`;
  })();

  // The sequence strip (spec §5), directly under the masthead. Arrows point
  // WITH the reading direction — see arrowFor.
  const AR = arrowFor(ctx);
  const seq = doc.sequence
    ? `<div class="seq">${doc.sequence.previous ? `<span><b>${esc(L.seqPrev)}:</b> ${rich(doc.sequence.previous)}</span><span class="arrow">${AR}</span>` : ""}
       <span class="now">${rich(doc.sequence.this)}</span>
       ${doc.sequence.next ? `<span class="arrow">${AR}</span><span><b>${esc(L.seqNext)}:</b> ${rich(doc.sequence.next)}</span>` : ""}
       ${doc.sequence.checkpoint ? `<span>&middot; <b>${esc(L.seqCheck)}:</b> ${rich(doc.sequence.checkpoint)}</span>` : ""}</div>`
    : "";

  // The warm-up is ONE ROW inside the Introduction (spec §2) — not a section, not a band of
  // its own. The scaffold item comes first and says so; prior knowledge alone is not a warm-up.
  const warmupBody = (wu) => `<div class="blk wu"><div class="lbl" style="color:#8A5F04">${esc(L.warmup)}</div>${wu.items
    .map(
      (it, i) => `<div class="it"><span class="n">${i + 1}.</span>
        <span class="q">${rich(it.q)} <span class="a">${AR} ${rich(it.a)}</span></span>
        <span class="kind">${esc(L.kind[it.kind] || it.kind)}${it.from ? ` &middot; ${rich(it.from)}` : ""}</span></div>`
    )
    .join("")}</div>`;

  // ── the per-section EXTRAS the closed heading system requires ────────────
  // These are section-level DATA, not blocks: the warm-up row (I), the textbook citation and
  // the video (D), the checkpoint / exit ticket / re-teach rule (C), the tagged homework (H).
  // They render in a fixed position inside their section so a teacher finds them in the same
  // place in every plan — which is the whole point of a closed heading system.
  const before = (s) => {
    const out = [];
    if (s.id === "introduction" && s.warmup) out.push({ html: warmupBody(s.warmup), sp: 2 });
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
      const hwItem = (it, i) => `<div class="it"><span class="n">${i + 1}.</span>
          <span class="q">${rich(it.text)}${it.source && (it.source.page || it.source.questions || it.source.paper)
            ? ` <span class="src">(${[it.source.paper, it.source.questions, it.source.page ? `${L.page}${it.source.page}` : null].filter(Boolean).map((x) => rich(x)).join(", ")})</span>` : ""}</span>
          <span class="tag">[${rich(it.slo_code)}, ${esc(it.level)}]${it.marks ? ` ${it.marks}${esc(L.markAbbr)}` : ""}</span></div>`;
      s.homework.items.forEach((it, i) => {
        out.push({ html: `<div class="blk hw">${hwItem(it, i)}</div>`, sp: i === 0 ? 2 : 1 });
      });
    }
    return out;
  };

  // A half section sits in a two-column secrow (gap --sp-3), so its figures get half the width.
  const HALF_COL = Math.floor((PAGE_INNER_W - 12) / 2) - FIG_CHROME;
  const whole = (s, colPx) => `<div class="sec">${bar(s.id, s.title || L[s.id], s.minutes, L)}
      ${before(s).map((x) => x.html).join("\n")}
      ${s.blocks.map((b) => blk(b, colPx)).join("\n")}
      ${after(s).map((x) => x.html).join("\n")}</div>`;

  // Which blocks get the wider rung: the loudest boxes on the page, and anything with a
  // picture in it. "Breathing room" is not one uniform gap — it is a hierarchy.
  const LOUD = new Set(["diagram", "textbook_figure", "watch_out", "latex", "chem"]);
  const blockAtoms = (b, colPx) => {
    if (b.type === "practice" && Array.isArray(b.items) && b.items.length >= 3) {
      // YOU-DO lists are the one body block that may break BETWEEN items (operator, v8.1) —
      // the tag stays glued to item 1 so a page never opens on a bare numbered line.
      const out = [{
        html: `<div class="blk pr"><span class="tag">${rich(blk.practiceTag(b))}</span>
          <div class="items">${blk.practiceItem(b.items[0], 0)}</div></div>`,
        sp: 2, glue: true,
      }];
      for (let i = 1; i < b.items.length; i++) {
        out.push({ html: `<div class="blk pr"><div class="items">${blk.practiceItem(b.items[i], i)}</div></div>`, sp: 1 });
      }
      return out;
    }
    const loud = (b.type === "ask" && b.hook) || LOUD.has(b.type);
    return [{ html: blk(b, colPx), sp: loud ? 3 : 2 }];
  };

  const sectionAtoms = (s, colPx) => {
    const id = s.id;
    const title = s.title || L[id];
    secIndex[id] = { kind: "p1", id, title };
    const out = [atom(bar(id, title, s.minutes, L), { sec: id, first: true, glue: true, sp: 4 })];
    for (const x of before(s)) out.push(atom(x.html, { sec: id, glue: x.glue, sp: x.sp }));
    for (const b of s.blocks) {
      for (const a of blockAtoms(b, colPx)) out.push(atom(a.html, { sec: id, glue: a.glue, sp: a.sp }));
    }
    for (const x of after(s)) out.push(atom(x.html, { sec: id, sp: x.sp }));
    return out;
  };

  const A = [atom(hero, { sp: 0 })];
  if (seq) A.push(atom(seq, { sp: 2 }));
  A.push(atom(sloBox, { sp: 2 }));
  // Directly under the outcome box: the first thing after "what the pupil can do".
  if (resourcesLine) A.push(atom(resourcesLine, { sp: 2 }));

  // consecutive layout:"half" sections share one two-column band. Each keeps its own
  // lettered bar, so the closed heading vocabulary survives; only the stacking goes away.
  // A band is ONE atom: two columns cannot straddle a page break.
  for (let i = 0; i < doc.sections.length; i++) {
    const s = doc.sections[i];
    const n = doc.sections[i + 1];
    if (s.layout === "half" && n && n.layout === "half") {
      A.push(atom(`<div class="secrow">${whole(s, HALF_COL)}${whole(n, HALF_COL)}</div>`, { sp: 4 }));
      i++;
    } else {
      A.push(...sectionAtoms(s, FULL_COL));
    }
  }

  const mats = `<div class="mats">
    <div class="cont">${doc.materials.length ? `<b>${esc(L.materials)}:</b> ${doc.materials.map((m) => rich(m)).join(" &middot; ")} &nbsp;|&nbsp; ` : ""}<b>${esc(L.pacing)}:</b> ${pacing.join(" + ")} = ${pacingSum} ${esc(L.min)}. ${esc(L.continues)}</div>
  </div>`;
  A.push(atom(mats, { sp: 4 }));

  return { part: "teach", atoms: A };
}

/** Strip an author's own leading "1." / "2)" / "۳۔" — the <ol> supplies the number.
 *  Without this the board plan printed "1. 1. Draw the leaf". */
function unnumber(s) {
  return String(s ?? "").replace(/^\s*[0-9\u0660-\u0669\u06F0-\u06F9]{1,2}\s*[.)\u06D4\u060C:\u2013-]\s+/, "");
}

function page2(doc, ctx, secIndex) {
  const L = ctx.L;
  const P = doc.page2;
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
   */
  const S = (letter, name, bodies) => {
    const key = `p2-${letter}`;
    secIndex[key] = { kind: "p2", letter, title: name };
    A.push(atom(p2bar(letter, name), { sec: key, first: true, glue: true, sp: 2 }));
    bodies.filter(Boolean).forEach((b) => {
      const html = typeof b === "string" ? b : b.html;
      A.push(atom(html, { sec: key, sp: typeof b === "string" ? 1 : b.sp == null ? 1 : b.sp }));
    });
  };

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
  const gridRows = (cls, cards, firstSp = 1) => {
    const perRow = cls === "grid3" ? 3 : 2;
    const out = [];
    for (let i = 0; i < cards.length; i += perRow) {
      out.push({ html: `<div class="${cls}">${cards.slice(i, i + perRow).join("")}</div>`,
                 sp: i === 0 ? firstSp : 2 });
    }
    return out;
  };

  let boardDia = "";
  if (P.board_final.diagram) {
    let svg;
    try {
      svg = ctx.renderDiagram(P.board_final.diagram);
    } catch (e) {
      ctx.warn(`page2 board diagram did not render: ${e.message}`);
      svg = ctx.placeholder(P.board_final.diagram);
    }
    ctx.vectorFigure = true;
    const slot = figureSlot(svg, FULL_COL);
    const style = slot.maxHeightPx ? ` style="--fig-h:${slot.maxHeightPx}px"` : "";
    // board_final.caption is a SEPARATE authored string from the diagram spec's own caption
    // (which the SVG already prints). Print it only when it says something different.
    const specCap = P.board_final.diagram.caption;
    const cap = P.board_final.caption && P.board_final.caption !== specCap ? P.board_final.caption : null;
    boardDia = `<figure class="dg"${style}>${svg}${cap ? `<figcaption>${rich(cap)}</figcaption>` : ""}</figure>`;
  }

  const p2head = `<div class="p2head">
      <span class="pill">${esc(L.supportPage)}</span>
      <div class="t">${rich(p.topic)}</div>
      <div class="r">${esc(L.grade)} ${p.grade} ${rich(p.subject)} &middot; ${esc(L.notReadAloud)}<br>${rich(p.chapter)} &middot; ${esc(L.page)}${isoAtom(esc(p.printed_pages), ctx)}</div>
    </div>`;
  A.push(atom(p2head, { sp: 0 }));

  S("A", L.p2Board, [
    boardDia ? { html: boardDia, sp: 2 } : null,
    `<div class="card"><span class="lbl">${esc(L.drawOrder)}</span>
      <ol class="ord">${P.board_final.draw_order.map((d) => `<li>${rich(unnumber(d))}</li>`).join("")}</ol></div>`,
  ]);

  // B — MODEL ANSWERS THAT NAME THEIR QUESTION.
  // The expert's complaint was not that answers were wrong; it was that a page of answers
  // never said what they were answers TO. Each card now resolves its `ref` back to the
  // question as the LP states it, and prints that question above the answer. When a ref
  // resolves to nothing the card says so out loud — lint's REF_ABSENT fails the doc, and the
  // page must not quietly look complete in the meantime.
  const Q = questionIndex(doc);
  S("B", L.p2Model, gridRows("grid2", P.model_answers
    .map((m) => {
      const q = m.ref ? Q.get(m.ref) : null;
      return `<div class="card"><span class="lbl">${m.ref ? esc(m.ref) : ""}</span>
      ${q ? `<span class="refq">${rich(q.q)}</span>` : (m.label ? `<span class="refq">${rich(m.label)}</span>` : `<span class="refq">${esc(L.refMissing)}</span>`)}
      <p class="a">${rich(m.answer)}</p>
      ${m.marking_note ? `<span class="how">${rich(m.marking_note)}</span>` : ""}</div>`;
    })));

  S("C", L.p2Mistakes, gridRows("grid3", P.mistakes
    .map(
      (m) => `<div class="mis">
      <div class="x"><span class="lbl">&#10007; ${esc(L.pupilSays)}</span><p>${rich(m.pupil_says)}</p></div>
      <div class="v"><span class="lbl">&#10003; ${esc(L.youAsk)}</span><p>${rich(m.you_ask)}</p></div></div>`
    )));

  S("D", L.p2Diff, [`<div class="grid3">
    <div class="card"><span class="lbl">${esc(L.stuck)}</span><p>${rich(P.differentiation.stuck)}</p></div>
    <div class="card"><span class="lbl">${esc(L.barrier)}</span><p>${rich(P.differentiation.barrier)}</p></div>
    <div class="card"><span class="lbl">${esc(L.early)}</span><p>${rich(P.differentiation.early)}</p></div></div>`]);

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

  S("E", L.p2Exam, [
    mcqAtoms.length ? { html: `<div class="lbl" style="color:var(--navy2)">${esc(L.mcq)}</div>`, sp: 1 } : null,
    ...mcqAtoms,
    srqHtml ? { html: srqHtml, sp: 2 } : null,
    erqHtml ? { html: erqHtml, sp: 2 } : null,
    eb.how_marked ? `<span class="how"><b>${esc(L.howMarked)}:</b> ${rich(eb.how_marked)}</span>` : null,
  ]);

  // F — the homework worked in full. Like B, each entry resolves its `ref` back to the item as
  // the homework section states it, so the teacher never has to hold two pages side by side.
  // F is the tallest structure on the support page — median 496px, max 853px across the study's
  // 24 lessons — and therefore the single biggest source of stranded space. It splits by row.
  S("F", L.p2Hw, gridRows("grid2", P.homework_key
    .map((h) => {
      const it = h.ref ? Q.get(h.ref) : null;
      return `<div class="card mk"><span class="lbl">${h.ref ? esc(h.ref) : ""}${h.marks ? ` &middot; ${h.marks} ${esc(L.marks)}` : ""}</span>
      <span class="refq">${it ? rich(it.q) : (h.item ? rich(h.item) : esc(L.refMissing))}</span>
      <p class="a">${rich(h.answer)}</p></div>`;
    })));

  S("G", `${L.p2Next} / ${L.p2NotGoing}`, [`<div class="nxt">
    <div class="a"><span class="lbl">${esc(L.p2Next)}</span><p>${rich(P.next_period)}</p></div>
    <div class="b"><span class="lbl">&#9888; ${esc(L.p2NotGoing)}</span><p>${rich(P.not_going)}</p></div></div>`]);

  // H — the coaching corner, on the K-5 pattern (operator, 2026-09-02): something from THIS
  // lesson, then a question she asks herself, then the offer of real coaching. The offer is
  // FURNITURE — the number lives in the label pack and nowhere else, so it cannot drift document
  // to document and costs nothing against the word budget. K-5 learned the last step the hard
  // way: a CTA that does not say what comes BACK is just a request (FEEDBACK_LEDGER #13).
  S("H", L.p2Coach, [`<div class="coach"><p>${rich(P.coaching_lookfor)}</p>
    ${P.coaching_reflection ? `<p class="ask"><span class="lbl">${esc(L.coachAsk)}</span>${rich(P.coaching_reflection)}</p>` : ""}
    <p class="offer">1 ${esc(L.coachOffer)} ${arrowFor(ctx)} 2 ${esc(L.coachSend)} ${arrowFor(ctx)} 3 ${esc(L.coachBack)}</p></div>`]);

  return { part: "support", atoms: A };
}

// The page box, in CSS px: A4 at 96dpi, less .pad's own padding.
const PAGE_CONTENT_H = 1123 - 10 - 4;

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
  const lang = opts.lang || doc.provenance.medium || "en";
  const rtl = lang === "ur";
  // Every build sets the prose pipeline's direction for itself (see lib/rich.js
  // — buildHtml is synchronous, so two documents cannot interleave).
  setRtlProse(rtl);
  const L = LABELS[rtl ? "ur" : "en"];
  const warnings = [];
  const figureProblems = [];

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
    placeholder,
    stubDiagrams,
    warn: (m) => warnings.push(m),
    figureProblem: (m) => figureProblems.push(m),
    rasterFigure: false,
    vectorFigure: false,
  };

  const fonts = fontCss({ urdu: rtl });
  if (fonts.missing.length) warnings.push(`font file(s) not embedded, falling back to system: ${fonts.missing.join(", ")}`);

  const secIndex = {};
  const teach = page1(doc, ctx, secIndex);
  const support = page2(doc, ctx, secIndex);
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
<html lang="${rtl ? "ur" : "en"}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${rich(doc.provenance.topic)} &middot; ${esc(L.grade)} ${doc.provenance.grade} ${rich(doc.provenance.subject)}</title>
<meta name="subject" content="lesson_id=${esc(doc.lesson_id)}">
<meta name="keywords" content="${esc(doc.provenance.book_stem)}; lp_doc ${esc(doc.schema_version)}; ${esc(doc.lp_type)}">
<style>${css(rtl, fonts.css, katexCss())}</style>
</head>
<body${brandHex ? ` style="--brand:${esc(brandHex)}"` : ""}>
${contProbe}${paginate("teach", teach.atoms, breaks.teach || [], ctx, doc, secIndex, 1, total)}
${paginate("support", support.atoms, breaks.support || [], ctx, doc, secIndex, teachPages + 1, total)}
</body>
</html>`;

  return {
    html, warnings, figureProblems, fontReport: fonts,
    atoms: {
      teach: teach.atoms.map((a) => ({ sec: a.sec, first: a.first, glue: a.glue })),
      support: support.atoms.map((a) => ({ sec: a.sec, first: a.first, glue: a.glue })),
    },
    probeKeys,
    childCounts: { teach: teach.atoms.length, support: support.atoms.length },
    hasRasterFigure: ctx.rasterFigure,
    hasVectorFigure: ctx.vectorFigure,
    pageContentHeight: PAGE_CONTENT_H,
  };
}

module.exports = { buildHtml, SECTION_META, PAGE_CONTENT_H, SPACING, DIAGRAM_LABELS, diagramLabel };
