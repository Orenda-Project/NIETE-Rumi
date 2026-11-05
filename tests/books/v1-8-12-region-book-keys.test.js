/**
 * V1.8.12 — a region names its books (bd-97daxo.4). One nullable column on region_features, nothing else
 * (root rule 15: the region row already exists; a second table would hold the same key).
 * NULL = today's ICT list, so applying it changes no teacher's menu. The GB row's list is written by
 * `sync-sheet-lps.js --books`, not by this migration (prod needs its own go).
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'infrastructure', 'supabase');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const sql = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

it('adds region_features.book_keys TEXT[] NULL, idempotently, and touches no row', () => {
  const up = sql(read('migrations/V1.8.12__region_book_keys.sql'));
  expect(up).toMatch(/ALTER TABLE region_features ADD COLUMN IF NOT EXISTS book_keys TEXT\[\]/i);
  expect(up).not.toMatch(/NOT NULL/i);
  expect(up).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  expect(up).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  expect(up).toMatch(/COMMENT ON COLUMN region_features\.book_keys/i);
});

it('rolls back by dropping only that column', () => {
  const down = sql(read('migrations/ROLLBACK_V1.8.12__region_book_keys.sql'));
  expect(down).toMatch(/ALTER TABLE region_features DROP COLUMN IF EXISTS book_keys/i);
  expect(down.match(/DROP COLUMN/gi)).toHaveLength(1);
});

it('the fresh-install schema has the column too', () => {
  const block = read('00_complete-schema.sql').split('CREATE TABLE IF NOT EXISTS region_features')[1].split(');')[0];
  expect(block).toMatch(/book_keys TEXT\[\]/);
});

it('the version is not taken by another migration', () => {
  const files = fs.readdirSync(path.join(DIR, 'migrations')).filter((f) => /^V1\.8\.12__/.test(f));
  expect(files).toEqual(['V1.8.12__region_book_keys.sql']);
});
