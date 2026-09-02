// punnett — a Punnett square computed from the parental genotypes, not typed in.
//
// The grid, the gametes and BOTH ratios are derived from `p1`/`p2`, so the
// figure cannot disagree with itself: a 3:1 printed under the square is 3:1
// because three of the four cells really carry a dominant allele. Monohybrid
// (Rr x Rr -> 2x2) and dihybrid (RrYy x RrYy -> 4x4, gametes RY/Ry/rY/ry) both
// fall out of the same cartesian-product code.
//
// Convention: an offspring genotype is written dominant-allele-first (Rr, never
// rR), and loci stay in the order they were given (RrYy, never YyRr).
//
// Allele letters are Latin in every language — only the furniture around the
// grid (the ratio labels, the phenotype names, the parent captions) translates.

const { Svg, C, SIZE, LEADING, measure, wrap, hasUrdu, urduBoxH } = require("../lib/svg");

const PAD = 12;
const PHENO_COLORS = [C.leaf, C.accent, C.cool, C.plum, C.clay, C.warn];

const DEFAULT_LABELS = {
  en: { genotype: "Genotype ratio", phenotype: "Phenotype ratio", cross: "cross" },
  ur: { genotype: "جینوٹائپ تناسب", phenotype: "فینوٹائپ تناسب", cross: "کراس" },
};

/* ------------------------------------------------------------------ */
/* genetics                                                            */
/* ------------------------------------------------------------------ */

/** 'RrYy' -> [['R','r'],['Y','y']] */
function loci(g) {
  const s = String(g ?? "").replace(/[^A-Za-z]/g, "");
  const out = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push([s[i], s[i + 1]]);
  if (s.length % 2) out.push([s[s.length - 1], s[s.length - 1]]); // tolerate 'R'
  return out.length ? out : [["R", "r"]];
}

/** Every gamete this genotype can make, in the textbook order (RY, Ry, rY, ry). */
function gametes(g, nLoci) {
  const L = loci(g).slice(0, nLoci);
  let out = [""];
  for (const pair of L) {
    const next = [];
    for (const prefix of out) for (const allele of pair) next.push(prefix + allele);
    out = next;
  }
  return out;
}

/** Dominant allele first: order('r','R') -> 'Rr'. */
function orderPair(x, y) {
  const xu = x === x.toUpperCase();
  const yu = y === y.toUpperCase();
  if (xu === yu) return x <= y ? x + y : y + x;
  return xu ? x + y : y + x;
}

/** One gamete from each parent -> the offspring genotype, locus by locus. */
function combine(a, b) {
  let out = "";
  for (let i = 0; i < Math.min(a.length, b.length); i++) out += orderPair(a[i], b[i]);
  return out;
}

const dominantCount = (gt) => (gt.match(/[A-Z]/g) || []).length;

/** Per-locus dominance pattern, e.g. 'RrYy' -> 'TT', 'rrYy' -> 'FT'. */
function phenoKey(gt) {
  let k = "";
  for (let i = 0; i < gt.length; i += 2) k += /[A-Z]/.test(gt.slice(i, i + 2)) ? "T" : "F";
  return k;
}

function phenoLabel(gt, traits) {
  const parts = [];
  for (let i = 0, L = 0; i < gt.length; i += 2, L++) {
    const pair = gt.slice(i, i + 2);
    const dom = /[A-Z]/.test(pair);
    const t = traits[L] || {};
    parts.push(dom ? t.dominantName || pair[0] + "_" : t.recessiveName || pair);
  }
  return parts.join(", ");
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/** [{label,count}] -> [{n,label}], reduced to whole numbers. */
function reduceRatio(entries) {
  const g = entries.reduce((acc, e) => gcd(acc, e.count), 0) || 1;
  return entries.map((e) => ({ n: e.count / g, label: e.label }));
}

const ratioText = (parts) => parts.map((p) => `${p.n} ${p.label}`).join("  :  ");

/**
 * Draw "3 tall : 1 short" centred on cx.
 *
 * When the phenotype names are Urdu the whole line CANNOT go through one RTL
 * text box: bidi puts the first logical run on the right, which silently flips
 * "3 tall : 1 short" into "1 short : 3 tall" — a wrong ratio that still looks
 * plausible. So each number and each name is placed on its own explicit x, and
 * only the name itself is shaped RTL.
 */
/** Width of the box an Urdu ratio segment is drawn in. Used by BOTH the height
 *  reservation and the draw, so the two can never disagree. */
function urduSegW(label, size) {
  return measure(label, size, { lang: "ur", weight: 700 }) * 1.2 + 8;
}

/** Tallest Urdu ratio segment in `parts`, at the width it is actually drawn at. */
function urduValueH(parts, size) {
  return parts.reduce(
    (a, p) => (hasUrdu(p.label) ? Math.max(a, urduBoxH(p.label, size, urduSegW(p.label, size))) : a),
    0
  );
}

function drawRatioValue(svg, cx, y, parts, size, lang) {
  const anyUrdu = parts.some((p) => hasUrdu(p.label));
  if (!anyUrdu) {
    svg.text(cx, y, ratioText(parts), {
      size,
      anchor: "middle",
      weight: 700,
      fill: C.ink,
      lang: "en",
    });
    return;
  }
  const segs = [];
  parts.forEach((p, i) => {
    if (i) segs.push({ urdu: false, s: "  :  " });
    segs.push({ urdu: false, s: String(p.n) + " " });
    segs.push({ urdu: hasUrdu(p.label), s: p.label });
  });
  for (const sg of segs) {
    const raw = measure(sg.s, size, { lang: sg.urdu ? "ur" : "en", weight: 700 });
    sg.w = sg.urdu ? urduSegW(sg.s, size) : raw;
  }
  let x = cx - segs.reduce((a, s) => a + s.w, 0) / 2;
  for (const sg of segs) {
    // an Urdu box is right-aligned inside itself; centring it keeps the gap
    // around the word symmetric instead of gluing it to the next separator
    if (sg.urdu)
      svg.text(x + sg.w / 2, y, sg.s, {
        size,
        weight: 700,
        fill: C.ink,
        lang: lang || "ur",
        anchor: "middle",
        w: sg.w,
      });
    else svg.text(x, y, sg.s, { size, weight: 700, fill: C.ink, lang: "en" });
    x += sg.w;
  }
}

/* ------------------------------------------------------------------ */

function render(spec) {
  const s = spec || {};
  const lang = s.lang === "ur" ? "ur" : "en";
  const LBL = Object.assign({}, DEFAULT_LABELS[lang], s.labels || {});

  const p1 = String(s.p1 || "Rr");
  const p2 = String(s.p2 || s.p1 || "Rr");
  const nLoci = Math.max(1, Math.min(loci(p1).length, loci(p2).length, 2));
  const gam1 = gametes(p1, nLoci);
  const gam2 = gametes(p2, nLoci);
  const n = Math.max(gam1.length, gam2.length);

  const traits = Array.isArray(s.traits) ? s.traits : s.trait ? [s.trait] : [];

  // the grid itself
  const cells = [];
  for (let r = 0; r < gam2.length; r++) {
    const row = [];
    for (let c = 0; c < gam1.length; c++) row.push(combine(gam1[c], gam2[r]));
    cells.push(row);
  }
  const flat = cells.flat();

  // genotype tally — dominant-richest first, then alphabetical
  const gCount = new Map();
  for (const gt of flat) gCount.set(gt, (gCount.get(gt) || 0) + 1);
  const genoEntries = [...gCount.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => dominantCount(b.label) - dominantCount(a.label) || (a.label < b.label ? -1 : 1));

  // phenotype tally — 'TT' before 'TF' before 'FT' before 'FF' gives 9:3:3:1
  const pCount = new Map();
  for (const gt of flat) {
    const k = phenoKey(gt);
    const e = pCount.get(k) || { key: k, label: phenoLabel(gt, traits), count: 0 };
    e.count++;
    pCount.set(k, e);
  }
  const phenoEntries = [...pCount.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const phenoColor = new Map();
  phenoEntries.forEach((e, i) => phenoColor.set(e.key, PHENO_COLORS[i % PHENO_COLORS.length]));

  /* ---------------- geometry ---------------- */
  const cell = s.cellSize ?? (n > 2 ? 68 : 92);
  const gridN = n + 1;
  const gridW = gridN * cell;
  const gridH = gridN * cell;
  const cellText = n > 2 ? 20 : 26;
  const showParents = s.showParents !== false;
  const showRatio = s.showRatio !== false;
  const byPheno = s.colorByPhenotype !== false;

  const gutterL = showParents ? (lang === "ur" ? 62 : 46) : 0;
  const gutterT = showParents ? (lang === "ur" ? 40 : 28) : 0;

  const legendOn = byPheno && phenoEntries.length > 1;
  const legendEntryW = (e) =>
    hasUrdu(e.label)
      ? measure(e.label, SIZE.small, { lang: "ur" }) * 1.25 + SIZE.small + 26 + 4 + 28
      : measure(`${e.label} (${e.count})`, SIZE.small) + 30;
  const legendW = legendOn
    ? Math.max(140, Math.min(240, Math.max(...phenoEntries.map(legendEntryW)) + 8))
    : 0;

  const blockW = gutterL + gridW + (legendOn ? 24 + legendW : 0);

  // ratio rows
  const rows = [];
  if (showRatio) {
    const g = reduceRatio(genoEntries);
    rows.push({ label: LBL.genotype, parts: g, value: ratioText(g) });
    if (traits.length) {
      const p = reduceRatio(phenoEntries);
      rows.push({ label: LBL.phenotype, parts: p, value: ratioText(p) });
    }
  }
  const splitRow = (r) => hasUrdu(r.label) || hasUrdu(r.value);

  // chrome floor — the builder centres and does not wrap the caption
  const chromeW = (() => {
    const w = (t, size) =>
      t ? measure(String(t), size, { lang: hasUrdu(String(t)) ? "ur" : lang }) + 26 : 0;
    return Math.max(w(s.title, SIZE.title * 1.06), w(s.caption, SIZE.caption), w(s.source, SIZE.caption * 0.92), w(s.note, SIZE.caption));
  })();
  const ratioW = rows.reduce(
    (a, r) =>
      Math.max(
        a,
        splitRow(r)
          ? Math.max(
              measure(r.label, SIZE.label, { lang: "ur" }),
              measure(r.value, SIZE.label, { lang: hasUrdu(r.value) ? "ur" : "en" })
            ) + 30
          : measure(r.label + ":  " + r.value, SIZE.label) + 30
      ),
    0
  );

  const bodyW = Math.min(690, Math.max(440, blockW + PAD * 2, chromeW, ratioW));

  // A dihybrid genotype ratio is nine terms long and will not fit on one line at
  // 690 units, so wrap it against the FINAL width rather than letting the
  // viewBox clip it (which is what the builder's un-wrapped chrome would do).
  const lineH = SIZE.label * LEADING.latin;
  for (const r of rows) {
    if (splitRow(r)) {
      // A split row stacks an Urdu caption box над an Urdu value box. Both are
      // Nastaliq, so both are ~2x the height the line-height arithmetic implies;
      // the old flat 3.7em reserved less than half of what they need and the
      // value box rose up through the caption. Measure both with the shared
      // estimator instead.
      r.labelH = urduBoxH(r.label, SIZE.label, bodyW - 20) || SIZE.label * 1.6;
      r.valueH = urduValueH(r.parts, SIZE.label) || SIZE.label * 2.6;
      r.h = SIZE.label * 2.1 + 8 + r.valueH + SIZE.label * 0.4;
    } else {
      r.lines = wrap(`${r.label}:  ${r.value}`, SIZE.label, bodyW - 28);
      r.h = r.lines.length * lineH + SIZE.label * 0.55;
    }
  }
  const ratiosH = rows.reduce((a, r) => a + r.h, 0);
  const bodyH = PAD * 2 + gutterT + gridH + (rows.length ? 18 + ratiosH : 0);

  const svg = new Svg(bodyW, bodyH, {
    title: s.title,
    caption: s.caption,
    source: s.source,
    note: s.note,
    lang: s.lang,
    spec: s,
  });

  const xoff = (bodyW - blockW) / 2;
  const x0 = xoff + gutterL;
  const y0 = PAD + gutterT;

  /* ---------------- the square ---------------- */
  // header bands
  svg.rect(x0 + cell, y0, gridW - cell, cell, { fill: C.wash });
  svg.rect(x0, y0 + cell, cell, gridH - cell, { fill: C.wash });
  svg.rect(x0, y0, cell, cell, { fill: C.panel });

  // offspring cells, tinted by phenotype
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const gt = cells[r][c];
      if (byPheno)
        svg.rect(x0 + (c + 1) * cell, y0 + (r + 1) * cell, cell, cell, {
          fill: phenoColor.get(phenoKey(gt)) || C.leaf,
          opacity: 0.18,
        });
      svg.text(x0 + (c + 1.5) * cell, y0 + (r + 1.5) * cell, gt, {
        size: cellText,
        anchor: "middle",
        baseline: "middle",
        weight: 700,
        fill: C.ink,
        lang: "en",
      });
    }

  // gamete headers
  gam1.forEach((g, c) =>
    svg.text(x0 + (c + 1.5) * cell, y0 + cell / 2, g, {
      size: cellText,
      anchor: "middle",
      baseline: "middle",
      weight: 700,
      fill: C.clay,
      lang: "en",
    })
  );
  gam2.forEach((g, r) =>
    svg.text(x0 + cell / 2, y0 + (r + 1.5) * cell, g, {
      size: cellText,
      anchor: "middle",
      baseline: "middle",
      weight: 700,
      fill: C.clay,
      lang: "en",
    })
  );
  svg.text(x0 + cell / 2, y0 + cell / 2, "×", {
    size: cellText,
    anchor: "middle",
    baseline: "middle",
    fill: C.muted,
    lang: "en",
  });

  // rules
  for (let i = 0; i <= gridN; i++) {
    svg.line(x0, y0 + i * cell, x0 + gridW, y0 + i * cell, {
      stroke: i <= 1 ? C.ink : C.rule,
      sw: i <= 1 ? 1.7 : 1.1,
    });
    svg.line(x0 + i * cell, y0, x0 + i * cell, y0 + gridH, {
      stroke: i <= 1 ? C.ink : C.rule,
      sw: i <= 1 ? 1.7 : 1.1,
    });
  }
  svg.rect(x0, y0, gridW, gridH, { stroke: C.ink, sw: 1.9, fill: "none" });

  // parent genotypes: p1 above its gamete columns, p2 beside its gamete rows
  if (showParents) {
    svg.text(x0 + cell + (gridW - cell) / 2, y0 - 8, p1, {
      size: SIZE.label,
      anchor: "middle",
      weight: 700,
      fill: C.ink,
      lang: "en",
    });
    svg.text(x0 - 9, y0 + cell + (gridH - cell) / 2, p2, {
      size: SIZE.label,
      anchor: "end",
      baseline: "middle",
      weight: 700,
      fill: C.ink,
      lang: "en",
    });
  }

  /* ---------------- phenotype key ---------------- */
  if (legendOn) {
    const lx = x0 + gridW + 24;
    const step = Math.max(28, lang === "ur" ? 40 : 30);
    const total = phenoEntries.length * step;
    let ly = y0 + gridH / 2 - total / 2 + step / 2;
    for (const e of phenoEntries) {
      svg.rect(lx, ly - 9, 18, 18, { rx: 4, fill: phenoColor.get(e.key), opacity: 0.55, stroke: C.rule, sw: 1 });
      const isUr = hasUrdu(e.label);
      const txt = isUr ? e.label : `${e.label} (${e.count})`;
      if (isUr) {
        // an Urdu box is right-aligned inside itself, so size it to the text and
        // centre it, or the label drifts to the far edge of the panel
        const w = measure(txt, SIZE.small, { lang: "ur" }) * 1.25 + SIZE.small;
        svg.text(lx + 26 + w / 2, ly, txt, {
          size: SIZE.small,
          baseline: "middle",
          fill: C.text,
          lang: "ur",
          anchor: "middle",
          w,
        });
        svg.text(lx + 26 + w + 6, ly, `(${e.count})`, {
          size: SIZE.small,
          baseline: "middle",
          fill: C.muted,
          lang: "en",
        });
      } else {
        svg.text(lx + 26, ly, txt, {
          size: SIZE.small,
          baseline: "middle",
          fill: C.text,
          lang: "en",
        });
      }
      ly += step;
    }
  }

  /* ---------------- ratios ---------------- */
  let ry = y0 + gridH + 18;
  for (const r of rows) {
    if (splitRow(r)) {
      svg.text(bodyW / 2, ry + SIZE.label * 1.15, r.label, {
        size: SIZE.label,
        anchor: "middle",
        weight: 600,
        fill: C.muted,
        lang: hasUrdu(r.label) ? "ur" : "en",
        w: bodyW - 20,
      });
      // baseline placed so the (taller) value box clears the caption box below it
      drawRatioValue(
        svg,
        bodyW / 2,
        ry + SIZE.label * 1.15 + 8 + r.valueH,
        r.parts,
        SIZE.label,
        lang
      );
    } else {
      r.lines.forEach((ln, i) =>
        svg.text(bodyW / 2, ry + SIZE.label * 1.05 + i * lineH, ln, {
          size: SIZE.label,
          anchor: "middle",
          weight: 600,
          fill: C.ink,
          lang: "en",
        })
      );
    }
    ry += r.h;
  }

  return svg.toString();
}

module.exports = {
  type: "punnett",
  aliases: ["genetics", "cross"],
  summary:
    "Punnett square computed from the parental genotypes — gametes, offspring, and genotype/phenotype ratios all derived, monohybrid or dihybrid.",
  render,
  examples: [
    {
      name: "punnett_monohybrid_Rr",
      spec: {
        type: "punnett",
        p1: "Rr",
        p2: "Rr",
        trait: { dominant: "R", recessive: "r", dominantName: "tall", recessiveName: "short" },
        title: "Two tall pea plants, both carriers",
        caption: "Three of the four boxes carry at least one R, so three offspring in four are tall.",
      },
    },
    {
      name: "punnett_test_cross",
      spec: {
        type: "punnett",
        p1: "Rr",
        p2: "rr",
        trait: { dominant: "R", recessive: "r", dominantName: "tall", recessiveName: "short" },
        title: "Test cross — Rr × rr",
        caption: "Crossing with a recessive parent reveals whether the tall plant is RR or Rr.",
      },
    },
    {
      name: "punnett_dihybrid",
      spec: {
        type: "punnett",
        p1: "RrYy",
        p2: "RrYy",
        traits: [
          { dominant: "R", recessive: "r", dominantName: "round", recessiveName: "wrinkled" },
          { dominant: "Y", recessive: "y", dominantName: "yellow", recessiveName: "green" },
        ],
        title: "Dihybrid cross — RrYy × RrYy",
        caption: "Two traits at once. Sixteen boxes, and the classic 9 : 3 : 3 : 1 falls out of them.",
      },
    },
    {
      name: "punnett_monohybrid_ur",
      spec: {
        type: "punnett",
        p1: "Rr",
        p2: "Rr",
        lang: "ur",
        trait: { dominant: "R", recessive: "r", dominantName: "لمبا", recessiveName: "چھوٹا" },
        title: "مٹر کے پودوں کا کراس",
        caption: "چار میں سے تین پودے لمبے ہوں گے۔",
      },
    },
  ],
};
