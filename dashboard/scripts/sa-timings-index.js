#!/usr/bin/env node
'use strict';
/**
 * The v4 clips that have a word-timing file beside them (dashboard/sa/v4/<lang>/<key>.json), by language:
 * dashboard/sa/timings.index.json = { "ur": [keys], "en": [keys] }, keys sorted.
 *
 * sa-offline.js reads it before it asks the service worker for word timings, so a page asks only for the timing files
 * that exist (not one beside every v4 clip). It sits at the top of dashboard/sa/, outside the clips lock's scope
 * (dashboard/scripts/sa-clips-lock.js keeps /sa/v<n>/ and media only): the worker answers it network first, so a new
 * index reaches a phone without a SESSION change.
 *
 *   node dashboard/scripts/sa-timings-index.js           # rewrite the index after adding or removing timing files
 *
 * tests/sa-r28-timings-index.service.test.js fails when the committed index differs from the folder.
 */
const fs = require('fs');
const path = require('path');

const SA = path.join(__dirname, '..', 'sa');
const INDEX = path.join(SA, 'timings.index.json');
const LANGS = ['ur', 'en'];

/** { ur: [keys], en: [keys] } of the v4 clips with a timing file, from the folder under sa (default dashboard/sa). */
function build(sa = SA) {
  const out = {};
  for (const lang of LANGS) {
    let names = [];
    try { names = fs.readdirSync(path.join(sa, 'v4', lang)); } catch (_) { names = []; }
    out[lang] = names.map((n) => /^([0-9a-f]{12})\.json$/.exec(n)).filter(Boolean).map((m) => m[1]).sort();
  }
  return out;
}

function main() {
  const idx = build();
  fs.writeFileSync(INDEX, JSON.stringify(idx) + '\n');
  console.log(`${INDEX}: ${LANGS.map((l) => `${l} ${idx[l].length}`).join(', ')}`);
}

if (require.main === module) main();

module.exports = { build, INDEX };
