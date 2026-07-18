'use strict';
// bd-2102 proof-of-fix: run the partition against Anam Masood's real production
// enrolment (Taleemabad + Beacon House + Oxbridge) via the live NIETE Supabase
// analyst read, then show the partitioned output.

const path = require('path');
require(path.join(__dirname, '..', 'bot', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', '.env') });

const supabase = require(path.join(__dirname, '..', 'bot', 'shared', 'config', 'supabase'));
const { partitionByVendor, vendorSummaryLine } = require(
  path.join(__dirname, '..', 'bot', 'shared', 'routes', 'teacher-training-endpoint')
);

// Anam Masood's user id (confirmed via users?phone_number=eq.923362227374).
const ANAM_USER_ID = '79abb03b-b7ba-4489-b34e-e27756014441';

(async () => {
  // Mirror the DB fetch loadVisibleLevelsWithProgress would do.
  const { data: assignments } = await supabase
    .from('teacher_training_assignments')
    .select('program_id')
    .eq('user_id', ANAM_USER_ID)
    .eq('is_active', true);

  console.log(`Active program assignments: ${(assignments || []).length}`);
  if (!assignments || assignments.length === 0) { console.log('No assignments — cannot demo.'); process.exit(0); }

  const programIds = assignments.map(a => a.program_id);
  const { data: scopes } = await supabase
    .from('training_program_scopes').select('vendor_id, level_ids').in('program_id', programIds);
  const vendorIds = [...new Set((scopes || []).map(s => s.vendor_id))];
  const [{ data: allLevels }, { data: vendorRows }] = await Promise.all([
    supabase.from('training_levels')
      .select('id, vendor_id, name, order_index, cpd_level, is_active')
      .in('vendor_id', vendorIds).eq('is_active', true).order('order_index'),
    supabase.from('training_vendors').select('id, key, name, unlock_logic, has_grand_quiz').in('id', vendorIds),
  ]);
  const vendorById = new Map((vendorRows || []).map(v => [v.id, v]));

  // Simulate the enriched catalog rows that partitionByVendor expects.
  const catalog = (allLevels || []).map(lv => {
    const v = vendorById.get(lv.vendor_id);
    return {
      id: lv.id,
      order_index: lv.order_index,
      name: lv.name,
      vendor_key: v?.key || null,
      vendor_name: v?.name || v?.key || null,
      unlock_logic: v?.unlock_logic || 'chain',
      state: 'not_started',
      courses_total: 5,
      courses_completed: 0,
    };
  });

  console.log(`\nRaw catalog (${catalog.length} levels, pre-fix mixed dropdown):`);
  catalog.forEach(l => console.log(`  ${l.vendor_key.padEnd(12)} · ord=${l.order_index} · ${l.name}`));

  const groups = partitionByVendor(catalog);
  console.log(`\nPartitioned by vendor (${groups.length} programs — post-fix VENDOR_PICKER options):`);
  for (const g of groups) {
    console.log(`\n  === ${g.vendor_name} (${g.vendor_key}) — ${vendorSummaryLine(g)} ===`);
    g.levels.forEach(l => console.log(`     Level ${l.order_index + 1} · ${l.name}`));
  }
})().catch(e => { console.error(e); process.exit(1); });
