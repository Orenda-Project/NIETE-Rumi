#!/usr/bin/env node
/**
 * bd-60092 · Backfill `users.name` from the previous FDE production database.
 *
 * 5,494 NIETE users have no name in any column. The FDE codebase that preceded
 * this one still holds the roster many of them came from, keyed on phone, so
 * their names can be recovered without asking anyone.
 *
 * Measured 2026-09-14 against both live databases:
 *   · 5,494 nameless NIETE users
 *   · 1,645 match a row in fde_production.users_user by phone
 *   · 1,596 of those rows carry a usable name  <- what this writes
 *   · 3,898 are not in FDE at all and must be collected from the teacher or
 *     her coach (the Edit Teacher screen / the missing-field Flow)
 *
 * Name case: 79% of the recovered names arrive ALL CAPS ("BAKAR SHAH"). The
 * operator chose title-case ON WRITE (2026-09-14), so they are normalised
 * through the same helper the bot renders with.
 *
 * SAFETY
 *   · DRY RUN BY DEFAULT. Pass --apply to write.
 *   · Asserts the Supabase project ref before opening a write path, because a
 *     worktree is seeded with the MAIN BOT's .env, which points at a different
 *     production database (the bd-2533 near-miss).
 *   · Never overwrites a non-empty name.
 *   · Skips FDE rows that are soft-deleted or flagged as test accounts.
 *
 * Usage:
 *   node scripts/backfill-names-from-fde.js                 # dry run, prints a sample
 *   node scripts/backfill-names-from-fde.js --apply         # writes
 *   node scripts/backfill-names-from-fde.js --limit 50      # cap the batch
 */

'use strict';

// A one-off operational script, not part of the deployed app — so it resolves
// its drivers from wherever the repo already installs them rather than adding
// a root runtime dependency. Same pattern as bot/scripts/migration/*.js.
const path = require('path');
function dep(name) {
  const roots = ['bot', 'dashboard', '.'];
  for (const r of roots) {
    try { return require(path.join(__dirname, '..', r, 'node_modules', name)); } catch (_) { /* next */ }
  }
  try { return require(name); } catch (_) {
    console.error(`Missing "${name}". Run: npm --prefix dashboard install`);
    process.exit(1);
  }
  return null;
}

dep('dotenv').config();
const { Client } = dep('pg');
const { createClient } = dep('@supabase/supabase-js');
const { titleCaseName } = require('../bot/shared/utils/person-name');

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();

/** The NIETE production project. Refuse to write anywhere else. */
const EXPECTED_REF = 'ihzciabopbttygxxgrkm';

/** Normalise to E.164 Pakistan. Both databases store phones inconsistently. */
function e164(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return null;
  let s = d;
  if (s.startsWith('0')) s = `92${s.slice(1)}`;
  else if (s.startsWith('3')) s = `92${s}`;
  return s.length >= 11 ? s.slice(0, 12) : null;
}

async function main() {
  const url = process.env.SUPABASE_URL || '';
  const ref = url.replace(/^https:\/\//, '').replace(/\.supabase\.co.*$/, '');
  if (ref !== EXPECTED_REF) {
    console.error(`REFUSING TO RUN: SUPABASE_URL points at "${ref}", expected "${EXPECTED_REF}".`);
    console.error('A worktree is seeded with the main bot\'s .env — copy NIETE-Rumi/.env in first.');
    process.exit(1);
  }

  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // ---- 1. every nameless NIETE user -------------------------------------
  const nameless = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('users').select('id, phone_number, name').range(from, from + 999);
    if (error) throw new Error(`supabase read: ${error.message}`);
    nameless.push(...(data || []).filter((u) => !String(u.name || '').trim()));
    if (!data || data.length < 1000) break;
  }
  const byPhone = new Map();
  for (const u of nameless) {
    const k = e164(u.phone_number);
    if (k && !byPhone.has(k)) byPhone.set(k, u);
  }
  console.log(`nameless NIETE users: ${nameless.length} (${byPhone.size} distinct normalised phones)`);

  // ---- 2. the FDE roster -------------------------------------------------
  const fde = new Client({
    host: process.env.TALEEMABAD_DB_HOST,
    port: process.env.TALEEMABAD_DB_PORT,
    database: process.env.TALEEMABAD_DB_NAME,
    user: process.env.TALEEMABAD_DB_USER,
    password: process.env.TALEEMABAD_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await fde.connect();
  const schema = process.env.TALEEMABAD_DB_SCHEMA || 'fde_production';
  const { rows } = await fde.query(
    `SELECT username, name, additional_phone_numbers, deleted_at, is_testing_account
       FROM "${schema}".users_user`
  );
  await fde.end();
  console.log(`fde_production.users_user rows: ${rows.length}`);

  // ---- 3. match ----------------------------------------------------------
  const plan = [];
  const seen = new Set();
  for (const r of rows) {
    const clean = titleCaseName(r.name);
    if (!clean) continue;
    if (r.deleted_at !== null || r.is_testing_account) continue;
    for (const cand of [r.username, ...(r.additional_phone_numbers || [])]) {
      const k = e164(cand);
      if (!k || seen.has(k)) continue;
      const target = byPhone.get(k);
      if (!target) continue;
      seen.add(k);
      plan.push({ id: target.id, phone: k, from: r.name, to: clean });
    }
  }
  console.log(`\nrecoverable: ${plan.length} of ${byPhone.size} (${(plan.length / byPhone.size * 100).toFixed(1)}%)`);
  console.log('\nsample of what would be written:');
  plan.slice(0, 15).forEach((p) => console.log(`  ${p.phone}  "${p.from}"  ->  "${p.to}"`));

  const batch = plan.slice(0, LIMIT);
  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. ${batch.length} rows would change. Pass --apply to write.`);
    return;
  }

  // ---- 4. write ----------------------------------------------------------
  let ok = 0; let failed = 0; let skipped = 0;
  for (const p of batch) {
    // Re-read under the write so a name filled in between the plan and the
    // apply (by a coach on the Edit Teacher screen, or the missing-field Flow)
    // is never overwritten. Safe to re-run; a second pass writes nothing.
    const { data: fresh } = await sb
      .from('users').select('name').eq('id', p.id).maybeSingle();
    if (String((fresh && fresh.name) || '').trim()) { skipped += 1; continue; }

    const { error } = await sb.from('users').update({ name: p.to }).eq('id', p.id);
    if (error) { failed += 1; console.error(`  FAILED ${p.phone}: ${error.message}`); } else { ok += 1; }
  }
  console.log(`\nAPPLIED. written: ${ok}, skipped (name appeared since): ${skipped}, failed: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
