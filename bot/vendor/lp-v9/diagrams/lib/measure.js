// Deterministic text measurement.
//
// We cannot ask a browser how wide a string is at spec-build time (the engine is
// a pure string->string function), so we carry an advance-width table. Helvetica
// AFM widths, /1000 em — Inter and Arial are within ~3% of these for the ASCII
// range, which is well inside the padding every box already carries.

// prettier-ignore
const W = {
  " ":278,"!":278,'"':355,"#":556,"$":556,"%":889,"&":667,"'":191,"(":333,")":333,
  "*":389,"+":584,",":278,"-":333,".":278,"/":278,
  "0":556,"1":556,"2":556,"3":556,"4":556,"5":556,"6":556,"7":556,"8":556,"9":556,
  ":":278,";":278,"<":584,"=":584,">":584,"?":556,"@":1015,
  "A":667,"B":667,"C":722,"D":722,"E":667,"F":611,"G":778,"H":722,"I":278,"J":500,
  "K":667,"L":556,"M":833,"N":722,"O":778,"P":667,"Q":778,"R":722,"S":667,"T":611,
  "U":722,"V":667,"W":944,"X":667,"Y":667,"Z":611,
  "[":278,"\\":278,"]":278,"^":469,"_":556,"`":333,
  "a":556,"b":556,"c":500,"d":556,"e":556,"f":278,"g":556,"h":556,"i":222,"j":222,
  "k":500,"l":222,"m":833,"n":556,"o":556,"p":556,"q":556,"r":333,"s":500,"t":278,
  "u":556,"v":500,"w":722,"x":500,"y":500,"z":500,
  "{":334,"|":260,"}":334,"~":584,
  "–":556,"—":1000,"‘":222,"’":222,"“":333,"”":333,
  "×":584,"÷":584,"→":800,"←":800,"≤":584,"≥":584,
  "°":400,"−":584,"α":548,"β":548,"θ":556,"π":556,
  "λ":500,"μ":576,"Ω":768,"Δ":612,"±":584,
};

const isUrduChar = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 0x0600 && c <= 0x06ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff);
};

/** True if the string contains Arabic-script characters. */
function hasUrdu(s) {
  return Array.from(String(s ?? "")).some(isUrduChar);
}

/**
 * Estimated rendered width in user units.
 * @param {string} s
 * @param {number} size font-size in user units
 * @param {{weight?:string|number, lang?:string}} [o]
 */
function measure(s, size, o = {}) {
  const str = String(s ?? "");
  const bold = o.weight === "bold" || Number(o.weight) >= 600;
  // Nastaliq is horizontally compressed; ~0.40em per character is a good
  // working average across Urdu prose (verified against rendered PNGs).
  // SCRIPT decides, not the declared lang: an Urdu lesson plan carries Latin
  // terms ("e.g. 'temperature = 102°F'"), and measuring those at 0.40 em/char
  // under-reserves by ~40% — the leaf then draws wider than the box kept for it.
  if (hasUrdu(str)) return Array.from(str).length * size * 0.4;
  let u = 0;
  for (const ch of str) u += W[ch] ?? 556;
  return (u / 1000) * size * (bold ? 1.05 : 1);
}

/**
 * Greedy word-wrap to a pixel width. Returns an array of lines.
 * Deterministic: no locale-dependent segmentation.
 */
function wrap(s, size, maxW, o = {}) {
  const words = String(s ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = cur + " " + words[i];
    // Budget for the SAME slack textBox() reserves, or a line that "fits" here
    // measures wider when it is checked and pokes out of the band it was wrapped
    // into (timeline_constitutions_vertical, by 3 units).
    if (measure(test, size, o) * 1.02 <= maxW) cur = test;
    else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines;
}

// ── Urdu box geometry — ONE estimator, used everywhere ──────────────────────
//
// Nastaliq is laid out by the browser, not by us, so every Urdu label is a
// prediction. Two different predictions in two files is how leaves end up
// overlapping: the caller reserves H1, `_urduText` draws a box of H2, and the
// real text wraps to something taller than both and spills out (the div is
// overflow:visible, so a spill is silent). These two functions are the single
// source of truth — `lib/svg.js` and every type module must call them.
//
// measure() carries a Nastaliq average of 0.40 em/char; rendered Noto Nastaliq
// runs up to ~35% wider, so the pad is applied INSIDE the estimator. Rounding is
// always up: reserving too much space costs whitespace, reserving too little
// costs a collision.
const UR_PAD = 1.35;
const UR_LEADING = 2.2;

/** Predicted number of rendered lines for an Urdu string in a box `boxW` wide. */
function urduLines(s, size, boxW) {
  const str = String(s ?? "");
  if (!str) return 0;
  const usable = Math.max(20, boxW - 6);
  return Math.max(1, Math.ceil((measure(str, size, { lang: "ur" }) * UR_PAD) / usable));
}

/** Predicted rendered height of an Urdu string in a box `boxW` wide. */
function urduBoxH(s, size, boxW) {
  const n = urduLines(s, size, boxW);
  return n ? n * size * UR_LEADING + size * 0.45 : 0;
}

// ── Latin <text> geometry ────────────────────────────────────────────────────
//
// A Latin label is emitted as SVG <text> with no box of its own, so its extent
// has to be *reconstructed* to be checked. These are the ONLY numbers any type
// module (or the collision checker) may use for that — inlining a private
// `size * 0.6 * s.length` somewhere is how a leaf ends up under a centre box.
//
// Deliberately conservative (err wide / err tall):
//   * width  = the advance-width sum, +2% slack for hinting and letter-spacing
//   * height = ascent 0.80em + descent 0.22em ≈ 1.02em, which still leaves a
//     real gap at the 1.3em Latin leading.
const ASCENT = 0.8;
const DESCENT = 0.22;
const LATIN_SLACK = 1.02;

/**
 * The bounding box a single-line label occupies.
 * @param {string} s
 * @param {number} size font-size in user units
 * @param {number} x    the emitted x
 * @param {number} y    the emitted y (alphabetic baseline unless `baseline`)
 * @param {{anchor?:string, baseline?:string, weight?:string|number, lang?:string}} [o]
 */
function textBox(s, size, x, y, o = {}) {
  const w = measure(s, size, o) * (hasUrdu(s) ? UR_PAD : LATIN_SLACK);
  const h = size * (ASCENT + DESCENT);
  const anchor = o.anchor || "start";
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const b = o.baseline;
  const y0 =
    b === "middle" || b === "central" ? y - h / 2 : b === "hanging" ? y : y - size * ASCENT;
  return { x: x0, y: y0, w, h };
}

// ── Geometry of an emitted SVG ───────────────────────────────────────────────
//
// Everything below reads the STRING the engine produced. That is the point: a
// type module can believe whatever it likes about its own arithmetic; what ships
// is the string, and the string is what gets checked.

const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n2) => [
  m[0] * n2[0] + m[2] * n2[1],
  m[1] * n2[0] + m[3] * n2[1],
  m[0] * n2[2] + m[2] * n2[3],
  m[1] * n2[2] + m[3] * n2[3],
  m[0] * n2[4] + m[2] * n2[5] + m[4],
  m[1] * n2[4] + m[3] * n2[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Parse an SVG `transform` attribute into a 2x3 matrix. */
function parseTransform(str) {
  let m = IDENT;
  if (!str) return m;
  const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g;
  for (const g of String(str).matchAll(re)) {
    const a = g[2].trim().split(/[\s,]+/).map(Number);
    if (g[1] === "translate") m = mul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
    else if (g[1] === "scale") m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else if (g[1] === "rotate") {
      const t = ((a[0] || 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] || 0, a[2] || 0];
      m = mul(m, [1, 0, 0, 1, cx, cy]);
      m = mul(m, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]);
      m = mul(m, [1, 0, 0, 1, -cx, -cy]);
    } else if (g[1] === "matrix") m = mul(m, a.slice(0, 6));
  }
  return m;
}

/** Axis-aligned box of a local-space rect after `m`. */
function boxUnder(m, x, y, w, h) {
  const pts = [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const ATTR = (s, k) => {
  const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s);
  return m ? m[1] : undefined;
};
const NUM = (s, k, d) => {
  const v = ATTR(s, k);
  const n2 = v === undefined ? NaN : Number(v);
  return Number.isFinite(n2) ? n2 : d;
};

function flattenPath(d) {
  // Absolute M/L/H/V/C/Q/Z only — which is all the engine emits. Curves are
  // sampled, so a bezier that sweeps through a label is caught like a line.
  const segs = [];
  let cur = null;
  let start = null;
  const toks = String(d).match(/[MLHVCQZmlhvcqz]|-?[\d.]+(?:e-?\d+)?/g) || [];
  let i = 0;
  const num = () => Number(toks[i++]);
  let cmd = null;
  const bez = (pts) => {
    const N = 12;
    let prev = cur;
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const p = pts.length === 2 ? qAt(cur, pts[0], pts[1], t) : cAt(cur, pts[0], pts[1], pts[2], t);
      segs.push([prev, p]);
      prev = p;
    }
    return prev;
  };
  const qAt = (p0, c, p1, t) => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1],
  ];
  const cAt = (p0, c1, c2, p1, t) => {
    const u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ];
  };
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    if (cmd === undefined) break;
    const C_ = cmd.toUpperCase();
    if (C_ === "M") {
      cur = [num(), num()];
      start = cur;
      cmd = "L";
    } else if (C_ === "L") {
      const p = [num(), num()];
      segs.push([cur, p]);
      cur = p;
    } else if (C_ === "H") {
      const p = [num(), cur[1]];
      segs.push([cur, p]);
      cur = p;
    } else if (C_ === "V") {
      const p = [cur[0], num()];
      segs.push([cur, p]);
      cur = p;
    } else if (C_ === "C") {
      cur = bez([[num(), num()], [num(), num()], [num(), num()]]);
    } else if (C_ === "Q") {
      const c = [num(), num()];
      const p = [num(), num()];
      cur = bez([c, p, undefined].slice(0, 2));
    } else if (C_ === "Z") {
      if (start && cur) segs.push([cur, start]);
      cur = start;
    } else {
      i++; // unknown command: skip a token and carry on
    }
  }
  return segs;
}

/**
 * Every geometric element of an emitted SVG, normalised into ONE coordinate
 * space (the viewBox), with `<g transform>` respected.
 *
 * @param {string} svg
 * @returns {{boxes:Array, lines:Array}}
 *   boxes: {kind:'text'|'fo'|'rect'|'image', x,y,w,h, text, id}
 *   lines: {id, segs:[[[x,y],[x,y]],…]}
 */
function elementBoxes(svg) {
  const boxes = [];
  const lines = [];
  const stack = [IDENT];
  let idx = 0;
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let m;
  const top = () => stack[stack.length - 1];
  let skipDepth = 0; // inside a <foreignObject>: its HTML children are not SVG
  while ((m = tagRe.exec(svg))) {
    const close = m[1] === "/";
    const tag = m[2];
    const at = m[3] || "";
    const selfClose = m[4] === "/";
    if (skipDepth) {
      if (tag === "foreignObject" && close) skipDepth = 0;
      continue;
    }
    if (close) {
      if (tag === "g" || tag === "svg") stack.pop();
      continue;
    }
    const tm = parseTransform(ATTR(at, "transform"));
    if (tag === "g" || tag === "svg") {
      if (!selfClose) stack.push(mul(top(), tm));
      continue;
    }
    const M = mul(top(), tm);
    const skip = ATTR(at, "data-ov") === "skip";
    const id = `${tag}#${idx++}`;
    if (tag === "rect") {
      if (skip) continue;
      const b = boxUnder(M, NUM(at, "x", 0), NUM(at, "y", 0), NUM(at, "width", 0), NUM(at, "height", 0));
      const fill = ATTR(at, "fill");
      // An UNFILLED rect is not a box, it is four lines — a plot frame, a cell
      // outline, a highlight ring. Treating it as a box makes every axis tick
      // label "overlap the frame" while missing the thing that actually matters,
      // which is a rule running THROUGH a label. Filled rects stay boxes: those
      // are the ones that paint over what is under them.
      if (!fill || fill === "none" || fill === "transparent") {
        lines.push({
          id,
          frame: true,
          segs: [
            [[b.x, b.y], [b.x + b.w, b.y]],
            [[b.x + b.w, b.y], [b.x + b.w, b.y + b.h]],
            [[b.x + b.w, b.y + b.h], [b.x, b.y + b.h]],
            [[b.x, b.y + b.h], [b.x, b.y]],
          ],
        });
      } else boxes.push({ kind: "rect", ...b, id, fill });
    } else if (tag === "image") {
      if (skip) continue;
      const b = boxUnder(M, NUM(at, "x", 0), NUM(at, "y", 0), NUM(at, "width", 0), NUM(at, "height", 0));
      boxes.push({ kind: "image", ...b, id });
    } else if (tag === "foreignObject") {
      skipDepth = 1;
      if (skip) continue;
      const b = boxUnder(M, NUM(at, "x", 0), NUM(at, "y", 0), NUM(at, "width", 0), NUM(at, "height", 0));
      const t = /<div[^>]*>([\s\S]*?)<\/div>/.exec(svg.slice(m.index, m.index + 4000));
      boxes.push({ kind: "fo", ...b, id, text: t ? t[1] : "" });
    } else if (tag === "text") {
      // content runs to the matching </text>
      const end = svg.indexOf("</text>", tagRe.lastIndex);
      const body = end < 0 ? "" : svg.slice(tagRe.lastIndex, end);
      const str = body.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      if (skip || !str.trim()) continue;
      const size = NUM(at, "font-size", 14);
      const lb = textBox(str, size, NUM(at, "x", 0), NUM(at, "y", 0), {
        anchor: ATTR(at, "text-anchor") || "start",
        baseline: ATTR(at, "dominant-baseline"),
        weight: ATTR(at, "font-weight"),
      });
      const b = boxUnder(M, lb.x, lb.y, lb.w, lb.h);
      boxes.push({ kind: "text", ...b, id, text: str, size });
    } else if (tag === "line") {
      const p1 = apply(M, NUM(at, "x1", 0), NUM(at, "y1", 0));
      const p2 = apply(M, NUM(at, "x2", 0), NUM(at, "y2", 0));
      if (!skip) lines.push({ id, segs: [[p1, p2]] });
    } else if (tag === "polyline" || tag === "polygon") {
      const pts = (ATTR(at, "points") || "").trim().split(/\s+/).map((p) => p.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      const tp = pts.map((p) => apply(M, p[0], p[1]));
      const segs = [];
      for (let k = 1; k < tp.length; k++) segs.push([tp[k - 1], tp[k]]);
      if (tag === "polygon" && tp.length > 2) segs.push([tp[tp.length - 1], tp[0]]);
      if (!skip && segs.length) lines.push({ id, segs, head: tag === "polygon" });
    } else if (tag === "path") {
      const segs = flattenPath(ATTR(at, "d") || "").map((s) => [apply(M, s[0][0], s[0][1]), apply(M, s[1][0], s[1][1])]);
      if (!skip && segs.length) lines.push({ id, segs });
    }
  }
  return { boxes, lines };
}

const inset = (b, e) => ({ x: b.x + e, y: b.y + e, w: b.w - 2 * e, h: b.h - 2 * e });
function overlapOf(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 0 && oy > 0 ? { ox, oy } : null;
}
const contains = (o, i, e = 1.5) =>
  i.x >= o.x - e && i.y >= o.y - e && i.x + i.w <= o.x + o.w + e && i.y + i.h <= o.y + o.h + e;

/** Clip param range of segment p0->p1 against rect r (Liang-Barsky). */
function segRect(p0, p1, r) {
  let t0 = 0,
    t1 = 1;
  const dx = p1[0] - p0[0],
    dy = p1[1] - p0[1];
  const p = [-dx, dx, -dy, dy];
  const q = [p0[0] - r.x, r.x + r.w - p0[0], p0[1] - r.y, r.y + r.h - p0[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 <= t1 ? [t0, t1, Math.hypot(dx, dy)] : null;
}

/**
 * Every text/box/image collision in an emitted SVG. Zero tolerance: an empty
 * array is the only passing result.
 *
 * Rules — the ones that survived being run over all 60 gallery examples:
 *   * two text-bearing things (text, foreignObject) may never overlap at all
 *   * a text may overlap a rect/image only by being INSIDE it (its own box)
 *   * two rects that both carry a label may not partially overlap
 *   * a line may not cross a text box, except for the short stub where its own
 *     endpoint anchors on the label
 * An element carrying `data-ov="skip"` is excluded — for deliberate art (a
 * shaded band behind a label, a ray that must pass through its own tick).
 *
 * @param {string} svg
 * @returns {Array<{a:string,b:string,kind:string,bbox:object,detail:string}>}
 */
function checkOverlaps(svg, o = {}) {
  const EPS = o.eps ?? 1.0;
  const { boxes, lines } = elementBoxes(svg);
  const out = [];
  const isText = (b) => b.kind === "text" || b.kind === "fo";
  const labelled = new Map(); // rect id -> true when it holds a label
  for (const r of boxes) {
    if (r.kind !== "rect") continue;
    for (const t of boxes) if (isText(t) && contains(r, t)) labelled.set(r.id, true);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      const ov = overlapOf(inset(a, EPS / 2), inset(b, EPS / 2));
      if (!ov) continue;
      let kind = null;
      if (isText(a) && isText(b)) kind = "text-text";
      else if ((isText(a) && b.kind === "image") || (isText(b) && a.kind === "image"))
        kind = contains(a.kind === "image" ? a : b, a.kind === "image" ? b : a) ? null : "text-image";
      else if (isText(a) || isText(b)) {
        const t = isText(a) ? a : b;
        const r = isText(a) ? b : a;
        kind = contains(r, t) || contains(t, r) ? null : "text-box";
      } else if (a.kind === "rect" && b.kind === "rect") {
        if (labelled.get(a.id) && labelled.get(b.id) && !contains(a, b) && !contains(b, a))
          kind = "box-box";
      }
      if (!kind) continue;
      out.push({
        a: a.id + (a.text ? ` "${String(a.text).slice(0, 28)}"` : ""),
        b: b.id + (b.text ? ` "${String(b.text).slice(0, 28)}"` : ""),
        kind,
        bbox: { x: +Math.max(a.x, b.x).toFixed(1), y: +Math.max(a.y, b.y).toFixed(1), w: +ov.ox.toFixed(1), h: +ov.oy.toFixed(1) },
        detail: `${ov.ox.toFixed(1)}x${ov.oy.toFixed(1)}`,
      });
    }
  }
  // lines vs text
  //
  // A line that crosses a label is a collision UNLESS the label sits on an
  // opaque plate that is painted after the line — that is the standard fix for
  // an axis tick on a gridline or a YES/NO on a connector, and it genuinely
  // removes the collision on the page. Document order decides: the plate must
  // come later in the emitted string than the line it hides.
  const ord = (id) => Number(String(id).split("#")[1] || 0);
  const opaque = (b) => b.kind === "rect" && b.fill && b.fill !== "none" && b.fill !== "transparent";
  const STUB = o.stub ?? 7;
  for (const t of boxes) {
    if (!isText(t)) continue;
    const plates = boxes.filter((b) => opaque(b) && contains(b, t, 0.5));
    const platedAfter = plates.length ? Math.max(...plates.map((p) => ord(p.id))) : -1;
    const r = inset(t, EPS);
    if (r.w <= 0 || r.h <= 0) continue;
    for (const L of lines) {
      if (ord(L.id) < platedAfter) continue;
      let worst = 0;
      for (const s of L.segs) {
        const hit = segRect(s[0], s[1], r);
        if (!hit) continue;
        const [t0, t1, len] = hit;
        const inside = (t1 - t0) * len;
        const anchored = t0 * len < 0.01 || t1 * len > len - 0.01; // ends in/at the box
        if (anchored && inside <= STUB) continue;
        worst = Math.max(worst, inside);
      }
      if (worst > 0.5)
        out.push({
          a: t.id + (t.text ? ` "${String(t.text).slice(0, 28)}"` : ""),
          b: L.id,
          kind: "line-text",
          bbox: { x: +t.x.toFixed(1), y: +t.y.toFixed(1), w: +t.w.toFixed(1), h: +t.h.toFixed(1) },
          detail: `line runs ${worst.toFixed(1)}u through the label`,
        });
    }
  }
  return out;
}

module.exports = {
  measure,
  wrap,
  hasUrdu,
  urduLines,
  urduBoxH,
  textBox,
  elementBoxes,
  checkOverlaps,
  parseTransform,
  UR_PAD,
  UR_LEADING,
  ASCENT,
  DESCENT,
};
