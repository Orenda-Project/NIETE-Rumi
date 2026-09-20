/**
 * Transcription Processor Service
 * Handles audio transcription workflow for classroom observations
 *
 * Responsibilities:
 * - Download audio from WhatsApp
 * - Upload audio to R2 storage
 * - Transcribe with Soniox (speaker diarization)
 * - Send progress updates to user
 * - Handle transcription errors with notifications
 *
 * Extracted from coaching.service.js as part of Phase 2 refactoring
 */

const fs = require('fs');
const path = require('path');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const AudioService = require('../audio.service');
const WhatsAppService = require('../whatsapp.service');
const CoachingSessionService = require('./coaching-session.service');
const { uploadClassroomAudio } = require('../../storage/r2');
const { TEMP_DIR, LISTENING_ANIMATION_MEDIA_ID } = require('../../utils/constants');
const { getUserLanguage, setUserLanguage } = require('../../utils/language-cache');
const { analyzeLanguage } = require('../../utils/language-detector');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { clampLanguage } = require('../../config/ux-strings');
const { offerDefaultLanguage } = require('../../config/languages');
const { buildDiarizationFromTokens, detectSilences, assembleDiarizedTranscription } = require('./diarization-from-tokens');

class TranscriptionProcessorService {
  /**
   * Process transcription job (called by background worker)
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {object} payload - Job payload with metadata
   * @returns {Promise<void>}
   */
  static async processTranscription(coachingSessionId, payload) {
    const tempAudioPath = path.join(TEMP_DIR, `classroom_${coachingSessionId}_${Date.now()}.ogg`);

    try {
      // Ensure temp directory exists
      if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
      }

      logToFile('🔄 Starting transcription processing', { coachingSessionId });

      // Get session data
      const { data: session, error: sessionError } = await supabase
        .from('coaching_sessions')
        // `preferred_language` is here so the Step 1/5 message below can be sent
        // in her language (bd-jbjrx). PostgREST embeds only what the select
        // names, so dropping it silently reverts that fix to English.
        .select('*, users!inner(phone_number, name, preferred_language)')
        .eq('id', coachingSessionId)
        .single();

      if (sessionError || !session) {
        throw new Error('Coaching session not found');
      }

      const from = payload.from || session.users.phone_number;

      // Update status
      await CoachingSessionService.updateStatus(coachingSessionId, 'transcribing', {
        transcription_started_at: new Date().toISOString()
      });

      // Send progress update with listening animation.
      //
      // bd-jbjrx — this call used to pass no language, so the parameter default
      // ('en') addressed every teacher in English while steps 3/4/5 resolved
      // hers. One session, two languages. Same shape as
      // report-generator's `_languageFromSession`: her stored preference,
      // floored to what the deployment offers FIRST. We hold her row here, so
      // "nothing can be determined" is not the situation and the emergency
      // 'en' floor would be the wrong one.
      await this.sendProgressUpdate(
        from,
        1,
        clampLanguage(session.users.preferred_language || offerDefaultLanguage())
      );

      // Download audio from WhatsApp
      const audioId = payload.audioId;
      if (!audioId) {
        throw new Error('Audio ID not found in payload');
      }

      const audioData = await WhatsAppService.downloadMedia(audioId);
      fs.writeFileSync(tempAudioPath, audioData);

      logToFile('Audio downloaded from WhatsApp', {
        coachingSessionId,
        fileSize: audioData.length
      });

      // Upload to R2 storage
      const r2Url = await uploadClassroomAudio(
        tempAudioPath,
        session.user_id,
        coachingSessionId,
        {
          duration: session.audio_duration_seconds,
          language: 'unknown',
          format: 'ogg'
        }
      );

      logToFile('Audio uploaded to R2', { coachingSessionId, r2Url });

      // Transcribe with diarization
      const transcriptionResult = await this.transcribeWithDiarization(tempAudioPath);

      logToFile('Transcription completed', {
        coachingSessionId,
        transcriptLength: transcriptionResult.transcript.length,
        speakerCount: transcriptionResult.diarization.speakers.length,
        confidence: transcriptionResult.diarization.confidence,
        tokenCount: transcriptionResult.tokens?.length || 0,
        silenceCount: transcriptionResult.silences?.length || 0
      });

      // === PHASE 2: Language detection — OBSERVE ONLY ===
      //
      // Classroom audio no longer changes a teacher's stored language.
      //
      // This path was the mechanism behind every measured mismatch: 168 teachers
      // had been answered in a language that was not their stored preference,
      // because the language of a LESSON was being written to the teacher's
      // PROFILE. A recording is evidence about a classroom, not a request to
      // change an interface — and with only two languages and a working picker,
      // the upside of guessing was saving one tap.
      //
      // The explicit verbal override ("reply to me in Urdu") still works and
      // still writes; it is handled in the text and voice handlers, is already
      // clamped to the offer, and is a real statement of intent.
      //
      // Gated rather than deleted outright so rollback is a flag flip during the
      // soak. The flag defaults to OFF, so the safe behaviour is the default and
      // a missing or malformed value degrades to correct. Once the soak is clean,
      // this branch and the flag go, along with the now-unused write path in
      // language-detector.
      const AUDIO_MAY_WRITE_LANGUAGE = process.env.LANGUAGE_AUDIO_AUTOFLIP === 'true';

      const currentLanguage = await getUserLanguage(session.user_id);
      const languageAnalysis = analyzeLanguage(
        {
          transcript: transcriptionResult.transcript,
          tokens: transcriptionResult.tokens || []
        },
        currentLanguage
      );

      // Ported from the main bot: NEVER re-language a
      // school leader from the classroom they walked into. On a leader observation
      // the audio is SOMEONE ELSE'S lesson — the observer's own interface language
      // is their preference, not a function of the teacher they happened to observe.
      // Retained beneath the global gate: if the flag is ever turned back on, this
      // protection must not have quietly disappeared underneath it.
      const isLeaderObservation = session.observation_type === 'leader_observation';

      if (!AUDIO_MAY_WRITE_LANGUAGE) {
        // The normal path. Record what we heard so the telemetry can still show
        // lesson-vs-interface language divergence, then write nothing.
        logToFile('🈳 language_decision: audio-never-writes', {
          userId: session.user_id,
          keptLanguage: currentLanguage,
          detectedLessonLanguage: languageAnalysis.newLanguage || null,
          wouldHaveSwitched: !!languageAnalysis.shouldUpdate,
          reason: languageAnalysis.reason,
          rule: 'audio-never-writes'
        });
      } else if (isLeaderObservation && languageAnalysis.shouldUpdate) {
        logToFile('🔭 observe: language auto-switch SKIPPED for observer', {
          userId: session.user_id,
          keptLanguage: currentLanguage,
          lessonLanguage: languageAnalysis.newLanguage,
        });
      } else if (languageAnalysis.shouldUpdate && languageAnalysis.newLanguage) {
        const updateSuccess = await setUserLanguage(session.user_id, languageAnalysis.newLanguage);

        if (updateSuccess) {
          logToFile('✅ User language preference updated', {
            userId: session.user_id,
            previousLanguage: currentLanguage,
            newLanguage: languageAnalysis.newLanguage,
            reason: languageAnalysis.reason,
            confidence: languageAnalysis.details.confidence,
            rule: 'audio-autoflip-legacy'
          });
        }
      } else {
        logToFile('ℹ️  Language preference unchanged', {
          userId: session.user_id,
          currentLanguage,
          reason: languageAnalysis.reason
        });
      }

      // Validate transcript length and warn if potentially problematic
      const transcriptLength = transcriptionResult.transcript.length;
      const estimatedTokens = Math.ceil(transcriptLength / 3); // Rough estimate

      if (transcriptLength > 15000) {
        logToFile('⚠️  Long transcript detected', {
          coachingSessionId,
          transcriptLength,
          estimatedTokens,
          warning: 'May exceed GPT-5 mini output token limit'
        });

        // bd-di5ap (DC row 129): the teacher-facing send that used to sit here is
        // gone. The 15,000 gate is an ENGINEERING threshold — see the warning on
        // the log line above, it is about a model's output limit — and NIETE only
        // routes recordings of 15+ minutes into this job, so it fired for the
        // majority of sessions. A warning that is the normal case is not a
        // warning, and it contradicted the "30-60 seconds" promise made one
        // message earlier. The signal is real, so the telemetry stays; only the
        // message to the teacher goes.
      }

      // Backfill the true duration when the webhook never gave us one.
      // WhatsApp reports a duration for voice notes but NOT for documents, and a
      // recording sent as a file (.m4a/.mp4) is the normal case for a 40-minute
      // lesson. A null duration surfaced to Riffat as "your 0-minute recording"
      // and also reached analyzePedagogy as metadata.duration. We already have the
      // audio downloaded here, so probe it. Non-fatal: a probe failure must never
      // cost us a transcript we just paid for.
      let backfilledDuration = null;
      if (!session.audio_duration_seconds) {
        try {
          const probed = await AudioService.getAudioDuration(audioData);
          if (probed > 0) {
            backfilledDuration = Math.round(probed);
            logToFile('⏱️  Audio duration backfilled via ffprobe', {
              coachingSessionId,
              durationSeconds: backfilledDuration,
            });
          }
        } catch (err) {
          logToFile('⚠️  Duration probe failed (non-fatal)', {
            coachingSessionId,
            error: err && err.message,
          });
        }
      }

      // Update database with transcription data and tokens for enhanced viewer
      const updateData = {
        audio_url: r2Url,
        audio_format: 'ogg',
        audio_size_bytes: audioData.length,
        transcript_text: transcriptionResult.transcript,
        transcript_language: transcriptionResult.language,
        diarization_data: transcriptionResult.diarization,
        diarization_confidence: transcriptionResult.diarization.confidence,
        status: 'transcription_complete',
        transcription_completed_at: new Date().toISOString(),
        transcription_cost: transcriptionResult.cost || 0
      };

      if (backfilledDuration) {
        updateData.audio_duration_seconds = backfilledDuration;
        session.audio_duration_seconds = backfilledDuration; // downstream reads this row object
      }

      // Add tokens and silences for enhanced transcript viewer (Phase 1)
      // These columns may not exist yet - migration required
      if (transcriptionResult.tokens && transcriptionResult.tokens.length > 0) {
        updateData.tokens_raw = transcriptionResult.tokens;
        logToFile('Storing tokens for enhanced viewer', {
          coachingSessionId,
          tokenCount: transcriptionResult.tokens.length
        });
      }
      if (transcriptionResult.silences && transcriptionResult.silences.length > 0) {
        updateData.silence_markers = transcriptionResult.silences;
        logToFile('Storing silence markers for enhanced viewer', {
          coachingSessionId,
          silenceCount: transcriptionResult.silences.length
        });
      }

      // bd-n9832: the transcription job outlives a cancel — it was queued
      // before it and lands after. An unpredicated write here reopened the
      // session AND then sent the photo gate, which is the very stale button
      // that started the revival chain.
      const { updateIfNotTerminal } = require('./session-terminal');
      const { applied: transcriptApplied } = await updateIfNotTerminal(coachingSessionId, updateData);
      if (!transcriptApplied) {
        logToFile('🚫 transcription finished but the session is over — not reopened', { coachingSessionId });
        return;
      }

      // Ported from the main bot: leader observations
      // skip every teacher interstitial (encouraging message, agency reminder) — those
      // are teacher-praise, not coach UI. bd-9hzdn.1 (observe parity): when
      // OBSERVE_CAPTURE_GATES_ENABLED, the COACH now gets the same photo → LP gates the
      // teacher flow has (prompts addressed to the coach `from`, in the COACH's language
      // — the observer row, not the observed teacher's). The downstream tap/media
      // routing is observer-aware (bd-9hzdn.2/.3), and analysis queues after the LP
      // step exactly like the teacher flow. Flag OFF → legacy direct-to-analysis.
      // Observe-ness derives from the session ROW — never the queue payload.
      if (session.observation_type === 'leader_observation') {
        await TranscriptionProcessorService.observePostTranscription(coachingSessionId, session, from);
        if (fs.existsSync(tempAudioPath)) {
          fs.unlinkSync(tempAudioPath);
        }
        return;
      }

      // DC row 129: nothing is sent here.
      //
      // This slot held an acknowledgement — first a GPT-4o "encouraging message"
      // that invented a verdict on a lesson nothing had read (bd-di5ap), then a
      // fixed catalog line in its place. Row 129 asked for the stretch between
      // Step 1/5 and the photo prompt to carry no extra messages at all, so the
      // slot is empty and the photo prompt below follows transcription directly.
      //
      // Step 1/5 now states the real wait ("up to 15 minutes") rather than
      // "30-60 seconds", which is what made this silence feel like a fault.
      // Anything re-added here must come from coaching-messages.js with an `ur`
      // variant — an English literal at this send site is refused by the
      // no-hardcoded-coaching-strings ratchet, and a model call is the shape
      // that caused row 129 in the first place.

      // Phase 3: Agency follow-up — remind teacher of prior commitment
      try {
        const { data: priorSessions } = await supabase
          .from('coaching_sessions')
          .select('prioritized_action')
          .eq('user_id', session.user_id)
          .not('prioritized_action', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);

        const priorAction = priorSessions?.[0]?.prioritized_action;
        if (priorAction?.teacher_response === 'yes' && priorAction?.action) {
          // Substitute {{action}} into the catalog template — keeps the
          // string translatable 1:1 (translators see {{action}}, not ${}).
          const reminderLang = await getUserLanguage(session.user_id) || 'en';
          const reminder = getCoachingMessage('priorActionReminder', reminderLang)
            .replace('{{action}}', priorAction.action);
          await WhatsAppService.sendMessage(from, reminder);
        }
      } catch (agencyError) {
        logToFile('⚠️ Agency follow-up check failed (non-critical)', { error: agencyError.message });
      }

      // Phase 3: Ask about classroom photo FIRST, before LP question
      const { buildPhotoPrompt } = require('./classroom-photo/photo-prompt.service');
      const userLanguage = await getUserLanguage(session.user_id) || 'en';
      const photoPrompt = buildPhotoPrompt(coachingSessionId, userLanguage);
      await WhatsAppService.sendInteractiveButtons(from, photoPrompt);

      // Update conversation state to AWAITING_PHOTO
      await CoachingSessionService.updateConversationState(coachingSessionId, {
        current_state: 'AWAITING_PHOTO'
      });

      await CoachingSessionService.updateStatus(coachingSessionId, 'awaiting_photo');

      // Clean up temp file
      if (fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }

      logToFile('✅ Transcription processing complete', { coachingSessionId });
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }

      await this.handleTranscriptionError(coachingSessionId, error, payload.from);
      throw error;
    }
  }

  /**
   * Transcribe audio with speaker diarization
   * Returns real tokens from Soniox for enhanced transcript processing
   *
   * @param {string} audioPath - Path to audio file
   * @returns {Promise<object>} Transcription result with diarization and tokens
   *   - transcript: Formatted text with speaker labels
   *   - language: Detected language code
   *   - diarization: Speaker segments built from tokens
   *   - tokens: Raw token array from Soniox (for enhanced viewer)
   *   - silences: Detected silence markers (gaps > 3s)
   *   - cost: Estimated transcription cost
   */
  /**
   * bd-9hzdn.1 (observe parity) — what happens after an /observe transcription.
   *
   * Flag OFF (legacy): queue analysis directly — the original behaviour.
   * Flag ON (OBSERVE_CAPTURE_GATES_ENABLED='true'): the COACH gets the same
   * photo → LP gates the teacher flow has. The prompt goes to the coach's phone
   * (`from` is the coach in the observe path) in the COACH's language (the
   * observer row, not the observed teacher's). Teacher-praise interstitials
   * stay skipped either way. Downstream tap/media routing is observer-aware
   * (bd-9hzdn.2/.3) and queues analysis after the LP step.
   *
   * @param {object} deps injectable for tests: { queueAnalysis, sendButtons,
   *   buildPhotoPrompt, getLanguage, updateConversationState, updateStatus, env }
   */
  static async observePostTranscription(coachingSessionId, session, from, deps = {}) {
    const env = deps.env || process.env;
    const gatesOn = env.OBSERVE_CAPTURE_GATES_ENABLED === 'true';

    if (!gatesOn) {
      const queueAnalysis = deps.queueAnalysis
        || ((sid, payload) => require('./coaching-job-queue.service').queueAnalysis(sid, payload));
      await queueAnalysis(coachingSessionId, { from });
      logToFile('✅ Transcription complete (observe path — analysis queued directly)', { coachingSessionId });
      return { action: 'queued_analysis' };
    }

    const getLanguage = deps.getLanguage || getUserLanguage;
    const buildPrompt = deps.buildPhotoPrompt
      || require('./classroom-photo/photo-prompt.service').buildPhotoPrompt;
    const sendButtons = deps.sendButtons
      || ((to, prompt) => WhatsAppService.sendInteractiveButtons(to, prompt));
    const updateConversationState = deps.updateConversationState
      || ((sid, cs) => CoachingSessionService.updateConversationState(sid, cs));
    const updateStatus = deps.updateStatus
      || ((sid, st) => CoachingSessionService.updateStatus(sid, st));

    // Coach-addressed photo gate. Language = the OBSERVER's preference, falling
    // back to the session owner's (unbound observation: observer IS the owner).
    const coachLangUserId = session.observer_user_id || session.user_id;
    const observerLanguage = (await getLanguage(coachLangUserId)) || 'en';
    await sendButtons(from, buildPrompt(coachingSessionId, observerLanguage));
    await updateConversationState(coachingSessionId, { current_state: 'AWAITING_PHOTO' });
    await updateStatus(coachingSessionId, 'awaiting_photo');
    logToFile('✅ Transcription complete (observe path — coach photo gate sent)', { coachingSessionId, observerLanguage });
    return { action: 'photo_gate', observerLanguage };
  }

  /**
   * @param {string} audioPath
   * @param {{roles?: object}} [opts] bd-ri5o9.2 — the speaker vocabulary.
   *   OMITTED means CLASSROOM (Teacher/Student), so the lesson path is unchanged.
   *   The debrief caller passes DEBRIEF_ROLES because a debrief is two adults —
   *   coach and teacher — and labelling one of them "Student" made every
   *   downstream pass misattribute who said what.
   */
  static async transcribeWithDiarization(audioPath, opts = {}) {
    const roles = (opts && opts.roles) || null;
    // Enable diarization for classroom audio transcription
    const transcriptionResult = await AudioService.transcribe(audioPath, true, null, roles);
    // bd-2kxxa.5: the token→diarization/silence assembly lives in
    // diarization-from-tokens.js so the Section B backfill writes the identical
    // shape without loading this module (and its WhatsApp import).
    return assembleDiarizedTranscription(transcriptionResult, roles);
  }

  /**
   * Send progress update to user
   * @param {string} phoneNumber - User's phone number
   * @param {number} step - Current step (1-5)
   * @returns {Promise<void>}
   */
  static async sendProgressUpdate(phoneNumber, step, languageCode = offerDefaultLanguage()) {
    try {
      await WhatsAppService.sendMessage(phoneNumber, getCoachingMessage('step1_transcribing', languageCode));

      // Send listening animation if available
      if (LISTENING_ANIMATION_MEDIA_ID) {
        await WhatsAppService.sendSticker(phoneNumber, LISTENING_ANIMATION_MEDIA_ID);
      }
    } catch (error) {
      logToFile('⚠️  Failed to send progress update (non-critical)', {
        error: error.message,
        phoneNumber
      });
    }
  }

  /**
   * Handle transcription error
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {Error} error - Error object
   * @param {string} phoneNumber - User's phone number (optional)
   * @returns {Promise<void>}
   */
  static async handleTranscriptionError(coachingSessionId, error, phoneNumber) {
    try {
      logToFile('❌ Error in processTranscription', {
        error: error.message,
        stack: error.stack,
        coachingSessionId
      });

      // Get user phone number if not provided
      let from = phoneNumber;
      if (!from) {
        try {
          const { data: session } = await supabase
            .from('coaching_sessions')
            .select('users!inner(name, phone_number)')
            .eq('id', coachingSessionId)
            .single();
          from = session?.users?.phone_number;
        } catch (e) {
          logToFile('⚠️  Could not get user phone for error notification', { error: e.message });
        }
      }

      // Update session with error
      await CoachingSessionService.markAsFailed(coachingSessionId, 'transcription', error.message);

      // Notify user with specific error message (bilingual)
      if (from) {
        let errorMessage;

        // Check if it's a timeout error
        if (error.message.includes('timeout') || error.message.includes('took too long')) {
          errorMessage = "معذرت، آڈیو کو ٹرانسکرائب کرنے میں بہت زیادہ وقت لگ رہا ہے۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔\n\nSorry, the audio transcription is taking longer than expected. This might be due to high server load. Please try again in a few minutes.";
        } else if (error.message.includes('network') || error.message.includes('connection')) {
          errorMessage = "معذرت، نیٹ ورک کی خرابی کی وجہ سے ٹرانسکرپشن ناکام ہو گیا۔ براہ کرم دوبارہ کوشش کریں۔\n\nSorry, transcription failed due to a network issue. Please try again.";
        } else {
          // Generic error
          errorMessage = "معذرت، آپ کی کلاس کی آڈیو کو ٹرانسکرائب کرتے وقت خرابی آ گئی۔ براہ کرم دوبارہ کوشش کریں۔\n\nSorry, there was an error transcribing your classroom audio. Please try again.";
        }

        await WhatsAppService.sendMessage(from, errorMessage);
      }
    } catch (handlerError) {
      logToFile('❌ Error in handleTranscriptionError', {
        error: handlerError.message,
        coachingSessionId
      });
    }
  }

  /**
   * Build diarization data from Soniox tokens (delegates to diarization-from-tokens.js).
   * @param {Array} tokens - Array of token objects from Soniox
   * @returns {Object} { segments, speakers, totalSegments, confidence }
   */
  static _buildDiarizationFromTokens(tokens) {
    return buildDiarizationFromTokens(tokens);
  }

  /**
   * Detect silence gaps in token stream (delegates to diarization-from-tokens.js).
   * @param {Array} tokens - Array of token objects from Soniox
   * @param {number} minGapMs - Minimum gap to consider as silence (default: 3000ms)
   * @returns {Array} Array of silence markers { start_ms, end_ms, duration_ms }
   */
  static detectSilences(tokens, minGapMs = 3000) {
    return detectSilences(tokens, minGapMs);
  }
}

module.exports = TranscriptionProcessorService;
