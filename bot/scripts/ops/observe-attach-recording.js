#!/usr/bin/env node
'use strict';
/**
 * bd-twyobl (queue #289) — attach a coach's lesson recording that WhatsApp refused to her planned /observe visit.
 *
 * WHY. Meta can refuse a voice note before it reaches us (error 131052, "Incoming media file validation failed").
 * Nothing arrives — no message, no media id — so the visit waits for a recording that will never come, and a second
 * forward of the same voice note is refused the same way (Noor ul ain, B.K, 26 Nov 2026: 19:18 voice note of AAMIR
 * AYAZ's lesson, refused at 09:45 and 09:52). When the operator gets the file another way, this puts it on the visit.
 *
 * WHAT. Exactly what an inbound coach voice note would have done, from the deployed code's own pieces:
 *   1. the coaching_sessions row of observe-capture.startFromAudio, field for field (bound teacher owns it, observer
 *      split, status 'confirmed', the visit's rubric from decideVisitFramework — FICO17 v6 for a coach);
 *   2. the audio in R2 at the inbound path, classroom_audio/<teacher>/<YYYY-MM>/<session>_<ts>.ogg (uploadClassroomAudio),
 *      recorded on the row before transcription so the processor reads it from R2 (fetchAudioForSession);
 *   3. the planned visit (observation_schedules) retired with this session id, as startFromAudio's markDone does;
 *   4. the transcription run once, here, with the photo / lesson-plan gates OFF: the visit is hours old and she is not
 *      in the classroom, so the processor's own gates-off branch queues the analysis directly. The production worker
 *      then runs the analysis and, at the end, sends her the visit's FICO review form (observe-draft.onAnalysisReady).
 *
 * WHAT IT NEVER DOES. Every WhatsApp send in THIS process is muted (the Step 1/5 "transcribing" line, the listening
 * sticker, any error line): the only message she gets is the review form the worker sends when the draft is ready.
 * It never touches the coach's Redis observe state, so an armed debrief for another visit cannot take this recording.
 * It refuses a visit that already has a recording, a teacher who is not the visit's, and bytes this coach already sent.
 *
 * RUN (inside the bot / sqs-worker container, where the deployed code, its env, Redis and ffprobe are):
 *   MODE=plan  BOT_ROOT=/app/bot SCHEDULE_ID=<observation_schedules.id> EXPECT_TEACHER_ID=<users.id> \
 *     EXPECT_SHA256=<hex> node observe-attach-recording.js < recording.opus          # reads only, prints the plan
 *   MODE=apply …same…                                                                  # writes, runs, waits for the draft
 *   MODE=status BOT_ROOT=/app/bot SESSION_ID=<coaching_sessions.id> node observe-attach-recording.js
 *   MODE=undo   BOT_ROOT=/app/bot SESSION_ID=<id> SCHEDULE_ID=<id> node observe-attach-recording.js
 * UNDO: the row → 'cancelled' (onAnalysisReady never re-arms a terminal row), the visit → 'upcoming' with no session,
 * the R2 object deleted. A form already delivered to her phone cannot be recalled; once cancelled it opens on nothing.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEADER_ROLES = ['coach', 'principal', 'school_leader', 'aeo'];
const digits = (s) => String(s || '').replace(/\D/g, '');

// ── pure ─────────────────────────────────────────────────────────────────────

/** Length of an Ogg Opus stream in seconds: last page's granule position minus the pre-skip, at 48 kHz. */
function oggOpusDurationSeconds(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 47 || buf.toString('ascii', 0, 4) !== 'OggS') {
    throw new Error('not an Ogg Opus file');
  }
  const head = buf.indexOf('OpusHead');
  if (head < 0) throw new Error('not an Ogg Opus file (no OpusHead)');
  const preSkip = buf.readUInt16LE(head + 10);
  const last = buf.lastIndexOf('OggS');
  const granule = Number(buf.readBigUInt64LE(last + 6));
  return (granule - preSkip) / 48000;
}

/** observe-capture.startFromAudio's insert, field for field; audio_id null (no WhatsApp media id: the bytes are in R2). */
function buildObservationRow({ observerId, teacherUserId, chatSessionId, durationSeconds, framework, nowIso }) {
  return {
    user_id: teacherUserId,
    session_id: chatSessionId,
    audio_id: null,
    audio_duration_seconds: Math.round(durationSeconds),
    status: 'confirmed',
    observation_type: 'leader_observation',
    observer_user_id: observerId,
    debrief_status: 'pending',
    created_at: nowIso,
    ...(framework ? { framework, framework_selection_reason: 'coach_rubric_switch' } : {}),
  };
}

/** The visit must be this coach's, still waiting for its recording, and of exactly this teacher. */
function checkVisit({ schedule, teacher, observer, expectTeacherId }) {
  if (!schedule || schedule.status !== 'upcoming' || schedule.session_id) return { ok: false, reason: 'visit_not_upcoming' };
  if (!observer || observer.deleted_at || observer.id !== schedule.leader_user_id) return { ok: false, reason: 'observer_not_the_visits' };
  if (!LEADER_ROLES.includes(observer.role)) return { ok: false, reason: 'observer_not_a_leader' };
  if (!teacher || teacher.deleted_at) return { ok: false, reason: 'teacher_missing' };
  if (teacher.id !== expectTeacherId) return { ok: false, reason: 'teacher_not_expected' };
  if (digits(teacher.phone_number) !== digits(schedule.teacher_ext_id)) return { ok: false, reason: 'teacher_not_the_visits' };
  return { ok: true };
}

/** Replace every send* method on a WhatsApp service with a recorder that sends nothing. */
function muteSends(svc) {
  const calls = [];
  const names = new Set([...Object.getOwnPropertyNames(svc), ...Object.keys(svc)]);
  for (const name of names) {
    if (/^send/.test(name) && typeof svc[name] === 'function') {
      svc[name] = async () => { calls.push({ method: name }); return { muted: true }; };
    }
  }
  return calls;
}

// ── effects (inside the deployed container) ─────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    const parts = [];
    process.stdin.on('data', (c) => parts.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(parts)));
    process.stdin.on('error', reject);
  });
}

function out(label, value) { console.log(`[attach] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`); }
function stop(reason, extra) { out('REFUSED', { reason, ...(extra || {}) }); process.exit(2); }

async function loadContext(root, env) {
  const supabase = require(path.join(root, 'shared/config/supabase'));
  const { data: schedule } = await supabase.from('observation_schedules').select('*').eq('id', env.SCHEDULE_ID).maybeSingle();
  if (!schedule) stop('visit_not_found', { scheduleId: env.SCHEDULE_ID });
  const cols = 'id, name, role, region, phone_number, deleted_at, preferred_language';
  const { data: observer } = await supabase.from('users').select(cols).eq('id', schedule.leader_user_id).maybeSingle();
  const { data: teacher } = await supabase.from('users').select(cols).eq('id', env.EXPECT_TEACHER_ID).maybeSingle();
  return { supabase, schedule, observer, teacher };
}

async function plan(root, env, audio) {
  const sha = crypto.createHash('sha256').update(audio).digest('hex');
  if (!env.EXPECT_SHA256 || sha !== env.EXPECT_SHA256) stop('audio_not_the_expected_file', { sha256: sha, bytes: audio.length });
  const seconds = oggOpusDurationSeconds(audio);
  const ctx = await loadContext(root, env);
  const verdict = checkVisit({ ...ctx, expectTeacherId: env.EXPECT_TEACHER_ID });
  if (!verdict.ok) stop(verdict.reason, { schedule: ctx.schedule && { id: ctx.schedule.id, status: ctx.schedule.status, session_id: ctx.schedule.session_id } });

  // A recording of this teacher by this coach since the visit's day: never a second one.
  const { data: existing } = await ctx.supabase.from('coaching_sessions').select('id, status, created_at')
    .eq('observer_user_id', ctx.observer.id).eq('user_id', ctx.teacher.id)
    .gte('created_at', `${ctx.schedule.scheduled_for}T00:00:00Z`).not('status', 'in', '(cancelled,failed)');
  if (existing && existing.length) stop('visit_already_has_an_observation', { existing });
  // The pipeline refuses bytes this coach already sent, and tells her so: refuse here instead, silently.
  const Hash = require(path.join(root, 'shared/services/coaching/audio-hash-cache'));
  const prior = await Hash.findPriorLeaderObservation(ctx.supabase, {
    observerUserId: ctx.observer.id, audioHash: Hash.computeAudioHash(audio), excludeSessionId: null,
  });
  if (prior) stop('same_recording_already_observed', { prior });

  const V6 = require(path.join(root, 'shared/services/observe/observe-fico17-v6'));
  const framework = await V6.decideVisitFramework({
    userId: ctx.observer.id, region: ctx.observer.region, teacherUserId: ctx.teacher.id,
    schoolExtId: ctx.schedule.school_ext_id, lessonIsPrimary: true,
  });
  out('plan', {
    visit: { id: ctx.schedule.id, teacher: ctx.schedule.teacher_name, school: ctx.schedule.school_name, day: ctx.schedule.scheduled_for, slot: ctx.schedule.scheduled_slot },
    observer: { id: ctx.observer.id, name: ctx.observer.name, region: ctx.observer.region },
    teacher: { id: ctx.teacher.id, name: ctx.teacher.name },
    audio: { bytes: audio.length, seconds: Math.round(seconds), sha256: sha },
    framework: framework || 'none (deployment default)',
  });
  return { ...ctx, seconds, framework };
}

async function apply(root, env, audio) {
  const p = await plan(root, env, audio);
  const { supabase, schedule, observer, teacher } = p;

  // Mute this process's WhatsApp sends BEFORE anything that could send is loaded and run.
  const WhatsAppService = require(path.join(root, 'shared/services/whatsapp.service'));
  const muted = muteSends(WhatsAppService);

  const { getOrCreateSession } = require(path.join(root, 'shared/database/bot-helpers'));
  const chatSessionId = await getOrCreateSession(observer.id);
  const row = buildObservationRow({
    observerId: observer.id, teacherUserId: teacher.id, chatSessionId, durationSeconds: p.seconds,
    framework: p.framework, nowIso: new Date().toISOString(),
  });
  const { data: session, error } = await supabase.from('coaching_sessions').insert(row).select().single();
  if (error || !session) stop('insert_failed', { error: error && error.message });
  out('session', session.id);

  // The inbound path and format: classroom_audio/<teacher>/<YYYY-MM>/<session>_<ts>.ogg
  const tmp = path.join(os.tmpdir(), `classroom_${session.id}_${Date.now()}.ogg`);
  fs.writeFileSync(tmp, audio);
  const { uploadClassroomAudio } = require(path.join(root, 'shared/storage/r2'));
  const audioUrl = await uploadClassroomAudio(tmp, teacher.id, session.id, { duration: Math.round(p.seconds), language: 'unknown', format: 'ogg' });
  fs.unlinkSync(tmp);
  const { error: urlErr } = await supabase.from('coaching_sessions').update({ audio_url: audioUrl }).eq('id', session.id);
  if (urlErr) stop('audio_url_not_written', { sessionId: session.id, error: urlErr.message });
  out('audio_url', audioUrl.replace(/^https?:\/\/[^/]+\/[^/]+\//, ''));

  const ScheduleStore = require(path.join(root, 'shared/services/observe/observe-schedule.service'));
  await ScheduleStore.markDone(observer.id, schedule.teacher_ext_id, schedule.school_ext_id || null, session.id);

  // Transcription, once, here: gates off → the processor queues the analysis for the worker.
  process.env.OBSERVE_CAPTURE_GATES_ENABLED = 'false';
  const TP = require(path.join(root, 'shared/services/coaching/transcription-processor.service'));
  await TP.processTranscription(session.id, { from: observer.phone_number });
  out('muted_sends_in_this_process', muted);

  return waitForDraft(supabase, session.id, Number(env.WAIT_SECONDS || 900));
}

async function waitForDraft(supabase, sessionId, waitSeconds) {
  const until = Date.now() + waitSeconds * 1000;
  let last = null;
  for (;;) {
    const { data } = await supabase.from('coaching_sessions')
      .select('id, status, framework, audio_size_bytes, audio_duration_seconds, transcription_completed_at, analysis_completed_at, error_message, failed_step')
      .eq('id', sessionId).single();
    if (!last || data.status !== last.status) out('status', data);
    last = data;
    if (['awaiting_observer_review', 'observer_review_complete'].includes(data.status)) {
      out('DONE', { sessionId, status: data.status, framework: data.framework, draft: 'stored; the worker sent her the FICO review form' });
      return 0;
    }
    if (['failed', 'cancelled', 'duplicate'].includes(data.status)) { out('FAILED', data); return 1; }
    if (Date.now() > until) { out('STILL_RUNNING', { sessionId, status: data.status, hint: 'MODE=status SESSION_ID=… to look again' }); return 3; }
    await new Promise((r) => setTimeout(r, 10000));
  }
}

async function undo(root, env) {
  const supabase = require(path.join(root, 'shared/config/supabase'));
  const { data: s } = await supabase.from('coaching_sessions').select('id, status, audio_url, observer_user_id').eq('id', env.SESSION_ID).maybeSingle();
  if (!s) stop('session_not_found', { sessionId: env.SESSION_ID });
  if (s.status === 'observer_review_complete' && env.FORCE !== '1') stop('coach_already_submitted_her_review', { hint: 'FORCE=1 discards her review too' });
  await supabase.from('coaching_sessions').update({ status: 'cancelled' }).eq('id', s.id);
  if (env.SCHEDULE_ID) {
    await supabase.from('observation_schedules').update({ status: 'upcoming', session_id: null, updated_at: new Date().toISOString() })
      .eq('id', env.SCHEDULE_ID).eq('session_id', s.id);
  }
  let deleted = false;
  if (s.audio_url) {
    const r2 = require(path.join(root, 'shared/storage/r2'));
    deleted = await r2.deleteKey(r2.extractKeyFromUrl(s.audio_url));
  }
  out('UNDONE', { sessionId: s.id, row: 'cancelled', visit: env.SCHEDULE_ID ? 'upcoming again' : 'untouched', r2Deleted: deleted });
  return 0;
}

async function main() {
  const env = process.env;
  const root = env.BOT_ROOT || path.resolve(__dirname, '../..');
  const mode = env.MODE || 'plan';
  if (mode === 'undo') return undo(root, env);
  if (mode === 'status') {
    const supabase = require(path.join(root, 'shared/config/supabase'));
    return waitForDraft(supabase, env.SESSION_ID, 0);
  }
  const audio = await readStdin();
  if (mode === 'plan') { await plan(root, env, audio); out('plan_only', 'nothing written'); return 0; }
  if (mode === 'apply') return apply(root, env, audio);
  stop('unknown_mode', { mode });
  return 2;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0)).catch((err) => { out('ERROR', err && err.stack); process.exit(1); });
}

module.exports = { oggOpusDurationSeconds, buildObservationRow, checkVisit, muteSends };
