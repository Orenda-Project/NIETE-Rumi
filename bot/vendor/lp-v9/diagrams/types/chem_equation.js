// chem_equation — a deterministic chemical-equation typesetter, in pure SVG <text>.
//
// Why hand-rolled: KaTeX/mhchem emit HTML+CSS, and MathML has no reliable print
// path in headless Chromium. A chemical equation is a *one-dimensional* run of
// glyphs with three vertical registers (baseline / subscript / superscript), so
// laying it out against lib/measure.js is exact, cheap and byte-stable.
//
// Source syntax (a compact mhchem-like subset):
//
//   2H2 + O2 -> 2H2O                     coefficients, subscripts
//   CaCO3 ->[Δ] CaO + CO2                a condition above the arrow
//   N2 + 3H2 <=>[Fe][450 °C] 2NH3        equilibrium, above + below
//   AgNO3(aq) + NaCl(aq) -> AgCl(s)      state symbols, set italic
//   Cu^2+ + SO4^2- -> CuSO4              superscript charges
//   Ca(OH)2 , Al2(SO4)3                  groups and nested subscripts
//
//   * species are separated by a SPACE-PADDED " + " — an unspaced `+` is read as
//     part of a charge, so `Na^+ + Cl^-` parses the way a chemist writes it.
//   * arrows: ->  <-  <=>  <->  =   (an arrow may carry [above] and [below])
//
// Everything here is LTR by construction: a formula is never bidi-reordered.
// Only the descriptive furniture (conditions, word-equation words, the note)
// may be Urdu, and those are routed through the builder's foreignObject path.

const { Svg, C, SIZE, measure, hasUrdu } = require("../lib/svg");

const SUB_F = 0.62; // subscript / superscript size, as a fraction of the base
const SUP_F = 0.62;
const STATE_F = 0.7;
const SUB_DY = 0.24; // baseline offset, as a fraction of the base
const SUP_DY = -0.44;
const PAD = 16;
const MAXW = 690;

/* ------------------------------------------------------------------ */
/* tokenizer                                                           */
/* ------------------------------------------------------------------ */

/**
 * Split one species into typographic tokens.
 * @returns {{t:'main'|'sub'|'sup'|'state', s:string}[]}
 */
function parseFormula(src, o = {}) {
  const s = String(src ?? "").trim();
  const out = [];
  let i = 0;
  // a leading integer is a stoichiometric coefficient — full size, not a subscript
  const coef = /^(\d+)(?=\s*[A-Za-z([])/.exec(s);
  if (coef) {
    out.push({ t: "main", s: coef[1] });
    i = coef[0].length;
  }
  while (i < s.length) {
    const ch = s[i];
    if (ch === " ") {
      i++;
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      out.push({ t: "main", s: s.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "(") {
      const st = /^\((s|l|g|aq)\)/.exec(s.slice(i));
      if (st) {
        if (o.state !== false) out.push({ t: "state", s: "(" + st[1] + ")" });
        i += st[0].length;
        continue;
      }
      out.push({ t: "main", s: "(" });
      i++;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < s.length && /\d/.test(s[j])) j++;
      out.push({ t: "sub", s: s.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "^") {
      const cm = /^\^(\d*)([+-])/.exec(s.slice(i));
      if (cm) {
        out.push({ t: "sup", s: (cm[1] || "") + (cm[2] === "-" ? "−" : "+") });
        i += cm[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (ch === "*" || ch === "·") {
      out.push({ t: "main", s: "·" });
      i++;
      continue;
    }
    out.push({ t: "main", s: ch }); // ) [ ] and anything else, at full size
    i++;
  }
  return out;
}

/** Place every token on its own x, returning the total advance. */
function layoutFormula(src, base, o = {}) {
  const toks = parseFormula(src, o);
  const items = [];
  let x = 0;
  for (const t of toks) {
    let size = base;
    let dy = 0;
    let italic = false;
    if (t.t === "sub") {
      size = Math.max(SIZE.tiny, base * SUB_F);
      dy = base * SUB_DY;
    } else if (t.t === "sup") {
      size = Math.max(SIZE.tiny, base * SUP_F);
      dy = base * SUP_DY;
    } else if (t.t === "state") {
      size = Math.max(SIZE.tiny, base * STATE_F);
      italic = true;
      x += base * 0.14;
    }
    items.push({ s: t.s, x, size, dy, italic, kind: t.t });
    x += measure(t.s, size, { weight: t.t === "main" ? 600 : undefined });
  }
  return { items, w: x };
}

/**
 * Draw a formula. `y` is the main baseline. Returns the width consumed.
 * Exported so `molecule.js` can print C6H12O6 with real subscripts.
 */
function drawFormula(svg, x, y, src, o = {}) {
  const base = o.size ?? SIZE.big;
  const L = o.layout || layoutFormula(src, base, o);
  const x0 = o.anchor === "middle" ? x - L.w / 2 : o.anchor === "end" ? x - L.w : x;
  for (const it of L.items) {
    svg.text(x0 + it.x, y + it.dy, it.s, {
      size: it.size,
      fill: o.fill ?? C.ink,
      weight: it.kind === "main" ? (o.weight ?? 600) : undefined,
      italic: it.italic,
      lang: "en", // a formula is never Urdu-shaped
    });
  }
  return L.w;
}

function formulaWidth(src, base, o = {}) {
  return layoutFormula(src, base ?? SIZE.big, o).w;
}

/* ------------------------------------------------------------------ */
/* equation split                                                      */
/* ------------------------------------------------------------------ */

const ARROW_RE = /(<=>|<->|<--|-->|->|<-|=>|=)(\[[^\]]*\])?(\[[^\]]*\])?/;

function splitEquation(src) {
  const s = String(src ?? "").trim();
  const m = ARROW_RE.exec(s);
  if (!m) return { left: s, right: "", arrow: null, above: "", below: "" };
  return {
    left: s.slice(0, m.index).trim(),
    right: s.slice(m.index + m[0].length).trim(),
    arrow: m[1],
    above: m[2] ? m[2].slice(1, -1) : "",
    below: m[3] ? m[3].slice(1, -1) : "",
  };
}

const splitSide = (s) =>
  String(s ?? "")
    .split(/\s+\+\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * The builder centres title/caption/source/note on the full width and does NOT
 * wrap Latin chrome, so a body narrower than its own caption gets the caption
 * clipped by the viewBox. Every type therefore floors its body width here.
 */
function chromeWidth(spec, cap = MAXW) {
  const lang = spec.lang === "ur" ? "ur" : "en";
  const w = (s, size) => (s ? measure(String(s), size, { lang: hasUrdu(String(s)) ? "ur" : lang }) + 26 : 0);
  return Math.min(
    cap,
    Math.max(
      w(spec.title, SIZE.title * 1.06),
      w(spec.caption, SIZE.caption),
      w(spec.source, SIZE.caption * 0.92),
      w(spec.note, SIZE.caption)
    )
  );
}

/* ------------------------------------------------------------------ */
/* arrows                                                              */
/* ------------------------------------------------------------------ */

/** One barb of a harpoon — the ⇌ glyph is two of these, drawn opposite ways. */
function halfHead(svg, x, y, dir, up, color) {
  const L = 10;
  const W = 6;
  const back = dir > 0 ? x - L : x + L;
  svg.polygon(
    [
      [x, y],
      [back, y + (up ? -W : W)],
      [dir > 0 ? x - L * 0.5 : x + L * 0.5, y],
    ],
    { fill: color }
  );
}

function drawArrow(svg, x, y, len, kind, color) {
  const x2 = x + len;
  if (kind === "<=>" || kind === "<->") {
    svg.line(x, y - 4.5, x2, y - 4.5, { stroke: color, sw: 1.7, cap: "butt" });
    halfHead(svg, x2, y - 4.5, 1, true, color);
    svg.line(x, y + 4.5, x2, y + 4.5, { stroke: color, sw: 1.7, cap: "butt" });
    halfHead(svg, x, y + 4.5, -1, false, color);
    return;
  }
  if (kind === "=") {
    svg.line(x, y - 3.5, x2, y - 3.5, { stroke: color, sw: 1.8 });
    svg.line(x, y + 3.5, x2, y + 3.5, { stroke: color, sw: 1.8 });
    return;
  }
  if (kind === "<-" || kind === "<--") {
    svg.arrow(x2, y, x, y, { stroke: color, sw: 1.9, size: 11, width: 8 });
    return;
  }
  svg.arrow(x, y, x2, y, { stroke: color, sw: 1.9, size: 11, width: 8 });
}

/* ------------------------------------------------------------------ */
/* symbolic equation                                                   */
/* ------------------------------------------------------------------ */

function renderSymbolic(spec) {
  const parsed = splitEquation(spec.equation);
  const cond = spec.conditions || {};
  const above = String(cond.above ?? parsed.above ?? "");
  const below = String(cond.below ?? parsed.below ?? "");
  const arrowKind = parsed.arrow || (parsed.right ? "->" : null);
  const stateOn = spec.state !== false;
  const hl = new Set(
    (Array.isArray(spec.highlight) ? spec.highlight : spec.highlight ? [spec.highlight] : []).map(String)
  );

  const leftSp = splitSide(parsed.left);
  const rightSp = splitSide(parsed.right);

  const condSize = (base) => Math.max(SIZE.tiny, base * 0.58);

  function build(base) {
    const gap = base * 0.42;
    const plusW = measure("+", base) + gap * 2;
    const cSize = condSize(base);
    const condW = Math.max(
      above ? measure(above, cSize, { lang: hasUrdu(above) ? "ur" : "en" }) : 0,
      below ? measure(below, cSize, { lang: hasUrdu(below) ? "ur" : "en" }) : 0
    );
    const arrowLen = Math.max(52, condW + 20);
    const cells = [];
    let total = 0;
    const pushSide = (list) => {
      list.forEach((src, i) => {
        if (i) {
          cells.push({ kind: "plus", w: plusW });
          total += plusW;
        }
        const L = layoutFormula(src, base, { state: stateOn });
        cells.push({ kind: "species", src, layout: L, w: L.w });
        total += L.w;
      });
    };
    pushSide(leftSp);
    if (arrowKind) {
      const w = arrowLen + base * 1.1;
      cells.push({ kind: "arrow", w, len: arrowLen, pad: base * 0.55 });
      total += w;
    }
    pushSide(rightSp);
    return { cells, total, gap, cSize, arrowLen };
  }

  let base = spec.size ?? 25;
  let L = build(base);
  while (L.total + PAD * 2 > MAXW && base > 20) {
    base -= 1;
    L = build(base);
  }

  const cSize = L.cSize;
  const topExtra = above ? cSize * 1.7 : 0;
  const botExtra = below ? cSize * 1.9 : 0;
  const lineH = base * 2.05;
  const note = spec.balanced === false ? spec.balanceNote ?? "Not balanced yet — count the atoms on each side." : null;
  const noteH = note ? SIZE.small * (hasUrdu(note) ? 3.0 : 1.9) : 0;

  const bodyW = Math.max(440, chromeWidth(spec), Math.min(MAXW, L.total + PAD * 2));
  const bodyH = PAD * 2 + topExtra + lineH + botExtra + noteH;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  const yc = PAD + topExtra + lineH / 2;
  const baseY = yc + base * 0.34;
  let x = (bodyW - L.total) / 2;

  for (const cell of L.cells) {
    if (cell.kind === "plus") {
      svg.text(x + cell.w / 2, baseY, "+", {
        size: base,
        anchor: "middle",
        fill: C.muted,
        weight: 600,
        lang: "en",
      });
    } else if (cell.kind === "arrow") {
      const ax = x + cell.pad;
      drawArrow(svg, ax, yc, cell.len, cell.kind === "arrow" ? arrowKind : arrowKind, C.ink);
      if (above)
        svg.text(ax + cell.len / 2, yc - 10, above, {
          size: cSize,
          anchor: "middle",
          fill: C.text,
          lang: hasUrdu(above) ? spec.lang || "ur" : "en",
        });
      if (below)
        svg.text(ax + cell.len / 2, yc + cSize + 11, below, {
          size: cSize,
          anchor: "middle",
          fill: C.text,
          lang: hasUrdu(below) ? spec.lang || "ur" : "en",
        });
    } else {
      if (hl.has(cell.src))
        svg.rect(x - 6, baseY - base * 0.95, cell.w + 12, base * 1.62, {
          rx: 6,
          fill: C.accent,
          opacity: 0.2,
        });
      drawFormula(svg, x, baseY, cell.src, {
        size: base,
        layout: cell.layout,
        fill: C.ink,
      });
    }
    x += cell.w;
  }

  if (note)
    svg.text(bodyW / 2, PAD + topExtra + lineH + botExtra + SIZE.small * 1.35, note, {
      size: SIZE.small,
      anchor: "middle",
      fill: C.warn,
      lang: hasUrdu(note) ? spec.lang || "ur" : "en",
      w: bodyW - 20,
    });

  return svg.toString();
}

/* ------------------------------------------------------------------ */
/* word equation                                                       */
/* ------------------------------------------------------------------ */

function renderWord(spec) {
  const parsed = splitEquation(spec.equation);
  const cond = spec.conditions || {};
  const above = String(cond.above ?? parsed.above ?? "");
  const below = String(cond.below ?? parsed.below ?? "");
  const left = spec.left ? spec.left.slice() : splitSide(parsed.left);
  const right = spec.right ? spec.right.slice() : splitSide(parsed.right);
  const size = spec.size ?? SIZE.label;
  const ur = (s) => hasUrdu(s);
  const boxW = (s) =>
    Math.max(86, Math.min(150, measure(s, size, { lang: ur(s) ? "ur" : "en" }) + 24));
  const boxH = spec.lang === "ur" || [...left, ...right].some(ur) ? 62 : 52;

  const cSize = Math.max(SIZE.tiny, SIZE.small);
  const condW = Math.max(
    above ? measure(above, cSize, { lang: ur(above) ? "ur" : "en" }) : 0,
    below ? measure(below, cSize, { lang: ur(below) ? "ur" : "en" }) : 0
  );
  const arrowLen = Math.max(74, condW + 22);
  const plusW = measure("+", size + 5) + 24;

  const cells = [];
  let total = 0;
  const pushSide = (list, kindColor) => {
    list.forEach((word, i) => {
      if (i) {
        cells.push({ kind: "plus", w: plusW });
        total += plusW;
      }
      const w = boxW(word);
      cells.push({ kind: "word", word, w, fill: kindColor });
      total += w;
    });
  };
  pushSide(left, spec.leftFill || C.wash);
  if (parsed.arrow || right.length) {
    const w = arrowLen + 34;
    cells.push({ kind: "arrow", w, len: arrowLen, pad: 17 });
    total += w;
  }
  pushSide(right, spec.rightFill || C.panel);

  const topExtra = above ? cSize * 1.9 : 0;
  const botExtra = below ? cSize * 2.0 : 0;
  const bodyW = Math.max(460, chromeWidth(spec), Math.min(MAXW, total + PAD * 2));
  const bodyH = PAD * 2 + topExtra + boxH + botExtra;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  const yTop = PAD + topExtra;
  const yc = yTop + boxH / 2;
  let x = (bodyW - total) / 2;

  for (const cell of cells) {
    if (cell.kind === "plus") {
      svg.text(x + cell.w / 2, yc, "+", {
        size: size + 5,
        anchor: "middle",
        baseline: "middle",
        fill: C.muted,
        weight: 600,
        lang: "en",
      });
    } else if (cell.kind === "arrow") {
      const ax = x + cell.pad;
      drawArrow(svg, ax, yc, cell.len, parsed.arrow || "->", C.ink);
      if (above)
        svg.text(ax + cell.len / 2, yc - 11, above, {
          size: cSize,
          anchor: "middle",
          fill: C.leaf,
          weight: 600,
          lang: ur(above) ? spec.lang || "ur" : "en",
        });
      if (below)
        svg.text(ax + cell.len / 2, yc + cSize + 12, below, {
          size: cSize,
          anchor: "middle",
          fill: C.leaf,
          weight: 600,
          lang: ur(below) ? spec.lang || "ur" : "en",
        });
    } else {
      svg.labelBox(x, yTop, cell.w, boxH, cell.word, {
        rx: 8,
        fill: cell.fill,
        stroke: C.ink,
        sw: 1.4,
        size,
        weight: 600,
        color: C.ink,
        lang: ur(cell.word) ? spec.lang || "ur" : "en",
      });
    }
    x += cell.w;
  }

  return svg.toString();
}

function render(spec) {
  return spec && spec.wordEquation ? renderWord(spec) : renderSymbolic(spec || {});
}

module.exports = {
  type: "chem_equation",
  aliases: ["equation", "reaction"],
  summary:
    "Chemical equations typeset in SVG — coefficients, subscripts, charges, state symbols, arrows with conditions, and word equations.",
  render,
  // helpers other type modules reuse (molecule.js prints formulae with these)
  parseFormula,
  layoutFormula,
  drawFormula,
  formulaWidth,
  chromeWidth,
  examples: [
    {
      name: "chem_equation_water_synthesis",
      spec: {
        type: "chem_equation",
        equation: "2H2 + O2 -> 2H2O",
        title: "Hydrogen burns in oxygen",
        caption: "Two hydrogen molecules react with one oxygen molecule to make two water molecules.",
      },
    },
    {
      name: "chem_equation_thermal_decomposition",
      spec: {
        type: "chem_equation",
        equation: "CaCO3 ->[Δ] CaO + CO2",
        title: "Thermal decomposition of limestone",
        caption: "Heating calcium carbonate drives off carbon dioxide and leaves quicklime.",
      },
    },
    {
      name: "chem_equation_precipitation",
      spec: {
        type: "chem_equation",
        equation: "AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)",
        highlight: ["AgCl(s)"],
        title: "Silver chloride precipitates",
        caption:
          "Two clear solutions mix and a white solid drops out. The highlighted species is the precipitate.",
      },
    },
    {
      name: "chem_equation_photosynthesis_words",
      spec: {
        type: "chem_equation",
        wordEquation: true,
        equation: "carbon dioxide + water -> glucose + oxygen",
        conditions: { above: "sunlight", below: "chlorophyll" },
        title: "Photosynthesis — word equation",
        caption: "Grade 7, page 11. Sunlight is the energy source; chlorophyll is the catalyst.",
      },
    },
  ],
};
