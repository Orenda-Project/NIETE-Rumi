/**
 * Shared reader for the bot migrations (bot/database/migrations/*.sql) and the schema mirror
 * (infrastructure/supabase/00_complete-schema.sql), used by two setup gates:
 *
 *   bot-migrations-order.test.js   the `-- requires: <file>.sql` headers: every target exists, no cycle,
 *                                  and a migration that uses a table another migration creates says so;
 *   bot-migrations-mirror.test.js  every table a migration creates has the same column names in the mirror.
 *
 * The apply order is the headers' topological order (ties by file name), so the list a release applies
 * after a deploy comes from the files, not from a hand-typed list:
 *
 *   node tests/setup/bot-migrations-lib.js order [file.sql ...]
 *
 * prints the given migrations (all of them when none is given) in apply order, each after what it requires.
 *
 * The SQL reading is deliberately small: comments removed, function bodies emptied, statements split on `;`.
 * It reads names only (tables, columns), never types or defaults.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'bot', 'database', 'migrations');
const SCHEMA = path.join(ROOT, 'infrastructure', 'supabase', '00_complete-schema.sql');

const ID = '(?:"?public"?\\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?';
const NOT_A_COLUMN = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i;

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // code units, not locale ('.' before '_')

/** A rollback undoes its migration; it is never applied in order and never read for the net effect. */
const isRollback = (file) => /_rollback\.sql$/i.test(file);

/** Every forward migration: [{ file, sql }], by file name. */
function readMigrations(dir = MIGRATIONS) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !isRollback(f))
    .sort(byName)
    .map((file) => ({ file, sql: fs.readFileSync(path.join(dir, file), 'utf8') }));
}

/**
 * The files a migration's `-- requires:` lines name: one or more per line, comma or space separated, before
 * any `(` note (`-- requires: a.sql (creates t; it needs b.sql)` names a.sql only).
 */
function requiresOf(sql) {
  const out = [];
  for (const m of String(sql).matchAll(/^--\s*requires:\s*(.+)$/gim)) {
    for (const f of m[1].split('(')[0].split(/[\s,]+/)) if (f) out.push(f.trim());
  }
  return out;
}

/** Comments removed; FUNCTION bodies emptied (code that runs later is not DDL that runs now). */
function strip(sql) {
  let s = String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  return s.replace(/\bAS\s+(\$[A-Za-z0-9_]*\$)[\s\S]*?\1/gi, 'AS $$$$ $$$$');
}

// A DO block's PL/pgSQL scaffolding, peeled so the DDL inside it is read as DDL (as schema-mirrors-migrations does).
const LEAD = /^(?:do\s+\$[a-z0-9_]*\$|begin|else|loop|declare\b[\s\S]*?\bbegin|(?:if|elsif)\b[\s\S]*?\bthen)\s+/i;

function statements(sql) {
  return strip(sql).split(';').map((st) => {
    let s = st.trim();
    for (let prev = null; prev !== s;) { prev = s; s = s.replace(LEAD, '').trim(); }
    const ex = s.match(/^execute\s+'((?:[^']|'')*)'\s*$/i);
    return ex ? ex[1].replace(/''/g, "'").trim() : s;
  }).filter(Boolean);
}

/** Top-level comma split (parentheses nest). */
function clauses(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

/** The text inside the first balanced ( … ) that starts at or after `from`. */
function parenBody(text, from) {
  const open = text.indexOf('(', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null;
}

/** Column names declared in a CREATE TABLE body (constraints skipped). */
function bodyColumns(body) {
  const cols = [];
  for (const c of clauses(body)) {
    if (NOT_A_COLUMN.test(c)) continue;
    const m = c.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s/) || c.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?$/);
    if (m) cols.push(m[1].toLowerCase());
  }
  return cols;
}

const CREATE = new RegExp(`^create\\s+(?:unlogged\\s+|temp(?:orary)?\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${ID}`, 'i');
const DROP = new RegExp(`^drop\\s+table\\s+(?:if\\s+exists\\s+)?${ID}`, 'i');
const ALTER = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${ID}\\s+([\\s\\S]*)$`, 'i');

/**
 * Apply statements to a { table: Set(columns) } map: CREATE TABLE (with its body), DROP TABLE,
 * ALTER TABLE … ADD / DROP / RENAME COLUMN. A CREATE of a table already there (IF NOT EXISTS) keeps it.
 * Returns the tables this text created.
 */
function apply(tables, sql) {
  const created = [];
  for (const st of statements(sql)) {
    let m = st.match(CREATE);
    if (m) {
      if (/\bas\s+select\b/i.test(st) || /^create\s+temp/i.test(st)) continue;
      const t = m[1].toLowerCase();
      const body = parenBody(st, m[0].length);
      if (!tables.has(t)) tables.set(t, new Set(body ? bodyColumns(body) : []));
      created.push(t);
      continue;
    }
    m = st.match(DROP);
    if (m) { tables.delete(m[1].toLowerCase()); continue; }
    m = st.match(ALTER);
    if (m) {
      const t = m[1].toLowerCase();
      const cols = tables.get(t);
      if (!cols) continue;
      for (const c of clauses(m[2])) {
        let cm = c.match(new RegExp(`^add\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?${ID}`, 'i'));
        if (cm && !NOT_A_COLUMN.test(c.replace(/^add\s+/i, ''))) { cols.add(cm[1].toLowerCase()); continue; }
        cm = c.match(new RegExp(`^drop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?${ID}`, 'i'));
        if (cm && !/^drop\s+constraint\b/i.test(c)) { cols.delete(cm[1].toLowerCase()); continue; }
        cm = c.match(new RegExp(`^rename\\s+(?:column\\s+)?${ID}\\s+to\\s+${ID}`, 'i'));
        if (cm && !/^rename\s+(constraint|to)\b/i.test(c)) { cols.delete(cm[1].toLowerCase()); cols.add(cm[2].toLowerCase()); }
      }
    }
  }
  return created;
}

/** Tables a migration reads or changes without creating: ALTER TABLE, CREATE INDEX ON, REFERENCES, CREATE POLICY/TRIGGER ON. */
function usedTables(sql) {
  const used = new Set();
  const created = new Set();
  for (const st of statements(sql)) {
    let m = st.match(CREATE);
    if (m) created.add(m[1].toLowerCase());
    m = st.match(ALTER);
    if (m) used.add(m[1].toLowerCase());
    for (const r of st.matchAll(new RegExp(`\\breferences\\s+${ID}`, 'gi'))) used.add(r[1].toLowerCase());
    m = st.match(new RegExp(`^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(?:${ID}\\s+)?on\\s+(?:only\\s+)?${ID}`, 'i'));
    if (m) used.add(m[2].toLowerCase());
    m = st.match(new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:policy|trigger)\\s+[\\s\\S]*?\\bon\\s+${ID}`, 'i'));
    if (m) used.add(m[1].toLowerCase());
  }
  for (const t of created) used.delete(t);
  return used;
}

/** table -> the first file (by name) that creates it. */
function creators(migrations) {
  const out = new Map();
  for (const m of [...migrations].sort((a, b) => byName(a.file, b.file))) {
    for (const t of apply(new Map(), m.sql)) if (!out.has(t)) out.set(t, m.file);
  }
  return out;
}

/**
 * The apply order: each file after every file it requires (ties by name). Throws on a missing target
 * or a cycle, naming it. `migrations` is [{ file, sql }]. With `{ inferred: true }` a file also comes after
 * the creator of every table it uses (what the net effect needs while old files lack their headers).
 */
function applyOrder(migrations, { inferred = false } = {}) {
  const byFile = new Map(migrations.map((m) => [m.file, m]));
  const made = inferred ? creators(migrations) : null;
  const deps = (m) => {
    const d = [...requiresOf(m.sql)];
    if (made) for (const t of usedTables(m.sql)) { const c = made.get(t); if (c && c !== m.file) d.push(c); }
    return d;
  };
  const out = [];
  const state = new Map();   // file -> 'visiting' | 'done'
  const visit = (file, trail) => {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'visiting') throw new Error(`requires cycle: ${[...trail, file].join(' -> ')}`);
    const m = byFile.get(file);
    if (!m) throw new Error(`requires a missing migration: ${trail[trail.length - 1]} -> ${file}`);
    state.set(file, 'visiting');
    for (const r of deps(m)) visit(r, [...trail, file]);
    state.set(file, 'done');
    out.push(file);
  };
  for (const m of [...migrations].sort((a, b) => byName(a.file, b.file))) visit(m.file, []);
  return out;
}

/** Every file a migration requires, directly or through another. */
function requiredClosure(migrations, file) {
  const byFile = new Map(migrations.map((m) => [m.file, m]));
  const seen = new Set();
  const stack = [...requiresOf((byFile.get(file) || {}).sql || '')];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...requiresOf((byFile.get(f) || {}).sql || ''));
  }
  return seen;
}

/** The net { table: Set(columns) } the migrations leave, applied in `-- requires:` order; and who created each table. */
function netTables(migrations) {
  const order = applyOrder(migrations, { inferred: true });
  const byFile = new Map(migrations.map((m) => [m.file, m]));
  const tables = new Map();
  const createdBy = new Map();
  for (const f of order) {
    for (const t of apply(tables, byFile.get(f).sql)) if (!createdBy.has(t)) createdBy.set(t, f);
  }
  for (const t of [...createdBy.keys()]) if (!tables.has(t)) createdBy.delete(t);
  return { tables, createdBy };
}

/**
 * A migration that uses a table another migration creates, without requiring that migration (directly or
 * through another): [{ file, table, creator }].
 */
function undeclaredUses(migrations) {
  const createdBy = creators(migrations);
  const out = [];
  for (const m of migrations) {
    const closure = requiredClosure(migrations, m.file);
    for (const t of usedTables(m.sql)) {
      const creator = createdBy.get(t);
      if (creator && creator !== m.file && !closure.has(creator)) out.push({ file: m.file, table: t, creator });
    }
  }
  return out;
}

/** The mirror's columns for `table` (its CREATE TABLE body plus any ALTER TABLE … ADD COLUMN), or null without a CREATE TABLE. */
function mirrorColumns(schema, table) {
  const tables = new Map();
  apply(tables, schema);
  return tables.has(table) ? tables.get(table) : null;
}

/** Per table the migrations create: the names only one side has. [{ table, creator, onlyMigration, onlyMirror, mirror: bool }] */
function mirrorDrift(migrations, schemaText) {
  const { tables, createdBy } = netTables(migrations);
  const mirror = new Map();
  apply(mirror, schemaText);
  const out = [];
  for (const [t, cols] of tables) {
    const m = mirror.get(t);
    if (!m) { out.push({ table: t, creator: createdBy.get(t), mirror: false, onlyMigration: [...cols].sort(), onlyMirror: [] }); continue; }
    const onlyMigration = [...cols].filter((c) => !m.has(c)).sort();
    const onlyMirror = [...m].filter((c) => !cols.has(c)).sort();
    if (onlyMigration.length || onlyMirror.length) out.push({ table: t, creator: createdBy.get(t), mirror: true, onlyMigration, onlyMirror });
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

module.exports = {
  MIGRATIONS, SCHEMA, readMigrations, requiresOf, applyOrder, requiredClosure, netTables, usedTables,
  undeclaredUses, mirrorColumns, mirrorDrift, apply, bodyColumns, isRollback, creators,
};

if (require.main === module) {
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd !== 'order') {
    process.stderr.write('usage: node tests/setup/bot-migrations-lib.js order [file.sql ...]\n');
    process.exit(2);
  }
  const all = readMigrations();
  const order = applyOrder(all);
  const want = files.length ? new Set(files.map((f) => path.basename(f))) : null;
  if (want) for (const f of want) if (!all.some((m) => m.file === f)) { process.stderr.write(`not a forward migration: ${f}\n`); process.exit(1); }
  for (const f of order) if (!want || want.has(f)) process.stdout.write(`${f}\n`);
}
