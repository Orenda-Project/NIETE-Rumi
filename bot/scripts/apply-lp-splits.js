#!/usr/bin/env node
'use strict';
/**
 * Apply data/lp_splits.json to the committed data/lp_catalog.json.
 *
 * buildCatalog already applies the splits on a full rebuild; this is for a machine without the
 * ingestion tree. --check exits 1 when the catalog is missing a listed split (CI-friendly).
 *
 * Usage: node scripts/apply-lp-splits.js [--check]
 */

const fs = require('fs');
const path = require('path');
const B = require('./build-lp-catalog');
const { applySplits, loadSplits } = require('./lp-catalog-splits');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'lp_catalog.json');

const current = fs.readFileSync(CATALOG_PATH, 'utf8');
const text = B.serialise(applySplits(JSON.parse(current), loadSplits(), B));
if (process.argv.includes('--check')) {
  if (text !== current) { console.error('✗ lp_catalog.json is missing a split in lp_splits.json'); process.exit(1); }
  console.log('✓ every split is in the catalog');
  process.exit(0);
}
fs.writeFileSync(CATALOG_PATH, text);
console.log(`✓ ${CATALOG_PATH}: ${JSON.parse(text).counts.lessons} lessons`);
