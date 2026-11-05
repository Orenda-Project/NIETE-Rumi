#!/usr/bin/env node
'use strict';
/**
 * bd-rj6w0n.14.2 — seed GB teachers' users.region (and an empty users.school_id) from the GB roster, so a
 * teacher on the roster is known as GB with zero WhatsApp messages.
 *
 *   node scripts/seed-gb-roster.js <roster.json>                       # dry run: counts only
 *   node scripts/seed-gb-roster.js <roster.json> --apply               # writes
 *   node scripts/seed-gb-roster.js <roster.json> --ref <project-ref>   # another project, named on purpose
 *
 *   · The roster is gitignored personal data. It is read at run time from the path given, never copied
 *     into the repo, and nothing here prints or logs a phone or a name: only counts.
 *   · Every decision is scripts/lib/gb-roster.js (pure, tested): region only while unknown, the roster
 *     school only when users.school_id is empty and its EMIS names exactly one GB school. Never overwrites.
 *   · Asserts the Supabase project ref before reading (default: the NIETE sandbox).
 *   · Users are matched by phone (users.phone_number, '92' + ten digits); only existing users are touched.
 */

const fs = require('fs');
const path = require('path');
const { normalisePkPhone, planRosterWrites, PHONE_KEY } = require('./lib/gb-roster');

function dep(name) {
  for (const r of ['bot', 'dashboard', '.']) {
    try { return require(path.join(__dirname, '..', r, 'node_modules', name)); } catch (_) { /* next */ }
  }
  return require(name);
}

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const refArg = argv.indexOf('--ref');
const EXPECTED_REF = refArg > -1 ? argv[refArg + 1] : SANDBOX_REF;
const ROSTER_PATH = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ref');

async function main() {
  if (!ROSTER_PATH) { console.error('Usage: node scripts/seed-gb-roster.js <roster.json> [--apply] [--ref <ref>]'); process.exit(2); }
  const url = process.env.SUPABASE_URL || '';
  const ref = url.replace(/^https:\/\//, '').replace(/\.supabase\.co.*$/, '');
  if (ref !== EXPECTED_REF) {
    console.error(`REFUSING TO RUN: SUPABASE_URL points at "${ref}", expected "${EXPECTED_REF}".`);
    process.exit(1);
  }
  const roster = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
  const sb = dep('@supabase/supabase-js').createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const phones = [...new Set(roster.map((r) => normalisePkPhone(r[PHONE_KEY])).filter(Boolean))];
  const users = [];
  for (let i = 0; i < phones.length; i += 100) {
    const { data, error } = await sb.from('users').select('id, phone_number, region, school_id').in('phone_number', phones.slice(i, i + 100));
    if (error) throw new Error(`users read failed: ${error.message}`);
    users.push(...(data || []));
  }
  const { data: schools, error: sErr } = await sb.from('schools').select('id, emis').eq('region', 'Gilgit-Baltistan');
  if (sErr) throw new Error(`schools read failed: ${sErr.message}`);

  const { writes, counts } = planRosterWrites({ roster, users, schools: schools || [] });
  console.log(JSON.stringify({ project: ref, gbSchools: (schools || []).length, ...counts }, null, 2));
  if (!APPLY) { console.log(`DRY RUN — nothing written. ${writes.length} users would change. Pass --apply to write.`); return; }

  let done = 0;
  for (const w of writes) {
    // Guarded update: only while still unknown / still empty, so a concurrent choice is never overwritten.
    let q = sb.from('users').update(w.patch).eq('id', w.userId);
    if (w.patch.region) q = q.is('region', null);
    if (w.patch.school_id) q = q.is('school_id', null);
    const { error } = await q;
    if (error) console.error(`write failed (${error.message})`); else done += 1;
  }
  console.log(`Wrote ${done} of ${writes.length}.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
