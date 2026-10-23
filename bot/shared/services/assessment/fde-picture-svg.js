'use strict';
/**
 * The Grade 1-2 pictures that are drawn, not generated (bd-5jmnfj.4.3): dots to
 * count, shapes to name (whole, or cut into equal parts with some shaded) and a
 * clock face. Black on white, so they print on any school photocopier. And a
 * plant to label (bd-5jmnfj.4.33): its blank lines sit beside the leaf, stem and
 * root, joined by plain leader lines, never arrows.
 *
 * A picture this module cannot draw throws: the paper fails rather than print an
 * empty box. Pure: no I/O.
 */

const SVG_KINDS = ['dots', 'shapes', 'clock', 'plant'];
const INK = '#000';
const SHADE = '#999';
const CELL = 100; // one shape's box
const GAP = 20;

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const n1 = (x) => Math.round(x * 100) / 100;

function dots({ n }) {
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error(`dots: n must be 1-20, got ${n}`);
  const perRow = 5;
  const step = 24;
  const rows = Math.ceil(n / perRow);
  const body = Array.from({ length: n }, (_, i) => {
    const cx = 14 + (i % perRow) * step;
    const cy = 14 + Math.floor(i / perRow) * step;
    return `<circle cx="${cx}" cy="${cy}" r="8" fill="${INK}"/>`;
  }).join('');
  return svg(perRow * step + 4, rows * step + 4, body);
}

// Whole outlines, each drawn in a CELL x CELL box at (x, 0).
const OUTLINES = {
  circle: (x) => `<circle cx="${x + 50}" cy="50" r="44"/>`,
  square: (x) => `<rect x="${x + 8}" y="8" width="84" height="84"/>`,
  rectangle: (x) => `<rect x="${x + 2}" y="22" width="96" height="56"/>`,
  triangle: (x) => `<polygon points="${x + 50},6 ${x + 94},92 ${x + 6},92"/>`,
  oval: (x) => `<ellipse cx="${x + 50}" cy="50" rx="46" ry="30"/>`,
  semicircle: (x) => `<path d="M${x + 6},74 A44,44 0 0 1 ${x + 94},74 Z"/>`,
  star: (x) => {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 19 : 46;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      return `${n1(x + 50 + r * Math.cos(a))},${n1(52 + r * Math.sin(a))}`;
    });
    return `<polygon points="${pts.join(' ')}"/>`;
  },
  heart: (x) => `<path d="M${x + 50},88 C${x + 10},60 ${x + 2},34 ${x + 22},18 C${x + 36},8 ${x + 48},16 ${x + 50},28 C${x + 52},16 ${x + 64},8 ${x + 78},18 C${x + 98},34 ${x + 90},60 ${x + 50},88 Z"/>`,
};

// Equal parts of the shapes a fraction item cuts: one path per part, in order.
const PARTS = {
  circle: (x, k) => Array.from({ length: k }, (_, i) => {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / k;
    const a1 = a0 + (2 * Math.PI) / k;
    const p = (a) => `${n1(x + 50 + 44 * Math.cos(a))},${n1(50 + 44 * Math.sin(a))}`;
    return `M${x + 50},50 L${p(a0)} A44,44 0 ${k === 1 ? 1 : 0} 1 ${p(a1)} Z`;
  }),
  square: (x, k) => Array.from({ length: k }, (_, i) => {
    const w = 84 / k;
    return `M${n1(x + 8 + i * w)},8 h${n1(w)} v84 h${n1(-w)} Z`;
  }),
  rectangle: (x, k) => Array.from({ length: k }, (_, i) => {
    const w = 96 / k;
    return `M${n1(x + 2 + i * w)},22 h${n1(w)} v56 h${n1(-w)} Z`;
  }),
};

function oneShape(s, x) {
  const shape = String((s && s.shape) || '').trim().toLowerCase();
  if (!OUTLINES[shape]) throw new Error(`unknown shape ${shape || '(none)'}`);
  const tag = `data-shape="${shape}"`;
  if (s.parts == null) return `<g ${tag} fill="none" stroke="${INK}" stroke-width="3">${OUTLINES[shape](x)}</g>`;
  if (!PARTS[shape]) throw new Error(`shape ${shape} cannot be cut into parts`);
  const k = s.parts;
  const shaded = s.shaded == null ? 0 : s.shaded;
  if (!Number.isInteger(k) || k < 2 || k > 4) throw new Error(`shape ${shape}: parts must be 2-4, got ${k}`);
  if (!Number.isInteger(shaded) || shaded < 0 || shaded > k) throw new Error(`shape ${shape}: shaded must be 0-${k}, got ${shaded}`);
  const paths = PARTS[shape](x, k).map((d, i) => (i < shaded
    ? `<path data-part="shaded" d="${d}" fill="${SHADE}"/>`
    : `<path data-part="plain" d="${d}" fill="none"/>`));
  return `<g ${tag} stroke="${INK}" stroke-width="3">${paths.join('')}</g>`;
}

function shapes({ shapes: list }) {
  if (!Array.isArray(list) || !list.length) throw new Error('shapes: no shapes given');
  const body = list.map((s, i) => oneShape(s, i * (CELL + GAP))).join('');
  return svg(list.length * CELL + (list.length - 1) * GAP, CELL, body);
}

function clock({ hour, minute }) {
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || ![0, 15, 30, 45].includes(minute)) {
    throw new Error(`clock: hour 1-12 and minute 0/15/30/45, got ${hour}:${minute}`);
  }
  const at = (deg, r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${n1(60 + r * Math.cos(a))},${n1(60 + r * Math.sin(a))}`;
  };
  const marks = Array.from({ length: 12 }, (_, i) => {
    const h = i + 1;
    const [x, y] = at(h * 30, 40).split(',');
    return `<text data-mark="${h}" x="${x}" y="${Number(y) + 5}" font-size="14" text-anchor="middle" fill="${INK}" font-family="sans-serif">${h}</text>`;
  }).join('');
  const hourDeg = (hour % 12) * 30 + minute / 2;
  const [hx, hy] = at(hourDeg, 28).split(',');
  const [mx, my] = at(minute * 6, 44).split(',');
  return svg(120, 120, `<circle cx="60" cy="60" r="56" fill="none" stroke="${INK}" stroke-width="3"/>${marks}`
    + `<line data-hand="hour" x1="60" y1="60" x2="${hx}" y2="${hy}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`
    + `<line data-hand="minute" x1="60" y1="60" x2="${mx}" y2="${my}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
    + '<circle cx="60" cy="60" r="4" fill="#000"/>');
}

// One plant above a ground line, and a blank line for each part, top to bottom.
const PLANT_BLANKS = [['leaf', 150, 62, 60], ['stem', 103, 118, 118], ['root', 128, 196, 200]];

function plant() {
  const stroke = `fill="none" stroke="${INK}" stroke-linecap="round"`;
  const body = [
    `<line x1="20" y1="150" x2="180" y2="150" stroke="${INK}" stroke-width="3"/>`,
    `<path data-part="stem" d="M100,150 C96,112 104,82 100,36" ${stroke} stroke-width="4"/>`,
    `<path data-part="leaf" d="M100,96 C82,76 58,78 46,90 C62,104 86,106 100,96 Z" ${stroke} stroke-width="3"/>`,
    `<path data-part="leaf" d="M100,72 C118,52 142,54 154,64 C140,78 116,82 100,72 Z" ${stroke} stroke-width="3"/>`,
    `<path data-part="leaf" d="M100,40 C90,26 78,24 70,28 C78,40 90,44 100,40 Z" ${stroke} stroke-width="3"/>`,
    `<path data-part="root" d="M100,150 C98,174 103,194 98,216 M100,164 C88,176 76,184 66,198 M100,170 C112,182 124,190 134,204 M99,190 C91,199 85,207 80,216" ${stroke} stroke-width="2.5"/>`,
    ...PLANT_BLANKS.map(([part, fromX, fromY, y]) => `<line data-leader="${part}" x1="${fromX}" y1="${fromY}" x2="206" y2="${y}" stroke="${INK}" stroke-width="1.5"/>`
      + `<line data-blank="${part}" x1="206" y1="${y}" x2="316" y2="${y}" stroke="${INK}" stroke-width="2"/>`),
  ];
  return svg(320, 230, body.join(''));
}

const DRAW = { dots, shapes, clock, plant };

/** The SVG for a picture this module draws; null for a kind drawn elsewhere. Throws on a picture it cannot draw. */
function svgFor(picture) {
  const draw = DRAW[picture && picture.kind];
  return draw ? draw(picture) : null;
}

function dataUri(markup) {
  return `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;
}

module.exports = { SVG_KINDS, svgFor, dataUri };
