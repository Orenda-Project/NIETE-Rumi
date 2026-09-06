// The SVG builder every diagram type is written against.
//
// Contract: a diagram type builds a `Svg`, draws in *body* coordinates
// (0,0)-(w,bodyH), and returns `svg.toString()`. The builder itself owns the
// title strip, the caption strip and the outer <svg> element, so every type
// gets the same framing for free and none of them has to do viewBox arithmetic.
//
// Self-containment rules (the L1 renderer inlines these strings straight into
// the lesson-plan HTML, and the PDF is printed by headless Chromium):
//   * no external refs — no <image href="http...">, no @import, no <use> across files
//   * arrowheads are polygons, not <marker>, so nothing depends on defs ids
//   * ids are prefixed with a hash of the spec, so two diagrams on one page
//     never collide, and the same spec always yields byte-identical output
//   * Urdu goes through <foreignObject> + an HTML <div dir="rtl">, never SVG
//     <text> — SVG has no bidi/shaping guarantees and Chrome reorders tspans

const crypto = require("crypto");
const { C, FONT, SIZE, LEADING } = require("./tokens");
const { measure, wrap, hasUrdu, urduLines, urduBoxH, textBox, checkOverlaps, elementBoxes } = require("./measure");

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const n = (v) => {
  const r = Math.round(Number(v) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** Deterministic short id from any JSON-able value. */
function hashId(spec) {
  return "d" + crypto.createHash("sha1").update(JSON.stringify(spec ?? {})).digest("hex").slice(0, 7);
}

function attrs(o) {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(" ");
}

class Svg {
  /**
   * @param {number} w   body width in user units
   * @param {number} h   body height in user units
   * @param {object} [o] {title, caption, source, note, lang, id, bg, pad}
   */
  constructor(w, h, o = {}) {
    this.w = w;
    this.bodyH = h;
    this.o = o;
    this.id = o.id || hashId(o.spec ?? [w, h, o.title, o.caption]);
    this.parts = [];
    this.defs = [];
    this.lang = o.lang || "en";
  }

  /* ---------------- raw ---------------- */
  add(markup) {
    this.parts.push(markup);
    return this;
  }
  def(markup) {
    this.defs.push(markup);
    return this;
  }
  uid(suffix) {
    return `${this.id}_${suffix}`;
  }

  /* ---------------- shapes ---------------- */
  _paint(o = {}) {
    return {
      fill: o.fill ?? "none",
      stroke: o.stroke,
      "stroke-width": o.sw,
      "stroke-dasharray": o.dash,
      "stroke-linecap": o.cap,
      "stroke-linejoin": o.join,
      opacity: o.opacity,
      transform: o.transform,
      class: o.class,
    };
  }

  rect(x, y, w, h, o = {}) {
    return this.add(
      `<rect ${attrs({ x: n(x), y: n(y), width: n(w), height: n(h), rx: o.rx, ry: o.ry, ...this._paint(o) })}/>`
    );
  }
  line(x1, y1, x2, y2, o = {}) {
    return this.add(
      `<line ${attrs({ x1: n(x1), y1: n(y1), x2: n(x2), y2: n(y2), ...this._paint({ stroke: C.ink, sw: 1.5, ...o }) })}/>`
    );
  }
  circle(cx, cy, r, o = {}) {
    return this.add(`<circle ${attrs({ cx: n(cx), cy: n(cy), r: n(r), ...this._paint(o) })}/>`);
  }
  ellipse(cx, cy, rx, ry, o = {}) {
    return this.add(`<ellipse ${attrs({ cx: n(cx), cy: n(cy), rx: n(rx), ry: n(ry), ...this._paint(o) })}/>`);
  }
  path(d, o = {}) {
    return this.add(`<path ${attrs({ d, ...this._paint(o) })}/>`);
  }
  polygon(pts, o = {}) {
    return this.add(`<polygon ${attrs({ points: pts.map((p) => `${n(p[0])},${n(p[1])}`).join(" "), ...this._paint(o) })}/>`);
  }
  polyline(pts, o = {}) {
    return this.add(
      `<polyline ${attrs({ points: pts.map((p) => `${n(p[0])},${n(p[1])}`).join(" "), ...this._paint({ fill: "none", stroke: C.ink, sw: 1.5, ...o }) })}/>`
    );
  }
  group(attrObj, fn) {
    const before = this.parts.length;
    fn(this);
    const inner = this.parts.splice(before).join("");
    return this.add(`<g ${attrs(attrObj)}>${inner}</g>`);
  }

  /* ---------------- arrows ---------------- */
  /** Arrowhead polygon pointing along (dx,dy), tip at (x,y). */
  head(x, y, dx, dy, o = {}) {
    const L = o.size ?? 9;
    const Wd = o.width ?? 6;
    const m = Math.hypot(dx, dy) || 1;
    const ux = dx / m,
      uy = dy / m;
    const bx = x - ux * L,
      by = y - uy * L;
    const px = -uy * (Wd / 2),
      py = ux * (Wd / 2);
    return this.polygon(
      [
        [x, y],
        [bx + px, by + py],
        [bx - px, by - py],
      ],
      { fill: o.stroke ?? o.fill ?? C.ink }
    );
  }

  /** Straight arrow from (x1,y1) to (x2,y2). `both:true` adds a tail head. */
  arrow(x1, y1, x2, y2, o = {}) {
    const stroke = o.stroke ?? C.ink;
    const sw = o.sw ?? 1.6;
    const L = o.size ?? 9;
    const m = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / m,
      uy = (y2 - y1) / m;
    const ex = x2 - ux * L * 0.85,
      ey = y2 - uy * L * 0.85;
    const sx = o.both ? x1 + ux * L * 0.85 : x1;
    const sy = o.both ? y1 + uy * L * 0.85 : y1;
    this.line(sx, sy, ex, ey, { stroke, sw, dash: o.dash, cap: "round" });
    this.head(x2, y2, ux, uy, { stroke, size: L, width: o.width });
    if (o.both) this.head(x1, y1, -ux, -uy, { stroke, size: L, width: o.width });
    return this;
  }

  /** Quadratic-curve arrow. `bend` is the perpendicular offset of the control point. */
  curveArrow(x1, y1, x2, y2, o = {}) {
    const stroke = o.stroke ?? C.ink;
    const sw = o.sw ?? 1.6;
    const bend = o.bend ?? 0;
    const mx = (x1 + x2) / 2,
      my = (y1 + y2) / 2;
    const dx = x2 - x1,
      dy = y2 - y1;
    const m = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / m) * bend,
      cy = my + (dx / m) * bend;
    this.path(`M${n(x1)},${n(y1)} Q${n(cx)},${n(cy)} ${n(x2)},${n(y2)}`, {
      fill: "none",
      stroke,
      sw,
      dash: o.dash,
      cap: "round",
    });
    if (o.head !== false) this.head(x2, y2, x2 - cx, y2 - cy, { stroke, size: o.size });
    return this;
  }

  /* ---------------- text ---------------- */
  /**
   * Draw a single-line (or wrapped, for Urdu) label.
   * `y` is the alphabetic baseline for LTR text and the visual centre when
   * `baseline:'middle'`.
   * @param {object} o {size,weight,anchor,fill,lang,italic,family,opacity,
   *                    baseline,w,h,transform,letterSpacing,lines}
   */
  text(x, y, str, o = {}) {
    const s = String(str ?? "");
    if (!s) return this;
    const size = o.size ?? SIZE.label;
    // Arabic script ALWAYS goes to the foreignObject path, even when the caller
    // says lang:"en". A doc can be tagged en and still carry an Urdu term, and
    // SVG <text> has no shaping: the old `o.lang !== "en" &&` guard emitted a
    // broken, unmeasurable run that then ran out of its own box.
    const urdu = hasUrdu(s); // script decides the path; lang only forces nothing
    if (urdu) return this._urduText(x, y, s, { ...o, size });
    const anchor = o.anchor ?? "start";
    const dom =
      o.baseline === "middle" ? "central" : o.baseline === "hanging" ? "hanging" : undefined;
    return this.add(
      `<text ${attrs({
        x: n(x),
        y: n(y),
        "text-anchor": anchor === "start" ? undefined : anchor,
        "dominant-baseline": dom,
        "font-family": o.family ?? FONT.latin,
        "font-size": n(size),
        "font-weight": o.weight,
        "font-style": o.italic ? "italic" : undefined,
        "letter-spacing": o.letterSpacing,
        fill: o.fill ?? C.text,
        opacity: o.opacity,
        transform: o.transform,
      })}>${esc(s)}</text>`
    );
  }

  /** Urdu / Arabic-script label: HTML in a foreignObject so HarfBuzz shapes it. */
  _urduText(x, y, s, o) {
    const size = o.size;
    const anchor = o.anchor ?? "start";
    const boxW = o.w ?? Math.max(measure(s, size, { lang: "ur" }) * 1.25 + size, size * 3);
    // Height comes from the SHARED estimator in lib/measure.js. It used to be
    // computed here with a *different*, unpadded formula than the one callers
    // used to reserve space — which is exactly how mindmap leaves overlapped:
    // the caller reserved one height, this drew a shorter box, and the real text
    // spilled out of it silently (overflow:visible).
    const boxH = o.h ?? urduBoxH(s, size, boxW);
    const fx = anchor === "middle" ? x - boxW / 2 : anchor === "end" ? x - boxW : x;
    // Vertical placement, calibrated against rendered PNGs (scratchpad/cal.png):
    // with line-height:normal the Nastaliq glyph body sits high in its line box
    // and the descenders of ن/ک/گ hang below. Putting the box bottom ~0.95em
    // under the requested baseline lines the Urdu body up with Latin text on the
    // same baseline, with the descenders free to overhang (overflow:visible).
    const fy =
      o.baseline === "middle" || o.baseline === "hanging" ? y - boxH / 2 : y - (boxH - size * 0.95);
    const align = anchor === "middle" ? "center" : anchor === "end" ? "left" : "right";
    const style = [
      `direction:rtl`,
      `text-align:${align}`,
      `font-family:${FONT.urdu}`,
      `font-size:${n(size)}px`,
      // `normal` (not a fixed px) — Nastaliq descenders cascade diagonally and a
      // clamped line box clips ک/گ. LEADING.urdu is used for *layout arithmetic*
      // only; the browser picks the real line box from the font's own metrics.
      `line-height:normal`,
      `color:${o.fill ?? C.text}`,
      o.weight ? `font-weight:${o.weight}` : "",
      `overflow:visible`,
      `white-space:normal`,
    ]
      .filter(Boolean)
      .join(";");
    return this.add(
      `<foreignObject ${attrs({
        x: n(fx),
        y: n(fy),
        width: n(boxW),
        height: n(boxH),
        overflow: "visible",
        transform: o.transform,
      })}><div xmlns="http://www.w3.org/1999/xhtml" lang="ur" dir="rtl" style="${style}">${esc(s)}</div></foreignObject>`
    );
  }

  /**
   * Multi-line block, wrapped to `w`. Returns the height consumed.
   * LTR only wraps; Urdu is handed to the browser as one box.
   */
  textBlock(x, y, w, str, o = {}) {
    const size = o.size ?? SIZE.small;
    const s = String(str ?? "");
    const urdu = hasUrdu(s); // script decides the path; lang only forces nothing
    if (urdu) {
      const lineH = size * LEADING.urdu;
      const nLines = Math.max(1, Math.ceil(measure(s, size, { lang: "ur" }) / (w - 4)));
      const h = lineH * nLines + size * 0.4;
      this._urduText(x, y + h / 2, s, { ...o, size, w, h, baseline: "middle" });
      return h;
    }
    const lines = Array.isArray(str) ? str : wrap(s, size, w, o);
    const lh = size * (o.leading ?? LEADING.latin);
    lines.forEach((ln, i) => this.text(x, y + size * 0.85 + i * lh, ln, { ...o, size }));
    return lines.length * lh;
  }

  /**
   * A label on a PLATE: an opaque rounded rect sized from the shared estimator,
   * then the label on top of it. Use this for any label that must sit on a line
   * it cannot be moved off — an axis tick on a gridline, YES/NO on a connector,
   * a force name on its own arrow, a ray label crossing the ray.
   *
   * The plate is what makes it legible AND what makes it legal: checkOverlaps()
   * clears a line/label crossing only when an opaque plate covering the label is
   * painted after the line. The geometry comes from measure.textBox — no type
   * module may compute a label extent of its own (README §Collision contract).
   *
   * `o.plate` is DUAL-USE and that is the whole bug this guard exists for. To a
   * type module it is a BOOLEAN FLAG — graph.js writes `plate:true` meaning "this
   * label rides a plate" — and the module then spreads its whole option bag in
   * here, where the same key used to be read as a COLOUR. `fill: o.plate ?? C.paper`
   * therefore emitted `fill="true"`, and SVG does not reject a bad paint value: it
   * silently falls back to the initial `fill: black`. Every axis tick number and
   * every in-plot annotation on every graph printed in a BLACK BOX (23 of them on
   * one G9 physics page, 2026-09-02), navy-on-black and unreadable. So: only a
   * real colour string may reach the rect; a boolean means "yes, the default".
   */
  plateText(x, y, str, o = {}) {
    const s = String(str ?? "");
    if (!s) return this;
    const size = o.size ?? SIZE.label;
    const urdu = hasUrdu(s); // script decides the path; lang only forces nothing
    const padX = o.padX ?? 3;
    const padY = o.padY ?? 1.5;
    // The dual-use guard (see the doc comment): a flag is not a colour.
    const plate = typeof o.plate === "string" && o.plate ? o.plate : C.paper;
    if (urdu) {
      // Urdu height is a prediction, so the plate is drawn from the SAME
      // estimator the foreignObject uses.
      const bw = o.w ?? Math.max(measure(s, size, { lang: "ur" }) * 1.25 + size, size * 3);
      const bh = o.h ?? urduBoxH(s, size, bw);
      const anchor = o.anchor ?? "start";
      const bx = anchor === "middle" ? x - bw / 2 : anchor === "end" ? x - bw : x;
      const by = o.baseline === "middle" || o.baseline === "hanging" ? y - bh / 2 : y - (bh - size * 0.95);
      this.rect(bx - padX, by - padY, bw + padX * 2, bh + padY * 2, {
        fill: plate,
        rx: 3,
        opacity: o.plateOpacity,
        transform: o.transform,
      });
      return this.text(x, y, s, { ...o, size, w: bw, h: bh });
    }
    const b = textBox(s, size, x, y, {
      anchor: o.anchor ?? "start",
      baseline: o.baseline,
      weight: o.weight,
    });
    this.rect(b.x - padX, b.y - padY, b.w + padX * 2, b.h + padY * 2, {
      fill: plate,
      rx: 3,
      opacity: o.plateOpacity,
      transform: o.transform,
    });
    return this.text(x, y, s, { ...o, size });
  }

  /* ---------------- boxes ---------------- */
  /** Rounded label box with centred (optionally multi-line) text. */
  labelBox(x, y, w, h, str, o = {}) {
    this.rect(x, y, w, h, {
      rx: o.rx ?? 6,
      fill: o.fill ?? C.paper,
      stroke: o.stroke ?? C.ink,
      sw: o.sw ?? 1.5,
    });
    const size = o.size ?? SIZE.small;
    const s = String(str ?? "");
    const urdu = hasUrdu(s); // script decides the path; lang only forces nothing
    if (urdu) {
      this._urduText(x + w / 2, y + h / 2, s, {
        ...o,
        size,
        anchor: "middle",
        baseline: "middle",
        w: w - 6,
        h: h - 4,
        fill: o.color ?? C.text,
      });
    } else {
      const lines = wrap(s, size, w - 10, o);
      const lh = size * LEADING.latin;
      const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2;
      lines.forEach((ln, i) =>
        this.text(x + w / 2, y0 + i * lh, ln, {
          size,
          weight: o.weight,
          anchor: "middle",
          baseline: "middle",
          fill: o.color ?? C.text,
          italic: o.italic,
        })
      );
    }
    return this;
  }

  /* ---------------- output ---------------- */
  toString() {
    const pad = this.o.pad ?? 0;
    const titleSize = SIZE.title;
    const capSize = SIZE.caption;
    const title = this.o.title;
    const caption = this.o.caption;
    const source = this.o.source;
    const note = this.o.note;
    const isUr = this.lang === "ur";

    const totalW = this.w + pad * 2;
    const inner = totalW - 24; // the strips keep a 12-unit margin each side

    // Title and caption strips WRAP. A long caption on a narrow body used to run
    // straight off both sides of the viewBox and be clipped (caught on the NaCl
    // dot-and-cross figure) — the strips are measured first, then the height is
    // reserved from what the wrap actually produced.
    const lineCount = (s, size) => {
      if (!s) return 0;
      if (hasUrdu(s)) return Math.max(1, Math.ceil(measure(s, size, { lang: "ur" }) / inner));
      return wrap(s, size, inner).length;
    };
    const lhFor = (size, s) => size * (hasUrdu(String(s ?? "")) ? LEADING.urdu : LEADING.latin);

    const titleLines = lineCount(title, titleSize);
    const titleH = titleLines ? titleLines * lhFor(titleSize, title) + titleSize * (hasUrdu(String(title ?? "")) ? 0.7 : 0.55) : 0;

    const strips = [
      caption && { s: caption, size: capSize, fill: C.muted },
      // never below SIZE.small: the source line was the smallest type in the whole
      // engine and was the one thing dragging labelled_figure under the phone floor
      source && { s: source, size: Math.max(SIZE.small, capSize * 0.92), fill: C.faint, italic: true },
      note && { s: note, size: capSize, fill: C.text },
    ].filter(Boolean);
    for (const st of strips) {
      st.lines = lineCount(st.s, st.size);
      st.h = st.lines * lhFor(st.size, st.s);
    }
    const capH = strips.length ? strips.reduce((a, st) => a + st.h, 0) + capSize * 0.9 : 0;
    const totalH = titleH + this.bodyH + capH + pad * 2;

    const head = new Svg(0, 0, { id: this.id }); // scratch builder for chrome text
    const strip = (s, y, o) => {
      if (hasUrdu(s)) {
        head._urduText(totalW / 2, y + o.h / 2, s, {
          ...o,
          anchor: "middle",
          baseline: "middle",
          w: inner,
          h: o.h,
        });
      } else {
        const lines = wrap(s, o.size, inner);
        const lh = o.size * LEADING.latin;
        lines.forEach((ln, i) =>
          head.text(totalW / 2, y + o.size * 0.9 + i * lh, ln, { ...o, anchor: "middle" })
        );
      }
    };

    if (title) {
      strip(title, pad, {
        size: titleSize,
        h: titleH,
        weight: 700,
        fill: C.ink,
        lang: this.lang,
        letterSpacing: isUr ? undefined : "0.02em",
      });
    }
    let cy = pad + titleH + this.bodyH + capSize * 0.6;
    for (const st of strips) {
      strip(st.s, cy, {
        size: st.size,
        h: st.h,
        fill: st.fill,
        italic: st.italic,
        lang: this.lang,
      });
      cy += st.h;
    }

    const defs = this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "";
    const bg = this.o.bg === false ? "" : `<rect x="0" y="0" width="${n(totalW)}" height="${n(totalH)}" fill="${this.o.bg || C.paper}"/>`;
    const body =
      defs +
      bg +
      head.parts.join("") +
      `<g transform="translate(${n(pad)},${n(pad + titleH)})">${this.parts.join("")}</g>`;

    // The smallest type actually emitted, in user units. The renderer needs this:
    // an SVG is scaled by min(boxW/vbW, boxH/vbH), so whether a label is legible
    // is a property of the BOX IT IS GIVEN, not of the font size alone. Declaring
    // it lets render_lp.js allocate a slot instead of silently crushing the figure.
    const emitted = [...body.matchAll(/font-size[:="]+\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const minFont = emitted.length ? Math.min(...emitted) : SIZE.small;

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="0 0 ${n(totalW)} ${n(totalH)}" width="100%" ` +
      `preserveAspectRatio="xMidYMid meet" role="img" ` +
      `data-min-font="${n(minFont)}" ` +
      `aria-label="${esc(title || caption || "diagram")}" ` +
      // direction:ltr is NOT cosmetic. On an Urdu lesson-plan page the figure is
      // inside a dir="rtl" container, and SVG <text> inherits `direction` from
      // CSS — which MIRRORS text-anchor:start/end. Every Latin label anchored
      // "end" then grows to the RIGHT instead of the left, and the mindmap's
      // leaves ended up under its centre box (G9 Bio ur, p2). unicode-bidi:
      // isolate additionally stops a bidi run outside the figure from reordering
      // numbers and units inside it. The Urdu labels are unaffected: they are
      // foreignObject <div dir="rtl"> and carry their own direction.
      `style="display:block;max-width:100%;height:auto;direction:ltr;unicode-bidi:isolate;` +
      `font-family:${FONT.latin}">` +
      body +
      `</svg>`
    );
  }
}

/**
 * The box a rendered diagram needs in order to stay readable.
 *
 * An SVG with a viewBox is scaled by `min(boxW/vbW, boxH/vbH)`, so a diagram
 * squashed by a `max-height` renders its type far below the size its font-size
 * suggests. Given the SVG string, this returns the smallest CSS box in which the
 * smallest label still renders at `minPx`.
 *
 * @param {string} svg
 * @param {{minPx?:number, colPx?:number}} [o] minPx: the legibility floor
 *   (13.5 px at a 794 px page). colPx: the column width the figure will get.
 * @returns {{vbW,vbH,minFont,minWidthPx,minHeightPx,renderedPx,heightAt}}
 */
function requiredBox(svg, o = {}) {
  const minPx = o.minPx ?? 13.5;
  const m = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!m) throw new Error("requiredBox: no viewBox");
  const [, , vbW, vbH] = m[1].trim().split(/\s+/).map(Number);
  const f = svg.match(/data-min-font="([\d.]+)"/);
  const minFont = f ? Number(f[1]) : 12;
  const minWidthPx = (minPx * vbW) / minFont; // width at which type hits the floor
  const minHeightPx = (minWidthPx * vbH) / vbW; // its natural height at that width
  const colPx = o.colPx;
  return {
    vbW,
    vbH,
    minFont,
    minWidthPx: Math.ceil(minWidthPx),
    minHeightPx: Math.ceil(minHeightPx),
    // if a column width is supplied: the height the figure needs there, and the
    // size the smallest label actually renders at when given that natural height
    heightAt: colPx ? Math.ceil((colPx * vbH) / vbW) : null,
    renderedPx: colPx ? +((minFont * colPx) / vbW).toFixed(2) : null,
  };
}

module.exports = { Svg, requiredBox, esc, n, hashId, attrs, measure, wrap, hasUrdu, urduLines, urduBoxH, textBox, checkOverlaps, elementBoxes, C, FONT, SIZE, LEADING };
