#!/usr/bin/env node
/* seed-rows-used.js — which reference-data ROWS did the tests actually read? (bd-z3ze4.6)
 *
 *   node bot/scripts/e2e/seed-rows-used.js <db.env of a run on the FULL seed> <queries.log>... [--json out.json]
 *
 * Every mock-lane run logs its full PostgREST requests (<run_dir>/db/queries.log). This replays each READ of a
 * reference table (supabase/baseline/seed-tables.txt) against a database holding the full snapshot and records
 * the primary key of every row that comes back — including rows of related tables a query embeds
 * (`select=vendor:training_vendors(...)`). The result is the minimal set of rows a small committed seed needs.
 *
 * Read-only: GETs only, against a local run database. Writes nothing but the report.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args.splice(args.indexOf('--json'), 2)[1] : null;
const [envFile, ...logs] = args;
if (!envFile || !logs.length) { console.error('usage: seed-rows-used.js <db.env> <queries.log>... [--json out.json]'); process.exit(2); }
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
const URL0 = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^http:\/\/127\.0\.0\.1:/.test(URL0 || '')) { console.error('refusing: not a local run database'); process.exit(2); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const REPO = path.resolve(__dirname, '../../..');
const TABLES = new Set(fs.readFileSync(path.join(REPO, 'supabase/baseline/seed-tables.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));

/** select=a,b,alias:table(x,y),table2(*)  →  { top: '*', embeds: [{alias, table}] } */
function parseSelect(sel) {
  const embeds = []; let depth = 0, cur = '', parts = [];
  for (const ch of sel || '*') {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const p of parts) {
    const m = p.match(/^(?:([a-zA-Z_0-9]+):)?([a-zA-Z_0-9]+)(?:![a-zA-Z_0-9]+)?\(/);
    if (m) embeds.push({ alias: m[1] || m[2], table: m[2] });
  }
  return embeds;
}

(async () => {
  // primary keys, from the OpenAPI description PostgREST serves
  const spec = await (await fetch(`${URL0}/rest/v1/`, { headers: H })).json();
  const pkOf = {};
  for (const [t, def] of Object.entries(spec.definitions || {})) {
    pkOf[t] = Object.entries(def.properties || {}).filter(([, p]) => /<pk\/>/.test(p.description || '')).map(([c]) => c);
  }
  const used = {}; const add = (t, row) => {
    if (!TABLES.has(t) || !row || typeof row !== 'object') return;
    const pk = pkOf[t] && pkOf[t].length ? pkOf[t] : null;
    const id = pk ? JSON.stringify(pk.map((c) => row[c])) : JSON.stringify(row);
    (used[t] = used[t] || new Set()).add(id);
  };
  const reads = new Set();
  for (const f of logs) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^(GET|HEAD) ([a-z_0-9]+)\?(.*)$/) || line.match(/^(GET|HEAD) ([a-z_0-9]+)()$/);
    if (m && TABLES.has(m[2])) reads.add(`${m[2]}?${m[3]}`);
  }
  let failed = 0;
  for (const q of reads) {
    const [table, qs] = [q.slice(0, q.indexOf('?')), q.slice(q.indexOf('?') + 1)];
    const params = new URLSearchParams(qs);
    const embeds = parseSelect(params.get('select'));
    // every column of the top table + every column of each embed, so the primary keys come back
    params.set('select', ['*', ...embeds.map((e) => `${e.alias}:${e.table}(*)`)].join(','));
    const r = await fetch(`${URL0}/rest/v1/${table}?${params.toString()}`, { headers: H });
    if (!r.ok) { failed++; continue; }
    let rows = await r.json(); if (!Array.isArray(rows)) rows = [rows];
    for (const row of rows) {
      add(table, row);
      for (const e of embeds) { const v = row[e.alias]; (Array.isArray(v) ? v : [v]).forEach((x) => add(e.table, x)); }
    }
  }
  const out = Object.fromEntries([...TABLES].sort().map((t) => [t, used[t] ? [...used[t]].map((s) => JSON.parse(s)) : []]));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ reads: reads.size, failed, pk: pkOf, rows: out }, null, 1));
  console.log(`distinct reads replayed: ${reads.size} (failed ${failed})`);
  for (const [t, ids] of Object.entries(out)) console.log(`  ${t.padEnd(26)} ${String(ids.length).padStart(5)} rows`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
