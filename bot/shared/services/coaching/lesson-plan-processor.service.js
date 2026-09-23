/**
 * Lesson Plan Processor Service
 * Handles lesson plan document processing for classroom observations
 *
 * Responsibilities:
 * - Process Yes/No lesson plan responses
 * - Download and store lesson plan documents
 * - Extract text from documents (PDF/Word/Images)
 * - Upload to R2 storage
 * - Queue analysis job
 *
 * Extracted from coaching.service.js as part of Phase 3 refactoring
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const WhatsAppService = require('../whatsapp.service');
const CoachingSessionService = require('./coaching-session.service');
const CoachingJobQueueService = require('./coaching-job-queue.service');
const { uploadLessonPlanBuffer, buildR2PublicUrl } = require('../../storage/r2');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { resolveUx } = require('../../config/ux-strings');
const { isTerminalStatus } = require('./session-terminal');

/**
 * Look up the language of whoever answers this session's lesson-plan step:
 * the teacher on her own session, the observer on an observation.
 * Falls back to 'en' when the session/user is missing — we'd rather
 * ship the English message than throw mid-pipeline.
 */
async function _resolveSessionLanguage(coachingSessionId) {
  try {
    const { data } = await supabase
      .from('coaching_sessions')
      .select('user_id, observer_user_id, users(name, preferred_language), transcript_language')
      .eq('id', coachingSessionId)
      .maybeSingle();
    // On an observation the person answering these buttons is the OBSERVER, and
    // the `users` join rides user_id — the observed teacher once one is bound.
    // Reading it wrote to an English coach in the teacher's Urdu. The observe
    // stack owns "whose language is this?"; ask it for the coach.
    if (data?.observer_user_id) {
      const { languageFor } = require('../observe/observe-language');
      return await languageFor('coach', data);
    }
    return data?.users?.preferred_language || data?.transcript_language || 'en';
  } catch (_err) {
    return 'en';
  }
}

class LessonPlanProcessorService {
  /**
   * Handle lesson plan response (Yes/No/Document upload)
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {string} from - User's phone number
   * @param {boolean} hasLessonPlan - Whether user has lesson plan
   * @param {string|null} documentId - WhatsApp document media ID (if uploaded)
   * @returns {Promise<void>}
   */
  static async handleLessonPlanResponse(coachingSessionId, from, hasLessonPlan, documentId = null) {
    try {
      logToFile('Handling lesson plan response', {
        coachingSessionId,
        hasLessonPlan,
        hasDocument: !!documentId
      });

      // The Yes/No buttons stay tappable after a cancel, and both arms write.
      const { data: gate } = await supabase
        .from('coaching_sessions')
        .select('status')
        .eq('id', coachingSessionId)
        .maybeSingle();
      if (isTerminalStatus(gate && gate.status)) {
        const gateLang = await _resolveSessionLanguage(coachingSessionId);
        await WhatsAppService.sendMessage(from, resolveUx('coachingSessionCancelled', { language: gateLang }));
        logToFile('🚫 Lesson-plan step refused — the session is over', { coachingSessionId, status: gate.status });
        return;
      }

      if (!hasLessonPlan) {
        // User doesn't have lesson plan - proceed immediately to analysis
        await supabase
          .from('coaching_sessions')
          .update({
            has_lesson_plan: false,
            // bd-5knlj: the buttons-path "No" left no lesson_plan_link_method,
            // which hid 153 coach answers from every later analysis — the
            // largest bucket of missing-Section-B looked like "never answered".
            lesson_plan_link_method: 'none'
          })
          .eq('id', coachingSessionId);

        const lang = await _resolveSessionLanguage(coachingSessionId);
        await WhatsAppService.sendMessage(from, getCoachingMessage('lessonPlan_skip', lang));

        // Queue analysis job
        const CoachingJobQueueService = require('./coaching-job-queue.service');
        await CoachingJobQueueService.queueAnalysis(coachingSessionId, { from });
        return;
      }

      // User has lesson plan
      if (documentId) {
        await this.handleLessonPlanUpload(coachingSessionId, from, documentId);
        // Queue analysis job immediately; LP extraction happens in background
        await CoachingJobQueueService.queueAnalysis(coachingSessionId, { from, lpUploaded: true });
      } else {
        // User said yes but no document yet - ask them to send it
        const lang = await _resolveSessionLanguage(coachingSessionId);
        await WhatsAppService.sendMessage(from, getCoachingMessage('lessonPlan_request', lang));

        // Set timeout for 24 hours with reminders
        // TODO: Implement reminder system (can be done in Phase 4)
      }
    } catch (error) {
      logToFile('❌ Error in handleLessonPlanResponse', {
        error: error.message,
        coachingSessionId
      });
      throw error;
    }
  }

  static async handleLessonPlanUpload(coachingSessionId, from, documentId) {
    try {
      logToFile('Processing lesson plan upload (async)', { coachingSessionId, documentId });

      const session = await CoachingSessionService.getSession(coachingSessionId);
      if (!session) {
        throw new Error('Coaching session not found');
      }

      const docData = await WhatsAppService.downloadMedia(documentId);
      const fileType = this.detectFileType(docData);
      const r2Key = await uploadLessonPlanBuffer({
        buffer: docData,
        userId: session.user_id,
        sessionId: coachingSessionId,
        fileType
      });

      const lessonPlanUrl = buildR2PublicUrl(r2Key);

      await supabase
        .from('coaching_sessions')
        .update({
          has_lesson_plan: true,
          lesson_plan_url: lessonPlanUrl,
          lesson_plan_r2_key: r2Key,
          lesson_plan_format: fileType,
          lesson_plan_extraction_status: 'pending',
          lesson_plan_extraction_error: null
        })
        .eq('id', coachingSessionId);

      await CoachingJobQueueService.queueLessonPlanExtraction(coachingSessionId, {
        r2Key,
        fileType,
        userId: session.user_id
      });

      const lang = await _resolveSessionLanguage(coachingSessionId);
      await WhatsAppService.sendMessage(from, getCoachingMessage('lessonPlan_received', lang));

      logToFile('Lesson plan queued for extraction', {
        coachingSessionId,
        fileType,
        r2Key
      });
    } catch (error) {
      logToFile('❌ Error handling lesson plan upload', {
        error: error.message,
        coachingSessionId
      });
      throw error;
    }
  }

  /**
   * bd-we73k — the teacher PASTED her plan as a chat message instead of
   * attaching a file. Same contract as handleLessonPlanUpload, minus the parts
   * that only exist because a file does: no download, no R2 object, no format
   * sniffing. The text IS the extraction result, so it goes straight onto the
   * row and the same extraction job runs to structure and validate it —
   * isLikelyLessonPlan, lesson_plan_structured and the post-
   * extraction fidelity recompute all behave exactly as they do for an upload.
   *
   * Deliberately NOT writing lesson_plan_url / lesson_plan_r2_key: there is no
   * object behind them, and a URL that 404s is worse than a null.
   *
   * @param {string} coachingSessionId
   * @param {string} from - WhatsApp phone number (E.164 minus '+')
   * @param {string} text - the pasted plan, already trimmed by the caller
   */
  static async handlePastedLessonPlan(coachingSessionId, from, text) {
    const plan = String(text || '').trim();
    if (!plan) return;

    // The LP step's other writers all refuse a cancelled observation; a paste
    // arriving after a cancel must not resurrect it.
    const { data: gate } = await supabase
      .from('coaching_sessions')
      .select('status, user_id')
      .eq('id', coachingSessionId)
      .maybeSingle();
    if (isTerminalStatus(gate && gate.status)) {
      const gateLang = await _resolveSessionLanguage(coachingSessionId);
      await WhatsAppService.sendMessage(from, resolveUx('coachingSessionCancelled', { language: gateLang }));
      logToFile('🚫 Pasted lesson plan refused — the session is over', { coachingSessionId, status: gate.status });
      return;
    }

    await supabase
      .from('coaching_sessions')
      .update({
        has_lesson_plan: true,
        lesson_plan_text: plan,
        lesson_plan_format: 'text',
        lesson_plan_link_method: 'pasted',
        lesson_plan_extraction_status: 'pending',
        lesson_plan_extraction_error: null
      })
      .eq('id', coachingSessionId);

    await CoachingJobQueueService.queueLessonPlanExtraction(coachingSessionId, {
      pastedText: plan,
      fileType: 'text',
      userId: gate && gate.user_id
    });

    // No "lesson plan received" ack here: the Step 2/5 announcement that follows
    // already tells her the plan is being read into the analysis, so an ack sent
    // just before it read as the same message twice (DC feedback, 2026-09-23).
    // Same ordering as the upload path: analysis starts now, the plan is woven
    // in as soon as the extraction job lands.
    await CoachingJobQueueService.queueAnalysis(coachingSessionId, { from, lpUploaded: true });

    logToFile('📄 Pasted lesson plan stored and queued', {
      coachingSessionId, chars: [...plan].length
    });
  }

  static detectFileType(buffer) {
    if (!buffer || buffer.length < 4) {
      return 'pdf';
    }

    const bytes = buffer.subarray(0, 8);
    const hex = bytes.toString('hex');

    if (hex.startsWith('25504446')) {
      return 'pdf';
    }

    if (hex.startsWith('504b0304')) {
      return 'docx';
    }

    if (hex.startsWith('d0cf11e0')) {
      return 'doc';
    }

    if (hex.startsWith('ffd8ff')) {
      return 'jpg';
    }

    if (hex.startsWith('89504e47')) {
      return 'png';
    }

    return 'pdf';
  }
}

module.exports = LessonPlanProcessorService;
