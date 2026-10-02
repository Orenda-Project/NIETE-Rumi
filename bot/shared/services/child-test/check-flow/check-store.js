'use strict';

/**
 * Child test check Flow (bd-s1oo0.6) — the reads and writes the check needs.
 *
 * L3's store.js owns the child-test tables (lanes/L3/STORE_API.md). When it is on the branch, every
 * session and block call goes through it: getSession, listBlocks, saveCoachMarks (written ONCE, next to
 * the AI's marks: checked_at IS NULL guard plus a DB trigger), attachBlockMedia (creates the row of a
 * block that never got a recording) and recordTiming. Until it lands, the same semantics run here on
 * the same columns, so the check behaves identically either way.
 *
 * Two reads stay here because store.js has no function for them: the draw's roll number (for the
 * coach-facing label) and the coach's phone and language (the users table is not a child-test table).
 *
 * Nothing here writes ai_marks. Every function returns { ok, ... } and logs its own failure.
 */

const supabase = require('../../../config/supabase');
const { logError } = require('../../../utils/logger');

let L3 = null;
try {
  // eslint-disable-next-line global-require
  L3 = require('../store');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}
const viaStore = (fn) => (L3 && typeof L3[fn] === 'function' ? L3[fn] : null);

async function getSession(sessionId) {
  if (viaStore('getSession')) return viaStore('getSession')(sessionId);
  const { data, error } = await supabase.from('child_test_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) {
    logError('[child-test] check getSession failed', { sessionId, error: error.message });
    return { ok: false, error: error.message };
  }
  return { ok: true, session: data || null };
}

/** @returns {{ok: boolean, blocks?: Object<string, object>}} the session's block rows by block name */
async function getBlocks(sessionId) {
  let rows;
  if (viaStore('listBlocks')) {
    const r = await viaStore('listBlocks')(sessionId);
    if (!r.ok) return r;
    rows = r.blocks || [];
  } else {
    const { data, error } = await supabase.from('child_test_blocks').select('*').eq('session_id', sessionId);
    if (error) {
      logError('[child-test] check listBlocks failed', { sessionId, error: error.message });
      return { ok: false, error: error.message };
    }
    rows = data || [];
  }
  const blocks = {};
  for (const row of rows) blocks[row.block] = row;
  return { ok: true, blocks };
}

async function saveDirect(sessionId, block, coachMarks, coachEdits) {
  const patch = { coach_marks: coachMarks, coach_edits: coachEdits, checked_at: new Date().toISOString() };
  const upd = await supabase.from('child_test_blocks').update(patch)
    .eq('session_id', sessionId).eq('block', block).is('checked_at', null).select();
  if (upd.error) {
    logError('[child-test] check saveCoachMarks failed', { sessionId, block, error: upd.error.message });
    return { ok: false, error: upd.error.message };
  }
  if ((upd.data || []).length) return { ok: true, block: upd.data[0] };
  const cur = await supabase.from('child_test_blocks').select('*').eq('session_id', sessionId).eq('block', block).maybeSingle();
  if (cur.error) {
    logError('[child-test] check saveCoachMarks failed', { sessionId, block, error: cur.error.message });
    return { ok: false, error: cur.error.message };
  }
  if (cur.data) return { ok: false, alreadyChecked: true, block: cur.data };
  const ins = await supabase.from('child_test_blocks').insert({ session_id: sessionId, block, ...patch }).select();
  if (ins.error) {
    logError('[child-test] check saveCoachMarks failed (new block row)', { sessionId, block, error: ins.error.message });
    return { ok: false, error: ins.error.message };
  }
  return { ok: true, block: (ins.data || [])[0] };
}

/**
 * The coach's marks for one block, with what changed — once. A block that never got a recording has
 * no row yet; one is made for it first.
 * @returns {{ok: true} | {ok: false, alreadyChecked?: true, block?: object, error?: string}}
 */
async function saveCoachBlock(sessionId, block, { coachMarks, coachEdits, rowExists = true }) {
  const save = viaStore('saveCoachMarks');
  if (!save) return saveDirect(sessionId, block, coachMarks, coachEdits);
  if (!rowExists && viaStore('attachBlockMedia')) {
    const made = await viaStore('attachBlockMedia')({ sessionId, block });
    if (!made.ok) return made;
  }
  return save({ sessionId, block, coachMarks, coachEdits });
}

/** The check is finished: a timing on the session (its status stays L4's to set). */
async function markCheckDone(sessionId, at = new Date()) {
  if (viaStore('recordTiming')) return viaStore('recordTiming')(sessionId, 'check.done', at);
  const cur = await supabase.from('child_test_sessions').select('timings').eq('id', sessionId).maybeSingle();
  if (cur.error || !cur.data) {
    logError('[child-test] check recordTiming failed', { sessionId, error: cur.error ? cur.error.message : 'no row' });
    return { ok: false };
  }
  const timings = { ...(cur.data.timings || {}) };
  if (!timings['check.done']) timings['check.done'] = at.toISOString();
  const { error } = await supabase.from('child_test_sessions').update({ timings }).eq('id', sessionId).select();
  if (error) {
    logError('[child-test] check recordTiming failed', { sessionId, error: error.message });
    return { ok: false };
  }
  return { ok: true, timings };
}

/** Roll number for the coach-facing label; null when the draw row is not there. */
async function getRollNumber(drawId) {
  if (!drawId) return null;
  const { data, error } = await supabase.from('child_test_draws').select('roll_number').eq('id', drawId).maybeSingle();
  if (error) return null;
  return data && data.roll_number != null ? String(data.roll_number) : null;
}

async function getCoach(userId) {
  const { data, error } = await supabase.from('users').select('id, phone_number, preferred_language').eq('id', userId).maybeSingle();
  if (error) {
    logError('[child-test] check: coach read failed', { userId, error: error.message });
    return null;
  }
  return data || null;
}

module.exports = { getSession, getBlocks, saveCoachBlock, markCheckDone, getRollNumber, getCoach };
