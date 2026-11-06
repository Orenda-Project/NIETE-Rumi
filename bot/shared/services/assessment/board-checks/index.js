'use strict';
/**
 * The board-checks registry (contract 8 §1-3). run(examJson, ctx) -> {shortfall, notes, record}.
 * Pure: no I/O, no model, never mutates its input, never reorders examJson. A member that throws is
 * caught and recorded; a checker crash never fails a paper.
 *
 * Member interface: {id, name?, hard: true|false|'shape', modes: ['free'|'board'], LIMITS, run(examJson, ctx) -> {ok, issues, detail?, record?}}.
 * The record keys a member by `name` (its run-order name, e.g. 'blueprint-qa'), falling back to `id`; an Issue's
 * `check` and a Shortfall's `reason` carry the check id (e.g. 'D12').
 */
const { leaves, topNodes } = require('./walk');

// ── Run order (registry.md §3): tag-complete, blueprint-qa, mcq-shape, scheme-sum, numeric-resolve,
//    maths-check-secondary, figure-ban, key-leak, readability, legacy.
// PART 2 (slice 6b): tag-complete runs first; figure-ban, key-leak, readability run last. legacy is not built yet.
const PART2_HEAD = [require('./tag-complete')];
const PART2_TAIL = [require('./figure-ban'), require('./key-leak'), require('./readability')];
const MEMBERS = [
  ...PART2_HEAD,
  require('./blueprint-qa'),
  require('./mcq-shape'),
  require('./scheme-sum'),
  require('./numeric-resolve'),
  require('./maths-check-secondary'),
  ...PART2_TAIL,
];

const nameOf = (m) => m.name || m.id;

function slotOf(issue, mode) {
  if (issue.slot !== undefined) return issue.slot;
  const base = String(issue.item_ref).split('#')[0];
  return mode === 'free' ? `free:${base}` : base;
}

function buildShortfall(hardIssues, mode, refToId) {
  const rows = new Map();
  hardIssues.forEach((i) => {
    const slot = slotOf(i, mode);
    if (!rows.has(slot)) rows.set(slot, { slot, reason: i.check, items: [], item_refs: [], hard: true });
    const row = rows.get(slot);
    if (!row.item_refs.includes(i.item_ref)) row.item_refs.push(i.item_ref);
    const id = refToId.get(i.item_ref);
    if (id != null && !row.items.includes(id)) row.items.push(id);
  });
  return [...rows.values()];
}

function makeRun(members) {
  return function run(examJson, ctx) {
    const c = ctx || {};
    const mode = c.mode === 'free' ? 'free' : 'board';
    const record = { mode, ran: [], skipped: [], hard: 0, soft: 0, per_check: {}, errors: [] };
    const hardIssues = [];
    const notes = [];
    members.forEach((m) => {
      const name = nameOf(m);
      if (!m.modes.includes(mode)) { record.skipped.push({ id: name, why: 'mode' }); return; }
      let res;
      try {
        res = m.run(examJson, c) || { issues: [] };
      } catch (e) {
        record.errors.push({ id: name, error: String(e && e.message ? e.message : e) });
        notes.push({ check: 'checker_error', item_ref: '-', msg: `${name}: ${String(e && e.message ? e.message : e)}`, hard: false });
        return;
      }
      record.ran.push(name);
      const issues = (res.issues || []).map((i) => ({ ...i, hard: m.hard === false ? false : !!i.hard }));
      const pc = { issues: issues.length, hard: issues.filter((i) => i.hard).length };
      if (res.detail !== undefined) pc.detail = res.detail;
      record.per_check[name] = pc;
      issues.forEach((i) => (i.hard ? hardIssues.push(i) : notes.push(i)));
      if (res.record && typeof res.record === 'object') Object.assign(record, res.record);
    });
    record.hard = hardIssues.length;
    record.soft = notes.filter((n) => n.check !== 'checker_error').length;
    const refToId = new Map();
    if (hardIssues.length) {
      topNodes(examJson).forEach((t) => refToId.set(t.ref, t.item.id));
      leaves(examJson).forEach((l) => refToId.set(l.ref, l.item.id));
    }
    return { shortfall: buildShortfall(hardIssues, mode, refToId), notes, record };
  };
}

module.exports = { run: makeRun(MEMBERS), makeRun, MEMBERS };
