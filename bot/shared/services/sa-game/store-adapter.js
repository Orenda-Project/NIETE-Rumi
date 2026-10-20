'use strict';
/**
 * Where the big flight's runs are kept (switch sa_game). One interface, two homes, chosen by what the database has:
 *
 *   child_test  a game-made draw + a child_test_sessions row (admin_mode 'self_run', channel 'web', selection_method
 *               'self', visit_key sa:<draw>:<PKT date>), its events and per-task results in the self-administered
 *               battery's own tables (child_test_sa_events / child_test_sa_results). Chosen only when the probe finds
 *               the self-run columns on child_test_sessions AND the results table; a run the database then refuses
 *               (a CHECK, a NOT NULL, a missing column) takes its draw back and falls to the runs table.
 *   runs        web_quiz_challenge_runs, one row per run: exercise 'battery', admin_mode 'self_run', meta.mode 'game';
 *               meta.events (by seq, first write wins), meta.results (by task id, last write wins), meta.audio (a task's
 *               recording) and meta.audio_items (per-item recordings, appended).
 *   none        neither would take the row: createRun answers { ok:false, reason:'store_not_ready' } and the phone
 *               keeps everything (the engine syncs it later).
 *
 *   createRun({ id, studentId, grade, lang, part, form, n, day })      → { ok, mode:'child_test'|'runs', id } | { ok:false, reason }
 *   saveBatch({ mode, sessionId, events, results })                    → { ok, lastSeq } | { ok:false, reason }
 *   registerAudio({ mode, sessionId, taskId, itemId, key, bytes, durationMs }) → { ok } | { ok:false, reason }
 *   readRun({ mode, sessionId })                                       → { ok, status, tasksDone, lastSeq } | { ok:false, reason }
 *   mode()                                                             the path last chosen (for the logs and the tests)
 *
 * The child-test SA tables are written through the coach battery's own store (child-test/sa-store.js: putEvents,
 * putResults, setResultAudio, summary) when it is in this tree; until then through CT_OWN below, which has the same names
 * and the same writes, so the switch-over is the one require in ctStore(). Never throws: { ok:false, error } instead.
 * Every stored result carries mode 'game'. No name, no phone; the student id stays in the row it belongs to.
 */
// required where used: loading this module (the router does, at boot) connects to nothing
const db = () => require('../../config/supabase'); // eslint-disable-line global-require
const { logError, logToFile } = require('../../utils/logger');

const RUNS = 'web_quiz_challenge_runs';
const SESSIONS = 'child_test_sessions';
const DRAWS = 'child_test_draws';
const EVENTS = 'child_test_sa_events';
const RESULTS = 'child_test_sa_results';
const EVENTS_KEPT = 6000; // per run in meta (a full battery is ≈ 2,000)
const META_TRIES = 5;
const PROBE_TTL_MS = 10 * 60 * 1000;
// What says "this database is not ready for this path" (not a passing fault): undefined column / table, a CHECK, a NOT
// NULL, a bad value for a column type, PostgREST's own "not in the schema cache".
const NOT_READY = new Set(['42703', '42P01', '23514', '23502', '22P02', 'PGRST204', 'PGRST205']);
const notReady = (e) => !!e && (NOT_READY.has(String(e.code)) || /does not exist|schema cache|violates check/i.test(String(e.message || '')));

let probe = { ok: null, at: 0 };
let lastMode = 'unknown';

function fail(where, error, extra) {
  logError(`sa_game.store.${where}`, { ...extra, error: error && String(error.message || error).slice(0, 200) });
  return { ok: false, error: (error && error.message) || 'failed' };
}

// ── the child-test SA tables (same names as child-test/sa-store.js) ───────────────────────────────────────────────
const CT_OWN = {
  async putEvents(sessionId, events) {
    const rows = events.map((e) => ({ session_id: sessionId, ...e }));
    const { error } = await db().from(EVENTS).upsert(rows, { onConflict: 'session_id,seq', ignoreDuplicates: true });
    return error ? fail('putEvents', error, { sessionId }) : { ok: true };
  },
  async putResults(sessionId, results) {
    const at = new Date().toISOString();
    const rows = results.map((r) => ({ session_id: sessionId, task_id: r.task_id, result: r.result, updated_at: at }));
    const { error } = await db().from(RESULTS).upsert(rows, { onConflict: 'session_id,task_id' });
    return error ? fail('putResults', error, { sessionId }) : { ok: true };
  },
  async setResultAudio(sessionId, taskId, key) {
    const { error } = await db().from(RESULTS)
      .upsert({ session_id: sessionId, task_id: taskId, audio_r2_key: key, updated_at: new Date().toISOString() }, { onConflict: 'session_id,task_id' });
    return error ? fail('setResultAudio', error, { sessionId, taskId }) : { ok: true };
  },
  async summary(sessionId) {
    const [ev, res] = await Promise.all([
      db().from(EVENTS).select('seq').eq('session_id', sessionId).order('seq', { ascending: false }).limit(1),
      db().from(RESULTS).select('task_id, result, audio_r2_key').eq('session_id', sessionId),
    ]);
    if (ev.error) return fail('summary', ev.error, { sessionId });
    if (res.error) return fail('summary', res.error, { sessionId });
    const rows = res.data || [];
    const seqs = (ev.data || []).map((r) => r.seq);
    return {
      ok: true,
      lastSeq: seqs.length ? Math.max(...seqs) : null,
      tasksDone: rows.filter((r) => r.result && Object.keys(r.result).length).map((r) => r.task_id),
      audio: rows.filter((r) => r.audio_r2_key).map((r) => r.task_id),
    };
  },
};

// the child test's own SA store when it speaks the calls this adapter makes; its merged shape (block rows, setAudio) does
// not, so the copy above stands until the game path is built on it
function ctStore() {
  try {
    const m = require('../child-test/sa-store'); // eslint-disable-line global-require
    return m && typeof m.putEvents === 'function' && typeof m.putResults === 'function' && typeof m.setResultAudio === 'function' ? m : CT_OWN;
  } catch (_) {
    return CT_OWN;
  }
}

/** The self-run columns and the SA results table are there (two reads of no rows; never a write). Cached 10 min. */
async function childTestReady() {
  if (probe.ok !== null && Date.now() - probe.at < PROBE_TTL_MS) return probe.ok;
  let ok = false;
  try {
    const [s, r] = await Promise.all([
      db().from(SESSIONS).select('admin_mode, client_session_id').limit(0),
      db().from(RESULTS).select('task_id').limit(0),
    ]);
    ok = !s.error && !r.error;
  } catch (_) {
    ok = false;
  }
  probe = { ok, at: Date.now() };
  return ok;
}

function demote(why) {
  probe = { ok: false, at: Date.now() };
  logToFile('⚠️ sa game store: child-test path refused — runs table from here', { why: String(why || '').slice(0, 160) });
}

const gradeNum = (g) => {
  const n = parseInt(String(g == null ? '' : g).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n <= 12 ? n : null;
};

// ── runs table ────────────────────────────────────────────────────────────────────────────────────────────────────
async function createRunRow(a) {
  const row = {
    id: a.id,
    student_id: a.studentId,
    exercise: 'battery',
    grade: gradeNum(a.grade),
    lang: a.lang === 'en' ? 'en' : 'ur',
    status: 'served',
    admin_mode: 'self_run',
    started_at: new Date().toISOString(),
    meta: { mode: 'game', part: a.part, form: a.form, n: a.n, day: a.day, exposure_n: a.exposureN == null ? null : a.exposureN, events: {}, results: {}, audio: {}, last_seq: null },
  };
  const { error } = await db().from(RUNS).insert(row);
  if (!error || error.code === '23505') return { ok: true, mode: 'runs', id: a.id };
  if (notReady(error)) return { ok: false, reason: 'store_not_ready', error: error.message };
  return fail('createRunRow', error, { runId: a.id });
}

/** A run's meta, rebuilt from a fresh read and written only if unchanged since (as web-quiz-challenge updateRunMeta). */
async function updateMeta(id, build) {
  for (let i = 0; i < META_TRIES; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { data: cur, error } = await db().from(RUNS).select('id, meta').eq('id', id).eq('exercise', 'battery').maybeSingle();
    if (error) return fail('readRun', error, { runId: id });
    if (!cur) return { ok: false, reason: 'not_found' };
    const meta = build(cur.meta && typeof cur.meta === 'object' ? JSON.parse(JSON.stringify(cur.meta)) : {});
    // eslint-disable-next-line no-await-in-loop
    const w = await db().from(RUNS).update({ meta }).eq('id', id).eq('meta', JSON.stringify(cur.meta)).select('id');
    if (w.error) return fail('updateMeta', w.error, { runId: id });
    if (w.data && w.data.length) return { ok: true, meta };
  }
  return fail('updateMeta', new Error('contended'), { runId: id });
}

async function saveBatchRuns({ sessionId, events, results }) {
  const out = await updateMeta(sessionId, (m) => {
    m.events = m.events || {};
    m.results = m.results || {};
    let kept = Object.keys(m.events).length;
    for (const e of events) {
      const k = String(e.seq);
      if (Object.prototype.hasOwnProperty.call(m.events, k)) continue; // first write wins, as (session_id, seq)
      if (kept >= EVENTS_KEPT) { m.events_dropped = (m.events_dropped || 0) + 1; continue; }
      const { seq, ...rest } = e;
      m.events[k] = rest;
      kept += 1;
      if (m.last_seq == null || seq > m.last_seq) m.last_seq = seq;
      if (e.type === 'battery_end' && !m.finished_at) m.finished_at = new Date().toISOString();
    }
    for (const r of results) m.results[r.task_id] = { ...r, mode: 'game' };
    return m;
  });
  return out.ok ? { ok: true, lastSeq: out.meta.last_seq } : out;
}

async function registerAudioRuns({ sessionId, taskId, itemId, key, bytes, durationMs }) {
  const out = await updateMeta(sessionId, (m) => {
    const rec = { key, bytes: bytes == null ? null : bytes, duration_ms: durationMs == null ? null : durationMs };
    if (!itemId) {
      m.audio = m.audio || {};
      m.audio[taskId] = rec; // the task's one recording (audio_r2_key)
      return m;
    }
    // a spoken answer: appended to the task's list (audio_r2_keys), never written over; a resend of the same key is one
    m.audio_items = m.audio_items || {};
    const list = m.audio_items[taskId] || (m.audio_items[taskId] = []);
    if (!list.some((x) => x.key === key)) list.push({ item_id: itemId, ...rec });
    return m;
  });
  return out.ok ? { ok: true } : out;
}

async function readRunRuns({ sessionId }) {
  const { data, error } = await db().from(RUNS).select('id, meta').eq('id', sessionId).eq('exercise', 'battery').maybeSingle();
  if (error) return fail('readRun', error, { runId: sessionId });
  if (!data) return { ok: false, reason: 'not_found' };
  const m = data.meta || {};
  const res = m.results || {};
  return {
    ok: true,
    status: m.finished_at ? 'completed' : 'in_progress',
    tasksDone: Object.keys(res).filter((k) => res[k] && Object.keys(res[k]).some((f) => f !== 'task_id' && f !== 'mode')),
    lastSeq: m.last_seq == null ? null : m.last_seq,
  };
}

/**
 * How often this child met this part this PKT month (panel: the coach's instrument played at home): the runs of the part
 * and form whose day is in `day`'s month, and whether a Big flight was finished then. Game runs live in the runs table
 * (a child-test game run carries the same meta). A failed read answers { ok:false } and the caller decides.
 */
async function exposure({ studentId, form, part, day }) {
  try {
    const month = String(day || '').slice(0, 7);
    const { data, error } = await db().from(RUNS).select('id, meta').eq('student_id', studentId).eq('exercise', 'battery');
    if (error) return fail('exposure', error, {});
    const mine = (data || []).map((r) => r.meta || {}).filter((m) => String(m.day || '').slice(0, 7) === month);
    return {
      ok: true,
      n: mine.filter((m) => m.part === part && m.form === form).length,
      flightDone: mine.some((m) => m.part === 'tower' && m.finished_at),
    };
  } catch (err) {
    return fail('exposure', err, {});
  }
}

// ── child-test tables ─────────────────────────────────────────────────────────────────────────────────────────────
async function createRunChildTest(a) {
  const st = await db().from('students').select('id, school_id, class_id').eq('id', a.studentId).maybeSingle();
  if (st.error || !st.data) return { ok: false, reason: 'no_student' };
  const existing = await db().from(SESSIONS).select('id').eq('id', a.id).maybeSingle();
  if (existing.error) return { ok: false, reason: 'not_ready', error: existing.error };
  if (existing.data) return { ok: true, mode: 'child_test', id: a.id };

  const drawId = a.drawId;
  const visitKey = `sa:${drawId}:${a.day}`;
  const grade = gradeNum(a.grade);
  const now = new Date().toISOString();
  const draw = await db().from(DRAWS).insert({
    id: drawId, cycle_id: require('../child-test/draw/cycle').cycleFor(), region: 'ict', // eslint-disable-line global-require
    school_id: st.data.school_id, class_id: st.data.class_id, student_id: a.studentId, grade,
    frame_size: 1, draw_rank: 1, seed_digest: 'self', algo_version: 'sa-game-v1', form: 'A', sample_role: 'self',
    status: 'tested', tested_at: now, visit_key: visitKey, history: [],
  });
  if (draw.error && draw.error.code !== '23505') return { ok: false, reason: 'not_ready', error: draw.error };
  if (draw.error) {
    // ours from an earlier try, or another draw of this child's this cycle (one per child per cycle): the latter → runs
    const mine = await db().from(DRAWS).select('id').eq('id', drawId).maybeSingle();
    if (mine.error || !mine.data) return { ok: false, reason: 'draw_taken' };
  }
  const sess = await db().from(SESSIONS).insert({
    id: a.id, draw_id: drawId, coach_user_id: null, school_id: st.data.school_id, class_id: st.data.class_id,
    student_id: a.studentId, grade, form: 'A', channel: 'web', selection_method: 'self', frame_size: 1,
    item_bank_version: `sa-game:${a.form}`, status: 'in_progress', admin_mode: 'self_run', client_session_id: a.id,
    visit_key: visitKey, device: { lang: a.lang === 'en' ? 'en' : 'ur', part: a.part, n: a.n, mode: 'game' },
  });
  if (sess.error && sess.error.code !== '23505') {
    await db().from(DRAWS).delete().eq('id', drawId).eq('sample_role', 'self'); // take back the draw just made
    return { ok: false, reason: 'not_ready', error: sess.error };
  }
  return { ok: true, mode: 'child_test', id: a.id };
}

async function saveBatchChildTest({ sessionId, events, results }) {
  const ct = ctStore();
  if (events.length) {
    const e = await ct.putEvents(sessionId, events);
    if (!e || !e.ok) return { ok: false, reason: 'store_failed' };
  }
  if (results.length) {
    const r = await ct.putResults(sessionId, results.map((x) => ({ task_id: x.task_id, result: { ...x, mode: 'game' } })));
    if (!r || !r.ok) return { ok: false, reason: 'store_failed' };
  }
  if (events.some((e) => e.type === 'battery_end')) {
    const { error } = await db().from(SESSIONS).update({ status: 'completed', finished_at: new Date().toISOString() })
      .eq('id', sessionId).eq('status', 'in_progress');
    if (error) fail('complete', error, { sessionId });
  }
  const seqs = events.map((e) => e.seq);
  return { ok: true, lastSeq: seqs.length ? Math.max(...seqs) : null };
}

async function registerAudioChildTest({ sessionId, taskId, itemId, key }) {
  const out = await ctStore().setResultAudio(sessionId, itemId ? `${taskId}/${itemId}` : taskId, key);
  return out && out.ok ? { ok: true } : { ok: false, reason: 'store_failed' };
}

async function readRunChildTest({ sessionId }) {
  const { data, error } = await db().from(SESSIONS).select('id, status').eq('id', sessionId).maybeSingle();
  if (error) return fail('readRun', error, { sessionId });
  if (!data) return { ok: false, reason: 'not_found' };
  const sum = await ctStore().summary(sessionId);
  if (!sum || !sum.ok) return { ok: false, reason: 'store_failed' };
  return { ok: true, status: data.status === 'completed' ? 'completed' : 'in_progress', tasksDone: sum.tasksDone, lastSeq: sum.lastSeq };
}

// ── the interface ─────────────────────────────────────────────────────────────────────────────────────────────────
async function createRun(a) {
  try {
    if (await childTestReady()) {
      const ct = await createRunChildTest(a);
      if (ct.ok) { lastMode = 'child_test'; return ct; }
      if (ct.reason === 'not_ready' && notReady(ct.error)) demote(ct.error && ct.error.message);
      else if (ct.reason === 'not_ready') return fail('createRunChildTest', ct.error, { runId: a.id });
    }
    const out = await createRunRow(a);
    lastMode = out.ok ? 'runs' : (out.reason === 'store_not_ready' ? 'none' : lastMode);
    if (out.reason === 'store_not_ready') logToFile('⚠️ sa game store: the runs table refused a battery run — nothing stored', { why: String(out.error || '').slice(0, 160) });
    return out;
  } catch (err) {
    return fail('createRun', err, { runId: a && a.id });
  }
}

const byMode = (ct, runs) => async (a) => {
  try {
    return await (a.mode === 'child_test' ? ct(a) : runs(a));
  } catch (err) {
    return fail('call', err, { sessionId: a && a.sessionId });
  }
};

module.exports = {
  createRun,
  exposure,
  saveBatch: byMode(saveBatchChildTest, saveBatchRuns),
  registerAudio: byMode(registerAudioChildTest, registerAudioRuns),
  readRun: byMode(readRunChildTest, readRunRuns),
  mode: () => lastMode,
  ctStore,
  CT_OWN,
  __reset: () => { probe = { ok: null, at: 0 }; lastMode = 'unknown'; },
};
