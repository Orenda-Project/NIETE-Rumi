#!/usr/bin/env node
'use strict';
/**
 * Builds color_glyphs.json: the web quiz's COLOUR picture for each noun in the
 * figure engine's pictogram roster (and for the few emoji a quiz uses as
 * picture options), from Microsoft Fluent Emoji's "Flat" SVGs (MIT, see
 * LICENSE-fluentui-emoji.txt).
 *
 * The engine draws OpenMoji line art (thin, one colour); on a 360 px phone a
 * row of grey outline apples or a line-art bus is hard to read. These flat
 * colour drawings are ~2 KB each and are inlined the same way.
 *
 * Usage: node build_color_bank.js <map.json> <flat_svg_dir>
 *   map.json   { "<noun>": { "fluent": "<Fluent name>", "hex": "<codepoint>" } }
 *   flat dir   <noun>.svg, the upstream file
 *              assets/<Fluent name>/Flat/<name>_flat.svg (or …/Default/Flat/…)
 *
 * Every glyph is normalised to the engine's contract: its 32-unit grid scaled
 * to the 72-unit pictogram grid, every element marked data-ov="skip" (the
 * footprint, not the strokes, is what layout respects), and only plain shape
 * tags kept. A glyph whose drawing needs anything else (a filter, a clip path,
 * a gradient, a url() reference) is LEFT OUT, so that noun keeps its line art:
 * the page's SVG allowlist would strip those parts and show a broken drawing.
 */
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line']);

function normalise(svg) {
  const vb = /viewBox="0 0 32 32"/.test(svg);
  if (!vb) return { error: 'viewBox is not 0 0 32 32' };
  if (/url\(|<defs|gradient|clip-path|<clippath|<mask|\smask=|<filter|\sfilter=|<use|<image|<text/i.test(svg)) return { error: 'needs defs/url/filter' };
  let body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  const bad = [...body.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1].toLowerCase()).filter((t) => !KEEP.has(t));
  if (bad.length) return { error: `tags ${[...new Set(bad)].join(',')}` };
  body = body.replace(/<(path|circle|ellipse|rect|polygon|polyline|line|g)(\s|\/?>)/g, '<$1 data-ov="skip"$2').replace(/\s+/g, ' ');
  return { inner: `<g data-ov="skip" transform="scale(2.25)">${body}</g>` };
}

function main() {
  const [mapPath, dir] = process.argv.slice(2);
  if (!mapPath || !dir) { console.error('usage: build_color_bank.js <map.json> <flat_svg_dir>'); process.exit(2); }
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const glyphs = {};
  const skipped = {};
  for (const noun of Object.keys(map).sort()) {
    const file = path.join(dir, `${noun}.svg`);
    if (!fs.existsSync(file)) { skipped[noun] = 'no file'; continue; }
    const r = normalise(fs.readFileSync(file, 'utf8'));
    if (r.error) skipped[noun] = r.error;
    else glyphs[noun] = { inner: r.inner, src: map[noun].fluent, hex: map[noun].hex };
  }
  const out = {
    source: 'Microsoft Fluent Emoji, Flat style (MIT), https://github.com/microsoft/fluentui-emoji',
    grid: 72,
    glyphs,
    skipped,
  };
  fs.writeFileSync(path.join(__dirname, 'color_glyphs.json'), JSON.stringify(out) + '\n');
  console.log(`${Object.keys(glyphs).length} glyphs, ${Object.keys(skipped).length} skipped`);
}

if (require.main === module) main();
module.exports = { normalise };
