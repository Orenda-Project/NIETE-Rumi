#!/usr/bin/env node
/**
 * Merge separately-built books into the committed lp_catalog.json (bd-6640j.1.8).
 *
 * The 17 core books were built from a segmentation folder that is not in this
 * repo, so a full rebuild is not possible here. The G1-5 electives (GK, SST,
 * Islamiat) are built on their own with build-lp-catalog's buildCatalog and
 * merged in: a book with the same stem is replaced, every other book is kept as
 * it is, and the counts are recounted.
 *
 * Usage: node scripts/lp-catalog-merge.js --segmentation <dir> --toc <dir> [--catalog data/lp_catalog.json]
 */

const fs = require('fs');
const path = require('path');

const byGradeKey = (a, b) => (a.grade - b.grade) || a.subject_key.localeCompare(b.subject_key);

function mergeBooks(base, extra, { builtAt } = {}) {
  const incoming = new Set(extra.books.map((b) => b.stem));
  const kept = base.books.filter((b) => !incoming.has(b.stem));
  const taken = new Map(kept.map((b) => [`${b.grade} ${b.subject_key}`, b.stem]));
  for (const b of extra.books) {
    const k = `${b.grade} ${b.subject_key}`;
    if (taken.has(k)) throw new Error(`grade ${k} is already ${taken.get(k)}; ${b.stem} would be unreachable`);
    taken.set(k, b.stem);
  }
  const books = [...kept, ...extra.books].sort(byGradeKey);
  const chapters = books.reduce((n, b) => n + b.chapters.length, 0);
  const lessons = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.lessons.length, 0), 0);
  const merged = [...new Set([...(base.source.merged || []), extra.source.segmentation].filter(Boolean))];
  return {
    ...base,
    built_at: builtAt || extra.built_at,
    source: { ...base.source, merged },
    counts: { books: books.length, chapters, lessons },
    books,
  };
}

if (require.main === module) {
  const { buildCatalog, serialise } = require('./build-lp-catalog');
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const catalogPath = path.resolve(arg('catalog') || path.join(__dirname, '..', 'data', 'lp_catalog.json'));
  if (!arg('segmentation') || !arg('toc')) {
    console.error('Usage: lp-catalog-merge.js --segmentation <dir> --toc <dir> [--catalog <file>]');
    process.exit(2);
  }
  const extra = buildCatalog({ segmentationDir: arg('segmentation'), tocDir: arg('toc'), splits: [] });
  const out = mergeBooks(JSON.parse(fs.readFileSync(catalogPath, 'utf8')), extra, { builtAt: extra.built_at });
  fs.writeFileSync(catalogPath, serialise(out));
  console.log(`✓ ${catalogPath}: ${out.counts.books} books · ${out.counts.chapters} chapters · ${out.counts.lessons} lessons`);
}

module.exports = { mergeBooks };
