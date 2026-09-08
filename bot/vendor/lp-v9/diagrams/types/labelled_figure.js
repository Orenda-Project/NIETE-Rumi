// labelled_figure — a raster figure (a real textbook crop, or any photo) with
// callout labels drawn as SVG TEXT and leader lines.
//
// Why this exists: PLAN §2's rule is that a textbook figure is "as in your book"
// reference art, but any figure whose LABELS matter for the exam must carry text,
// not pixels. This type is the bridge — the picture stays a picture, every label
// is real text, so it is searchable, translatable to Urdu, and editable without
// re-rolling the artwork.
//
// The image is base64-embedded, so the output is self-contained: no external ref
// survives into the printed PDF, which is the failure mode that renders as a
// silent blank box.

const fs = require("fs");
const path = require("path");
const { Svg, C, SIZE, LEADING, measure, wrap, urduBoxH } = require("../lib/svg");
const { imageSize } = require("../lib/imagesize");

const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/** Resolve spec.image to {dataUri, w, h}. Accepts a data URI or a file path. */
function loadImage(spec) {
  const src = spec.image || spec.src;
  if (!src) return null;
  if (/^data:/.test(src)) {
    // Trust an explicit aspect for a data URI unless we can parse the bytes.
    const m = src.match(/^data:([^;]+);base64,(.*)$/);
    let dim = null;
    if (m) {
      try {
        dim = imageSize(Buffer.from(m[2], "base64"));
      } catch (_) {
        dim = null;
      }
    }
    return { dataUri: src, w: dim ? dim.w : null, h: dim ? dim.h : null };
  }
  // A path. Relative paths resolve against spec.baseDir, then the cwd.
  const p = path.isAbsolute(src) ? src : path.resolve(spec.baseDir || process.cwd(), src);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (e) {
    return { error: `image not found: ${src}` };
  }
  const dim = imageSize(buf);
  const mime = (dim && dim.mime) || EXT_MIME[path.extname(p).toLowerCase()] || "image/jpeg";
  return {
    dataUri: `data:${mime};base64,${buf.toString("base64")}`,
    w: dim ? dim.w : null,
    h: dim ? dim.h : null,
  };
}

function render(spec) {
  const lang = spec.lang;
  const isUr = lang === "ur";
  const labels = Array.isArray(spec.labels) ? spec.labels : [];
  const labelSize = spec.labelSize ?? SIZE.small;
  const lh = labelSize * (isUr ? LEADING.urdu : LEADING.latin);

  const img = loadImage(spec);

  // Gutters: the widest label on each side, floored so a leader line has room.
  const sideOf = (l, i) => l.side || (Number(l.at?.[0] ?? 0.5) < 0.5 ? "left" : "right");
  const left = labels.filter((l, i) => sideOf(l, i) === "left");
  const right = labels.filter((l, i) => sideOf(l, i) === "right");
  // A label wider than the gutter is WRAPPED, never shrunk — an SVG is scaled by
  // min(boxW/vbW, boxH/vbH), so widening the canvas to fit a long label shrinks
  // every glyph in the figure. Keeping the canvas narrow is what keeps type legible.
  const maxGutter = spec.maxGutter ?? 165;
  const wrapLabel = (t) => (lang === "ur" ? [String(t ?? "")] : wrap(String(t ?? ""), labelSize, maxGutter - 24));
  const widest = (arr) =>
    arr.length
      ? Math.max(
          ...arr.map((l) =>
            Math.max(...wrapLabel(l.text).map((ln) => measure(ln, labelSize, { lang })))
          )
        ) + 26
      : 0;
  const gutL = Math.min(maxGutter, Math.max(widest(left), left.length ? 90 : 0));
  const gutR = Math.min(maxGutter, Math.max(widest(right), right.length ? 90 : 0));

  const aspect = spec.aspect ?? (img && img.w && img.h ? img.h / img.w : 0.75);
  // Clamp the whole canvas. `renderedPx = minFont * colPx / vbW`, so a body wider
  // than ~700 units drops the smallest label below the 13.5 px phone floor in a
  // 750 px column. If it does not fit, the IMAGE gives way, not the type.
  const pad = 6;
  const MAXW = spec.maxWidth ?? 700;
  let imgW = spec.imageWidth ?? 380;
  imgW = Math.max(230, Math.min(imgW, MAXW - gutL - gutR - pad * 2));
  const imgH = Math.round(imgW * aspect);

  const bodyW = gutL + imgW + gutR + pad * 2;
  // A tall label stack must not be shorter than the image; a wrapped label needs
  // room for its extra lines.
  // Height of ONE label. For Urdu this is the real foreignObject height from the
  // shared estimator, not lines*lh — a Nastaliq box runs ~2x what the line-height
  // arithmetic suggests, and stacking on the short figure overlapped the labels.
  const hOf = (t, gut) =>
    lang === "ur"
      ? urduBoxH(String(t ?? ""), labelSize, gut - 12)
      : wrapLabel(t).length * lh;
  const stackOf = (arr, gut) => arr.reduce((a, l) => a + hOf(l.text, gut) + 6, 0);
  const stackH = Math.max(stackOf(left, gutL), stackOf(right, gutR)) + 10;
  const bodyH = Math.max(imgH, stackH) + pad * 2;

  const svg = new Svg(bodyW, bodyH, {
    title: spec.title,
    caption: spec.caption,
    source: spec.source,
    note: spec.note,
    lang,
    spec,
  });

  const ix = pad + gutL;
  const iy = pad + Math.max(0, (bodyH - pad * 2 - imgH) / 2);

  if (img && img.error) {
    // Never render a silent blank box — say what is missing, on the page.
    svg.rect(ix, iy, imgW, imgH, { fill: "#F6F8FC", stroke: C.rule, sw: 1.5, rx: 6, dash: "6 5" });
    svg.text(ix + imgW / 2, iy + imgH / 2, img.error, {
      size: SIZE.small,
      anchor: "middle",
      baseline: "middle",
      fill: C.warn,
    });
  } else if (img) {
    svg.add(
      `<image x="${ix}" y="${iy}" width="${imgW}" height="${imgH}" href="${img.dataUri}" ` +
        `preserveAspectRatio="xMidYMid slice"/>`
    );
    svg.rect(ix, iy, imgW, imgH, { fill: "none", stroke: C.rule, sw: 1.2 });
  }

  // Lay the labels out in their gutter, spread top-to-bottom in the order their
  // anchor points appear, so leader lines never cross.
  const place = (arr, side) => {
    const sorted = arr
      .map((l, i) => ({ l, y: Number(l.at?.[1] ?? (i + 0.5) / arr.length) }))
      .sort((a, b) => a.y - b.y);
    const gut = side === "left" ? gutL : gutR;
    const stack = stackOf(sorted.map((r) => r.l), gut);
    const top = iy + Math.max(0, (imgH - stack) / 2);
    let cursor = 0;
    sorted.forEach((row) => {
      const lines = wrapLabel(row.l.text);
      const rowH = hOf(row.l.text, gut);
      const ly = top + cursor + rowH / 2;
      cursor += rowH + 6;
      const px = ix + Number(row.l.at?.[0] ?? (side === "left" ? 0.15 : 0.85)) * imgW;
      const py = iy + Number(row.l.at?.[1] ?? 0.5) * imgH;
      const anchorX = side === "left" ? ix - 10 : ix + imgW + 10;
      const textX = side === "left" ? anchorX - 6 : anchorX + 6;
      const color = row.l.color || C.ink;

      // leader: gutter -> elbow at the image edge -> the point
      svg.polyline(
        [
          [anchorX, ly],
          [side === "left" ? ix - 4 : ix + imgW + 4, ly],
          [px, py],
        ],
        { stroke: color, sw: 1.2, fill: "none" }
      );
      svg.circle(px, py, 3.2, { fill: color, stroke: "#fff", sw: 1 });

      lines.forEach((ln, li) =>
        svg.plateText(textX, ly - ((lines.length - 1) * lh) / 2 + li * lh, ln, {
          size: labelSize,
          anchor: side === "left" ? "end" : "start",
          baseline: "middle",
          fill: C.text,
          weight: row.l.bold ? 700 : undefined,
          lang,
          w: side === "left" ? gutL - 12 : gutR - 12,
          // the leader-line stacking (`stackOf`/hOf) already budgets exact room
          // per label — the plate must hug the text's own box, not add to it.
          padY: 0,
        })
      );
    });
  };
  place(left, "left");
  place(right, "right");

  return svg.toString();
}

// The 4-label proof: a real NBF leaf figure from an earlier LP build.
//
// It lives INSIDE the engine (diagrams/assets/) on purpose. It used to be resolved
// seven levels up, out of the skill and into `06_Logs & Misc/Reports/Production/…`,
// which made the two gallery examples fail on any checkout where that investigation
// folder is not present — a git worktree, a fresh clone, CI, or the vendored copy in
// the serving repo. Both examples then rendered an "image not found" card that
// collides with its own labels, so the engine's own test.js has been red on those two
// for as long as anyone has run it. An example is a CONTRACT; it may not depend on a
// path outside the thing it documents.
const LEAF = path.join(__dirname, "..", "assets", "fig_1_11_leaf.jpg");

module.exports = {
  type: "labelled_figure",
  aliases: ["textbook_figure", "photo_labels"],
  summary:
    "A raster figure (real textbook crop / photo) with callout labels as real SVG text + leader lines. Image is base64-embedded.",
  render,
  examples: [
    {
      name: "labelled_figure_leaf",
      pngWidth: 820,
      spec: {
        type: "labelled_figure",
        image: LEAF,
        imageWidth: 400,
        title: "The four things a leaf needs, and the two it makes",
        labels: [
          { text: "light energy — free, from the Sun", at: [0.36, 0.1] },
          { text: "carbon dioxide — from the air", at: [0.19, 0.24] },
          { text: "water — pulled up from the soil", at: [0.83, 0.44] },
          { text: "glucose + oxygen — the products", at: [0.52, 0.62] },
        ],
        caption: "Four labels, four inputs and outputs — the labels are text, so they translate.",
        source: "Figure 1.11, p.11 — General Science 7 (NBF)",
      },
    },
    {
      name: "labelled_figure_leaf_ur",
      pngWidth: 860,
      spec: {
        type: "labelled_figure",
        image: LEAF,
        imageWidth: 380,
        lang: "ur",
        title: "پتا کیا لیتا ہے اور کیا بناتا ہے",
        labels: [
          { text: "روشنی کی توانائی", at: [0.36, 0.1] },
          { text: "کاربن ڈائی آکسائیڈ", at: [0.19, 0.24] },
          { text: "پانی، زمین سے", at: [0.83, 0.44] },
          { text: "گلوکوز اور آکسیجن", at: [0.52, 0.62] },
        ],
        caption: "وہی تصویر، وہی لیبل — صرف زبان بدلی ہے",
        source: "شکل ۱.۱۱، صفحہ ۱۱",
      },
    },
  ],
};
