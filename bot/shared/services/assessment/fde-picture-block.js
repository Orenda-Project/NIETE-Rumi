'use strict';
/**
 * What a Grade 1-2 picture prints as (bd-5jmnfj.4.3). The pipeline (fde-pictures)
 * has already embedded every image as a data URI in `picture.src`; this only lays
 * it out: one image, a count repeated n times, a scene drawn larger.
 *
 * An item whose picture has no image throws: the paper never prints an empty box.
 * Pure: strings in, strings out.
 */

const attr = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function altOf(p) {
  return p.name || p.describe || p.kind;
}

/** The picture's HTML, or '' for an item with no picture. */
function pictureBlock(q) {
  const p = q && q.picture;
  if (!p) return '';
  if (!p.src) throw new Error(`picture on ${q.slot || 'an item'} has no image: the paper would print an empty box`);
  const img = `<img src="${attr(p.src)}" alt="${attr(altOf(p))}">`;
  if (p.kind === 'count') {
    if (!Number.isInteger(p.n) || p.n < 1) throw new Error(`count picture on ${q.slot || 'an item'} needs n, got ${p.n}`);
    return `<div class="pic pic-count">${img.repeat(p.n)}</div>`;
  }
  return `<div class="pic pic-${attr(p.kind)}">${img}</div>`;
}

/**
 * A speech-bubble item (bd-5jmnfj.4.40): the picture with an empty bubble beside it to write in.
 * The paper draws the bubble; v18's image model left it out, or put it over the wrong child.
 */
function bubbleBlock(pic) {
  return `<div class="bubble-row">${pic}<div class="bubble"></div></div>`;
}

const PICTURE_CSS = `
  .pic { margin: 4px 0; break-inside: avoid; }
  .pic img { height: 28mm; width: auto; }
  .pic-count { display: flex; flex-wrap: wrap; gap: 3mm; }
  .pic-count img { height: 14mm; }
  .pic-dots img, .pic-clock img { height: 24mm; }
  .pic-shapes img { height: 22mm; }
  .pic-scene img { height: 45mm; }
  .pic-plant img { height: 60mm; }
  .bubble-row { display: flex; align-items: flex-start; gap: 6mm; break-inside: avoid; }
  .bubble { position: relative; width: 62mm; height: 26mm; margin-top: 4mm; border: 0.5mm solid #000; border-radius: 50%; }
  .bubble::before { content: ''; position: absolute; left: -5mm; bottom: 3mm; border-style: solid;
    border-width: 2.5mm 6mm 2.5mm 0; border-color: transparent #000 transparent transparent; }
`;

module.exports = { pictureBlock, bubbleBlock, PICTURE_CSS };
