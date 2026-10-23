'use strict';
/**
 * Which blocks of the coach battery a child has already taken at this school (app_settings `sa_block_by_history`,
 * default OFF), so the server can give a returning child a block they have not done.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 *   taken()    the blocks (B1..B5) of `blocks` (the form's block → task ids) holding a task this child answered in
 *              another self-administered session at the same school, any cycle (a returning child comes back from an
 *              earlier one): the child's other tested draws (store.listTestedDraws), their sessions, and those sessions' task rows (store.listBlocks). Reads only.
 *
 * Off, nothing here is read and the block is today's rotation alone.
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_block_by_history';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now()) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => supabase().from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa block history: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `blockByHistory`, else the setting. */
async function enabled(deps = {}) {
  if (deps.blockByHistory !== undefined) {
    return typeof deps.blockByHistory === 'function' ? (await deps.blockByHistory()) === true : deps.blockByHistory === true;
  }
  return on();
}

/** @returns {Promise<Set<string>>} never throws; a failed read is an empty history */
async function taken(store, { drawId, sessionId, mark, blocks }) {
  const out = new Set();
  try {
    const blockOf = new Map();
    for (const [b, tasks] of Object.entries(blocks || {})) for (const t of tasks || []) blockOf.set(t, b);
    const got = drawId ? await store.getDraw(drawId) : null;
    const me = got && got.ok ? got.draw : null;
    if (!me || !me.student_id || !me.school_id) return out;
    const all = await store.listTestedDraws(me.school_id);
    const mine = ((all && all.ok && all.draws) || [])
      .filter((x) => x.id !== me.id && x.student_id === me.student_id && x.status === 'tested');
    for (const x of mine) {
      // eslint-disable-next-line no-await-in-loop
      const s = await store.getSessionByDraw(x.id);
      const session = s && s.ok ? s.session : null;
      if (!session || session.id === sessionId || session.item_bank_version !== mark) continue;
      // eslint-disable-next-line no-await-in-loop
      const rows = await store.listBlocks(session.id);
      for (const r of (rows && rows.ok && rows.blocks) || []) if (blockOf.has(r.block)) out.add(blockOf.get(r.block));
    }
  } catch (err) {
    logToFile('⚠️ sa block history: read failed — no history', { drawId, error: err && err.message });
  }
  return out;
}

module.exports = { KEY, on, enabled, taken, _resetCache: () => { cache = null; } };
