/**
 * Analysis Processor Service
 * Handles pedagogical analysis of classroom observations
 *
 * Responsibilities:
 * - Orchestrate GPT-5 mini analysis
 * - Send progress updates with animations
 * - Store analysis results
 * - Handle analysis errors with notifications
 * - Trigger reflective conversation
 *
 * Extracted from coaching.service.js as part of Phase 3 refactoring
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const GPT5MiniService = require('../gpt5-mini.service');
const WhatsAppService = require('../whatsapp.service');
const CoachingSessionService = require('./coaching-session.service');
const { PEDAGOGICAL_ANALYSIS_MEDIA_ID } = require('../../utils/constants');
const { selectFrameworkWithReason } = require('./frameworks/framework-selector');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { isUptakeLoopEnabled } = require('../../config/uptake-loop-flags');

/**
 * Look up the teacher's preferred language for a coaching session.
 * Falls back to 'en' if the session/user can't be read — we'd rather
 * ship the English message than throw mid-pipeline.
 */
async function _resolveSessionLanguage(coachingSessionId) {
  try {
    const { data } = await supabase
      .from('coaching_sessions')
      .select('users(preferred_language), transcript_language')
      .eq('id', coachingSessionId)
      .maybeSingle();
    return data?.users?.preferred_language || data?.transcript_language || 'en';
  } catch (_err) {
    return 'en';
  }
}

class AnalysisProcessorService {
  /**
   * Process analysis job (called by background worker)
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {object} payload - Job payload
   * @returns {Promise<void>}
   */
  static async processAnalysis(coachingSessionId, payload) {
    try {
      logToFile('🔄 Starting pedagogical analysis', { coachingSessionId });

      // Get session data
      const { data: session, error: sessionError } = await supabase
        .from('coaching_sessions')
        .select('*, users!inner(phone_number, first_name, last_name)')
        .eq('id', coachingSessionId)
        .single();

      if (sessionError || !session) {
        logToFile('❌ Session query error', { sessionError, coachingSessionId });
        throw new Error('Coaching session not found');
      }

      const from = payload.from || session.users.phone_number;

      // Update status
      await CoachingSessionService.updateStatus(coachingSessionId, 'analyzing', {
        analysis_started_at: new Date().toISOString()
      });

      // Send progress update
      await this.sendProgressUpdate(from, 2);

      // Fetch and compress prior feedback
      const ReportGeneratorService = require('./report-generator.service');
      const priorFeedbackData = await ReportGeneratorService.fetchAndCompressPriorFeedback(
        session.user_id,
        coachingSessionId
      );

      // Format prior feedback for prompt
      let priorFeedbackText = null;
      if (priorFeedbackData.exists) {
        if (priorFeedbackData.compressed) {
          // 4+ sessions: use compressed summary
          priorFeedbackText = priorFeedbackData.summary;
        } else {
          // 1-3 sessions: format verbatim sessions with dates
          priorFeedbackText = priorFeedbackData.summary.map(s => {
            const growthAreasText = s.growth_areas.map(ga => ga.area || ga.observation || 'N/A').join(', ');
            const recommendationsText = s.recommendations.join(', ');
            return `Observation ${s.date}:\nGrowth Areas: ${growthAreasText}\nRecommendations: ${recommendationsText}`;
          }).join('\n\n');
        }

        logToFile('Prior feedback fetched and formatted', {
          sessionCount: priorFeedbackData.sessionCount,
          compressed: priorFeedbackData.compressed,
          feedbackLength: priorFeedbackText?.length || 0
        });
      }

      // Run GPT-5 mini analysis with prior feedback
      const metadata = {
        duration: session.audio_duration_seconds,
        language: session.transcript_language,
        teacherFirstName: session.users.first_name,
        priorFeedback: priorFeedbackText,
        lessonPlanExcerpt: session.lesson_plan_excerpt || null,
        lessonPlanStatus: session.lesson_plan_extraction_status || null,
        lessonPlanSubject: session.lesson_plan_structured?.subject || null,
        lessonPlanTopic: session.lesson_plan_structured?.topic || null
      };

      // Feedback-uptake loop (flag-gated): the teacher's prior action record
      // rides into the scoring prompt so the model tallies uptake of the ONE
      // thing she was asked to try — inside this same call, no extra LLM call.
      // The lookup never throws; null means "no prior" and the prompt is
      // byte-identical to the flag-off prompt.
      metadata.priorAction = null;
      if (isUptakeLoopEnabled()) {
        const { loadPriorAction } = require('./coaching-trend.service');
        metadata.priorAction = await loadPriorAction(session.user_id, { excludeSessionId: coachingSessionId });
      }

      logToFile('Analysis metadata', metadata);

      // Resolve pedagogical framework for this user, capturing the selection
      // path so it can be persisted for later audit / dashboards.
      const {
        framework,
        frameworkKey,
        reason: frameworkSelectionReason,
      } = await selectFrameworkWithReason(session.user_id);
      logToFile('Framework resolved', {
        userId: session.user_id,
        framework: framework.name,
        frameworkKey,
        reason: frameworkSelectionReason,
      });

      // bd-gr48y: run the vision pass on the teacher's classroom photos and feed the
      // result INTO the analysis prompt, labelled so the model treats it as photo-sourced.
      // Score stays audio-primary (the framework's photoNote frames it as supplementary
      // context); a vision failure is non-blocking and never sinks the audio analysis.
      metadata.photoAnalysis = null;
      try {
        const photos = Array.isArray(session.classroom_photos) ? session.classroom_photos.slice(0, 2) : [];
        if (photos.length) {
          const { processClassroomPhoto } = require('./classroom-photo/photo-analysis.service');
          const { downloadFromR2, extractKeyFromUrl } = require('../../storage/r2');
          const parts = [];
          for (const p of photos) {
            if (!p || !p.url) continue;
            try {
              const buf = await downloadFromR2(extractKeyFromUrl(p.url));
              const text = await processClassroomPhoto(buf, p.mime_type || 'image/jpeg', frameworkKey);
              if (text) parts.push(text);
            } catch (perr) {
              logToFile('[photo-vision] one photo failed (non-blocking)', { coachingSessionId, error: perr.message });
            }
          }
          if (parts.length) {
            metadata.photoAnalysis = parts
              .map((t, i) => `Classroom photo ${i + 1} (submitted by the teacher): ${t}`)
              .join('\n\n');
            logToFile('[photo-vision] photo analysis attached to prompt', { coachingSessionId, photos: parts.length });
          }
        }
      } catch (verr) {
        logToFile('[photo-vision] vision pass failed (non-blocking)', { coachingSessionId, error: verr.message });
      }

      // The pedagogy analysis and the v12 reflective corpus extraction run CONCURRENTLY.
      // allSettled (NOT all) keeps the corpus extraction NON-BLOCKING — if it rejects, the
      // critical-path analysis persist still proceeds and the report falls back gracefully
      // (the rest of the coaching flow doesn't depend on the corpus being present).
      const langCode = session.transcript_language || metadata.language || 'en';

      // LP fidelity (FICO Section B) — a SEPARATE gpt-5.6-luna call sharing the transcript, run in the
      // same allSettled so it is NON-BLOCKING (a fidelity failure never fails the coaching job). Flag-gated
      // OFF by default (LP_FIDELITY_ENABLED); computeLpFidelity is itself internally non-throwing. The
      // corpus move-list is resolved from the LP version the teacher downloaded (stashed by the linker as
      // lesson_plan_structured._fidelity_ref) or extracted from her uploaded LP text.
      const { isFidelityEnabled, computeLpFidelity, resolveFidelitySources } = require('./fidelity/fidelity-orchestrator');
      const { corpusKey, uploadedText, meta: fidelityMeta } = resolveFidelitySources(session);
      const fidelityTask = isFidelityEnabled()
        ? computeLpFidelity({
            corpusKey,
            uploadedText,
            transcript: session.transcript_text,
            meta: fidelityMeta,
          })
        : Promise.resolve(null);

      const [analysisSettled, corpusSettled, fidelitySettled] = await Promise.allSettled([
        GPT5MiniService.analyzePedagogy(
          session.transcript_text,
          metadata,
          session.lesson_plan_structured || null,
          framework,
        ),
        GPT5MiniService.extractReflectiveCorpus(session.transcript_text, langCode),
        fidelityTask,
      ]);
      if (analysisSettled.status === 'rejected') throw analysisSettled.reason;
      const analysisResult = analysisSettled.value;
      const lpFidelity = fidelitySettled.status === 'fulfilled' ? fidelitySettled.value : null;
      if (fidelitySettled.status === 'rejected') {
        logToFile('[lp-fidelity] failed (non-blocking)', {
          coachingSessionId,
          error: fidelitySettled.reason && fidelitySettled.reason.message,
        });
      } else if (lpFidelity && lpFidelity.status) {
        logToFile('[lp-fidelity] computed', { coachingSessionId, status: lpFidelity.status, source: lpFidelity.source, pct: lpFidelity.fidelity_pct });
      }

      // P4.1 (bd-wmfsp.9, D27) — when the FICO framework is active and the fidelity engine
      // produced a USABLE score, Section B (Lesson Plan Fidelity) is DERIVED from the measured
      // executed÷prescribed fidelity (→/40) instead of the 10 legacy B indicators, and the overall
      // is recomputed. Applied here (post-settle, pre-persist) so a fidelity failure leaves the
      // legacy proxy intact. applyLpFidelity self-guards on status/pct and is a no-op otherwise.
      if (analysisResult.analysis && analysisResult.analysis.framework === 'fico'
          && lpFidelity && lpFidelity.status === 'ok') {
        try {
          framework.applyLpFidelity(analysisResult.analysis, lpFidelity);
          logToFile('[lp-fidelity] Section B derived from measured fidelity', {
            coachingSessionId,
            fidelity_pct: lpFidelity.fidelity_pct,
            section_b_marks: analysisResult.analysis.domains
              && analysisResult.analysis.domains.lesson_plan_fidelity
              && analysisResult.analysis.domains.lesson_plan_fidelity.domain_score,
            overall_marks: analysisResult.analysis.scores && analysisResult.analysis.scores.overall_marks,
          });
        } catch (fbErr) {
          logToFile('[lp-fidelity] Section B override failed (non-blocking, proxy stands)', {
            coachingSessionId, error: fbErr.message,
          });
        }
      }

      let reflectiveCorpus = null;
      if (corpusSettled.status === 'fulfilled' && corpusSettled.value) {
        reflectiveCorpus = corpusSettled.value.corpus;
        logToFile('[refl-q] corpus persisted to analysis_data', {
          coachingSessionId,
          model_used: corpusSettled.value.model_used,
        });
      } else if (corpusSettled.status === 'rejected') {
        logToFile('[refl-q] corpus extraction failed (non-blocking)', {
          coachingSessionId,
          error: corpusSettled.reason && corpusSettled.reason.message,
        });
      }

      logToFile('Analysis completed', {
        coachingSessionId,
        inputTokens: analysisResult.usage.input_tokens,
        outputTokens: analysisResult.usage.output_tokens,
        cachedTokens: analysisResult.usage.cached_tokens,
        cost: analysisResult.usage.cost,
        hasReflectiveCorpus: !!reflectiveCorpus,
      });

      // Update database — merge reflective_corpus into analysis_data when present.
      // Also persist the framework provenance (which key + why it was chosen)
      // so downstream analytics can audit selection paths without re-computing.
      await supabase
        .from('coaching_sessions')
        .update({
          analysis_data: {
            ...analysisResult.analysis,
            ...(reflectiveCorpus ? { reflective_corpus: reflectiveCorpus } : {}),
            // bd-gr48y: persist the photo read so report transformers can flag
            // photo-aware indicators (hasPhotoAnalysis) and the report can show it.
            ...(metadata.photoAnalysis ? { photo_analysis: metadata.photoAnalysis } : {}),
            // LP fidelity (FICO Section B) analysis blob — pct + band + per-move verdicts/evidence +
            // narrative + moderators. Only when the feature is on and a move-list resolved (D20).
            // bd-5knlj: non-ok statuses persist too — lp_absent vs
            // fidelity_unavailable vs never-ran were indistinguishable before.
            ...require('./fidelity/fidelity-orchestrator').fidelityPatch(lpFidelity),
          },
          status: 'analysis_complete',
          analysis_completed_at: new Date().toISOString(),
          analysis_cost: analysisResult.usage.cost,
          gpt5_input_tokens: analysisResult.usage.input_tokens,
          gpt5_output_tokens: analysisResult.usage.output_tokens,
          gpt5_cached_tokens: analysisResult.usage.cached_tokens,
          framework: frameworkKey,
          framework_selection_reason: frameworkSelectionReason,
        })
        .eq('id', coachingSessionId);

      // FEAT-102 bd-2138 (ported from main-bot FEAT-053 bd-16/bd-19) — leader
      // observations NEVER auto-flow to the reflective conversation or the teacher
      // report. Instead: freeze v1 (autofill_analysis_data) and send the observer
      // the editable pre-filled FICO Flow. The report renders later, from the
      // observer-edited v2, at send-to-teacher time. Row-derived, not payload-derived.
      if (session.observation_type === 'leader_observation') {
        const ObserveDraft = require('../observe/observe-draft.service');
        await ObserveDraft.onAnalysisReady(coachingSessionId, from);
        logToFile('✅ Analysis processing complete (observe path — draft flow sent)', { coachingSessionId });
        return;
      }

      // bd-1sddt: report-only recovery. When the analysis job is enqueued with
      // skipReflection (recovering a session stranded at the photo/LP gate — bd-flx1r),
      // generate the report DIRECTLY and do NOT start the reflective conversation. The
      // FICO report is derived from the classroom audio (+ the corpus extracted here), so
      // it is complete on the scoring side; the reflection is skipped by design. This is
      // NEVER set in the normal live flow — new observations leave skipReflection unset and
      // still get the reflective question below.
      if (payload.skipReflection) {
        const CoachingJobQueueService = require('./coaching-job-queue.service');
        await CoachingJobQueueService.queueReport(coachingSessionId, {
          from, partial: true, suppressPartialBanner: true,
        });
        logToFile('✅ Analysis complete — report queued, reflection skipped (bd-1sddt recovery)', { coachingSessionId });
        return;
      }

      // Send progress update - Step 3
      const lang3 = await _resolveSessionLanguage(coachingSessionId);
      await WhatsAppService.sendMessage(from, getCoachingMessage('step3_reflecting', lang3));

      // Brief pause before first question
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start reflective conversation
      const ReflectiveConversationService = require('./reflective-conversation.service');
      await ReflectiveConversationService.conductReflectiveConversation(coachingSessionId, from);

      logToFile('✅ Analysis processing complete', { coachingSessionId });
    } catch (error) {
      await this.handleAnalysisError(coachingSessionId, error, payload.from);
      throw error;
    }
  }

  /**
   * Send progress update to user
   * @param {string} phoneNumber - User's phone number
   * @param {number} step - Current step (1-5)
   * @returns {Promise<void>}
   */
  static async sendProgressUpdate(phoneNumber, step, languageCode = 'en') {
    try {
      // Step 2 catalog string carries the canonical "2/5" — we tolerate
      // callers passing other step numbers (e.g. legacy callers) and
      // substitute via simple string replacement to preserve message
      // localisation while still letting callers control the step counter.
      const base = getCoachingMessage('step2_analyzing', languageCode);
      const text = step === 2 ? base : base.replace('2/5', `${step}/5`);
      await WhatsAppService.sendMessage(phoneNumber, text);

      // Send pedagogical analysis animation if available
      if (PEDAGOGICAL_ANALYSIS_MEDIA_ID) {
        await WhatsAppService.sendSticker(phoneNumber, PEDAGOGICAL_ANALYSIS_MEDIA_ID);
      }
    } catch (error) {
      logToFile('⚠️  Failed to send progress update (non-critical)', {
        error: error.message,
        phoneNumber
      });
    }
  }

  /**
   * Handle analysis error
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {Error} error - Error object
   * @param {string} phoneNumber - User's phone number (optional)
   * @returns {Promise<void>}
   */
  static async handleAnalysisError(coachingSessionId, error, phoneNumber) {
    try {
      logToFile('❌ Error in processAnalysis', {
        error: error.message,
        stack: error.stack,
        coachingSessionId
      }, 'error');

      // Get user phone number if not provided
      let from = phoneNumber;
      if (!from) {
        try {
          const { data: session } = await supabase
            .from('coaching_sessions')
            .select('users!inner(phone_number)')
            .eq('id', coachingSessionId)
            .single();
          from = session?.users?.phone_number;
        } catch (e) {
          logToFile('⚠️  Could not get user phone for error notification', { error: e.message });
        }
      }

      // Update session with error
      await CoachingSessionService.markAsFailed(coachingSessionId, 'analysis', error.message);

      // Notify user (bilingual)
      if (from) {
        const errorMessage = "معذرت، آپ کی کلاس کا تجزیہ کرتے وقت خرابی آ گئی۔ براہ کرم دوبارہ کوشش کریں۔\n\nSorry, there was an error analyzing your classroom. Please try again.";
        await WhatsAppService.sendMessage(from, errorMessage);
      }
    } catch (handlerError) {
      logToFile('❌ Error in handleAnalysisError', {
        error: handlerError.message,
        coachingSessionId
      }, 'error');
    }
  }
}

module.exports = AnalysisProcessorService;
