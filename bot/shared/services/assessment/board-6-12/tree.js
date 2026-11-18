'use strict';
/**
 * Exam-tree helpers for the board writer (tree shape: deps contract §5; OR / parts / stimulus nodes as in
 * board-checks/walk.js). Pure except where named (trimExcess, dropIds, stamp mutate the tree they are given).
 */

const isObj = (x) => x && typeof x === 'object';
// item-tag.schema.json: `kind` is an srq/erq item kind from this list, null elsewhere (board-checks tag-complete KIND_RULE).
const { twins } = require('../board-checks/near-dup');
const KINDS = require('../board-checks/item-tag.schema.json').$defs.leaf.properties.kind.enum.filter((k) => k !== null);
const KIND_TYPES = ['srq', 'erq'];
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

const wantOf = (slots) => new Map(slots.filter(generating).map((s) => [s.slot, s.stimulus ? s.stimulus.count : s.generate]));

/**
 * Remove top-level nodes beyond what a slot generates (by group count for a stimulus slot). `rank(node)` (optional,
 * lower is better) picks which to keep; ties keep the earlier node; the kept nodes stay in their order.
 */
function trimExcess(tree, slots, rank) {
  const want = wantOf(slots);
  const nodes = [];
  eachList(tree, (list) => list.forEach((q) => { if (isObj(q) && want.has(q.slot)) nodes.push(q); }));
  const keep = new Set();
  want.forEach((n, slot) => nodes.filter((q) => q.slot === slot)
    .map((q, i) => ({ q, i, r: rank ? rank(q) : 0 }))
    .sort((a, b) => a.r - b.r || a.i - b.i).slice(0, n).forEach((x) => keep.add(x.q)));
  eachList(tree, (list, set) => set(list.filter((q) => !isObj(q) || !want.has(q.slot) || keep.has(q))));
  return tree;
}

/** True when some slot holds more top-level nodes than it generates. */
function overfull(tree, slots) {
  const want = wantOf(slots);
  const have = new Map();
  eachList(tree, (list) => list.forEach((q) => { if (isObj(q) && want.has(q.slot)) have.set(q.slot, (have.get(q.slot) || 0) + 1); }));
  return [...have].some(([slot, n]) => n > want.get(slot));
}

/** An `options: []` on a leaf that is not an mcq or scenario is the model's empty field, not a question shape: removed. */
function dropEmptyOptions(tree) {
  leavesOf(tree).forEach((l) => {
    if (Array.isArray(l.options) && !l.options.length && l.type !== 'mcq' && l.type !== 'scenario') delete l.options;
  });
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
 * (the level lives in tag.blooms), `kind` null unless a listed srq/erq kind, then `stampSlo` on every leaf
 * (stimulus members, OR branches and parts included); its return value replaces the leaf.
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
    const kindOf = (l) => { if (!(KIND_TYPES.includes(l.type) && KINDS.includes(l.kind))) l.kind = null; };
    const leafSlo = (n) => {
      const kids = children(n);
      if (!kids) { kindOf(n); return stampSlo(n) || n; }
      kids.forEach((k, i) => { kids[i] = leafSlo(k); });
      return n;
    };
    return leafSlo(q);
  })));
  return tree;
}

/** A stimulus node as eg.format.secondary writes it ({stimulus: "<text>", items|parts}) in the tree's shape. */
function groupOf(q, slot) {
  if (typeof q.stimulus !== 'string') return q;
  const { stimulus, items, ...rest } = q;
  if (Array.isArray(items)) return { ...rest, stimulus: { text: stimulus, items } };
  // bd-qyi45h.14: in a stimulus slot the group's questions are its members, however the reply names them
  if (slot && slot.stimulus && Array.isArray(rest.parts)) { const { parts, ...r } = rest; return { ...r, stimulus: { text: stimulus, items: parts } }; }
  return { ...rest, stimulus: { text: stimulus } };
}

/**
 * One section reply in the board format (eg.format.secondary: {"<slot id>": [items], "notes": [...]}) as a tree:
 * `unseen.<slot.category>.<slot.type>[]`, every top node stamped with the slot it was written under (code-owned).
 * Only the given generating slots' ids are read; any other key (notes, a category name) is not a slot and is
 * dropped, so a reply in another shape comes back short rather than guessed. Pure: the reply is copied.
 */
function fromReply(reply, slots) {
  const unseen = {};
  if (!isObj(reply)) return { unseen };
  slots.filter(generating).forEach((s) => {
    const list = reply[s.slot];
    if (!Array.isArray(list)) return;
    const cat = (unseen[s.category] = unseen[s.category] || {});
    cat[s.type] = (cat[s.type] || []).concat(JSON.parse(JSON.stringify(list)).filter(isObj).map((q) => ({ ...groupOf(q, s), slot: s.slot }))
          // bd-qyi45h.14: a loose question is not a passage; in a stimulus slot it would crowd real groups out of the trim
          .filter((q) => !s.stimulus || isGroup(q)));
  });
  return { unseen };
}

/** A node's text identity: every leaf's question/answer/options, plus a group's stimulus text (OR branches included). */
function nodeKey(q) {
  const flat = (v) => String(v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).toLowerCase().replace(/\s+/g, ' ').trim();
  const leaves = leavesOfNode(q).map((l) => [l.question, l.answer, l.options].map(flat).join('\u0001')).join('\u0002');
  return isGroup(q) ? `${flat(q.stimulus.text)}\u0003${leaves}` : leaves;
}

/**
 * The board top-up: `first` plus each top node of `second` written for a slot in `slots` that `first` does not
 * already hold (by nodeKey), under its own category and type. Unlike the G1-2 top-up (keyed on question/answer
 * text, blind to `or` and `stimulus`), an OR question or a stimulus group is a real new node. Pure: returns a copy.
 */
function topUp(first, second, slots) {
  const out = JSON.parse(JSON.stringify(first || {}));
  const seen = new Set();
  eachList(out, (list) => list.forEach((q) => { if (isObj(q)) seen.add(nodeKey(q)); }));
  ['seen', 'unseen'].forEach((b) => Object.entries((second && second[b]) || {}).forEach(([cat, types]) => {
    if (!isObj(types)) return;
    Object.entries(types).forEach(([type, list]) => {
      if (!Array.isArray(list)) return;
      const add = list.filter((q) => isObj(q) && slots.has(q.slot) && !seen.has(nodeKey(q)));
      if (!add.length) return;
      add.forEach((q) => seen.add(nodeKey(q)));
      const c = ((out[b] = out[b] || {})[cat] = out[b][cat] || {});
      c[type] = (c[type] || []).concat(JSON.parse(JSON.stringify(add)));
    });
  }));
  return out;
}

/**
 * Round 9b: like topUp, but at most want.get(slot) plain (non-group) nodes per slot, lowest rank(node) first (ties
 * in order). Inputs are left as they were. bd-qyi45h.15: a spare node that D17 would pair with a kept leaf, or with
 * a spare already taken, is passed over.
 */
function fill(first, second, want, rank = () => 0) {
  const left = new Map(want);
  const have = new Set();
  eachList(first || {}, (list) => list.forEach((q) => { if (isObj(q)) have.add(nodeKey(q)); }));
  const pick = JSON.parse(JSON.stringify(second || {}));
  const kept = leavesOf(first || {});
  const fresh = (q) => leavesOfNode(q).every((a) => !kept.some((b) => twins(a, b)));
  eachList(pick, (list, set) => {
    const ok = list.filter((q) => isObj(q) && !isGroup(q) && !have.has(nodeKey(q)));
    const chosen = new Set(ok.map((q, i) => [q, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([q]) => q)
      .filter((q) => {
        if (!(left.get(q.slot) > 0) || !fresh(q)) return false;
        left.set(q.slot, left.get(q.slot) - 1);
        kept.push(...leavesOfNode(q));
        return true;
      }));
    set(list.filter((q) => chosen.has(q)));
  });
  // bd-qyi45h.8: a spare node keeps its old id, which a rewrite may have reused; clear it so stamp re-ids it
  const taken = new Set(leavesOf(first || {}).map((l) => l.id));
  eachList(first || {}, (list) => list.forEach((q) => { if (isObj(q)) taken.add(q.id); }));
  const unId = (q) => { q.id = null; [...(q.or || []), ...(q.parts || [])].forEach((c) => { if (isObj(c)) unId(c); }); };
  eachList(pick, (list) => list.forEach((q) => { if ([q.id, ...leavesOfNode(q).map((l) => l.id)].some((id) => id != null && taken.has(id))) unId(q); }));
  return topUp(first, pick, new Set(want.keys()));
}

/** Round 10: the hard ids `fill` can make good. A group's ids stay (fill never adds a group); a plain node's ids go
 * only while `spare` holds a new plain node of its slot, one per dropped node. Pure. */
function droppable(tree, ids, spare) {
  const have = new Set();
  eachList(tree, (list) => list.forEach((q) => { if (isObj(q)) have.add(nodeKey(q)); }));
  const room = new Map();
  eachList(spare || {}, (list) => list.forEach((q) => { if (isObj(q) && !isGroup(q) && !have.has(nodeKey(q))) room.set(q.slot, (room.get(q.slot) || 0) + 1); }));
  const out = new Set();
  eachList(tree, (list) => list.forEach((q) => {
    if (!isObj(q) || isGroup(q)) return;
    const hit = [q.id, ...leavesOfNode(q).map((l) => l.id)].filter((id) => ids.has(id));
    if (!hit.length || !(room.get(q.slot) > 0)) return;
    room.set(q.slot, room.get(q.slot) - 1);
    hit.forEach((id) => out.add(id));
  }));
  return out;
}

module.exports = { eachList, leavesOf, leavesOfNode, overfull, dropEmptyOptions, liveCounts, shortfallOf, trimExcess, dropIds, stamp, isGroup, fromReply, topUp, fill, droppable };
