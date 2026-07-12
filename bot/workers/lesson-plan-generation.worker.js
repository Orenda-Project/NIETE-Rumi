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

    const { requestId, userId, phoneNumber, topic, fullMessage, language = 'en', contentType = 'lesson_plan' } = jobData;

    const messages = MESSAGES[language] || MESSAGES.en;

    try {
      // IDEMPOTENCY CHECK: Prevent duplicate processing
      const existingRequest = await LessonPlanQueueService.getRequest(requestId);

      if (existingRequest?.status === 'completed') {
        logToFile('⏭️ Request already completed, skipping duplicate processing', {
          requestId,
          completedAt: existingRequest.completed_at,
          gammaUrl: existingRequest.gamma_url
        });
        return; // Exit without processing
      }

      // Also skip if already failed with max retries (prevents infinite loop)
      if (existingRequest?.status === 'failed' && existingRequest?.retry_count >= MAX_RETRIES) {
        logToFile('⏭️ Request already failed with max retries, skipping', {
          requestId,
          retryCount: existingRequest.retry_count,
          errorMessage: existingRequest.error_message
        });
        return; // Exit without processing - job was already finalized
      }

      if (existingRequest?.status === 'processing') {
        const processingAge = Date.now() - new Date(existingRequest.processing_started_at).getTime();
        const TWO_MINUTES = 2 * 60 * 1000;

        if (processingAge < TWO_MINUTES) {
          logToFile('⏭️ Request being processed by another worker, skipping', {
            requestId,
            processingStartedAt: existingRequest.processing_started_at,
            ageMs: processingAge
          });
          return; // Exit - another worker is handling it
        }
        // If > 2 min, proceed (stale job recovery)
        logToFile('🔄 Recovering stale processing request', {
          requestId,
          processingStartedAt: existingRequest.processing_started_at,
          ageMinutes: (processingAge / 60000).toFixed(1)
        });
      }

      logToFile('Starting lesson plan generation', {
        requestId,
        userId,
        topic,
        contentType
      });

      // 1. Mark as processing
      await LessonPlanQueueService.markProcessing(requestId);

      // 2. Generate with Gamma API
      let result;
      if (contentType === 'presentation') {
        result = await ContentService.generatePresentation(topic, fullMessage, language);
      } else {
        result = await ContentService.generateLessonPlan(topic, fullMessage, language);
      }

      logToFile('Gamma generation complete', {
        requestId,
        gammaUrl: result.gammaUrl,
        hasPdf: !!result.pdfUrl
      });

      // 3. Download and send PDF if available
      if (result.pdfUrl) {
        const safeTopic = topic.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 50);
        const pdfFilename = `${contentType}_${safeTopic}.pdf`;
        const pdfPath = path.join(TEMP_DIR, pdfFilename);

        try {
          await ContentService.downloadPDF(result.pdfUrl, pdfFilename, TEMP_DIR);

          await WhatsAppService.sendDocument(
            phoneNumber,
            pdfPath,
            pdfFilename,
            messages.successWithPdf(topic)
          );

          // Clean up temp file
          if (fs.existsSync(pdfPath)) {
            fs.unlinkSync(pdfPath);
          }
        } catch (pdfError) {
          logToFile('PDF download/send failed, falling back to URL', {
            requestId,
            error: pdfError.message
          });

          // Fallback to URL only
          await WhatsAppService.sendMessage(
            phoneNumber,
            messages.successWithoutPdf(topic, result.gammaUrl)
          );
        }
      } else {
        // No PDF, send Gamma URL
        await WhatsAppService.sendMessage(
          phoneNumber,
          messages.successWithoutPdf(topic, result.gammaUrl)
        );
      }

      // 4. Store in lesson_plans + schedule feedback prompt (both non-fatal)
      try {
        const content = {
          lp_variant: 'gamma_freeform',
          language,
          trigger_mode: 'after_pdf_only',
        };
        const lpRow = await storeLessonPlan(
          userId, topic, contentType, result.gammaUrl, result.pdfUrl, content,
        );
        logToFile('Lesson plan stored in database', { requestId, userId });
        // Freeform LPs (contentType==='lesson_plan') get the feedback prompt too.
        // Presentations skip — we're not soliciting feedback on those yet.
        if (lpRow?.id && contentType === 'lesson_plan') {
          LpFeedbackService.scheduleFeedbackPrompt({
            lessonPlanId: lpRow.id,
            userId,
            phone: phoneNumber,
            context: { topic, language, lpVariant: 'gamma_freeform' },
          });
        }
      } catch (storeError) {
        logToFile('Warning: Failed to store lesson plan / schedule feedback', {
          requestId,
          error: storeError.message
        });
      }

      // 5. Mark request as completed
      await LessonPlanQueueService.markCompleted(requestId, result);

      // 6. Feature linker suggestion (non-blocking)
      try {
        await FeatureLinkerService.suggestNext(
          contentType === 'presentation' ? 'presentation' : 'lesson_plan',
          userId,
          phoneNumber,
          language,
          { topic }
        );
      } catch (linkerError) {
        logToFile('Feature linker error (non-fatal)', { error: linkerError.message });
      }

      // 7. Check and trigger registration if needed (non-blocking)
      try {
        await FeatureRegistrationService.checkAndTriggerRegistration(
          userId,
          contentType === 'presentation' ? 'presentation' : 'lesson_plan',
          phoneNumber,
          language,
          'text' // Lesson plans are requested via text
        );
      } catch (regError) {
        logToFile('Registration trigger error (non-fatal)', { error: regError.message });
      }

      logToFile('Lesson plan generation completed successfully', { requestId });

    } catch (error) {
      logToFile('Lesson plan generation failed', {
        requestId,
        error: error.message,
        stack: error.stack
      });

      // Get current retry count
      const request = await LessonPlanQueueService.getRequest(requestId);
      const retryCount = (request?.retry_count || 0) + 1;

      // Mark as failed (increments retry_count)
      await LessonPlanQueueService.markFailed(requestId, error.message);

      // If max retries exceeded, send apology and STOP (don't re-throw)
      if (retryCount >= MAX_RETRIES) {
        try {
          await WhatsAppService.sendMessage(phoneNumber, messages.apology);
          logToFile('Apology message sent after max retries - job complete', { requestId, retryCount });
        } catch (msgError) {
          logToFile('Failed to send apology message', { error: msgError.message });
        }
        // DON'T re-throw - let job complete and be removed from SQS
        // This prevents infinite retry loop
        return;
      }

      // Only re-throw if retries remain (let SQS handle retry)
      throw error;
    }
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
