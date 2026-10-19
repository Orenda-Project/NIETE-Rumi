/**
 * Password Reset Service (Portal Backend)
 * Handles password reset flow for teacher portal
 *
 * Responsibilities:
 * - Generate 6-digit verification codes
 * - Call Main Bot's internal API to send codes via WhatsApp
 * - Verify codes within 10-minute expiry window
 * - Rate limiting to prevent abuse
 *
 * Flow:
 * 1. User requests reset on portal (enters phone number)
 * 2. Backend calls sendResetCode() → Calls Main Bot API → WhatsApp message sent
 * 3. User enters code on portal
 * 4. Frontend calls verifyResetCode() → validates code
 * 5. If valid, frontend allows password reset
 *
 * NOTE: Uses Main Bot's /api/internal/send-password-reset endpoint
 * This ensures all WhatsApp messages go through the main bot service
 */

const crypto = require('crypto');
const supabase = require('../config/supabase');
const axios = require('axios');
// The bot's ONE definition of "registered" (a completed run, or a name we already know). Pure, no requires.
const { isRegistered } = require('../../bot/shared/utils/registration-status');

/**
 * bd-x7aprz.3 — who may receive a WhatsApp code: a live account that is a registered adult, or that already has a
 * password. NOT portal_activated: that flag was how 170 form-registered teachers whose setup link lapsed were told
 * "No account found" by the login AND by Forgot password. The number she messages the bot from is the identity.
 */
const ELIGIBILITY_COLUMNS = 'id, name, registration_completed, registration_state, deleted_at, portal_password_hash';
function mayReceiveCode(user) {
  if (!user || user.deleted_at) return false;
  return isRegistered(user) || Boolean(user.portal_password_hash);
}

const CODE_TTL_MIN = 10;
/** A new code may be asked for once a minute (it replaces the last); the old rule held her for all ten. */
const RESEND_AFTER_MS = 60 * 1000;
/** Wrong codes allowed against one issued code before it is voided (it then has to be asked for again). */
const MAX_WRONG_CODES = 5;
/** phone -> { code, n }: wrong tries against the code now stored for that phone. Per process; the void is durable. */
const wrongTries = new Map();

function sameCode(stored, typed) {
  const a = Buffer.from(String(stored || ''));
  const b = Buffer.from(String(typed || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// Main Bot internal API configuration
const MAIN_BOT_URL = process.env.MAIN_BOT_URL || '';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

class PasswordResetService {
  /**
   * Send password reset code via WhatsApp
   * Generates 6-digit code, stores in database, calls Main Bot API to send WhatsApp message
   *
   * @param {string} phoneNumber - User's phone number (format: 923001234567)
   * @param {string} [language] - optional override; normally left unset so the
   *   user's own `preferred_language` decides (bd-2469)
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async sendResetCode(phoneNumber, language = null) {
    try {
      console.log('🔐 Sending password reset code', { phoneNumber, language });

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + CODE_TTL_MIN);

      const { data: users, error: userError } = await supabase
        .from('users')
        .select(`${ELIGIBILITY_COLUMNS}, preferred_language`)
        .eq('phone_number', phoneNumber);

      // Extract first user from array (or null if empty)
      const user = users && users.length > 0 ? users[0] : null;

      if (userError || !mayReceiveCode(user)) {
        // The row is never logged: it carries the password-hash column.
        console.log('❌ No registered account for a WhatsApp code', {
          phoneNumber,
          found: Boolean(user),
          errorCode: userError?.code,
        });
        return {
          success: false,
          reason: 'not_registered',
          error: 'This number is not registered yet. Register on WhatsApp first.'
        };
      }

      // Store reset code in database
      const { error: updateError } = await supabase
        .from('users')
        .update({
          password_reset_code: code,
          password_reset_expires_at: expiresAt.toISOString()
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('❌ Error storing reset code', { userId: user.id, error: updateError });
        throw updateError;
      }

      // bd-2469: the OTP goes out in the USER'S language. Read
      // `preferred_language` (never `user.language` — dead column), and clamp to
      // the variants this WABA actually has approved: asking Meta for a
      // template variant that doesn't exist fails the send outright. An explicit
      // argument still wins so a caller can force a language.
      const SUPPORTED_TEMPLATE_LANGS = ['en', 'ur'];
      const requested = language || user.preferred_language;
      const userLanguage = SUPPORTED_TEMPLATE_LANGS.includes(requested) ? requested : 'en';

      console.log('📞 Calling Main Bot internal API to send WhatsApp message', {
        mainBotUrl: MAIN_BOT_URL,
        phoneNumber,
        language: userLanguage
      });

      // Call Main Bot's internal API to send WhatsApp message
      try {
        const response = await axios.post(
          `${MAIN_BOT_URL}/api/internal/send-password-reset`,
          {
            phoneNumber,
            code,
            firstName: user.name,
            language: userLanguage
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': INTERNAL_API_KEY
            },
            timeout: 10000 // 10 second timeout
          }
        );

        if (response.data.success) {
          console.log('✅ Password reset code sent successfully via Main Bot', {
            userId: user.id,
            phoneNumber,
            language: userLanguage,
            expiresAt: expiresAt.toISOString()
          });
          return { success: true };
        } else {
          console.error('❌ Main Bot API returned error', {
            phoneNumber,
            error: response.data.error
          });
          return {
            success: false,
            reason: 'send_failed',
            error: 'Failed to send reset code. Please try again.'
          };
        }
      } catch (apiError) {
        console.error('❌ Main Bot API call failed', {
          phoneNumber,
          error: apiError.message,
          response: apiError.response?.data
        });
        return {
          success: false,
          reason: 'send_failed',
          error: 'Failed to send reset code. Please try again.'
        };
      }
    } catch (error) {
      console.error('❌ Error sending reset code', {
        phoneNumber,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        reason: 'send_failed',
        error: 'Failed to send reset code. Please try again.'
      };
    }
  }

  /**
   * Verify password reset code
   * Checks if code matches and hasn't expired
   *
   * @param {string} phoneNumber - User's phone number
   * @param {string} code - 6-digit code entered by user
   * @returns {Promise<{valid: boolean, userId?: string, error?: string}>}
   */
  static async verifyResetCode(phoneNumber, code) {
    try {
      // bd-x7aprz.3: looked up by the PHONE, not by phone + code, so a wrong code can be counted against the code
      // she was sent; five wrong codes void it. The code is never logged: it is now a sign-in.
      const { data: user, error: queryError } = await supabase
        .from('users')
        .select(`${ELIGIBILITY_COLUMNS}, password_reset_code, password_reset_expires_at`)
        .eq('phone_number', phoneNumber)
        .maybeSingle();

      if (queryError || !user || !user.password_reset_code) {
        console.log('❌ Invalid reset code (no code issued)', { phoneNumber });
        return { valid: false, error: 'Invalid reset code. Please check and try again.' };
      }

      if (!sameCode(user.password_reset_code, code)) {
        const seen = wrongTries.get(phoneNumber);
        const n = (seen && seen.code === user.password_reset_code ? seen.n : 0) + 1;
        wrongTries.set(phoneNumber, { code: user.password_reset_code, n });
        if (n >= MAX_WRONG_CODES) {
          wrongTries.delete(phoneNumber);
          await PasswordResetService.clearResetCode(user.id);
          console.log('⛔ Code voided after too many wrong tries', { phoneNumber, userId: user.id });
        } else {
          console.log('❌ Invalid reset code', { phoneNumber, userId: user.id, tries: n });
        }
        return { valid: false, error: 'Invalid reset code. Please check and try again.' };
      }

      // Check if code has expired
      const now = new Date();
      const expiresAt = new Date(user.password_reset_expires_at);

      if (!(now <= expiresAt)) {
        console.log('❌ Reset code expired', {
          phoneNumber,
          userId: user.id,
          expiresAt: user.password_reset_expires_at,
          now: now.toISOString()
        });
        return {
          valid: false,
          error: 'Reset code has expired. Please request a new code.'
        };
      }

      // The account must still be one that may sign in (not deleted, registered or with a password). NOT
      // portal_activated — see mayReceiveCode.
      if (!mayReceiveCode(user)) {
        console.log('❌ Code for an account that may not sign in', { phoneNumber, userId: user.id });
        return { valid: false, error: 'Invalid reset code. Please check and try again.' };
      }

      wrongTries.delete(phoneNumber);
      console.log('✅ Reset code verified successfully', {
        phoneNumber,
        userId: user.id
      });

      return {
        valid: true,
        userId: user.id
      };
    } catch (error) {
      console.error('❌ Error verifying reset code', {
        phoneNumber,
        error: error.message,
        stack: error.stack
      });

      return {
        valid: false,
        error: 'An error occurred while verifying your code. Please try again.'
      };
    }
  }

  /**
   * bd-x7aprz.3 — sign in with the WhatsApp code: the same check as the reset, then the code is SPENT (a code
   * opens one session, never two).
   *
   * @returns {Promise<{valid: boolean, userId?: string}>}
   */
  static async signInWithCode(phoneNumber, code) {
    const result = await PasswordResetService.verifyResetCode(phoneNumber, code);
    if (!result.valid) return result;
    const cleared = await PasswordResetService.clearResetCode(result.userId);
    // A code that cannot be spent must not open a session either: it would stay replayable.
    if (!cleared.success) return { valid: false, error: 'An error occurred while verifying your code. Please try again.' };
    return result;
  }

  /**
   * Clear reset code after successful password update
   * Removes code and expiry from database
   *
   * @param {string} userId - User's UUID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  static async clearResetCode(userId) {
    try {
      console.log('🧹 Clearing reset code', { userId });

      const { error } = await supabase
        .from('users')
        .update({
          password_reset_code: null,
          password_reset_expires_at: null
        })
        .eq('id', userId);

      if (error) {
        throw error;
      }

      console.log('✅ Reset code cleared', { userId });
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing reset code', {
        userId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Rate limit check for reset requests
   * Prevents abuse by limiting requests per phone number
   *
   * @param {string} phoneNumber - User's phone number
   * @returns {Promise<{allowed: boolean, error?: string}>}
   */
  static async checkRateLimit(phoneNumber) {
    try {
      // Get user's last reset request time
      const { data: user, error } = await supabase
        .from('users')
        .select('password_reset_expires_at')
        .eq('phone_number', phoneNumber)
        .single();

      if (error || !user) {
        // User not found - allow request
        return { allowed: true };
      }

      if (!user.password_reset_expires_at) {
        // No recent reset request - allow
        return { allowed: true };
      }

      // bd-x7aprz.3: a new code once a minute (it replaces the last one), not once per ten. The code is now how she
      // signs in; a message that did not arrive must not lock her out for ten minutes.
      const expiresAt = new Date(user.password_reset_expires_at);
      const sentAt = expiresAt.getTime() - CODE_TTL_MIN * 60 * 1000;
      const now = Date.now();

      if (now < expiresAt.getTime() && now - sentAt < RESEND_AFTER_MS) {
        const secondsRemaining = Math.ceil((RESEND_AFTER_MS - (now - sentAt)) / 1000);
        console.log('⚠️ Rate limit hit for a WhatsApp code', { phoneNumber, secondsRemaining });
        return {
          allowed: false,
          reason: 'already_sent',
          error: 'A code was just sent. Please check WhatsApp.'
        };
      }

      // Code expired - allow new request
      return { allowed: true };
    } catch (error) {
      console.error('❌ Error checking rate limit', {
        phoneNumber,
        error: error.message
      });

      // On error, allow request (fail open)
      return { allowed: true };
    }
  }
}

module.exports = PasswordResetService;
