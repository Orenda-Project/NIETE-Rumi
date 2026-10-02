#!/usr/bin/env node
/**
 * seed-visit — today's observe2 visit for the SIM coach at the SIM school (NIETE SANDBOX only).
 *
 *   node bot/scripts/e2e/child-test-sim/seed-visit.js --yes-write [--teacher 3A|5A]   → prints {visitId}
 *   node bot/scripts/e2e/child-test-sim/seed-visit.js --remove --yes-write             → deletes SIM visits
 *
 * WHY. The plan's journey is observe2 → child test: the visit fixes the school and the observed grade.
 * (Without one, /egra draws on a day key — CONTRACT §12 CR-1 — and the grade alternates.) The
 * simulation is about the child test, not observe2, so the visit is seeded as already sealed: the SIM coach (L3 SANDBOX_SEED) observed
 * the SIM Grade 3 (or 5) teacher at `niete:SIM-CT-0001`. Tagged `visit_context.sim = 'child-test-sim'`,
 * reused within the same Pakistan day, and removed by --remove (draws/sessions keep their rows: the
 * foreign keys are ON DELETE SET NULL — run sim/tools/reset_sim_school.sh first for a clean slate).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (sandbox). Refuses any other project before a query.
 */
'use strict';

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const SIM = {
  coachId: '5ee3518a-bc10-4cde-b276-31374e5c59d0',
  coachPhone: '923009990301',
  schoolExtId: 'niete:SIM-CT-0001',
  teachers: { '3A': '5d0821df-88bc-444f-92db-fa1cfd9c62ff', '5A': '83a6a26a-0469-412b-a251-cd9115589fe6' },
  rubricVersion: 'fico-ict-17-2026-09',
  tag: 'child-test-sim',
};
const PKT_OFFSET_MS = 5 * 3600 * 1000;

function assertSandbox(url) {
  const ref = (/^https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(url || '')) || [])[1];
  if (ref !== SANDBOX_REF) throw new Error(`seed-visit: refusing project '${ref || '?'}', not the NIETE sandbox (${SANDBOX_REF})`);
}

function startOfTodayPkt(now) {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) - PKT_OFFSET_MS).toISOString();
}

async function assertSimCoach(supabase) {
  const { data, error } = await supabase.from('users').select('id, phone_number, is_test_user, role').eq('id', SIM.coachId).maybeSingle();
  if (error) throw new Error('seed-visit: coach lookup failed: ' + error.message);
  if (!data || data.is_test_user !== true || data.phone_number !== SIM.coachPhone) {
    throw new Error('seed-visit: the SIM coach row is missing or not a test user — re-seed with L3 seed-sandbox.js');
  }
}

async function seedVisit({ supabase, url, teacher = '3A', now = new Date() }) {
  assertSandbox(url);
  const teacherId = SIM.teachers[teacher];
  if (!teacherId) throw new Error(`seed-visit: --teacher must be one of ${Object.keys(SIM.teachers).join(', ')}`);
  await assertSimCoach(supabase);
  const { data: today, error: e1 } = await supabase.from('observation_field_forms').select('id, teacher_user_id, created_at')
    .eq('observer_user_id', SIM.coachId).eq('visit_context->>sim', SIM.tag).gte('created_at', startOfTodayPkt(now))
    .order('created_at', { ascending: false }).limit(5);
  if (e1) throw new Error('seed-visit: lookup failed: ' + e1.message);
  const same = (today || []).find((v) => v.teacher_user_id === teacherId);
  if (same) return { ok: true, visitId: same.id, reused: true };
  const at = now.toISOString();
  const { data, error } = await supabase.from('observation_field_forms').insert({
    observer_user_id: SIM.coachId,
    teacher_user_id: teacherId,
    rubric_version: SIM.rubricVersion,
    visit_context: { school_ext_id: SIM.schoolExtId, sim: SIM.tag },
    opened_at: at, part1_done_at: at, part2_done_at: at, sealed_at: at,
  }).select('id').single();
  if (error) throw new Error('seed-visit: insert failed: ' + error.message);
  return { ok: true, visitId: data.id, reused: false };
}

async function removeSimVisits({ supabase, url }) {
  assertSandbox(url);
  const { data, error } = await supabase.from('observation_field_forms').delete()
    .eq('observer_user_id', SIM.coachId).eq('visit_context->>sim', SIM.tag).select('id');
  if (error) throw new Error('seed-visit: remove failed: ' + error.message);
  return { ok: true, removed: (data || []).length };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--yes-write')) { console.error('seed-visit: writes to the sandbox DB; pass --yes-write'); process.exit(2); }
  const url = process.env.SUPABASE_URL;
  assertSandbox(url);
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const ti = argv.indexOf('--teacher');
  const r = argv.includes('--remove')
    ? await removeSimVisits({ supabase, url })
    : await seedVisit({ supabase, url, teacher: ti >= 0 ? argv[ti + 1] : '3A' });
  console.log(JSON.stringify(r));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

module.exports = { seedVisit, removeSimVisits, assertSandbox, startOfTodayPkt, SIM };
