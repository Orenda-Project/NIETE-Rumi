#!/usr/bin/env node
/**
 * Point staging's training videos at the same R2 objects production uses.
 *
 * WHY THIS IS A COPY AND NOT A RE-UPLOAD
 * --------------------------------------
 * The video re-host already moved every legacy asset to R2, and both
 * environments share ONE R2 bucket. Staging therefore needs no bytes
 * transferred at all — only the URLs in its own database, which still point at
 * the decaying third-party bucket and still serve `binary/octet-stream`.
 * Without this, a tester on staging reproduces the original download bug and
 * reasonably concludes the fix failed.
 *
 * SAFETY
 *  - Dry-run by default; --apply to write. Only ever writes to STAGING.
 *  - Asserts both refs (prod source, staging target) before connecting.
 *  - Verifies the two databases agree on what each module IS (id + title +
 *    source_module_id) before copying anything; a mismatch would attach the
 *    wrong video to the wrong module, so it aborts rather than guess.
 *  - Copies only rows where production is already on a controlled host.
 *  - Snapshots every staging row it is about to change.
 *  - Idempotent: rows already pointing at R2 are skipped.
 */

const path = require('path');
const fs = require('fs');
const fromBot = (mod) => require(path.join(__dirname, '..', 'bot', 'node_modules', mod));
const dotenv = fromBot('dotenv');
const { createClient } = fromBot('@supabase/supabase-js');
const { isControlledMediaHost } = require('../bot/shared/services/training/media-host');

const PROD_REF = 'ihzciabopbttygxxgrkm';
const STAGE_REF = 'rpqkekcfvumypldbejhp';
const APPLY = process.argv.includes('--apply');

function loadEnv(file) {
  const env = {};
  dotenv.config({ path: path.join(__dirname, '..', file), processEnv: env, quiet: true });
  return env;
}

function refOf(url) {
  const m = String(url || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

(async () => {
  const P = loadEnv('.env');
  const S = loadEnv('.env.stage');
  if (refOf(P.SUPABASE_URL) !== PROD_REF) throw new Error(`.env is not production (${refOf(P.SUPABASE_URL)})`);
  if (refOf(S.SUPABASE_URL) !== STAGE_REF) throw new Error(`.env.stage is not staging (${refOf(S.SUPABASE_URL)})`);

  const prod = createClient(P.SUPABASE_URL, P.SUPABASE_SERVICE_ROLE_KEY);
  const stage = createClient(S.SUPABASE_URL, S.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`\nsync re-hosted media URLs -> staging`);
  console.log(`  source : ${PROD_REF} (read-only)`);
  console.log(`  target : ${STAGE_REF}`);
  console.log(`  mode   : ${APPLY ? 'APPLY (writes staging)' : 'DRY RUN'}\n`);

  const sel = 'id,title,source_module_id,video_url,source_media_url,audio_url,is_active';
  const [{ data: pm, error: pe }, { data: sm, error: se }] = await Promise.all([
    prod.from('training_modules').select(sel).eq('is_active', true).limit(5000),
    stage.from('training_modules').select(sel).eq('is_active', true).limit(5000),
  ]);
  if (pe) throw new Error(`prod read failed: ${pe.message}`);
  if (se) throw new Error(`stage read failed: ${se.message}`);

  const byId = new Map(pm.map((m) => [m.id, m]));

  // Identity check — a same-id row must describe the same module in both DBs.
  const mismatched = sm
    .filter((m) => byId.has(m.id))
    .filter((m) => {
      const p = byId.get(m.id);
      return p.title !== m.title || p.source_module_id !== m.source_module_id;
    });
  if (mismatched.length) {
    throw new Error(
      `ABORT: ${mismatched.length} module(s) differ between prod and staging for the same id ` +
        `(e.g. ${mismatched[0].id}). Copying URLs by id would mis-attach media.`
    );
  }
  console.log(`  identity check: ${sm.filter((m) => byId.has(m.id)).length} modules agree across both DBs\n`);

  // Rows where staging is stale and production has a good, controlled URL.
  const work = [];
  for (const s of sm) {
    const p = byId.get(s.id);
    if (!p) continue;
    for (const col of ['video_url', 'source_media_url']) {
      const pv = p[col];
      const sv = s[col];
      if (!pv || !isControlledMediaHost(pv)) continue; // prod not fixed for this col
      if (sv === pv) continue; // already in sync
      if (sv && isControlledMediaHost(sv)) continue; // staging already on R2
      work.push({ id: s.id, title: s.title, col, from: sv, to: pv });
    }
  }

  console.log(`  ${work.length} column value(s) to sync\n`);
  if (!work.length) {
    console.log('  Nothing to do — staging already matches production.\n');
    return;
  }
  const byCol = work.reduce((a, w) => ((a[w.col] = (a[w.col] || 0) + 1), a), {});
  console.log(`  by column: ${JSON.stringify(byCol)}`);
  for (const w of work.slice(0, 8)) {
    console.log(`   id=${w.id} ${w.col} · ${String(w.title).slice(0, 44)}`);
  }
  if (work.length > 8) console.log(`   … and ${work.length - 8} more`);

  if (!APPLY) {
    console.log(`\n  Dry run — re-run with --apply to update staging.\n`);
    return;
  }

  const snap = path.join(__dirname, '..', 'docs', 'migration', 'bd-2671-stage-media-before.json');
  fs.writeFileSync(snap, JSON.stringify({ captured_at: new Date().toISOString(), changes: work }, null, 1));
  console.log(`\n  snapshot -> docs/migration/${path.basename(snap)}`);

  // Group per module so each row takes a single update.
  const perModule = new Map();
  for (const w of work) {
    if (!perModule.has(w.id)) perModule.set(w.id, {});
    perModule.get(w.id)[w.col] = w.to;
  }

  let ok = 0;
  const failed = [];
  for (const [id, patch] of perModule) {
    const { error } = await stage.from('training_modules').update(patch).eq('id', id);
    if (error) {
      failed.push({ id, reason: error.message });
      console.log(`  ❌ module ${id}: ${error.message}`);
    } else ok += 1;
  }

  console.log(`\n  modules updated: ${ok}/${perModule.size}`);
  if (failed.length) process.exitCode = 1;
  console.log('');
})().catch((e) => {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
});
