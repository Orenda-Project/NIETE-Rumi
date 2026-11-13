'use strict';
/**
 * bd-uam6dh.3: the English-medium GK/SST books are their own subject codes, and
 * assessment_requests.subject_code is a foreign key to subjects(code), so both codes need a row.
 * Additive only, and no alias of theirs may shadow the Urdu twins' aliases: class-vocabulary
 * resolves a teacher's typed subject by alias, and "General Knowledge" must keep meaning one row.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const FILE = 'V1.9.5__gk_sst_en_subjects.sql';
const code = fs.readFileSync(path.join(DIR, FILE), 'utf8').replace(/--.*$/gm, '');
const rows = [...code.matchAll(/^\s*\('([a-z_]+)',\s*'([a-z_]+)',\s*ARRAY\[([^\]]*)\]/gm)]
  .map((m) => ({ code: m[1], parent: m[2], aliases: [...m[3].matchAll(/'([^']*)'/g)].map((a) => a[1]) }));
const earlier = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql') && f !== FILE)
  .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');

it('is additive: one INSERT ... ON CONFLICT DO NOTHING, nothing else', () => {
  expect(code).not.toMatch(/\b(UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  expect((code.match(/INSERT INTO subjects/g) || []).length).toBe(1);
  expect((code.match(/ON CONFLICT \(code\) DO NOTHING;/g) || []).length).toBe(1);
});

it('seeds both English codes under their Urdu twins', () => {
  expect(rows.map((r) => [r.code, r.parent])).toEqual([
    ['general_knowledge_en', 'general_knowledge'],
    ['social_studies_en', 'social_studies'],
  ]);
});

it('no alias shadows an alias an earlier migration already seeds', () => {
  for (const a of rows.flatMap((r) => r.aliases)) {
    expect(earlier).not.toMatch(new RegExp(`'${a.replace(/[()]/g, '\\$&')}'`));
  }
});

it('owns its version number', () => {
  expect(fs.readdirSync(DIR).filter((f) => /^V1\.9\.5__/.test(f))).toEqual([FILE]);
});
