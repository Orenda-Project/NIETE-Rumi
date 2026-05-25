/**
 * Table-Usage Conformance (Phase 6)
 *
 * The inverse of schema-completeness: every CREATE TABLE in the consolidated
 * schema must be referenced somewhere in the codebase (bot / dashboard /
 * infrastructure — by name, in .js or .sql), otherwise it is an orphan table
 * that bloats the schema and confuses cloners.
 *
 * This is the "dead-table" guard. Tables that are intentionally defined but not
 * yet wired (reserved for a feature whose ingestion/code isn't in the OSS tree)
 * go in ALLOWLIST with a reason — a deliberate, reviewed decision.
 *
 * Note: 36 of the 37 tables not referenced via bot/ `.from()` ARE referenced
 * elsewhere (dashboard code, SQL, RPC bodies, seed) — so this guard scans the
 * whole repo, not just bot/.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA_PATH = path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql');

// Tables intentionally defined but not yet referenced by code — each justified.
const ALLOWLIST = new Set([
  // Curriculum page-level capture table; part of the textbooks / textbook_toc /
  // pre_generated_lps set. Populated by a curriculum-ingestion path not yet in
  // the OSS tree (the OSS curriculum-LP path serves pre_generated_lps + toc).
  'textbook_pages',
]);

function collectFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(e.name)) continue;
      out.push(...collectFiles(p, exts));
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

function extractCreateTables(sql) {
  const set = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) set.add(m[1].toLowerCase());
  return set;
}

describe('Table-Usage Conformance', () => {
  it('every schema table is referenced somewhere in the codebase (or allowlisted)', () => {
    const schemaSQL = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    const tables = extractCreateTables(schemaSQL);

    // All non-schema source across the repo (exclude the schema file itself + tests).
    const files = [
      ...collectFiles(path.join(ROOT, 'bot'), ['.js']),
      ...collectFiles(path.join(ROOT, 'dashboard'), ['.js', '.ts', '.tsx']),
      ...collectFiles(path.join(ROOT, 'infrastructure'), ['.js', '.sql']),
    ].filter((f) => f !== SCHEMA_PATH && !/(^|\/)(tests?|__tests__)\//.test(f) && !/\.test\.js$/.test(f));

    const haystack = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');

    const orphans = [];
    for (const t of tables) {
      if (ALLOWLIST.has(t)) continue;
      const re = new RegExp(`\\b${t}\\b`);
      if (!re.test(haystack)) orphans.push(t);
    }
    orphans.sort();

    expect(orphans).toEqual([]);
  });

  it('allowlisted tables are still defined in the schema (no stale allowlist entries)', () => {
    const tables = extractCreateTables(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    for (const t of ALLOWLIST) {
      expect(tables.has(t)).toBe(true);
    }
  });
});
