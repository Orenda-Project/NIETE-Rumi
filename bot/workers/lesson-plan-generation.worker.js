/**
 * Lesson Plan Generation Worker
 * Processes lesson plan generation jobs from SQS queue
 *
 * Survives server restarts - job persists in SQS queue
 * Handles retries and sends apology message on max failures
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { logToFile } = require('../shared/utils/logger');
const supabase = require('../shared/config/supabase');
const ContentService = require('../shared/services/content.service');
const WhatsAppService = require('../shared/services/whatsapp.service');
const LessonPlanQueueService = require('../shared/services/lesson-plan-queue.service');
const FeatureLinkerService = require('../shared/services/feature-linker.service');
const FeatureRegistrationService = require('../shared/services/feature-registration.service');
const CurriculumLpAstService = require('../shared/services/curriculum-lp-ast.service');
const { renderAndServeGrounded } = require('../shared/services/grounded-lp-render.service');
const LpFeedbackService = require('../shared/services/lp-feedback.service');
const { storeLessonPlan } = require('../shared/database/bot-helpers');

// Temp directory for PDF downloads
const TEMP_DIR = process.env.TEMP_DIR || '/tmp';

// Max retries before sending apology
const MAX_RETRIES = 3;

/**
 * Bilingual messages for user communication
 */
const MESSAGES = {
  en: {
    successWithPdf: (topic) => `✅ Your lesson plan is ready!\n\nTopic: ${topic}\n\nThis five-step lesson plan is ready for use in your classroom.`,
    successWithoutPdf: (topic, gammaUrl) => `✅ Your lesson plan on "${topic}" is ready!\n\nView it here: ${gammaUrl}`,
    apology: "I'm sorry, there was a problem creating your lesson plan. Please try again by sending your request one more time.",
    error: "Sorry, there was an error creating the lesson plan. Please try again."
  },
  ur: {
    successWithPdf: (topic) => `✅ آپ کا لیسن پلان تیار ہے!\n\nموضوع: ${topic}\n\nیہ پانچ قدمی لیسن پلان آپ کی کلاس میں استعمال کے لیے تیار ہے۔`,
    successWithoutPdf: (topic, gammaUrl) => `✅ "${topic}" پر آپ کا لیسن پلان تیار ہے!\n\nیہاں دیکھیں: ${gammaUrl}`,
    apology: "معذرت، آپ کا لیسن پلان بنانے میں مسئلہ ہوا۔ براہ کرم اپنی درخواست دوبارہ بھیج کر کوشش کریں۔",
    error: "معذرت، لیسن پلان بنانے میں خرابی ہوئی۔ براہ کرم دوبارہ کوشش کریں۔"
  },
  ar: {
    successWithPdf: (topic) => `✅ خطة درسك جاهزة!\n\nالموضوع: ${topic}\n\nخطة الدرس هذه المكونة من خمس خطوات جاهزة للاستخدام في فصلك.`,
    successWithoutPdf: (topic, gammaUrl) => `✅ خطة درسك حول "${topic}" جاهزة!\n\nشاهدها هنا: ${gammaUrl}`,
    apology: "عذراً، حدثت مشكلة في إنشاء خطة درسك. يرجى المحاولة مرة أخرى بإرسال طلبك مرة أخرى.",
    error: "عذراً، حدث خطأ في إنشاء خطة الدرس. يرجى المحاولة مرة أخرى."
  },
  es: {
    successWithPdf: (topic) => `✅ ¡Tu plan de lección está listo!\n\nTema: ${topic}\n\nEste plan de lección de cinco pasos está listo para usar en tu aula.`,
    successWithoutPdf: (topic, gammaUrl) => `✅ ¡Tu plan de lección sobre "${topic}" está listo!\n\nMíralo aquí: ${gammaUrl}`,
    apology: "Lo siento, hubo un problema al crear tu plan de lección. Por favor intenta de nuevo enviando tu solicitud una vez más.",
    error: "Lo siento, hubo un error al crear el plan de lección. Por favor intenta de nuevo."
  }
};

class LessonPlanGenerationWorker {
  /**
   * Process a lesson plan generation job
   * @param {Object} jobData - Job payload from SQS
   */
  static async process(jobData) {
    // If payload carries a curriculum_lp_ast source UUID, this is a GROUNDED
    // render — we lay out a pre-authored LP into the 9-section frame via Gamma
    // and cache the result to R2. All other fields (requestId/userId/topic/…)
    // work identically; only the middle rendering step differs.
    if (jobData && jobData.sourceLpUuid) {
      return this.processGrounded(jobData);
    }

    // bd-2540 (Option A partial Gamma strip): all freeform LP + presentation
    // enqueue call sites (LessonPlanQueueService.createAndQueue) were deleted.
    // Any job that reaches this branch is either (a) a stale SQS message from
    // before the strip, or (b) a bug re-introducing the freeform path. Log and
    // drop with a benign apology so the SQS message is consumed rather than
    // retried indefinitely.
    const { requestId, phoneNumber, topic, contentType } = jobData || {};
    logToFile('⚠️ Non-grounded LP job received after Gamma strip — dropping', {
      requestId, contentType, topic,
    });
    if (requestId) {
      try {
        await LessonPlanQueueService.markFailed(
          requestId,
          'freeform LP generation is retired (bd-2540); only grounded AST jobs are processed',
        );
      } catch (markErr) {
        logToFile('markFailed after freeform-drop errored (non-fatal)', { error: markErr.message });
      }
    }
    if (phoneNumber) {
      try {
        await WhatsAppService.sendMessage(
          phoneNumber,
          "We don't have that lesson plan in the catalog yet. Send \"menu\" to see what's available.",
        );
      } catch (sendErr) {
        logToFile('post-drop apology send errored (non-fatal)', { error: sendErr.message });
      }
    }
    return;
  }

  /**
   * Process a GROUNDED lesson plan job — the payload carries a
   * curriculum_lp_ast.source_lp_uuid; we fetch that row, hand it to
   * ContentService.generateLessonPlan with { curriculumLpAst: lp } so Gamma
   * lays out the pre-authored content into the 9-section frame, cache the
   * resulting PDF to R2 keyed by (source_lp_uuid, language), and send.
   *
   * Follows the same idempotency + retry semantics as the freeform path so
   * SQS redelivery / stale-processing recovery keep working.
   *
   * @param {Object} jobData
   * @param {string} jobData.requestId
   * @param {string} jobData.userId
   * @param {string} jobData.phoneNumber
   * @param {string} jobData.sourceLpUuid
   * @param {string} jobData.topic
   * @param {string} [jobData.chapterTitle]
   * @param {'en'|'ur'} [jobData.language]
   */
  static async processGrounded(jobData) {
    const {
      requestId, userId, phoneNumber,
      sourceLpUuid, topic, chapterTitle,
      language = 'en',
    } = jobData;

    const messages = MESSAGES[language] || MESSAGES.en;

    try {
      // Idempotency: mirror the freeform path so re-delivery is safe.
      const existing = await LessonPlanQueueService.getRequest(requestId);
      if (existing?.status === 'completed') {
        logToFile('⏭️ Grounded LP request already completed, skipping', { requestId });
        return;
      }
      if (existing?.status === 'failed' && existing?.retry_count >= MAX_RETRIES) {
        logToFile('⏭️ Grounded LP request already failed max retries, skipping', { requestId });
        return;
      }
      if (existing?.status === 'processing') {
        const age = Date.now() - new Date(existing.processing_started_at).getTime();
        const TWO_MINUTES = 2 * 60 * 1000;
        if (age < TWO_MINUTES) {
          logToFile('⏭️ Grounded LP being processed by another worker, skipping', { requestId, ageMs: age });
          return;
        }
        logToFile('🔄 Recovering stale grounded LP', { requestId, ageMinutes: (age / 60000).toFixed(1) });
      }

      await LessonPlanQueueService.markProcessing(requestId);

      // 1. Hydrate the AST row (skip if inline provided by tests)
      const lp = jobData.lp || await CurriculumLpAstService.findByUuid(sourceLpUuid);
      if (!lp) throw new Error(`curriculum_lp_ast row not found: ${sourceLpUuid}`);

      // 2. Render + cache + send in one shot via the shared service
      const result = await renderAndServeGrounded({ userId: phoneNumber || userId, lp, language });
      if (!result.ok) throw new Error(`Grounded render failed: ${result.error}`);

      logToFile('Grounded LP delivered', { requestId, sourceLpUuid, r2Key: result.r2Key });

      // 3. Mark completed — synthesize a minimal { gammaUrl, pdfUrl } payload
      //    keyed to R2 so lesson_plan_requests reflects a real artifact.
      await LessonPlanQueueService.markCompleted(requestId, {
        gammaUrl: null,
        pdfUrl: result.r2Key,
      });

      // 4. Store in lesson_plans + schedule feedback prompt (both non-fatal)
      try {
        const lpVariant = lp.publisher === 'NBF' ? 'nbf_ast' : 'taleemabad_ast';
        // storeLessonPlan doesn't accept grade/subject columns; stash them in
        // content JSONB alongside chapter_number so handleFeedbackButton can
        // snapshot them onto lp_feedback.
        const content = {
          chapter_number: lp.chapter_number ?? null,
          grade: lp.grade ?? null,
          subject: lp.subject ?? null,
          lp_variant: lpVariant,
          language,
          trigger_mode: 'after_pdf_only',
        };
        const lpRow = await storeLessonPlan(userId, topic, 'lesson_plan', null, result.r2Key, content);
        if (lpRow?.id) {
          LpFeedbackService.scheduleFeedbackPrompt({
            lessonPlanId: lpRow.id,
            userId,
            phone: phoneNumber,
            context: {
              grade: lp.grade, subject: lp.subject, topic,
              chapterNumber: lp.chapter_number, lpVariant, language,
            },
          });
        }
      } catch (storeError) {
        logToFile('Warning: failed to store grounded LP / schedule feedback', {
          requestId, error: storeError.message,
        });
      }

      // 5. Feature linker / registration triggers (non-fatal on error)
      try {
        await FeatureLinkerService.suggestNext('lesson_plan', userId, phoneNumber, language, { topic });
      } catch (linkerError) {
        logToFile('Feature linker error (non-fatal)', { error: linkerError.message });
      }
      try {
        await FeatureRegistrationService.checkAndTriggerRegistration(userId, 'lesson_plan', phoneNumber, language, 'text');
      } catch (regError) {
        logToFile('Registration trigger error (non-fatal)', { error: regError.message });
      }

      logToFile('Grounded LP generation completed successfully', { requestId, sourceLpUuid });
    } catch (error) {
      logToFile('Grounded LP generation failed', {
        requestId, sourceLpUuid, error: error.message, stack: error.stack,
      });

      const req = await LessonPlanQueueService.getRequest(requestId);
      const retryCount = (req?.retry_count || 0) + 1;
      await LessonPlanQueueService.markFailed(requestId, error.message);

      if (retryCount >= MAX_RETRIES) {
        try {
          await WhatsAppService.sendMessage(phoneNumber, messages.apology);
        } catch (msgError) {
          logToFile('Failed to send apology (grounded)', { error: msgError.message });
        }
        return; // Don't re-throw — job complete
      }
      throw error;
    }
  }
}

module.exports = LessonPlanGenerationWorker;
