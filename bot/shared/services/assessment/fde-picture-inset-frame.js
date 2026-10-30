'use strict';
/**
 * A grey frame drawn a little inside the picture (v29 review, bd-5jmnfj.4.58). The outer-ring check in
 * fde-pictures sees only the outer 3px, so a frame 13-51px in printed: G2 Urdu Q7 (a rectangle 13px in),
 * G1 English Q13 ii (sides 15px in, top and bottom 51px in), G2 English Q15 (31-40px in).
 *
 * Each side's strongest straight line within MAX_INSET of its edge, when it is at least LINE_SHARE dark,
 * is that side's candidate. A frame has a candidate on all four sides, and each of the four lines is
 * near-solid (CLOSED) between the two lines that cross it: a closed rectangle. A scene's ground line
 * is one side; the v28 drum (sides 29px in) has four candidates, but its curved top and its sides are
 * 80-83% dark between them, where the v29 frames are 96-100%. Measured on the drawings of v24-v29:
 * the three v29 frames and the v25 G1 English Q8 runner (a black frame 13-16px in) are the only ones caught.
 * Pure: a greyscale {data, width, height} in, a boolean out.
 */

const MAX_INSET = 0.2; // of the picture's side
const LINE_SHARE = 0.6;
const CLOSED = 0.93;
const DARK = 235;

const isDark = (img, x, y) => img.data[y * img.width + x] < DARK;

function darkShare(n, at) {
  let dark = 0;
  for (let i = 0; i < n; i += 1) if (at(i)) dark += 1;
  return dark / n;
}

// The inset (from that edge) of the side's strongest line, or -1 when none reaches LINE_SHARE.
function strongest(size, length, at) {
  let best = -1;
  let bestShare = 0;
  const reach = Math.floor(size * MAX_INSET);
  for (let k = 0; k <= reach; k += 1) {
    const share = darkShare(length, (i) => at(k, i));
    if (share >= LINE_SHARE && share > bestShare) { best = k; bestShare = share; }
  }
  return best;
}

/** True when the picture carries a closed rectangle near its edges: a frame. */
function insetFramed(img) {
  const { width: w, height: h } = img;
  if (!w || !h) return false;
  const top = strongest(h, w, (k, x) => isDark(img, x, k));
  const bottom = strongest(h, w, (k, x) => isDark(img, x, h - 1 - k));
  const left = strongest(w, h, (k, y) => isDark(img, k, y));
  const right = strongest(w, h, (k, y) => isDark(img, w - 1 - k, y));
  if ([top, bottom, left, right].some((k) => k < 0)) return false;
  const y0 = top;
  const y1 = h - 1 - bottom;
  const x0 = left;
  const x1 = w - 1 - right;
  const across = x1 - x0 + 1;
  const down = y1 - y0 + 1;
  return [
    darkShare(across, (i) => isDark(img, x0 + i, y0)),
    darkShare(across, (i) => isDark(img, x0 + i, y1)),
    darkShare(down, (i) => isDark(img, x0, y0 + i)),
    darkShare(down, (i) => isDark(img, x1, y0 + i)),
  ].every((share) => share >= CLOSED);
}

module.exports = { insetFramed, MAX_INSET, LINE_SHARE, CLOSED };
