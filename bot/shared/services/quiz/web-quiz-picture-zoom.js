'use strict';
/**
 * Web quiz: picture options a child can tell apart.
 *
 * Some picture options are the same picture except for one small region — three grey bins that
 * differ only in the heap on top (glass, food scraps, plastic bags). At 360 px the heap is a few
 * pixels and the child cannot tell the options apart. For such a set the page shows every option
 * cropped to the region where they differ, so the difference IS the picture.
 *
 * Works on the option pictures stored inline (media.option_images[].b64): no network, a few
 * milliseconds of decoding per question, cached per question. A picture that cannot be decoded,
 * or a set whose pictures differ as wholes, gets no zoom (null) — the plain picture is shown.
 */
const sharp = require('sharp');

const N = 96; // the grid the pictures are compared on
const STRONG = 200; // |dR|+|dG|+|dB| above this is a real difference, not shading or JPEG noise
// Near-identical: the pictures share most of their drawing and differ in one region. Measured
// against the drawing (not the whole frame, which may be mostly background).
const MAX_DIFF_OF_INK = 0.35; // above: the pictures differ as wholes (a tall man, a short man)
const MIN_DIFF = 0.02; // below: a fine detail (a radius line, one red digit) whose meaning is the
// shared drawing around it — cropping would cut that context away
const MAX_BOX = 0.5; // a zoom box over this share of the picture is no zoom
const PAD = 0.08;

const cache = new Map();
const CACHE_MAX = 500;

async function rgb(b64) {
  const { data } = await sharp(Buffer.from(String(b64), 'base64'))
    .flatten({ background: '#ffffff' }).resize(N, N, { fit: 'fill' }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * The [lo, hi) span of a row (or column) histogram of differing pixels: thin one-pixel lines (an
 * outline drawn on one picture only) are dropped first, then the span covers every row that holds
 * any real share of the difference (a twentieth of the busiest row): the crop keeps EVERY part
 * that differs, never only the densest one (an eclipse's moon as well as its sun).
 */
function span(v) {
  const e = v.map((x, k) => Math.min(x, k > 0 ? v[k - 1] : 0, k < v.length - 1 ? v[k + 1] : 0));
  const peak = Math.max(...e);
  if (!peak) return [0, v.length];
  let lo = 0; let hi = v.length;
  const floor = Math.max(2, peak / 20);
  while (lo < e.length && e[lo] < floor) lo += 1;
  while (hi > lo && e[hi - 1] < floor) hi -= 1;
  return [Math.max(0, lo - 1), Math.min(v.length, hi + 1)];
}

/**
 * The region (fractions of the picture: x, y, w, h) where a set of same-shaped pictures differ,
 * or null when there is nothing worth zooming to.
 */
async function differenceBox(b64s) {
  const list = (b64s || []).filter(Boolean);
  if (list.length < 2) return null;
  let px;
  try { px = await Promise.all(list.map(rgb)); } catch { return null; }
  const rows = new Array(N).fill(0); const cols = new Array(N).fill(0);
  let diff = 0; let ink = 0;
  const bg = [px[0][0], px[0][1], px[0][2]]; // the corner: the frame's background colour
  for (let p = 0; p < N * N; p += 1) {
    const i = p * 3;
    let worst = 0; let drawn = false;
    for (let a = 0; a < px.length; a += 1) {
      if (!drawn && Math.abs(px[a][i] - bg[0]) + Math.abs(px[a][i + 1] - bg[1]) + Math.abs(px[a][i + 2] - bg[2]) > 60) drawn = true;
      for (let b = a + 1; b < px.length; b += 1) {
        const d = Math.abs(px[a][i] - px[b][i]) + Math.abs(px[a][i + 1] - px[b][i + 1]) + Math.abs(px[a][i + 2] - px[b][i + 2]);
        if (d > worst) worst = d;
      }
    }
    if (drawn) ink += 1;
    if (worst > STRONG) { diff += 1; rows[Math.floor(p / N)] += 1; cols[p % N] += 1; }
  }
  const share = diff / (N * N);
  if (!ink || share < MIN_DIFF || diff / ink > MAX_DIFF_OF_INK) return null;
  const [y0, y1] = span(rows); const [x0, x1] = span(cols);
  // The box, padded; the tile shows it whole (object-fit: contain), so a wide heap fills the tile's width.
  const x = Math.max(0, x0 / N - PAD); const y = Math.max(0, y0 / N - PAD);
  const w = Math.min(1 - x, (x1 - x0) / N + 2 * PAD); const h = Math.min(1 - y, (y1 - y0) / N + 2 * PAD);
  if (w * h > MAX_BOX) return null;
  const r = (v) => Math.round(v * 1000) / 1000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

/** The zoom box for a question's inline option pictures, cached by question id. */
// A question about size (tall, big, more…) compares the pictures as wholes: never cropped, the
// crop would make every option the same size.
const SIZE_WORDS = /\b(tall|taller|tallest|short|shorter|big|bigger|biggest|small|smaller|smallest|large|larger|long|longer|longest|more|most|less|fewer|greater|heavy|heavier|light|lighter|size|length|height|width|how many|count|odd|even|number of)\b|لمب|چھوٹ|بڑ[اےی]|زیادہ|کم|بھاری|ہلک|کتن|گن|لمبائی|اونچائی/i;

async function zoomFor(q) {
  if (SIZE_WORDS.test(String((q && q.question_text) || ''))) return null;
  const imgs = q && q.media && Array.isArray(q.media.option_images) ? q.media.option_images : null;
  if (!imgs || imgs.length < 2 || !imgs.every((o) => o && o.b64)) return null;
  const key = `${q.id}:${imgs.map((o) => String(o.b64).length).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const box = await differenceBox(imgs.map((o) => o.b64));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, box);
  return box;
}

/** The picture cropped to the box, as a PNG about 240 px wide; null if it cannot be made. */
async function crop(b64, box) {
  try {
    const img = sharp(Buffer.from(String(b64), 'base64'));
    const { width, height } = await img.metadata();
    const left = Math.round(box.x * width); const top = Math.round(box.y * height);
    const w = Math.max(1, Math.min(width - left, Math.round(box.w * width)));
    const h = Math.max(1, Math.min(height - top, Math.round(box.h * height)));
    return await sharp(Buffer.from(String(b64), 'base64')).extract({ left, top, width: w, height: h })
      .resize({ width: 240, withoutEnlargement: false }).png().toBuffer();
  } catch { return null; }
}

module.exports = { differenceBox, zoomFor, crop };
