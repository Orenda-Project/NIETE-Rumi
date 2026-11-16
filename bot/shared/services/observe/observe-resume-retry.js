/**
 * bd-i3618q — the retry half of observe-resume (bd-go4tl), moved verbatim out of
 * observe-resume.service.js to keep it under 300 lines. observe-resume.service.js
 * re-exports runRetry, so callers keep requiring that file.
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { observeStrings, observeLang } = require('./observe-strings');
const { isTerminalStatus } = require('../coaching/session-terminal');
const { logToFile, logError } = require('../../utils/logger');
const { _loadOwn, _refuseTerminal } = require('./observe-resume-common');

const MAX_RETRIES = 2;

// bd-go4tl.2 — WHERE to re-enter the pipeline, and whether we can at all.
//
// The old guard was `count >= MAX_RETRIES || !s.transcript_text`, and it only
// ever re-queued ANALYSIS. A session that died DURING transcription has no
// transcript by definition, so the coach's one lever refused precisely the
// sessions that needed it — on attempt ZERO. Javeria's 28-Aug row is the case:
// observe_retry_count undefined, transcript_text null, audio_id present, and
// she was told it "keeps stopping".
//
// The real question is not "is there a transcript" but "what is the earliest
// phase we still hold the inputs for". Status says where it died; 'failed' and
// 'confirmed' carry no phase, so fall back to what the row actually holds.
// The status->queue map is imported, not re-declared — one owner (bd-h9gnk).
const CLAIM_STATUS_BY_QUEUE = {
  transcription: 'confirmed',
  analysis: 'analysis_started',
  report: 'analysis_complete',
};

function _retryPlan(s) {
  const count = (s.analysis_data && s.analysis_data.observe_retry_count) || 0;
  if (count >= MAX_RETRIES) return { ok: false, reason: 'retry_bound_reached', count };

  const { RETRY_QUEUE_BY_STATUS } = require('../coaching/coaching-stale-recovery');
  let queue = RETRY_QUEUE_BY_STATUS[s.status] || (s.transcript_text ? 'analysis' : 'transcription');

  // Fall back to whichever input we still have; refuse only when we have neither.
  if (queue === 'transcription' && !s.audio_id) {
    if (!s.transcript_text) return { ok: false, reason: 'nothing_to_retry_from', count };
    queue = 'analysis';
  } else if (queue !== 'transcription' && !s.transcript_text) {
    if (!s.audio_id) return { ok: false, reason: 'nothing_to_retry_from', count };
    queue = 'transcription';
  }
  return { ok: true, queue, count };
}

// bd-go4tl.3 — the refusal used to promise "the team has been told" while doing
// nothing but an info-level log. Say something true to the coach, and leave a
// trace a human can actually find: an ERROR the sink can see, and error_message
// on the row (Javeria's still read null three hours in).
async function _refuseRetry(s, from, S, plan) {
  await WhatsAppService.sendMessage(from, S.resume_retry_exhausted);
  logError('⛔ observe-resume: retry refused', {
    sessionId: s.id, reason: plan.reason, count: plan.count,
    hasTranscript: !!s.transcript_text, hasAudio: !!s.audio_id,
  });
  await supabase
    .from('coaching_sessions')
    .update({
      error_message: `observe resume refused: ${plan.reason} after ${plan.count} attempt(s) (bd-go4tl)`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', s.id);
}

/** The [run it again] tap — CAS off the read status so a double-tap queues once. */
async function runRetry(sessionId, from, user) {
  const S = observeStrings(observeLang(user));
  const s = await _loadOwn(sessionId, user);
  if (!s) { await WhatsAppService.sendMessage(from, S.debrief_not_yours); return; }
  if (isTerminalStatus(s.status)) return _refuseTerminal(s, from, user, 'retry');
  const plan = _retryPlan(s);
  if (!plan.ok) return _refuseRetry(s, from, S, plan);

  const { data: claimed } = await supabase
    .from('coaching_sessions')
    .update({
      status: CLAIM_STATUS_BY_QUEUE[plan.queue],
      analysis_data: { ...(s.analysis_data || {}), observe_retry_count: plan.count + 1 },
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('status', s.status)      // CAS: only advance from the state we read
    .select();
  if (!claimed || !claimed.length) {
    await WhatsAppService.sendMessage(from, S.resume_wait_ack); return;
  }

  // bd-go4tl.2: re-enter at the phase it died in. Always queueing analysis meant
  // a session that never produced a transcript was handed to the analyser with
  // nothing to analyse.
  const Q = require('../coaching/coaching-job-queue.service');
  if (plan.queue === 'transcription') {
    await Q.queueTranscription(sessionId, { from, audioId: s.audio_id });
  } else if (plan.queue === 'analysis') {
    await Q.queueAnalysis(sessionId, { from, trigger: 'observe_manual_retry' });
  } else {
    await Q.queueReport(sessionId, { from });
  }
  await WhatsAppService.sendMessage(from, S.resume_retry_ack);
  logToFile('🔄 observe-resume: pipeline re-entered', {
    sessionId, queue: plan.queue, fromStatus: s.status, retry: plan.count + 1 });
}

module.exports = { MAX_RETRIES, _retryPlan, _refuseRetry, runRetry };
