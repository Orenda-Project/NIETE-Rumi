/**
 * A self-administered battery on the child-test rows (V1.6.18): the session carries how it was run and the
 * device's sync state; each subtask is one child_test_blocks row (block = the task id) holding the phone's
 * evidence in `responses`, the phone's marks in `ai_marks` when the phone could score it (tap / keypad), how the
 * child answered in `response_mode`, and the recordings in `audio_r2_key` / `audio_r2_keys`. A tap or keypad
 * score is the SA scale, never written under the recorded test's names (clpm, cwpm, …).
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
const PHONE_SCORER = 'tap-v1';
const SA_SCORER_MARKS = 'sa-marks-v1'; // sa/score.js VERSION
const MODES = ['tap', 'keypad', 'keyboard', 'record', 'oral'];
const DEVICE_FIELDS = ['ua', 'bundle_v', 'offline', 'skew_ms', 'mic_ok', 'mic_rms', 'persisted', 'voice'];
// the ruling events a session keeps (device.events); past the cap the oldest are kept
const MAX_KEPT_EVENTS = 200;
// round 7b: a skip or stop (sa-api.service.js STOP_TYPES) is never dropped by the cap — the dashboard audits them
const AUDIT = new Set(['back', 'end_section', 'end_test', 'restart', 'silence_repeat', 'under20_move_on']);

function keepEvents(had, events) {
  const list = Array.isArray(had) ? had.slice() : [];
  const seen = new Set(list.map((e) => e.seq));
  for (const e of events) if (!seen.has(e.seq)) { seen.add(e.seq); list.push(e); }
  const sorted = list.sort((x, y) => x.seq - y.seq);
  const kept = new Set(sorted.filter((e) => !AUDIT.has(e.type)).slice(0, MAX_KEPT_EVENTS));
  return sorted.filter((e) => AUDIT.has(e.type) || kept.has(e));
}

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
  let { error } = await supabase.from(BLOCKS).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error && 'response_mode' in patch && /response_mode/.test(error.message || '')) {
    // before V1.6.21: the mode stays in responses[0], which the migration backfills from
    const { response_mode: _, ...rest } = patch; // eslint-disable-line no-unused-vars
    ({ error } = await supabase.from(BLOCKS).update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id));
  }
  return error ? fail(where, error, { blockId: id }) : { ok: true };
}

/** The device's sync state on the session; a field already set (the device's start) is kept. */
async function markSynced(sessionId, { lastSeq, clientStartedAt, clientFinishedAt, device, block, events } = {}) {
  const got = await getSession(sessionId);
  if (!got.ok) return got;
  if (!got.session) return { ok: false, reason: 'no_session' };
  const s = got.session;
  const dev = { ...(s.device || {}) };
  for (const f of DEVICE_FIELDS) if (device && device[f] !== undefined) dev[f] = device[f];
  if (Number.isInteger(lastSeq) && !(dev.last_seq >= lastSeq)) dev.last_seq = lastSeq;
  if (block && !dev.block) dev.block = block;
  if (Array.isArray(events) && events.length) dev.events = keepEvents(dev.events, events);
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

/** The coach's new part for a session not finished yet (switch sa_resume_repick): replaces the block setClient kept. */
async function setBlock(sessionId, block) {
  const got = await getSession(sessionId);
  if (!got.ok) return got;
  if (!got.session) return { ok: false, reason: 'no_session' };
  const { error } = await supabase.from(SESSIONS).update({ device: { ...(got.session.device || {}), block } }).eq('id', sessionId);
  if (error) return fail('setBlock', error, { sessionId });
  return { ok: true };
}

const round2 = (n) => Math.round(n * 100) / 100;
const num = (n) => (Number.isFinite(n) ? n : null);

/** The phone's marks on the SA scale: tap (with the chance correction) or keypad; null for anything else. */
function phoneMarks(r) {
  if (r.mode === 'tap') {
    const n = num(r.options_n);
    const right = Number(r.correct) || 0;
    const wrong = Number(r.incorrect) || 0;
    return {
      tap_correct: num(r.correct),
      tap_attempted: num(r.attempted),
      options_n: n,
      chance_corrected: n > 1 ? round2(Math.max(0, right - wrong / (n - 1))) : null,
      items_per_min: num(r.per_minute),
      stop_reason: r.stop_reason || null,
    };
  }
  if (r.mode === 'keypad' || r.mode === 'keyboard') {
    return { keypad_correct: num(r.correct), keypad_attempted: num(r.attempted), items_per_min: num(r.per_minute), stop_reason: r.stop_reason || null };
  }
  return null;
}

/** One subtask's result from the phone: [{task_id, scored_on, answers[], ...}] */
async function putResults(sessionId, results, lang) {
  for (const r of results) {
    // eslint-disable-next-line no-await-in-loop
    const got = await rowFor(sessionId, r.task_id);
    if (!got.ok) return got;
    if (got.row.ai_marks) continue;
    const { answers, ...summary } = r;
    const responses = [{ kind: 'result', ...summary }, ...(Array.isArray(answers) ? answers : []).map((a) => ({ kind: 'answer', ...a }))];
    const patch = { responses, lang: lang || null, ...(MODES.includes(r.mode) ? { response_mode: r.mode } : {}) };
    const marks = r.scored_on === 'phone' ? phoneMarks(r) : null;
    if (marks) {
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
  const patch = {};
  if (row.ai_marks) {
    // A spoken answer that comes after the SA scorer marked its task (CHILD_TEST_SA_CLIP_WAIT_S on: the scorer no
    // longer waits for every clip). The marks are written once (DB trigger child_test_blocks_keep_marks), so they
    // stand; the clip's key joins the row, where the independent scorers and the report hear it. Phone marks and a
    // clip the row already has stay frozen.
    const late = itemId && row.ai_marks.version === SA_SCORER_MARKS && Number(process.env.CHILD_TEST_SA_CLIP_WAIT_S) > 0
      && !(Array.isArray(row.audio_r2_keys) && row.audio_r2_keys.some((k) => k && k.i === itemId));
    if (!late) return { ok: false, reason: 'frozen' };
    const kept = await updateRow(row.id, { audio_r2_keys: [...row.audio_r2_keys || [], { i: itemId, key, late: true }] }, 'setAudio');
    return kept.ok ? { ok: true, late: true } : kept;
  }
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

const hasAudio = (r) => Boolean(r.audio_r2_key || (Array.isArray(r.audio_r2_keys) && r.audio_r2_keys.length));

/**
 * A spoken subtask whose answers have arrived but whose recording is still on the phone. Never one that cannot
 * have a recording: skipped by the engine (skipped_*), no microphone, audio not kept, a recorder that never
 * opened (recorded: false), or a spoken task with nothing attempted.
 */
function audioWaiting(r) {
  if (!['record', 'oral'].includes(r.response_mode) || hasAudio(r)) return false;
  const result = (Array.isArray(r.responses) && r.responses.find((x) => x && x.kind === 'result')) || null;
  if (!result) return false;
  const reason = typeof result.stop_reason === 'string' ? result.stop_reason : '';
  if (reason.startsWith('skipped_') || reason === 'mic_unavailable' || result.audio === 'not_kept') return false;
  if (result.recorded === false) return false; // the engine says the recorder never opened (e.g. ended before the begin line)
  return !(r.response_mode === 'oral' && result.attempted === 0);
}

// Round 7b (sa_end_test_restart): a restarted child's ended attempt, set aside on the same session (one session per drawn
// child: child_test_sessions.draw_id is unique). Its rows are renamed zz.r<n>_<task> (sa/set-aside.js: still a valid block
// name for the DB's CHECK); every task reader leaves them out, the scorer (ai_reason not final:sa_*) and the recovery sweep
// (final:*) pass them over.
const { isSetAside, setAsideName, attemptOf } = require('./sa/set-aside');
const TASK_ROW = /^[a-z]{2}\.[a-z0-9_]{1,40}$/;

/**
 * A new attempt for a child the coach ended early (Restart test): the ended attempt's rows set aside (renamed; an unscored
 * one parked final:restarted, never scored), its kept events moved below one `restart` event (seq -1; the new attempt's
 * phone events start at 0), and the session takes the phone's new id and block. → { ok, attempt } (attempt = 1, 2 …).
 */
async function restartAttempt(sessionId, { clientSessionId, block = null, at = new Date().toISOString() } = {}) {
  const got = await supabase.from(SESSIONS).select('id, client_session_id, status, device').eq('id', sessionId).limit(1);
  if (got.error) return fail('restartAttempt', got.error, { sessionId });
  const s = (got.data || [])[0];
  if (!s) return { ok: false, reason: 'no_session' };
  const rows = await supabase.from(BLOCKS).select('id, block, ai_marks').eq('session_id', sessionId);
  if (rows.error) return fail('restartAttempt', rows.error, { sessionId });
  const dev = { ...(s.device || {}) };
  const had = Array.isArray(dev.events) ? dev.events.slice().sort((x, y) => x.seq - y.seq) : [];
  const before = Math.max(had.filter((e) => e.type === 'restart').length,
    ...(rows.data || []).map((r) => attemptOf(r.block)));
  const attempt = before + 1;
  for (const r of (rows.data || []).filter((x) => TASK_ROW.test(String(x.block)) && !isSetAside(x.block))) {
    // the name first (never refused); then, only while no marks are written, the row is parked so nothing scores it
    // eslint-disable-next-line no-await-in-loop
    let { error } = await supabase.from(BLOCKS).update({ block: setAsideName(attempt, r.block), updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) return fail('restartAttempt', error, { sessionId, blockId: r.id });
    // eslint-disable-next-line no-await-in-loop
    ({ error } = await supabase.from(BLOCKS).update({ ai_status: 'failed', ai_reason: 'final:restarted' }).eq('id', r.id).is('ai_marks', null));
    if (error) return fail('restartAttempt', error, { sessionId, blockId: r.id });
  }
  const moved = had.map((e, i) => ({ ...e, seq: i - had.length - 1 }));
  dev.events = moved.concat([{ seq: -1, type: 'restart', task_id: null, at, data: { by: 'coach', prev: s.client_session_id || null, attempt } }]);
  delete dev.last_seq;
  if (block) dev.block = block; else delete dev.block;
  const { error } = await supabase.from(SESSIONS).update({ device: dev, client_session_id: clientSessionId || null }).eq('id', sessionId);
  if (error) return fail('restartAttempt', error, { sessionId });
  return { ok: true, attempt };
}

async function summary(sessionId) {
  const [sess, blocks] = await Promise.all([
    getSession(sessionId),
    supabase.from(BLOCKS).select('block, responses, response_mode, audio_r2_key, audio_r2_keys').eq('session_id', sessionId),
  ]);
  if (!sess.ok) return sess;
  if (blocks.error) return fail('summary', blocks.error, { sessionId });
  const rows = (blocks.data || []).filter((r) => !isSetAside(r.block));
  const dev = (sess.session && sess.session.device) || {};
  return {
    ok: true,
    lastSeq: Number.isInteger(dev.last_seq) ? dev.last_seq : null,
    block: dev.block || null,
    tasksDone: rows.filter((r) => Array.isArray(r.responses) && r.responses.length).map((r) => r.block),
    audio: rows.filter(hasAudio).map((r) => r.block),
    audioWaiting: rows.filter(audioWaiting).map((r) => r.block),
  };
}

module.exports = { PARKED, PHONE_SCORER, phoneMarks, findByClient, setClient, setBlock, markSynced, putResults, setAudio, summary, restartAttempt, __internals: { keepEvents } };
