/**
 * The Learning assessment's own rows (V1.6.18): the engine's event log and its per-task results,
 * both children of child_test_sessions. Upserts, so a batch the phone re-sends after a dropped
 * answer changes nothing. Never throws: { ok: true, ... } | { ok: false, error }.
 */

const supabase = require('../../config/supabase');
const { logError } = require('../../utils/logger');

const EVENTS = 'child_test_sa_events';
const RESULTS = 'child_test_sa_results';

function fail(where, error, extra) {
  logError(`child_test.sa_store.${where}`, { ...extra, error: error && error.message });
  return { ok: false, error: (error && error.message) || 'failed' };
}

async function putEvents(sessionId, events) {
  const rows = events.map((e) => ({ session_id: sessionId, ...e }));
  const { error } = await supabase.from(EVENTS).upsert(rows, { onConflict: 'session_id,seq', ignoreDuplicates: true });
  if (error) return fail('putEvents', error, { sessionId });
  return { ok: true };
}

async function putResults(sessionId, results) {
  const at = new Date().toISOString();
  const rows = results.map((r) => ({ session_id: sessionId, task_id: r.task_id, result: r.result, updated_at: at }));
  const { error } = await supabase.from(RESULTS).upsert(rows, { onConflict: 'session_id,task_id' });
  if (error) return fail('putResults', error, { sessionId });
  return { ok: true };
}

async function setResultAudio(sessionId, taskId, key) {
  const { error } = await supabase.from(RESULTS)
    .upsert({ session_id: sessionId, task_id: taskId, audio_r2_key: key, updated_at: new Date().toISOString() }, { onConflict: 'session_id,task_id' });
  if (error) return fail('setResultAudio', error, { sessionId, taskId });
  return { ok: true };
}

async function summary(sessionId) {
  const [ev, res] = await Promise.all([
    supabase.from(EVENTS).select('seq').eq('session_id', sessionId).order('seq', { ascending: false }).limit(1),
    supabase.from(RESULTS).select('task_id, result, audio_r2_key').eq('session_id', sessionId),
  ]);
  if (ev.error) return fail('summary', ev.error, { sessionId });
  if (res.error) return fail('summary', res.error, { sessionId });
  const rows = res.data || [];
  return {
    ok: true,
    lastSeq: ev.data && ev.data[0] ? ev.data[0].seq : null,
    tasksDone: rows.filter((r) => r.result && Object.keys(r.result).length).map((r) => r.task_id),
    audio: rows.filter((r) => r.audio_r2_key).map((r) => r.task_id),
  };
}

module.exports = { putEvents, putResults, setResultAudio, summary };
