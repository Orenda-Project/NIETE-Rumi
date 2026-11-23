/**
 * Exam Session Service
 * Manages exam checking sessions in Supabase + Redis
 *
 * Created: 2026-01-24
 * Bead: (orchestrator dependency)
 */

const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const { logToFile, logError } = require('../../utils/logger');

// Redis key prefix and TTL
const REDIS_PREFIX = 'exam_session:';
const REDIS_TTL = 60 * 60 * 24; // 24 hours

// How long a session may sit untouched before it stops counting as open (bd-krhhgp).
// Before this, any row not completed/cancelled/error was "active" forever, and every plain text
// the person sent went to the exam checker: on 21 Nov 2026 a "Hey" got 'You have 0 images' from
// a session opened on 6 Aug. A session waiting on the teacher (photos, confirmations, answers)
// closes after an hour of silence; one the system is working on (OCR, grading, delivery) gets a
// day, since the SQS worker re-queues those itself (recoverStaleExamSessions).
const WAITING_IDLE_MS = 60 * 60 * 1000;
const PROCESSING_IDLE_MS = 24 * 60 * 60 * 1000;
const PROCESSING_STATES = new Set(['processing_ocr', 'grading', 'delivering_results']);
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'error']);

class ExamSessionService {
  /**
   * Has this session sat untouched past its window? (pure)
   * @param {object} session - exam_check_sessions row
   * @param {number} [now] - ms since epoch
   */
  static isIdle(session, now = Date.now()) {
    if (!session) return false;
    const last = Date.parse(session.updated_at || session.created_at || '');
    if (!Number.isFinite(last)) return false;
    const limit = PROCESSING_STATES.has(session.status) ? PROCESSING_IDLE_MS : WAITING_IDLE_MS;
    return now - last > limit;
  }

  /**
   * The session if it is still open, else null. An idle one is closed (cancelled) so the next
   * message reaches the ordinary bot. A cached copy that looks idle is checked against its row
   * first: the row is the truth, the cache only a copy.
   */
  static async _liveOrClose(userId, session, fromCache) {
    if (!session) return null;
    let current = session;
    if (fromCache && this.isIdle(current)) {
      const row = await this.getById(current.id);
      if (!row || TERMINAL_STATES.has(row.status)) {
        await this._clearFromRedis(userId);
        return null;
      }
      current = row;
      if (!this.isIdle(current)) {
        await this._saveToRedis(userId, current);
        return current;
      }
    }
    if (!this.isIdle(current)) return current;

    const idleMinutes = Math.round((Date.now() - Date.parse(current.updated_at || current.created_at)) / 60000);
    logToFile('⌛ Exam session closed after no activity', {
      event: 'exam_checker.session_expired',
      sessionId: current.id,
      state: current.status,
      imageCount: (current.original_images || []).length,
      createdAt: current.created_at,
      idleMinutes,
    });
    try {
      await this.updateStatus(current.id, 'cancelled', { error_message: `expired: no activity for ${idleMinutes} min` });
    } catch (err) {
      // Closing failed (DB hiccup): still treat it as closed for this message, and drop the copy.
      logError('❌ Could not close an idle exam session', { event: 'exam_checker.session_expire_failed', sessionId: current.id, error: err.message });
      await this._clearFromRedis(userId);
    }
    return null;
  }

  static async _latestOpenRow(userId) {
    const { data, error } = await supabase
      .from('exam_check_sessions')
      .select('*')
      .eq('user_id', userId)
      .not('status', 'in', '("completed","cancelled","error")')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data && !error ? data : null;
  }

  /**
   * Get or create an exam session for a user
   * @param {string} userId - User UUID
   * @returns {object} Session object
   */
  static async getOrCreate(userId) {
    const existing = await this.getActive(userId);
    if (existing) return existing;
    return this._createSession(userId);
  }

  /**
   * Get active session for user (without creating new one). Idle sessions are closed, not returned.
   * @param {string} userId - User UUID
   * @returns {object|null} Session or null
   */
  static async getActive(userId) {
    // Check Redis first
    const cachedSession = await this._getFromRedis(userId);
    if (cachedSession && typeof cachedSession === 'object') {
      return this._liveOrClose(userId, cachedSession, true);
    }

    // Check Supabase
    const data = await this._latestOpenRow(userId);
    if (!data) return null;
    const live = await this._liveOrClose(userId, data, false);
    if (live) await this._saveToRedis(userId, live);
    return live;
  }

  /**
   * Get session by ID
   * @param {string} sessionId - Session UUID
   * @returns {object|null} Session or null
   */
  static async getById(sessionId) {
    const { data, error } = await supabase
      .from('exam_check_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      logToFile('❌ Failed to get session by ID', { sessionId, error: error.message });
      return null;
    }

    return data;
  }

  /**
   * Create a new exam session
   * @param {string} userId - User UUID
   * @returns {object} New session
   */
  static async _createSession(userId) {
    const { data, error } = await supabase
      .from('exam_check_sessions')
      .insert({
        user_id: userId,
        status: 'collecting_images',
        original_images: []
      })
      .select()
      .single();

    if (error) {
      logToFile('❌ Failed to create exam session', { userId, error: error.message });
      throw new Error('Failed to create exam session');
    }

    logToFile('✅ Created new exam session', { sessionId: data.id, userId });
    await this._saveToRedis(userId, data);
    return data;
  }

  /**
   * Add an image to the session
   * @param {string} sessionId - Session UUID
   * @param {string} imageUrl - R2 URL of the image
   */
  static async addImage(sessionId, imageUrl) {
    // Get current session
    const session = await this.getById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const images = session.original_images || [];
    const newImage = {
      url: imageUrl,
      uploadedAt: new Date().toISOString(),
      pageNumber: images.length + 1
    };

    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('exam_check_sessions')
      .update({
        original_images: [...images, newImage],
        updated_at: updatedAt
      })
      .eq('id', sessionId);

    if (error) {
      logToFile('❌ Failed to add image to session', { sessionId, error: error.message });
      throw new Error('Failed to add image');
    }

    // Update Redis cache (with the new updated_at, so a collection in progress never looks idle)
    const updatedSession = { ...session, original_images: [...images, newImage], updated_at: updatedAt };
    await this._saveToRedis(session.user_id, updatedSession);

    logToFile('📷 Image added to session', { sessionId, imageCount: images.length + 1 });
  }

  /**
   * Update session status
   * @param {string} sessionId - Session UUID
   * @param {string} status - New status
   * @param {object} additionalUpdates - Additional fields to update
   */
  static async updateStatus(sessionId, status, additionalUpdates = {}) {
    const updates = {
      status,
      updated_at: new Date().toISOString(),
      ...additionalUpdates
    };

    // Set processing timestamps
    if (status === 'processing_ocr') {
      updates.processing_started_at = new Date().toISOString();
    }
    if (['completed', 'error', 'cancelled'].includes(status)) {
      updates.processing_completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('exam_check_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      logToFile('❌ Failed to update session status', { sessionId, status, error: error.message });
      throw new Error('Failed to update session status');
    }

    // Update Redis cache
    if (data) {
      await this._saveToRedis(data.user_id, data);
    }

    // Clear Redis if session ended
    if (['completed', 'error', 'cancelled'].includes(status) && data) {
      await this._clearFromRedis(data.user_id);
    }

    logToFile('📝 Session status updated', { sessionId, status });
    return data;
  }

  /**
   * Update session with arbitrary fields
   * @param {string} sessionId - Session UUID
   * @param {object} updates - Fields to update
   */
  static async update(sessionId, updates) {
    const { data, error } = await supabase
      .from('exam_check_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      logToFile('❌ Failed to update session', { sessionId, error: error.message });
      throw new Error('Failed to update session');
    }

    // Update Redis cache
    if (data) {
      await this._saveToRedis(data.user_id, data);
    }

    return data;
  }

  /**
   * Add answer to marking scheme
   * @param {string} sessionId - Session UUID
   * @param {string} questionId - Question ID
   * @param {object} answer - Answer object
   */
  static async addAnswer(sessionId, questionId, answer) {
    const session = await this.getById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const markingScheme = session.marking_scheme || { questions: [], totalMarks: 0 };
    const existingIndex = markingScheme.questions.findIndex(q => q.id === questionId);

    const questionAnswer = {
      id: questionId,
      answer: answer.answer,
      marks: answer.marks || 1,
      type: answer.type || 'short',
      rubric: answer.rubric || null
    };

    if (existingIndex >= 0) {
      markingScheme.questions[existingIndex] = questionAnswer;
    } else {
      markingScheme.questions.push(questionAnswer);
    }

    // Recalculate total marks
    markingScheme.totalMarks = markingScheme.questions.reduce((sum, q) => sum + (q.marks || 0), 0);

    await this.update(sessionId, { marking_scheme: markingScheme });
    logToFile('📝 Answer added to marking scheme', { sessionId, questionId });
  }

  // ==================== REDIS HELPERS ====================

  static async _getFromRedis(userId) {
    try {
      const key = `${REDIS_PREFIX}${userId}`;
      // railway-redis.get() auto-parses JSON — returns object|string|null.
      return await redisService.get(key);
    } catch (error) {
      logToFile('⚠️ Redis get failed', { userId, error: error.message });
      return null;
    }
  }

  static async _saveToRedis(userId, session) {
    try {
      const key = `${REDIS_PREFIX}${userId}`;
      // railway-redis.set() auto-serializes non-string values; pass the object.
      await redisService.set(key, session, REDIS_TTL);
    } catch (error) {
      logToFile('⚠️ Redis save failed', { userId, error: error.message });
    }
  }

  static async _clearFromRedis(userId) {
    try {
      const key = `${REDIS_PREFIX}${userId}`;
      await redisService.delete(key);
    } catch (error) {
      logToFile('⚠️ Redis clear failed', { userId, error: error.message });
    }
  }
}

module.exports = ExamSessionService;
module.exports.WAITING_IDLE_MS = WAITING_IDLE_MS;
module.exports.PROCESSING_IDLE_MS = PROCESSING_IDLE_MS;
