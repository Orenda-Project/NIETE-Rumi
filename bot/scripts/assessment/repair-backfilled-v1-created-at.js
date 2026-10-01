#!/usr/bin/env node
'use strict';
/**
 * Repair the families the FIRST paper-versions backfill wrote (bd-5ioto.11).
 *
 *   node bot/scripts/assessment/repair-backfilled-v1-created-at.js              # dry run (default)
 *   node bot/scripts/assessment/repair-backfilled-v1-created-at.js --yes --expect-ref <supabase-ref> \
 *        [--manifest <path.json>]
 *
 * That backfill inserted each v1 with the SAME created_at as the edited paper P
 * it split off. The portal's family list then broke the tie by id, and about
 * half the families showed v1 (the untrimmed original) instead of her edit.
 *
 * A backfilled v1 is recognised exactly, not guessed: a row P with edited_from
 * set whose parent's id is UUIDv5(P.id) in the backfill namespace — a WhatsApp
 * version's parent is a random id, never that. For each such pair where
 * v1.created_at is not strictly before P.created_at, v1.created_at becomes
 * P.created_at − 1s (what the fixed backfill writes). The update is guarded on
 * the old value, a re-run finds nothing, and the manifest keeps before/after
 * for every row so the change can be undone.
 */

const fs = require('fs');
const path = require('path');

const { v1IdFor, v1CreatedAt, refOf } = require('./backfill-paper-versions');

const PAGE = 200;
const IN_CHUNK = 100;

function parseArgs(argv) {
  const a = { yes: false, manifest: null, expectRef: null };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const x = argv[i];
    if (x === '--yes') a.yes = true;
    else if (x === '--manifest') { a.manifest = argv[i + 1]; i += 1; }
    else if (x === '--expect-ref') { a.expectRef = argv[i + 1]; i += 1; }
  }
  return a;
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function run(argv, injected = {}) {
  const d = injected.supabase
    ? { log: () => {}, env: {}, ...injected }
    : { supabase: require('../../shared/config/supabase'), log: (...m) => console.log(...m), env: process.env, ...injected };
  const { supabase, log } = d;
  const args = parseArgs(argv);
  const ref = refOf(d.env?.SUPABASE_URL);

  log(`[repair-v1-created-at] supabase ref: ${ref || '(unknown)'} · ${args.yes ? 'WRITE' : 'dry run'}`);
  if (args.yes) {
    if (!args.expectRef) throw new Error('--yes needs --expect-ref <supabase project ref>');
    if (args.expectRef !== ref) throw new Error(`refusing to write: SUPABASE_URL ref is ${ref}, --expect-ref is ${args.expectRef}`);
  }

  const counts = { versions_scanned: 0, backfilled: 0, already_ordered: 0, needs_repair: 0, repaired: 0, skipped_changed: 0, errors: 0 };
  const manifest = { ref, startedAt: new Date().toISOString(), dryRun: !args.yes, rows: [], errors: [] };

  // Every version row whose parent id is the backfill's deterministic v1 id.
  const pairs = [];
  let last = null;
  for (;;) {
    let q = supabase.from('assessment_papers').select('id, edited_from, created_at').not('edited_from', 'is', null);
    if (last) q = q.gt('id', last);
    const page = await must(q.order('id').limit(PAGE), 'select versions');
    if (!page || !page.length) break;
    for (const c of page) {
      last = c.id;
      counts.versions_scanned += 1;
      if (c.edited_from === v1IdFor(c.id)) pairs.push(c);
    }
    if (page.length < PAGE) break;
  }

  const parents = new Map();
  for (let i = 0; i < pairs.length; i += IN_CHUNK) {
    const ids = pairs.slice(i, i + IN_CHUNK).map((c) => c.edited_from);
    const rows = await must(supabase.from('assessment_papers').select('id, edited_from, created_at').in('id', ids), 'select v1');
    (rows || []).forEach((r) => parents.set(r.id, r));
  }

  for (const child of pairs) {
    const v1 = parents.get(child.edited_from);
    if (!v1 || v1.edited_from != null) continue; // not a root: not ours to touch
    counts.backfilled += 1;
    if (Date.parse(v1.created_at) < Date.parse(child.created_at)) { counts.already_ordered += 1; continue; }
    counts.needs_repair += 1;
    const after = v1CreatedAt(child.created_at);
    const entry = { id: v1.id, child: child.id, before: v1.created_at, after };
    manifest.rows.push(entry);
    if (!args.yes) continue;
    try {
      const hit = await must(supabase.from('assessment_papers').update({ created_at: after })
        .eq('id', v1.id).eq('created_at', v1.created_at).select('id'), 'update v1');
      if (hit && hit.length) counts.repaired += 1;
      else { counts.skipped_changed += 1; entry.skipped = 'created_at changed since read'; }
    } catch (err) {
      counts.errors += 1;
      manifest.errors.push({ id: v1.id, error: err.message });
      log(`[repair-v1-created-at] ${v1.id} failed: ${err.message}`);
    }
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.counts = counts;
  if (args.manifest) {
    fs.mkdirSync(path.dirname(path.resolve(args.manifest)), { recursive: true });
    fs.writeFileSync(args.manifest, JSON.stringify(manifest, null, 2));
  }
  log(`[repair-v1-created-at] ${JSON.stringify(counts)}`);
  return { dryRun: !args.yes, counts, manifest };
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(process.argv.slice(2))
    .then(({ counts }) => process.exit(counts.errors ? 1 : 0))
    .catch((err) => { console.error(err.message); process.exit(2); });
}
