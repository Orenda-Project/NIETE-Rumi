'use strict';
/**
 * Local item iterator for the board-checks members (slice 6b). The COS swaps this for the shared
 * walker (A/board-checks/walk.js) at integration; `leaves(examJson)` has the same shape as
 * `registry.md` section 2 plus `stimulusText`, `slotRow`, `container`.
 *
 * Walks seen/unseen -> category -> type list like `_walkQuestions`, then descends `or[]`,
 * `parts[]` and `stimulus.items[]`. Skips `removed:true`. Pure: never mutates its input.
 *
 * item_ref: `<slot|type>#<n>` (n = 1-based position among that key's top-level items), `/a` `/b` for
 * OR branches, `.p<k>` for a part, `@s<j>` for the j-th stimulus group (RULING: each leaf takes its own n,
 * a group's MCQs carry @s<j>, an OR node counts once, so refs stay unique per leaf).
 */

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function topItems(examJson) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    const b = examJson && examJson[branch];
    if (!isObj(b)) continue;
    for (const cat of Object.values(b)) {
      if (!isObj(cat)) continue;
      for (const list of Object.values(cat)) {
        if (Array.isArray(list)) list.forEach((q) => { if (isObj(q)) out.push(q); });
        else if (isObj(list)) for (const sub of Object.values(list)) if (Array.isArray(sub)) sub.forEach((q) => { if (isObj(q)) out.push(q); });
      }
    }
  }
  return out;
}

const stimulusTextOf = (it) => {
  const s = it && it.stimulus;
  if (typeof s === 'string') return s;
  return isObj(s) && typeof s.text === 'string' ? s.text : null;
};

function slotIndex(examJson) {
  const rows = new Map();
  const layout = examJson && examJson._layout;
  ((layout && layout.sections) || []).forEach((sec) => (sec.slots || []).forEach((r) => {
    if (r && r.slot) rows.set(r.slot, { row: r, sectionId: sec.id });
  }));
  return rows;
}

/** Every node (leaves and containers), containers flagged `container:true`. */
function walk(examJson) {
  const rows = slotIndex(examJson);
  const out = [];
  const counts = new Map();
  let groups = 0;
  const next = (key) => { const n = (counts.get(key) || 0) + 1; counts.set(key, n); return n; };
  const visit = (item, ctx) => {
    if (!isObj(item) || item.removed === true) return;
    const hasOr = Array.isArray(item.or);
    const hasParts = Array.isArray(item.parts);
    const stimItems = isObj(item.stimulus) && Array.isArray(item.stimulus.items) ? item.stimulus.items : null;
    const own = stimulusTextOf(item);
    const text = own != null ? own : ctx.stimulusText;
    const base = { slot: ctx.slot, sectionId: ctx.sectionId, slotRow: ctx.slotRow, stimulusText: text, branch: ctx.branch, part: ctx.part };
    if (!(hasOr || hasParts || stimItems)) {
      out.push({ item, container: false, ref: ctx.ref, stimulus: ctx.stimulus, ...base });
      return;
    }
    out.push({ item, container: true, ref: ctx.ref, ...base });
    const sub = { ...ctx, stimulusText: text };
    const group = (own != null || stimItems) ? (groups += 1) : null;
    const tail = group ? `@s${group}` : '';
    if (hasOr) item.or.forEach((b, i) => visit(b, { ...sub, ref: ctx.ref + (i === 0 ? '/a' : '/b'), branch: i === 0 ? 'a' : 'b' }));
    if (hasParts) item.parts.forEach((p, i) => visit(p, { ...sub, ref: `${ctx.ref}.p${i + 1}${tail}`, part: i + 1, stimulus: group }));
    if (stimItems) stimItems.forEach((s) => visit(s, { ...sub, ref: `${ctx.key}#${next(ctx.key)}${tail}`, stimulus: group }));
  };
  topItems(examJson).forEach((it) => {
    if (it.removed === true) return;
    const key = it.slot || it.type || '-';
    const hit = it.slot ? rows.get(it.slot) : null;
    const stim = isObj(it.stimulus) && Array.isArray(it.stimulus.items);
    // a stimulus group's MCQs take the n; the group node itself does not
    visit(it, { key, ref: stim ? null : `${key}#${next(key)}`, slot: it.slot || null, sectionId: hit ? hit.sectionId : null, slotRow: hit ? hit.row : null, stimulusText: null });
  });
  return out;
}

const leaves = (examJson) => walk(examJson).filter((n) => !n.container);

module.exports = { walk, leaves, topItems, stimulusTextOf };
