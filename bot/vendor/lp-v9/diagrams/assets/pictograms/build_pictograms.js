#!/usr/bin/env node
/* eslint-disable no-console */
// Build the vendored pictogram set from OpenMoji.
//
//   node build_pictograms.js            fetch openmoji metadata + every glyph in sources.json
//   node build_pictograms.js --offline  re-normalise from ./_raw without the network
//
// WHY A BUILD STEP AND NOT A DEPENDENCY. The engine must be pure, synchronous
// and self-contained: a diagram type may not fetch, and an <image href="http…">
// is a hard failure in the engine's own test harness. So the glyphs are fetched
// ONCE, normalised into something the engine can inline, and committed. The
// runtime (../../lib/pictogram.js) only reads files.
//
// WHAT "NORMALISED" MEANS, and why each step is here:
//   1. the BLACK (line-art) variant, never the colour one. A colour emoji is a
//      picture of an emoji; a line drawing is a pictogram. It also recolours to
//      the page's ink token, survives a greyscale print, and is ~1.6 kB instead
//      of ~4.3 kB.
//   2. the <svg> wrapper is kept (so the asset is a valid, viewable file) but
//      every id is dropped — two pictograms in one figure would otherwise emit
//      duplicate ids into one document.
//   3. #000 / #000000 -> `currentColor` so the drawing takes the ink token. The
//      RUNTIME substitutes a literal colour string for currentColor rather than
//      relying on the cascade: this SVG is screenshotted, and a colour that
//      depends on inheritance is a colour that can come back black.
//   4. data-ov="skip" on EVERY drawn element. checkOverlaps() reconstructs the
//      geometry of every path, rect and line and reports anything crossing a
//      label — correct for a diagram's own rules, wrong for the internal strokes
//      of a piece of art. The pictogram's FOOTPRINT is what layout must respect,
//      and the type modules reserve that box themselves; its whiskers are not
//      rules running through anything. Without this, a cat next to the word
//      "cat" is 40 collisions.
//   5. the viewBox is asserted to be "0 0 72 72" — the runtime scales by
//      size/72 and a glyph on a different grid would silently render at the
//      wrong size.
//
// LICENCE. OpenMoji is CC BY-SA 4.0. LICENSE.txt and ATTRIBUTION.md ship beside
// the glyphs, index.json records every glyph's hexcode + annotation + author,
// and lib/pictogram.js writes the attribution into the SVG's own <desc>.

const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = __dirname;
const SVG_DIR = path.join(DIR, 'svg');
const RAW_DIR = path.join(DIR, '_raw');
const OPENMOJI_VERSION = '15.0.0';
const CDN = `https://cdn.jsdelivr.net/npm/openmoji@${OPENMOJI_VERSION}`;
const OFFLINE = process.argv.includes('--offline');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      return undefined;
    }).on('error', reject);
  });
}

/** Every tag name checkOverlaps() reconstructs geometry for, plus the ones a glyph uses. */
const DRAWN = /<(path|rect|circle|ellipse|line|polyline|polygon|text|image)\b/g;

function normalise(raw, key) {
  let s = String(raw);
  const vb = /viewBox="([^"]+)"/.exec(s);
  if (!vb || vb[1].trim().replace(/\s+/g, ' ') !== '0 0 72 72') {
    throw new Error(`${key}: viewBox is "${vb && vb[1]}", expected "0 0 72 72"`);
  }
  s = s.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/\s+id="[^"]*"/g, '');
  s = s.replace(/#000000\b/gi, 'currentColor').replace(/#000\b/gi, 'currentColor');
  s = s.replace(/stroke="black"/gi, 'stroke="currentColor"').replace(/fill="black"/gi, 'fill="currentColor"');
  // data-ov="skip" on every drawn element (step 4 above)
  s = s.replace(DRAWN, (m) => `${m} data-ov="skip"`);
  return `${s.trim()}\n`;
}

async function main() {
  fs.mkdirSync(SVG_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const sources = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
  const keys = Object.keys(sources.glyphs).sort();

  let meta = null;
  const metaPath = path.join(RAW_DIR, 'openmoji.json');
  if (!OFFLINE) {
    process.stderr.write(`fetching openmoji ${OPENMOJI_VERSION} metadata…\n`);
    const body = await get(`${CDN}/data/openmoji.json`);
    fs.writeFileSync(metaPath, body);
  }
  meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const byAnnotation = new Map();
  meta.forEach((e) => { if (!e.skintone && !byAnnotation.has(e.annotation)) byAnnotation.set(e.annotation, e); });

  const index = { version: OPENMOJI_VERSION, license: sources.license, source: sources.source, glyphs: {} };
  const missing = [];
  for (const key of keys) {
    const annotation = sources.glyphs[key];
    const entry = byAnnotation.get(annotation);
    if (!entry) { missing.push(`${key} — no OpenMoji glyph annotated "${annotation}"`); continue; }
    const file = `${key}.svg`;
    const rawFile = path.join(RAW_DIR, `${entry.hexcode}.svg`);
    if (!OFFLINE) {
      const svg = await get(`${CDN}/black/svg/${entry.hexcode}.svg`);
      fs.writeFileSync(rawFile, svg);
    }
    if (!fs.existsSync(rawFile)) { missing.push(`${key} — ${entry.hexcode}.svg not fetched`); continue; }
    fs.writeFileSync(path.join(SVG_DIR, file), normalise(fs.readFileSync(rawFile, 'utf8'), key));
    index.glyphs[key] = {
      file, hexcode: entry.hexcode, annotation, author: entry.openmoji_author || '',
    };
    process.stderr.write(`  ${key} <- ${entry.hexcode} (${annotation})\n`);
  }
  fs.writeFileSync(path.join(DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const authors = [...new Set(Object.values(index.glyphs).map((g) => g.author).filter(Boolean))].sort();
  fs.writeFileSync(path.join(DIR, 'ATTRIBUTION.md'),
    `# Pictograms — attribution\n\n`
    + `The ${Object.keys(index.glyphs).length} line-art pictograms in \`svg/\` are from **OpenMoji ${OPENMOJI_VERSION}** `
    + `(the *black* variant), used under **CC BY-SA 4.0**. Source: https://openmoji.org\n\n`
    + `Each glyph's OpenMoji hexcode, annotation and author are recorded in \`index.json\`; \`sources.json\` is the `
    + `key → annotation map the build resolves. Rebuild with \`node build_pictograms.js\`.\n\n`
    + `Every rendered figure that uses a pictogram carries the attribution in the SVG's own \`<desc>\` element `
    + `(\`lib/pictogram.js\`), so the credit travels with the picture.\n\n`
    + `## Authors\n\n${authors.map((a) => `- ${a}`).join('\n')}\n`);
  if (missing.length) {
    process.stderr.write(`\nMISSING (${missing.length}):\n${missing.map((m) => `  ${m}`).join('\n')}\n`);
  }
  process.stderr.write(`\nwrote ${Object.keys(index.glyphs).length} glyphs to ${SVG_DIR}\n`);
  if (missing.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
