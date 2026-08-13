#!/usr/bin/env node
/**
 * bd-2672 — backfill teacher_training_assignments for registered teachers who have none.
 *
 * ICT priority sheet Row 8 (P0): "New users do not get assigned trainings."
 *
 * WHY 228 USERS ARE BROKEN
 * Nothing in the running application ever inserts into teacher_training_assignments.
 * Bot registration (flow-response.handler.js:547-565) writes grades_taught and stops.
 * Portal activation (portal.routes.js:409-419) writes password fields only. The one
 * committed insert (scripts/migrations/2026-07-21-level-scoping.sql:39) is gated on
 * pre-existing assigned_by='migration_seed' rows that migrate-teacher-training.py:373-382
 * is an explicit no-op for, so it matches zero orphans. Everything else was console SQL.
 *
 * An orphan sees "No training assigned yet" (teacher-training-endpoint.js:57-62) and is
 * hard-blocked from quizzes (training_assessment_attempts.program_id is NOT NULL).
 *
 * SCOPE — backfill only. This does NOT fix the underlying bug: teachers registering
 * after this runs will be orphans again. The durable mechanism (assignment at
 * registration, or live resolution off users.levels) is deferred to onboarding-flows.
 *
 * WHAT IT DOES NOT DO
 *  - Does not assign users with no grade signal. 125 such users exist; they are left
 *    untouched by decision (operator, 2026-08-13). See scripts/lib/training-band-derivation.js.
 *  - Does not write users.levels or users.grades_taught. Assignment rows only.
 *  - Does not touch the ~8,764 already-assigned users. No revocations, no updates.
 *
 * SAFETY
 *  - Dry-run by default; --apply to write.
 *  - Targets an explicit environment (--env=prod|stage) and asserts the resolved
 *    project ref before opening a connection. A worktree is seeded with the WRONG
 *    .env (the main PK bot's, a different production DB), so this is load-bearing.
 *  - Idempotent: skips any user who already has an active row for that program,
 *    backed by the partial unique index ux_tta_user_program_active.
 *  - Writes a CSV audit of every decision, including the skipped no-signal users.
 *
 * USAGE
 *   node scripts/backfill-training-assignments.js --env=prod
 *   node scripts/backfill-training-assignments.js --env=prod --apply
 */

const path = require('path');
const fs = require('fs');

// Resolve runtime deps from bot/node_modules (where the other scripts find them)
// or the repo root, whichever is installed. A fresh worktree may have only one.
const fromBot = (mod) => {
  try {
    return require(path.join(__dirname, '..', 'bot', 'node_modules', mod));
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    try {
      return require(mod);
    } catch {
      throw new Error(
        `Missing dependency '${mod}'. Install it in bot/ or the repo root:\n` +
          `  npm install --no-save dotenv @supabase/supabase-js`
      );
    }
  }
};

const { programsForUser, deriveBands, OVERRIDES } = require('./lib/training-band-derivation');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ENV = (args.find((a) => a.startsWith('--env=')) || '').split('=')[1];
const ASSIGNED_BY = 'backfill_bd2672';
const BATCH_SIZE = 100;

const TARGETS = {
  prod: { file: '.env', ref: 'ihzciabopbttygxxgrkm' },
  stage: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
};

if (!TARGETS[ENV]) {
  console.error('\n❌ Pass --env=prod or --env=stage (explicit by design).\n');
  process.exit(1);
}

fromBot('dotenv').config({ path: path.join(__dirname, '..', TARGETS[ENV].file), quiet: true });
const { createClient } = fromBot('@supabase/supabase-js');

function assertTarget() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m) throw new Error(`Unrecognized SUPABASE_URL: ${url}`);
  if (m[1] !== TARGETS[ENV].ref) {
    throw new Error(
      `ABORT: --env=${ENV} expects ref '${TARGETS[ENV].ref}' but ` +
        `${TARGETS[ENV].file} resolves to '${m[1]}'. Refusing to touch the wrong database.`
    );
  }
  return m[1];
}

/** Page through a select that may exceed the 1000-row PostgREST default. */
async function selectAll(sb, table, columns, tweak = (q) => q) {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await tweak(sb.from(table).select(columns)).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

async function main() {
  const ref = assertTarget();
  console.log(`\n${'='.repeat(78)}`);
  console.log(`bd-2672 backfill — teacher_training_assignments`);
  console.log(`env=${ENV}  ref=${ref}  mode=${APPLY ? 'APPLY (writes)' : 'DRY RUN (read-only)'}`);
  console.log('='.repeat(78));

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Resolve program ids by key — never hardcode uuids.
  const { data: programs, error: pErr } = await sb
    .from('training_programs')
    .select('id,key,is_active');
  if (pErr) throw new Error(`training_programs: ${pErr.message}`);
  const programIdByKey = {};
  for (const p of programs) programIdByKey[p.key] = p.id;

  for (const key of ['niete_primary', 'niete_middle_high']) {
    if (!programIdByKey[key]) throw new Error(`ABORT: program '${key}' not found in this database.`);
    const prog = programs.find((p) => p.key === key);
    if (!prog.is_active) throw new Error(`ABORT: program '${key}' is not active.`);
  }
  console.log(`\nPrograms resolved: ${Object.keys(programIdByKey).join(', ')}`);

  const users = await selectAll(
    sb,
    'users',
    'id,phone_number,first_name,levels,grades_taught,organization,role,created_at',
    (q) => q.eq('registration_completed', true)
  );
  const existing = await selectAll(sb, 'teacher_training_assignments', 'user_id,program_id', (q) =>
    q.eq('is_active', true)
  );

  // A user is only an orphan if they have NO active assignment at all; and a
  // (user, program) pair is only insertable if that specific pair is absent.
  const activeUsers = new Set(existing.map((a) => a.user_id));
  const activePairs = new Set(existing.map((a) => `${a.user_id}:${a.program_id}`));

  const orphans = users.filter((u) => !activeUsers.has(u.id));
  console.log(
    `\nUsers: ${users.length} registered · ${users.length - orphans.length} assigned · ${orphans.length} ORPHANS`
  );

  const rows = [];
  const decisions = [];
  const buckets = { primary: 0, middle_high: 0, both: 0, override: 0, skipped_no_signal: 0 };

  for (const u of orphans) {
    const isOverride = Boolean(OVERRIDES[String(u.phone_number)]);
    const keys = programsForUser(u, OVERRIDES);
    const bands = deriveBands(u);

    if (keys.length === 0) {
      buckets.skipped_no_signal += 1;
      decisions.push({
        phone: u.phone_number,
        user_id: u.id,
        levels: JSON.stringify(u.levels),
        grades_taught: u.grades_taught,
        derived_bands: '',
        programs: '',
        source: 'NO SIGNAL',
        action: 'SKIPPED — left unassigned by decision',
      });
      continue;
    }

    if (isOverride) buckets.override += 1;
    else if (keys.length === 2) buckets.both += 1;
    else if (keys[0] === 'niete_primary') buckets.primary += 1;
    else buckets.middle_high += 1;

    const inserted = [];
    for (const key of keys) {
      const programId = programIdByKey[key];
      if (activePairs.has(`${u.id}:${programId}`)) continue; // idempotence
      rows.push({
        user_id: u.id,
        program_id: programId,
        assigned_by: ASSIGNED_BY,
        is_active: true,
      });
      inserted.push(key);
    }

    decisions.push({
      phone: u.phone_number,
      user_id: u.id,
      levels: JSON.stringify(u.levels),
      grades_taught: u.grades_taught,
      derived_bands: (bands || []).join('+'),
      programs: inserted.join('+'),
      source: isOverride ? 'HUMAN OVERRIDE (sheet Row 8)' : bands && u.levels ? 'users.levels' : 'grades_taught',
      action: inserted.length ? 'ASSIGN' : 'already assigned (idempotent skip)',
    });
  }

  console.log('\nDecision summary');
  console.log('  ' + '-'.repeat(60));
  console.log(`  PRIMARY only         -> niete_primary        : ${buckets.primary}`);
  console.log(`  MIDDLE/HIGH          -> niete_middle_high    : ${buckets.middle_high}`);
  console.log(`  BOTH bands           -> both programs        : ${buckets.both}`);
  console.log(`  Human override       -> per sheet Row 8      : ${buckets.override}`);
  console.log(`  NO SIGNAL            -> SKIPPED, unassigned  : ${buckets.skipped_no_signal}`);
  console.log('  ' + '-'.repeat(60));
  console.log(`  Assignment rows to insert                    : ${rows.length}`);
  console.log(
    `  Orphans remaining after this run             : ${buckets.skipped_no_signal}` +
      ` (the no-signal bucket — onboarding work-list)`
  );

  // Row 8's named targets, called out for the reviewer.
  console.log('\nICT sheet Row 8 targets');
  for (const phone of ['923215531977', '923251670765']) {
    const d = decisions.find((x) => x.phone === phone);
    console.log(
      d
        ? `  ${phone}: ${d.action} ${d.programs ? `-> ${d.programs}` : ''} [${d.source}]`
        : `  ${phone}: not an orphan (already assigned)`
    );
  }

  const outDir = path.join(__dirname, '..', 'scratchpad');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = `${ENV}-${APPLY ? 'applied' : 'dryrun'}`;
  const csvPath = path.join(outDir, `bd-2672-decisions-${stamp}.csv`);
  const header = 'phone,user_id,levels,grades_taught,derived_bands,programs,source,action';
  const csv = [header]
    .concat(
      decisions.map((d) =>
        [d.phone, d.user_id, d.levels, d.grades_taught, d.derived_bands, d.programs, d.source, d.action]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
    )
    .join('\n');
  fs.writeFileSync(csvPath, csv);
  console.log(`\nAudit CSV: ${csvPath}`);

  const skippedPath = path.join(outDir, `bd-2672-no-signal-users-${ENV}.csv`);
  const skipped = decisions.filter((d) => d.source === 'NO SIGNAL');
  fs.writeFileSync(
    skippedPath,
    ['phone,user_id'].concat(skipped.map((d) => `${d.phone},${d.user_id}`)).join('\n')
  );
  console.log(`No-signal work-list (${skipped.length} users): ${skippedPath}`);

  if (!APPLY) {
    console.log('\n🔍 DRY RUN — nothing written. Re-run with --apply after operator sign-off.\n');
    return;
  }

  if (rows.length === 0) {
    console.log('\n✅ Nothing to insert; already consistent.\n');
    return;
  }

  console.log(`\n✍️  Inserting ${rows.length} rows in batches of ${BATCH_SIZE}...`);
  let ok = 0;
  const failures = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from('teacher_training_assignments').insert(batch);
    if (error) {
      // Report and continue — one bad batch must not abort the rest silently.
      failures.push({ from: i, size: batch.length, message: error.message });
      console.error(`  ✗ batch ${i}-${i + batch.length - 1}: ${error.message}`);
    } else {
      ok += batch.length;
      console.log(`  ✓ batch ${i}-${i + batch.length - 1}: ${batch.length} rows`);
    }
  }

  console.log(`\nInserted ${ok}/${rows.length} rows.`);
  if (failures.length) {
    console.error(`⚠️  ${failures.length} batch(es) failed — re-run to retry (idempotent).`);
  }

  // Verify against the live table rather than trusting the insert count.
  const after = await selectAll(sb, 'teacher_training_assignments', 'user_id', (q) =>
    q.eq('is_active', true)
  );
  const afterUsers = new Set(after.map((a) => a.user_id));
  const stillOrphaned = users.filter((u) => !afterUsers.has(u.id));
  console.log('\nVerification');
  console.log(`  registered users        : ${users.length}`);
  console.log(`  orphans before          : ${orphans.length}`);
  console.log(`  orphans after           : ${stillOrphaned.length}`);
  console.log(`  expected after (no-sig) : ${buckets.skipped_no_signal}`);
  if (stillOrphaned.length !== buckets.skipped_no_signal) {
    console.error('  ⚠️  MISMATCH — investigate before reporting success.');
    process.exitCode = 1;
  } else {
    console.log('  ✅ matches expectation.');
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
