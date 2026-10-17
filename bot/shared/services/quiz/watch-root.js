'use strict';
/**
 * The watch root (app_settings VALUE web_quiz_watch_root): the code a class-less child's video codes hang under. Those
 * codes copy the root's teacher but are not that teacher's class; a class child's own lesson code (parent = the class's
 * code) is. One parse and one code rule for every reader (the teacher report, the join queue).
 *
 * A leaf on purpose: it requires only the settings client and the logger, so a module on the strip dry run's path (the
 * join queue) can read the root without pulling in the report's stack.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

// → the root's id, or null (absent, not an id, or unreadable: nothing is left out). 30 s cache.
const WATCH_ROOT_KEY = 'web_quiz_watch_root';
const ID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let watchRootCache = null; // { at, id }
async function watchRootId(now = Date.now()) {
  if (watchRootCache && now - watchRootCache.at < 30 * 1000) return watchRootCache.id;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', WATCH_ROOT_KEY).maybeSingle();
    if (error) throw new Error(error.message);
    let v = data && data.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
    if (typeof v === 'string') v = v.trim().toLowerCase();   // one spelling, as the other watch-root readers parse it
    watchRootCache = { at: now, id: typeof v === 'string' && ID_RX.test(v) ? v : null };
    return watchRootCache.id;
  } catch (err) {
    logToFile('⚠️ teacher report: watch root unreadable — no code left out', { error: err.message });
    return null;
  }
}
// a code query without the watch root's children (a NULL parent is kept: `neq` alone would drop it)
const notUnderWatchRoot = (q, root) => (root ? q.or(`parent_share_code_id.is.null,parent_share_code_id.neq.${root}`) : q);

// The ids of `codes` (rows with id + parent_share_code_id) that ARE the root or whose parent chain reaches it, at any
// depth (a watch child's lesson code, a friend's code under it, a friend's friend's code, ...). Parents not in `codes`
// are read with `readCodes(ids)` (rows with id + parent_share_code_id), one read per level. Fail closed: a loop, a
// chain past MAX_DEPTH or a failed read counts as under; a parent that no longer exists ends the chain. No root: none.
const MAX_DEPTH = 50;
async function underWatchRoot(codes, root, readCodes) {
  const under = new Set();
  if (!root) return under;
  const parentOf = new Map(codes.map((c) => [c.id, c.parent_share_code_id || null]));
  const top = (cid) => { // the first id on the chain whose parent is not known yet, or null (the chain ends or loops)
    const seen = new Set();
    for (let cur = cid; cur && cur !== root && !seen.has(cur); cur = parentOf.get(cur)) {
      seen.add(cur);
      if (!parentOf.has(cur)) return cur;
    }
    return null;
  };
  for (let level = 0; level < MAX_DEPTH; level++) {
    const missing = [...new Set(codes.map((c) => top(c.id)).filter(Boolean))];
    if (!missing.length) break;
    let got;
    try { got = await readCodes(missing); } catch (_) { break; }   // the chains left unknown count as under
    const byId = new Map((got || []).map((r) => [r.id, r.parent_share_code_id || null]));
    for (const m of missing) parentOf.set(m, byId.has(m) ? byId.get(m) : null);
  }
  for (const c of codes) {
    const seen = new Set();
    let cur = c.id;
    while (cur && cur !== root && !seen.has(cur) && parentOf.has(cur) && seen.size <= MAX_DEPTH) { seen.add(cur); cur = parentOf.get(cur); }
    if (cur) under.add(c.id);   // reached the root, looped, ran past the cap, or stopped at an unread parent
  }
  return under;
}

module.exports = { watchRootId, notUnderWatchRoot, underWatchRoot };
