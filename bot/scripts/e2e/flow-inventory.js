#!/usr/bin/env node
/**
 * flow-inventory — pick the Flow ids, store their published JSON, know what is in them.
 *
 * Step 0 of the Flow emulator for the E2E mock lane. Meta is the source of truth for a Flow's
 * definition: only ONE of the deployment's Flows lives in this repo (infrastructure/flows/), the
 * rest exist solely as published assets behind a flow id. This script fetches each published
 * FLOW_JSON by id, stores it under .claude/qa/fixtures/flows/<envVar>.json, and writes a manifest
 * recording provenance (id, name, status, version, sha, fetched-at) and DRIFT against any repo copy.
 * It also rolls every Flow up into one component/action census, which is what sizes the emulator.
 *
 * Pure functions (summarize · manifestEntry · inventory) are unit-tested; the fetch is I/O.
 *
 *   node bot/scripts/e2e/flow-inventory.js fetch --out .claude/qa/fixtures/flows [--only REGISTRATION_FLOW_ID,…]
 *     reads every *_FLOW_ID from the environment, needs WHATSAPP_TOKEN (read access to the WABA).
 *     The token is used for the calls and never written anywhere.
 *   node bot/scripts/e2e/flow-inventory.js report --out .claude/qa/fixtures/flows
 *     prints the census from the stored files, no network.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

/** Deterministic JSON: sorted keys at every depth, so two fetches of the same Flow hash the same. */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Walk a screen's component tree, collecting component types and on-click actions. */
function walk(node, out) {
  const list = Array.isArray(node) ? node : [node];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    if (c.type) out.components.add(c.type);
    for (const key of ['on-click-action', 'on-select-action', 'on-unselect-action']) {
      const a = c[key];
      if (a && a.name) out.actions.add(a.name);
    }
    if (c.children) walk(c.children, out);
    // conditionals (If / Switch) carry branches as arrays of components
    if (c.then) walk(c.then, out);
    if (c.else) walk(c.else, out);
    if (c.cases && typeof c.cases === 'object') for (const v of Object.values(c.cases)) walk(v, out);
  }
  return out;
}

/** What the emulator needs to know about one Flow JSON. */
function summarize(json) {
  const screens = Array.isArray(json.screens) ? json.screens : [];
  const acc = { components: new Set(), actions: new Set() };
  for (const s of screens) if (s && s.layout) walk(s.layout.children || [], acc);
  const ids = screens.map((s) => s.id);
  const routing = json.routing_model || {};
  const problems = [];
  for (const [from, tos] of Object.entries(routing)) {
    if (!ids.includes(from)) problems.push(`routing_model: ${from} is not a screen`);
    for (const to of tos || []) if (!ids.includes(to)) problems.push(`routing_model: ${from} → ${to} is not a screen`);
  }
  const actions = [...acc.actions].sort();
  // A Flow that ever exchanges data with the server is an endpoint Flow; otherwise the phone owns
  // the whole form and the bot only ever sees the final reply (navigate).
  const kind = actions.includes('data_exchange') || json.data_api_version ? 'endpoint' : 'navigate';
  return {
    version: json.version != null ? String(json.version) : null,
    data_api_version: json.data_api_version != null ? String(json.data_api_version) : null,
    kind,
    screens: ids,
    terminal: screens.filter((s) => s.terminal === true).map((s) => s.id),
    routing,
    components: [...acc.components].sort(),
    actions,
    problems,
  };
}

/** One manifest row: provenance + drift against the repo copy (by stable sha). */
function manifestEntry({ envVar, flowId, meta = {}, json, repoJson = null, fetchedAt }) {
  const s = summarize(json);
  const sha = sha256(stable(json));
  let repoCopy = 'none';
  if (repoJson) repoCopy = sha256(stable(repoJson)) === sha ? 'same' : 'differs';
  return {
    envVar, flowId, name: meta.name || null, status: meta.status || null,
    version: s.version || (meta.json_version != null ? String(meta.json_version) : null),
    data_api_version: s.data_api_version, kind: s.kind,
    screens: s.screens.length, terminal: s.terminal, components: s.components, actions: s.actions,
    problems: s.problems, validation_errors: Array.isArray(meta.validation_errors) ? meta.validation_errors.length : null,
    sha256: sha, fetchedAt, repoCopy,
  };
}

/** Cross-Flow census: which Flows use which component types / actions, and their kinds. */
function inventory(entries) {
  const components = {}, actions = {}, kinds = {};
  for (const e of entries) {
    const s = summarize(e.json);
    for (const c of s.components) (components[c] = components[c] || []).push(e.envVar);
    for (const a of s.actions) (actions[a] = actions[a] || []).push(e.envVar);
    (kinds[s.kind] = kinds[s.kind] || []).push(e.envVar);
  }
  return { components, actions, kinds };
}

// ── I/O ──────────────────────────────────────────────────────────────────────
async function get(url, token) {
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${url.replace(/access_token=[^&]+/, 'access_token=…')} → ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}
async function fetchFlow(flowId, token) {
  const meta = await get(`https://graph.facebook.com/${GRAPH_VERSION}/${flowId}?fields=name,status,json_version,data_api_version,categories,validation_errors`, token);
  const assets = await get(`https://graph.facebook.com/${GRAPH_VERSION}/${flowId}/assets`, token);
  const asset = (assets.data || []).find((a) => a.asset_type === 'FLOW_JSON');
  if (!asset || !asset.download_url) return { meta, json: null };
  const res = await fetch(asset.download_url);   // pre-signed; no bearer (Meta rejects some signed URLs that carry one)
  if (!res.ok) throw new Error(`asset download for ${flowId} → ${res.status}`);
  return { meta, json: await res.json() };
}

/** The repo's own copy, if there is one: infrastructure/flows/<name>.json by a loose name match. */
function repoCopyFor(envVar, repoRoot) {
  const dir = path.join(repoRoot, 'infrastructure', 'flows');
  if (!fs.existsSync(dir)) return null;
  const stem = envVar.replace(/_FLOW_ID$/, '').toLowerCase().replace(/_/g, '-');
  const hit = fs.readdirSync(dir).find((f) => f.endsWith('.json') && f.replace(/\.json$/, '').toLowerCase().replace(/_/g, '-') === stem);
  return hit ? JSON.parse(fs.readFileSync(path.join(dir, hit), 'utf8')) : null;
}

function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }

async function cmdFetch(outDir) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) { console.error('WHATSAPP_TOKEN is required (read access to the WABA). It is used for the calls and never stored.'); return 2; }
  const only = (arg('only') || '').split(',').filter(Boolean);
  const vars = Object.keys(process.env).filter((k) => /_FLOW_ID$/.test(k) && process.env[k]).filter((k) => !only.length || only.includes(k)).sort();
  if (!vars.length) { console.error('no *_FLOW_ID variables in the environment'); return 2; }
  fs.mkdirSync(outDir, { recursive: true });
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const entries = [], failures = [];
  for (const envVar of vars) {
    const flowId = process.env[envVar];
    try {
      const { meta, json } = await fetchFlow(flowId, token);
      if (!json) { failures.push({ envVar, flowId, error: 'no FLOW_JSON asset (draft with no upload?)', status: meta.status }); continue; }
      fs.writeFileSync(path.join(outDir, envVar + '.json'), JSON.stringify(json, null, 2) + '\n');
      const e = manifestEntry({ envVar, flowId, meta, json, repoJson: repoCopyFor(envVar, repoRoot), fetchedAt: new Date().toISOString() });
      entries.push({ ...e, json });
      console.log(`  ${e.status || '?'}  ${envVar}  ${e.kind}  v${e.version}  ${e.screens} screens  [${e.components.join(', ')}]  repo:${e.repoCopy}${e.problems.length ? '  PROBLEMS:' + e.problems.length : ''}`);
    } catch (err) { failures.push({ envVar, flowId, error: err.message.slice(0, 200) }); console.log(`  FAILED ${envVar}: ${err.message.slice(0, 120)}`); }
  }
  const manifest = {
    fetchedAt: new Date().toISOString(), graphVersion: GRAPH_VERSION, source: 'published FLOW_JSON assets, by flow id, from the staging WABA',
    flows: entries.map(({ json, ...e }) => e), failures, census: inventory(entries),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${entries.length} stored, ${failures.length} failed → ${path.relative(process.cwd(), outDir)}/manifest.json`);
  return failures.length ? 1 : 0;
}

function cmdReport(outDir) {
  const m = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  console.log(`${m.flows.length} Flows fetched ${m.fetchedAt}`);
  console.log('\nkinds:'); for (const [k, v] of Object.entries(m.census.kinds)) console.log(`  ${k}: ${v.length}  ${v.join(', ')}`);
  console.log('\ncomponents (Flows using each):'); for (const [c, v] of Object.entries(m.census.components).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(v.length).padStart(2)}  ${c}`);
  console.log('\nactions:'); for (const [a, v] of Object.entries(m.census.actions)) console.log(`  ${String(v.length).padStart(2)}  ${a}`);
  const drift = m.flows.filter((f) => f.repoCopy === 'differs'); const probs = m.flows.filter((f) => f.problems.length);
  console.log(`\nrepo drift: ${drift.map((f) => f.envVar).join(', ') || 'none'}`);
  console.log(`routing problems: ${probs.map((f) => f.envVar + ' (' + f.problems.length + ')').join(', ') || 'none'}`);
  return 0;
}

module.exports = { summarize, manifestEntry, inventory, stable, walk };

if (require.main === module) {
  const cmd = process.argv[2];
  const out = path.resolve(arg('out', '.claude/qa/fixtures/flows'));
  (cmd === 'fetch' ? cmdFetch(out) : cmd === 'report' ? Promise.resolve(cmdReport(out)) : Promise.resolve((console.error('usage: flow-inventory.js fetch|report --out <dir>'), 2)))
    .then((rc) => process.exit(rc)).catch((e) => { console.error(e.message); process.exit(1); });
}
