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
  require('./near-dup'), // bd-5jmnfj.38.30 round 8: D17, same question twice in a section
  require('./key-cue'), // round 10: D18, the key stands out (longest / always-never)
  require('./item-fit'), // round 10: D19/D20 soft, stimulus not used / graph SLO with no graph
  require('./scheme-sum'),
  require('./method-marks'), // D22 (Amena, 7 Nov 2026): a science numerical's scheme has method marks apart from the answer mark
  require('./mark-consistency'), // bd-5jmnfj.38.33: D21, legend mark == slot marks_each == printed MCQ marks
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
    // round 7: why each item failed (the first check wins), so a rewrite can be told what to avoid
    if (id != null) { row.why = row.why || {}; if (!row.why[id]) row.why[id] = i.check; }
    // round 6: a same-section key leak also names the keyed item and phrase (the writer's second rewrite);
    // round 7: and the item whose stem quotes it (`holder`), for when the keyed item is a stimulus child
    const keyed = i.keyed_ref != null ? refToId.get(i.keyed_ref) : null;
    if (keyed != null) {
      row.keyed = row.keyed || [];
      if (!row.keyed.some((k) => k.id === keyed)) row.keyed.push({ id: keyed, phrase: i.phrase, holder: id });
    }
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
    // bd-qyi45h.1: the hard issues by check and rule code, so a failed paper names why without a log dig
    if (hardIssues.length) record.hard_rules = hardIssues.reduce((a, i) => { const k = `${i.check} ${i.rule || i.code || '?'}`; a[k] = (a[k] || 0) + 1; return a; }, {});
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
