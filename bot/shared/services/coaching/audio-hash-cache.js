/**
 * Coaching Audio Hash Cache — bd-7beiz
 *
 * The same recording must produce the same score. It did not: the rubric pass
 * runs gpt-5-mini at temperature 1 with no seed (gpt5-mini.service.js:415), so
 * every submission is an independent sample of a 37-indicator rubric and
 * nothing stopped identical audio being sampled twice.
 *
 * Measured on NIETE production, 17 Aug – 20 Sep 2026, grouping DC sessions on
 * (user, duration, bytes): 1,515 duplicate groups covering 3,515 sessions,
 * mean overall spread 5.9 points, 335 groups ≥10 points, Section B spread
 * averaging 6.9 of 40 marks. The report that surfaced it (DC feedback rows
 * 124-126) is one teacher sent 57.4% and then 63.5% for the same 2309-second
 * recording, submitted twice on 15 Sep with the same lesson plan attached.
 *
 * SHA-256 over the audio bytes: collisions are infeasible above a few KB, and a
 * genuinely re-recorded lesson has different bytes (codec jitter, ambient
 * noise), so this only ever hits on a bit-for-bit identical resubmission.
 *
 * ⚠️ What this does NOT do: make the scorer deterministic. It stops the same
 * bytes being scored twice; a teacher who records the same lesson again still
 * gets a fresh sample. Reducing the scorer's own variance is a separate piece
 * of work — see bd-ls9x5's write-up.
 *
 * Scope: the functions below the header are the DC (teacher self-recorded)
 * path; the leader-observation counterpart (bd-erpvf) is at the end of the file
 * and is a different operation. For DC, `observation_type IS NULL`
 * is filtered in the lookup AND checked at the call site, so a coach's leader
 * observation is never deduped against — its debrief is a separate state
 * machine and reusing a prior analysis under it is not the same operation.
 */

const crypto = require('crypto');

/**
 * How the prior report must be delivered, decided by what the artefact actually
 * IS rather than by the column's name.
 *
 * `report_pdf_url` is a misnomer on this deployment: the FICO hero renderer
 * returns a PNG and `uploadReportImage` stores it as `{session}_report.png`
 * with ContentType image/png. Production, completed DC sessions since 1 Aug
 * 2026: 12,749 hold a `.png`, 5 hold nothing, ZERO hold a `.pdf`.
 *
 * Sending those PNG bytes as a `.pdf` document is a known defect — see the warning at
 * report-generator.service.js:877: "WhatsApp delivered a PDF that WAS actually
 * PNG bytes, so every PDF reader rejected it as corrupt."
 *
 * @param {string} url
 * @returns {'image'|'document'|'none'}
 */
function priorReportDelivery(url) {
  if (!url) return 'none';
  // Strip query/fragment before looking at the extension — an R2 URL can carry
  // a signature, and `...report.png?sig=` must not read as "no extension".
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.pdf')) return 'document';
  // Anything else is treated as an image. Deliberate: the hero PNG is the only
  // artefact this deployment produces, and guessing "document" on an unknown
  // URL is precisely what shipped a file that would not open. An image that is
  // not an image fails visibly; a PDF that is not a PDF fails silently.
  return 'image';
}

/**
 * SHA-256 hex digest of a Buffer of audio bytes.
 * @param {Buffer} buffer
 * @returns {string} 64-char hex
 */
function computeAudioHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * The most recent completed DC session for this user carrying the same audio
 * hash, excluding the one in flight.
 *
 * Partition-safe per user: a cross-user match is impossible, so one teacher can
 * never be shown another's report. `status = 'completed'` keeps us off in-flight
 * and failed runs, which carry no analysis to reuse.
 *
 * No time window (bd-hr97y): a recording is analysed once, ever, as in the two
 * HITL checks. The 7-day lookback ported from the main bot had no recorded
 * reason, and let a teacher re-send the same file on day 8 for a fresh score.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.audioHash        SHA-256 hex digest
 * @param {string} [opts.excludeSessionId] the in-flight session
 * @returns {Promise<object|null>} the prior session row, or null
 */
async function findRecentDuplicateSession(supabase, opts) {
  const { userId, audioHash, excludeSessionId } = opts || {};

  if (!userId || !audioHash) return null;

  let q = supabase
    .from('coaching_sessions')
    // Class R — narrow by design. `analysis_data` is a fat JSONB, but this
    // reads at most ONE row (`.limit(1)`, index-backed) on the cold path of a
    // coaching session, not on a timer or per-message. The columns nothing
    // downstream reads are deliberately absent.
    .select('id, analysis_data, report_pdf_url, created_at')
    .eq('user_id', userId)
    .eq('audio_hash', audioHash)
    .eq('status', 'completed')
    // DC only — a leader observation is a different activity and is never a
    // duplicate of a teacher's own recording.
    .is('observation_type', null);

  if (excludeSessionId && typeof q.neq === 'function') {
    q = q.neq('id', excludeSessionId);
  }

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  if (!data) return null;
  // Defensive: never return the in-flight session as its own duplicate, even if
  // the .neq above was dropped.
  if (excludeSessionId && data.id === excludeSessionId) return null;
  return data;
}

/**
 * Reuse a prior session's analysis for an identical resubmission: stamp the
 * current row with the prior score, tell the teacher what happened, and resend
 * the report she already has.
 *
 * Deps are injected so the branch is testable without a live Supabase, Meta or
 * filesystem. The call site in transcription-processor supplies the real ones.
 *
 * @returns {Promise<boolean>} true when the submission was handled and the
 *   caller must not transcribe (always true once a duplicate is found — a
 *   terminal session is still handled, just silently).
 */
async function resolveDuplicateSubmission(ctx, opts) {
  // bd-c5reix: `quiet` — a recording sent from the app, followed there (its page shows the repeat): nothing to WhatsApp.
  const { coachingSessionId, from, userId, audioHash, duplicate, quiet = false } = ctx;
  const log = opts.log || (() => {});
  // Class N: a degraded-but-recovered path must not land at `info`, or the
  // error monitor cannot see it. Falls back to `log` only for tests that do
  // not inject one.
  const warn = opts.warn || log;

  const { applied } = await opts.updateIfNotTerminal(coachingSessionId, {
    audio_hash: audioHash,
    status: 'completed',
    analysis_data: duplicate.analysis_data,
    report_pdf_url: duplicate.report_pdf_url,
    duplicate_of_session_id: duplicate.id,
    transcription_completed_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  // bd-n9832: the job outlives a cancel. If the session is already over, we
  // still skip transcription — but we do not message her about a session she
  // ended, and we do not reopen it.
  if (!applied) {
    log('🚫 duplicate audio, but the session is already over — not reopened', { coachingSessionId });
    return true;
  }

  if (quiet) {
    log('🎯 duplicate audio — prior score reused (a portal recording: nothing sent to WhatsApp)', {
      coachingSessionId, priorSessionId: duplicate.id, audioHash,
    });
    return true;
  }

  const lang = (await opts.getLanguage(userId)) || 'en';
  await opts.sendMessage(from, opts.getMessage('duplicateRecording', lang));

  // Deliver it the SAME WAY the first report was delivered. The original send
  // branches on the rendered shape (hero PNG → sendImage, PDFKit → sendDocument);
  // this branches on the stored artefact, which is the same decision one step later.
  const priorReport = duplicate.report_pdf_url;
  const delivery = priorReportDelivery(priorReport);
  if (delivery !== 'none') {
    try {
      if (delivery === 'image') {
        await opts.sendImageFromUrl(from, priorReport, '');
      } else {
        await opts.sendDocumentFromUrl(from, priorReport, 'classroom-observation.pdf');
      }
    } catch (err) {
      // The score has already been reused, which is the point of the feature.
      // A missing R2 object must not turn that into a failed session.
      warn('⚠️ could not resend the prior report (non-fatal)', {
        coachingSessionId, delivery, error: err && err.message,
      });
    }
  }

  log('🎯 duplicate audio — prior score reused instead of re-scoring', {
    coachingSessionId, priorSessionId: duplicate.id, audioHash,
  });
  return true;
}

// ── bd-erpvf — the HITL (/observe) counterpart ─────────────────────────────
//
// HITL row 185: a coach's classroom recording is analysed ONCE. The DC dedupe
// above deliberately skips leader observations, so a coach re-sending the same
// audio through /observe got a fresh, differently-sampled FICO analysis each
// time — 23 (coach, bytes) groups covering 52 sessions on NIETE production as
// of 29 Sep 2026. Different operation from DC: nothing is reused or resent;
// the new observation is closed and the coach is asked for a new recording.

/** A prior in any of these states was never analysed — it must not block. */
const NOT_ANALYSED_STATUSES = ['cancelled', 'abandoned', 'failed'];

/**
 * The most recent leader observation BY THIS COACH over the same audio bytes,
 * excluding the one in flight. No time window: the requirement is "only once".
 *
 * Keyed on observer_user_id, not user_id — a bound observation's user_id is the
 * TEACHER (the visit picker binds her), and the same recording filed under a different teacher is
 * still the same recording. audio_hash is stamped after transcription for every
 * session, so any prior that reached analysis carries it.
 *
 * `analysisStarted` (bd-r2uzg1.18.9): only an observation whose analysis has started — the analysis-time re-check
 * below. Left out, the transcription-time check is unchanged.
 *
 * @returns {Promise<object|null>} { id, status, created_at } or null
 */
async function findPriorLeaderObservation(supabase, opts) {
  const { observerUserId, audioHash, excludeSessionId, analysisStarted = false } = opts || {};
  if (!observerUserId || !audioHash) return null;

  let q = supabase
    .from('coaching_sessions')
    .select('id, status, created_at')
    .eq('observer_user_id', observerUserId)
    .eq('audio_hash', audioHash)
    .eq('observation_type', 'leader_observation')
    .not('status', 'in', `(${NOT_ANALYSED_STATUSES.join(',')})`);

  if (analysisStarted) q = q.not('analysis_started_at', 'is', null);
  if (excludeSessionId) q = q.neq('id', excludeSessionId);

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (excludeSessionId && data.id === excludeSessionId) return null;
  return data;
}

/**
 * Close an already-analysed resubmission and tell the coach.
 *
 * `quiet` (bd-r2uzg1.18.9): close it the same way but say nothing — the coach is following another observation.
 *
 * @param {object} ctx  { coachingSessionId, from, observerUserId, audioHash, prior, quiet? }
 * @param {object} opts { updateIfNotTerminal, sendMessage, getLanguage, getStrings, log, afterApplied? }
 * @returns {Promise<boolean>} always true — the caller must not transcribe
 */
async function refuseDuplicateObservation(ctx, opts) {
  const { coachingSessionId, from, observerUserId, audioHash, prior, quiet = false } = ctx;
  const log = opts.log || (() => {});

  const { applied } = await opts.updateIfNotTerminal(coachingSessionId, {
    audio_hash: audioHash,
    status: 'cancelled',
    duplicate_of_session_id: prior.id,
  });

  // bd-n9832: the coach may already have tapped Cancel on the capture ack.
  // Still no transcription, but no message about an observation she ended.
  if (!applied) {
    log('🚫 duplicate observation audio, but the session is already over', { coachingSessionId });
    return true;
  }

  if (quiet) {
    log('🔁 observe: superseded by the coach\'s newer observation of the same recording — closed quietly', {
      coachingSessionId, priorSessionId: prior.id, priorStatus: prior.status, audioHash,
    });
    return true;
  }

  // The COACH's language — the row's user may be the bound teacher. No floor
  // here: observeStrings already resolves an unknown language to the catalog's.
  const lang = await opts.getLanguage(observerUserId);
  // /observe2 gives the visit's form back and says so (afterApplied returns the extra line, or null).
  let extra = null;
  if (opts.afterApplied) {
    try { extra = await opts.afterApplied(lang); } catch (err) {
      log('⚠️ duplicate observation: the after-refusal step failed', { coachingSessionId, error: err && err.message });
    }
  }
  const refusal = opts.getStrings(lang).capture_duplicate_recording;
  await opts.sendMessage(from, extra ? `${refusal}\n\n${extra}` : refusal);

  log('🔁 observe: recording already analysed — resubmission refused', {
    coachingSessionId, priorSessionId: prior.id, priorStatus: prior.status, audioHash,
  });
  return true;
}

/**
 * bd-r2uzg1.18.9 (HITL row 186) — the same check again when the analysis is about to START.
 *
 * The check above runs once, in the transcription worker. The analysis starts later (after the photo and lesson-plan
 * steps, or when a failed analysis job is retried), and by then the picture can have changed. NIETE production,
 * 8 Oct – 4 Nov 2026, 4 (coach, bytes) groups analysed twice, all past that one check:
 *   - the first observation's analysis failed; the coach sent the recording again (rightly let through: a failed
 *     prior was never analysed); the FIRST job then ran again (SQS redelivery ~15 min later, or a tap on one of its
 *     old buttons) and completed too (22 Oct, 2 Nov, 4 Nov);
 *   - the same recording arrived twice within a second, and both passed because the hash is only stored once
 *     transcription has finished (8 Oct).
 *
 * So: before analysing, look for another observation of the same bytes by the same coach whose analysis has
 * STARTED and that is not cancelled/abandoned/failed.
 *   - It is OLDER: this one is a repeat → refused exactly as above (cancelled, duplicate_of_session_id, the
 *     "already analysed" line, /observe2's form given back).
 *   - It is NEWER: this is the old failed observation coming back after the coach re-sent the recording → closed
 *     the same way but quietly; the coach is following the newer one.
 *
 * Leader observations only; a row without a hash (never stamped), a row whose own analysis already finished (a re-run
 * of it is not a second analysis of the recording, and must never close a finished observation) and a test account on
 * skip_recording_duplicate_check go ahead. Throws only if a dep throws — the caller fails OPEN.
 *
 * @param {object} session  the coaching_sessions row (id, observation_type, observer_user_id, audio_hash, created_at,
 *                          analysis_completed_at)
 * @param {object} deps     { from, findPrior, skipsCheck } + refuseDuplicateObservation's opts (updateIfNotTerminal,
 *                          sendMessage, getLanguage, getStrings, log, afterApplied?)
 * @returns {Promise<boolean>} true when this observation was closed and must not be analysed
 */
async function refuseIfAlreadyAnalysed(session, deps) {
  if (!session || session.observation_type !== 'leader_observation') return false;
  const observerUserId = session.observer_user_id;
  const audioHash = session.audio_hash;
  if (!observerUserId || !audioHash || session.analysis_completed_at) return false;
  if (await deps.skipsCheck(observerUserId)) return false;

  const prior = await deps.findPrior({ observerUserId, audioHash, excludeSessionId: session.id, analysisStarted: true });
  if (!prior) return false;

  const newer = Boolean(prior.created_at && session.created_at)
    && Date.parse(prior.created_at) > Date.parse(session.created_at);
  return refuseDuplicateObservation(
    { coachingSessionId: session.id, from: deps.from, observerUserId, audioHash, prior, quiet: newer },
    deps,
  );
}

/**
 * bd-zq0ea — the debrief counterpart. The coach's debrief conversation lives
 * inside analysis_data.observer_debrief, so its hash does too (no column). A
 * prior counts only once it was actually coached (`feedback` present) — a
 * debrief that failed or was too short never produced an analysis and must not
 * block the coach. No time window, and any observation of this coach's except
 * the one in flight ("Debrief now" already refuses a done one for itself).
 *
 * Class R: one row by id/created_at only — never the fat analysis_data blob.
 *
 * @returns {Promise<object|null>} { id, created_at } or null
 */
async function findPriorAnalysedDebrief(supabase, opts) {
  const { observerUserId, audioHash, excludeSessionId } = opts || {};
  if (!observerUserId || !audioHash) return null;

  let q = supabase
    .from('coaching_sessions')
    .select('id, created_at')
    .eq('observer_user_id', observerUserId)
    .eq('observation_type', 'leader_observation')
    .eq('analysis_data->observer_debrief->>audio_hash', audioHash)
    .not('analysis_data->observer_debrief->feedback', 'is', null);

  if (excludeSessionId) q = q.neq('id', excludeSessionId);

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (excludeSessionId && data.id === excludeSessionId) return null;
  return data;
}

module.exports = {
  computeAudioHash,
  priorReportDelivery,
  findRecentDuplicateSession,
  resolveDuplicateSubmission,
  findPriorLeaderObservation,
  refuseDuplicateObservation,
  refuseIfAlreadyAnalysed,
  findPriorAnalysedDebrief,
};
