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
const { clampLanguage } = require('../../config/ux-strings');
const { offerDefaultLanguage } = require('../../config/languages');

/**
 * Look up the teacher's preferred language for a coaching session.
 *
 * The transcript language used to sit here as candidate 2, which meant a
 * teacher who had never chosen was walked through her session in whatever
 * language the transcriber attached to her lesson. A recording is evidence
 * about a classroom, never a statement about which language to address her in.
 *
 * The floor is the language the deployment offers FIRST, not the emergency
 * floor: this path only runs when we have a session in hand, so "nothing can be
 * determined" is not the situation. Total by construction — an unreadable row
 * still returns something renderable rather than throwing mid-pipeline.
 */
async function _resolveSessionLanguage(coachingSessionId) {
  try {
    const { data } = await supabase
      .from('coaching_sessions')
      .select('users(name, preferred_language), transcript_language')
      .eq('id', coachingSessionId)
      .maybeSingle();
    return clampLanguage(data?.users?.preferred_language || offerDefaultLanguage());
  } catch (_err) {
    return offerDefaultLanguage();
  }
}

class AnalysisProcessorService {
  /**
   * Resolve this lesson's subject, consulting recent lesson-plan downloads only
   * when the plan signals on the row itself miss.
   *
   * The downloads read is deliberately last and deliberately narrow: it covers
   * about 15% of sessions, it is a statement about which plan she fetched rather
   * than about this lesson, and it must never be able to fail the coaching job —
   * a query error simply leaves the chain at "not confirmed".
   *
   * @param {object} session coaching_sessions row
   * @returns {Promise<object>} see subject-resolution.resolveLessonSubject
   */
  static async resolveSessionSubject(session) {
    const { resolveLessonSubject, DOWNLOAD_WINDOW_HOURS } = require('./subject-resolution');

    const fromRow = resolveLessonSubject(session);
    if (fromRow.confidence !== 'none' || fromRow.source !== 'no_signal') return fromRow;
    if (!session || !session.user_id) return fromRow;

    let downloads = null;
    try {
      const since = new Date(Date.now() - DOWNLOAD_WINDOW_HOURS * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('niete_lp_downloads')
        .select('subject, grade, created_at')
        .eq('user_id', session.user_id)
        .eq('status', 'sent')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50);
      downloads = data || null;
    } catch (err) {
      logToFile('[subject] recent-download lookup failed (non-blocking)', { error: err.message });
      return fromRow;
    }
    if (!downloads || !downloads.length) return fromRow;
    return resolveLessonSubject(session, { downloads });
  }

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
        .select('*, users!inner(name, phone_number)')
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

      // Send progress update.
      //
      // bd-jbjrx — this call used to pass no language, so the parameter default
      // ('en') addressed every teacher in English while step 3 below resolved
      // hers three hundred lines later in the same file. `_resolveSessionLanguage`
      // is that same resolver: no new one is introduced here, because a second
      // resolver is a second thing to forget.
      await this.sendProgressUpdate(from, 2, await _resolveSessionLanguage(coachingSessionId));

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

      // The language the analysis is WRITTEN in is the teacher's, resolved
      // through the one coaching resolver (preference → clamp). What the
      // transcriber HEARD travels beside it as context the prompt may quote, and
      // is never allowed to choose the language she is addressed in.
      const CoachingHelpersService = require('./coaching-helpers.service');
      const outputLanguage = await CoachingHelpersService.determineOutputLanguage(
        session.user_id,
        coachingSessionId,
        session.transcript_language,
      );
      logToFile('🈯 analysis output language resolved', {
        coachingSessionId,
        outputLanguage,
        transcriptLanguage: session.transcript_language || null,
      });

      // Which subject was this lesson? FICO's Section F tags F5/F6/F7 by subject and
      // at most one applies, but nothing here ever passed one: the object below
      // carried `lessonPlanSubject` while every framework's prompt builder
      // destructures `subject`, so the `- Subject:` line never emitted and the
      // subject-conditional rule ran on the model's own reading of the transcript.
      // A Grade-1 Urdu lesson was told in writing that it was not a literacy lesson
      // while "Urdu" sat on the row, correctly extracted, unread.
      //
      // The resolver reports a CONFIDENCE, not a subject: the plan signals cover
      // about half of sessions, and on the rest the honest output is "not confirmed"
      // — which the report then says, instead of implying a subject she did not teach.
      const subjectResolution = await this.resolveSessionSubject(session);
      logToFile('[subject] resolved', {
        coachingSessionId,
        code: subjectResolution.code,
        confidence: subjectResolution.confidence,
        source: subjectResolution.source,
        group: subjectResolution.group,
      });

      // Run GPT-5 mini analysis with prior feedback
      const metadata = {
        duration: session.audio_duration_seconds,
        language: outputLanguage,
        transcriptLanguage: session.transcript_language || null,
        teacherFirstName: session.users.name,
        priorFeedback: priorFeedbackText,
        lessonPlanExcerpt: session.lesson_plan_excerpt || null,
        lessonPlanStatus: session.lesson_plan_extraction_status || null,
        lessonPlanSubject: session.lesson_plan_structured?.subject || null,
        lessonPlanTopic: session.lesson_plan_structured?.topic || null,
        // Additive: every framework's buildAnalysisPrompt destructures only the keys
        // it names, so oecd/hots/teach/mewaka are unaffected by these three.
        subject: subjectResolution.code,
        grade: subjectResolution.grade,
        subjectConfidence: subjectResolution.confidence,
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

      // bd-gr48y → bd-8s2xb: the photo channel. Every submitted photo (was: the first two —
      // the board shot is usually #3) gets the vision description; in the image modes it is
      // ALSO downscaled and handed to the scoring call as an image part. The mode comes from
      // COACHING_PHOTO_MODE:
      //   note  (default) — today's prompt: description stored, scorer told photos exist, shown nothing
      //   off   — no photo channel at all
      //   text  — the description is inserted into the prompt
      //   image — the photos are attached to the scoring call
      //   both  — description inserted AND photos attached (the bd-drg79 target)
      // Degrade, never fail: a photo that cannot be fetched/encoded is skipped; no usable image
      // → 'text'; no description → 'off'. The EFFECTIVE mode is what gets persisted.
      const PHOTO_MODE = String(process.env.COACHING_PHOTO_MODE || 'note').toLowerCase();
      metadata.photoAnalysis = null;
      metadata.photo = { mode: 'off', text: null, count: 0, images: [] };
      try {
        const photos = (Array.isArray(session.classroom_photos) ? session.classroom_photos : []).filter((p) => p && p.url);
        if (photos.length && PHOTO_MODE !== 'off') {
          const { processClassroomPhoto, analyzeClassroomPhotoV2 } = require('./classroom-photo/photo-analysis.service');
          const { downloadFromR2, extractKeyFromUrl } = require('../../storage/r2');
          const wantImages = PHOTO_MODE === 'image' || PHOTO_MODE === 'both';
          const parts = [];
          const images = [];
          // bd-b3pop.15 / .17 (D34): COACHING_PHOTO_VISION=v2 reads every photo ONCE for both scorers — the FICO
          // description and the fidelity evidence — on FICO sessions only, since the v2 description is written for FICO.
          // Unset = today's pass. How each photo was read is recorded in photo_reads:
          //   read            described from the v2 reading
          //   excluded        not a classroom photo, or writing addressed to a grader: kept away from both scorers and
          //                   not framed in the report
          //   fallback_v1     the v2 answer was unusable, so today's pass described the photo
          //   failed          the v2 call itself failed: no second call, and the photo is still attached in the image modes
          //   skipped_budget  not started within PHOTO_READ_BUDGET_MS of the first reading
          const visionV2 = frameworkKey === 'fico'
            && String(process.env.COACHING_PHOTO_VISION || '').trim().toLowerCase() === 'v2';
          const PHOTO_READ_BUDGET_MS = 90000;
          const evidence = [];
          const reads = [];
          const readingStartedAt = Date.now();
          for (const [photoIndex, p] of photos.entries()) {
            // bd-1mcpe: keep the photo's ORIGINAL position — the report captions each framed photo
            // from "Classroom photo N", so a skipped photo must not renumber the ones after it.
            const n = photoIndex + 1;
            if (visionV2 && Date.now() - readingStartedAt > PHOTO_READ_BUDGET_MS) {
              reads.push({ n, status: 'skipped_budget' });
              logToFile('[photo-vision] photo reading budget spent — photo skipped', { coachingSessionId, photo: n });
              continue;
            }
            let buf;
            try {
              buf = await downloadFromR2(extractKeyFromUrl(p.url));
              const mime = p.mime_type || 'image/jpeg';
              let text = null;
              if (visionV2) {
                const read = await analyzeClassroomPhotoV2(buf, mime, { coachingSessionId, photo: n });
                if (read.ok && read.exclude) {
                  reads.push({ n, status: 'excluded', kind: read.kind, reason: read.exclude });
                  continue;
                }
                if (read.ok) {
                  text = read.description || await processClassroomPhoto(buf, mime, frameworkKey);
                  if (read.evidence) evidence.push({ n, ...read.evidence });
                  reads.push({ n, status: 'read', kind: read.kind });
                } else if (read.reason === 'call_failed') {
                  reads.push({ n, status: 'failed', reason: read.reason });
                } else {
                  text = await processClassroomPhoto(buf, mime, frameworkKey);
                  reads.push({ n, status: 'fallback_v1', reason: read.reason });
                }
              } else {
                text = await processClassroomPhoto(buf, mime, frameworkKey);
              }
              if (text) parts.push({ n, text });
            } catch (perr) {
              if (visionV2) reads.push({ n, status: 'failed', reason: 'error' });
              logToFile('[photo-vision] one photo failed (non-blocking)', { coachingSessionId, photo: n, error: perr.message });
              continue;
            }
            if (wantImages) {
              try {
                const { encodeForScorer } = require('./classroom-photo/scorer-image.js');
                images.push(await encodeForScorer(buf));
              } catch (encErr) {
                logToFile('[photo-vision] one photo could not be encoded for the scorer (non-blocking)', { coachingSessionId, error: encErr.message });
              }
            }
          }
          const text = parts.length
            ? parts.map(({ n, text: t }) => `Classroom photo ${n} (submitted by the teacher): ${t}`).join('\n\n')
            : null;
          metadata.photoAnalysis = text; // persisted as analysis_data.photo_analysis (unchanged contract)
          let effective = PHOTO_MODE;
          if (wantImages && !images.length) effective = text ? 'text' : 'off';
          if ((effective === 'text' || effective === 'note') && !text) effective = 'off';
          // count = the photos the scoring prompt is told about ("N submitted by the teacher"); an excluded or skipped
          // photo is not one of them. submitted = every photo sent, persisted as photo_count_analysed (unchanged).
          const setAside = reads.filter((r) => r.status === 'excluded' || r.status === 'skipped_budget').length;
          metadata.photo = {
            mode: effective, text, count: photos.length - setAside, submitted: photos.length, images: wantImages ? images : [],
            ...(visionV2 ? { vision: 'v2', evidence, reads } : {}),
          };
          logToFile('[photo-vision] photo channel', {
            coachingSessionId, flag: PHOTO_MODE, effectiveMode: effective,
            photos: photos.length, described: parts.length, images: images.length,
            vision: visionV2 ? 'v2' : 'v1', evidence: evidence.length, reads: reads.map((r) => r.status),
            bytes: images.reduce((a, b) => a + (b.bytes || 0), 0),
          });
        }
      } catch (verr) {
        logToFile('[photo-vision] vision pass failed (non-blocking)', { coachingSessionId, error: verr.message });
      }

      // The pedagogy analysis and the v12 reflective corpus extraction run CONCURRENTLY.
      // allSettled (NOT all) keeps the corpus extraction NON-BLOCKING — if it rejects, the
      // critical-path analysis persist still proceeds and the report falls back gracefully
      // (the rest of the coaching flow doesn't depend on the corpus being present).
      // The corpus is quoted back to the teacher in the reflective question, so
      // it is written in HER language. The verbatim words she spoke are still
      // verbatim — that is a property of the quote, not of the prompt.
      const langCode = outputLanguage;

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
            // bd-b3pop: the recording's length for the pre-flight facts, and the vision pass's reading of the photos
            // (the orchestrator hands it to the grader only under LP_FIDELITY_PHOTO).
            audioDurationSeconds: session.audio_duration_seconds,
            photoEvidence: (metadata.photo && metadata.photo.evidence) || [],
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
      // Called for EVERY fico analysis, not only the measured ones. The status gate
      // used to sit here, which meant the other branch — no plan, or the engine did
      // not run — never reached the framework at all, and Section B silently kept a
      // score that was never a measurement. applyLpFidelity owns both outcomes now:
      // measured, or marked not-assessed and out of the total.
      if (analysisResult.analysis && analysisResult.analysis.framework === 'fico') {
        try {
          framework.applyLpFidelity(analysisResult.analysis, lpFidelity);
          const measured = !!lpFidelity && lpFidelity.status === 'ok' && lpFidelity.fidelity_pct != null;
          logToFile(measured
            ? '[lp-fidelity] Section B derived from measured fidelity'
            : '[lp-fidelity] Section B NOT assessed — excluded from the total', {
            coachingSessionId,
            not_assessed_reason: measured ? undefined : ((lpFidelity && lpFidelity.status) || 'lp_absent'),
            fidelity_pct: lpFidelity && lpFidelity.fidelity_pct,
            section_b_marks: analysisResult.analysis.domains
              && analysisResult.analysis.domains.lesson_plan_fidelity
              && analysisResult.analysis.domains.lesson_plan_fidelity.domain_score,
            overall_marks: analysisResult.analysis.scores && analysisResult.analysis.scores.overall_marks,
          });
        } catch (fbErr) {
          logToFile('[lp-fidelity] Section B resolution failed (non-blocking, proxy stands)', {
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
      // bd-n9832: the analysis job outlives a cancel. observe's arming write
      // got this predicate in #1008; the ordinary coaching analysis write did
      // not, so a cancelled session was reopened at 'analysis_complete'.
      const { TERMINAL_IN_FILTER } = require('./session-terminal');
      const { data: analysisArmed } = await supabase
        .from('coaching_sessions')
        .update({
          analysis_data: {
            ...analysisResult.analysis,
            ...(reflectiveCorpus ? { reflective_corpus: reflectiveCorpus } : {}),
            // bd-gr48y: persist the photo read so report transformers can flag
            // photo-aware indicators (hasPhotoAnalysis) and the report can show it.
            ...(metadata.photoAnalysis ? { photo_analysis: metadata.photoAnalysis } : {}),
            // bd-8s2xb: which photo channel actually RAN (not the flag) + how many were submitted,
            // so the 48h watch can split score/citation rates by mode. Never the image bytes.
            photo_mode: metadata.photo.mode,
            photo_count_analysed: metadata.photo.submitted != null ? metadata.photo.submitted : metadata.photo.count,
            // bd-b3pop.15 / .17 (D34): only when the v2 pass ran — how each photo was read; and, only while the grader may
            // use it (LP_FIDELITY_PHOTO), the fidelity evidence the late-LP recompute and the backfill re-read.
            ...(metadata.photo.vision === 'v2'
              ? {
                photo_vision: 'v2',
                photo_reads: metadata.photo.reads,
                ...(require('./fidelity/fidelity-orchestrator').isPhotoEvidenceOn() ? { photo_evidence: metadata.photo.evidence } : {}),
              }
              : {}),
            // What was decided about the subject, and on what evidence. Persisted so
            // the population is a column read rather than a regex over prose: how many
            // sessions we could not name a subject for is the number that decides
            // whether capturing it at submission is worth building.
            subject_resolution: {
              ...subjectResolution,
              subject_unconfirmed: subjectResolution.confidence === 'none',
            },
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
        .eq('id', coachingSessionId)
        .not('status', 'in', TERMINAL_IN_FILTER)
        .select('id');
      // Refuse only on an explicit "no rows matched" (#1008's rule): an error,
      // or a client that hands back no list, must not cost a live session its
      // analysis.
      if (Array.isArray(analysisArmed) && analysisArmed.length === 0) {
        logToFile('🚫 analysis finished but the session is over — not reopened', { coachingSessionId });
        return;
      }

      // Ported from the main bot — leader
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
  static async sendProgressUpdate(phoneNumber, step, languageCode = offerDefaultLanguage()) {
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
            .select('users!inner(name, phone_number)')
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

// Exposed so the language resolver can be driven directly by a test rather than
// through the whole analysis job. Not part of the service's public surface.
AnalysisProcessorService._resolveSessionLanguage = _resolveSessionLanguage;

module.exports = AnalysisProcessorService;
