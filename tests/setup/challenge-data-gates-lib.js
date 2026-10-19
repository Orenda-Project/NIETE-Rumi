/**
 * Static gates over the Challenge data and the bot migrations (pure functions; the tests pass in the texts):
 *   - countedReaders: a reader that keys on the old `meta.counted` stamp (a row is counted by `mode` and `record`);
 *   - transactionControl: a migration's top-level BEGIN; / COMMIT; (a stack tool applies files in its own transaction);
 *   - seedTitles / passageTitles: the stock seed's INSERT titles and the passage files' titles;
 *   - periodIds: the challenge_periods ids the migrations insert.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(REPO, 'bot', 'database', 'migrations');
const PASSAGES = path.join(REPO, 'bot', 'shared', 'data', 'child-test', 'passages');
const STOCK_SEED = path.join(MIGRATIONS, 'web_quiz_challenge_stock_seed.sql');

// ── a reader of meta.counted ────────────────────────────────────────────────────────────────────────

const READERS = [
  /\bmeta\s*->>?\s*'?counted\b/g,                                         // SQL / PostgREST: meta->>'counted', 'meta->>counted'
  /\bmeta\s*\[\s*['"`]counted['"`]\s*\]/g,                               // meta['counted']
  /\bmeta\b[^;\n]{0,40}?(?:\?\.|\.)\s*counted\b(?!\s*=(?!=))/g,          // meta.counted, (r.meta || {}).counted; not `meta.counted = x`
  /\.contains\(\s*['"`]meta['"`]\s*,\s*\{[^}]*\bcounted\b/g,               // .contains('meta', { counted: true })
];

/** The reads of the `counted` stamp in one source text: [{ line, text }]. Writes (`counted: true` in a literal) are not reads. */
function countedReaders(text) {
  const out = [];
  String(text).split('\n').forEach((l, i) => {
    if (READERS.some((rx) => { rx.lastIndex = 0; return rx.test(l); })) out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}

const SOURCE = /\.(js|mjs|cjs|sql|py)$/;
const isTestPath = (rel) => /(^|\/)(tests?|__tests__|__mocks__)\//.test(rel) || /\.(test|spec)\.[a-z]+$/.test(rel);

/** Non-test source files under bot/ and dashboard/ (repo-relative). */
function productSources(roots = ['bot', 'dashboard']) {
  const out = [];
  const walk = (rel) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(REPO, rel), { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (!isTestPath(`${r}/`)) walk(r); } else if (e.isFile() && SOURCE.test(e.name) && !isTestPath(r)) out.push(r);
    }
  };
  roots.forEach(walk);
  return out.sort();
}

// ── SQL helpers ─────────────────────────────────────────────────────────────────────────────────────

/** Comments removed, string literals and dollar-quoted bodies emptied: what runs at the top level of a migration. */
function topLevel(sql) {
  const s = String(sql);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('--', i)) { while (i < s.length && s[i] !== '\n') i += 1; continue; }
    if (s.startsWith('/*', i)) { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; out += ' '; continue; }
    if (s[i] === "'") {
      i += 1;
      while (i < s.length) { if (s[i] === "'" && s[i + 1] === "'") i += 2; else if (s[i] === "'") { i += 1; break; } else i += 1; }
      out += "''";
      continue;
    }
    const tag = /^\$[A-Za-z0-9_]*\$/.exec(s.slice(i, i + 64));
    if (tag && !/[A-Za-z0-9_]/.test(s[i - 1] || '')) {
      const e = s.indexOf(tag[0], i + tag[0].length);
      i = e < 0 ? s.length : e + tag[0].length;
      out += "''";
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/** A migration's top-level transaction control statements, in order (e.g. ['BEGIN', 'COMMIT']). */
function transactionControl(sql) {
  const out = [];
  const rx = /(?:^|;)\s*(BEGIN(?:\s+(?:TRANSACTION|WORK))?|START\s+TRANSACTION|COMMIT(?:\s+(?:TRANSACTION|WORK))?|END(?:\s+(?:TRANSACTION|WORK))?|ROLLBACK(?:\s+(?:TRANSACTION|WORK))?)\s*(?=;)/gi;
  for (const m of topLevel(sql).matchAll(rx)) out.push(m[1].split(/\s+/)[0].toUpperCase().replace('START', 'BEGIN').replace('END', 'COMMIT'));
  return out;
}

/** One SQL value list `( … )` split into literals: strings unquoted, NULL as null, other tokens as text. */
function sqlValues(tuple) {
  const out = [];
  let i = 0;
  const s = tuple;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i += 1;
    if (i >= s.length) break;
    if (s[i] === "'") {
      let v = '';
      i += 1;
      for (;;) {
        if (i >= s.length) throw new Error('unterminated string');
        if (s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2; } else if (s[i] === "'") { i += 1; break; } else { v += s[i]; i += 1; }
      }
      while (i < s.length && s[i] !== ',') i += 1;   // a ::cast after the literal
      out.push(v);
    } else {
      let v = '';
      let depth = 0;
      while (i < s.length && (depth > 0 || s[i] !== ',')) { if (s[i] === '(') depth += 1; if (s[i] === ')') depth -= 1; v += s[i]; i += 1; }
      v = v.trim();
      out.push(/^null$/i.test(v) ? null : v);
    }
  }
  return out;
}

/** The value tuples after VALUES in one INSERT statement's text: [[…], …]. */
function tuplesOf(valuesText) {
  const out = [];
  let i = 0;
  const s = valuesText;
  while (i < s.length) {
    if (s[i] === "'") { i += 1; while (i < s.length && !(s[i] === "'" && s[i + 1] !== "'")) i += s[i] === "'" ? 2 : 1; i += 1; continue; }
    if (s[i] === '(') {
      let depth = 0;
      let j = i;
      for (; j < s.length; j += 1) {
        if (s[j] === "'") { j += 1; while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1; continue; }
        if (s[j] === '(') depth += 1;
        if (s[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out.push(sqlValues(s.slice(i + 1, j)));
      i = j + 1;
      continue;
    }
    if (/^ON\s+CONFLICT/i.test(s.slice(i)) || s[i] === ';') break;
    i += 1;
  }
  return out;
}

/** Every INSERT INTO <table> in a SQL text, as rows ({ column: value }). */
function insertRows(sql, table) {
  const rows = [];
  const rx = new RegExp(`INSERT\\s+INTO\\s+(?:public\\.)?${table}\\s*\\(([^)]*)\\)\\s*VALUES`, 'gi');
  for (const m of String(sql).matchAll(rx)) {
    const cols = m[1].split(',').map((c) => c.trim());
    for (const t of tuplesOf(String(sql).slice(m.index + m[0].length))) rows.push(Object.fromEntries(cols.map((c, k) => [c, t[k] === undefined ? null : t[k]])));
  }
  return rows;
}

/** The stock seed's INSERT titles: { passage_id: { title_en, title_ur } }. */
function seedTitles(sql) {
  const out = {};
  for (const r of insertRows(sql, 'challenge_passages')) out[r.passage_id] = { title_en: r.title_en, title_ur: r.title_ur };
  return out;
}

/** The passage files' titles: { passage_id: { title_en, title_ur } } (absent or empty → null). */
function passageTitles(dir = PASSAGES) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out[p.passage_id] = { title_en: p.title_en || null, title_ur: p.title_ur || null };
  }
  return out;
}

/** Each seeded passage whose INSERT title differs from its file's: ['<id> title_en: seed "…" ≠ file "…"']. */
function titleMismatches(seed, files) {
  const out = [];
  for (const id of Object.keys(seed).sort()) {
    const f = files[id];
    if (!f) { out.push(`${id}: in the seed, no passage file`); continue; }
    for (const col of ['title_en', 'title_ur']) {
      if ((seed[id][col] || null) !== (f[col] || null)) out.push(`${id} ${col}: seed ${JSON.stringify(seed[id][col])} != file ${JSON.stringify(f[col])}`);
    }
  }
  return out;
}

/** The challenge_periods ids every migration inserts: [{ file, period_id }]. */
function periodIds(dir = MIGRATIONS) {
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const r of insertRows(fs.readFileSync(path.join(dir, file), 'utf8'), 'challenge_periods')) out.push({ file, period_id: r.period_id });
  }
  return out;
}

module.exports = {
  REPO, MIGRATIONS, PASSAGES, STOCK_SEED, countedReaders, productSources, isTestPath, topLevel, transactionControl,
  sqlValues, insertRows, seedTitles, passageTitles, titleMismatches, periodIds,
};
