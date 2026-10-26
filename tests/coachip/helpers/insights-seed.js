'use strict';
/**
 * bd-sex15q.13 — fictional rows for the COACHIP insight tables (contracts/insights_schema.sql), for route tests.
 * Every helper takes the harness's query and fills the provenance columns with fixed fictional values, so a test
 * names only what it is about. No names, no phones, no URLs; keys are the codec's HMAC of a fictional users.id.
 *
 *   seedLibrary(q)           coachip_weaknesses + coachip_interventions from the frozen library (parent first; idempotent)
 *   jobRun(q, {date, status})                         → id
 *   session(q, {id, teacherId})                       coaching_sessions row (the FK parent of a fact)
 *   fact(q, {...})                                    → fact id (coachip_session_facts)
 *   signal(q, {factId, sessionId, wId, inDen, hit})
 *   rollup(q, {...})                                  coach / school scope rollup
 *   moment(q, {...})                                  → moment id
 *   sessionSteps(q, factId, [[phase, verdict, from, to], ...])
 *   visit(q, {id, coachId, schoolId, date, status})
 *   phonics(q, {state, read, kappa})
 */
const path = require('path');
const crypto = require('crypto');

const GRADER = 'google/gemini-3.8-flash';
const FRAMEWORK = 'lp_fidelity';
const PIPELINE = 'coachip-1.0.0';
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

async function seedLibrary(q) {
  const lib = require(path.join(__dirname, '..', '..', '..', 'dashboard', 'data', 'coachip', 'INTERVENTIONS.json'));
  const ws = new Map(lib.weaknesses.map((w) => [w.id, w]));
  const done = new Set();
  const insert = async (w) => {
    if (done.has(w.id)) return;
    if (w.parent_w_id && ws.has(w.parent_w_id)) await insert(ws.get(w.parent_w_id));
    done.add(w.id);
    const src = ['lp_fidelity', 'fico_v3', 'fico_v4', 'fico17', 'coachip_detector', 'egra', 'code'].includes(w.stream) ? w.stream : 'code';
    await q(
      `INSERT INTO coachip_weaknesses (w_id, parent_w_id, primary_source, pedagogical_weight, is_s1_eligible, is_s7, is_cause_line,
         short_name_en, short_name_ur, library_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (w_id) DO NOTHING`,
      [w.id, w.parent_w_id || null, src, w.pedagogical_weight, !!w.s1_eligible, !!w.is_s7, !!w.is_cause_line,
        w.short_name_en, w.short_name_ur, lib.library_version],
    );
  };
  for (const w of lib.weaknesses) await insert(w);   // eslint-disable-line no-await-in-loop
  for (const i of lib.interventions) {
    await q(   // eslint-disable-line no-await-in-loop
      `INSERT INTO coachip_interventions (i_id, w_id, level, rank_in_w, library_version) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [i.id, i.weakness_id, i.level, i.rank_in_w, lib.library_version],
    );
  }
}

async function jobRun(q, { date, status = 'ok', pipeline = PIPELINE }) {
  const { rows } = await q(
    `INSERT INTO coachip_job_runs (run_date, pipeline_version, env_ref, started_at, finished_at, status, failure_class)
     VALUES ($1, $2, 'olvritwoqujtjvwfulbh', ($1::date - 1)::timestamptz + interval '21 hours',
             ($1::date - 1)::timestamptz + interval '21 hours 40 minutes', $3, $4) RETURNING id`,
    [date, pipeline, status, status === 'failed' ? 'upstream' : null],
  );
  return rows[0].id;
}

async function session(q, { id, teacherId }) {
  await q('INSERT INTO coaching_sessions (id, user_id) VALUES ($1, $2)', [id, teacherId]);
  return id;
}

/** A graded session fact. `date` is the Karachi day it was recorded (stored as 09:00 PKT). */
async function fact(q, {
  id = null, sessionId, teacherKey, schoolId, date, jobRunId, linked = true, status = 'ok', grade = 3, subject = 'Urdu',
  audioS = 1500, computedAt = '2026-10-25T21:40:00Z', grader = GRADER, framework = FRAMEWORK, pipeline = PIPELINE,
  mismatch = false, unusable = false,
}) {
  const { rows } = await q(
    `INSERT INTO coachip_session_facts (id, session_id, teacher_key, school_id, sector, recorded_at, is_observed, job_run_id,
       grader_model, framework_version, pipeline_version, input_hash, status, failure_class, is_mismatch, is_unusable,
       is_duplicate, is_lp_linked, subject, grade, audio_s, computed_at)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, 'Urban-I', ($5::date)::timestamp AT TIME ZONE 'Asia/Karachi' + interval '9 hours', false, $6,
       $7, $8, $9, $10, $11, $12, $13, $14, false, $15, $16, $17, $18, $19) RETURNING id`,
    [id, sessionId, teacherKey, schoolId, date, jobRunId, grader, framework, pipeline, hash(`${sessionId}|${pipeline}`),
      status, status === 'failed' ? 'input_missing' : null, mismatch || status === 'mismatch', unusable, linked, subject, grade, audioS, computedAt],
  );
  return rows[0].id;
}

async function signal(q, { factId, sessionId, wId, inDen = true, hit = false }) {
  await q(
    `INSERT INTO coachip_session_signals (fact_id, session_id, w_id, source, is_in_denominator, is_hit, status)
     VALUES ($1, $2, $3, 'lp_fidelity', $4, $5, 'ok')`,
    [factId, sessionId, wId, inDen, hit && inDen],
  );
}

/** A rollup. scope: { coachId } | { schoolId }. Defaults: 4 weeks from 2026-09-28, ok, no rank. */
async function rollup(q, {
  coachId = null, schoolId = null, wId, n, d, from = '2026-09-28', weeks = 4, status = 'ok', rank = null, jobRunId,
  teacherCount = 0, recordings = 0, linked = 0, excluded = [0, 0, 0, 0], stat = null, hysteresis = false,
  computedAt = '2026-10-25T21:40:00Z', grader = GRADER, framework = FRAMEWORK, pipeline = PIPELINE,
}) {
  const kind = coachId ? 'coach' : 'school';
  await q(
    `INSERT INTO coachip_rollups (scope_kind, coach_user_id, school_id, w_id, window_start, window_end, window_weeks,
       numerator, denominator, teacher_count, excluded_mismatch, excluded_unusable, excluded_duplicate, excluded_failed,
       recordings, recordings_linked, stat_kind, stat_unit, stat_value, stat_base, rank, is_hysteresis_applied,
       grader_model, framework_version, pipeline_version, status, job_run_id, computed_at)
     VALUES ($1::coachip_scope_kind, $2, $3, $4, $5::date, $5::date + (7 * $6 - 1), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
       $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
    [kind, coachId, schoolId, wId, from, weeks, n, d, teacherCount, ...excluded, recordings, linked,
      stat ? stat.kind : null, stat ? stat.unit : null, stat ? stat.value : null, stat ? stat.base : null,
      rank, hysteresis, grader, framework, pipeline, status, jobRunId, computedAt],
  );
}

async function moment(q, {
  id, factId, sessionId, wId, kind = 'missing', phase = 'ip', from = 1122, to = 1160, at = null, confidence = 'high',
  credit = null, gloss = null, clip = 'ready', jobRunId = null,
}) {
  const glossStatus = confidence === 'none' ? 'not_evaluated' : (gloss ? 'ok' : 'pending');
  let runId = null;
  if (gloss) {
    const r = await q(
      `INSERT INTO coachip_model_runs (session_id, job_run_id, analysis, target, model, prompt_version, input_hash, purpose, status)
       VALUES ($1, $2, 'gloss', '-', 'openai/gpt-6-luna', 'gloss_v2', $3, 'primary', 'ok') RETURNING id`,
      [sessionId, jobRunId, hash(id)],
    );
    runId = r && r.rows[0] ? r.rows[0].id : null;
  }
  await q(
    `INSERT INTO coachip_moments (id, fact_id, session_id, w_id, kind, phase, from_s, to_s, moment_s, confidence, credit,
       gloss_en, gloss_ur, gloss_status, gloss_model_run_id, clip_r2_key, clip_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, factId, sessionId, wId, kind, phase, from, to, at === null ? from : at, confidence, credit,
      runId && gloss ? gloss.en : null, runId && gloss ? gloss.ur : null, runId ? 'ok' : glossStatus, runId,
      clip === 'ready' ? `coachip/clips/sandbox/${sessionId}/${from}-${to}.mp3` : null, clip],
  );
  return id;
}

async function sessionSteps(q, factId, steps) {
  let i = 0;
  for (const [phase, verdict, from, to] of steps) {
    i += 1;
    await q(   // eslint-disable-line no-await-in-loop
      `INSERT INTO coachip_session_steps (fact_id, ordinal, move_id, phase, verdict, is_counted, from_s, to_s)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
      [factId, i, `m${i}`, phase, verdict, from, to],
    );
  }
}

async function visit(q, { id = null, coachId, schoolId, date, status = 'upcoming' }) {
  const { rows } = await q(
    `INSERT INTO observation_schedules (id, leader_user_id, school_ext_id, teacher_ext_id, scheduled_for, status, school_id)
     VALUES (COALESCE($1, gen_random_uuid()), $2, 'niete:fixture', 'fixture', $3, $4, $5) RETURNING id`,
    [id, coachId, date, status, schoolId],
  );
  return rows[0].id;
}

async function phonics(q, { state = 'testing', read = 12, kappa = null, signedOffBy = null }) {
  const passed = kappa !== null && kappa >= 0.8 && read === 30;
  await q(
    `INSERT INTO coachip_phonics_state (detector_model, prompt_version, state, read_count, kappa, is_kappa_passed,
       signed_off_by, signed_off_at, paused_at, pause_reason)
     VALUES ('anthropic/claude-haiku-5.5', 'phonics_v2', $1, $2, $3, $4, $5, $6, $7, $8)`,
    [state, read, kappa, passed, signedOffBy, signedOffBy ? new Date() : null, state === 'paused' ? new Date() : null,
      state === 'paused' ? 'gate' : null],
  );
}

module.exports = {
  GRADER, FRAMEWORK, PIPELINE, seedLibrary, jobRun, session, fact, signal, rollup, moment, sessionSteps, visit, phonics,
};
