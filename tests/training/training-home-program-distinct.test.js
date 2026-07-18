/**
 * bd-2102 — /training program-distinctness (Anam Masood 2026-07-17).
 *
 * Before the fix, a teacher enrolled in multiple training vendors
 * (Taleemabad + Oxbridge + Beacon House) saw all vendors' levels mixed
 * into a single dropdown. Anam's ask: "keep trainings from taleemabad,
 * oxbridge and Beaconhouse distinct in the drop down. do not mix their
 * levels".
 *
 * The fix partitions the catalog by vendor and inserts a VENDOR_PICKER
 * screen before TRAINING_HOME. Single-vendor teachers still land on
 * TRAINING_HOME directly (no extra tap).
 *
 * This test locks the pure helper `partitionByVendor` — the load-of-truth
 * that drives both screens. The DB-backed handlers are covered by the
 * smoke test and manual E2E post-deploy.
 */

const { partitionByVendor, vendorSummaryLine } = require(
  '../../bot/shared/routes/teacher-training-endpoint'
);

// Anam's actual production catalog snapshot from 2026-07-16T15:26:36Z, now
// augmented with the vendor tags that the fix carries through from
// loadVisibleLevelsWithProgress.
const ANAM_CATALOG = [
  { vendor_key: 'TALEEMABAD',  vendor_name: 'Taleemabad',   unlock_logic: 'chain',       order_index: 0, name: 'Aspiring Teacher',      state: 'in_progress',   courses_total: 9, courses_completed: 4 },
  { vendor_key: 'BEACONHOUSE', vendor_name: 'Beacon House', unlock_logic: 'all_modules', order_index: 1, name: 'English',                state: 'not_started',   courses_total: 6, courses_completed: 0 },
  { vendor_key: 'TALEEMABAD',  vendor_name: 'Taleemabad',   unlock_logic: 'chain',       order_index: 1, name: 'Emerging Practitioner',  state: 'locked',        courses_total: 9, courses_completed: 0 },
  { vendor_key: 'BEACONHOUSE', vendor_name: 'Beacon House', unlock_logic: 'all_modules', order_index: 2, name: 'Mathematics',            state: 'not_started',   courses_total: 6, courses_completed: 0 },
  { vendor_key: 'TALEEMABAD',  vendor_name: 'Taleemabad',   unlock_logic: 'chain',       order_index: 2, name: 'Skilled Practitioner',   state: 'locked',        courses_total: 9, courses_completed: 0 },
  { vendor_key: 'OXBRIDGE',    vendor_name: 'Oxbridge',     unlock_logic: 'all_modules', order_index: 4, name: 'Game-Based Teaching',    state: 'in_progress',   courses_total: 7, courses_completed: 2 },
];

describe('bd-2102 — training program distinctness', () => {
  test('partitionByVendor groups by vendor_key, preserving level order within each group', () => {
    const groups = partitionByVendor(ANAM_CATALOG);
    const keys = groups.map(g => g.vendor_key);
    // Order-independent — the test locks the SET of vendor keys and each
    // group's internal level order, not the order the vendors appear.
    expect(new Set(keys)).toEqual(new Set(['TALEEMABAD', 'BEACONHOUSE', 'OXBRIDGE']));

    const byKey = Object.fromEntries(groups.map(g => [g.vendor_key, g]));
    expect(byKey.TALEEMABAD.levels.map(l => l.name)).toEqual([
      'Aspiring Teacher', 'Emerging Practitioner', 'Skilled Practitioner',
    ]);
    expect(byKey.BEACONHOUSE.levels.map(l => l.name)).toEqual(['English', 'Mathematics']);
    expect(byKey.OXBRIDGE.levels.map(l => l.name)).toEqual(['Game-Based Teaching']);
  });

  test('each group carries the vendor name + unlock_logic for the picker', () => {
    const groups = partitionByVendor(ANAM_CATALOG);
    const tb = groups.find(g => g.vendor_key === 'TALEEMABAD');
    expect(tb.vendor_name).toBe('Taleemabad');
    expect(tb.unlock_logic).toBe('chain');

    const ox = groups.find(g => g.vendor_key === 'OXBRIDGE');
    expect(ox.unlock_logic).toBe('all_modules');
  });

  test('each group computes progress summary (courses done / total, pct)', () => {
    const groups = partitionByVendor(ANAM_CATALOG);
    const tb = groups.find(g => g.vendor_key === 'TALEEMABAD');
    // 4 done out of (9+9+9) = 27 → 15%
    expect(tb.summary.courses_total).toBe(27);
    expect(tb.summary.courses_done).toBe(4);
    expect(tb.summary.pct_complete).toBe(15);
    expect(tb.summary.levels_total).toBe(3);

    const bh = groups.find(g => g.vendor_key === 'BEACONHOUSE');
    expect(bh.summary.pct_complete).toBe(0);
  });

  test('single-vendor teacher yields exactly one group (drives the picker-skip decision)', () => {
    const single = ANAM_CATALOG.filter(l => l.vendor_key === 'TALEEMABAD');
    const groups = partitionByVendor(single);
    expect(groups).toHaveLength(1);
    expect(groups[0].vendor_key).toBe('TALEEMABAD');
  });

  test('vendorSummaryLine renders a picker-row description', () => {
    const groups = partitionByVendor(ANAM_CATALOG);
    const tb = groups.find(g => g.vendor_key === 'TALEEMABAD');
    const line = vendorSummaryLine(tb);
    expect(line).toContain('3 levels');
    expect(line).toContain('15%');
    expect(line).toContain('4/27 courses');
  });

  test('empty catalog yields no groups', () => {
    expect(partitionByVendor([])).toEqual([]);
    expect(partitionByVendor(null)).toEqual([]);
  });

  test('rows without a vendor_key are dropped (defensive)', () => {
    const mixed = [
      { vendor_key: 'TALEEMABAD', order_index: 0, name: 'A', courses_total: 1, courses_completed: 1 },
      { /* no vendor_key */ order_index: 0, name: 'orphan', courses_total: 1, courses_completed: 0 },
    ];
    const groups = partitionByVendor(mixed);
    expect(groups).toHaveLength(1);
    expect(groups[0].vendor_key).toBe('TALEEMABAD');
  });
});
