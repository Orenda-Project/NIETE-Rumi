#!/usr/bin/env node
/* test_data_steps.js — the web lane's data step for a class roster (bd-5b3u70.16).
 *
 * Run: node .claude/qa/web/test_data_steps.js
 *
 * After "Save 3 students", TK04 reads what the save wrote straight from the run's own database: the class's active
 * enrolments, rolls 1..n, each child's saved name, and the two general rules (no other class or list touched, no child
 * twice). Off the run's database the step is NOT CHECKED (never fails the scenario, never passes the data part); on it,
 * a check that cannot run is an ERROR and fails. A fake ctx plays the database: nothing here reaches a real one.
 *
 * Red-first: fails before data-steps.cjs exists.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { dataBefore, rosterVerdict } = require(path.join(__dirname, 'data-steps.cjs'));

const WATCH = { students: { owner: 'list_id' }, class_enrollments: { owner: 'class_id', same: ['class_id', 'student_id'] } };

// A fake ctx over in-memory tables, with dataRules answering what the test sets.
function fakeCtx(tables, rules) {
  return {
    dataKeys: () => ({ ok: true, watch: WATCH }),
    snapshot: async () => ({ ok: true, snap: { marker: 'before' } }),
    rows: async (table, filter = {}) => ({ ok: true,
      rows: (tables[table] || []).filter((r) => Object.entries(filter).every(([k, v]) => String(r[k]) === String(v))) }),
    dataRules: async (watch, cast, before) => { fakeCtx.lastCast = cast; fakeCtx.lastBefore = before; return rules; },
  };
}
const saved = (names, extra = {}) => ({
  student_lists: [{ id: 'L1', class_id: 'C1', user_id: 'T1' }],
  students: names.map((n, i) => ({ id: 'S' + (i + 1), list_id: 'L1', student_name: n, is_active: true, ...extra })),
  class_enrollments: names.map((n, i) => ({ id: 'E' + (i + 1), class_id: 'C1', student_id: 'S' + (i + 1), roll_number: i + 1, is_active: true, left_on: null })),
});
const CLEAN = { ok: true, owner: [], duplicates: [], changes: {} };
const NAMES = ['Ayesha 1', 'Khan, Bilal 1', 'Hira 1'];

const tests = {
  async 'the roster as typed, rolls 1..3, nothing else touched: checked'() {
    const ctx = fakeCtx(saved(NAMES), CLEAN);
    const before = await dataBefore(ctx);
    const v = await rosterVerdict(ctx, before, 'C1', NAMES);
    assert.strictEqual(v.ok, true, JSON.stringify(v));
    assert.strictEqual(v.data, 'checked');
    assert.deepStrictEqual(fakeCtx.lastCast.sort(), ['C1', 'L1'], 'the cast is the class and its list');
    assert.deepStrictEqual(fakeCtx.lastBefore, { marker: 'before' });
  },
  async 'a name saved differently from what she typed fails'() {
    const ctx = fakeCtx(saved(['Ayesha 1', 'Bilal 1', 'Hira 1']), CLEAN);
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.strictEqual(v.ok, false); assert.strictEqual(v.data, 'checked'); assert.ok(v.mismatch, JSON.stringify(v));
  },
  async 'a child saved inactive fails'() {
    const ctx = fakeCtx(saved(NAMES, { is_active: false }), CLEAN);
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.strictEqual(v.ok, false); assert.ok(v.mismatch, JSON.stringify(v));
  },
  async 'an enrolment that has left the class does not count as on the roster'() {
    const t = saved(NAMES); t.class_enrollments[2].left_on = '2026-11-26';
    const ctx = fakeCtx(t, CLEAN);
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.strictEqual(v.ok, false); assert.ok(v.mismatch, JSON.stringify(v));
  },
  async 'a write to another class or list fails, naming the table'() {
    const ctx = fakeCtx(saved(NAMES), { ...CLEAN, owner: [{ table: 'class_enrollments', key: 'E9', owner: 'C9', change: 'added' }] });
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.strictEqual(v.ok, false); assert.deepStrictEqual(v.owner.map((o) => o.table), ['class_enrollments']);
  },
  async 'a child on the class twice fails'() {
    const ctx = fakeCtx(saved(NAMES), { ...CLEAN, duplicates: [{ table: 'class_enrollments', same: ['class_id', 'student_id'], keys: ['E1', 'E4'] }] });
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.strictEqual(v.ok, false); assert.strictEqual(v.duplicates.length, 1);
  },
  async 'off the run database: NOT CHECKED, and the scenario is not failed by it'() {
    const ctx = { ...fakeCtx(saved(NAMES), CLEAN), snapshot: async () => ({ ok: false, notChecked: 'shared database' }) };
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.deepStrictEqual(v, { ok: true, data: 'NOT CHECKED: shared database' });
  },
  async 'a runner without data reads (an older checkout): NOT CHECKED'() {
    const v = await rosterVerdict({}, await dataBefore({}), 'C1', NAMES);
    assert.strictEqual(v.ok, true); assert.ok(/^NOT CHECKED: /.test(v.data), JSON.stringify(v));
  },
  async 'a check that cannot run on the run database is an ERROR and fails'() {
    const ctx = { ...fakeCtx(saved(NAMES), CLEAN), rows: async () => ({ ok: false, error: 'unknown table class_enrollments' }) };
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.strictEqual(v.ok, false); assert.ok(/^ERROR: /.test(v.data), JSON.stringify(v));
  },
  async 'a snapshot that fails on the run database is an ERROR and fails'() {
    const ctx = { ...fakeCtx(saved(NAMES), CLEAN), snapshot: async () => ({ ok: false, error: 'did not settle' }) };
    const v = await rosterVerdict(ctx, await dataBefore(ctx), 'C1', NAMES);
    assert.deepStrictEqual(v, { ok: false, data: 'ERROR: did not settle' });
  },
};

(async () => {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { await fn(); console.log('  ok    ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
  }
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
