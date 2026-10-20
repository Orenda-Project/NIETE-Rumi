'use strict';
/**
 * bd-tbprit.1 — a coach's disagreements in the portal: the C/D teachers who answered "Not accurate" to their
 * coaching report and pinged her (v10 coaching test; coach-visit-request.js writes the rows).
 *
 *   listFor  her coach_visit_requests as To do (not visited yet) and Done (visited), as Rifat's prototype has the
 *            list (bd-tbprit.7, 20 Oct — supersedes the 19 Oct two-tag list): school + EMIS, opened (the blue
 *            dot until she opens the card) and three tags with their numbers — recordingLess (her last 2 weeks'
 *            recordings a week are half or less of the 4 weeks before), waiting (sent > 48 h ago, in days) and
 *            repeat (her 2nd, 3rd … disagreement); bd-tbprit.9 adds short, first (the lesson recorded for under 15
 *            minutes, in whole minutes). To do: most tags first, then longest waiting.
 *   cardFor  one request, for its own coach only (null otherwise): the report view, the grader's evidence for
 *            each reason, every indicator with its AI score, and the plan steps when the plan was checked.
 *
 * bd-tbprit.12 — Rifat's "✓ Mark as done" can be undone ("Move back to To do"):
 *   markDone       her open row reads visited, stamped now (the tracker's visited_7d); her voice note is kept
 *   markUndone     her visited row goes back to sent (the ping went out) or failed, so visited_7d reads false again
 *   purgeDoneNotes the voice note is deleted once the card has stood Done 24 h (was: at Done, which an undo would lose)
 * coach-visit-request.markVisited (delete at Done) still serves the WhatsApp coach-card page.
 */
const { fullNameOf } = require('../../bot/shared/utils/person-name');
const { cleanReasons } = require('./coach-ping-reasons');
const { evidenceFor, indicatorsOf, movesOf } = require('./coach-disagreement-evidence');

const OPEN = ['pending', 'sent', 'failed'];
const LIST_LIMIT = 200;
const WAIT_MS = 48 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const SHORT_SEC = 15 * 60;
const ROW_SELECT = 'id, coaching_session_id, teacher_user_id, coach_user_id, school_id, ab_group, status, reasons, voice_note_key, opened_at, created_at, updated_at';

const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pctOf = (scores) => {
  const p = scores && scores.overall_percentage;
  return p == null || p === '' || !Number.isFinite(Number(p)) ? null : Math.round(Number(p));
};

/** Recordings a week: the 4 weeks before the last 2 (`before`) and the last 2 (`now`). dates: ISO strings. Pure. */
function recordingRate(dates, now) {
  const t = now.getTime();
  let before = 0;
  let recent = 0;
  for (const d of dates) {
    const age = t - ms(d);
    if (age >= 0 && age < 14 * DAY_MS) recent += 1;
    else if (age >= 14 * DAY_MS && age < 42 * DAY_MS) before += 1;
  }
  return { before: before / 4, now: recent / 2 };
}

/** Which of her disagreements each row is (1 = her first), oldest first per teacher. */
function nthOf(rows) {
  const seen = new Map();
  const out = new Map();
  [...rows].sort((a, b) => ms(a.created_at) - ms(b.created_at)).forEach((r) => {
    const n = (seen.get(r.teacher_user_id) || 0) + 1;
    seen.set(r.teacher_user_id, n);
    out.set(r.id, n);
  });
  return out;
}

/** rows: her requests; look: { teachers, schools, emis, sessions, rates } Maps; now: a Date. Pure. */
function shapeList(rows, look, now) {
  const nth = nthOf(rows);
  const shaped = rows.map((r) => {
    const done = r.status === 'visited';
    const session = look.sessions.get(r.coaching_session_id) || {};
    const tags = [];
    if (!done) {
      if (session.durationSec > 0 && session.durationSec < SHORT_SEC) tags.push({ kind: 'short', minutes: Math.floor(session.durationSec / 60) });
      const rate = (look.rates && look.rates.get(r.teacher_user_id)) || null;
      if (rate && rate.before > 0 && rate.now <= rate.before / 2) tags.push({ kind: 'recordingLess', before: rate.before, now: rate.now });
      const waited = now.getTime() - ms(r.created_at);
      if (waited > WAIT_MS) tags.push({ kind: 'waiting', days: Math.floor(waited / DAY_MS) });
      if (nth.get(r.id) > 1) tags.push({ kind: 'repeat', nth: nth.get(r.id) });
    }
    return {
      id: r.id,
      teacher: look.teachers.get(r.teacher_user_id) || null,
      school: look.schools.get(r.school_id) || null,
      emis: (look.emis && look.emis.get(r.school_id)) || null,
      opened: !!r.opened_at,
      reasons: cleanReasons(r.reasons || []),
      status: r.status,
      done,
      createdAt: r.created_at,
      visitedAt: done ? r.updated_at : null,
      sessionDate: session.createdAt || null,
      pct: session.pct == null ? null : Math.round(session.pct),
      hasNote: !!r.voice_note_key,
      tags,
    };
  });
  const todo = shaped.filter((r) => !r.done)
    .sort((a, b) => (b.tags.length - a.tags.length) || (ms(a.createdAt) - ms(b.createdAt)));
  const done = shaped.filter((r) => r.done).sort((a, b) => ms(b.visitedAt) - ms(a.visitedAt));
  return { todo, done };
}

const rowsOf = (res) => (res && res.data) || [];
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

async function listFor(supabase, coachId, opts = {}) {
  const now = opts.now || new Date();
  const res = await supabase.from('coach_visit_requests').select(ROW_SELECT).eq('coach_user_id', coachId)
    .in('status', [...OPEN, 'visited']).order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (res.error) throw new Error(res.error.message || 'coach_visit_requests read failed');
  const rows = rowsOf(res);
  if (!rows.length) return { todo: [], done: [] };
  const teacherIds = uniq(rows.map((r) => r.teacher_user_id));
  const [users, schools, sessions, recent] = await Promise.all([
    supabase.from('users').select('id, name').in('id', teacherIds),
    supabase.from('leader_schools').select('school_id, school_name, emis').eq('leader_user_id', coachId).in('school_id', uniq(rows.map((r) => r.school_id))),
    supabase.from('coaching_sessions').select('id, created_at, audio_duration_seconds, scores:analysis_data->scores').in('id', uniq(rows.map((r) => r.coaching_session_id))),
    supabase.from('coaching_sessions').select('user_id, created_at').in('user_id', teacherIds)
      .gte('created_at', new Date(now.getTime() - 42 * DAY_MS).toISOString()),
  ]);
  const datesOf = new Map();
  rowsOf(recent).forEach((s) => datesOf.set(s.user_id, [...(datesOf.get(s.user_id) || []), s.created_at]));
  const look = {
    teachers: new Map(rowsOf(users).map((u) => [u.id, fullNameOf(u) || u.name || null])),
    schools: new Map(rowsOf(schools).map((s) => [s.school_id, s.school_name || null])),
    emis: new Map(rowsOf(schools).map((s) => [s.school_id, s.emis || null])),
    rates: new Map(teacherIds.map((id) => [id, recordingRate(datesOf.get(id) || [], now)])),
    sessions: new Map(rowsOf(sessions).map((s) => [s.id, {
      createdAt: s.created_at || null,
      durationSec: num(s.audio_duration_seconds),
      pct: pctOf(s.scores || (s.analysis_data && s.analysis_data.scores)),
    }])),
  };
  return shapeList(rows, look, now);
}

/** deps.loadReport(supabase, sessionId, teacherId) — coaching-report.routes loadReport; deps.presign(key, s). */
async function cardFor(supabase, coachId, requestId, deps = {}) {
  const { data: row } = await supabase.from('coach_visit_requests').select(ROW_SELECT).eq('id', requestId).maybeSingle();
  if (!row || !coachId || row.coach_user_id !== coachId) return null;
  const [teacher, coach, school, data, hers, rec] = await Promise.all([
    supabase.from('users').select('name').eq('id', row.teacher_user_id).maybeSingle(),
    supabase.from('users').select('preferred_language').eq('id', coachId).maybeSingle(),
    row.school_id ? supabase.from('leader_schools').select('school_name, emis').eq('school_id', row.school_id) : null,
    deps.loadReport(supabase, row.coaching_session_id, row.teacher_user_id),
    supabase.from('coach_visit_requests').select('id, created_at').eq('teacher_user_id', row.teacher_user_id),
    supabase.from('coaching_sessions').select('audio_duration_seconds').eq('id', row.coaching_session_id).maybeSingle(),
  ]);
  if (!data || !data.session) return null;
  const { buildReportView } = require('./coaching-report-view');
  const view = buildReportView(data);
  const done = row.status === 'visited';
  let noteUrl = null;
  if (!done && row.voice_note_key) {
    try { noteUrl = (await deps.presign(row.voice_note_key, 3600)) || null; } catch (_) { noteUrl = null; }
  }
  const a = data.session.analysis_data || {};
  const s = rowsOf(school)[0] || {};
  return {
    id: row.id,
    teacher: fullNameOf((teacher && teacher.data) || {}) || null,
    school: s.school_name || null,
    emis: s.emis || null,
    group: row.ab_group || null,
    nth: rowsOf(hers).filter((r) => ms(r.created_at) <= ms(row.created_at)).length || 1,
    language: coach && coach.data && coach.data.preferred_language === 'ur' ? 'ur' : 'en',
    status: row.status,
    done,
    reasons: cleanReasons(row.reasons || []),
    createdAt: row.created_at,
    noteUrl,
    view,
    evidence: evidenceFor(a, row.reasons, view.thing),
    indicators: indicatorsOf(a),
    moves: movesOf(a),
    durationSec: num(rec && rec.data && rec.data.audio_duration_seconds),
  };
}

/** bd-tbprit.7 — the blue dot goes once she opens her own card: opened_at is stamped the first time, never again. */
async function markOpened(supabase, coachId, requestId, now = new Date()) {
  if (!coachId || !requestId) return;
  const { error } = await supabase.from('coach_visit_requests').update({ opened_at: now.toISOString() })
    .eq('id', requestId).eq('coach_user_id', coachId).is('opened_at', null);
  if (error) throw new Error(error.message);
}

/** bd-tbprit.2 — the recording behind the clip, for the request's own coach only; presigned for five minutes. */
async function recordingFor(supabase, coachId, requestId, presign) {
  const { data: row } = await supabase.from('coach_visit_requests').select('coach_user_id, coaching_session_id').eq('id', requestId).maybeSingle();
  if (!row || !coachId || row.coach_user_id !== coachId || !row.coaching_session_id) return null;
  const { data: session } = await supabase.from('coaching_sessions').select('audio_url').eq('id', row.coaching_session_id).maybeSingle();
  if (!session || !session.audio_url) return null;
  return (await presign(session.audio_url, 300)) || null;
}

/** bd-tbprit.12 — "✓ Mark as done": her open row only; a second tap leaves the done time where it was. */
async function markDone(supabase, coachId, requestId, now = new Date()) {
  if (!coachId || !requestId) return false;
  const { error } = await supabase.from('coach_visit_requests').update({ status: 'visited', updated_at: now.toISOString() })
    .eq('id', requestId).eq('coach_user_id', coachId).in('status', OPEN);
  return !error;
}

/** bd-tbprit.12 — "Move back to To do": her visited row goes back to sent, or failed when the ping never went out. */
async function markUndone(supabase, coachId, requestId, now = new Date()) {
  if (!coachId || !requestId) return false;
  const { data: row, error } = await supabase.from('coach_visit_requests').select('id, coach_user_id, status, wa_message_id')
    .eq('id', requestId).maybeSingle();
  if (error) return false;
  if (!row || row.coach_user_id !== coachId || row.status !== 'visited') return true;
  const { error: e2 } = await supabase.from('coach_visit_requests')
    .update({ status: row.wa_message_id ? 'sent' : 'failed', updated_at: now.toISOString() })
    .eq('id', requestId).eq('coach_user_id', coachId).eq('status', 'visited');
  return !e2;
}

/** bd-tbprit.12 — her voice notes on cards Done for over 24 h: deleted, then the key cleared. A failed delete keeps it. */
async function purgeDoneNotes(supabase, coachId, del, now = new Date()) {
  if (!coachId) return;
  try {
    const { data } = await supabase.from('coach_visit_requests').select('id, voice_note_key')
      .eq('coach_user_id', coachId).eq('status', 'visited').not('voice_note_key', 'is', null)
      .lt('updated_at', new Date(now.getTime() - DAY_MS).toISOString());
    for (const r of data || []) {
      try {
        await del(r.voice_note_key);
        await supabase.from('coach_visit_requests').update({ voice_note_key: null }).eq('id', r.id).eq('status', 'visited');
      } catch (err) { console.error('[coach-disagreements] note purge failed:', err.message); }
    }
  } catch (err) { console.error('[coach-disagreements] note purge failed:', err.message); }
}

module.exports = { shapeList, recordingRate, listFor, cardFor, markOpened, recordingFor, markDone, markUndone, purgeDoneNotes };
