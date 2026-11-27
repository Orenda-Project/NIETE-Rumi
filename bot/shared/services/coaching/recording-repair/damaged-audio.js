'use strict';
/**
 * bd-8sr958 (queue #320) — the transcription job's side of damaged-recording recovery.
 *
 *   repairBeforeTranscription(...)  inspect the downloaded bytes; a damaged file is rebuilt and the job carries on with
 *                                   the repaired copy (no message to her). When it cannot be rebuilt it throws a
 *                                   DamagedAudioError, which processTranscription's catch hands to handleDamagedFailure.
 *   handleDamagedFailure(...)       the failure, once: failed_step='damaged_audio', ONE catalog message to her (never "try
 *                                   again"), ONE Slack post to the team (#operators, hafat token already on the worker),
 *                                   and a permanent job so SQS does not deliver it again (#6112's flag).
 *
 * It runs BEFORE the portal short-recording gate (which lets a file through when its duration probe fails) and BEFORE the
 * duplicate-audio check. A finished file is a box walk and nothing else.
 */
// supabase is required lazily (a test injects its own; requiring it exits the process when the env is missing)
const lazySupabase = () => require('../../../config/supabase');
const { logToFile } = require('../../../utils/logger');
const { logEvent } = require('../../../utils/structured-logger');
const { inspectRecording, repairRecording } = require('./index');

const FAILED_STEP = 'damaged_audio';
const PERMANENT_REASON = 'damaged_audio';
const LINK_SECONDS = 7 * 24 * 3600;

class DamagedAudioError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DamagedAudioError';
    this.damaged = true;
    this.permanent = true;
    this.permanentReason = PERMANENT_REASON;
    this.details = details;
  }
}

function sourceOf(session) {
  return session && session.audio_url ? 'portal' : 'whatsapp';
}

function off(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.RECORDING_REPAIR_OFF || ''));
}

/**
 * Her latest good recording from the same recorder (same ftyp brand + free-box size), for its AAC config.
 * At most 2 recent completed sessions are read; a failed read means "no reference", never a failed job.
 */
async function findReference({ session, signature, deps }) {
  try {
    const { data } = await deps.supabase
      .from('coaching_sessions')
      .select('id, audio_url')
      .eq('user_id', session.user_id)
      .eq('status', 'completed')
      .not('audio_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2);
    for (const row of data || []) {
      const { downloadFromR2, extractKeyFromUrl } = deps.r2();
      const buf = await downloadFromR2(extractKeyFromUrl(row.audio_url));
      const info = inspectRecording(buf);
      if (info.kind === 'ok' && info.signature === signature) return buf;
    }
  } catch (e) {
    logToFile('recording-repair: no reference file', { error: e.message }, 'warn');
  }
  return null;
}

/** The same damaged bytes were already refused for this teacher: do not run the ladder (or tell her) again. */
async function alreadyRefused({ session, audioHash, coachingSessionId, deps }) {
  try {
    const { data } = await deps.supabase
      .from('coaching_sessions')
      .select('id')
      .eq('user_id', session.user_id)
      .eq('audio_hash', audioHash)
      .eq('failed_step', FAILED_STEP)
      .neq('id', coachingSessionId)
      .limit(1);
    return !!(data && data.length);
  } catch (e) {
    return false;
  }
}

async function uploadRepaired({ buffer, session, coachingSessionId, deps }) {
  const portal = require('../portal-coaching.service');
  if (portal.isPortalSession(session)) {
    // Keep the portal key shape: a portal row is recognised by its key, and a repaired copy under another shape
    // would turn her page recording into a WhatsApp one (messages to her, no portal progress).
    const key = portal.buildUploadKey(session.user_id, 'm4a', new Date(), require('crypto').randomUUID());
    return deps.r2().uploadAudioBuffer(buffer, key, 'audio/mp4');
  }
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), `repaired_${coachingSessionId}_${Date.now()}.m4a`);
  fs.writeFileSync(tmp, buffer);
  try {
    return await deps.r2().uploadClassroomAudio(tmp, session.user_id, `${coachingSessionId}-repaired`, { format: 'm4a' });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* tmp */ }
  }
}

/**
 * @returns {Promise<{audioData: Buffer, repaired: boolean, result?: object}>}
 * @throws {DamagedAudioError}
 */
async function repairBeforeTranscription({ session, coachingSessionId, audioData, payload = {}, deps = {} }) {
  const d = {
    supabase: deps.supabase || lazySupabase(),
    r2: () => require('../../../storage/r2'),
    repair: repairRecording,
    ...deps,
  };
  if (off()) return { audioData, repaired: false };

  const source = sourceOf(session);
  const info = inspectRecording(audioData);
  // Only a file we can PROVE is damaged (empty, or an MP4/M4A with no moov / no mdat / a torn media box) is repaired.
  // Any other container, or bytes we do not recognise, go to the transcribers as they always have (and to the damaged
  // handler if all three of them refuse the bytes).
  if (!['empty', 'no_moov', 'torn_tail', 'no_mdat'].includes(info.kind)) return { audioData, repaired: false };

  const { computeAudioHash } = require('../audio-hash-cache');
  const audioHash = computeAudioHash(audioData);
  const base = { coachingSessionId, source, kind: info.kind, signature: info.signature, container: info.container, bytes: audioData.length };
  logEvent('recording.inspect', base);

  if (info.kind !== 'empty' && await alreadyRefused({ session, audioHash, coachingSessionId, deps: d })) {
    logEvent('recording.unrecovered', { ...base, reason: 'same_bytes_refused_before' });
    throw new DamagedAudioError('damaged audio: the same bytes were refused before', { ...base, audioHash, repeat: true, wamid: payload.wamid || payload.messageId || null });
  }

  const reference = info.kind === 'empty' ? null : await findReference({ session, signature: info.signature, deps: d });
  const result = await d.repair(audioData, { reference });
  const event = {
    ...base, outcome: result.outcome, method: result.method || null, seconds_taken: result.seconds_taken,
    frames: result.frames || null, audio_seconds: result.seconds || null, template_guess: result.template_guess || null,
    coverage: result.coverage || null, reason: result.reason || null, had_reference: !!reference,
  };
  if (result.outcome === 'repaired') {
    logEvent('recording.repair', event);
    let repairedUrl = null;
    // Only a portal upload has an original in R2 to sit beside. A WhatsApp recording is not stored until the normal flow
    // uploads the bytes it carries on with, which are now the repaired ones.
    if (session.audio_url) {
      try {
        repairedUrl = await uploadRepaired({ buffer: result.buffer, session, coachingSessionId, deps: d });
        // Point the row at the repaired copy (same portal key shape). The original key stays in R2.
        if (repairedUrl && repairedUrl !== session.audio_url) {
          await d.supabase.from('coaching_sessions').update({ audio_url: repairedUrl }).eq('id', coachingSessionId);
        }
      } catch (e) {
        logToFile('recording-repair: repaired copy not stored (flow carries on with the bytes)', { error: e.message }, 'warn');
      }
    }
    return { audioData: result.buffer, repaired: true, result, repairedUrl };
  }
  logEvent('recording.repair', event);
  logEvent('recording.unrecovered', event);
  throw new DamagedAudioError(`damaged audio: ${info.kind} (${result.reason || 'not repaired'})`, { ...base, audioHash, reason: result.reason, original: audioData });
}

/** Link a person on the team can open for 7 days. The original bytes are stored once, under their own key. */
async function storeOriginalForTeam({ details, session, coachingSessionId, deps }) {
  try {
    if (session && session.audio_url) return await deps.r2().getPresignedUrl(session.audio_url, LINK_SECONDS);
    if (!details || !details.original || !details.original.length) return null;
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `damaged_${coachingSessionId}_${Date.now()}.m4a`);
    fs.writeFileSync(tmp, details.original);
    try {
      const url = await deps.r2().uploadClassroomAudio(tmp, session.user_id, `${coachingSessionId}-damaged`, { format: 'm4a' });
      return await deps.r2().getPresignedUrl(url, LINK_SECONDS);
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* tmp */ }
    }
  } catch (e) {
    logToFile('recording-repair: no link for the team', { error: e.message }, 'warn');
    return null;
  }
}

/** One Slack post to #operators with the hafat token (PROD_ALERTS_SLACK_*). Name and school, never the phone. */
async function alertTeam({ session, details, error, link, deps, env = process.env }) {
  const slack = { token: env.PROD_ALERTS_SLACK_TOKEN || '', channel: env.PROD_ALERTS_SLACK_CHANNEL || '' };
  if (!slack.token || !slack.channel) {
    logEvent('recording.unrecovered_alert', { sent: false, why: 'slack_unconfigured', coachingSessionId: details.coachingSessionId });
    return false;
  }
  const u = (session && session.users) || {};
  const who = [u.name || 'A teacher', u.school_name ? `· ${u.school_name}` : null].filter(Boolean).join(' ');
  const text = [
    `*Damaged recording, not recovered* — ${who}`,
    `${details.kind || 'unreadable'} · ${details.signature || 'unknown recorder'} · ${details.source} · ${details.bytes ? (details.bytes / 1e6).toFixed(1) : '?'} MB`,
    link ? `<${link}|Original file (link works 7 days)>` : 'Original file: no link (store failed)',
    `Session ${details.coachingSessionId}`,
  ].join('\n');
  try {
    const post = deps.postToSlack || require('../../monitoring/quiz-funnel-watch.service').postToSlack;
    await post(text, slack, { color: '#d97706' });
    logEvent('recording.unrecovered_alert', { sent: true, coachingSessionId: details.coachingSessionId });
    return true;
  } catch (e) {
    logToFile('recording-repair: Slack post failed', { error: e.message }, 'warn');
    return false;
  }
}

/**
 * The failure, once. Returns true when it handled the error (the caller then skips its generic message).
 * `error` is a DamagedAudioError, or the #6112 "all three transcribers refused the bytes" error.
 */
async function handleDamagedFailure({ coachingSessionId, error, phoneNumber, deps = {} }) {
  const d = {
    supabase: deps.supabase || lazySupabase(),
    r2: () => require('../../../storage/r2'),
    sendMessage: (to, text) => require('../../whatsapp.service').sendMessage(to, text),
    sendReaction: (to, id, emoji) => require('../../whatsapp.service').sendReaction(to, id, emoji, { soleAck: true }),
    markAsFailed: (id, step, msg) => require('./../coaching-session.service').markAsFailed(id, step, msg),
    ...deps,
  };
  const details = { ...(error.details || {}), coachingSessionId };
  try {
    const { data: session } = await d.supabase
      .from('coaching_sessions')
      .select('*, users!inner(phone_number, name, school_name, preferred_language)')
      .eq('id', coachingSessionId)
      .single();
    details.source = details.source || sourceOf(session);

    const hash = details.audioHash || null;
    await d.markAsFailed(coachingSessionId, FAILED_STEP, String(error.message).slice(0, 500));
    if (hash) await d.supabase.from('coaching_sessions').update({ audio_hash: hash }).eq('id', coachingSessionId);

    const portal = require('../portal-coaching.service');
    // A coach's portal observation is followed in the portal: nothing to her WhatsApp. A teacher's own portal recording
    // still gets the ONE message, as the generic failure message always reached her (the page may be off the flag).
    const quiet = !session || portal.isPortalObservation(session);
    const to = phoneNumber || (session && session.users && session.users.phone_number);

    if (details.repeat) {
      // The same damaged bytes again: a ⏳ reaction on her message (when we have it), no text, no second alert.
      if (!quiet && to && details.wamid) {
        try { await d.sendReaction(to, details.wamid, '⏳'); } catch (e) { /* best effort */ }
      }
      logEvent('recording.unrecovered', { ...details, repeat: true, message_sent: false });
      return true;
    }

    if (!quiet && to) {
      const { getCoachingMessage } = require('../../../config/coaching-messages');
      const { clampLanguage } = require('../../../config/ux-strings');
      const lang = clampLanguage((session.users && session.users.preferred_language) || 'ur');
      await d.sendMessage(to, getCoachingMessage('damagedRecording', lang));
    }
    const link = await storeOriginalForTeam({ details, session, coachingSessionId, deps: d });
    await alertTeam({ session, details, error, link, deps: d });
    return true;
  } catch (e) {
    logToFile('recording-repair: handleDamagedFailure failed', { error: e.message, coachingSessionId }, 'error');
    return true;
  }
}

/** #6112's "all three transcribers refused the bytes" is the same situation, seen after the repair step passed it on. */
function asDamaged(error) {
  if (error && error.damaged) return true;
  return !!(error && error.permanent && error.permanentReason === 'unreadable_audio');
}

module.exports = { repairBeforeTranscription, handleDamagedFailure, DamagedAudioError, asDamaged, FAILED_STEP, PERMANENT_REASON };
