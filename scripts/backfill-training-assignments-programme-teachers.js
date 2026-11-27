#!/usr/bin/env node
/**
 * bd-tsa15l (queue #322, operator 27 Nov 2026 ~17:20) — the NARROWED backfill of teacher_training_assignments.
 *
 * bd-2672's backfill-training-assignments.js assigns every orphan with a grade signal (243 users on prod, 27 Nov),
 * including principals, deleted and test accounts and teachers with no school. The operator approved only this
 * group: TEACHERS AT A PROGRAMME SCHOOL (a school on FDE's programme list, app_settings analytics_fde_schools) who hold
 * no active assignment and have a level signal, by Hashir's level rule (programsForUser: PRIMARY -> niete_primary;
 * MIDDLE/HIGH -> niete_middle_high; both -> both). Skipped: deleted, test, merged phone, not role teacher, no school,
 * an off-list school, no level signal, anyone already assigned.
 *
 * SAFETY (same discipline as bd-2672): dry run by default; --env is explicit and the project ref is asserted;
 * insert-only (no update, no delete); idempotent (skips a (user, programme) pair already active);
 * --expect=N aborts unless the target list is exactly N users (prod 27 Nov: 88).
 * Before any write it saves the target list (backup) and the undo SQL under scratchpad/.
 * After the write it re-reads the table and prints PASS only when every target holds its programme(s).
 *
 * UNDO: delete from teacher_training_assignments where assigned_by = 'backfill_bd2672_programme_teachers';
 * (the undo file lists the exact user ids too).
 *
 * USAGE
 *   node scripts/backfill-training-assignments-programme-teachers.js --env=prod --expect=88            (dry run)
 *   node scripts/backfill-training-assignments-programme-teachers.js --env=prod --expect=88 --apply
 */
'use strict';
const fs = require('fs');
const path = require('path');

const fromBot = (mod) => {
  try { return require(path.join(__dirname, '..', 'bot', 'node_modules', mod)); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return require(mod);
  }
};
const { programsForUser, deriveBands, OVERRIDES } = require('./lib/training-band-derivation');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ENV = (args.find((a) => a.startsWith('--env=')) || '').split('=')[1];
const EXPECT = Number((args.find((a) => a.startsWith('--expect=')) || '').split('=')[1]);
const ASSIGNED_BY = 'backfill_bd2672_programme_teachers';
const TARGETS = {
  prod: { file: '.env', ref: 'ihzciabopbttygxxgrkm' },
  stage: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
};
let createClient;
if (require.main === module) {
  if (!TARGETS[ENV]) { console.error('Pass --env=prod or --env=stage'); process.exit(1); }
  fromBot('dotenv').config({ path: path.join(__dirname, '..', TARGETS[ENV].file), quiet: true });
  ({ createClient } = fromBot('@supabase/supabase-js'));
}

const emisKey = (e) => {
  const s = String(e == null ? '' : e).trim();
  const n = Number(s);
  return Number.isFinite(n) && s !== '' ? String(Math.trunc(n)) : s;
};

async function selectAll(sb, table, columns, tweak = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(sb.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/** The target users: pure, so it is testable. */
function pickTargets({ users, assignedUserIds, schoolsById, programmeEmis }) {
  const out = [];
  for (const u of users) {
    if (u.role !== 'teacher' || u.deleted_at || u.is_test_user) continue;
    if (String(u.phone_number || '').startsWith('merged')) continue;
    if (assignedUserIds.has(u.id)) continue;
    const s = schoolsById.get(u.school_id);
    if (!s || !programmeEmis.has(emisKey(s.emis))) continue;
    const programs = programsForUser(u, OVERRIDES);
    if (!programs.length) continue;
    out.push({ user: u, programs, bands: deriveBands(u) || [] });
  }
  return out;
}

async function main() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  if (!m || m[1] !== TARGETS[ENV].ref) throw new Error(`ABORT: ${TARGETS[ENV].file} does not resolve to ${TARGETS[ENV].ref}`);
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log(`bd-tsa15l narrowed backfill  env=${ENV} ref=${m[1]}  ${APPLY ? 'APPLY (writes)' : 'DRY RUN'}`);

  const { data: programs, error: pErr } = await sb.from('training_programs').select('id,key');
  if (pErr) throw new Error(pErr.message);
  const programIdByKey = Object.fromEntries(programs.map((p) => [p.key, p.id]));
  const { data: setting, error: sErr } = await sb.from('app_settings').select('value').eq('key', 'analytics_fde_schools').maybeSingle();
  if (sErr) throw new Error(sErr.message);
  let v = setting && setting.value;
  if (typeof v === 'string') v = JSON.parse(v);
  const emis = v && Array.isArray(v.emis) ? v.emis : [];
  if (emis.length < 300) throw new Error(`ABORT: the programme list has ${emis.length} schools (expected ~415)`);
  const programmeEmis = new Set(emis.map(emisKey));

  const schools = await selectAll(sb, 'schools', 'id,emis,name,region');
  const users = await selectAll(sb, 'users',
    'id,phone_number,role,school_id,teacher_level,grades_taught,is_test_user,deleted_at,last_message_at,region',
    (q) => q.eq('registration_completed', true));
  const assigned = await selectAll(sb, 'teacher_training_assignments', 'user_id,program_id', (q) => q.eq('is_active', true));
  const assignedUserIds = new Set(assigned.map((a) => a.user_id));
  const activePairs = new Set(assigned.map((a) => `${a.user_id}:${a.program_id}`));

  const targets = pickTargets({ users, assignedUserIds, schoolsById: new Map(schools.map((s) => [s.id, s])), programmeEmis });
  const byProgram = {};
  for (const t of targets) { const k = t.programs.join('+'); byProgram[k] = (byProgram[k] || 0) + 1; }
  console.log(`Targets: ${targets.length}`, byProgram);
  if (Number.isFinite(EXPECT) && targets.length !== EXPECT) {
    throw new Error(`ABORT: expected exactly ${EXPECT} targets, found ${targets.length}. Nothing written.`);
  }

  const outDir = path.join(__dirname, '..', 'scratchpad');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(outDir, `bd-tsa15l-backfill-targets-${ENV}-${stamp}.csv`);
  const schoolById = new Map(schools.map((s) => [s.id, s]));
  fs.writeFileSync(backup, ['user_id,phone_number,school_id,school_name,region,grades_taught,derived_bands,programs,last_message_at']
    .concat(targets.map(({ user: u, programs: p, bands }) => [u.id, u.phone_number, u.school_id, (schoolById.get(u.school_id) || {}).name,
      (schoolById.get(u.school_id) || {}).region, JSON.stringify(u.grades_taught), bands.join('+'), p.join('+'), u.last_message_at]
      .map((x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(','))).join('\n'));
  const undo = path.join(outDir, `bd-tsa15l-backfill-undo-${ENV}-${stamp}.sql`);
  fs.writeFileSync(undo, `-- undo: delete exactly the rows this run inserted (assigned_by tag) for these users\n` +
    `delete from teacher_training_assignments where assigned_by = '${ASSIGNED_BY}' and user_id in (\n` +
    targets.map((t) => `  '${t.user.id}'`).join(',\n') + '\n);\n');
  console.log(`Backup of the target list: ${backup}\nUndo SQL: ${undo}`);

  const rows = [];
  for (const t of targets) {
    for (const key of t.programs) {
      const programId = programIdByKey[key];
      if (!programId || activePairs.has(`${t.user.id}:${programId}`)) continue;
      rows.push({ user_id: t.user.id, program_id: programId, assigned_by: ASSIGNED_BY, is_active: true });
    }
  }
  console.log(`Assignment rows to insert: ${rows.length}`);
  if (!APPLY) { console.log('DRY RUN: nothing written.'); return; }

  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from('teacher_training_assignments').insert(rows.slice(i, i + 100));
    if (error) throw new Error(`insert batch ${i}: ${error.message}`);
    ok += Math.min(100, rows.length - i);
  }
  console.log(`Inserted ${ok}/${rows.length}`);

  const after = await selectAll(sb, 'teacher_training_assignments', 'user_id,program_id,assigned_by', (q) => q.eq('is_active', true).eq('assigned_by', ASSIGNED_BY));
  const have = new Set(after.map((a) => `${a.user_id}:${a.program_id}`));
  const missing = targets.filter((t) => t.programs.some((k) => !have.has(`${t.user.id}:${programIdByKey[k]}`)));
  console.log(missing.length === 0 ? `VERIFY PASS: all ${targets.length} targets hold their programme(s); ${after.length} tagged rows on prod`
    : `VERIFY FAIL: ${missing.length} targets are missing a row`);
  if (missing.length) process.exit(2);
}

module.exports = { pickTargets, emisKey };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
