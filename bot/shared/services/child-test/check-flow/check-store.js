'use strict';

/**
 * Child test check Flow — the reads and writes the check needs.
 *
 * L3's store.js owns the child-test tables (lanes/L3/STORE_API.md). When it is on the branch, every
 * session and block call goes through it: getSession, listBlocks, saveCoachMarks (written ONCE, next to
 * the AI's marks: checked_at IS NULL guard plus a DB trigger), attachBlockMedia (creates the row of a
 * block that never got a recording) and recordTiming. Until it lands, the same semantics run here on
 * the same columns, so the check behaves identically either way.
 *
 * The child's name and classroom come from the roster (getChild); no roll is read or shown (L25). One read stays here because
 * store.js has no function for it: the coach's phone and language (users is not a child-test table).
 *
 * Nothing here writes ai_marks. Every function returns { ok, ... } and logs its own failure.
 */

const supabase = require('../../../config/supabase');
const { logError } = require('../../../utils/logger');
const { classLabels } = require('../draw/class-label');

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

/**
 * A timing on the session, set once (a second stamp keeps the first time). The check stamps
 * check.opened at INIT and check.submitted when the last block is saved and again at the Flow's
 * completion; L8 measures the check from these. The session's status stays L4's to set. Never throws.
 */
async function stamp(sessionId, key, at = new Date()) {
  try {
    if (viaStore('recordTiming')) return await viaStore('recordTiming')(sessionId, key, at);
    const cur = await supabase.from('child_test_sessions').select('timings').eq('id', sessionId).maybeSingle();
    if (cur.error || !cur.data) {
      logError('[child-test] check recordTiming failed', { sessionId, key, error: cur.error ? cur.error.message : 'no row' });
      return { ok: false };
    }
    const timings = { ...(cur.data.timings || {}) };
    if (timings[key]) return { ok: true, timings };
    timings[key] = at.toISOString();
    const { error } = await supabase.from('child_test_sessions').update({ timings }).eq('id', sessionId).select();
    if (error) {
      logError('[child-test] check recordTiming failed', { sessionId, key, error: error.message });
      return { ok: false };
    }
    return { ok: true, timings };
  } catch (err) {
    logError('[child-test] check recordTiming threw', { sessionId, key, error: err.message });
    return { ok: false };
  }
}

/** The check is finished: every block is saved. */
const markCheckSubmitted = (sessionId, at) => stamp(sessionId, 'check.submitted', at);

/**
 * The child as the coach knows them (CONTRACT §19): full name from the roster, the classroom from the
 * session's class (conversation/identity.js turns these into "Ayesha Khan · 3-A"). No roll (L25). The
 * names go to the coach's WhatsApp only — never into a log line here. Missing pieces stay null.
 * @returns {Promise<{displayName: string|null, displayNameUrdu: string|null, classShort: string|null, classLabel: string|null, classLabelUr: string|null}>}
 */
async function getChild(session) {
  const out = { displayName: null, displayNameUrdu: null, classShort: null, classLabel: null, classLabelUr: null };
  if (!session) return out;
  let draw = null;
  if (session.draw_id && (!session.student_id || !session.class_id)) {
    if (viaStore('getDraw')) {
      const r = await viaStore('getDraw')(session.draw_id);
      draw = r.ok ? r.draw : null;
    } else {
      const { data, error } = await supabase.from('child_test_draws').select('student_id, class_id').eq('id', session.draw_id).maybeSingle();
      draw = error ? null : data;
    }
  }
  const classId = session.class_id || (draw && draw.class_id) || null;
  if (classId) {
    const { data: cls, error: cErr } = await supabase.from('classes').select('id, grade_code, section, shift_code').eq('id', classId).maybeSingle();
    if (cErr) logError('[child-test] check: class read failed', { sessionId: session.id, error: cErr.message });
    else if (cls) Object.assign(out, classLabels(cls));
  }
  const studentId = session.student_id || (draw && draw.student_id) || null;
  if (!studentId) return out;
  const { data, error } = await supabase.from('students').select('id, student_name, student_name_urdu').eq('id', studentId).maybeSingle();
  if (error) {
    logError('[child-test] check: child read failed', { sessionId: session.id, error: error.message });
    return out;
  }
  out.displayName = (data && data.student_name) || null;
  out.displayNameUrdu = (data && data.student_name_urdu) || null;
  return out;
}

async function getCoach(userId) {
  const { data, error } = await supabase.from('users').select('id, phone_number, preferred_language').eq('id', userId).maybeSingle();
  if (error) {
    logError('[child-test] check: coach read failed', { userId, error: error.message });
    return null;
  }
  return data || null;
}

module.exports = { getSession, getBlocks, saveCoachBlock, stamp, markCheckSubmitted, getChild, getCoach };
