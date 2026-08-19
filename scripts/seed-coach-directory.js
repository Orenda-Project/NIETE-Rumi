#!/usr/bin/env node
/**
 * seed-coach-directory — resolve the ICT coach roster to work emails, ONCE.
 *
 *   node scripts/seed-coach-directory.js --env staging \
 *     --map    "<path>/coach_email_map_2026-08-19.json" \
 *     --roster "<path>/alloc_real.json" \
 *     --out    "<path>/coach-directory-unresolved.csv"       # dry run
 *
 *   … --live                                                  # actually write
 *
 * WHAT THIS DOES
 * --------------
 * Reads the 52 confirmed coach→email pairs (resolved against the Markaz HRMIS
 * under human review, committed beside the spec), resolves each roster name to a
 * bot user via the RDF phone map, and writes `coach_directory` rows with
 * match_method='exact'.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * Guess. Anything that does not resolve deterministically — no match, an
 * ambiguous name, or a phone with no user row — goes to a CSV for a human and
 * NEVER to the table. There is no similarity ratio anywhere in this path: a
 * difflib pass at cutoff 0.80 matched one coach's name to a mailbox belonging to
 * a DIFFERENT person at a DIFFERENT organisation, and one wrong row here puts a
 * school visit on a stranger's calendar. A miss costs a coach an invite. We take
 * the miss.
 *
 * The roster genuinely contains ambiguity this refuses to resolve — at least one
 * coach is listed against two different phone numbers — and refusing is the
 * behaviour, not a shortcoming.
 *
 * NEITHER INPUT IS VENDORED
 * -------------------------
 * Both files live in the workspace, not in this repo, and are passed by path.
 * Copying a roster in here would create a second source of truth that drifts
 * silently the first time someone joins or leaves.
 *
 * IDEMPOTENT
 * ----------
 * Keyed on leader_user_id. Re-running updates the name/email and leaves any
 * human `confirmed_at` alone; it never duplicates a coach.
 */
const fs = require('fs');
const path = require('path');

// ── pure logic (unit-tested; no I/O) ─────────────────────────────────────────

const { resolveRosterName, nameFromEmail } = require('../bot/shared/services/observe/coach-directory');

/** Abort before opening any connection if the env points at the wrong project. */
function assertProjectRef(supabaseUrl, expectedRef) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(supabaseUrl || ''));
  if (!m) {
    throw new Error(`ABORT: could not parse a project ref out of SUPABASE_URL (${supabaseUrl})`);
  }
  if (m[1] !== expectedRef) {
    throw new Error(
      `ABORT: SUPABASE_URL points at project '${m[1]}', which does not match the expected ` +
      `'${expectedRef}'. Refusing to write to an unintended database.`
    );
  }
  return m[1];
}

/**
 * Decide, for every confirmed pair, whether it can be written.
 *
 * @param {Array<{roster_name:string, email:string, sector?:string}>} pairs
 * @param {Object<string,string>} phoneToName   RDF `coachph2name`
 * @param {Object<string,string>} userIdByPhone phone → users.id (absent = no account)
 * @returns {{rows:Array, unresolved:Array}}
 */
function planSeed(pairs, phoneToName, userIdByPhone) {
  // Candidates are ROSTER entries. Note the direction: the HRMIS side of this
  // join was already resolved under human review and is what the map file holds,
  // so here the mailbox is an alias for the SAME person as `roster_name`, not a
  // property of the candidate. Attaching it to every candidate would make every
  // candidate match and turn each pair 'ambiguous'.
  const candidates = Object.entries(phoneToName || {}).map(([phone, name]) => ({ phone, name }));
  const rows = [];
  const unresolved = [];

  for (const pair of pairs || []) {
    const rosterName = pair && pair.roster_name;
    const email = pair && pair.email;
    if (!rosterName || !email) {
      unresolved.push({ roster_name: rosterName || '', email: email || '', reason: 'incomplete_pair', detail: '' });
      continue;
    }
    let r = resolveRosterName(rosterName, candidates);
    // Second alias for the same person: a `first.last@` mailbox spells out a name.
    // It costs nothing and covers a roster that spells a name differently from the
    // mailbox. Tried only after an outright miss — never to break a tie, because a
    // tie means we do not know.
    if (!r.ok && r.reason === 'no_match') {
      const alias = nameFromEmail(email);
      if (alias) r = resolveRosterName(alias, candidates);
    }
    if (!r.ok) {
      unresolved.push({
        roster_name: rosterName,
        email,
        reason: r.reason,
        detail: (r.candidates || []).map((c) => c.phone).join(' '),
      });
      continue;
    }
    const userId = userIdByPhone && userIdByPhone[r.match.phone];
    if (!userId) {
      unresolved.push({ roster_name: rosterName, email, reason: 'no_user', detail: r.match.phone });
      continue;
    }
    rows.push({
      leader_user_id: userId,
      full_name: rosterName,
      work_email: email,
      match_method: 'exact',
    });
  }

  // One row per coach, and a duplicate is a data problem worth surfacing rather
  // than silently collapsing on the unique constraint.
  const seen = new Map();
  const deduped = [];
  for (const row of rows) {
    if (seen.has(row.leader_user_id)) {
      unresolved.push({
        roster_name: row.full_name, email: row.work_email,
        reason: 'duplicate_user', detail: seen.get(row.leader_user_id),
      });
      continue;
    }
    seen.set(row.leader_user_id, row.full_name);
    deduped.push(row);
  }
  return { rows: deduped, unresolved };
}

function toCsv(unresolved) {
  const head = 'roster_name,email,reason,detail';
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [head, ...(unresolved || []).map(
    (u) => [u.roster_name, u.email, u.reason, u.detail].map(esc).join(',')
  )].join('\n') + '\n';
}

module.exports = { assertProjectRef, planSeed, toCsv };

// ── CLI ───────────────────────────────────────────────────────────────────────
// Inside a function, not behind a top-level return: Babel (which jest uses to
// transform this file when the unit tests require it) rejects a top-level
// return, so the guard would parse under `node` and break the whole suite.
function main() {
  const ENVS = {
    staging: { file: '.env.staging', ref: 'rpqkekcfvumypldbejhp' },
    prod: { file: '.env.prod', ref: 'ihzciabopbttygxxgrkm' },
  };

  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(`--${n}`);
  const val = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(2); };

  const envName = val('env');
  const live = flag('live');
  const mapPath = val('map');
  const rosterPath = val('roster');
  const outPath = val('out', `coach-directory-unresolved-${envName || 'unknown'}.csv`);

  if (!envName || !ENVS[envName]) {
    die(`--env is REQUIRED and must be one of: ${Object.keys(ENVS).join(', ')}\n` +
        `  (no default — an implicit prod target is how the wrong database gets written)`);
  }
  if (!mapPath || !rosterPath) die('--map and --roster are both REQUIRED');
  const target = ENVS[envName];

  const envPath = path.resolve(__dirname, '..', target.file);
  if (!fs.existsSync(envPath)) die(`missing ${target.file} — cannot resolve credentials for '${envName}'`);
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    process.env[s.slice(0, i)] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }

  // Guard the target BEFORE any client is constructed.
  let ref;
  try { ref = assertProjectRef(process.env.SUPABASE_URL, target.ref); } catch (e) { die(e.message); }

  const supabase = require('../bot/shared/config/supabase');

  (async () => {
    const pairs = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    const phoneToName = roster.coachph2name || roster;
    console.log(`\n  env=${envName} ref=${ref} live=${live}`);
    console.log(`  ${pairs.length} confirmed pairs · ${Object.keys(phoneToName).length} roster coaches\n`);

    // Resolve phones → user ids in one read.
    const phones = Object.keys(phoneToName);
    const userIdByPhone = {};
    for (let i = 0; i < phones.length; i += 200) {
      const slice = phones.slice(i, i + 200);
      const { data, error } = await supabase
        .from('users').select('id, phone_number').in('phone_number', slice);
      if (error) die(`user lookup failed: ${error.message}`);
      for (const u of data || []) userIdByPhone[u.phone_number] = u.id;
    }

    const { rows, unresolved } = planSeed(pairs, phoneToName, userIdByPhone);
    console.log(`  resolved   ${rows.length}`);
    console.log(`  unresolved ${unresolved.length}`);
    for (const u of unresolved) console.log(`    · ${u.roster_name} — ${u.reason} ${u.detail}`);

    fs.writeFileSync(outPath, toCsv(unresolved));
    console.log(`\n  unresolved written to ${outPath}`);

    if (!live) {
      console.log('\n  DRY RUN — nothing written. Re-run with --live.\n');
      return;
    }

    let written = 0;
    for (const row of rows) {
      // onConflict on leader_user_id: re-running updates the pair and leaves a
      // human's confirmed_at alone. Never a second row for the same coach.
      const { error } = await supabase
        .from('coach_directory')
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'leader_user_id' });
      if (error) {
        console.error(`  ✗ ${row.full_name}: ${error.message}`);
        continue;
      }
      written += 1;
    }
    console.log(`\n  wrote ${written} of ${rows.length}\n`);
  })().catch((e) => { console.error(e); process.exit(1); });
}

if (require.main === module) main();
