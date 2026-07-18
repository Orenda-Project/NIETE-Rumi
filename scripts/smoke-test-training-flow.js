'use strict';
/**
 * Smoke-test the Teacher Training Flow endpoint locally.
 *
 * Simulates INIT and data_exchange payloads against the endpoint handler
 * with a real teacher's user_id from Supabase. Skips Meta encryption —
 * calls the handler functions directly.
 *
 * Run: node scripts/smoke-test-training-flow.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  handleTeacherTrainingInit,
  handleTeacherTrainingDataExchange,
} = require('../bot/shared/routes/teacher-training-endpoint');

const supabase = require('../bot/shared/config/supabase');

async function main() {
  console.log('=== Teacher Training Flow smoke test ===\n');

  // 1. Pick a real teacher from Supabase (any one with teacher_uuid + Assignments)
  const { data: teachers, error } = await supabase
    .from('users')
    .select('id, name, phone_number, levels, teacher_uuid')
    .not('teacher_uuid', 'is', null)
    .limit(3);
  if (error || !teachers || teachers.length === 0) {
    console.error('❌ Could not load a test teacher:', error);
    process.exit(1);
  }
  const t = teachers[0];
  console.log(`Using teacher: ${t.name} · ${t.phone_number} · levels=${JSON.stringify(t.levels)}\n`);

  // 2. INIT — bd-2102: this now returns VENDOR_PICKER for multi-vendor teachers
  // and TRAINING_HOME for single-vendor teachers. Both are valid.
  console.log('--- INIT ---');
  const init = await handleTeacherTrainingInit(t.id);
  console.log(JSON.stringify(init, null, 2).slice(0, 2000));
  console.log('...');

  // 3. If we landed on VENDOR_PICKER, drive open_vendor to reach TRAINING_HOME
  let home = init;
  let vendorKey = null;
  if (init && init.screen === 'VENDOR_PICKER') {
    vendorKey = init.data?.vendor_options?.[0]?.id;
    console.log(`\n--- data_exchange: open_vendor(${vendorKey}) → TRAINING_HOME ---`);
    home = await handleTeacherTrainingDataExchange(
      t.id, 'VENDOR_PICKER', { _action: 'open_vendor', _vendor_key: vendorKey }
    );
    console.log(JSON.stringify(home, null, 2).slice(0, 1500));
  }

  // 4. data_exchange: open level (first available)
  const firstLevelId = home?.data?.level_options?.[0]?.id;
  const firstLevelOrder = parseInt(String(firstLevelId), 10);
  console.log(`\n--- data_exchange: open_level(${firstLevelOrder}) → LEVEL_DETAIL ---`);
  const dx = await handleTeacherTrainingDataExchange(
    t.id, 'TRAINING_HOME',
    { _action: 'open_level', _level_order: String(firstLevelOrder), _vendor_key: vendorKey || home?.data?.hero_vendor_key || '' }
  );
  console.log(JSON.stringify(dx, null, 2).slice(0, 2500));

  // 5. Verify shape: bd-2102 asserts VENDOR_PICKER OR TRAINING_HOME on INIT,
  // TRAINING_HOME after open_vendor, LEVEL_DETAIL with module_list after open_level.
  const initOk =
    init && (
      (init.screen === 'VENDOR_PICKER' && Array.isArray(init.data?.vendor_options) && init.data.vendor_options.length >= 1) ||
      (init.screen === 'TRAINING_HOME' && init.data?.level_1_title && Array.isArray(init.data?.level_options))
    );
  const homeOk =
    home && home.screen === 'TRAINING_HOME' && home.data?.level_1_title &&
    Array.isArray(home.data?.level_options) && home.data.level_options.length >= 1 &&
    typeof home.data?.hero_vendor_key === 'string';
  const dxOk =
    dx && dx.screen === 'LEVEL_DETAIL' &&
    Array.isArray(dx.data?.module_list) && dx.data.module_list.length > 0 &&
    typeof dx.data?.vendor_key === 'string';

  // Multi-vendor uniqueness check when applicable.
  let vendorUniquenessOk = true;
  if (init.screen === 'VENDOR_PICKER') {
    const ids = init.data.vendor_options.map(o => o.id);
    vendorUniquenessOk = new Set(ids).size === ids.length;
    console.log(`\nVENDOR_PICKER options: ${ids.join(', ')} (unique=${vendorUniquenessOk})`);
  }

  const ok = initOk && homeOk && dxOk && vendorUniquenessOk;
  console.log(`\ninitOk=${initOk} homeOk=${homeOk} dxOk=${dxOk} vendorUniquenessOk=${vendorUniquenessOk}`);
  console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — shape sanity check`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => {
  console.error('smoke test crashed:', e);
  process.exit(1);
});
