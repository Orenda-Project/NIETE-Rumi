// flow — a chain of rounded boxes joined by labelled arrows, with optional
// branching (a decision that forks into two or more outcomes).
//
// Replaces the CSS `flowGroup()` in render_lp_html.js and the
// phys_mass_never_appears image prompt: bold heading + up to ~4 supporting lines
// per box, arrows between them, everything auto-sized to its own text.
//
// Layout invariants:
//   * every box is sized from its measured content, then shrunk proportionally
//     (never below a legible floor) if the row would overflow the body width
//   * boxes in a row share the tallest box's height
//   * more than 4 steps in 'lr' wraps to a second row, joined by a Z connector
//   * lang:'ur' runs the chain right-to-left and points every arrow leftwards

const { Svg, C, SIZE, LEADING, measure, wrap, hasUrdu } = require("../lib/svg");
const { SERIES } = require("../lib/tokens");

const isUr = (lang, s) => hasUrdu(String(s ?? ""));  // script decides, not the declared lang

// measure() carries a Nastaliq average of 0.40em/char. Rendered Noto Nastaliq
// runs up to ~35% wider than that on short strings, and an under-estimate is the
// expensive direction: the browser re-wraps inside the foreignObject, the box
// grows a line we never reserved, and the text falls out of the bottom of its
// box. Everything Urdu is therefore sized against a padded width.
const UR_PAD = 1.35;
const tw = (s, size, o = {}) =>
  isUr(o.lang, s) ? measure(s, size, { lang: "ur" }) * UR_PAD : measure(s, size, o);

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

const PAD_X = 12;
const PAD_T = 9;
const PAD_B = 10;
const MIN_W = 92;

const cleanLines = (item) =>
  (Array.isArray(item && item.lines) ? item.lines : []).filter(
    (l) => l !== undefined && l !== null && l !== ""
  );

/** Widest single line of the box, unwrapped — the width it would *like* to be. */
function naturalW(item, sz, lang) {
  let m = tw(item.title || "", sz.title, { weight: 700, lang });
  for (const l of cleanLines(item)) m = Math.max(m, tw(l, sz.line, { lang }));
  return Math.ceil(m) + PAD_X * 2 + 8;
}

/** Height of the box once its text is wrapped into width w. */
function boxH(item, w, sz, lang) {
  const innerW = w - PAD_X * 2;
  const lines = cleanLines(item);
  let h = PAD_T + blockH(item.title, sz.title, innerW, lang) + PAD_B;
  if (lines.length) {
    h += 6;
    lines.forEach((l, i) => {
      h += blockH(l, sz.line, innerW, lang) + (i ? 4 : 0);
    });
  }
  return Math.max(46, h);
}

function drawBox(svg, x, y, w, h, item, colour, sz, lang) {
  svg.rect(x, y, w, h, { rx: 7, fill: C.paper, stroke: colour, sw: 1.7 });
  const innerW = w - PAD_X * 2;
  const cx = x + w / 2;
  let cy = y + PAD_T;
  cy += drawBlock(svg, cx, cy, innerW, item.title, {
    size: sz.title,
    weight: 700,
    fill: colour,
    lang,
    letterSpacing: lang === "ur" ? undefined : "0.02em",
  });
  const lines = cleanLines(item);
  if (lines.length) {
    cy += 6;
    lines.forEach((l, i) => {
      if (i) cy += 4;
      cy += drawBlock(svg, cx, cy, innerW, l, { size: sz.line, fill: C.text, lang });
    });
  }
}

/** Fit k boxes into `avail` units of box width, shrinking the greedy ones first. */
function fitWidths(naturals, avail) {
  let ws = naturals.map((n) => Math.max(MIN_W, n));
  const sum = ws.reduce((a, b) => a + b, 0);
  if (sum > avail) {
    const k = avail / sum;
    ws = ws.map((w) => Math.max(MIN_W, w * k));
  }
  return ws;
}

function render(spec) {
  const steps = (Array.isArray(spec.steps) ? spec.steps : []).filter(Boolean);
  const list = steps.length ? steps : [{ title: "" }];
  const ur = spec.lang === "ur";
  const dir = spec.direction === "tb" ? "tb" : "lr";
  const bodyW = spec.width || 664;
  const arrowLabels = Array.isArray(spec.arrowLabels) ? spec.arrowLabels : [];
  const hasArrowLabel = arrowLabels.some((l) => l);
  const branches = (Array.isArray(spec.branches) ? spec.branches : []).filter(
    (b) => b && b.to && Number.isFinite(Number(b.from))
  );

  const sz = {
    title: ur ? 15.5 : SIZE.label,
    line: ur ? 14 : SIZE.small,
    tag: ur ? 13 : SIZE.tiny,
  };
  const colourOf = (item, i) => item.color || SERIES[i % SERIES.length];

  // rows: >4 steps in 'lr' wraps
  const rowsIdx = [];
  if (dir === "lr") {
    if (list.length > 4) {
      const half = Math.ceil(list.length / 2);
      rowsIdx.push(list.map((_, i) => i).slice(0, half));
      rowsIdx.push(list.map((_, i) => i).slice(half));
    } else {
      rowsIdx.push(list.map((_, i) => i));
    }
  } else {
    list.forEach((_, i) => rowsIdx.push([i]));
  }

  const gapX = hasArrowLabel ? 62 : 34;
  const gapY = dir === "tb" ? (hasArrowLabel ? 40 : 32) : 46;

  // ---------- pass 1: geometry ----------
  const placed = []; // {x,y,w,h,item,colour,i}
  let y = 4;
  const rowMeta = [];

  if (dir === "tb") {
    const naturals = list.map((s) => naturalW(s, sz, spec.lang));
    const w = Math.min(bodyW - 8, Math.max(MIN_W, ...naturals));
    const x = (bodyW - w) / 2;
    list.forEach((s, i) => {
      const h = boxH(s, w, sz, spec.lang);
      placed.push({ x, y, w, h, item: s, colour: colourOf(s, i), i });
      y += h + gapY;
    });
    y -= gapY;
  } else {
    rowsIdx.forEach((idxs, r) => {
      const avail = bodyW - 8 - gapX * (idxs.length - 1);
      const ws = fitWidths(idxs.map((i) => naturalW(list[i], sz, spec.lang)), avail);
      const hs = idxs.map((i, k) => boxH(list[i], ws[k], sz, spec.lang));
      const rowH = Math.max(...hs);
      const rowW = ws.reduce((a, b) => a + b, 0) + gapX * (idxs.length - 1);
      const startX = (bodyW - rowW) / 2;
      let cursor = ur ? bodyW - startX : startX;
      idxs.forEach((i, k) => {
        const x = ur ? cursor - ws[k] : cursor;
        placed.push({ x, y, w: ws[k], h: rowH, item: list[i], colour: colourOf(list[i], i), i });
        cursor = ur ? cursor - ws[k] - gapX : cursor + ws[k] + gapX;
      });
      rowMeta.push({ idxs, y, h: rowH });
      y += rowH + (r < rowsIdx.length - 1 ? gapY : 0);
    });
  }

  const byIndex = new Map(placed.map((p) => [p.i, p]));
  let maxY = y;
  let minX = 0;
  let maxX = bodyW;

  // branch groups, laid out under their source box
  const groups = new Map();
  for (const b of branches) {
    const from = Number(b.from);
    if (!byIndex.has(from)) continue;
    if (!groups.has(from)) groups.set(from, []);
    groups.get(from).push(b);
  }
  const branchBoxes = [];
  const branchGapX = 20;
  const branchDrop = 54;
  for (const [from, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const src = byIndex.get(from);
    const naturals = group.map((b) => naturalW(b.to, sz, spec.lang));
    const ws = fitWidths(naturals, bodyW - 8 - branchGapX * (group.length - 1));
    const hs = group.map((b, k) => boxH(b.to, ws[k], sz, spec.lang));
    const rowH = Math.max(...hs);
    const spanW = ws.reduce((a, b) => a + b, 0) + branchGapX * (group.length - 1);
    let x0 = src.x + src.w / 2 - spanW / 2;
    x0 = Math.max(4, Math.min(x0, bodyW - 4 - spanW));
    const by = src.y + src.h + branchDrop;
    let cursor = ur ? x0 + spanW : x0;
    group.forEach((b, k) => {
      const bx = ur ? cursor - ws[k] : cursor;
      branchBoxes.push({
        x: bx,
        y: by,
        w: ws[k],
        h: rowH,
        item: b.to,
        colour: b.to.color || b.color || src.colour,
        label: b.label,
        src,
      });
      cursor = ur ? cursor - ws[k] - branchGapX : cursor + ws[k] + branchGapX;
    });
    maxY = Math.max(maxY, by + rowH);
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x0 + spanW);
  }

  const bodyH = maxY + 5;

  // ---------- pass 2: draw ----------
  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang: spec.lang,
    spec,
  });

  const arrowColour = spec.arrowColor || C.ink;

  // arrows along each row / down the column
  if (dir === "tb") {
    for (let k = 0; k < placed.length - 1; k++) {
      const a = placed[k];
      const b = placed[k + 1];
      const cx = a.x + a.w / 2;
      svg.arrow(cx, a.y + a.h + 4, cx, b.y - 4, { stroke: arrowColour, sw: 1.8 });
      const lab = arrowLabels[k];
      if (lab) {
        const my = (a.y + a.h + b.y) / 2;
        svg.text(ur ? cx - 10 : cx + 10, my, lab, {
          size: sz.tag,
          anchor: ur ? "end" : "start",
          baseline: "middle",
          fill: C.muted,
          lang: spec.lang,
          w: isUr(spec.lang, lab) ? measure(lab, sz.tag, { lang: "ur" }) * 1.3 + 10 : undefined,
        });
      }
    }
  } else {
    rowMeta.forEach((row) => {
      for (let k = 0; k < row.idxs.length - 1; k++) {
        const a = byIndex.get(row.idxs[k]);
        const b = byIndex.get(row.idxs[k + 1]);
        const cy = row.y + row.h / 2;
        const x1 = ur ? a.x - 4 : a.x + a.w + 4;
        const x2 = ur ? b.x + b.w + 4 : b.x - 4;
        svg.arrow(x1, cy, x2, cy, { stroke: arrowColour, sw: 1.8 });
        const lab = arrowLabels[row.idxs[k]];
        if (lab) {
          const mx = (x1 + x2) / 2;
          svg.text(mx, cy - 11, lab, {
            size: sz.tag,
            anchor: "middle",
            fill: C.muted,
            lang: spec.lang,
            w: Math.abs(x2 - x1) + 34,
          });
        }
      }
    });
    // Z connector between wrapped rows
    for (let r = 0; r < rowMeta.length - 1; r++) {
      const last = byIndex.get(rowMeta[r].idxs[rowMeta[r].idxs.length - 1]);
      const first = byIndex.get(rowMeta[r + 1].idxs[0]);
      const ax = last.x + last.w / 2;
      const bx = first.x + first.w / 2;
      const y1 = last.y + last.h + 4;
      const y2 = first.y - 4;
      const mid = (y1 + y2) / 2;
      svg.polyline(
        [
          [ax, y1],
          [ax, mid],
          [bx, mid],
          [bx, y2 - 5],
        ],
        { stroke: arrowColour, sw: 1.8, cap: "round" }
      );
      svg.head(bx, y2, 0, 1, { stroke: arrowColour });
    }
  }

  // branch connectors + boxes
  branchBoxes.forEach((b) => {
    const sx = b.src.x + b.src.w / 2;
    const sy = b.src.y + b.src.h + 3;
    const tx = b.x + b.w / 2;
    const ty = b.y - 4;
    svg.arrow(sx, sy, tx, ty, { stroke: b.colour, sw: 1.7 });
    if (b.label) {
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const lw = measure(b.label, sz.tag, { weight: 700, lang: isUr(spec.lang, b.label) ? "ur" : undefined });
      svg.rect(mx - lw / 2 - 7, my - sz.tag * 0.95, lw + 14, sz.tag * 1.9, {
        rx: 4,
        fill: C.paper,
        stroke: b.colour,
        sw: 1,
      });
      svg.text(mx, my, b.label, {
        size: sz.tag,
        weight: 700,
        anchor: "middle",
        baseline: "middle",
        fill: b.colour,
        lang: spec.lang,
        w: lw + 10,
      });
    }
  });

  placed.forEach((p) => drawBox(svg, p.x, p.y, p.w, p.h, p.item, p.colour, sz, spec.lang));
  branchBoxes.forEach((b) => drawBox(svg, b.x, b.y, b.w, b.h, b.item, b.colour, sz, spec.lang));

  return svg.toString();
}

module.exports = {
  type: "flow",
  aliases: ["process", "chain"],
  summary: "Linear chain of auto-sized boxes joined by labelled arrows; optional decision branches.",
  render,
  examples: [
    {
      name: "flow_mass_never_appears",
      spec: {
        type: "flow",
        direction: "lr",
        title: "WHY BOTH BLOCKS LAND TOGETHER",
        steps: [
          { title: "v = u + gt", lines: ["no mass anywhere in this equation"] },
          { title: "2 kg BLOCK", lines: ["u = 0, g = 9.8", "t = 8 s"], color: C.cool },
          { title: "95 kg BLOCK", lines: ["u = 0, g = 9.8", "t = 8 s"], color: C.clay },
          { title: "SAME TIME", lines: ["mass never appears"], color: C.leaf },
        ],
        caption: "Substitute either mass into the same equation and nothing on the right-hand side changes.",
      },
    },
    {
      name: "flow_even_odd_decision",
      spec: {
        type: "flow",
        direction: "lr",
        title: "IS THIS NUMBER EVEN?",
        steps: [
          { title: "READ THE NUMBER", lines: ["look at the last digit only"] },
          { title: "IS IT 0 2 4 6 8?", lines: ["the test for even"], color: C.accent },
        ],
        arrowLabels: ["then"],
        branches: [
          { from: 1, label: "YES", to: { title: "EVEN", lines: ["divides by 2 exactly"], color: C.leaf } },
          { from: 1, label: "NO", to: { title: "ODD", lines: ["one is left over"], color: C.warn } },
        ],
        caption: "One digit decides it. The other digits never enter the test.",
      },
    },
    {
      name: "flow_urdu_paragraph_steps",
      spec: {
        type: "flow",
        lang: "ur",
        direction: "lr",
        title: "پیراگراف لکھنے کے تین قدم",
        steps: [
          { title: "خیال چنیں", lines: ["ایک ہی موضوع"] },
          { title: "جملے جوڑیں", lines: ["تین یا چار جملے"], color: C.cool },
          { title: "نتیجہ لکھیں", lines: ["آخری جملہ"], color: C.leaf },
        ],
        caption: "ہر قدم پچھلے قدم پر بنتا ہے",
      },
    },
  ],
};
