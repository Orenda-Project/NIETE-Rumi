/**
 * Coaching Helpers Service
 * Utility functions for coaching workflow
 *
 * Responsibilities:
 * - Acknowledge a completed transcription
 * - Determine output language
 * - Record quality metrics
 * - Calculate costs
 *
 * Extracted from coaching.service.js as part of Phase 2 refactoring
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { getCoachingMessage } = require('../../config/coaching-messages');
const { getUserLanguage } = require('../../utils/language-cache');
const { clampLanguage } = require('../../config/ux-strings');

class CoachingHelpersService {
  /**
   * Acknowledge a completed transcription.
   *
   * bd-di5ap (DC row 129) — this used to ask GPT-4o for a "warm, encouraging"
   * line and gave it two inputs: the teacher's name and the lesson duration. No
   * transcript. No analysis — none has run at this point in the pipeline. The
   * system prompt nonetheless asked it to be "authentic and SPECIFIC", so the
   * model supplied specificity it had no basis for: a teacher was told "your
   * 29-minute lesson was engaging and impactful" and reasonably took it for her
   * feedback, one message after being told transcription would take 30-60
   * seconds. Guarding the output would have been the wrong fix — the prompt was
   * ASKING for a verdict. Removing the model removes the class.
   *
   * What the teacher needs here is the receipt, not the review: confirmation
   * that her audio arrived and how long it ran. That is a fixed sentence, so it
   * now lives in the catalog and is translated — which also closes a second
   * defect for free. The old prompt carried no language instruction at all
   * ("a supportive teaching coach in Pakistan"), so the one message in this
   * stretch of the pipeline that was not translatable was this one. The main
   * bot hit exactly this and fixed it in bd-8/BUG-117; the port never reached
   * NIETE. It feeds DC row 130 (half-English, half-Urdu sessions).
   *
   * @param {string} firstName - Teacher's name. `session.users.name` is NULL for
   *   6,282 of 15,552 prod users (bd-gc1ge), so a nameless variant is a real
   *   path, not an edge case — normalised here so every caller is covered.
   * @param {number} durationSeconds - Audio duration in seconds
   * @param {string} [language='en'] - Teacher's current language. Defaults to
   *   English only as an emergency floor; callers resolve it at send time
   *   (teacher-addressed text reads the CURRENT preference, never a frozen one).
   * @returns {Promise<string>} The acknowledgement, ready to send
   */
  static async generateEncouragingMessage(firstName, durationSeconds, language = 'en') {
    const name = String(firstName == null ? '' : firstName).trim();
    const durationMinutes = Math.round(Number(durationSeconds) / 60) || 0;

    const key = name ? 'transcriptionComplete' : 'transcriptionComplete_noName';

    // No `|| 'en'` floor here: getCoachingMessage already returns the English
    // entry for any code it has no copy for, including null. Adding one would
    // ratchet this file's English-floor count for no behavioural gain.
    //
    // String(...) on the count, never a locale-aware formatter: the digits stay
    // Western in both languages. Only the words around them translate.
    return getCoachingMessage(key, language)
      .replace('{{name}}', name)
      .replace('{{minutes}}', String(durationMinutes));
  }

  /**
   * Determine output language for the report + voice debrief.
   *
   * bd-2413 (FEAT-106 rows 11,12): the teacher's PREFERRED/LOCKED language wins —
   * NEVER the transient input language. Previously this read the most recent
   * conversations.input_language and returned that, so a teacher who answered one
   * reflection in English got an English voice debrief, and one who asked for
   * Punjabi mid-flow got Punjabi output that then stuck. The report + voice must
   * follow her chosen language (set + locked via /settings → preferred_language),
   * clamped to a language the coaching pipeline can actually render.
   *
   * @param {string} userId
   * @param {string} sessionId (unused now; kept for signature compatibility)
   * @param {string} transcriptLanguage - fallback only, when no preference is set
   * @returns {Promise<string>} Language code ('ur', 'en', …)
   */
  static async determineOutputLanguage(userId, sessionId, transcriptLanguage) {
    try {
      const preferred = await getUserLanguage(userId);
      if (preferred) return CoachingHelpersService.clampCoachingLanguage(preferred);
      // Kept for the signature's sake, but note getUserLanguage never returns a
      // falsy value — it answers with the emergency floor on every failure path —
      // so this line is effectively unreachable in production and only the tests
      // (which stub the reader to null) exercise it. It is clamped anyway: an
      // unclamped transcript language is exactly how an off-market code used to
      // reach a report.
      return CoachingHelpersService.clampCoachingLanguage(transcriptLanguage);
    } catch (error) {
      logToFile('Warning: Could not determine output language, using the floor', {
        error: error.message,
        floor: clampLanguage(null),
      });
      return clampLanguage(null);
    }
  }

  /**
   * Clamp a language code to one the coaching report + TTS can render.
   *
   * Was its own four-language set (`en, ur, sw, ar`) with an Urdu floor — a
   * private list, and a second disagreeing floor. Both are now the deployment's:
   * only what ICT serves, and the same English floor as every other surface.
   *
   * Kiswahili and Arabic were never renderable here in any case — no coaching
   * copy, TTS voice or report font exists for either in this deployment, so the
   * set was advertising capability it did not have.
   */
  static clampCoachingLanguage(lang) {
    return clampLanguage(lang);
  }

  /**
   * Record quality metrics for coaching session
   * @param {object} session - Coaching session object
   * @returns {Promise<void>}
   */
  static async recordQualityMetrics(session) {
    try {
      const processingTime = new Date(session.completed_at) - new Date(session.created_at);
      const transcriptionTime = new Date(session.transcription_completed_at) - new Date(session.transcription_started_at);
      const analysisTime = new Date(session.analysis_completed_at) - new Date(session.analysis_started_at);

      await supabase
        .from('coaching_quality_metrics')
        .insert({
          coaching_session_id: session.id,
          diarization_confidence: session.diarization_confidence,
          processing_time_seconds: Math.round(processingTime / 1000),
          transcription_time_seconds: Math.round(transcriptionTime / 1000),
          analysis_time_seconds: Math.round(analysisTime / 1000),
          session_cost: session.total_cost,
          had_errors: false,
          retry_count: 0,
          created_at: new Date().toISOString()
        });

      logToFile('Quality metrics recorded', { coachingSessionId: session.id });
    } catch (error) {
      logToFile('Warning: Failed to record quality metrics (non-critical)', {
        error: error.message,
        coachingSessionId: session.id
      });
    }
  }

  /**
   * Calculate total cost for coaching session
   * @param {number} transcriptionCost - Cost of transcription
   * @param {number} analysisCost - Cost of analysis
   * @param {number} reportCost - Cost of report generation
   * @param {number} voiceCost - Cost of voice debrief
   * @returns {number} Total cost
   */
  static calculateTotalCost(transcriptionCost = 0, analysisCost = 0, reportCost = 0, voiceCost = 0) {
    return transcriptionCost + analysisCost + reportCost + voiceCost;
  }
}

module.exports = CoachingHelpersService;
