'use strict';
/**
 * Exam-tree helpers for the board writer (tree shape: deps contract §5; OR / parts / stimulus nodes as in
 * board-checks/walk.js). Pure except where named (trimExcess, dropIds, stamp mutate the tree they are given).
 */

const isObj = (x) => x && typeof x === 'object';
const isGroup = (q) => isObj(q) && isObj(q.stimulus) && Array.isArray(q.stimulus.items);

/** fn(list, setList) for every question list in the tree. */
function eachList(tree, fn) {
  ['seen', 'unseen'].forEach((b) => Object.values((tree && tree[b]) || {}).forEach((types) => {
    if (!isObj(types)) return;
    Object.keys(types).forEach((k) => { if (Array.isArray(types[k])) fn(types[k], (next) => { types[k] = next; }); });
  }));
}

const children = (q) => (Array.isArray(q.or) ? q.or : Array.isArray(q.parts) ? q.parts : isGroup(q) ? q.stimulus.items : null);

/** Leaves of one node, descending OR branches, parts and stimulus members. */
function leavesOfNode(q) {
  const kids = children(q);
  return kids ? kids.flatMap(leavesOfNode) : [q];
}

function leavesOf(tree) {
  const out = [];
  eachList(tree, (list) => list.forEach((q) => { if (isObj(q)) out.push(...leavesOfNode(q)); }));
  return out;
}

/** A node is live when every leaf under it has a tag; a group counts its tagged members. */
function liveUnits(q) {
  if (isGroup(q)) return q.stimulus.items.filter((m) => isObj(m.tag)).length;
  return leavesOfNode(q).every((l) => isObj(l.tag)) ? 1 : 0;
}

function liveCounts(tree) {
  const counts = new Map();
  eachList(tree, (list) => list.forEach((q) => {
    if (!isObj(q) || q.slot == null) return;
    counts.set(q.slot, (counts.get(q.slot) || 0) + liveUnits(q));
  }));
  return counts;
}

const generating = (s) => !(s.teacher_marked || s.project) && s.generate > 0;

function shortfallOf(tree, slots) {
  const counts = liveCounts(tree);
  return slots.filter(generating).map((s) => ({ slot: s.slot, have: counts.get(s.slot) || 0, need: s.generate }))
    .filter((r) => r.have < r.need);
}

/** Remove top-level nodes beyond what a slot generates (by group count for a stimulus slot). */
function trimExcess(tree, slots) {
  const want = new Map(slots.filter(generating).map((s) => [s.slot, s.stimulus ? s.stimulus.count : s.generate]));
  const seen = new Map();
  eachList(tree, (list, set) => set(list.filter((q) => {
    if (!isObj(q) || !want.has(q.slot)) return true;
    const n = (seen.get(q.slot) || 0) + 1;
    seen.set(q.slot, n);
    return n <= want.get(q.slot);
  })));
  return tree;
}

/** Remove every top-level node holding a leaf whose id is in `ids`; returns how many nodes went. */
function dropIds(tree, ids) {
  let dropped = 0;
  eachList(tree, (list, set) => set(list.filter((q) => {
    const hit = isObj(q) && (ids.has(q.id) || leavesOfNode(q).some((l) => ids.has(l.id)));
    if (hit) dropped += 1;
    return !hit;
  })));
  return dropped;
}

/**
 * Code-owned fields: `type` from the slot (an OR branch from its own branch type), an id where the model wrote
 * none (`<slot>#<n>`, `/a` `/b`, `.p<k>`, `@s<k>`: the board-checks item_ref base), no top-level `blooms`
 * (the level lives in tag.blooms), then `stampSlo` per top node; its return value replaces the node.
 */
function stamp(tree, slots, stampSlo) {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const counts = new Map();
  const used = new Set(leavesOf(tree).map((l) => l.id).filter((id) => id != null));
  eachList(tree, (list) => list.forEach((q) => { if (isObj(q) && q.id != null) used.add(q.id); }));
  const mark =(q, ref, type, marks) => {
    if (q.id == null) q.id = ref;
    if (isGroup(q)) q.stimulus.items.forEach((m, k) => mark(m, `${ref}@s${k + 1}`, type, marks));
    else if (Array.isArray(q.or)) q.or.forEach((b, i) => mark(b, `${ref}/${String.fromCharCode(97 + i)}`, null, marks));
    else if (Array.isArray(q.parts)) q.parts.forEach((p, k) => mark(p, `${ref}.p${k + 1}`, type, marks));
    else {
      if (type) q.type = type;
      if (!('kind' in q)) q.kind = null;
      if (q.marks == null && marks != null) q.marks = marks;
    }
  };
  eachList(tree, (list, set) => set(list.map((q) => {
    const row = isObj(q) && bySlot.get(q.slot);
    if (!row) return q;
    let n = counts.get(q.slot) || 0;
    if (q.id == null) {
      do { n += 1; } while (used.has(`${q.slot}#${n}`));
      counts.set(q.slot, n);
    }
    delete q.blooms;
    mark(q, q.id != null ? q.id : `${q.slot}#${n}`, row.type, row.marks_each);
    if (Array.isArray(q.or)) {
      q.or.forEach((b, i) => {
        const br = (row.or && row.or.branches[i]) || row;
        b.type = br.type;
        if (b.marks == null) b.marks = br.marks_each;
      });
    }
    return stampSlo(q) || q;
  })));
  return tree;
}

module.exports = { eachList, leavesOf, liveCounts, shortfallOf, trimExcess, dropIds, stamp, isGroup };
