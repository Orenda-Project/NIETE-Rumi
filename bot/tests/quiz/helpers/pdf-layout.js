'use strict';
/**
 * Read a printed PDF back as pages of INK, so a layout test can say what a
 * teacher sees: how many pages, and how far down each one the content reaches.
 *
 * Each page is rasterised by poppler's `pdftoppm` (grey, low resolution) and a
 * pixel row counts as inked when it holds dark pixels INSIDE the page's central
 * column — the outer 12% on each side is ignored, because that is where a box's
 * coloured leading edge runs, and a border that continues to the foot of a page
 * is not content. Background washes (card tints, the guidance box's green, the
 * grey past the end of the document) are all lighter than the ink threshold.
 *
 * These tests print through the real template and the real Chromium. They need
 * the browser the bot's postinstall downloads and poppler's pdftoppm; with
 * SKIP_PLAYWRIGHT_INSTALL=1 (the documented opt-out of the browser) they skip.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const INK = 200;          // grey level below which a pixel is ink
const MIN_DARK = 2;       // dark pixels a row needs to count as inked
const SIDE = 0.12;        // share of the width ignored on each side
const DPI = 30;

function renderOptOut() {
  return process.env.SKIP_PLAYWRIGHT_INSTALL === '1';
}

function hasPoppler() {
  try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Parse a binary PGM (P5). */
function readPgm(file) {
  const buf = fs.readFileSync(file);
  const header = [];
  let i = 0;
  while (header.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[i]))) i += 1;
    if (buf[i] === 0x23) { while (buf[i] !== 0x0a) i += 1; continue; }   // comment line
    let tok = '';
    while (!/\s/.test(String.fromCharCode(buf[i]))) { tok += String.fromCharCode(buf[i]); i += 1; }
    header.push(tok);
  }
  i += 1;
  const [magic, w, h] = [header[0], Number(header[1]), Number(header[2])];
  if (magic !== 'P5') throw new Error(`not a binary PGM: ${magic}`);
  return { w, h, px: buf.subarray(i, i + w * h) };
}

/**
 * @param {Buffer} pdf
 * @returns {Array<{h:number, firstInk:number, lastInk:number, inkedShare:number}>}
 *   per page, in reading order. firstInk/lastInk are fractions of the page height
 *   (-1 when the page holds no ink at all); inkedShare is the share of rows inked.
 */
function pageInk(pdf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-layout-'));
  try {
    const file = path.join(dir, 'doc.pdf');
    fs.writeFileSync(file, pdf);
    execFileSync('pdftoppm', ['-r', String(DPI), '-gray', file, path.join(dir, 'p')]);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.pgm')).sort().map((f) => {
      const { w, h, px } = readPgm(path.join(dir, f));
      const x0 = Math.floor(w * SIDE);
      const x1 = Math.ceil(w * (1 - SIDE));
      let first = -1; let last = -1; let rows = 0;
      for (let y = 0; y < h; y += 1) {
        let dark = 0;
        for (let x = x0; x < x1 && dark < MIN_DARK; x += 1) if (px[y * w + x] < INK) dark += 1;
        if (dark >= MIN_DARK) { rows += 1; last = y; if (first < 0) first = y; }
      }
      return { h, firstInk: first < 0 ? -1 : first / h, lastInk: last < 0 ? -1 : last / h, inkedShare: rows / h };
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Pages in the file, straight from the PDF's own page objects. */
function pageCount(pdf) {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}

module.exports = { pageInk, pageCount, renderOptOut, hasPoppler };
