/**
 * A self-administered battery on the child-test rows (V1.6.18): the session carries how it was run and the
 * device's sync state; each subtask is one child_test_blocks row (block = the task id) holding the phone's
 * evidence in `responses`, the phone's marks in `ai_marks` when the phone could score it (tap / keypad), and
 * the recordings in `audio_r2_key` / `audio_r2_keys`.
 *
 * Idempotent: a row whose marks are written is never touched again (the write-once trigger would refuse it
 * anyway), so a batch the phone re-sends after a lost answer changes nothing. A recording on a row nobody
 * scores yet is parked as a FINAL failure (`final:sa_score_later`) unless scoring is asked for, so the
 * recovery sweep (conversation/recovery.js) never scores it — and never pays for it — on its own.
 * Never throws: { ok: true, ... } | { ok: false, error | reason }.
 */

const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');

const SESSIONS = 'child_test_sessions';
const BLOCKS = 'child_test_blocks';
const PARKED = 'final:sa_score_later';
const PHONE_SCORER = 'sa-tap-v1';
const DEVICE_FIELDS = ['ua', 'bundle_v', 'offline', 'skew_ms', 'mic_ok', 'mic_rms'];

function fail(where, error, extra) {
  logError(`child_test.sa_store.${where}`, { ...extra, error: error && error.message });
  return { ok: false, error: (error && error.message) || 'failed' };
}

const isUniqueViolation = (e) => !!e && (e.code === '23505' || /duplicate key/i.test(e.message || ''));

async function getSession(sessionId) {
  const { data, error } = await supabase.from(SESSIONS).select('id, admin_mode, device, client_started_at, client_finished_at').eq('id', sessionId).limit(1);
  if (error) return fail('getSession', error, { sessionId });
  return { ok: true, session: (data || [])[0] || null };
}

/** The block row for a task, made if missing. */
async function rowFor(sessionId, block) {
  const read = async () => supabase.from(BLOCKS).select('id, ai_marks, ai_status, audio_r2_key, audio_r2_keys, responses')
    .eq('session_id', sessionId).eq('block', block).limit(1);
  let { data, error } = await read();
  if (error) return fail('rowFor', error, { sessionId, block });
  if (data && data[0]) return { ok: true, row: data[0] };
  const ins = await supabase.from(BLOCKS).insert({ session_id: sessionId, block, ai_status: 'pending' })
    .select('id, ai_marks, ai_status, audio_r2_key, audio_r2_keys, responses');
  if (!ins.error) return { ok: true, row: (ins.data || [])[0] };
  if (!isUniqueViolation(ins.error)) return fail('rowFor', ins.error, { sessionId, block });
  ({ data, error } = await read());
  if (error || !data || !data[0]) return fail('rowFor', error || { message: 'row vanished' }, { sessionId, block });
  return { ok: true, row: data[0] };
}

async function updateRow(id, patch, where) {
  const { error } = await supabase.from(BLOCKS).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  return error ? fail(where, error, { blockId: id }) : { ok: true };
}

/** The device's sync state on the session; a field already set (the device's start) is kept. */
async function markSynced(sessionId, { lastSeq, clientStartedAt, clientFinishedAt, device, block } = {}) {
  const got = await getSession(sessionId);
  if (!got.ok) return got;
  if (!got.session) return { ok: false, reason: 'no_session' };
  const s = got.session;
  const dev = { ...(s.device || {}) };
  for (const f of DEVICE_FIELDS) if (device && device[f] !== undefined) dev[f] = device[f];
  if (Number.isInteger(lastSeq) && !(dev.last_seq >= lastSeq)) dev.last_seq = lastSeq;
  if (block && !dev.block) dev.block = block;
  const patch = {
    admin_mode: s.admin_mode || 'coach_present',
    synced_at: new Date().toISOString(),
    device: dev,
    ...(clientStartedAt && !s.client_started_at ? { client_started_at: clientStartedAt } : {}),
    ...(clientFinishedAt && !s.client_finished_at ? { client_finished_at: clientFinishedAt } : {}),
  };
  const { error } = await supabase.from(SESSIONS).update(patch).eq('id', sessionId);
  if (error) return fail('markSynced', error, { sessionId });
  return { ok: true, device: dev };
}

/** The session the phone named with its own id, if the outcome carrying that id has arrived. */
async function findByClient(clientSessionId) {
  const { data, error } = await supabase.from(SESSIONS).select('id').eq('client_session_id', clientSessionId).limit(1);
  if (error) return fail('findByClient', error, {});
  return { ok: true, sessionId: data && data[0] ? data[0].id : null };
}

/** The phone's own id for the session and the part of the battery it gives the child. */
async function setClient(sessionId, { clientSessionId, block } = {}) {
  const got = await getSession(sessionId);
  if (!got.ok) return got;
  if (!got.session) return { ok: false, reason: 'no_session' };
  const patch = { device: { ...(got.session.device || {}), ...(block && !(got.session.device || {}).block ? { block } : {}) } };
  if (clientSessionId) patch.client_session_id = clientSessionId;
  const { error } = await supabase.from(SESSIONS).update(patch).eq('id', sessionId);
  if (error) return fail('setClient', error, { sessionId });
  return { ok: true };
}

const PHONE_MARKS = ['attempted', 'correct', 'incorrect', 'per_minute', 'time_used_ms', 'time_left_ms', 'stop_reason', 'last_item_index', 'options_n', 'resumed'];

/** One subtask's result from the phone: [{task_id, scored_on, answers[], ...}] */
async function putResults(sessionId, results, lang) {
  for (const r of results) {
    // eslint-disable-next-line no-await-in-loop
    const got = await rowFor(sessionId, r.task_id);
    if (!got.ok) return got;
    if (got.row.ai_marks) continue;
    const { answers, ...summary } = r;
    const responses = [{ kind: 'result', ...summary }, ...(Array.isArray(answers) ? answers : []).map((a) => ({ kind: 'answer', ...a }))];
    const patch = { responses, lang: lang || null };
    if (r.scored_on === 'phone') {
      const marks = { scorer: PHONE_SCORER };
      for (const k of PHONE_MARKS) if (r[k] !== undefined) marks[k] = r[k];
      Object.assign(patch, { ai_marks: marks, ai_status: 'scored', ai_model_versions: { scorer: PHONE_SCORER }, ai_scored_at: new Date().toISOString() });
    }
    // eslint-disable-next-line no-await-in-loop
    const out = await updateRow(got.row.id, patch, 'putResults');
    if (!out.ok) return out;
  }
  return { ok: true };
}

/** A recording for a task (itemId: one spoken answer of several). Scored later only when asked. */
async function setAudio(sessionId, taskId, itemId, key, { scoreLater = false } = {}) {
  const got = await rowFor(sessionId, taskId);
  if (!got.ok) return got;
  const row = got.row;
  if (row.ai_marks) return { ok: false, reason: 'frozen' };
  const patch = {};
  if (itemId) {
    const keys = (Array.isArray(row.audio_r2_keys) ? row.audio_r2_keys : []).filter((k) => k && k.i !== itemId);
    patch.audio_r2_keys = [...keys, { i: itemId, key }];
  } else {
    patch.audio_r2_key = key;
  }
  if (scoreLater) Object.assign(patch, { ai_status: 'pending', ai_reason: null });
  else Object.assign(patch, { ai_status: 'failed', ai_reason: PARKED });
  return updateRow(row.id, patch, 'setAudio');
}

async function summary(sessionId) {
  const [sess, blocks] = await Promise.all([
    getSession(sessionId),
    supabase.from(BLOCKS).select('block, responses, audio_r2_key, audio_r2_keys').eq('session_id', sessionId),
  ]);
  if (!sess.ok) return sess;
  if (blocks.error) return fail('summary', blocks.error, { sessionId });
  const rows = blocks.data || [];
  const dev = (sess.session && sess.session.device) || {};
  return {
    ok: true,
    lastSeq: Number.isInteger(dev.last_seq) ? dev.last_seq : null,
    block: dev.block || null,
    tasksDone: rows.filter((r) => Array.isArray(r.responses) && r.responses.length).map((r) => r.block),
    audio: rows.filter((r) => r.audio_r2_key || (Array.isArray(r.audio_r2_keys) && r.audio_r2_keys.length)).map((r) => r.block),
  };
}

module.exports = { PARKED, PHONE_SCORER, findByClient, setClient, markSynced, putResults, setAudio, summary };
