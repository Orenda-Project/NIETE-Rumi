/**
 * Coaching Job Queue Service
 * Handles SQS job queueing for background processing
 *
 * Responsibilities:
 * - Queue transcription jobs
 * - Queue analysis jobs
 * - Queue report generation jobs
 * - Manage job metadata and routing
 *
 * Extracted from coaching.service.js as part of Phase 3 refactoring
 */

const { logToFile } = require('../../utils/logger');

class CoachingJobQueueService {
  /**
   * Queue transcription job
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {object} metadata - Job metadata (from, audioId, etc.)
   * @returns {Promise<string>} SQS message ID
   */
  static async queueTranscription(coachingSessionId, metadata) {
    return await this.queueJob(coachingSessionId, 'transcription', metadata);
  }

  // FEAT-102 — /observe debrief-recording analysis. Every recording is its own
  // job: dedupNonce is keyed on the audioId (sha1, 16 chars — SQS dedup id caps
  // at 128) so a re-recording isn't swallowed as a duplicate.
  static async queueObserveDebrief(coachingSessionId, metadata) {
    const payload = { ...metadata };
    if (payload.audioId) {
      const crypto = require('crypto');
      payload.dedupNonce = crypto.createHash('sha1').update(String(payload.audioId)).digest('hex').slice(0, 16);
    }
    return await this.queueJob(coachingSessionId, 'observe_debrief', payload);
  }

  // FEAT-102 — combined FICO report render/delivery to the teacher.
  // metadata.phase: 'preview' | 'deliver' | 'teacher_tap' (folded into the dedup key upstream).
  // A preview is told apart by its recipient (dedupNonce from the teacher's number): "Someone else"
  // after a preview queues a preview for another teacher, which the session+phase key alone dropped
  // as a duplicate for an hour (sandbox E2E, 4 Oct). The same teacher twice is still one job.
  static async queueObserveTeacherReport(coachingSessionId, metadata) {
    const payload = { ...metadata };
    if (payload.phase === 'preview' && payload.teacherPhone) {
      const crypto = require('crypto');
      payload.dedupNonce = crypto.createHash('sha1').update(String(payload.teacherPhone)).digest('hex').slice(0, 16);
    }
    return await this.queueJob(coachingSessionId, 'observe_teacher_report', payload);
  }

  /**
   * Queue analysis job
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {object} metadata - Job metadata (from, etc.)
   * @returns {Promise<string>} SQS message ID
   */
  static async queueAnalysis(coachingSessionId, metadata) {
    return await this.queueJob(coachingSessionId, 'analysis', metadata);
  }

  /**
   * Queue report generation job
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {object} metadata - Job metadata (from, etc.)
   * @returns {Promise<string>} SQS message ID
   */
  static async queueReport(coachingSessionId, metadata) {
    return await this.queueJob(coachingSessionId, 'report_generation', metadata);
  }

  /**
   * Queue lesson plan extraction job
   * @param {string} coachingSessionId
   * @param {object} metadata - { r2Key, fileType, userId }
   */
  static async queueLessonPlanExtraction(coachingSessionId, metadata) {
    return await this.queueJob(coachingSessionId, 'lesson_plan_extraction', metadata);
  }

  /**
   * Queue a background job to AWS SQS
   * @param {string} coachingSessionId - Coaching session UUID
   * @param {string} jobType - Type of job (transcription, analysis, report_generation)
   * @param {object} payload - Job payload
   * @returns {Promise<string>} SQS message ID
   * @private
   */
  static async queueJob(coachingSessionId, jobType, payload = {}) {
    try {
      const SQSQueueService = require('../queue');

      const messageId = await SQSQueueService.queueCoachingJob(
        coachingSessionId,
        jobType,
        payload
      );

      logToFile('Job queued to SQS', { coachingSessionId, jobType, messageId });
      return messageId;
    } catch (error) {
      logToFile('❌ Error queuing job to SQS', {
        error: error.message,
        jobType,
        coachingSessionId
      });
      throw error;
    }
  }
}

module.exports = CoachingJobQueueService;
