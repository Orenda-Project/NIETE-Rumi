// panels — 2-3 side-by-side bordered comparison panels.
//
// The single most-used diagram shape in the 6-12 corpus: two columns that hold
// the same *kind* of claim about two different things, so the difference is the
// only thing that moves. Replaces the CSS `panelGroup()` in render_lp_html.js
// (bold heading / small italic subtitle / body lines / bold coloured footer) and
// the AI-image prompts that duplicated it (hist_evidence_scales,
// chem_atoms_vs_molecules, urdu_breath_marks).
//
// Layout invariants:
//   * panels are equal width and equal height (the tallest panel's content)
//   * every string is wrapped to its own panel — nothing overflows the border
//   * the footer sits flush at the panel bottom, on a tinted chip
//   * lang:'ur' mirrors the column order (panel 1 on the right) and grows every
//     line box to Nastaliq leading

const { Svg, C, SIZE, LEADING, measure, wrap, hasUrdu } = require("../lib/svg");
const { SERIES } = require("../lib/tokens");

const isUr = (lang, s) => hasUrdu(String(s ?? ""));  // script decides, not the declared lang

// measure() carries a Nastaliq average of 0.40em/char; rendered Noto Nastaliq
// runs up to ~35% wider. Under-estimating is the expensive direction — the
// browser re-wraps inside the foreignObject and the text falls out of the panel.
const UR_PAD = 1.35;
const tw = (s, size, o = {}) =>
  isUr(o.lang, s) ? measure(s, size, { lang: "ur" }) * UR_PAD : measure(s, size, o);

/** Height a centred block of `s` consumes when wrapped to `w`. */
function blockH(s, size, w, lang) {
  if (s === undefined || s === null || s === "") return 0;
  if (isUr(lang, s)) {
    const nl = Math.max(1, Math.ceil(tw(s, size, { lang: "ur" }) / Math.max(20, w - 6)));
    return nl * size * LEADING.urdu + size * 0.45;
  }
  // measure BOLD: reserving the wider case is free, while under-reserving wraps
  // an extra line at draw time and the block spills out of the box kept for it
  return wrap(String(s), size, w, { weight: 700 }).length * size * LEADING.latin;
}

/** Draw a centred block with its TOP edge at y. Returns the height consumed. */
function drawBlock(svg, cx, y, w, s, o) {
  const h = blockH(s, o.size, w, o.lang);
  if (!h) return 0;
  if (isUr(o.lang, s)) {
    svg.text(cx, y + h / 2, s, { ...o, anchor: "middle", baseline: "middle", w, h, lang: "ur" });
  } else {
    const lines = wrap(String(s), o.size, w, o);
    const lh = o.size * LEADING.latin;
    lines.forEach((ln, i) =>
      svg.text(cx, y + o.size * 0.82 + i * lh, ln, { ...o, anchor: "middle", lang: "en" })
    );
  }
  return h;
}

function render(spec) {
  const panels = (Array.isArray(spec.panels) ? spec.panels : []).filter(Boolean);
  const list = panels.length ? panels : [{ title: "" }];
  const ur = spec.lang === "ur";
  const cols = Math.max(1, Math.min(Number(spec.columns) || list.length, 3));
  const rows = Math.ceil(list.length / cols);

  const bodyW = spec.width || 640;
  const gap = 16;
  const inset = 3;
  const padX = 12;
  const panelW = (bodyW - inset * 2 - gap * (cols - 1)) / cols;
  const innerW = panelW - padX * 2;

  const SZ = {
    title: ur ? 16.5 : SIZE.label,
    sub: ur ? 13.5 : 12.5,
    glyph: ur ? 20 : SIZE.big,
    line: ur ? 14.5 : SIZE.small,
    foot: ur ? 15 : 13.5,
  };

  const padTop = 11;
  const padBottom = 10;
  const bandPad = 12; // vertical padding inside the footer chip
  const bandGap = 10; // gap between the body text and the chip

  // ---- measure every panel, then use the tallest ----
  const geom = list.map((p) => {
    let top = padTop + blockH(p.title, SZ.title, innerW, spec.lang);
    if (p.sub) top += 3 + blockH(p.sub, SZ.sub, innerW, spec.lang);
    if (p.glyph) top += 6 + blockH(p.glyph, SZ.glyph, innerW, spec.lang);
    const lines = Array.isArray(p.lines) ? p.lines.filter((l) => l !== undefined && l !== null && l !== "") : [];
    if (lines.length) {
      top += 9;
      lines.forEach((l, i) => {
        top += blockH(l, SZ.line, innerW, spec.lang) + (i ? 6 : 0);
      });
    }
    const footH = p.foot ? blockH(p.foot, SZ.foot, innerW - 10, spec.lang) : 0;
    const bottom = p.foot ? bandGap + footH + bandPad + padBottom : padBottom;
    return { lines, footH, total: top + bottom };
  });

  const panelH = Math.max(86, ...geom.map((g) => g.total));
  const bodyH = inset * 2 + rows * panelH + (rows - 1) * gap;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  list.forEach((p, i) => {
    const row = Math.floor(i / cols);
    const colIn = i % cols;
    const col = ur ? cols - 1 - colIn : colIn;
    const px = inset + col * (panelW + gap);
    const py = inset + row * (panelH + gap);
    const cx = px + panelW / 2;
    const colour = p.color || SERIES[i % SERIES.length];
    const g = geom[i];

    // border
    svg.rect(px, py, panelW, panelH, { rx: 6, fill: C.panel, stroke: colour, sw: 1.6 });

    // footer chip, flush at the bottom
    if (p.foot) {
      const bandH = g.footH + bandPad;
      const bandY = py + panelH - padBottom - bandH;
      svg.rect(px + 7, bandY, panelW - 14, bandH, { rx: 5, fill: colour, opacity: 0.12 });
      drawBlock(svg, cx, bandY + bandPad / 2, innerW - 10, p.foot, {
        size: SZ.foot,
        weight: 700,
        fill: colour,
        lang: spec.lang,
      });
    }

    // body, from the top
    let y = py + padTop;
    y += drawBlock(svg, cx, y, innerW, p.title, {
      size: SZ.title,
      weight: 700,
      fill: colour,
      lang: spec.lang,
      letterSpacing: ur ? undefined : "0.02em",
    });
    if (p.sub) {
      y += 3;
      y += drawBlock(svg, cx, y, innerW, p.sub, {
        size: SZ.sub,
        italic: true,
        fill: C.muted,
        lang: spec.lang,
      });
    }
    if (p.glyph) {
      y += 6;
      y += drawBlock(svg, cx, y, innerW, p.glyph, {
        size: SZ.glyph,
        weight: 700,
        fill: C.ink,
        lang: spec.lang,
      });
    }
    if (g.lines.length) {
      y += 9;
      g.lines.forEach((l, k) => {
        if (k) y += 6;
        y += drawBlock(svg, cx, y, innerW, l, { size: SZ.line, fill: C.text, lang: spec.lang });
      });
    }
  });

  return svg.toString();
}

module.exports = {
  type: "panels",
  aliases: ["comparison", "compare"],
  summary: "2-3 equal side-by-side bordered panels — heading, italic subtitle, lines, coloured footer.",
  render,
  examples: [
    {
      name: "panels_railway_britain_india",
      spec: {
        type: "panels",
        title: "WHO WAS THE RAILWAY BUILT FOR?",
        panels: [
          {
            title: "BUILT FOR BRITAIN",
            sub: "page 16 and 17",
            lines: [
              "military and communication purposes",
              "managed by British engineers",
              "troops and grain to Britain",
            ],
            foot: "where the goods went",
          },
          {
            title: "BUILT FOR INDIA",
            sub: "page 17",
            lines: ["thousands of jobs", "support to Indian traders", "a symbol of progress"],
            foot: "who got the work",
          },
        ],
        caption: "One railway line, two claims. The evidence for each sits in the textbook pages named.",
      },
    },
    {
      name: "panels_atoms_vs_molecules",
      spec: {
        type: "panels",
        title: "ONE MOLE, TWO ANSWERS",
        panels: [
          {
            title: "OXYGEN ATOMS",
            sub: "one O atom at a time",
            glyph: "O",
            lines: ["atomic mass = 16"],
            foot: "1 mole of O atoms = 16 g",
          },
          {
            title: "OXYGEN MOLECULES",
            sub: "O atoms paired up as O2",
            glyph: "O—O",
            lines: ["molecular mass = 16 x 2 = 32"],
            foot: "1 mole of O2 = 32 g",
            color: C.plum,
          },
        ],
        caption: "The mole counts particles. Ask which particle before you weigh it.",
      },
    },
    {
      name: "panels_urdu_breath_marks",
      spec: {
        type: "panels",
        lang: "ur",
        title: "وقفے کی دو صورتیں",
        panels: [
          {
            title: "رک رک کر",
            sub: "مطلب ٹوٹ جاتا ہے",
            lines: ["ہر لفظ کے بعد وقفہ", "ادب کے الفاظ پر ٹھہراؤ"],
            foot: "جملہ دو ٹکڑوں میں",
            color: C.warn,
          },
          {
            title: "روانی سے",
            sub: "مطلب مکمل رہتا ہے",
            lines: ["سانس صرف وقفے پر", "ادب کے الفاظ ساتھ چلتے ہیں"],
            foot: "ایک مکمل جملہ",
            color: C.leaf,
          },
        ],
        caption: "سانس کہاں لینی ہے، یہ معنی طے کرتے ہیں",
      },
    },
  ],
};
