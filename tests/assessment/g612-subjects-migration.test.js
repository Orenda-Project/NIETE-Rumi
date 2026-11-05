'use strict';
/** V1.8.10: every code a G6-12 request can carry exists as an FK target, additively (subject-config.md §5). */
const fs = require('fs');
const path = require('path');

const SC = require('../../bot/shared/services/assessment/subject-config');

const DIR = path.join(__dirname, '../../infrastructure/supabase/migrations');
const SQL = fs.readFileSync(path.join(DIR, 'V1.8.10__g612_subjects.sql'), 'utf8');
const code = SQL.replace(/--.*$/gm, '');
const seeded = (table) => {
  const block = code.match(new RegExp(`INSERT INTO ${table} \\(([^)]*)\\) VALUES([\\s\\S]*?)ON CONFLICT \\(code\\) DO NOTHING;`));
  return block ? [...block[2].matchAll(/^\s*\('([a-z_0-9]+)'/gm)].map((m) => m[1]) : null;
};
const base = fs.readdirSync(DIR).filter((f) => f !== 'V1.8.10__g612_subjects.sql')
  .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');

it('is additive: only INSERT ... ON CONFLICT DO NOTHING, no UPDATE/DELETE/ALTER/DROP', () => {
  expect(code).not.toMatch(/\b(UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  expect((code.match(/INSERT INTO/g) || []).length).toBe(2);
  expect((code.match(/ON CONFLICT \(code\) DO NOTHING;/g) || []).length).toBe(2);
});

it('seeds every registry subject code no earlier migration seeds', () => {
  const codes = [...new Set(SC.rows().filter((r) => r.status === 'core').map((r) => r.code))];
  const earlier = codes.filter((c) => new RegExp(`\\('${c}',`).test(base));
  expect(earlier.sort()).toEqual(['english', 'islamiat', 'maths', 'urdu']);
  expect(seeded('subjects').sort()).toEqual(codes.filter((c) => !earlier.includes(c)).sort());
});

it('holds grade_6 .. grade_12, each also seeded by V1.1.3 with the same line', () => {
  const grades = seeded('grade_levels');
  expect(grades).toEqual([6, 7, 8, 9, 10, 11, 12].map((g) => `grade_${g}`));
  const v113 = fs.readFileSync(path.join(DIR, 'V1.1.3__classes_model.sql'), 'utf8');
  for (const line of code.split('\n').filter((l) => /^\s*\('grade_/.test(l))) {
    expect(v113).toContain(line.trim().replace(/\)$/, ')'));
  }
});

it('owns its version number: no other forward migration is V1.8.10', () => {
  const same = fs.readdirSync(DIR).filter((f) => /^V1\.8\.10__/.test(f));
  expect(same).toEqual(['V1.8.10__g612_subjects.sql']);
});
